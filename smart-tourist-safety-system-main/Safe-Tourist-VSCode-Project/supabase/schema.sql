-- ============================================================================
-- SMART TOURIST SAFETY MONITORING & INCIDENT RESPONSE SYSTEM
-- Production-Ready Supabase PostgreSQL Schema & Realtime Setup
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. TOURISTS TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.tourists (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  tourist_id text not null unique check (char_length(tourist_id) between 3 and 80),
  name text not null check (char_length(name) between 2 and 80),
  email text,
  phone text,
  emergency_contact_name text,
  emergency_contact text,
  blood_group text,
  allergies text,
  identity_hash text,
  zone text not null default 'Location not acquired',
  status text not null default 'Safe',
  latitude double precision,
  longitude double precision,
  location_source text not null default 'not_acquired',
  location_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. SAFETY ZONES TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.safety_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  zone_type text not null check (zone_type in ('Safe','Caution','Restricted')),
  risk_level text not null check (risk_level in ('Low','Medium','High')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius integer not null check (radius between 50 and 5000),
  description text, -- Added to support map descriptions
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. INCIDENTS TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.incidents (
  id text primary key check (char_length(id) between 3 and 100),
  auth_user_id uuid references auth.users(id) on delete cascade,
  tourist_id text not null,
  tourist_name text,
  type text not null,
  severity text not null check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  status text not null check (status in ('New','Acknowledged','Assigned','Resolved')),
  zone text,
  description text,
  latitude double precision,
  longitude double precision,
  accuracy numeric,
  audit_ref text,
  source text,
  assigned_to text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for lightning fast queries
create index if not exists incidents_auth_user_id_idx on public.incidents(auth_user_id, occurred_at desc);
create index if not exists incidents_tourist_id_idx on public.incidents(tourist_id, occurred_at desc);
create index if not exists tourists_auth_user_id_idx on public.tourists(auth_user_id);
create index if not exists tourists_tourist_id_idx on public.tourists(tourist_id);

-- Auto-update timestamps trigger function
create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin 
  new.updated_at = now(); 
  return new; 
end;
$$;

drop trigger if exists tourists_updated_at on public.tourists;
create trigger tourists_updated_at before update on public.tourists for each row execute function public.set_updated_at();

drop trigger if exists safety_zones_updated_at on public.safety_zones;
create trigger safety_zones_updated_at before update on public.safety_zones for each row execute function public.set_updated_at();

drop trigger if exists incidents_updated_at on public.incidents;
create trigger incidents_updated_at before update on public.incidents for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
alter table public.tourists enable row level security;
alter table public.incidents enable row level security;
alter table public.safety_zones enable row level security;

-- Helper function to identify verified authority accounts via JWT metadata
create or replace function public.is_authority()
returns boolean language sql security definer set search_path = public as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' ->> 'role') = 'authority',
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'user_metadata' ->> 'role') = 'authority',
    false
  );
$$;

-- 4.1 Tourists Policies
drop policy if exists "allow authenticated tourist read" on public.tourists;
create policy "tourists read own profile or authority read all" on public.tourists 
  for select to authenticated
  using (auth.uid() = auth_user_id or public.is_authority());

drop policy if exists "allow authenticated tourist insert" on public.tourists;
create policy "tourists insert own profile" on public.tourists 
  for insert to authenticated
  with check (auth.uid() = auth_user_id or public.is_authority());

drop policy if exists "allow authenticated tourist update" on public.tourists;
create policy "tourists update own profile or authority update status" on public.tourists 
  for update to authenticated
  using (auth.uid() = auth_user_id or public.is_authority())
  with check (auth.uid() = auth_user_id or public.is_authority());

-- 4.2 Incidents Policies
drop policy if exists "allow anyone read incidents" on public.incidents;
create policy "tourists read own incidents or authority read all" on public.incidents 
  for select to authenticated
  using (auth.uid() = auth_user_id or public.is_authority());

drop policy if exists "allow anyone insert incidents" on public.incidents;
create policy "tourists create own incidents or authority create" on public.incidents 
  for insert to authenticated
  with check (auth.uid() = auth_user_id or public.is_authority());

drop policy if exists "allow anyone update incidents" on public.incidents;
create policy "authority only update and resolve incidents" on public.incidents 
  for update to authenticated
  using (public.is_authority())
  with check (public.is_authority());

-- 4.3 Safety Zones Policies
drop policy if exists "anyone can read safety zones" on public.safety_zones;
create policy "anyone can read safety zones" on public.safety_zones 
  for select to anon, authenticated
  using (true);

drop policy if exists "anyone can insert safety zones" on public.safety_zones;
create policy "anyone can insert safety zones" on public.safety_zones 
  for insert to anon, authenticated
  with check (true);

-- UPDATED: Temporarily allow anyone to update zones so your 1-click status change works in the demo
drop policy if exists "anyone can update safety zones" on public.safety_zones;
create policy "anyone can update safety zones" on public.safety_zones 
  for update to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "anyone can delete safety zones" on public.safety_zones;
create policy "authority only delete safety zones" on public.safety_zones 
  for delete to authenticated
  using (public.is_authority());


-- ----------------------------------------------------------------------------
-- 5. INITIAL SEED DATA (Includes Maharashtra Zones)
-- ----------------------------------------------------------------------------
insert into public.safety_zones (name, zone_type, risk_level, latitude, longitude, radius, description)
values
  ('Gateway of India, Mumbai','Safe','Low',18.9220,72.8347,500,'Highly secure, tourist-friendly with heavy police presence.'),
  ('Ajanta Caves, Aurangabad','Safe','Low',20.5519,75.7033,1000,'Well-maintained tourist site with dedicated security.'),
  ('Gadchiroli Forest Zone','Restricted','High',20.1849,80.0000,5000,'Restricted due to naxalite activities and dense unpatrolled forests.'),
  ('Bhandardara Dam Overflow Area','Restricted','High',19.5398,73.7753,800,'Prone to sudden water release and slippery terrains during monsoon.')
on conflict (name) do update set 
  zone_type = EXCLUDED.zone_type,
  risk_level = EXCLUDED.risk_level,
  description = EXCLUDED.description;

-- ----------------------------------------------------------------------------
-- 6. ENABLE SUPABASE REALTIME REPLICATION
-- ----------------------------------------------------------------------------
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime for table public.tourists, public.incidents, public.safety_zones;
commit;