-- ============================================================================
-- AEGISTRAVEL / SAFETOURIST PRO — MIGRATION V3
-- Additive & idempotent. Adds optional persistence for the command-center
-- features (evidence ledger, safety pulse, telemetry, scam radar, billing,
-- fleet broadcasts). Does NOT modify or drop existing tables, columns,
-- constraints, policies or data from schema.sql / migration_v2.sql.
-- Run AFTER schema.sql and migration_v2.sql.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. EXTEND tourists WITH AEGIS TELEMETRY / PLAN COLUMNS
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='tourists' and column_name='battery_level') then
    alter table public.tourists add column battery_level integer;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='tourists' and column_name='network_status') then
    alter table public.tourists add column network_status text;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='tourists' and column_name='plan_tier') then
    alter table public.tourists add column plan_tier text default 'free';
  end if;

  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='tourists' and column_name='last_checkin_at') then
    alter table public.tourists add column last_checkin_at timestamptz;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='tourists' and column_name='pulse_deadline') then
    alter table public.tourists add column pulse_deadline timestamptz;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='tourists' and column_name='stealth_mode') then
    alter table public.tourists add column stealth_mode boolean default false;
  end if;

  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='tourists' and column_name='group_mesh_id') then
    alter table public.tourists add column group_mesh_id text;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. TAMPER-EVIDENT EVIDENCE LEDGER (black box)
