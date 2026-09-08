/*
  Rebuilds the whole general ledger from the business records.

  Supersedes supabase/reset_journal_entries.sql, which only emptied the
  ledger. This empties it AND regenerates every entry from the underlying
  tables, so the books come back populated and balanced instead of starting
  from zero.

  WHY THE OLD LEDGER IS WRONG (as of Sept 2026)
  ----------------------------------------------
  Two separate historical problems, discovered while chasing a Trial
  Balance / Balance Sheet mismatch:
    1. postJournalEntry() used to skip any line whose account code was
       missing and write the entry anyway, logging only a console.warn —
       long since fixed (a missing code now aborts the whole entry), but
       the damage from when it was live is still sitting in the ledger:
       23 entries with no lines at all, 3 more unbalanced, and — found via
       a fresh audit this time — 173 disbursed loans with NO
       'disbursement' journal entry at all, leaving the ledger's "Loans
       Receivable" (₱7.28M) badly overstated against the real outstanding
       balance on the loans themselves (₱3.37M).
    2. This rebuild script itself had drifted from the live app: it still
       resolved accounts by the OLD "<Name> - <Branch>" suffix convention
       and several flat, Balanga-only codes ('4000', '4010', '5020') for
       accounts the app moved to branch_id-based resolution (see
       lib/branch-accounts.ts) months ago, and it never learned about the
       Incentives Expense / Withheld Funds Payable payroll lines or the
       13th Month Voucher entry at all. Running the OLD version of this
       script today would have replaced a wrong ledger with a DIFFERENTLY
       wrong one. Rewritten below to mirror the live TypeScript exactly —
       same base account names, same branch resolution order, same line
       sets — rather than drift again next time the app changes.

  WHAT IT REBUILDS, AND FROM WHERE
  --------------------------------
    disbursement           loans (disbursed_at IS NOT NULL)
    remittance              remittances
    gas_voucher             gas_vouchers
    general_cash_voucher    general_cash_vouchers
    payroll_voucher         payroll_vouchers (+ the payroll rows each one's
                             saved `lines` point back to, for the SSS/
                             PhilHealth/PagIBIG/Service Vehicle/Uniform/
                             Cash Shortage/Employee Loan/Incentive/
                             Withheld Funds breakdown — see
                             app/(app)/payroll/page.tsx handleGenerateVoucher)
    thirteenth_month_voucher thirteenth_month_vouchers (new section — this
                             table's own total_net_pay is already the final
                             figure, no further joins needed)

  Deliberately NOT rebuilt:
    - payments. Collections reach the ledger through the REMITTANCE, when
      the collector turns the cash in, never per payment. Posting both
      would double-count every peso collected.
    - cash_vouchers (loan-release vouchers). Their ledger effect IS the
      disbursement entry above. Posting them separately would double-count
      every release.
    - expenses / cash_flow. Both tables are empty as of this writing.

  ACCOUNT RESOLUTION — matches lib/branch-accounts.ts exactly
  -------------------------------------------------------------
  resolve_branch_account(base_name, branch_id, branch_name), defined below,
  mirrors resolveBranchAccountCode()'s three-step precedence: (1) this
  branch's own account by branch_id + name prefix, (2) the legacy
  "<base_name> - <Branch>" suffix form for any account not yet cleaned up,
  (3) a shared/company-wide account (branch_id IS NULL). Used everywhere an
  account is resolved by name in this script, instead of hand-rolling the
  lookup (or hardcoding a code) per section, so this can't drift from the
  live app's own resolver again without both being caught the same way.

  THE ONE THING THAT CANNOT BE FULLY RECOVERED
  --------------------------------------------
  remittances stores only collector, amount and date, NOT which cash
  account the money went into. That choice existed solely in the journal
  entry. This script salvages it from the surviving entries first; any
  remittance whose mapping can't be salvaged falls back to the collector's
  branch "Cash in Vault", which is where remitted cash physically goes.
  Each fallback is printed in the output so it can be corrected by hand if
  any went to a bank account instead.

  SAFETY
  ------
  Everything runs inside ONE transaction that ends with a balance check. If
  the rebuilt ledger does not balance, or any account cannot be resolved,
  the script raises and Postgres rolls the whole thing back, leaving the
  old ledger exactly as it was. Safe to run and to re-run.

  Business records (loans, payments, receipts, vouchers, payroll) are never
  touched. Only journal_entries and journal_entry_lines are rewritten.

  BEFORE RUNNING: back up journal_entries and journal_entry_lines (a
  `create table journal_entries_backup_20260907 as table journal_entries;`
  and the same for journal_entry_lines takes a few seconds and costs
  nothing) — this rewrites the company's entire ledger history, and while
  the transaction/balance-check makes a bad run roll back automatically,
  a backup is the difference between "roll back" and "we're sure."
*/

