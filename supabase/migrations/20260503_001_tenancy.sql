-- Migration: Telegram Login + multi-tenant auth — core tenancy tables
-- Creates: users, tenants, tenant_members, tenant_invites, collections, saved_searches
-- Extends: council_sessions with tenant context
-- Idempotent: uses IF NOT EXISTS throughout

-- ---------------------------------------------------------------------------
-- users (Telegram identity store)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id       bigint      NOT NULL,
  username          text,
  first_name        text,
  last_name         text,
  photo_url         text,
  primary_tenant_id uuid,       -- FK added below after tenants table exists
  created_at        timestamptz DEFAULT now(),
  last_login_at     timestamptz,
  deleted_at        timestamptz
);

-- Soft-delete-aware unique index: one active record per Telegram user
CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_uniq
  ON users(telegram_id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- tenants (individual account or organization workspace)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id         uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text  NOT NULL CHECK (kind IN ('individual', 'organization')),
  name       text  NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Add FK from users → tenants (both tables now exist)
ALTER TABLE users
  ADD CONSTRAINT IF NOT EXISTS users_primary_tenant_fk
  FOREIGN KEY (primary_tenant_id) REFERENCES tenants(id);

-- ---------------------------------------------------------------------------
-- tenant_members (many-to-many: users ↔ tenants, with roles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'member')),
  invited_by  uuid REFERENCES users(id),
  joined_at   timestamptz DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- Optimises "which tenants does user X belong to?" queries
CREATE INDEX IF NOT EXISTS tenant_members_user_idx
  ON tenant_members(user_id, tenant_id);

-- ---------------------------------------------------------------------------
-- tenant_invites (invite-link tokens; store hash only — never the raw token)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_invites (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invited_by  uuid  REFERENCES users(id),
  token_hash  text  NOT NULL UNIQUE,   -- SHA-256 hex of the raw invite token
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz DEFAULT now()
);

-- Supports pruning expired/consumed invites per tenant
CREATE INDEX IF NOT EXISTS tenant_invites_cleanup_idx
  ON tenant_invites(tenant_id, expires_at);

-- ---------------------------------------------------------------------------
-- collections (case groupings — migrated from localStorage)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid    REFERENCES tenants(id),   -- NULL = anonymous/local-only
  created_by  uuid    REFERENCES users(id),
  name        text    NOT NULL,
  description text,
  case_ids    text[]  DEFAULT '{}',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collections_tenant_idx
  ON collections(tenant_id)
  WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- saved_searches (filter presets — migrated from localStorage)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_searches (
  id          uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid   REFERENCES tenants(id),   -- NULL = anonymous/local-only
  created_by  uuid   REFERENCES users(id),
  name        text   NOT NULL,
  filters     jsonb  NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_searches_tenant_idx
  ON saved_searches(tenant_id)
  WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Extend council_sessions with tenant context (additive — no data loss)
-- ---------------------------------------------------------------------------
ALTER TABLE council_sessions
  ADD COLUMN IF NOT EXISTS tenant_id  uuid REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS council_sessions_tenant_idx
  ON council_sessions(tenant_id)
  WHERE tenant_id IS NOT NULL;
