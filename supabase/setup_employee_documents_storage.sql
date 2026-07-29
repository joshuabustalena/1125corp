/*
  Storage bucket for employee documents (Employment Contract, MDF, MDR, E1,
  BIR Form 1902, Medical Certificate, Valid ID, Background Investigation
  Form). The `employee_documents` table this backs already exists in the
  core schema — only the storage bucket itself was missing. Run once in the
  SQL Editor.
*/

insert into storage.buckets (id, name, public)
values ('employee-documents', 'employee-documents', true)
on conflict (id) do nothing;

drop policy if exists "employee_documents_insert" on storage.objects;
create policy "employee_documents_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'employee-documents');

drop policy if exists "employee_documents_update" on storage.objects;
create policy "employee_documents_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'employee-documents');

drop policy if exists "employee_documents_select" on storage.objects;
create policy "employee_documents_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'employee-documents');

drop policy if exists "employee_documents_delete" on storage.objects;
create policy "employee_documents_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'employee-documents');
