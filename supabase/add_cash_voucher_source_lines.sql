-- Up to 3 cash accounts can now jointly fund one Cash Voucher (client
-- request, Oct 2026) instead of exactly one. cash_account_code stays as the
-- first source for anything still reading that single column; this new
-- column holds the real, possibly-multi-line record.
ALTER TABLE general_cash_vouchers
  ADD COLUMN IF NOT EXISTS cash_source_lines jsonb;
