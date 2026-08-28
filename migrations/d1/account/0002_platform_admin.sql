-- IMMI_ACCOUNT_DB migration 0002: platform-operator grant.
--
-- Tenant `memberships.role` is self-granted: the Telegram signup flow inserts
-- role='owner' for the auto-created personal tenant, so it can never be
-- evidence of platform authority. This column is the separate, operator-only
-- signal that gates the global pipeline controls, the platform admin read and
-- shared-catalog case writes.
--
-- Defaults to 0 for every existing and future row: fail-closed. Grant with
--   UPDATE users SET platform_admin = 1 WHERE user_id = '<uuid>';
-- run by an operator through `wrangler d1 execute`.
ALTER TABLE users ADD COLUMN platform_admin INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS users_platform_admin_idx ON users(platform_admin);
