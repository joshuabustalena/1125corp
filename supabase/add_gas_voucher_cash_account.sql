/*
  Lets the Gas Voucher pick its source Cash account (Vault vs Bank), same
  as the general Cash Voucher already does — the journal entry's credit
  side now follows this instead of always crediting Cash on Hand. Run once
  in the Supabase SQL Editor. Safe to re-run (idempotent).
*/
alter table gas_vouchers add column if not exists cash_account_code text not null default '1000';
