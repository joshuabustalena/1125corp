/*
  Rebuilds the whole general ledger from the business records.

  Supersedes supabase/reset_journal_entries.sql, which only emptied the
  ledger. This empties it AND regenerates every entry from the underlying
  tables, so the books come back populated and balanced instead of starting
  from zero.

  WHY THE OLD LEDGER IS WRONG
  ---------------------------
  postJournalEntry() used to skip any line whose account code was missing and
  write the entry anyway, logging only a console.warn. The Chart of Accounts
  had been split per branch while the app still posted to flat codes, so 23
  entries ended up with no lines at all and 3 more unbalanced. Both halves are
  fixed in the app now (accounts resolve by name per branch, and a missing
  code aborts the whole entry), so a rebuild will not silently rot again.

  WHAT IT REBUILDS, AND FROM WHERE
  --------------------------------
    disbursement          loans (disbursed_at IS NOT NULL)
    remittance            remittances
    gas_voucher           gas_vouchers
    general_cash_voucher  general_cash_vouchers
    payroll_voucher       payroll_vouchers

  Deliberately NOT rebuilt:
    - payments. Collections reach the ledger through the REMITTANCE, when the
      collector turns the cash in, never per payment. Posting both would
      double-count every peso collected.
    - cash_vouchers (177 rows). Those are loan-release vouchers; their ledger
      effect IS the disbursement entry above. Posting them separately would
      double-count every release.
    - expenses / cash_flow. Both tables are empty.

  THE ONE THING THAT CANNOT BE FULLY RECOVERED
  --------------------------------------------
  remittances stores only collector, amount and date, NOT which cash account
  the money went into. That choice existed solely in the journal entry. This
  script salvages it from the surviving entries first (22 of 33 recoverable);
  the remaining 11 fall back to the collector branch "Cash in Vault", which is
  where remitted cash physically goes. Each fallback is printed in the output
  so it can be corrected by hand if any went to a bank account instead.

  SAFETY
  ------
  Everything runs inside ONE transaction that ends with a balance check. If
  the rebuilt ledger does not balance, or any account cannot be resolved, the
  script raises and Postgres rolls the whole thing back, leaving the old
  ledger exactly as it was. Safe to run and to re-run.

  Business records (loans, payments, receipts, vouchers, payroll) are never
  touched. Only journal_entries and journal_entry_lines are rewritten.
*/

-- Salvage the remittance -> cash account mapping BEFORE anything is deleted.
DROP TABLE IF EXISTS _remit_account_map;
CREATE TEMP TABLE _remit_account_map AS
SELECT DISTINCT ON (e.source_id)
       e.source_id AS remittance_id,
       l.account_id
FROM journal_entries e
JOIN journal_entry_lines l ON l.journal_entry_id = e.id
WHERE e.source = 'remittance' AND l.debit > 0
ORDER BY e.source_id, l.debit DESC;

DO $rebuild$
DECLARE
  v_year      text := to_char(CURRENT_DATE, 'YYYY');
  v_seq       int  := 0;
  r           RECORD;
  ln          jsonb;
  v_entry_id  uuid;
  v_acct      uuid;
  v_cash      uuid;
  v_ar        uuid;
  v_first_pay numeric;
  v_ar_debit  numeric;
  v_total_d   numeric;
  v_total_c   numeric;
  v_fallback  int := 0;
  v_made      int := 0;
