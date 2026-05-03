-- Migration: Telegram Login + multi-tenant auth — supplemental performance indexes
-- All indexes use IF NOT EXISTS for idempotency.
-- Primary indexes are created in 20260503_001_tenancy.sql; this file adds
-- the remaining covering/sort indexes needed for common query patterns.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

-- Chronological listing (admin dashboards, audit trails)
CREATE INDEX IF NOT EXISTS users_created_at_idx
  ON users(created_at DESC);

-- Join from users → tenants when resolving primary workspace
CREATE INDEX IF NOT EXISTS users_primary_tenant_idx
  ON users(primary_tenant_id);

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------

-- Chronological listing
CREATE INDEX IF NOT EXISTS tenants_created_at_idx
  ON tenants(created_at DESC);

-- ---------------------------------------------------------------------------
-- council_sessions (extended columns)
-- ---------------------------------------------------------------------------

-- Supports "list sessions for tenant, newest first" — the primary read pattern
-- used by the LLM Council history page.
CREATE INDEX IF NOT EXISTS council_sessions_tenant_updated_idx
  ON council_sessions(tenant_id, updated_at DESC)
  WHERE tenant_id IS NOT NULL;
