# Branch Proxy Collector (Supervisor) — Product Requirements Document

Status: All 3 phases done — live-verified, no manual SQL needed
Owner: Joshua Bustalena
Last updated: 2026-07-15

## Progress log

- ✅ **Phase 1** — Role created live: `Branch Proxy Collector`, permissions `customers, payments, receipts, loans, reports, remittance, employee_loans, leave_requests, attendance`. Seed migration updated to match. No new tables/RLS needed — this role reuses everything already built.
- ✅ **Phase 2** — `/remittance`'s "Record Remittance" action now uses a precise `canRecordRemittance` check (Administrator/Cashier only) instead of just excluding Field Collector — so Proxy Collector (and any future role) is correctly view-only there too, while still seeing every collector's numbers (unscoped, unlike Field Collector's own-data-only view).
- ✅ **Phase 3** — Verified live: role + all 9 permissions confirmed via API, all 8 relevant pages (`customers`, `payments`, `payment-reports`, `loans`, `reports`, `remittance`, `employee-loans`, `leave-requests`) return 200. Typecheck clean.

## 1. Background

This is a **brand-new role** — it doesn't exist in the system yet. System role name will be **Branch Proxy Collector** (matching the existing naming convention of "Branch Field Collector", "Branch Manager", etc. — the "(Supervisor)" in your spec is a descriptive subtitle, not the literal stored role name).

## 2. Source requirement (as given)

- Access to all existing customers
- Request and check balance of employee leave
- Request and check balance of employee loan
- View of payment history of customers
- View of necessary details per area — daily/weekly/monthly collection, daily/monthly release, delayed customers, past-due customers, overdue amount, receivable, overdue rate, number of customers per area, payment history
- Issuance of acknowledgement receipt for every payment received directly from customers (**in all areas**)
- Access to how much collection should be remitted based on each receipt

Notably **absent** compared to Branch Field Collector's scope: **"Request loan of customers" is not on this list.** A Proxy Collector cannot initiate new loan applications.

## 3. Key architectural finding

Every area/data restriction built so far (Branch Field Collector's "my area only" lock on `/reports`, "my own numbers only" lock on `/remittance`, "my own loans only" scoping on `/employee-loans`) is implemented as an **opt-in** restriction keyed to the exact string `role_name === 'Branch Field Collector'`. Nothing in the codebase defaults to "locked down" — pages default to full/unscoped access unless a specific role name is checked and restricted.

This means a **new, distinct role name** automatically gets the broad, unscoped behavior everywhere by default — which happens to match almost this entire requirement list out of the box: "all customers," "all areas," "in all areas" for receipts. The only places that need an explicit new check are ones where an action (not a view) needs to stay restricted to Cashier/Admin specifically (recording a remittance, approving a loan, disbursing, creating a new customer) — and those are already keyed to specific *other* role names, so this new role is automatically excluded from them too without extra work.

## 4. Current-state audit

| # | Requirement | Status once role exists | Notes |
|---|---|---|---|
| 1 | Access to all existing customers | ✅ Automatic | `/customers` scoping only triggers for `role_name === 'Branch Field Collector'` — a new role sees everyone by default. |
| 2 | Request + check own employee loan balance | ✅ Reuses existing | `/employee-loans` self-service (built in the Cashier PRD) — just needs the `employee_loans` permission granted. |
| 3 | Request + check own employee leave balance | ✅ Reuses existing | `/leave-requests` — just needs the `leave_requests` permission granted. |
| 4 | View payment history of customers | ✅ Reuses existing | `/payment-reports` — needs the `receipts` permission. Payments list is unscoped by default (no area lock). |
| 5 | Area details — collection/release/delayed/past-due/overdue amount/receivable/overdue rate/customers-per-area/payment history | ✅ Automatic, unscoped | All these report types already exist on `/reports` (built in the Cashier PRD) — needs the `reports` permission. Since this role isn't `Branch Field Collector`, the Branch/Area filter dropdowns stay visible (full access across areas), which is exactly what "number of customers per area" (plural) implies. |
| 6 | Acknowledgement receipt, all areas | ✅ Automatic | `/payments` "Post Collection" isn't blocked for this role (only Cashier is blocked), and the loan picker is unscoped by default (no `collector_id` lock) — so a Proxy Collector can post a payment against any loan in any area. Same receipt format as the Branch Field Collector PRD (OR#, time, release/due date, GPS address). |
| 7 | Remittance access | ⚠️ Needs one explicit restriction | `/remittance` is unscoped by default (good — matches "based on each receipt," implying visibility across collectors), but the "Record Remittance" *action* button currently only hides for `Branch Field Collector`. Need to add this new role to that same hide-check so they get view-only access, same as Field Collector — recording a remittance should stay Cashier/Admin-only for cash-handling integrity. |
| — | Request loan of customers | ❌ Correctly excluded | Not granting the `loans`-insert-eligible role name, so `loans_insert` RLS and the "New Loan" button both correctly stay closed to this role — no code changes needed, just don't grant what isn't asked for. |

**Bottom line: this is almost entirely a permissions-grant task, not a features-build task** — everything this role needs was already built for the Cashier and Branch Field Collector PRDs. Only one small UI change is needed (extend the remittance-recording restriction to cover this role too).

## 5. Phased plan

### Phase 1 — Create the role
- Insert `Branch Proxy Collector` into the `roles` table (live DB + seed migration) with permissions: `customers`, `payments`, `receipts`, `loans` (view-only — no create/approve/disburse UI or RLS matches this role name), `reports`, `remittance`, `employee_loans`, `leave_requests`, `attendance` (baseline, every operational role has it for clock-in/out).
- No new tables, no new RLS policies, no SQL script to run manually — this phase is 100% data (role permissions), which I can apply directly via the API.

### Phase 2 — Restrict remittance recording
- Update `/remittance`'s "Record Remittance" button visibility to hide for both `Branch Field Collector` and `Branch Proxy Collector` — view-only for both, recording stays Cashier/Admin-only.

### Phase 3 — Verification
- Live-verify permissions, confirm loan creation/approval/disbursement/customer-creation stay correctly closed off, confirm reports/remittance/customers show full (unscoped) data.

## 6. Open questions

- Should this role also see the **Collateral** section on loan details (view-only, like most roles) — assumed yes, no restriction needed since collateral viewing is already open to everyone.
- Should "Access to all existing customers" include the ability to **edit** customer records, or view-only? Assumed view-only (matches the literal wording "access to... customers," not "manage"), consistent with how Field Collector's customer access also doesn't include edit rights.
