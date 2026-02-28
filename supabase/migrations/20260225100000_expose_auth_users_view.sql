-- Expose auth.users to PostgREST via a public view so the email intake
-- router can look up users by the first 8 chars of their UUID.
--
-- The service-role key bypasses RLS, so no additional policies are needed
-- for the supabase_admin client used in _lookup_user_by_short_id.
-- We intentionally expose only the columns needed for the lookup (id, email)
-- to minimise surface area.

CREATE OR REPLACE VIEW public.users AS
  SELECT id::text AS id, email, created_at
  FROM auth.users;
