/*
  Balanga data fixes — Kat's Oct 19 2026 concerns. Run once; every
  statement is guarded so a re-run changes nothing.

  1. Cash Count Beginning/Ending stuck at ₱1,545 (Oct 10 – Oct 17)
     Balanga's Cash in Vault passed 1,000 journal lines, and the Cash Count
     page only read the first 1,000 (the oldest), so every count from Oct 10
     saved ₱1,545 and a Variance worked out from it. The page is fixed; this
     rewrites the saved counts with the real ledger balances. Variance =
     counted (vault + PCF) − (ending + PCF ending), as the page saves it.

     Includes moving the manual entry "WRITE OFF/LAO" (+₱300 to Cash in
     Vault, posted Oct 15) from 2026-01-15 to 2026-10-15 — the date looks
     mistyped. Dated in January it raised every October balance by ₱300;
     on Oct 15 the Oct 10/12/13 counts come out at exactly ₱0 variance. The
     figures below assume this move.

  2. Clarisa Agaid, LN-2026-909451 (released Oct 19)
     The Branch Manager raised the daily payment 450 → 500 at approval, but
     the release amount kept the collector's figure: ₱13,550 instead of
     ₱13,500 (20,000 − 600 fee − 5,400 offset − 500 first payment). The cash
     voucher 1-2174 copied the wrong figure. Its journal entry already posted
     the correct ₱13,500, so only the loan and voucher are corrected here.
     remaining_balance drops by the same ₱50 (23,200 − 500 = 22,700).
*/

-- 1a. Mistyped date on the manual entry
UPDATE journal_entries
SET entry_date = '2026-10-15'
WHERE description = 'WRITE OFF/LAO'
  AND entry_date = '2026-01-15'
  AND branch_id = 'b580f7f7-38d2-4817-be74-07e1261f3fd5';

-- 1b. Cash counts
UPDATE cash_counts c
SET beginning_balance = v.beginning,
    ending_balance    = v.ending,
    variance          = c.counted_amount - (v.ending + c.pcf_ending_balance)
FROM (VALUES
  ('2026-10-10'::date, 77020.00, 45864.00),
  ('2026-10-12'::date, 45864.00, 76924.00),
  ('2026-10-13'::date, 76924.00, 61784.00),
  ('2026-10-14'::date, 61784.00, 67524.00),
  ('2026-10-15'::date, 67524.00, 96339.00),
  ('2026-10-16'::date, 96339.00,  4524.00),
  ('2026-10-17'::date,  4524.00, 48319.00)
) AS v(count_date, beginning, ending)
WHERE c.count_date = v.count_date
  AND c.branch_id = 'b580f7f7-38d2-4817-be74-07e1261f3fd5'
  AND c.ending_balance = 1545.00;

-- 2. Agaid loan and its cash voucher
UPDATE loans
SET release_amount = 13500.00,
    remaining_balance = remaining_balance - 50
WHERE loan_number = 'LN-2026-909451'
  AND release_amount = 13550.00;

UPDATE cash_vouchers
SET amount = 13500.00
WHERE voucher_number = '1-2174'
  AND loan_id = '30fe71bc-7864-4de5-ab6b-37327b1f2593'
  AND amount = 13550.00;
