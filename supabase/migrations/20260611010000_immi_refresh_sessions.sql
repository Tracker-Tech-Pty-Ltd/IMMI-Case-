-- Migration: stateful refresh-token sessions for Worker-issued JWT auth.
--
-- The refresh JWT jti maps to this table. Refresh tokens are single-use:
-- refresh inserts the replacement jti, then revokes the old row in the same
-- transaction. Logout revokes the currently presented jti.

CREATE TABLE IF NOT EXISTS immi_refresh_sessions (
  jti             uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES immi_users(id) ON DELETE CASCADE,
  family_id       uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  revoked_reason  text,
  replaced_by_jti uuid REFERENCES immi_refresh_sessions(jti)
);

CREATE INDEX IF NOT EXISTS immi_refresh_sessions_user_active_idx
  ON immi_refresh_sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS immi_refresh_sessions_family_active_idx
  ON immi_refresh_sessions(family_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS immi_refresh_sessions_expiry_idx
  ON immi_refresh_sessions(expires_at);

COMMENT ON TABLE immi_refresh_sessions IS
  'Server-owned refresh-token session state for IMMI Worker auth. jti is the refresh JWT id.';

ALTER TABLE immi_refresh_sessions ENABLE ROW LEVEL SECURITY;
