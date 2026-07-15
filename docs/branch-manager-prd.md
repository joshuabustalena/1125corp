# Branch Manager — Product Requirements Document

Status: Both phases done — 3 SQL scripts pending
Owner: Joshua Bustalena
Last updated: 2026-07-15

## Progress log

- ✅ **Phase 1** — `/cash-count` now has 3 separate inputs (Cash in Vault, Cash in Bank, Petty Cash Fund) instead of one combined "Counted Amount", auto-summed and shown in history. The "Record Today's Count" form is now hidden for anyone but Cashier/Admin — Branch Manager sees the stat cards + history only (view-only, matches "to view branch cashier's output"). Branch Manager granted the `cash_count` permission live. **DB migration pending** — run `supabase/add_cash_balance_breakdown.sql`.
- ✅ **Phase 2** — Chose the check-on-load approach (no cron infra exists). New `lib/due-date-alerts.ts`: checks for active loans due within 3 days or overdue, without an existing alert, and inserts one `upcoming_due`/`overdue` notification each (max one per loan per type — no daily repeats). Wired into both the Notifications page and the Dashboard, so it runs whenever either is opened. **DB migration pending** — run `supabase/add_notification_loan_id.sql`.

## 1. Background

Most of the Branch Manager role's requirements were already fixed earlier in this project (informally, before we started writing PRD docs) — loan/employee-loan/leave approval, viewing all customers, and area-level reports all work today. This PRD covers the **2 remaining gaps** found in the final verification pass.

Branch Manager's live permissions today: `customers, loans, payments, reports, attendance, employee_loans, accounting, collectors, leave_requests`.

## 2. Source requirement (as given)

- Approval of request loan of field collector for new and renewal customers
- Approval of employees loan and employees leave
- Entry of daily payments of approved loan
- Access of view of all customer accounts and balances
- View of necessary details per area — daily/weekly/monthly collection, daily/monthly release, delayed customers, past-due customers, overdue amount, receivable, overdue rate, number of customers per area, payment history
- View of branch cashier's output — cash balances (cash in vault, cash in bank, petty cash fund), monitoring of Collateral
- Notify if the customer loan is due date

## 3. Current-state audit

| # | Requirement | Status |
|---|---|---|
| 1 | Approve loan requests (new + renewal) | ✅ Works |
| 2a | Approve employee loans | ✅ Works |
| 2b | Approve employee leave | ✅ Works |
| 3 | Enter daily payments | ✅ Works |
| 4 | View all customer accounts/balances | ✅ Works |
| 5 | Area-level report details | ✅ Works |
| 6a | Cash balances (vault/bank/petty cash) | ❌ **Two gaps** — (1) no such breakdown exists anywhere; `/cash-count` only tracks one combined Expected-vs-Counted figure. (2) Branch Manager isn't even granted the `cash_count` permission, so they can't view that page at all today. |
| 6b | Collateral monitoring | ✅ Works (view-only, same as everyone with loan access) |
| 7 | Notify if loan is due date | ❌ Missing entirely — no trigger, cron, or code writes to the `notifications` table for due dates. The table and UI (`upcoming_due`/`overdue` icon cases) were clearly built for this purpose but never wired up. |

**Bottom line:** 8 of 10 already work. This PRD is scoped to the 2 remaining items.

## 4. Design decisions

### Item 6a — Cash balances
- Extend `cash_counts` with three new columns: `vault_amount`, `bank_amount`, `petty_cash_amount`. The existing `counted_amount` becomes their sum (kept as a stored column for backward compatibility with the variance calculation already in place).
- Branch Manager gets **view-only** access: granted the `cash_count` permission, but the "Record Today's Count" form is hidden for them (Cashier/Admin only) — matches "to view branch cashier's output," not "to record" it.

### Item 7 — Due-date notifications
- **Important limitation to flag before building:** there is no cron/scheduled-job infrastructure in this project (no Vercel cron config, no Supabase pg_cron setup, no background workers). A true "push" notification that fires the moment a loan becomes due — independent of anyone having the app open — is not achievable without adding that infrastructure (a bigger, separate piece of work: either enabling Supabase's `pg_cron` extension + a scheduled SQL job, or an external cron hitting a new API route).
- What **is** achievable now: a **check-on-load** approach. Every time a Branch Manager (or Admin) opens the Notifications page (and/or the Dashboard), the app checks for loans due within the next 3 days or already overdue, and creates a notification record for any that don't already have one — reusing the `notifications` table and its already-built `upcoming_due`/`overdue` icon logic. This means alerts appear whenever someone next visits the app, not the instant a loan becomes due.
- Adds a `loan_id` column to `notifications` (currently missing) so the system can tell which loans have already been notified about, avoiding duplicate spam on every page load.
- Scope note: only one notification is created per loan per type (`upcoming_due` once, `overdue` once) — not a daily repeat reminder, to avoid clutter. Can be revisited if daily reminders are wanted.

## 5. Phased plan

### Phase 1 — Cash Balances breakdown
- `cash_counts` table: add `vault_amount`, `bank_amount`, `petty_cash_amount` columns.
- `/cash-count` UI: replace the single "Counted Amount" field with three inputs (Vault / Bank / Petty Cash), auto-summed and shown live; history table gets the breakdown too.
- Grant Branch Manager the `cash_count` permission (view-only — form hidden for non-Cashier/Admin roles).

### Phase 2 — Due-date notifications (check-on-load)
- `notifications` table: add `loan_id` column.
- New shared check function: finds active loans due within 3 days or overdue, without an existing notification of that type, and inserts one.
- Wire the check into the Notifications page load (and optionally a Dashboard badge/count for visibility without needing to open Notifications specifically).

## 6. Open questions

- Phase 2: is check-on-load acceptable, or is a true background/cron-based push notification required? That's a bigger, separate build — flagging now so it's an explicit choice, not a silent assumption.
- Phase 2: "3 days before due date" for the upcoming-due window — is that the right lead time, or should it be different (1 day, 7 days)?
- Phase 1: should Cashier/Admin also be able to edit past cash-count entries, or is the log append-only as currently built? Assumed append-only (matches current design — no edit capability exists for any role).
