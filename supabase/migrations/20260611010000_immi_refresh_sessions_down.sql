-- Rollback for 20260611010000_immi_refresh_sessions.sql.
-- Dropping this table invalidates all refresh-token sessions.

DROP TABLE IF EXISTS immi_refresh_sessions;