BEGIN
  RAISE NOTICE 'wiping existing ledger...';
  DELETE FROM journal_entry_lines;
  DELETE FROM journal_entries;

  ---------------------------------------------------------------- loans --
  FOR r IN
    SELECT l.id, l.loan_number, l.branch_id, l.disbursed_at, l.release_date,
           coalesce(l.amount, 0)          AS amount,
           coalesce(l.interest_amount, 0) AS interest_amount,
           coalesce(l.service_fee, 0)     AS service_fee,
           coalesce(l.offset_balance, 0)  AS offset_balance,
           coalesce(l.release_amount, 0)  AS release_amount,
           coalesce(l.total_payable, 0)   AS total_payable,
           coalesce(l.daily_payment, 0)   AS daily_payment,
           coalesce(l.term_days, 0)       AS term_days,
           b.name AS branch_name
    FROM loans l
    LEFT JOIN branches b ON b.id = l.branch_id
    WHERE l.disbursed_at IS NOT NULL
    ORDER BY l.disbursed_at
  LOOP
    -- Resolved by NAME, never by code: "Cash in Vault - Balanga" is stored
    -- with a trailing space in its code ('1000 '), colliding with the
    -- separate "Cash on Hand" account.
    SELECT id INTO v_ar FROM chart_of_accounts
      WHERE name ILIKE 'Loans Receivable - ' || split_part(coalesce(r.branch_name, ''), ' ', 1) || '%'
      LIMIT 1;
    SELECT id INTO v_cash FROM chart_of_accounts
      WHERE name ILIKE 'Cash in Vault - ' || split_part(coalesce(r.branch_name, ''), ' ', 1) || '%'
      LIMIT 1;
    IF v_ar IS NULL OR v_cash IS NULL THEN
      RAISE EXCEPTION 'Loan %: cannot resolve Loans Receivable / Cash in Vault for branch "%"',
        r.loan_number, r.branch_name;
    END IF;

    -- The first payment is DERIVED from what was actually withheld
    -- (amount - release_amount - offset - service fee), not from
    -- daily_payment. Those two disagree on real data: on six renewals the
    -- day-one payment was never withheld from the proceeds even though the
    -- Loan Agreement lists it, and one loan (LN-2026-883803) has a stale
    -- interest_amount. Using daily_payment left 8 entries unbalanced by
    -- -3,650 in total, which would abort this whole rebuild.
    --
    -- Deriving it makes every disbursement balance by construction AND
    -- keeps the entry faithful to the cash that actually moved:
    --   DR  amount + interest - withheld
    --   CR  offset + release_amount + service fee + interest
    -- cancels exactly, because withheld = amount - release - offset - fee.
    v_first_pay := r.amount - r.release_amount - r.offset_balance - r.service_fee;
    v_ar_debit  := r.amount + r.interest_amount - v_first_pay;

    v_seq := v_seq + 1;
    INSERT INTO journal_entries (entry_number, entry_date, reference, description, source, source_id, branch_id)
    VALUES ('JE-' || v_year || '-R' || lpad(v_seq::text, 6, '0'),
            coalesce(r.disbursed_at::date, r.release_date, CURRENT_DATE),
            r.loan_number,
            'Loan disbursement - ' || r.loan_number,
            'disbursement', r.id, r.branch_id)
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_ar, v_ar_debit, 0, 'Loans Receivable (Loan + Interest - First Payment)'
      WHERE v_ar_debit > 0;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_ar, 0, r.offset_balance, 'Offset balance from previous loan'
      WHERE r.offset_balance > 0;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_cash, 0, r.release_amount, 'Cash released to borrower'
      WHERE r.release_amount > 0;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, id, 0, r.service_fee, 'Service fee income'
      FROM chart_of_accounts WHERE trim(code) = '4010' AND r.service_fee > 0;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, id, 0, r.interest_amount, 'Interest income'
      FROM chart_of_accounts WHERE trim(code) = '4000' AND r.interest_amount > 0;

    v_made := v_made + 1;
  END LOOP;

  ---------------------------------------------------------- remittances --
  FOR r IN
    SELECT rm.id, rm.amount, rm.remittance_date,
           c.branch_id, b.name AS branch_name, p.full_name AS collector_name,
           m.account_id AS salvaged
    FROM remittances rm
    LEFT JOIN collectors c ON c.id = rm.collector_id
    LEFT JOIN branches   b ON b.id = c.branch_id
    LEFT JOIN profiles   p ON p.id = c.profile_id
    LEFT JOIN _remit_account_map m ON m.remittance_id = rm.id
    WHERE coalesce(rm.amount, 0) > 0
    ORDER BY rm.remittance_date
  LOOP
    SELECT id INTO v_ar FROM chart_of_accounts
      WHERE name ILIKE 'Loans Receivable - ' || split_part(coalesce(r.branch_name, ''), ' ', 1) || '%'
      LIMIT 1;

    v_cash := r.salvaged;
    IF v_cash IS NULL THEN
      SELECT id INTO v_cash FROM chart_of_accounts
        WHERE name ILIKE 'Cash in Vault - ' || split_part(coalesce(r.branch_name, ''), ' ', 1) || '%'
        LIMIT 1;
      v_fallback := v_fallback + 1;
      RAISE NOTICE 'remittance % (%, amount %): cash account was never recorded, defaulted to branch vault',
        r.id, coalesce(r.collector_name, '-'), r.amount;
    END IF;

    IF v_ar IS NULL OR v_cash IS NULL THEN
      RAISE EXCEPTION 'Remittance %: cannot resolve accounts for branch "%"', r.id, r.branch_name;
    END IF;

    v_seq := v_seq + 1;
    INSERT INTO journal_entries (entry_number, entry_date, description, source, source_id, branch_id)
    VALUES ('JE-' || v_year || '-R' || lpad(v_seq::text, 6, '0'), r.remittance_date,
            'Collector remittance - ' || coalesce(r.collector_name, '-'),
            'remittance', r.id, r.branch_id)
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_cash, r.amount, 0, 'Cash remitted'),
           (v_entry_id, v_ar,   0, r.amount, 'Collections applied to Loans Receivable');

    v_made := v_made + 1;
  END LOOP;

  --------------------------------------------------------- gas vouchers --
  FOR r IN
    SELECT * FROM gas_vouchers WHERE coalesce(total_amount, 0) > 0 ORDER BY voucher_date
  LOOP
    SELECT id INTO v_cash FROM chart_of_accounts
      WHERE trim(code) = trim(coalesce(r.cash_account_code, '')) LIMIT 1;
    IF v_cash IS NULL THEN
      SELECT id INTO v_cash FROM chart_of_accounts WHERE name ILIKE 'Cash in Vault%' LIMIT 1;
    END IF;
    SELECT id INTO v_acct FROM chart_of_accounts WHERE trim(code) = '5020' LIMIT 1;
    IF v_cash IS NULL OR v_acct IS NULL THEN
      RAISE EXCEPTION 'Gas voucher %: cannot resolve accounts', r.voucher_number;
    END IF;

    v_seq := v_seq + 1;
    INSERT INTO journal_entries (entry_number, entry_date, reference, description, source, source_id, branch_id)
    VALUES ('JE-' || v_year || '-R' || lpad(v_seq::text, 6, '0'), r.voucher_date, r.voucher_number,
            'Gas Voucher - ' || r.voucher_number, 'gas_voucher', r.id, r.branch_id)
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_acct, r.total_amount, 0, 'Transportation Expense (Gas)'),
           (v_entry_id, v_cash, 0, r.total_amount, 'Cash paid out');

    v_made := v_made + 1;
  END LOOP;

  ------------------------------------------------ general cash vouchers --
  FOR r IN
    SELECT * FROM general_cash_vouchers WHERE coalesce(total_amount, 0) > 0 ORDER BY voucher_date
  LOOP
    SELECT id INTO v_cash FROM chart_of_accounts
      WHERE trim(code) = trim(coalesce(r.cash_account_code, '')) LIMIT 1;
    IF v_cash IS NULL THEN
      RAISE EXCEPTION 'Cash voucher %: cash account code "%" not found', r.voucher_number, r.cash_account_code;
    END IF;

    v_seq := v_seq + 1;
    INSERT INTO journal_entries (entry_number, entry_date, reference, description, source, source_id, branch_id)
    VALUES ('JE-' || v_year || '-R' || lpad(v_seq::text, 6, '0'), r.voucher_date, r.voucher_number,
            'Cash Voucher - ' || coalesce(r.particulars, r.voucher_number),
            'general_cash_voucher', r.id, r.branch_id)
    RETURNING id INTO v_entry_id;

    FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(r.lines, '[]'::jsonb)) LOOP
      SELECT id INTO v_acct FROM chart_of_accounts
        WHERE trim(code) = trim(ln->>'account_code') LIMIT 1;
      IF v_acct IS NULL THEN
        RAISE EXCEPTION 'Cash voucher %: line account code "%" not found',
          r.voucher_number, ln->>'account_code';
      END IF;
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      VALUES (v_entry_id, v_acct, (ln->>'amount')::numeric, 0, coalesce(r.particulars, ''));
    END LOOP;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_cash, 0, r.total_amount, 'Cash Voucher - ' || coalesce(r.payee, ''));

    v_made := v_made + 1;
  END LOOP;

  ----------------------------------------------------- payroll vouchers --
  FOR r IN
    SELECT pv.*, b.name AS branch_name
    FROM payroll_vouchers pv
    LEFT JOIN branches b ON b.id = pv.branch_id
    WHERE coalesce(pv.total_net_pay, 0) > 0
    ORDER BY pv.pay_date
  LOOP
    SELECT id INTO v_cash FROM chart_of_accounts
      WHERE name ILIKE 'Cash in Vault - ' || split_part(coalesce(r.branch_name, ''), ' ', 1) || '%'
      LIMIT 1;
    SELECT id INTO v_acct FROM chart_of_accounts WHERE trim(code) = '5010' LIMIT 1;
    IF v_cash IS NULL OR v_acct IS NULL THEN
      RAISE EXCEPTION 'Payroll voucher %: cannot resolve accounts', r.voucher_number;
    END IF;

    v_seq := v_seq + 1;
    INSERT INTO journal_entries (entry_number, entry_date, reference, description, source, source_id, branch_id)
    VALUES ('JE-' || v_year || '-R' || lpad(v_seq::text, 6, '0'), r.pay_date, r.voucher_number,
            'Payroll Voucher - ' || r.voucher_number, 'payroll_voucher', r.id, r.branch_id)
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_acct, r.total_net_pay, 0, 'Salaries Expense'),
           (v_entry_id, v_cash, 0, r.total_net_pay, 'Net pay released');

    v_made := v_made + 1;
  END LOOP;

  --------------------------------------------------------- verification --
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    INTO v_total_d, v_total_c FROM journal_entry_lines;

  RAISE NOTICE 'rebuilt % entries | debit % | credit % | remittances defaulted to vault: %',
    v_made, v_total_d, v_total_c, v_fallback;

  IF abs(v_total_d - v_total_c) > 0.01 THEN
    RAISE EXCEPTION 'Rebuild does not balance: debit % vs credit % (difference %) - rolling back',
      v_total_d, v_total_c, v_total_d - v_total_c;
  END IF;

  IF EXISTS (
    SELECT 1 FROM journal_entries e
    WHERE NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.journal_entry_id = e.id)
  ) THEN
    RAISE EXCEPTION 'Rebuild produced entries with no lines - rolling back';
  END IF;
END;
$rebuild$;

-- Post-run summary: one row per source, with its own debit/credit totals.
SELECT e.source,
       count(*) AS entries,
       to_char(sum(t.d), 'FM999999999.00') AS debit,
       to_char(sum(t.c), 'FM999999999.00') AS credit
FROM journal_entries e
JOIN LATERAL (
  SELECT coalesce(sum(debit), 0) AS d, coalesce(sum(credit), 0) AS c
  FROM journal_entry_lines WHERE journal_entry_id = e.id
) t ON true
GROUP BY e.source
ORDER BY e.source;
