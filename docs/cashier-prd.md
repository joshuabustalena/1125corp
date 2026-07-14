# Branch Cashier — Product Requirements Document

Status: In progress — Phases 1, 3, 2, 4 done
Owner: Joshua Bustalena
Last updated: 2026-07-14

## Progress log

- ✅ **Phase 1** — Cashier granted `reports`/`accounting` permissions; Reports page now has Branch/Area filters; customer creation locked to Administrator only.
- ✅ **Phase 3** — Loan approval split into two steps: Branch Manager/Admin approve (`pending` → `approved`), Cashier/Admin disburse (`approved` → `active`) with a generated Cash Voucher (printable/downloadable). All required SQL scripts have been run and verified live.
- ✅ **Phase 2** — Added 4 new report types to `/reports`, all filterable by Branch/Area: Overdue Amount (per-loan, sorted by days overdue), Overdue Rate (% delinquent per area), Customers per Area, and Delayed/Past-Due Customers (1-7 days = Delayed, 8+ days = Past Due — adjust the cutoff in `reports/page.tsx` if your policy differs). "Overdue" is computed the same way the dashboard already does: `status = 'active' AND due_date < today` — the `overdue` status value is never actually persisted in this codebase.
- ✅ **Phase 4** — New `/remittance` page: shows each collector's cash collected vs. remitted today, with a "Record Remittance" action. New `/cash-count` page: shows Expected Cash (remittances in minus vouchers out for the branch/day) vs. a manually entered Counted Amount, flags the variance, and keeps a 30-count history per branch. **DB migration pending** — run `supabase/add_cash_count_remittance.sql` in the Supabase SQL Editor (confirmed via REST that `remittances`/`cash_counts` don't exist live yet, both return 404).
- ⬜ Phase 5, 6, 7 — not started.

## 1. Goal

Make the Branch Cashier role fully functional per the job description below. Today, Cashier's live permissions are `["payments","receipts","customers_read","loans","attendance"]` — enough to post payments and view loans/receipts, but most of the accounting, disbursement, and reporting responsibilities below have no permission grant and, in several cases, no feature at all yet.

## 2. Source requirement (as given)

- Journal Entry for each economic transaction
- Access to Automated Posting to General Ledger and designated FS
- View of financial reports and accounts
- View of necessary details per area — daily/weekly/monthly collection, daily/monthly release, overdue amount, overdue rate, receivables
- Generate payment history of customers
- Report of Daily Cash Count
- Input of customer's information for pending loan applications
- Upon approval, processing of loans and disbursement
- Cash Voucher preparation for each cash disbursement
- Monitoring of Collateral loans for each customer (ORCR and Bank Checks)
- Request and check balance of employee leave
- Request and check balance of employee loan
- Access how much total collection/cash should be remitted by the field collector/proxy who received payment

