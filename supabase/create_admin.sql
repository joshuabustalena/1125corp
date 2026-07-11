/*
  Admin account setup — two steps.

  Step 1 (do this in the Supabase Dashboard, not SQL):
    Authentication -> Users -> Add user -> Create new user
      Email: admin@1125corp.org
      Password: admin1125corp
      Check "Auto Confirm User"

  Manually inserting rows into auth.users via SQL is unreliable — GoTrue
  (Supabase's auth service) expects extra bookkeeping (a matching
  auth.identities row, specific token defaults) that a raw INSERT doesn't
  set up correctly, which is what caused the "Database error querying
  schema" login failure. Creating the user through the Dashboard lets
  Supabase's own Auth service do this correctly.

  Step 2: run this in the SQL Editor to link the new user to the
  Administrator role.
*/

INSERT INTO profiles (id, email, full_name, role_id, status)
SELECT u.id, u.email, 'System Administrator', r.id, 'active'
FROM auth.users u, roles r
WHERE u.email = 'admin@1125corp.org' AND r.name = 'Administrator';
