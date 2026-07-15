# Accounting Department — Product Requirements Document

Status: All 4 phases done — live-verified
Owner: Joshua Bustalena
Last updated: 2026-07-15

## Progress log

- ✅ **Phase 1** — Chart of Accounts tab now has a live "Balance (as of today)" column, computed from `journal_entry_lines`, signed per each account's normal balance side. New "Trial Balance" tab: pick an as-of date, see every account's debit or credit balance with a total row, plus a pass/fail message confirming debits = credits. No new tables — pure computation on existing data, no SQL to run.
- ✅ **Phase 2** — New "General Ledger" tab (distinct from "Journal Entries," which stays chronological-by-transaction): pick one account + a date range, see an Opening Balance, every line ever posted to that account in date order with a running balance, and an Ending Balance — the actual per-account ledger card. No new tables, no SQL to run.
- ✅ **Phase 3** — New "Monthly Trends" tab: pick a date range, get a bar chart (Net Profit % + Opex per month) and a monthly breakdown table (Revenue, Expenses, Net Income, Net Profit %, Opex). Per the PRD's stated assumption: "Opex" = the Operating Expenses account (5000) specifically; "Expenses" = every expense-type account combined. No new tables, no SQL to run.
- ✅ **Phase 4** — New `shareholders` table (confirmed live, already applied) + new "Shareholders" tab: Admin/Accounting can add/edit a shareholder's name, capital contributed, ownership %, date invested, notes. Shows Total Capital and Total Ownership Allocated stat cards, with a warning if ownership percentages don't sum to 100%. Kept as an informational registry — does not auto-post to the Owner's Equity GL account (per the scope decision in this PRD's open questions).

## All 4 phases complete.

## 1. Background

The `Accounting` role already exists and already has the `general_ledger` permission (granted during the Cashier PRD's Phase 5, since Accounting was always meant to share that page). Live permissions today: `accounting, reports, cash_flow, expenses, general_ledger`.

The General Ledger system built for the Cashier PRD (`chart_of_accounts`, `journal_entries`, `journal_entry_lines` tables, `/general-ledger` page with 4 tabs) already covers roughly half of this checklist. This PRD is about closing the rest.

## 2. Source requirement (as given)

- Balances of Accounts
- Chart of Accounts
- Journal Entries
- General Ledger
- Trial Balance
- Balance Sheet
- Income Statement
- Tracking of % of Net Profit per month
- Tracking of Amount of Opex per month
- Shareholders' capital and its interests

## 3. Current-state audit

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Balances of Accounts | ❌ Missing | The Chart of Accounts tab lists code/name/type only — no computed running balance per account anywhere. |
| 2 | Chart of Accounts | ✅ Works | `/general-ledger` → Chart of Accounts tab. |
| 3 | Journal Entries | ✅ Works | `/general-ledger` → Journal Entries tab — manual multi-line entry, debit=credit enforced. |
| 4 | General Ledger | ⚠️ Misnamed/Partial | The page is *called* "General Ledger" but what it shows is a chronological journal (entries in the order posted). A true general ledger is **per-account**: for one account, every line ever posted to it, in order, with a running balance ("ledger card"). That view doesn't exist yet. |
| 5 | Trial Balance | ❌ Missing | No report listing every account's balance as of a date with a debit/credit total check. |
| 6 | Balance Sheet | ✅ Works | `/general-ledger` → Balance Sheet tab, as-of date, includes computed Retained Earnings so it balances. |
| 7 | Income Statement | ✅ Works | `/general-ledger` → Income Statement tab, date range. |
| 8 | Tracking of % of Net Profit per month | ❌ Missing | No monthly trend view exists — Income Statement only runs for one date range at a time, not broken out by month. |
| 9 | Tracking of Amount of Opex per month | ❌ Missing | Same gap — no monthly breakdown of Operating Expenses specifically. |
| 10 | Shareholders' capital and its interests | ❌ Missing entirely | No `shareholders` table or concept anywhere. The Balance Sheet has one generic "Owner's Equity" account — no per-shareholder capital/ownership-% tracking. |

**Bottom line:** 4 of 10 already work (reused from the Cashier PRD). 6 need new work, but all build on the same `chart_of_accounts`/`journal_entries`/`journal_entry_lines` data already in place — no architecture change, just new views and one new small table.

## 4. Phased plan

### Phase 1 — Account Balances + Trial Balance (reuses existing data, no new tables)
- Add a live "Balance" column to the Chart of Accounts tab (as-of-today by default).
- Add a new "Trial Balance" tab: every account with its debit or credit balance as of a chosen date, with a total row that must net to zero — a built-in correctness check on the whole ledger.

### Phase 2 — True General Ledger (per-account ledger card)
- Add a new "General Ledger" tab (renaming the current chronological one to "Journal Entries" only, which it already is — the tab label already says that, so this is purely additive): pick an account, see every line ever posted to it in date order with a running balance, like a bank statement for that account.

### Phase 3 — Monthly trend tracking (% Net Profit, Opex)
- New "Monthly Trends" tab: for a selected range of months, a table (and a simple bar chart, reusing the `recharts` library already used elsewhere in the app) showing per month: Revenue, Expenses, Net Income, Net Profit % (Net Income ÷ Revenue), and Operating Expense amount specifically.

### Phase 4 — Shareholders' Capital
- New `shareholders` table: name, capital contributed, ownership %, date invested, notes.
- New "Shareholders" tab: list, add/edit (Admin/Accounting), running total of capital and of ownership % (flags if % doesn't sum to 100).
- Scope simplification: kept as an informational registry, **not** deeply wired into the double-entry ledger (i.e., adding a shareholder here doesn't auto-post a journal entry to the Owner's Equity account) — full sub-ledger reconciliation between individual shareholders and the single GL equity account is a much bigger design question. Flagging this now rather than silently deciding it.

## 5. Open questions

- Phase 3: is "Opex" exactly the `Operating Expenses` account (5000), or all expense-type accounts combined (Operating Expenses + Salaries Expense, etc.)? Assumed: all expense-type accounts, with Operating Expenses broken out as its own line too.
- Phase 4: should shareholders' capital contributions actually post to the ledger (e.g., Debit Cash, Credit Owner's Equity when a shareholder invests), or stay a separate registry as scoped above? Assumed separate registry for now — can be upgraded later if needed.
- Should Branch Manager or Cashier also see any of these new tabs, or is this strictly Accounting/Admin? Assumed: same access as the rest of `/general-ledger` today (Cashier + Accounting + Admin), since it's one page — not gating individual tabs differently unless told otherwise.
