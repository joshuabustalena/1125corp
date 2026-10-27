/*
  Undo the payment move from Transfer Customers (Oct 24–26 2026).

  Marcelino Baronia Jr.'s 96 customers were transferred Marcelino → Gerchel
  Escaler → (a collector since deleted) → Rovic Joseph Penullar → Mc Claude
  Ajero. Each transfer also moved every payment Marcelino had ever
  collected — 1,098 payments, ₱459,710, Sep 10 – Oct 24 — but not his
  remittances, which total exactly ₱459,710: he had remitted all of it. So
  Remittance showed Mc Claude owing ₱469,200 that was never his.

  On Oct 27 Julie Ann recorded a ₱476,070 remittance for Mc Claude to clear
  it, balancing the ₱459,710 that didn't exist through Cash Short/Over. That
  credited Loans Receivable ₱459,710 too much and booked a ₱459,710 cash
  shortage that never happened.

  1. The 1,098 payments go back to Marcelino (identified by the audit log
     of the first transfer, Oct 24 12:11 UTC). Marcelino: ₱459,710 collected
     − ₱459,710 remitted = ₱0 owed.
  2. The Oct 27 remittance drops by the same ₱459,710 to ₱16,360, and its
     journal entry JE-2026-285346 with it: Cash Short/Over ₱469,750 →
     ₱10,040, Loans Receivable credit ₱476,070 → ₱16,360. The real cash
     lines (Cash in Vault ₱5,620, GCash ₱700) are untouched, and so is the
     remaining ₱10,040 short Julie Ann recorded — that one is for Kat to
     confirm.

  Guarded: every statement only matches the exact current values, so a
  re-run changes nothing. The page fix stops Transfer Customers moving
  payments from now on.
*/

-- 1. Payments back to the collector who collected them
UPDATE payments
SET collector_id = '940d54d0-af9a-44cb-8fdb-a21d45629836'          -- Marcelino Baronia Jr.
WHERE collector_id = '5a8629a2-ab68-4804-93df-411ed509dc53'        -- Mc Claude Ajero
  AND id IN (
    SELECT entity_id::uuid FROM audit_logs
    WHERE entity_type = 'payments'
      AND action = 'edit'
      AND created_at >= '2026-10-24 12:00:00+00'
      AND created_at <  '2026-10-24 12:12:00+00'
      AND details->'before'->>'collector_id' = '940d54d0-af9a-44cb-8fdb-a21d45629836'
  );

-- 2. The Oct 27 remittance and its journal entry, less the ₱459,710
UPDATE remittances
SET amount = 16360.00
WHERE id = '6de0b0d9-878a-47f8-8889-84d8e704674e'
  AND amount = 476070.00;

UPDATE journal_entry_lines l
SET debit = 10040.00
FROM journal_entries e, chart_of_accounts a
WHERE l.journal_entry_id = e.id AND l.account_id = a.id
  AND e.entry_number = 'JE-2026-285346'
  AND a.code = '10010'                 -- Cash Short/Over
  AND l.debit = 469750.00;

UPDATE journal_entry_lines l
SET credit = 16360.00
FROM journal_entries e, chart_of_accounts a
WHERE l.journal_entry_id = e.id AND l.account_id = a.id
  AND e.entry_number = 'JE-2026-285346'
  AND a.code = '1100'                  -- Loans Receivable (Balanga)
  AND l.credit = 476070.00;
