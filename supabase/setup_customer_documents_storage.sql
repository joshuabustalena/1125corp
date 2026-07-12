/*
  Storage bucket for customer KYC documents (valid ID, clearance, proof of
  billing, promissory note) required before a Cashier can approve a loan.
  Run once in the SQL Editor.
*/

insert into storage.buckets (id, name, public)
values ('customer-documents', 'customer-documents', true)
on conflict (id) do nothing;

drop policy if exists "customer_documents_insert" on storage.objects;
create policy "customer_documents_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'customer-documents');

drop policy if exists "customer_documents_update" on storage.objects;
create policy "customer_documents_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'customer-documents');

drop policy if exists "customer_documents_select" on storage.objects;
create policy "customer_documents_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'customer-documents');
