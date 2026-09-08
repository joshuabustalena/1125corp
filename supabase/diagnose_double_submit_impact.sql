/*
  READ-ONLY audit — finds every loan/payment across the WHOLE system that
  shows the same fingerprint as the Analyn Celorico case (a rapid
  double-tap on Submit firing two apply_loan_payment calls with two
  different idempotency keys, each a genuinely separate attempt so
  neither's replay-protection caught the other). No data is changed by
  this file — share the results back before anything gets corrected.

  Three checks, each catching a different shape the same bug can leave:

  1. Loans whose current remaining_balance doesn't match what their own
     MOST RECENT payment recorded — the fingerprint of a "phantom" extra
     deduction that never got its own payment/receipt row (what happened
     to Analyn Celorico: the RPC decremented the balance a second time,
     but the follow-up receipt/payment insert for that second attempt
     never completed, so nothing else looked wrong except this one number).

  2. Every individual payment, system-wide, where the balance math between
     it and the payment immediately before it (same loan) doesn't add up —
     broader net than #1, catches it even for a loan whose CURRENT balance
     happens to look fine (e.g. a later real payment coincidentally masked
     the gap).

  3. Actual duplicate-looking payment ROWS — same loan, same amount, within
     2 minutes of each other. Only these would have inflated a collector's
     "Collected" total (loadData() in remittance/page.tsx sums
     payments.amount_paid directly) and, if a Cashier already remitted
     based on that total, the general ledger's Cash/Loans Receivable too.
     Cases like Analyn Celorico's do NOT show up here — no duplicate ROW
     was created there, only the extra balance deduction was — so #3 being
     empty does not mean #1/#2 are also empty, and vice versa.
*/

-- 1. Loans where the stored balance disagrees with the most recent payment.
SELECT
  l.id AS loan_id, l.loan_number, c.first_name, c.last_name, c.phone,
  l.remaining_balance AS loan_balance,
  lastpay.remaining_balance AS last_payment_balance,
  l.remaining_balance - lastpay.remaining_balance AS unexplained_difference
FROM loans l
JOIN customers c ON c.id = l.customer_id
JOIN LATERAL (
  SELECT p.remaining_balance
  FROM payments p
  WHERE p.loan_id = l.id
  ORDER BY p.payment_date DESC, p.payment_time DESC NULLS LAST, p.created_at DESC
  LIMIT 1
) lastpay ON true
WHERE abs(l.remaining_balance - lastpay.remaining_balance) > 0.01
ORDER BY abs(l.remaining_balance - lastpay.remaining_balance) DESC;

-- 2. Every payment, system-wide, whose own recorded balance doesn't match
--    (previous payment's balance - this payment's amount) for the same loan.
WITH ordered AS (
  SELECT p.*,
    LAG(p.remaining_balance) OVER (
      PARTITION BY p.loan_id ORDER BY p.payment_date, p.payment_time NULLS FIRST, p.created_at
    ) AS prev_balance
  FROM payments p
)
SELECT
  o.loan_id, l.loan_number, c.first_name, c.last_name,
  o.id AS payment_id, o.payment_date, o.amount_paid,
  o.prev_balance, o.remaining_balance AS recorded_balance,
  (o.prev_balance - o.amount_paid) AS expected_balance,
  o.remaining_balance - (o.prev_balance - o.amount_paid) AS discrepancy
FROM ordered o
JOIN loans l ON l.id = o.loan_id
JOIN customers c ON c.id = o.customer_id
WHERE o.prev_balance IS NOT NULL
  AND abs(o.remaining_balance - (o.prev_balance - o.amount_paid)) > 0.01
ORDER BY o.payment_date DESC;

-- 3. Actual duplicate-looking payment rows (same loan, same amount, <2 min
--    apart) — these are the only ones that could have inflated a
--    collector's Collected total or a remittance/the ledger.
SELECT
  p1.id AS payment1_id, p2.id AS payment2_id, l.loan_number,
  c.first_name, c.last_name, p1.amount_paid,
  p1.created_at AS first_created_at, p2.created_at AS second_created_at,
  EXTRACT(EPOCH FROM (p2.created_at - p1.created_at)) AS seconds_apart
FROM payments p1
JOIN payments p2 ON p2.loan_id = p1.loan_id
  AND p2.id > p1.id
  AND p2.amount_paid = p1.amount_paid
  AND abs(EXTRACT(EPOCH FROM (p2.created_at - p1.created_at))) < 120
JOIN loans l ON l.id = p1.loan_id
JOIN customers c ON c.id = p1.customer_id
ORDER BY p1.created_at DESC;
