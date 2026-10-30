-- ============================================================================
-- SMART TOURIST SAFETY SYSTEM — MIGRATION V2
-- Additive migration: new columns on safety_zones + new area_reports table
-- Safe to run multiple times (idempotent). Does NOT drop or modify existing
-- tables, columns, constraints, or data.
-- ============================================================================


-- ============================================================================
-- 1. EXTEND safety_zones TABLE WITH NEW COLUMNS
-- ============================================================================
-- PostgreSQL does not support ADD COLUMN IF NOT EXISTS in all versions,
-- so we use a DO block to check information_schema before each ALTER.

DO $$
BEGIN
  -- district: the administrative district this zone belongs to
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'safety_zones' AND column_name = 'district'
  ) THEN
    ALTER TABLE public.safety_zones ADD COLUMN district TEXT;
  END IF;

  -- city: the city this zone belongs to
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'safety_zones' AND column_name = 'city'
  ) THEN
    ALTER TABLE public.safety_zones ADD COLUMN city TEXT;
  END IF;

  -- description: human-readable description of the zone
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'safety_zones' AND column_name = 'description'
  ) THEN
    ALTER TABLE public.safety_zones ADD COLUMN description TEXT;
  END IF;

  -- classification_basis: why this area is classified as safe/restricted/caution
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'safety_zones' AND column_name = 'classification_basis'
  ) THEN
    ALTER TABLE public.safety_zones ADD COLUMN classification_basis TEXT;
  END IF;

  -- data_source: where the safety data comes from
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'safety_zones' AND column_name = 'data_source'
  ) THEN
    ALTER TABLE public.safety_zones ADD COLUMN data_source TEXT;
  END IF;

  -- verified_at: when the zone was last verified
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'safety_zones' AND column_name = 'verified_at'
  ) THEN
    ALTER TABLE public.safety_zones ADD COLUMN verified_at TIMESTAMPTZ;
  END IF;

  -- verification_status: current verification state of the zone
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'safety_zones' AND column_name = 'verification_status'
  ) THEN
    ALTER TABLE public.safety_zones ADD COLUMN verification_status TEXT
      CHECK (verification_status IN ('verified', 'unverified', 'reported', 'official'))
      DEFAULT 'unverified';
  END IF;

  -- reported_by: who reported or created this zone ('system', 'authority', 'user')
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'safety_zones' AND column_name = 'reported_by'
  ) THEN
    ALTER TABLE public.safety_zones ADD COLUMN reported_by TEXT;
  END IF;

  -- report_count: number of user reports that corroborate this zone
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'safety_zones' AND column_name = 'report_count'
  ) THEN
    ALTER TABLE public.safety_zones ADD COLUMN report_count INTEGER DEFAULT 0;
  END IF;

  -- is_auto_loaded: whether this zone was loaded from seed/bulk data
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'safety_zones' AND column_name = 'is_auto_loaded'
  ) THEN
    ALTER TABLE public.safety_zones ADD COLUMN is_auto_loaded BOOLEAN DEFAULT false;
  END IF;
END
$$;


-- ============================================================================
-- 2. CREATE area_reports TABLE
-- ============================================================================
-- Allows tourists to submit safety reports about areas. These reports go
-- through a moderation workflow (pending → approved / rejected).

CREATE TABLE IF NOT EXISTS public.area_reports (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  area_name             TEXT            NOT NULL,
  report_type           TEXT            CHECK (report_type IN ('safe', 'restricted', 'caution', 'hazard', 'other')),
  description           TEXT            NOT NULL,
  latitude              DOUBLE PRECISION,
  longitude             DOUBLE PRECISION,
  reported_by_tourist_id TEXT,
  reported_by_email     TEXT,
  status                TEXT            CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  admin_notes           TEXT,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT now()
);


-- ============================================================================
-- 3. AUTO-UPDATE TRIGGER FOR area_reports.updated_at
-- ============================================================================
-- Reuses the existing public.set_updated_at() trigger function from schema.sql.

DROP TRIGGER IF EXISTS area_reports_updated_at ON public.area_reports;
CREATE TRIGGER area_reports_updated_at
  BEFORE UPDATE ON public.area_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- ============================================================================
-- 4. ROW LEVEL SECURITY FOR area_reports
-- ============================================================================
ALTER TABLE public.area_reports ENABLE ROW LEVEL SECURITY;

-- 4.1 INSERT: any authenticated user can submit a report
DROP POLICY IF EXISTS "area_reports insert by authenticated" ON public.area_reports;
CREATE POLICY "area_reports insert by authenticated" ON public.area_reports
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- 4.2 SELECT: authenticated users can read their own reports (matched by tourist_id
--     from the tourists table linked to their auth uid). Authority can read all.
DROP POLICY IF EXISTS "area_reports select own or authority" ON public.area_reports;
CREATE POLICY "area_reports select own or authority" ON public.area_reports
  FOR SELECT TO authenticated
  USING (
    -- The reporter's tourist_id matches the logged-in user's tourist record
    reported_by_tourist_id IN (
      SELECT tourist_id FROM public.tourists WHERE auth_user_id = auth.uid()
    )
    OR public.is_authority()
  );

-- 4.3 UPDATE: authority only
DROP POLICY IF EXISTS "area_reports update by authority" ON public.area_reports;
CREATE POLICY "area_reports update by authority" ON public.area_reports
  FOR UPDATE TO authenticated
  USING (public.is_authority())
  WITH CHECK (public.is_authority());

-- 4.4 DELETE: authority only
DROP POLICY IF EXISTS "area_reports delete by authority" ON public.area_reports;
CREATE POLICY "area_reports delete by authority" ON public.area_reports
  FOR DELETE TO authenticated
  USING (public.is_authority());


-- ============================================================================
-- 5. ENABLE SUPABASE REALTIME REPLICATION (includes area_reports)
-- ============================================================================
-- Recreate the publication to include the new table alongside existing ones.
-- This is safe to re-run; it replaces the previous publication definition.

BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime
    FOR TABLE public.tourists, public.incidents, public.safety_zones, public.area_reports;
COMMIT;


-- ============================================================================
-- MIGRATION V2 COMPLETE
-- ============================================================================
