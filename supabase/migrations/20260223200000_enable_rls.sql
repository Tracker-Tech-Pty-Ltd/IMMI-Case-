-- Enable Row Level Security on immigration_cases table
-- Prevents direct client-side data manipulation via anon key
ALTER TABLE immigration_cases ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read cases (public data)
CREATE POLICY "allow_public_read" ON immigration_cases
    FOR SELECT USING (true);

-- Only service_role can insert new cases
CREATE POLICY "deny_anon_insert" ON immigration_cases
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Only service_role can update cases
CREATE POLICY "deny_anon_update" ON immigration_cases
    FOR UPDATE USING (auth.role() = 'service_role');

-- Only service_role can delete cases
CREATE POLICY "deny_anon_delete" ON immigration_cases
    FOR DELETE USING (auth.role() = 'service_role');
