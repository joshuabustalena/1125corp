/*
  Storage bucket for attendance check-in/check-out photos.
  Run once in the Supabase SQL Editor.
*/

insert into storage.buckets (id, name, public)
values ('attendance-photos', 'attendance-photos', true)
on conflict (id) do nothing;

drop policy if exists "attendance_photos_insert" on storage.objects;
create policy "attendance_photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attendance-photos');

drop policy if exists "attendance_photos_select" on storage.objects;
create policy "attendance_photos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'attendance-photos');
