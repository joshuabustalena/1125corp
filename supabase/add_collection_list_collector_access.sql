/*
  Kat's Sep 11 request: give Branch Field Collectors access to the
  Collection List (their own area's printable worksheet only — see
  app/(app)/collection-list/page.tsx for the matching code change that
  locks it to their own area, same as the collector's own filter lock
  already used on /reports).

  Currently no role except Administrator ('*') has 'collection_list' in
  the seed data, so this route is otherwise Admin/Cashier-only (the page
  also hard-checks role_name === 'Cashier' alongside isAdmin — the code
  change adds Branch Field Collector to that same check).

  Appends the permission without touching whatever else is already on the
  role (a plain overwrite would silently strip any customization made
  since the Aug 2026 seed via the Roles settings UI) — a no-op if it's
  already there.

  Safe to re-run.
*/

UPDATE roles
SET permissions = permissions || '["collection_list"]'::jsonb
WHERE name = 'Branch Field Collector'
  AND NOT (permissions ? 'collection_list');
