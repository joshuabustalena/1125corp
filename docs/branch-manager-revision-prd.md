# Branch Manager Access & Document Revision — Product Requirements Document

Status: All 11 phases done — 5 SQL scripts pending manual run in Supabase SQL Editor
Owner: Joshua Bustalena
Last updated: 2026-07-21

## Progress log

- ✅ **Phase 1** — `customers.max_loan_limit` default changed 80,000 → 30,000. The Max Loan Limit field in the Add/Edit Customer form is now Administrator-only (read-only for everyone else, including Cashier who can still create customers). **SQL pending:** `supabase/update_max_loan_limit_default.sql`.
- ✅ **Phase 2** — New `lib/document-branding.ts` maps branch name → `{ companyName: '1125 CREDIT COLLECTION SERVICES', address, contact }` for Balanga/Dinalupihan. Wired into the Loan Agreement, Cash Voucher (all 3 pages), Borrower's Undertaking, Payslip header, and the thermal receipt name line — replacing every hardcoded "1125 Lending Corporation" and the previously-always-Dinalupihan address. No SQL needed.
- ✅ **Phase 3** — Agreement/Undertaking/Voucher now use `"Times New Roman", Calibri, serif` (was Georgia-first) and generate PDFs at 8.5"×13" (`[612, 936]` pt) instead of A4. No SQL needed.
- ✅ **Phase 4** — `deduction_amount` on an employee loan is now hard-capped at `amount / 12`, enforced in both the Apply and Admin Edit dialogs, with a live hint showing the max. No SQL needed.
- ✅ **Phase 5** — Employee loan amount cap is now tiered: 15,000 for regular staff, 20,000 when the applicant's position is "Branch Manager". Approve/Reject on `employee-loans/[id]` now requires Administrator when the applicant is a Branch Manager, otherwise a Branch Manager can approve their own branch's staff; the list is branch-scoped for Branch Manager accounts. No SQL needed.
- ✅ **Phase 6** — `/leave-requests` is now branch-scoped for Branch Manager (was unscoped, saw every branch). A Branch Manager's own leave request always shows "Pending Admin approval" instead of action buttons. No SQL needed.
- ✅ **Phase 7** — Leave types expanded to 5 (Vacation, Sick, Emergency, Bereavement, Other) plus a separate "Special Leave" category (solo parent, VAWC, etc.) with its own +7-day allowance tracked in a new `employees.special_leaves_used` column — additive on top of the regular 5-day allowance, never mixed into the same counter. **SQL pending:** `supabase/add_special_leave_allowance.sql`.
- ✅ **Phase 8** — Attendance records get a new `review_status` (`pending`/`accepted`/`rejected`), Admin-only Accept/Reject buttons across every employee (no Branch Manager, no branch scoping, per client's explicit answer). A rejected record is excluded from payroll's days-present count; pending/accepted both count normally. **SQL pending:** `supabase/add_attendance_review_status.sql`.
- ✅ **Phase 9** — New `credit_limit_requests` table + `/credit-limit-requests` page: Branch Manager submits a request (with a "Request Limit Increase" shortcut from the customer detail page), Administrator approves (applies the new limit to `customers.max_loan_limit`) or denies, with an in-app notification to Admin on submission. `credit_limit_requests` permission granted live to the Branch Manager role via the service-role API (verified: `Branch Manager -> [...,"credit_limit_requests"]`). **SQL pending:** `supabase/add_credit_limit_requests.sql`.
- ✅ **Phase 10** — Added `employees.pay_type` (`'daily'`/`'monthly'`, default `'daily'`). Payroll now pays a `'monthly'` employee half their monthly salary per semi-monthly cutoff instead of daily-rate × attendance. Employee form/detail page show "Monthly Salary" vs "Daily Rate" accordingly. **SQL pending:** `supabase/add_employee_pay_type.sql` (also sets the two existing Branch Manager records to `pay_type='monthly', salary=20000`).
- ✅ **Phase 11** — Full `npx tsc --noEmit` clean throughout. Live-reverified `Branch Proxy Collector` role is unchanged and intact (9 permissions) — no rebuild needed, confirming item #19 from the audit.

**All 11 phases complete.** 5 SQL scripts need to be run manually in the Supabase SQL Editor (listed above and in the summary below) — everything else (including the new Branch Manager `credit_limit_requests` permission) is already live.

## 1. Goal

Go through the client's revision list item by item, confirm what the system already has vs. what's a real gap, and build a phased plan so this ships one piece at a time.

## 2. Source requirement (as given)

**Branch Manager Access:**
- Loan Approval & Loan Daily Payment
- Request for credit limit increase for customers
- Approve employee loan (for all employees of branch)
- Approve employee leave (for all branch employees)

**Loan Agreement & Disclosure, Borrower's Undertaking:**
- Font: TNR/Calibri
- 8.5 x 13" size for printing

**All Headers for printed documents:**
- Change "1125 Lending Corp" to "1125 Credit Collection Services" (same font/color, address & contact number)
- Balanga: 118 Maligaya St Cupang West Balanga Bataan · 0950-431-9848
- Dinalupihan: 155 National Hiway Layac Dinalupihan Bataan · 0985-978-4404

**Loan Max Limit for new customer:**
- Default: 30,000
- Admin Access: customize max credit limit per customer

**Employee's Loan:**
- Max 15k & 2 active loans
- Maximum deduction per cutoff = amount of loan / 12
- Admin Approval: Manager's employee loan (max 20k & 2 active loans)

**Employee Attendance:**
- Action button for accept / reject

**Leave:**
- Admin approval for Manager's leave
- 5 leave terms
- Special leave (solo parent, VAWC, etc.) — custom leave, additional 7 days

**Salary:**
- Branch Manager (Balanga & Dinalupihan): 20,000

**Proxy Collector:**
- Access to all customer posting of payment & check overdue rate & balance

## 3. Current-state audit

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Branch Manager: Loan Approval | ✅ Already works | `loans/[id]` already gates `canApprove` on `Administrator OR Branch Manager`. |
| 2 | Branch Manager: Loan Daily Payment (recording payments) | ⚠️ Needs live verification | `/payments` "Post Collection" isn't blocked by role name for Branch Manager in code (only Cashier is explicitly excluded elsewhere) — access depends entirely on whether the `payments` permission is actually granted to the Branch Manager role in the live `roles` table. This is a data check, not a code gap. |
| 3 | Branch Manager: Request credit limit increase for customers | ⚠️ Partial / different shape | `customers.max_loan_limit` already exists (default **80,000**, not 30,000). A dedicated endpoint (`/api/customers/bump-loan-limit`) already lets a Branch Manager or Administrator directly **raise** a customer's limit — but it's an immediate self-service action during over-limit loan approval, not a "request → Admin approves" workflow. Also, the plain Add/Edit Customer form's "Max Loan Limit" field is currently editable by **any** role that can open that dialog — not Admin-restricted at all. |
| 4 | Branch Manager: Approve employee loan (for all employees of branch) | ❌ Gap | The employee-loans **list** page's `canApprove` variable (Admin or Branch Manager) is only used to decide who can apply on someone else's behalf. The actual Approve/Reject buttons on `employee-loans/[id]` are gated `isAdmin` only — a Branch Manager currently cannot approve any employee loan. Also there's no branch scoping anywhere in employee loans — an approver (once granted) would see every employee across every branch, not just their own. |
| 5 | Branch Manager: Approve employee leave (for all branch employees) | ⚠️ Partial | Approve/Reject buttons on `/leave-requests` already show for Branch Manager. But the list is **unscoped** — a Branch Manager currently sees and can act on every employee's leave requests across every branch, not just their own branch. |
| 6 | Loan Agreement / Undertaking: font TNR/Calibri | ❌ Gap | Both `loans/[id]/agreement` and `loans/[id]/undertaking` (and the Cash Voucher) currently render with `fontFamily: 'Georgia, "Times New Roman", serif'` — Georgia (not TNR/Calibri) is what actually displays since it's listed first. |
| 7 | Loan Agreement / Undertaking: 8.5 x 13" print size | ❌ Gap | All three documents (`agreement`, `undertaking`, `voucher`) generate PDFs with `format: 'a4'` in jsPDF. Needs a custom page size — 8.5" × 13" = 612pt × 936pt. |
| 8 | All printed-document headers: company name + per-branch address/contact | ❌ Gap | "1125 LENDING CORPORATION" (and "1125 Lending Corporation" in body clauses) is hardcoded in 5 places: `lib/thermal-printer.ts` (receipt, name only), `payroll/page.tsx` (payslip, name only, no address), `loans/[id]/agreement/page.tsx`, `loans/[id]/voucher/page.tsx`, `loans/[id]/undertaking/page.tsx`. The loan-document trio also hardcodes **one fixed address** (Dinalupihan's) regardless of which branch the loan actually belongs to — Balanga-branch loans currently print the wrong address. No shared header component exists; each file duplicates its own markup. |
| 9 | Loan Max Limit default: 30,000 | ❌ Gap | Default is currently **80,000** everywhere (`customers` table default, and the Add Customer form's initial state). |
| 10 | Loan Max Limit: Admin-only customization per customer | ❌ Gap | See #3 — the field is open to any role with customer-edit access today, not Admin-restricted. |
| 11 | Employee Loan: max 15k & 2 active loans | ✅ Already works | Enforced client-side in `employee-loans/page.tsx`'s `handleSubmit` (hard block, not just a warning) — applies to every employee uniformly today. |
| 12 | Employee Loan: maximum deduction per cutoff = loan / 12 | ❌ Gap | `deduction_amount` is a free numeric input with no ceiling at all — an admin/employee could set it to the full loan amount, paying it off in 1–2 cutoffs instead of spreading it over at least 12. (Note: this reverses an earlier read of a similarly-worded item in the client checklist PRD, which was resolved as "no build needed" because the deduction *calendar* already caps at 12 payments *maximum* — that resolved a **minimum-payments** reading. This new wording is explicitly a **maximum-deduction-per-cutoff** cap, which is a different, real constraint that isn't enforced anywhere.) |
| 13 | Admin Approval: Manager's employee loan (max 20k & 2 active loans) | ❌ Gap | No differentiated cap by applicant's position exists — everyone is capped at 15k today. There's also no rule preventing a Branch Manager from having their own loan approved by another Branch Manager (once #4 is built) or, currently, approving their own since approval is role-gated, not applicant-gated. |
| 14 | Employee Attendance: accept/reject action button | ❌ Gap | Attendance records are created automatically from camera check-in (status auto-computed as present/late) with no manual review step, no "pending" state, and no accept/reject UI anywhere. Needs a clarifying conversation — see open questions. |
| 15 | Leave: Admin approval for Manager's leave | ❌ Gap | Today any Branch Manager can approve any leave request including, structurally, another Branch Manager's (nothing stops it) — no rule routes a Branch Manager applicant's own request to Admin-only. |
| 16 | Leave: 5 leave terms | ❌ Gap | Only 4 types exist today: Vacation, Sick, Emergency, Other. |
| 17 | Leave: special/custom leave (solo parent, VAWC, etc.) +7 days | ❌ Gap | No special-leave category and no separate allowance bucket exists — `paid_leaves_used` is a single running counter against one shared `annualLeaves` setting (currently 5). An additional +7 days for qualifying special leave needs its own allowance tracking, separate from the regular annual bucket. |
| 18 | Salary: Branch Manager (Balanga & Dinalupihan) = 20,000 | ⚠️ Needs clarification | `employees.salary` is used today as a **daily rate** (Basic Pay = daily rate × days present, per this session's payroll-formula fix). ₱20,000 as a *daily* rate would be extreme — this almost certainly means a **fixed monthly salary** for the Branch Manager position specifically, which the current payroll engine has no concept of (it only knows daily-rate × attendance for everyone). This is a data-entry task only if a flat ₱20,000/day rate is really intended; otherwise it's a payroll-model change. See open questions. |
| 19 | Proxy Collector: all-customer payment posting + overdue rate/balance check | ✅ Already built | Covered end-to-end by `docs/branch-proxy-collector-prd.md` (all 3 phases done, live-verified 2026-07-15) — the `Branch Proxy Collector` role already gets unscoped `/payments` posting and unscoped `/reports` (overdue rate, receivable, balance, etc.). Just needs a quick live re-check that the role/permissions are still intact, not a rebuild. |

## 4. Open questions — resolved

1. **Employee loan approval hierarchy** — ✅ Branch Manager approves/rejects their branch's staff loans; a Manager-applicant's own loan always requires Administrator approval.
2. **Leave approval scoping** — ✅ Branch Manager scoped to their own branch's employees; a Manager's own leave always routes to Administrator.
3. **Attendance accept/reject** — ✅ Clarified by client: **only Administrator** can accept/reject attendance, across **all** employees (no Branch Manager role in this one, no branch scoping).
4. **Document font** — ✅ Times New Roman primary, Calibri fallback.
5. **Credit limit increase** — ✅ Build a formal request/approval queue (Manager requests, Admin approves/denies) — not just the existing direct-bump shortcut.
6. **Branch Manager salary** — ✅ Flat monthly salary of ₱20,000 — requires a new "fixed monthly" pay type in payroll, separate from daily-rate × attendance.
7. **Special leave allowance** — ✅ Additive: +7 days on top of the 5 regular leave-term days, tracked as its own bucket.

## 5. Phased plan

Ordered smallest/least-ambiguous first so we can start shipping immediately while the open questions above get answered.

### Phase 1 — Loan max limit default (trivial, no ambiguity)
- Change `customers.max_loan_limit` default from 80,000 to 30,000 (new customers only; existing customers keep their current limit).
- Restrict the "Max Loan Limit" field in the Add/Edit Customer form to Administrator-only (view-only badge/text for everyone else), matching "Admin Access: customize max credit limit per customer."
- SQL needed: update the column default.

### Phase 2 — Document headers: rebrand + per-branch address (small-medium, no ambiguity on the facts, only on scope of "all")
- Build one shared header data source (e.g. `lib/document-branding.ts`) mapping branch name → `{ companyName: '1125 Credit Collection Services', address, contact }` for Balanga and Dinalupihan.
- Replace hardcoded "1125 Lending Corporation" / fixed Dinalupihan address in: `loans/[id]/agreement`, `loans/[id]/voucher`, `loans/[id]/undertaking`, `payroll` (payslip), `lib/thermal-printer.ts` (name only, no room for address on thermal paper).
- Loan documents will now show the correct branch's address/contact instead of always Dinalupihan's.
- No SQL needed.

### Phase 3 — Loan document font + paper size (small, pending Q4)
- Switch `fontFamily` on the Agreement/Undertaking/Voucher from `Georgia, "Times New Roman", serif` to the client's chosen font (Q4) with the other as fallback.
- Change all three `jsPDF({ format: 'a4' })` calls to a custom `[612, 936]` (8.5" × 13") page size, and re-check that existing content still fits/paginates correctly at the new dimensions.

### Phase 4 — Employee loan deduction cap: loan / 12 maximum (small, no ambiguity)
- Enforce `deduction_amount <= amount / 12` in both the Apply dialog (`employee-loans/page.tsx`) and the Admin Edit dialog, with a clear validation message — mirrors the existing "max 15,000 / 2 active loans" hard-block pattern already in the same file.

### Phase 5 — Manager-tier employee loan cap + Admin-only approval (medium)
- Detect when the applicant's `position` is "Branch Manager" and apply a 20,000 cap instead of 15,000 (2-active-loans rule stays the same for both tiers).
- Approve/reject gating on `employee-loans/[id]`: Branch Manager can approve/reject for their branch's non-manager staff; a Manager-applicant's loan is Admin-only regardless.
- Add branch scoping to the employee-loans list so a Branch Manager only sees their own branch's applications by default (Admin still sees all).

### Phase 6 — Leave: branch scoping + Manager-tier Admin approval (medium)
- Scope `/leave-requests` so a Branch Manager only sees/acts on their own branch's employees (Admin unaffected).
- Route a Branch Manager's own leave request to Admin-only approval, same pattern as Phase 5.

### Phase 7 — Leave: 5 terms + special/custom leave with +7 additive days (medium)
- Expand `leave_type` options to 5 standard terms.
- Add a distinct "Special Leave" type (solo parent, VAWC, etc.) with its own +7-day allowance, tracked as a separate bucket on top of the regular 5-day allowance (not combined into one counter).

### Phase 8 — Employee Attendance accept/reject, Admin-only, all employees (medium)
- Attendance records get a review state; only Administrator sees/uses Accept/Reject actions, across every employee (no Branch Manager involvement, no branch scoping).

### Phase 9 — Credit limit increase: request/approval queue (medium)
- New `credit_limit_requests` table (customer, requested_by, requested_limit, current_limit, status, reviewed_by, reviewed_at).
- Branch Manager gets a "Request Increase" action on a customer (separate from the existing direct bump-during-loan-approval flow, which stays as-is for that specific over-limit-at-approval-time case).
- Admin gets an approval queue (approve → updates `customers.max_loan_limit`; deny → just closes the request) with a notification, reusing the existing notifications system.

### Phase 10 — Branch Manager fixed monthly salary (payroll-model change)
- Add a pay-type flag to `employees` (e.g. `pay_type: 'daily' | 'monthly'`, default `'daily'` for everyone existing).
- When `pay_type = 'monthly'`, payroll's Basic Pay computation bypasses daily-rate × days-present and instead uses the fixed monthly amount split across the two semi-monthly cutoffs (÷2 per cutoff, matching the existing semi-monthly cadence).
- Set the two Branch Manager records (Balanga, Dinalupihan) to `pay_type: 'monthly'`, `salary: 20000`.

### Phase 11 — Verification
- Re-confirm Proxy Collector role/permissions are still live and correct (#19) — no rebuild expected, just a live check.
- Full regression: `npx tsc --noEmit`, spot-check each modified document's print/download output, spot-check employee-loan and leave-request approval flows for both Administrator and Branch Manager accounts.

## 6. Notes on sequencing

Phases 1–4 have no open questions and can start immediately. Phases 5–10 each depend on one specific open question above — once the client answers, that phase can start without touching the others. Phase 11 runs last, after everything else lands.
