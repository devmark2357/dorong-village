-- Store purchases (verified by the dv-iap edge function) + paid outfit orders + push tokens
create table if not exists dv.purchases(
  id bigint generated always as identity primary key,
  player uuid references dv.players(id) on delete set null,
  store text not null check (store in ('google','apple')),
  product text not null,
  order_key text not null,
  token_hash text,
  test boolean not null default false,
  status text not null default 'ok',
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique(store, order_key));
alter table dv.purchases enable row level security;

-- edge-function helpers (service role only)
create or replace function public.dv_iap_me(p_token text)
returns uuid language sql stable security definer set search_path to 'dv','extensions','public' as $$ select dv.me(p_token) $$;

create or replace function public.dv_iap_record(p_player uuid, p_store text, p_product text, p_order text, p_token_hash text, p_test boolean)
returns jsonb language plpgsql security definer set search_path to 'dv','public' as $$
declare r dv.purchases;
begin
  select * into r from dv.purchases where store=p_store and order_key=p_order;
  if r.id is not null then
    if r.player is distinct from p_player then return jsonb_build_object('ok',false,'err','pay_owner'); end if;
    return jsonb_build_object('ok',true,'key',p_store||':'||p_order,'fresh',false);
  end if;
  insert into dv.purchases(player,store,product,order_key,token_hash,test) values(p_player,p_store,p_product,p_order,p_token_hash,p_test);
  return jsonb_build_object('ok',true,'key',p_store||':'||p_order,'fresh',true);
end $$;
revoke all on function public.dv_iap_me(text) from public, anon, authenticated;
revoke all on function public.dv_iap_record(uuid,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.dv_iap_me(text), public.dv_iap_record(uuid,text,text,text,text,boolean) to service_role;

-- outfit orders: a paid order must point at one verified, unused 「dorong.outfit」 purchase of this player
create or replace function public.dv_outfit_new(p_token text, p_res integer, p_style text, p_photo text, p_paid text)
returns jsonb language plpgsql security definer set search_path to 'dv','extensions','public' as $$
declare me uuid := dv.me(p_token); oid uuid; pid bigint;
begin
  if exists(select 1 from dv.outfit_orders where player=me and status not in ('done','failed')) then return jsonb_build_object('ok',false,'err','busy'); end if;
  if p_paid = 'test' then
    if (select count(*) from dv.outfit_orders where paid='test' and created_at > now() - interval '1 day') >= 4 then return jsonb_build_object('ok',false,'err','test_cap'); end if;
  elsif p_paid like 'iap:%' then
    update dv.purchases set used_at=now()
      where id = (select id from dv.purchases where store||':'||order_key = substr(p_paid,5) and player=me and product='dorong.outfit'
                  and used_at is null and status='ok' limit 1)
      returning id into pid;
    if pid is null then return jsonb_build_object('ok',false,'err','unpaid'); end if;
  else
    return jsonb_build_object('ok',false,'err','unpaid');
  end if;
  insert into dv.outfit_orders(player,res_i,style,photo_path,paid) values (me,p_res,left(coalesce(p_style,''),160),p_photo,p_paid) returning id into oid;
  return jsonb_build_object('ok',true,'id',oid,'player',me);
end $$;

-- push: one FCM token per device (sending comes later)
create table if not exists dv.push_tokens(
  token text primary key,
  player uuid references dv.players(id) on delete cascade,
  platform text,
  lang text,
  updated_at timestamptz not null default now());
alter table dv.push_tokens enable row level security;
create or replace function public.dv_push_token(p_token text, p_fcm text, p_platform text, p_lang text)
returns jsonb language plpgsql security definer set search_path to 'dv','extensions','public' as $$
declare me uuid := dv.me(p_token);
begin
  if p_fcm is null or length(p_fcm) < 20 or length(p_fcm) > 4096 then return jsonb_build_object('ok',false); end if;
  insert into dv.push_tokens(token,player,platform,lang) values(p_fcm,me,left(p_platform,10),left(p_lang,10))
    on conflict (token) do update set player=excluded.player, platform=excluded.platform, lang=excluded.lang, updated_at=now();
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.dv_push_token(text,text,text,text) from public;
grant execute on function public.dv_push_token(text,text,text,text) to anon, authenticated;
