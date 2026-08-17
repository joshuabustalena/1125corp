# Notes to Website (Aug 2026 batch) — Product Requirements Document

Status: Audit complete — not yet started, pending client answers to 3 blocking questions
Owner: Joshua Bustalena
Last updated: 2026-08-17

## 1. Goal

Go through the 14-item client revision list (screenshot: "Notes to Website" tracker, spanning Journal Entries, Chart of Accounts, Accounting, Loans, Payroll, Collection List, Remittance, Payment Reports, Payments) item by item, confirm what the system already has vs. what's a real gap, and build a phased plan so this ships incrementally — same approach as `docs/branch-manager-revision-prd.md`.

## 2. Source requirement (as given)

| # | Item (verbatim) | Tagged area |
|---|---|---|
| 1 | Hide Journal Entries & Chart of Accounts (Account titles with "- Balanga" and "- Dinalupihan") | Journal Entries |
| 2 | Hide Dashboards per branch account (collection, overdue rate, etc.) | Accounting |
| 3 | Journal Entry description for loan disbursement shall include name, not only loan number | Journal Entries |
| 4 | Bug for loan balances | Loans |
| 5 | Button to view Journal Entries made for the [branch], separate from each branch | Journal Entries |
| 6 | View salary slips for employees, on payroll tab | Payroll |
| 7 | Delay formula (First payment × no. of days loan should have been paid except Sundays − receivable of loan + loan balance) | Collection List |
| 8 | Collector pending remittance positive balances shall be carry-over to the next days | Remittance |
| 9 | Total collected per customer and average payment can be removed in payment reports | Payment Reports |
| 10 | Search button for payment collection are sometimes not working | Payments |
| 11 | Payment history shall have access to generated receipt and delete button | Loans |
| 12 | Journal Entry for payroll revision (consider employee loan and uniform, but disregard SSS and Pag-IBIG loan) | Payroll |
| 13 | Present daily wage on generated payslips | Payroll |
| 14 | First payment shall be included on renewal on loan documents | Loans |

