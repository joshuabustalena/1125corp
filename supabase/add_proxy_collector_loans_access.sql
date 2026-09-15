/*
  Kat's Sep 2026 report, traced to ground: Lucily De Guzman's payment
  (LN-2026-953666) failed to sync with "new row violates row-level
  security policy for table 'loans'" — 100% reproducible, not intermittent,
  because the collector posting it was on "proxy collector access."

  'Branch Proxy Collector' ("Supervisor covering collections across all
  areas") is a real, fully-seeded role — it already has the payments/loans/
  receipts permissions needed to use Payment Collection at the app-permission
  layer (see the roles seed a few hundred lines down in the core schema
  migration). But apply_loan_payment runs SECURITY INVOKER, so its UPDATE on
  loans (crediting the payment against remaining_balance) still goes through
  RLS as that user — and loans_update's WITH CHECK only ever listed
  ('Branch Field Collector', 'Branch Manager', 'Cashier'). This role was
  simply never added when it was created; every payment a Proxy Collector
  has ever tried to post against a loan has failed here, every time,
  regardless of connection quality or session freshness — the "row-level
  security policy" text was the real, literal cause the whole time, not a
  stale-session symptom of it.

  payments/receipts (the two other tables a collection touches) were
  already unrestricted by role (WITH CHECK (true)), so this is the one and
  only gap — see the migration comment trail in table_policies.sql /
  fix_cashier_loan_insert.sql / rename_collector_role.sql, which all
  re-created this same policy over time and all repeated the same omission.

  loans_insert gets the same addition for consistency — a Proxy Collector's
  seeded permissions include "loans", and covering for an absent collector
  plausibly includes submitting an application on a customer's behalf too.

  Safe to re-run.
*/

DROP POLICY IF EXISTS "loans_insert" ON loans;
CREATE POLICY "loans_insert" ON loans FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR current_role_name() IN ('Branch Field Collector', 'Branch Proxy Collector', 'Branch Manager'));

DROP POLICY IF EXISTS "loans_update" ON loans;
CREATE POLICY "loans_update" ON loans FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (is_admin() OR current_role_name() IN ('Branch Field Collector', 'Branch Proxy Collector', 'Branch Manager', 'Cashier'));