-- ----------------------------------------------------------------------------
create table if not exists public.aegis_ledger (
  id           uuid primary key default gen_random_uuid(),
  tourist_id   text,
  seq          integer not null,
  entry_type   text not null,
  title        text,
  payload      jsonb not null default '{}'::jsonb,
  prev_hash    text,
  entry_hash   text not null,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists aegis_ledger_tourist_idx on public.aegis_ledger(tourist_id, seq desc);
create index if not exists aegis_ledger_type_idx on public.aegis_ledger(entry_type, occurred_at desc);

-- ----------------------------------------------------------------------------
-- 3. SAFETY PULSE CHECK-INS (dead-man switch audit)
-- ----------------------------------------------------------------------------
create table if not exists public.safety_checkins (
  id                     uuid primary key default gen_random_uuid(),
  tourist_id             text not null,
  status                 text not null check (status in ('armed','safe','escalated','disarmed')),
  deadline               timestamptz,
  checked_in_at          timestamptz,
  escalated_incident_id  text,
  created_at             timestamptz not null default now()
);

create index if not exists safety_checkins_tourist_idx on public.safety_checkins(tourist_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. TELEMETRY BREADCRUMBS (replay + certificate GPS trail)
-- ----------------------------------------------------------------------------
create table if not exists public.telemetry_breadcrumbs (
  id           uuid primary key default gen_random_uuid(),
  tourist_id   text not null,
  latitude     double precision not null check (latitude between -90 and 90),
  longitude    double precision not null check (longitude between -180 and 180),
  accuracy     numeric,
  risk_score   integer,
  zone         text,
  recorded_at  timestamptz not null default now()
);

create index if not exists telemetry_breadcrumbs_tourist_idx on public.telemetry_breadcrumbs(tourist_id, recorded_at desc);

-- ----------------------------------------------------------------------------
-- 5. COMMUNITY SCAM / HAZARD / SAFE-HAVEN ALERTS
-- ----------------------------------------------------------------------------
create table if not exists public.community_alerts (
  id            text primary key,
  title         text not null,
  category      text not null check (category in ('scam','hazard','crowd','haven')),
  description   text,
  latitude      double precision,
  longitude     double precision,
  upvotes       integer default 0,
  verified      boolean default false,
  reported_by   text,
  status        text default 'pending' check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now()
);

create index if not exists community_alerts_geo_idx on public.community_alerts(latitude, longitude);

-- ----------------------------------------------------------------------------
-- 6. SUBSCRIPTIONS (multi-tenant SaaS billing state)
-- ----------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  tourist_id    text,
  tenant_id     text,
  plan          text not null check (plan in ('free','pro','enterprise')),
  billing_cycle text check (billing_cycle in ('monthly','annual')),
  price         numeric,
  currency      text default 'USD',
  card_last4    text,
  seats         integer default 1,
  status        text default 'active' check (status in ('active','cancelled','past_due')),
  activated_at  timestamptz not null default now(),
  renews_at     timestamptz
);

create index if not exists subscriptions_tourist_idx on public.subscriptions(tourist_id, activated_at desc);

-- ----------------------------------------------------------------------------
-- 7. FLEET BROADCASTS
-- ----------------------------------------------------------------------------
create table if not exists public.broadcasts (
  id           text primary key,
  tenant_id    text,
  audience     text,
  severity     text default 'info' check (severity in ('info','warning','critical')),
  message      text not null,
  recipients   integer default 0,
  sent_by      text,
  sent_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.aegis_ledger          enable row level security;
alter table public.safety_checkins       enable row level security;
alter table public.telemetry_breadcrumbs enable row level security;
alter table public.community_alerts      enable row level security;
alter table public.subscriptions         enable row level security;
alter table public.broadcasts            enable row level security;

-- 8.1 aegis_ledger — read own or authority, append-only (no update/delete)
drop policy if exists "aegis_ledger read own or authority" on public.aegis_ledger;
create policy "aegis_ledger read own or authority" on public.aegis_ledger
  for select to authenticated
  using (
    tourist_id in (select tourist_id from public.tourists where auth_user_id = auth.uid())
    or public.is_authority()
  );

drop policy if exists "aegis_ledger insert own or authority" on public.aegis_ledger;
create policy "aegis_ledger insert own or authority" on public.aegis_ledger
  for insert to authenticated
  with check (
    tourist_id in (select tourist_id from public.tourists where auth_user_id = auth.uid())
    or public.is_authority()
  );

-- 8.2 safety_checkins
drop policy if exists "safety_checkins read own or authority" on public.safety_checkins;
create policy "safety_checkins read own or authority" on public.safety_checkins
  for select to authenticated
  using (
    tourist_id in (select tourist_id from public.tourists where auth_user_id = auth.uid())
    or public.is_authority()
  );

drop policy if exists "safety_checkins insert own or authority" on public.safety_checkins;
create policy "safety_checkins insert own or authority" on public.safety_checkins
  for insert to authenticated
  with check (
    tourist_id in (select tourist_id from public.tourists where auth_user_id = auth.uid())
    or public.is_authority()
  );

-- 8.3 telemetry_breadcrumbs
drop policy if exists "breadcrumbs read own or authority" on public.telemetry_breadcrumbs;
create policy "breadcrumbs read own or authority" on public.telemetry_breadcrumbs
  for select to authenticated
  using (
    tourist_id in (select tourist_id from public.tourists where auth_user_id = auth.uid())
    or public.is_authority()
  );

drop policy if exists "breadcrumbs insert own or authority" on public.telemetry_breadcrumbs;
create policy "breadcrumbs insert own or authority" on public.telemetry_breadcrumbs
  for insert to authenticated
  with check (
    tourist_id in (select tourist_id from public.tourists where auth_user_id = auth.uid())
    or public.is_authority()
  );

-- 8.4 community_alerts — public read, authenticated submit, authority moderate
drop policy if exists "community_alerts public read" on public.community_alerts;
create policy "community_alerts public read" on public.community_alerts
  for select to anon, authenticated
  using (true);

drop policy if exists "community_alerts authenticated insert" on public.community_alerts;
create policy "community_alerts authenticated insert" on public.community_alerts
  for insert to authenticated
  with check (true);

drop policy if exists "community_alerts authority update" on public.community_alerts;
create policy "community_alerts authority update" on public.community_alerts
  for update to authenticated
  using (public.is_authority())
  with check (public.is_authority());

-- 8.5 subscriptions — read own or authority, deny client writes
drop policy if exists "subscriptions read own or authority" on public.subscriptions;
create policy "subscriptions read own or authority" on public.subscriptions
  for select to authenticated
  using (
    tourist_id in (select tourist_id from public.tourists where auth_user_id = auth.uid())
    or public.is_authority()
  );

-- 8.6 broadcasts — readers authenticated, writers authority
drop policy if exists "broadcasts authenticated read" on public.broadcasts;
create policy "broadcasts authenticated read" on public.broadcasts
  for select to authenticated
  using (true);

drop policy if exists "broadcasts authority insert" on public.broadcasts;
create policy "broadcasts authority insert" on public.broadcasts
  for insert to authenticated
  with check (public.is_authority());

-- ----------------------------------------------------------------------------
-- 9. REALTIME REPLICATION (keeps existing tables, adds Aegis tables)
-- ----------------------------------------------------------------------------
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime for table
    public.tourists,
    public.incidents,
    public.safety_zones,
    public.area_reports,
    public.aegis_ledger,
    public.safety_checkins,
    public.telemetry_breadcrumbs,
    public.community_alerts,
    public.broadcasts;
commit;

-- ============================================================================
-- MIGRATION V3 COMPLETE
-- ============================================================================
