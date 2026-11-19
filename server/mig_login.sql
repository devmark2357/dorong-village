-- Google / Apple login: link an outside account to a village, or bring that village to a new phone
alter table dv.players add column if not exists google_sub text;
alter table dv.players add column if not exists apple_sub text;
alter table dv.players add column if not exists linked_at timestamptz;
create unique index if not exists players_google_sub on dv.players(google_sub) where google_sub is not null;
create unique index if not exists players_apple_sub on dv.players(apple_sub) where apple_sub is not null;

-- one-time Apple nonces (the edge function signs them; this table stops reuse)
create table if not exists dv.oauth_nonces(
  key text primary key,
  exp timestamptz not null);
alter table dv.oauth_nonces enable row level security;

create or replace function public.dv_nonce_use(p_key text, p_exp timestamptz)
returns boolean language plpgsql security definer set search_path to 'dv','public' as $$
begin
  delete from dv.oauth_nonces where exp < now();
  insert into dv.oauth_nonces(key,exp) values(p_key,p_exp);
  return true;
exception when unique_violation then return false;
end $$;

-- called only by the dv-auth edge function after it has verified the Google/Apple ID token
create or replace function public.dv_auth_link(p_provider text, p_sub text, p_token text, p_nick text, p_vname text, p_rep integer)
returns jsonb language plpgsql security definer set search_path to 'dv','extensions','public' as $$
declare hit dv.players; cur uuid; cur_sub text; t text := encode(extensions.gen_random_bytes(24),'hex'); d jsonb; c text; i int;
  abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; nid uuid;
begin
  if p_provider not in ('google','apple') or p_sub is null or length(p_sub) < 5 then raise exception 'bad_provider'; end if;
  if p_token is not null and length(p_token) >= 32 then
    begin cur := dv.me(p_token); exception when others then cur := null; end;
  end if;
  if p_provider='google' then select * into hit from dv.players where google_sub=p_sub;
  else select * into hit from dv.players where apple_sub=p_sub; end if;

  -- this outside account already has a village
  if hit.id is not null then
    if cur = hit.id then return jsonb_build_object('mode','same','id',hit.id,'code',hit.code); end if;
    insert into dv.tokens(token_hash,player) values(encode(extensions.digest(t,'sha256'),'hex'),hit.id);
    select data into d from dv.saves where player=hit.id;
    return jsonb_build_object('mode','existing','id',hit.id,'code',hit.code,'token',t,'data',d,'nick',hit.nick,'vname',hit.vname);
  end if;

  -- link to the village on this phone
  if cur is not null then
    select case when p_provider='google' then google_sub else apple_sub end into cur_sub from dv.players where id=cur;
    if cur_sub is not null then return jsonb_build_object('mode','other'); end if;
    if p_provider='google' then update dv.players set google_sub=p_sub, linked_at=now() where id=cur;
    else update dv.players set apple_sub=p_sub, linked_at=now() where id=cur; end if;
    return jsonb_build_object('mode','linked','id',cur);
  end if;

  -- brand-new village tied to this outside account
  loop
    c := '';
    for i in 1..6 loop c := c || substr(abc, 1 + floor(random()*length(abc))::int, 1); end loop;
    exit when not exists(select 1 from dv.players where code=c);
  end loop;
  insert into dv.players(code,secret_hash,nick,vname,rep,google_sub,apple_sub,linked_at)
  values(c, encode(extensions.digest(t,'sha256'),'hex'), left(coalesce(p_nick,''),16), left(coalesce(p_vname,''),20), coalesce(p_rep,0),
    case when p_provider='google' then p_sub end, case when p_provider='apple' then p_sub end, now())
  returning id into nid;
  return jsonb_build_object('mode','new','id',nid,'code',c,'token',t);
end $$;

revoke all on function public.dv_auth_link(text,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.dv_nonce_use(text,timestamptz) from public, anon, authenticated;
grant execute on function public.dv_auth_link(text,text,text,text,text,integer) to service_role;
grant execute on function public.dv_nonce_use(text,timestamptz) to service_role;

-- what this village is linked to (for the options screen)
create or replace function public.dv_account(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'dv','extensions','public' as $$
declare me uuid := dv.me(p_token); p dv.players;
begin
  select * into p from dv.players where id=me;
  return jsonb_build_object('google',p.google_sub is not null,'apple',p.apple_sub is not null,'code',p.code);
end $$;
revoke all on function public.dv_account(text) from public;
grant execute on function public.dv_account(text) to anon, authenticated;
