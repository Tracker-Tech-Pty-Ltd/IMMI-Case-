-- Fix UPDATE policy: add WITH CHECK clause to prevent anon from writing new row values
DROP POLICY IF EXISTS "deny_anon_update" ON immigration_cases;

CREATE POLICY "deny_anon_update" ON immigration_cases
    FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
