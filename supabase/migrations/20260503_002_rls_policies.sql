-- Migration: Telegram Login + multi-tenant auth — RLS policies
-- Enables Row Level Security on tenant-aware tables and defines access policies.
-- JWT claims are injected by the Worker via:
--   SET LOCAL "request.jwt.claims" = '<json>';
-- inside a transaction before executing any DML.
--
-- Claim shape:
--   { "sub": "<uuid>", "tenant_id": "<uuid>", "tenants": ["<uuid>"],
--     "role": "owner|member", "kid": "v1", "exp": <unix_ts> }

-- ---------------------------------------------------------------------------
-- Helper functions (STABLE — safe to call multiple times per query)
-- ---------------------------------------------------------------------------

-- Returns the full JWT claims object, or empty JSON if not set.
CREATE OR REPLACE FUNCTION auth_jwt_claims() RETURNS jsonb AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb,
    '{}'::jsonb
  )
$$ LANGUAGE sql STABLE;

-- Returns the active tenant_id from the JWT, or NULL if unauthenticated.
CREATE OR REPLACE FUNCTION auth_tenant_id() RETURNS uuid AS $$
  SELECT (auth_jwt_claims() ->> 'tenant_id')::uuid
$$ LANGUAGE sql STABLE;

-- Returns the authenticated user's UUID (JWT "sub" claim), or NULL.
CREATE OR REPLACE FUNCTION auth_user_id() RETURNS uuid AS $$
  SELECT (auth_jwt_claims() ->> 'sub')::uuid
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- Enable RLS on tenant-aware tables
-- (immigration_cases already has RLS; council_turns inherits via CASCADE)
-- ---------------------------------------------------------------------------
ALTER TABLE collections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE council_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- collections policies
-- Read:  anonymous rows (tenant_id IS NULL) are public; tenanted rows require
--        the JWT tenant_id to match.
-- Write: only authenticated requests whose tenant_id matches may mutate.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS collections_tenant_read  ON collections;
DROP POLICY IF EXISTS collections_tenant_write ON collections;

CREATE POLICY collections_tenant_read ON collections
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = auth_tenant_id());

CREATE POLICY collections_tenant_write ON collections
  FOR ALL
  USING (tenant_id = auth_tenant_id())
  WITH CHECK (tenant_id = auth_tenant_id());

-- ---------------------------------------------------------------------------
-- saved_searches policies (same pattern as collections)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS saved_searches_tenant_read  ON saved_searches;
DROP POLICY IF EXISTS saved_searches_tenant_write ON saved_searches;

CREATE POLICY saved_searches_tenant_read ON saved_searches
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = auth_tenant_id());

CREATE POLICY saved_searches_tenant_write ON saved_searches
  FOR ALL
  USING (tenant_id = auth_tenant_id())
  WITH CHECK (tenant_id = auth_tenant_id());

-- ---------------------------------------------------------------------------
-- council_sessions policy
-- Anonymous sessions (tenant_id IS NULL) remain readable by anyone (legacy).
-- Tenanted sessions are isolated per tenant.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS council_sessions_tenant ON council_sessions;

CREATE POLICY council_sessions_tenant ON council_sessions
  FOR ALL
  USING (tenant_id IS NULL OR tenant_id = auth_tenant_id());

-- ---------------------------------------------------------------------------
-- tenant_members policy
-- Users may only view their own membership rows.
-- Mutations go through the Worker's service-role connection (bypasses RLS).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_members_self ON tenant_members;

CREATE POLICY tenant_members_self ON tenant_members
  FOR SELECT
  USING (user_id = auth_user_id());
