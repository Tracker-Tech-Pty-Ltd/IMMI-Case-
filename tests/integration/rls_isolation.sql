-- RLS Isolation Test Suite — AC5, AC9, AC10
-- Verifies Supabase Row Level Security correctly isolates tenant data.
--
-- Usage:
--   psql "$SUPABASE_DB_URL" -f tests/integration/rls_isolation.sql
--
-- Requires service-role connection (bypasses RLS for setup/teardown).
-- All test data is cleaned up via ROLLBACK at the end.
--
-- PASS = script completes with "All AC tests passed" message.
-- FAIL = script aborts with ASSERT error showing which AC failed.

BEGIN;

DO $$
DECLARE
  v_user_a   uuid;
  v_user_b   uuid;
  v_tenant_a uuid;
  v_tenant_b uuid;
  v_col_id   uuid;
  v_count    int;
  v_rowcount int;
  v_claims_a text;
  v_claims_b text;
BEGIN

  -- ── Setup ──────────────────────────────────────────────────────────────────

  INSERT INTO users (telegram_id, first_name, last_login_at)
    VALUES (9900000001, '_autotest_A', NOW())
    RETURNING id INTO v_user_a;

  INSERT INTO users (telegram_id, first_name, last_login_at)
    VALUES (9900000002, '_autotest_B', NOW())
    RETURNING id INTO v_user_b;

  INSERT INTO tenants (kind, name)
    VALUES ('individual', '_autotest_tenant_A')
    RETURNING id INTO v_tenant_a;

  INSERT INTO tenants (kind, name)
    VALUES ('individual', '_autotest_tenant_B')
    RETURNING id INTO v_tenant_b;

  INSERT INTO tenant_members (user_id, tenant_id, role)
    VALUES (v_user_a, v_tenant_a, 'owner'),
           (v_user_b, v_tenant_b, 'owner');

  INSERT INTO collections (name, tenant_id, created_by)
    VALUES ('_autotest_collection_A', v_tenant_a, v_user_a)
    RETURNING id INTO v_col_id;

  -- ── JWT claims strings ──────────────────────────────────────────────────────

  v_claims_a := json_build_object(
    'sub',       v_user_a,
    'tenant_id', v_tenant_a,
    'tenants',   json_build_array(v_tenant_a),
    'role',      'owner'
  )::text;

  v_claims_b := json_build_object(
    'sub',       v_user_b,
    'tenant_id', v_tenant_b,
    'tenants',   json_build_array(v_tenant_b),
    'role',      'owner'
  )::text;

  -- ── AC5: Cross-tenant SELECT isolation ─────────────────────────────────────

  PERFORM set_config('request.jwt.claims', v_claims_b, true);

  SELECT COUNT(*) INTO v_count FROM collections WHERE id = v_col_id;

  ASSERT v_count = 0,
    FORMAT('AC5 FAIL: Tenant B can SELECT tenant A collection (id=%s)', v_col_id);

  RAISE NOTICE 'AC5 PASS: Cross-tenant SELECT isolation verified';

  -- ── AC9: Cross-tenant UPDATE isolation ─────────────────────────────────────

  UPDATE collections SET name = '_autotest_HACKED' WHERE id = v_col_id;
  GET DIAGNOSTICS v_rowcount = ROW_COUNT;

  -- v_rowcount = 0 proves RLS blocked the UPDATE (not just that name didn't change)
  ASSERT v_rowcount = 0,
    FORMAT('AC9 FAIL: Tenant B could UPDATE tenant A collection — %s row(s) affected (id=%s)', v_rowcount, v_col_id);

  RAISE NOTICE 'AC9 PASS: Cross-tenant UPDATE isolation verified';

  -- ── AC10: Empty canary tenant returns 0 rows ────────────────────────────────

  SELECT COUNT(*) INTO v_count FROM collections WHERE tenant_id = v_tenant_b;

  ASSERT v_count = 0,
    FORMAT('AC10 FAIL: Canary tenant B unexpectedly has %s collection rows', v_count);

  RAISE NOTICE 'AC10 PASS: Canary tenant returns 0 rows verified';

  -- ── AC5b: Tenant A can still read own data ──────────────────────────────────

  PERFORM set_config('request.jwt.claims', v_claims_a, true);

  SELECT COUNT(*) INTO v_count FROM collections WHERE id = v_col_id;

  ASSERT v_count = 1,
    FORMAT('AC5b FAIL: Tenant A cannot read its own collection (id=%s)', v_col_id);

  RAISE NOTICE 'AC5b PASS: Tenant A self-read verified';

  RAISE NOTICE '============================================';
  RAISE NOTICE 'All AC5/AC9/AC10 tests passed';
  RAISE NOTICE '============================================';

END;
$$;

ROLLBACK;
