-- IMMI_ACCOUNT_DB: identity, tenant isolation, user state and Council metadata.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  username TEXT,
  photo_url TEXT,
  -- Preserved from the source tenancy record. Runtime membership is still
  -- live-checked before issuing a token; this is not an authorization grant.
  primary_tenant_id TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (primary_tenant_id) REFERENCES tenants(tenant_id)
);
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('individual', 'organisation')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_tenant_idx ON memberships(user_id, tenant_id);

CREATE TABLE IF NOT EXISTS invites (
  invite_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  -- Legacy IMMI invite links have no email field; null means the source did
  -- not carry an email address, rather than a fabricated recipient value.
  email TEXT,
  role TEXT NOT NULL CHECK(role IN ('admin', 'member', 'viewer')),
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  -- Legacy invitation links can be system-created and therefore have no
  -- inviter. Preserve null rather than fabricating an actor identity.
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS collections (
  collection_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (owner_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS collections_tenant_owner_idx ON collections(tenant_id, owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, case_id),
  FOREIGN KEY (collection_id) REFERENCES collections(collection_id)
);

CREATE TABLE IF NOT EXISTS saved_searches (
  saved_search_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  query_json TEXT NOT NULL CHECK(json_valid(query_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (owner_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS immi_refresh_sessions (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT,
  replaced_by_jti TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS refresh_sessions_user_active_idx ON immi_refresh_sessions(user_id, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS council_sessions (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  case_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  retrieve_code TEXT UNIQUE,
  total_turns INTEGER NOT NULL DEFAULT 0 CHECK(total_turns >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS council_sessions_tenant_updated_idx ON council_sessions(tenant_id, updated_at DESC, session_id DESC);
CREATE TABLE IF NOT EXISTS council_turns (
  turn_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL CHECK(turn_index >= 0),
  role TEXT NOT NULL,
  payload_key TEXT NOT NULL UNIQUE,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  payload_size INTEGER NOT NULL CHECK(payload_size >= 0),
  payload_content_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, turn_index),
  FOREIGN KEY (session_id) REFERENCES council_sessions(session_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
);
CREATE INDEX IF NOT EXISTS council_turns_tenant_session_idx ON council_turns(tenant_id, session_id, turn_index);
