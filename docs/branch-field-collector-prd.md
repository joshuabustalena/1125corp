# Branch Field Collector (Field Manager) — Product Requirements Document

Status: All 3 phases built — pending one SQL script to run live
Owner: Joshua Bustalena
Last updated: 2026-07-14

## Progress log

- ✅ **Phase 1** — Granted `receipts` and `remittance` permissions. `/reports` now locks Field Collectors to their own assigned area (hides Branch/Area dropdowns, shows a read-only "My Area" label instead) and hides Payroll/Attendance/Collector Performance report types (not relevant/appropriate for this role to see). `/remittance` now shows only the logged-in collector's own collected/remitted/owed numbers and hides the "Record Remittance" action (that stays a Cashier-only action, by design — a collector shouldn't be able to self-report that cash was received).
- ✅ **Phase 2** — Employee self-service leave/loan is done (see `docs/cashier-prd.md` Phase 7 for the build details — same system, shared across all three roles). Field Collector granted `employee_loans` and `leave_requests` permissions; both pages auto-scope to their own record.
- ✅ **Phase 3** — Kept the existing auto-generated receipt design and added the fields requested: Time (next to Date), Loan's Release Date and Due Date, and Current Address. The address uses the same GPS + free reverse-geocoding (Nominatim/OSM) pattern already used by Attendance — captured automatically the moment "Post Collection" is opened, shown live in the form, and saved on the payment record. The receipt also shows a "View on Map" link from the raw coordinates. Applies to whoever posts the payment (any role except Cashier, who doesn't post payments). **DB migration pending** — run `supabase/add_payment_location_address.sql`.

## 1. Background

The role formerly named "Collector" has been renamed to **Branch Field Collector** system-wide (DB role name, employee position values, all `role_name`/`position` checks in code, and the RLS policies that reference it). This PRD covers making that role fully functional per the job description below.

Branch Field Collector's live permissions today: `["collections","attendance","customers","reports","payments","loans"]`.

## 2. Source requirement (as given)

- Request loan of customers
- Request and check balance of employee loan
- Request and check balance of employee leave
- View payment history of customers
- View of their respective area information — daily/weekly/monthly collection, daily/monthly release, delayed customers, overdue customers, overdue amount, overdue rate, all customers, number of customers, payment history
- Access to how much collection should be remitted, based on each receipt
- Issuance of acknowledgement receipt for every payment received directly from their customer

## 3. Current-state audit

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Request loan for a customer | ✅ Works | "New Loan" button and `loans_insert` RLS already allow this role. |
| 2 | Request + check own employee loan balance | ❌ Missing | `employee_loans` exists as an admin/branch-manager-run list only — no self-service "request mine, see my balance" view for any role yet. |
| 3 | Request + check own employee leave balance | ❌ Missing | No leave-request system exists anywhere in the codebase yet (same gap flagged in the Branch Manager and Cashier PRDs). |
| 4 | View payment history of customers | ⚠️ Partial | Own collected payments already list correctly (auto-scoped by `collector_id`), and drilling into a loan shows its full payment history. But `/payment-reports` (the searchable, exportable report) requires the `receipts` permission, which this role doesn't have. |
| 5 | Area info: collection, release, delayed/overdue customers, overdue amount/rate, all customers, customer count, payment history | ⚠️ Partial, wrong scope | All of these report types now exist on `/reports` (built for the Cashier/Branch Manager PRDs) — but they show **every** branch/area via a filter dropdown. A Field Collector should only ever see their **own assigned area**, not the whole company's data. |
| 6 | Remittance owed based on receipts | ⚠️ Wrong scope | `/remittance` exists (built for Cashier), but it's a cashier's-eye view of **every** collector's status. A Field Collector needs a "my own" view instead. |
| 7 | Issue acknowledgement receipt per payment | ✅ Mostly works | This role is not blocked from posting payments (only Cashier is), and every payment already generates a receipt (OR number) with print/download. Not yet verified against a specific official "Acknowledgement Receipt" format — send a reference if one exists, like you did for the Cash Voucher/Loan Agreement/Undertaking. |

**Bottom line:** 1 and 7 already work. 4 needs a one-line permission grant. 5 and 6 need to reuse the *existing* pages but auto-scope them to the logged-in collector instead of showing company-wide data. 2 and 3 need the employee self-service system that's also required by the Branch Manager and Cashier PRDs — building it once serves all three.

## 4. Phased plan

### Phase 1 — Quick fixes (grant + scope existing pages)
- Grant `receipts` permission (item 4).
- Scope `/reports` for this role: hide the Branch/Area filter dropdowns and hard-lock the query to their own assigned area (item 5). Reuses all the report types already built — no new report logic needed.
- Scope `/remittance` for this role: instead of listing every collector, show only their own collected-vs-remitted numbers and let them see their own outstanding balance (item 6). Reuses the existing page/table.

### Phase 2 — Employee Self-Service: Leave & Loan (large, shared with other roles)
- This is the same Phase 7 already scoped in the Cashier PRD (`docs/cashier-prd.md`) — building it once unblocks items 2 and 3 here *and* the Branch Manager's leave-approval gap *and* the Cashier's own self-service need. Not duplicating the design here; see that PRD's Phase 7 section for the plan (new `leave_requests` table + balance tracking, self-service "My Leave" and "My Employee Loan" pages).

### Phase 3 — Acknowledgement Receipt format confirmation
- If your company has a specific official "Acknowledgement Receipt" template (like the Cash Voucher/Loan Agreement/Undertaking), share it and I'll match it exactly, same as those three. Otherwise the existing system-generated receipt (OR number, print/download) stands as-is.

## 5. Open questions

- Phase 1: should a Field Collector see read-only company-wide reports too (e.g., for context), or should they be **fully locked** to their own area with no way to view others' data? Current plan assumes full lock-down.
- Phase 2: same open question as the Cashier PRD — what's the leave accrual rule?
- Phase 3: is there an official Acknowledgement Receipt template, or is the current auto-generated receipt sufficient?
