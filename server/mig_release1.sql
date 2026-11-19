-- Release 1: remote config, client error log, report/block, delete my village

-- 1) remote config (numbers tuned after launch without a new build)
create table if not exists dv.config(
  key text primary key,
  value jsonb,
  public boolean not null default true,
  updated_at timestamptz not null default now());
alter table dv.config enable row level security;
insert into dv.config(key,value,public) values
  ('min_version_android','"0.0.0"',true),
  ('min_version_ios','"0.0.0"',true),
  ('store_url','{"android":"https://play.google.com/store/apps/details?id=online.laboon.dorong","ios":""}',true),
  ('ota','{"android":[],"ios":[]}',true),
  ('tune','{}',true),
  ('notice','null',true),
  ('errlog','{"on":true}',false)
on conflict (key) do nothing;

create or replace function public.dv_config()
returns jsonb language sql stable security definer set search_path to 'dv','public' as $$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from dv.config where public;
$$;
revoke all on function public.dv_config() from public;
grant execute on function public.dv_config() to anon, authenticated;

-- 2) client error log: one row per (day, fingerprint) with a count
create table if not exists dv.client_errors(
  id bigint generated always as identity primary key,
  day date not null default dv.today(),
  fp text not null,
  count integer not null default 1,
  players uuid[] not null default '{}',
  kind text not null check (kind in ('error','unhandledrejection','loop','info')),
  message text, stack text, screen text,
  app_ver text, game_ver text, ota text,
  model text, os text, platform text,
  screen_w integer, screen_h integer, dpr numeric,
  extra jsonb,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now());
create unique index if not exists client_errors_day_fp on dv.client_errors(day,fp);
alter table dv.client_errors enable row level security;

create or replace function public.dv_err(p jsonb, p_token text default null)
returns void language plpgsql security definer set search_path to 'dv','extensions','public' as $$
declare me uuid; k text; msg text; st text; f text;
begin
  if coalesce((select (value->>'on')::boolean from dv.config where key='errlog'),true) is not true then return; end if;
  k := coalesce(p->>'kind','error');
  if k not in ('error','unhandledrejection','loop','info') then return; end if;
  if (select count(*) from dv.client_errors where day=dv.today()) >= 5000 then return; end if;
  if p_token is not null and length(p_token) >= 32 then
    begin me := dv.me(p_token); exception when others then me := null; end;
  end if;
  msg := left(coalesce(p->>'message',''),500);
  st := left(coalesce(p->>'stack',''),4000);
  f := encode(extensions.digest(k||'|'||msg||'|'||split_part(st,E'\n',1)||'|'||split_part(st,E'\n',2)||'|'||coalesce(p->>'game_ver',''),'sha256'),'hex');
  insert into dv.client_errors(fp,kind,message,stack,screen,app_ver,game_ver,ota,model,os,platform,screen_w,screen_h,dpr,extra,players)
  values(f,k,msg,st,left(p->>'screen',80),left(p->>'app_ver',40),left(p->>'game_ver',40),left(p->>'ota',40),
    left(p->>'model',80),left(p->>'os',80),left(p->>'platform',20),
    nullif(p->>'screen_w','')::int,nullif(p->>'screen_h','')::int,nullif(p->>'dpr','')::numeric,
    case when jsonb_typeof(p->'extra')='object' and length((p->'extra')::text)<2000 then p->'extra' else null end,
    case when me is null then '{}'::uuid[] else array[me] end)
  on conflict (day,fp) do update set count=dv.client_errors.count+1, last_at=now(),
    players=case when me is null or me=any(dv.client_errors.players) or cardinality(dv.client_errors.players)>=50
                 then dv.client_errors.players else dv.client_errors.players||me end;
exception when others then return;
end $$;
revoke all on function public.dv_err(jsonb,text) from public;
grant execute on function public.dv_err(jsonb,text) to anon, authenticated;

create or replace function dv.client_errors_prune()
returns void language sql security definer set search_path to 'dv','public' as $$
  delete from dv.client_errors where day < dv.today() - 60;
$$;
select cron.unschedule('dv-errors-prune') where exists (select 1 from cron.job where jobname='dv-errors-prune');
select cron.schedule('dv-errors-prune','20 19 * * *','select dv.client_errors_prune()');

-- 3) block & report (store requirement for user-written text)
create table if not exists dv.blocks(
  blocker uuid not null references dv.players(id) on delete cascade,
  blocked uuid not null references dv.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker,blocked));
alter table dv.blocks enable row level security;