## 3. Current-state audit

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Journal entries | ❌ Missing | No `journal`/`ledger` table or UI anywhere in the codebase. |
| 2 | GL + Financial Statements | ❌ Missing | `accounting` page only has free-text `cash_flow` (inflow/outflow + category string) and `expenses` — no double-entry posting, no chart of accounts, no statements. |
| 3 | View financial reports/accounts | ❌ Blocked | Pages exist (`/accounting`, `/reports`) but Cashier lacks the `accounting`/`reports` permissions. |
| 4 | Area-level reports (collection, release, overdue amount/rate, receivables) | ⚠️ Partial | `/reports` has daily/weekly/monthly collection + a basic receivables report, but no branch/area filter and no overdue-amount/overdue-rate report type exist yet. Also permission-blocked for Cashier. |
| 5 | Customer payment history | ✅ Mostly works | Exists per-loan (`loans/[id]`) and as a filterable report (`/payment-reports`, which Cashier's `receipts` permission already unlocks). |
| 6 | Daily Cash Count report | ❌ Missing | No feature at all. |
| 7 | Customer intake for pending loans | ⚠️ Exists but ungated | Any authenticated user can add a customer today (RLS is wide open: `WITH CHECK (true)`) — this needs an explicit decision, not just a Cashier grant. |
| 8 | Loan disbursement after approval | ❌ Missing as a distinct step | "Approve" directly flips the loan to `active` — there's no separate disbursement action, no record of who released the cash or when. |
| 9 | Cash Voucher preparation | ❌ Missing | No voucher document/record concept exists. |
| 10 | Collateral monitoring (ORCR / bank checks) | ❌ Missing | No table, field, or UI. |
| 11 | Employee leave request + balance | ❌ Missing | Attendance table has a static "Leave" status label only — no request/approval/balance system exists for *any* role yet. |
| 12 | Employee loan request + balance (self-service) | ⚠️ Partial | `employee_loans` exists but as an admin/branch-manager-run list, not a "request my own loan, see my balance" self-service view. |
| 13 | Collector cash remittance reconciliation | ❌ Missing | No feature shows how much cash a collector/proxy owes to turn in from payments they collected. |

**Bottom line:** 8 of 13 items require building a feature from scratch; the rest need permission grants, filters, or a self-service view layered on existing tables.

## 4. Scope decision needed before Phase 4

Item 2 ("Automated Posting to General Ledger and designated FS") is a full double-entry bookkeeping system — chart of accounts, journal entries, automatic GL posting rules, and generated financial statements (Income Statement, Balance Sheet). Building this to real accounting standards is a multi-week project on its own, independent of the other 12 items. The plan below treats it as its own phase (Phase 5) so the rest of the Cashier role can ship first, and asks for a scope call before starting it (see Phase 5).

## 5. Phased plan

Each phase is independently shippable. Later phases don't block earlier ones.

### Phase 1 — Access & existing-feature grants (quick)
No new features; just unlock what already exists and close a gap.
- Grant Cashier the `reports` and `accounting` permissions (items 3, 5).
- Add branch/area filters to `/reports` (item 4, collection/release side).
- Decide and fix the open customer-creation RLS (item 7's underlying gap) — currently *any* authenticated user, any role, can insert a customer row. Needs an explicit policy (e.g., restrict to Collector/Cashier/Branch Manager/Admin) regardless of what we do for Cashier specifically.

### Phase 2 — Area-level overdue/receivables reporting (medium)
- Add "Overdue Amount" and "Overdue Rate" report types to `/reports`, filterable by area.
- Add "Number of customers per area" and "delayed/past-due customers" list views (this also closes the same gap flagged in the Branch Manager PRD work — one build serves both roles).

### Phase 3 — Loan disbursement & Cash Voucher (medium)
- Split "Approve" and "Disburse" into two distinct steps on the loan detail page: Branch Manager/Admin approve → status `approved`; Cashier then disburses → status `active`, records disbursed-by, disbursed-at, and disbursement amount.
- On disbursement, generate a Cash Voucher record (voucher number, loan, customer, amount, date, prepared-by) with a printable/downloadable view (reuse the existing receipt PDF pattern from Payments).

### Phase 4 — Daily Cash Count & Collector Remittance (medium)
- New "Daily Cash Count" page: Cashier declares counted cash (bills/coins breakdown or a simple total) for the day, system shows expected cash (from payments + disbursements) vs. counted, flags variance.
- New "Remittance" view: for each collector, show total cash collected today (sum of their payments) vs. what's been remitted/turned in to the cashier, with a running balance owed.

### Phase 5 — General Ledger & Financial Statements (large — needs scope confirmation)
- Chart of accounts table.
- Journal entry UI (manual entries) + automatic posting rules from payments, disbursements, expenses, cash-flow entries.
- Generated Income Statement and Balance Sheet views.
- This phase should get its own follow-up discussion on exactly which statements and posting rules are needed before implementation starts.

### Phase 6 — Collateral Monitoring (medium)
- New `collateral` table (type: ORCR/Bank Check, reference number, customer, loan, status: held/released, notes).
- UI on the loan/customer detail page to attach and track collateral items.

### Phase 7 — Employee Self-Service: Leave & Loan (large)
- New `leave_requests` table (employee, type, dates, status, approver) + leave balance tracking (accrual rule TBD).
- Self-service "My Leave" page: request leave, see balance, see request history.
- Self-service "My Employee Loan" view: request a loan (reuses `employee_loans` insert, already open to any authenticated user), see own balance/repayment status without needing the full admin list view.
- Note: the *approval* side of leave requests (Branch Manager approving) was already flagged as missing in the earlier Branch Manager PRD — this phase builds the underlying system both roles depend on.

## 6. Suggested build order

1. Phase 1 (quick wins, unlocks immediate value)
2. Phase 3 (disbursement + voucher — directly in the loan workflow Cashier already touches)
3. Phase 2 (reporting)
4. Phase 4 (cash count + remittance)
5. Phase 7 (employee self-service — shared with Branch Manager's approval side)
6. Phase 6 (collateral)
7. Phase 5 (GL/Financial Statements — biggest, most standalone, do last or in parallel once scope is confirmed)

## 7. Open questions

- Phase 1: should customer creation be restricted to specific roles (Collector, Cashier, Branch Manager, Admin) or stay open to everyone?
- Phase 5: which financial statements are actually required (Income Statement only, or also Balance Sheet/Cash Flow Statement)? Is this for internal use or does it need to match a specific accounting format (BIR, external audit)?
- Phase 6: what statuses/lifecycle does a collateral item need beyond held/released (e.g., partial release, damaged, disputed)?
- Phase 7: what's the leave accrual rule (fixed days/year, tenure-based, none — just tracked manually)?