## 3. Current-state audit

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Hide accounts titled "- Balanga"/"- Dinalupihan" | ❌ Gap — **blocked** | Seeded chart of accounts (`supabase/migrations/20260710234014_create_core_schema.sql:442-454`) has 11 accounts, none suffixed "- Balanga"/"- Dinalupihan". `chart_of_accounts` has no `branch_id` column at all. No such accounts exist yet in the schema this codebase reflects — see Open Question 1. |
| 2 | Hide dashboards per branch (collection, overdue rate, etc.) | ⚠️ Partial | `/reports` (`app/(app)/reports/page.tsx:38,41,296-301`) and `/payment-reports` **already** have a working Branch filter/auto-lock for non-admins. `/dashboard` (`app/(app)/dashboard/page.tsx`) is fully unscoped — every stat is a company-wide combined total, no branch filter exists. `/accounting` has no collection/overdue-rate metric to begin with. |
| 3 | JE description for loan disbursement should include customer name | ❌ Gap — trivial | `app/(app)/loans/[id]/page.tsx:629`: `description: \`Loan disbursement — ${loan.loan_number}\`` — no name, even though `disbursedCustomerName` is already computed 2 lines later. One-line fix. |
| 4 | Bug for loan balances | ⚠️ Mostly fixed, one related gap found | The payment-post race condition and renewed-loan-zeroing bug (fixed earlier this session via `apply_loan_payment` RPC) are confirmed live. **New finding**: `handleEditPayment`/`handleDeletePayment` in `app/(app)/payments/page.tsx:305-377` still use the old read-then-write pattern (no RPC, no row lock) — editing/deleting a payment can still corrupt `remaining_balance` under concurrency, the same class of bug. |
| 5 | Button to view JEs per branch | ❌ Gap | `journal_entries` table has no `branch_id` column; `app/(app)/journal-entries/page.tsx` has zero branch filtering. Needs a schema change before a filter button is possible — see Open Question 2. |
| 6 | View salary slips for employees, on Payroll tab | ⚠️ Partial | Single-payslip Print/Download already works well (`app/(app)/payroll/page.tsx:1279-1281,1335,1851-1877`). No per-employee payslip **index** exists — Payroll Records is one flat table of every employee/cutoff with no employee filter. |
| 7 | Delay formula (First payment × days-should-have-paid excl. Sundays − receivable + loan balance) | ❌ Gap — **blocked** | Current Collection List formula (`app/(app)/collection-list/page.tsx:108-111`) is simply "full remaining balance if past due_date, else 0" — nothing like the requested formula. The requested formula's wording is arithmetically ambiguous — see Open Question 3. |
| 8 | Collector pending remittance carries over to next day | ❌ Gap | `app/(app)/remittance/page.tsx:56-65,191-201` computes "owed" strictly from **that single day's** collections minus that day's remittances — confirmed as the documented, intentional design (`supabase/migrations/...sql:475-477`). No carry-forward exists. |
| 9 | Remove "Total collected per customer" / "Average payment" from Payment Reports | ⚠️ Partial | "Average Payment" StatCard exists exactly as named (`app/(app)/payment-reports/page.tsx:304` + PDF `:431-434`) — clean removal. "Total collected per customer" isn't a standalone stat — it's the Customer-grouped variant of a breakdown table that only appears when an Area filter is active (`:114-152,308-335`). |
| 10 | Payment search sometimes not working | ❌ Gap — confirmed real bug | `app/(app)/payments/page.tsx:260-294`: `.or('loans.loan_number.ilike...')` filters an embedded table without the required `{ foreignTable: 'loans' }` option (known-broken PostgREST pattern); the query's `error` is never checked/toasted; the search input has no debounce and no stale-response guard, so a slow earlier keystroke's response can overwrite a newer one. Three compounding causes, all in one file. |
| 11 | Payment history: receipt + delete button on loan page | ❌ Gap — low effort | `app/(app)/loans/[id]/page.tsx:944-970` Payment History renders plain text, no actions at all. `app/(app)/payments/page.tsx:679-704` already has a working "view receipt" button and delete logic — this is mostly porting existing, proven UI rather than building new. |
| 12 | Payroll JE: keep employee loan & uniform, drop SSS/Pag-IBIG loan | ⚠️ Partial — **blocked** | `handleGenerateVoucher` (`app/(app)/payroll/page.tsx:1043-1113`) already posts `Employee Loan` (1110) and `Uniform` (1130) as their own dedicated credit lines exactly as requested. Gap: SSS Loan and Pag-IBIG Loan amounts are currently folded **into** the SSS Payable / PagIBIG Payable credit lines (`:1049,1051`) instead of excluded. Removing them without re-balancing the entry needs an accounting decision — see Open Question 4. |
| 13 | Present daily wage on generated payslips | ❌ Gap — trivial | Payslip header (`app/(app)/payroll/page.tsx:319-326`) shows Employee/Pay Date/Position/Branch/Department/Days Present — no rate field. `employees.pay_type` (`'daily'`/`'monthly'`) already exists from the branch-manager PRD, so the label can follow that same existing convention ("Daily Rate" vs "Monthly Salary") with no new client input needed. |
| 14 | First payment included on renewal loan documents | ✅ Already works | Loan Agreement (`loans/[id]/agreement/page.tsx:120-122,297-302`) and Cash Voucher (`loans/[id]/voucher/page.tsx:65-68,227-245`) both already show a "Less: First Payment" line using the renewal-correct figure. Borrower's Undertaking never shows financial figures for any loan type (template design, not an omission) — no action needed unless the client wants that changed too. |

## 4. Open questions — need client answers before those specific items can start

1. **Item 1 (hide "- Balanga"/"- Dinalupihan" accounts)** — no such accounts exist in the current Chart of Accounts. Does the client mean: (a) they want new branch-suffixed accounts created, then hidden/filtered from certain viewers, (b) a general branch-scoping feature on Chart of Accounts + Journal Entries so each branch only sees its own accounts, or (c) something in their live system this codebase doesn't yet reflect (duplicate/legacy account names they've since renamed)? Cannot scope further without knowing which accounts they mean.
2. **Item 5 (JE branch filter)** — needs a new `journal_entries.branch_id` column. How should it be populated for a given entry: the branch of the loan/customer the entry is about, or the branch of the user who posted it? These can differ (e.g. Admin posting on behalf of a branch).
3. **Item 7 (delay formula)** — the wording "First payment × no. of days loan should have been paid except Sundays − receivable of loan + loan balance" supports more than one reading (is "receivable of loan" the total payable or amount already collected? is "loan balance" added or is it the same thing as "remaining balance" already used elsewhere?). Needs one worked numeric example from the client (an actual loan with actual numbers, and what the correct delay amount should come out to) before this can be built correctly.
4. **Item 12 (payroll JE, drop SSS/Pag-IBIG loan)** — removing `sss_loan`/`pag_ibig_loan` from the SSS Payable/PagIBIG Payable credit lines unbalances the entry (debits ≠ credits) unless that amount goes somewhere else. Does "disregard" mean: (a) don't post those two amounts anywhere in this journal entry at all (i.e. they're tracked/remitted outside this ledger), or (b) post them to a different account than SSS/PagIBIG Payable? Getting this wrong produces an out-of-balance journal entry, so this needs a definite answer rather than a guess.