create table if not exists dv.reports(
  id bigint generated always as identity primary key,
  reporter uuid not null references dv.players(id) on delete cascade,
  author uuid references dv.players(id) on delete cascade,
  gb_id bigint,
  body text,
  reason text,
  status text not null default 'open',
  created_at timestamptz not null default now());
alter table dv.reports enable row level security;

create or replace function public.dv_block(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'dv','extensions','public' as $$
declare me uuid := dv.me(p_token);
begin
  if p_id is null or p_id=me then return jsonb_build_object('ok',false,'err','self'); end if;
  insert into dv.blocks(blocker,blocked) values(me,p_id) on conflict do nothing;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.dv_unblock(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'dv','extensions','public' as $$
declare me uuid := dv.me(p_token);
begin
  delete from dv.blocks where blocker=me and blocked=p_id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.dv_report(p_token text, p_gb bigint, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'dv','extensions','public' as $$
declare me uuid := dv.me(p_token); g dv.guestbook;
begin
  if (select count(*) from dv.reports where reporter=me and created_at > now() - interval '1 day') >= 20 then
    return jsonb_build_object('ok',false,'err','limit'); end if;
  select * into g from dv.guestbook where id=p_gb;
  if g.id is null then return jsonb_build_object('ok',true,'gone',true); end if;
  if g.author=me then return jsonb_build_object('ok',false,'err','self'); end if;
  insert into dv.reports(reporter,author,gb_id,body,reason) values(me,g.author,g.id,g.body,left(p_reason,200));
  insert into dv.blocks(blocker,blocked) values(me,g.author) on conflict do nothing;
  if g.host=me then delete from dv.guestbook where id=g.id; end if;
  return jsonb_build_object('ok',true);
end $$;

-- guestbook list hides people I blocked; writing to someone who blocked me is refused
create or replace function public.dv_guest_list(p_token text, p_host uuid)
returns jsonb language plpgsql security definer set search_path to 'dv','extensions','public' as $$
declare me uuid := dv.me(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'kind',g.kind,'body',g.body,'at',g.created_at,'author',g.author,'nick',p.nick,'rep',p.rep,'mine',g.author=me) order by g.created_at desc)
    from (select * from dv.guestbook gb where gb.host=p_host
            and not exists (select 1 from dv.blocks b where b.blocker=me and b.blocked=gb.author)
          order by gb.created_at desc limit 30) g join dv.players p on p.id=g.author),'[]'::jsonb);
end $$;

create or replace function public.dv_guest_write(p_token text, p_host uuid, p_kind text, p_body text)
returns jsonb language plpgsql security definer set search_path to 'dv','extensions','public' as $$
declare me uuid := dv.me(p_token);
begin
  if p_kind not in ('stamp','text') then return jsonb_build_object('ok',false,'err','kind'); end if;
  if exists (select 1 from dv.blocks where blocker=p_host and blocked=me) then return jsonb_build_object('ok',false,'err','blocked'); end if;
  if p_kind='stamp' and p_body !~ '^[a-z0-9_]{1,16}$' then return jsonb_build_object('ok',false,'err','stamp'); end if;
  if p_kind='text' and not dv.mutual(me,p_host) then return jsonb_build_object('ok',false,'err','not_friends'); end if;
  if p_kind='text' and (length(trim(p_body))=0 or length(p_body)>80) then return jsonb_build_object('ok',false,'err','length'); end if;
  if (select count(*) from dv.guestbook where author=me and created_at > now() - interval '1 day') >= 30 then return jsonb_build_object('ok',false,'err','limit'); end if;
  insert into dv.guestbook(host,author,kind,body) values(p_host,me,p_kind,trim(p_body));
  return jsonb_build_object('ok',true);
end $$;

-- 4) delete my village (account deletion required by both stores)
create or replace function public.dv_delete_me(p_token text)
returns jsonb language plpgsql security definer set search_path to 'dv','extensions','public' as $$
declare me uuid := dv.me(p_token);
begin
  if coalesce((select bot from dv.players where id=me),false) then return jsonb_build_object('ok',false,'err','bot'); end if;
  update dv.client_errors set players=array_remove(players,me) where me=any(players);
  delete from dv.players where id=me;  -- saves, tokens, guestbook, likes, visits, follows, outfit orders, blocks, reports cascade
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.dv_block(text,uuid) from public;
revoke all on function public.dv_unblock(text,uuid) from public;
revoke all on function public.dv_report(text,bigint,text) from public;
revoke all on function public.dv_delete_me(text) from public;
grant execute on function public.dv_block(text,uuid), public.dv_unblock(text,uuid), public.dv_report(text,bigint,text), public.dv_delete_me(text) to anon, authenticated;
