-- ALZA Pharmacy: distributor logo storage support
-- Review against the live Supabase schema before applying.
begin;

alter table public.distributors
  add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'distributor-logos',
  'distributor-logos',
  true,
  2097152,
  array['image/png','image/jpeg','image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read is intentional: distributor logos are non-sensitive branding.
drop policy if exists distributor_logos_public_read on storage.objects;
create policy distributor_logos_public_read
on storage.objects for select
using (bucket_id = 'distributor-logos');

-- Uploads are restricted to a folder named with the user's branch UUID.
drop policy if exists distributor_logos_branch_insert on storage.objects;
create policy distributor_logos_branch_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'distributor-logos'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.branch_id::text = (storage.foldername(name))[1]
      and p.is_active = true
  )
);

drop policy if exists distributor_logos_branch_update on storage.objects;
create policy distributor_logos_branch_update
on storage.objects for update to authenticated
using (
  bucket_id = 'distributor-logos'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.branch_id::text = (storage.foldername(name))[1]
      and p.is_active = true
  )
)
with check (
  bucket_id = 'distributor-logos'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.branch_id::text = (storage.foldername(name))[1]
      and p.is_active = true
  )
);

drop policy if exists distributor_logos_branch_delete on storage.objects;
create policy distributor_logos_branch_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'distributor-logos'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.branch_id::text = (storage.foldername(name))[1]
      and p.is_active = true
  )
);

commit;