Items 2, 8, 9, and 13 have a reasonable default interpretation (noted in the phased plan below) that mirrors an existing, already-approved pattern elsewhere in the app — flagged to the client for a quick confirm, but not fully blocking a build.

## 5. Phased plan

Ordered smallest/least-ambiguous first, same approach as the branch-manager PRD.

### Phase 1 — Trivial, no ambiguity
- **Item 3**: Add `disbursedCustomerName` (or `${loan.customers?.first_name} ${loan.customers?.last_name}`) into the disbursement JE description string.
- **Item 10**: Fix the payment search bug — pass `{ foreignTable: 'loans' }` to `.or()` (or restructure with an inner join), check/toast on query error, debounce the search input.
- **Item 13**: Add a "Daily Rate" / "Monthly Salary" line to the payslip header, using the existing `pay_type` field to pick the label — same convention already used on the Employee form.

### Phase 2 — Payment history & balance safety (loans)
- **Item 11**: Port the existing "view receipt" button and delete action from `payments/page.tsx` into the Payment History card on `loans/[id]/page.tsx`.
- **Item 4 (follow-up)**: Extend the same atomic, row-locked approach used by `apply_loan_payment` to cover payment **edit** and **delete** (e.g. a new `reverse_loan_payment`/`adjust_loan_payment` RPC), closing the remaining race-condition gap before wiring up item 11's delete button on the loan page — otherwise we'd be shipping a new UI entry point into the same class of bug we just fixed.

### Phase 3 — Payroll: per-employee payslip view
- **Item 6**: Add an Employee filter dropdown to the Payroll Records table (mirrors filters already used elsewhere in the app), so payslip history for one employee can be found without scrolling the combined list.

### Phase 4 — Dashboard branch scoping
- **Item 2**: Add a Branch filter to `/dashboard` for Administrator (dropdown, defaults to "All Branches") and auto-lock it to the viewer's own branch for non-Admin roles — same pattern `/reports` and `/payment-reports` already use. Flag to client: this is the proposed interpretation of "hide dashboards per branch"; confirm before building.

### Phase 5 — Remittance carry-over
- **Item 8**: Change the "owed" calculation from single-day (`today's payments − today's remittances`) to all-time cumulative (`all-time payments − all-time remittances` for that collector), so an unremitted balance naturally persists into the next day's figure instead of resetting. Flag to client as the proposed interpretation before building.

### Phase 6 — Payment Reports cleanup
- **Item 9**: Remove the "Average Payment" StatCard (screen + PDF) outright. For the Customer-grouped breakdown table, default to removing just that grouping variant (keep Branch/Area groupings) — flag to client to confirm this matches what they meant.

### Phase 7 — Journal Entries branch scoping (schema change)
- **Item 5**: Add `journal_entries.branch_id`, populate at every `postJournalEntry()` call site, add a Branch filter dropdown to `/journal-entries` mirroring the Reports pattern. Depends on Open Question 2's answer.
- **Item 1**: Once the client clarifies which accounts/scoping they mean, implement whatever's actually needed (new accounts + hide, or general branch-scoped visibility). Depends on Open Question 1's answer.

### Phase 8 — Payroll JE revision (accounting decision required)
- **Item 12**: Once Open Question 4 is answered, adjust `handleGenerateVoucher`'s SSS Payable / PagIBIG Payable credit-line calculations accordingly, keeping the entry balanced.

### Phase 9 — Collection List delay formula (needs worked example)
- **Item 7**: Once Open Question 3 is answered with a concrete example, replace the current binary overdue-amount formula with the client's actual delay calculation.

### Verification
- `npx tsc --noEmit` + full `next build` after each phase, same habit as every other change this session.
- Item 14 needs no work — already confirmed working, listed here only for completeness/closure.

## 6. Notes on sequencing

Phases 1–3 have no open questions and can start immediately. Phase 4–6 have a proposed default interpretation each — worth a quick one-line confirm from the client but not fully blocking. Phases 7–9 are genuinely blocked on Open Questions 1–4 and shouldn't be started until the client answers them, to avoid building the wrong thing (especially item 12, where guessing wrong produces an out-of-balance journal entry).