-- One resolver, reused everywhere — see the big comment above.
CREATE OR REPLACE FUNCTION resolve_branch_account(
  p_base_name text,
  p_branch_id uuid,
  p_branch_name text
) RETURNS uuid AS $$
DECLARE
  v_id uuid;
  v_suffix text;
BEGIN
  IF p_branch_id IS NOT NULL THEN
    SELECT id INTO v_id FROM chart_of_accounts
      WHERE branch_id = p_branch_id AND name ILIKE p_base_name || '%'
      LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  IF p_branch_name IS NOT NULL THEN
    v_suffix := split_part(trim(p_branch_name), ' ', 1);
    SELECT id INTO v_id FROM chart_of_accounts
      WHERE name ILIKE p_base_name || ' - ' || v_suffix || '%'
      LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  SELECT id INTO v_id FROM chart_of_accounts
    WHERE branch_id IS NULL AND name ILIKE p_base_name || '%'
    LIMIT 1;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql STABLE;

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
  -- payroll voucher reconstruction
  v_sss numeric; v_phil numeric; v_pagibig numeric; v_sv numeric;
  v_uniform numeric; v_cashshort numeric; v_emploan numeric;
  v_netpay numeric; v_incentive numeric; v_incentiveret numeric;
  v_salaries_expense numeric;
  v_sss_acct uuid; v_phil_acct uuid; v_pagibig_acct uuid;
  v_sv_acct uuid; v_uniform_acct uuid; v_cashshort_acct uuid; v_emploan_acct uuid;
  v_salaries_acct uuid; v_incentive_acct uuid; v_incentiveret_acct uuid;
  v_svc_acct uuid; v_interest_acct uuid;
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
    v_ar       := resolve_branch_account('Loans Receivable', r.branch_id, r.branch_name);
    v_cash     := resolve_branch_account('Cash in Vault', r.branch_id, r.branch_name);
    -- Only actually needed (and only resolved) when this loan has a
    -- nonzero fee/interest — a loan with r.service_fee = 0 must not abort
    -- the whole rebuild over an account it never needed in the first place.
    v_svc_acct      := CASE WHEN r.service_fee > 0 THEN resolve_branch_account('Service Fee', r.branch_id, r.branch_name) END;
    v_interest_acct := CASE WHEN r.interest_amount > 0 THEN resolve_branch_account('Interest Revenue', r.branch_id, r.branch_name) END;
    IF v_ar IS NULL OR v_cash IS NULL THEN
      RAISE EXCEPTION 'Loan %: cannot resolve Loans Receivable / Cash in Vault for branch "%"',
        r.loan_number, r.branch_name;
    END IF;
    IF r.service_fee > 0 AND v_svc_acct IS NULL THEN
      RAISE EXCEPTION 'Loan %: cannot resolve Service Fee for branch "%"', r.loan_number, r.branch_name;
    END IF;
    IF r.interest_amount > 0 AND v_interest_acct IS NULL THEN
      RAISE EXCEPTION 'Loan %: cannot resolve Interest Revenue for branch "%"', r.loan_number, r.branch_name;
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
    -- Interest Revenue / Service Fee: branch-resolved, matching
    -- loans/[id]/page.tsx handleDisburse — these used to be the flat,
    -- Balanga-only '4010'/'4000'. Already resolved (and NULL-checked)
    -- above, before this loan's entry was even created.
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_svc_acct, 0, r.service_fee, 'Service fee'
      WHERE r.service_fee > 0;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_interest_acct, 0, r.interest_amount, 'Interest revenue'
      WHERE r.interest_amount > 0;

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
    v_ar := resolve_branch_account('Loans Receivable', r.branch_id, r.branch_name);

    v_cash := r.salvaged;
    IF v_cash IS NULL THEN
      v_cash := resolve_branch_account('Cash in Vault', r.branch_id, r.branch_name);
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
    SELECT gv.*, b.name AS branch_name FROM gas_vouchers gv
    LEFT JOIN branches b ON b.id = gv.branch_id
    WHERE coalesce(gv.total_amount, 0) > 0 ORDER BY gv.voucher_date
  LOOP
    -- Cash account: read straight off what was actually picked at
    -- generation time (stored on the row), not re-resolved — same as the
    -- live app, and avoids drift if the Chart of Accounts changes later.
    SELECT id INTO v_cash FROM chart_of_accounts
      WHERE trim(code) = trim(coalesce(r.cash_account_code, '')) LIMIT 1;
    IF v_cash IS NULL THEN
      v_cash := resolve_branch_account('Cash in Vault', r.branch_id, r.branch_name);
    END IF;
    -- Transportation Expense: branch-resolved, matching gas-voucher/page.tsx
    -- — used to be the flat, Balanga-only '5020'.
    v_acct := resolve_branch_account('Transportation Expense', r.branch_id, r.branch_name);
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
  -- Reconstructs the EXACT same lines handleGenerateVoucher() posts —
  -- salariesExpense as the plug (netPay + payables - incentive gross-up),
  -- SSS/PhilHealth/PagIBIG Payable, Service Vehicle, Uniform, Cash
  -- Shortage, Employee Loan, Cash in Vault, and the Incentives Expense /
  -- Withheld Funds Payable pair — not the old flat "Salaries Expense =
  -- Net Pay" two-liner, which threw away every one of those breakdowns.
  -- The per-employee deduction figures aren't stored on the voucher
  -- itself, only on the underlying `payroll` rows each line points back
  -- to via payroll_id, so those are joined back in here.
  FOR r IN
    SELECT pv.*, b.name AS branch_name
    FROM payroll_vouchers pv
    LEFT JOIN branches b ON b.id = pv.branch_id
    WHERE coalesce(pv.total_net_pay, 0) > 0
    ORDER BY pv.pay_date
  LOOP
    SELECT
      coalesce(sum(p.sss), 0), coalesce(sum(p.philhealth), 0), coalesce(sum(p.pag_ibig), 0),
      coalesce(sum(p.service_vehicle), 0), coalesce(sum(p.uniform), 0), coalesce(sum(p.cash_shortage), 0),
      coalesce(sum(p.loan_deduction), 0), coalesce(sum(p.net_pay), 0),
      coalesce(sum(p.incentive), 0), coalesce(sum(p.incentive_retention), 0)
    INTO v_sss, v_phil, v_pagibig, v_sv, v_uniform, v_cashshort, v_emploan, v_netpay, v_incentive, v_incentiveret
    FROM jsonb_array_elements(coalesce(r.lines, '[]'::jsonb)) AS elem
    JOIN payroll p ON p.id = (elem->>'payroll_id')::uuid;

    -- If a payroll row this voucher's lines point to has since been
    -- deleted (or the join otherwise comes up short), v_netpay would come
    -- back lower than what the voucher itself was saved with — silently
    -- posting a smaller, wrong Cash in Vault credit. Caught here instead
    -- of discovered later as yet another ledger/business-record mismatch.
    IF abs(v_netpay - coalesce(r.total_net_pay, 0)) > 0.01 THEN
      RAISE EXCEPTION 'Payroll voucher %: reconstructed net pay (%) does not match the voucher''s saved total_net_pay (%) — a payroll row its lines point to may have been deleted',
        r.voucher_number, v_netpay, r.total_net_pay;
    END IF;

    -- Same formula as salariesExpense in handleGenerateVoucher(): the
    -- incentive gross-up is pulled back OUT of this plug so it can post as
    -- its own two lines below instead of being buried inside Salaries
    -- Expense.
    v_salaries_expense := v_netpay + v_sss + v_phil + v_pagibig + v_sv + v_uniform + v_cashshort + v_emploan
                          - v_incentive + v_incentiveret;

    v_cash            := resolve_branch_account('Cash in Vault', r.branch_id, r.branch_name);
    v_salaries_acct   := resolve_branch_account('Salaries Expense', r.branch_id, r.branch_name);
    v_sv_acct         := resolve_branch_account('Service Vehicle', r.branch_id, r.branch_name);
    v_uniform_acct    := resolve_branch_account('Receivable from Uniform', r.branch_id, r.branch_name);
    v_cashshort_acct  := resolve_branch_account('Cash Short/Over', r.branch_id, r.branch_name);
    v_emploan_acct    := resolve_branch_account('Employee Loan', r.branch_id, r.branch_name);
    -- Company-wide, resolved by name — same as app/(app)/payroll/page.tsx.
    v_incentive_acct    := resolve_branch_account('Incentives Expense', NULL, NULL);
    v_incentiveret_acct := resolve_branch_account('Withheld Funds Payable', NULL, NULL);
    -- SSS/PhilHealth/PagIBIG Payable are flat, company-wide codes in the
    -- live app too (deliberately, per handleGenerateVoucher's own
    -- comment) — not a staleness bug, matched as-is.
    SELECT id INTO v_sss_acct     FROM chart_of_accounts WHERE trim(code) = '2010' LIMIT 1;
    SELECT id INTO v_phil_acct    FROM chart_of_accounts WHERE trim(code) = '2020' LIMIT 1;
    SELECT id INTO v_pagibig_acct FROM chart_of_accounts WHERE trim(code) = '2030' LIMIT 1;

    IF v_cash IS NULL OR v_salaries_acct IS NULL THEN
      RAISE EXCEPTION 'Payroll voucher %: cannot resolve Cash in Vault / Salaries Expense', r.voucher_number;
    END IF;
    -- Each of these only matters when this voucher actually carries a
    -- nonzero amount for it — a voucher with no Service Vehicle deductions
    -- this cutoff must not abort the rebuild over an account it never
    -- needed. But if the amount IS nonzero and the account can't resolve,
    -- fail loudly and specifically here rather than silently drop that
    -- line — postJournalEntry() on the live app refuses to post the whole
    -- entry in exactly this situation, and a specific error naming the
    -- voucher and account is far more useful than the generic "does not
    -- balance" the final check below would otherwise raise instead.
    IF v_sv > 0 AND v_sv_acct IS NULL THEN
      RAISE EXCEPTION 'Payroll voucher %: cannot resolve Service Vehicle', r.voucher_number;
    END IF;
    IF v_uniform > 0 AND v_uniform_acct IS NULL THEN
      RAISE EXCEPTION 'Payroll voucher %: cannot resolve Receivable from Uniform', r.voucher_number;
    END IF;
    IF v_cashshort > 0 AND v_cashshort_acct IS NULL THEN
      RAISE EXCEPTION 'Payroll voucher %: cannot resolve Cash Short/Over', r.voucher_number;
    END IF;
    IF v_emploan > 0 AND v_emploan_acct IS NULL THEN
      RAISE EXCEPTION 'Payroll voucher %: cannot resolve Employee Loan', r.voucher_number;
    END IF;
    IF v_incentive > 0 AND v_incentive_acct IS NULL THEN
      RAISE EXCEPTION 'Payroll voucher %: cannot resolve Incentives Expense', r.voucher_number;
    END IF;
    IF v_incentiveret > 0 AND v_incentiveret_acct IS NULL THEN
      RAISE EXCEPTION 'Payroll voucher %: cannot resolve Withheld Funds Payable', r.voucher_number;
    END IF;
    IF v_sss > 0 AND v_sss_acct IS NULL THEN
      RAISE EXCEPTION 'Payroll voucher %: cannot resolve SSS Payable (code 2010)', r.voucher_number;
    END IF;
    IF v_phil > 0 AND v_phil_acct IS NULL THEN
      RAISE EXCEPTION 'Payroll voucher %: cannot resolve Philhealth Payable (code 2020)', r.voucher_number;
    END IF;
    IF v_pagibig > 0 AND v_pagibig_acct IS NULL THEN
      RAISE EXCEPTION 'Payroll voucher %: cannot resolve PagIBIG Payable (code 2030)', r.voucher_number;
    END IF;

    v_seq := v_seq + 1;
    INSERT INTO journal_entries (entry_number, entry_date, reference, description, source, source_id, branch_id)
    VALUES ('JE-' || v_year || '-R' || lpad(v_seq::text, 6, '0'), r.pay_date, r.voucher_number,
            'Payroll Voucher - ' || r.voucher_number, 'payroll_voucher', r.id, r.branch_id)
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_salaries_acct, v_salaries_expense, 0, 'Salaries Expense' WHERE v_salaries_expense > 0;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_sss_acct, 0, v_sss, 'SSS Payable' WHERE v_sss > 0 AND v_sss_acct IS NOT NULL;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_phil_acct, 0, v_phil, 'Philhealth Payable' WHERE v_phil > 0 AND v_phil_acct IS NOT NULL;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_pagibig_acct, 0, v_pagibig, 'PagIBIG Payable' WHERE v_pagibig > 0 AND v_pagibig_acct IS NOT NULL;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_sv_acct, 0, v_sv, 'Service Vehicle Loan' WHERE v_sv > 0 AND v_sv_acct IS NOT NULL;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_uniform_acct, 0, v_uniform, 'Uniform' WHERE v_uniform > 0 AND v_uniform_acct IS NOT NULL;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_cashshort_acct, 0, v_cashshort, 'Cash Shortage' WHERE v_cashshort > 0 AND v_cashshort_acct IS NOT NULL;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_emploan_acct, 0, v_emploan, 'Employee Loan' WHERE v_emploan > 0 AND v_emploan_acct IS NOT NULL;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_cash, 0, v_netpay, 'Cash in Vault' WHERE v_netpay > 0;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_incentive_acct, v_incentive, 0, 'Incentives Expense' WHERE v_incentive > 0 AND v_incentive_acct IS NOT NULL;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
      SELECT v_entry_id, v_incentiveret_acct, 0, v_incentiveret, 'Withheld Funds Payable' WHERE v_incentiveret > 0 AND v_incentiveret_acct IS NOT NULL;

    v_made := v_made + 1;
  END LOOP;

  ---------------------------------------------------- 13th month vouchers --
  -- Previously missing from this script entirely — handleGenerateThirteenth
  -- Voucher() in app/(app)/payroll/page.tsx posts to the ledger too, so a
  -- rebuild without this section would have silently deleted every 13th
  -- month journal entry and never regenerated them. total_net_pay is
  -- already the final, adjustment-inclusive figure straight off the
  -- voucher row — no further joins needed, unlike the regular Payroll
  -- Voucher above.
  --
  -- thirteenth_month_vouchers has no branch_id (it can span every branch
  -- at once) and the live code itself has no reliable single branch to
  -- resolve against either — this mirrors that by resolving company-wide
  -- (NULL branch), same ambiguity the live app already carries, not
  -- something to "fix" here beyond what's actually live.
  FOR r IN
    SELECT * FROM thirteenth_month_vouchers WHERE coalesce(total_net_pay, 0) > 0 ORDER BY created_at
  LOOP
    v_acct := resolve_branch_account('Employee Benefits', NULL, NULL);
    v_cash := resolve_branch_account('Cash in Vault', NULL, NULL);
    IF v_acct IS NULL OR v_cash IS NULL THEN
      RAISE EXCEPTION '13th Month voucher %: cannot resolve Employee Benefits Expense / Cash in Vault', r.voucher_number;
    END IF;

    v_seq := v_seq + 1;
    INSERT INTO journal_entries (entry_number, entry_date, reference, description, source, source_id, branch_id)
    VALUES ('JE-' || v_year || '-R' || lpad(v_seq::text, 6, '0'), r.created_at::date, r.voucher_number,
            '13th Month Voucher - ' || r.voucher_number, 'thirteenth_month_voucher', r.id, NULL)
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, memo)
    VALUES (v_entry_id, v_acct, r.total_net_pay, 0, 'Employee Benefits Expense'),
           (v_entry_id, v_cash, 0, r.total_net_pay, 'Cash in Vault');

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
