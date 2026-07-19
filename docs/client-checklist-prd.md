# Client Feature Checklist — Product Requirements Document

Status: All 6 phases done (3 was a no-build)
Owner: Joshua Bustalena
Last updated: 2026-07-20

## Progress log

- ✅ **Phase 1** — Reordered both journal entry views on `/general-ledger` so Debit/Credit come before Description: the "Journal Entries" tab now lists each entry's account/debit/credit lines first, with the description text underneath; the "General Ledger" (per-account) tab's table columns are now Date → Entry # → Debit → Credit → Description → Balance.
- ✅ **Phase 2** — Added `sss_number`, `philhealth_number`, `pagibig_number`, `tin_number` to `employees`. Fields are in the Add/Edit Employee form (`/employees`) and displayed on a new "Government IDs" card on the employee detail page. Not yet wired into payroll deduction math — still flat percentages as before (that's a separate decision, not in scope here). **DB migration pending** — run `supabase/add_employee_government_ids.sql`.
- ✅ **Phase 3 — resolved as no-build-needed.** The Deduction Calendar already caps every employee loan at exactly `term_months × 2` deductions (6 months → 12 semi-monthly payrolls), with the last deduction always absorbing whatever balance remains — so a loan can never take longer than 12 payrolls to clear, regardless of the configured `deduction_amount`. That already satisfies "loan/12" in the sense that matters (full payoff within 6 months/12 payrolls guaranteed by construction). Confirmed with client: no separate minimum-per-installment floor needed.
- ✅ **Phase 4** — Built a reusable `DocumentPreviewDialog` (`components/document-preview-dialog.tsx`): images render inline via `<img>`, PDFs via `<iframe>`, no download required. Wired into both places: the Customer Documents tab (`customers/[id]`, replacing the old `target="_blank"` link) and directly inside the loan Approve dialog (`loans/[id]`) — a Branch Manager/Cashier reviewing a pending loan now sees the customer's submitted documents with a "View" button right there, without navigating to the customer's profile.
- ✅ **Phase 5** — Added a `status` (`pending`/`received`) column to `remittances`. `/cash-count`'s Expected Cash is now the sum of still-**pending** remittances for the branch, up through the count date (not just today's, so nothing unreconciled falls off the radar) — replacing the old "remittances received minus vouchers disbursed" formula. Submitting a cash count marks the remittances it was based on as `received`, so they're never counted again on a later day. Existing historical remittances were backfilled as `received` so they don't suddenly appear as owed. **DB migration pending** — run `supabase/add_remittance_status.sql`.
- ✅ **Phase 6** — Balance Sheet's Equity section on `/general-ledger` no longer computes its own total from equity-type journal entries. "Total Equity" is now `Shareholders' Capital (from the Shareholders tab total) + Retained Earnings (still computed from revenue − expense)`. One side effect worth knowing: the page's existing "Assets ≠ Liabilities + Equity" warning will likely start firing on real data now, since the asset side of any past equity-related journal entries is still counted in Total Assets while the old equity-account balances are no longer counted in Total Equity — the two will only reconcile once Shareholders' Capital entries are kept numerically in sync with whatever's been journaled as capital contributions. No SQL needed for this phase.

**All 6 phases complete.**

## 1. Goal

Go through the client's checklist item by item, confirm what the system already has, and build a phased plan for what's missing so we ship one gap at a time instead of everything at once.

## 2. Source requirement (as given)

- Payment history
- Delete payment
- Employee details: add SSS, Pag-IBIG, PhilHealth, TIN
- Minimum payment for employee loan (loan / 12)
- Employee and collector attendance should be one
- Payslip generation for payroll (details of deduction and payroll)
- Journal entry format (debit / credit before description)
- Shareholder's capital should be equal to owner's equity
- Expected cash formula should be equal to pending remittances
- Total variance
- Total cash collection as of the business day
- Collector and branch performance — purpose on reports (?)
- Loan receivable report should show balances of customers
- Payroll and attendance — purpose on reports (?)
- How to view documents on loan requirements without downloading

## 3. Current-state audit

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Payment history | ✅ Already works | Shown on `/payments`, the loan detail page (`loans/[id]`), the customer detail page, and as a filterable report (`/payment-reports`). |
| 2 | Delete payment | ✅ Already works | Admin-only Edit/Delete icons on `/payments`; reverses the amount back into the loan's `remaining_balance` and removes the linked receipt. |
| 3 | Employee details: SSS, Pag-IBIG, PhilHealth, TIN | ❌ Missing | `employees` table/form only has department, position, branch, salary (daily rate), status, hire date, phone, email, address. None of the 4 government-ID fields exist. |
| 4 | Minimum payment for employee loan (loan / 12) | ❌ Missing | "Deduction per Payroll" on `/employee-loans` is a free numeric input with no floor — an admin can set it to ₱1 on a ₱15,000 loan with no warning. |
| 5 | Employee and collector attendance should be one | ✅ Already works | `/collector-attendance` was merged into `/attendance` this session — one unified page, one `attendance` table, filterable by Branch/Position/Status. |
| 6 | Payslip generation for payroll | ✅ Already works | "Payslip" button per row on `/payroll` opens a Print/Download-able document: Basic Pay, Incentive, Gross Pay, full deduction breakdown (SSS/PhilHealth/Pag-IBIG/Retention/Loan Repayment/Carried-Over Deficit), Net Pay. |
| 7 | Journal entry format (debit/credit before description) | ❌ Gap | Journal Entries table on `/general-ledger` currently orders columns Date → Entry # → **Description** → Debit → Credit → Balance. Client wants Debit/Credit ahead of Description. |
| 8 | Shareholder's Capital should equal Owner's Equity | ❌ Gap | These are two unrelated numbers today: "Shareholders' Capital" (`/general-ledger` → Shareholders tab) is a manually-entered total; "Total Equity" on the Balance Sheet is computed independently from actual `equity`-type journal entries + computed Retained Earnings. Nothing reconciles or flags a mismatch between them. |
| 9 | Expected Cash formula should equal pending remittances | ❌ Gap | `/cash-count`'s Expected Cash = (remittances received today) − (cash vouchers/loan disbursements today). There is no "pending" remittance status at all — the `remittances` table has no status column, so every remittance row is implicitly already "received." The client's requested formula (Expected Cash = pending remittances) needs that status concept to exist first. |
| 10 | Total Variance | ✅ Already works | `/cash-count` computes `variance = counted − expected` per day and shows it (Balanced/red flag) in the count history table. |
| 11 | Total cash collection as of the business day | ✅ Already works | "Today's Collections" stat card on `/dashboard`, summed from `payments` where `payment_date >= today`. |
| 12 | Collector and Branch Performance reports | ✅ Already works | Both report types exist on `/reports` (`collector_performance`, `branch_performance`), filterable by Branch/Area. |
| 13 | Loan Receivable report should show customer balances | ✅ Already works | The `loan_receivable` report on `/reports` already includes `Customer` and `Balance` per row (table columns render dynamically from the data keys). |
| 14 | Payroll and Attendance reports | ✅ Already works | Both report types (`payroll`, `attendance`) exist on `/reports`, date-range filterable. |
| 15 | View loan-requirement documents without downloading | ⚠️ Partial | Customer Documents tab has a "View" link (`target="_blank"`) — browsers usually preview images/PDFs inline, but behavior isn't guaranteed (depends on file type/storage headers), and there's no in-app preview during loan review specifically. No dedicated lightbox/viewer component. |

**Bottom line:** 9 of 15 items are already fully working — no build needed, just confirm with the client. 6 items are real gaps.

## 4. Phased plan

Each phase is independently shippable and small enough to verify on its own before moving to the next.

### Phase 1 — Journal entry column order (trivial)
- Reorder the Journal Entries table on `/general-ledger`: Date → Entry # → Debit → Credit → Description → Balance (confirm exact order with client — "before description" could mean Debit/Credit as columns 3-4 instead of 5-6, or literally swapped with Description as the last text column).

### Phase 2 — Employee government ID fields (small)
- Add `sss_number`, `philhealth_number`, `pagibig_number`, `tin_number` columns to `employees` (SQL migration).
- Add the 4 fields to the Add/Edit Employee form and the Employee detail page's Personal Information card.
- Decide whether these feed into the payroll deduction math later, or are just record-keeping for now (current SSS/PhilHealth/Pag-IBIG deductions are flat percentages, not tied to an actual government ID/bracket lookup).

### Phase 3 — Minimum employee loan payment (small)
- Enforce `deduction_amount >= amount / 12` when applying for or editing an employee loan (both the Apply dialog and the Admin Edit dialog), with a clear validation message. Confirm with client: hard block, or a warning that can be overridden (matching the "over ₱15,000" pattern already used elsewhere)?

### Phase 4 — Document preview without downloading (medium)
- Build a lightbox/preview Dialog for customer documents: `<img>` inline for image files, `<iframe>` for PDFs, triggered by a "View" button instead of a plain link-out.
- Surface it in both the Customer Documents tab and (if that's what "for loan requirements" means) directly in the loan approval flow, so a Branch Manager/Cashier can review a customer's ID/clearance without leaving the approval screen.

### Phase 5 — Remittance status + Expected Cash rework (medium-large)
- Add a `status` column to `remittances` (`pending` / `received`), defaulting new remittances to `pending` until a Cashier/Admin confirms receipt.
- Rework the Expected Cash formula on `/cash-count` to be driven by pending remittances per the client's intent — needs a clarifying conversation first: does "Expected Cash should equal pending remittances" mean Expected Cash = sum of still-pending remittances (money that *should* be turned in but hasn't yet), replacing the current received-minus-vouchers formula, or is it a cross-check that the two numbers should reconcile?

### Phase 6 — Shareholder's Capital ↔ Owner's Equity reconciliation (medium-large)
- Decide the intended relationship: should the Balance Sheet's computed "Total Equity" simply *display* the Shareholders' Capital table's total (replacing/supplementing the current equity-journal-entries calculation), or should there be a variance check/warning when they don't match (mirroring the existing "Assets ≠ Liabilities + Equity" warning already on the Balance Sheet)?
- Needs a short accounting-logic conversation before building — this is the same category of open question as the General Ledger scope call in the Cashier PRD (Phase 5 there).

## 5. Open questions before starting

1. **Phase 1**: exact target column order for Debit/Credit vs Description.
2. **Phase 3**: hard block vs. overridable warning for the loan/12 minimum.
3. **Phase 4**: does "for loan requirements" mean the loan approval screen specifically, or just improving the existing Customer Documents tab?
4. **Phase 5**: exact intended meaning of "Expected Cash = pending remittances."
5. **Phase 6**: should Total Equity defer to Shareholders' Capital, or just flag a mismatch?
