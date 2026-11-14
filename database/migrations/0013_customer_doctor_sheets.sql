-- ALZA Pharmacy: attach doctor's sheets to individual customer sales invoices.
-- Private storage; access is limited to the signed-in user's branch.
-- Review against the live Supabase schema and take a backup before applying.
begin;

create table if not exists public.customer_doctor_sheets (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  invoice_id uuid not null references public.sales_invoices(id) on delete restrict,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  file_size bigint not null check (file_size > 0 and file_size <= 15728640),
  storage_path text not null unique,
  uploaded_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists customer_doctor_sheets_invoice_idx
  on public.customer_doctor_sheets(branch_id, invoice_id, created_at desc);

alter table public.customer_doctor_sheets enable row level security;

drop policy if exists customer_doctor_sheets_select on public.customer_doctor_sheets;
create policy customer_doctor_sheets_select
on public.customer_doctor_sheets for select to authenticated
using (branch_id = public.my_branch_id());

drop policy if exists customer_doctor_sheets_insert on public.customer_doctor_sheets;
create policy customer_doctor_sheets_insert
on public.customer_doctor_sheets for insert to authenticated
with check (
  branch_id = public.my_branch_id()
  and uploaded_by = auth.uid()
  and exists (
    select 1 from public.sales_invoices si
    where si.id = customer_doctor_sheets.invoice_id
      and si.customer_id = customer_doctor_sheets.customer_id
      and si.branch_id = customer_doctor_sheets.branch_id
  )
);

grant select, insert on public.customer_doctor_sheets to authenticated;
revoke all on public.customer_doctor_sheets from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'customer-doctor-sheets',
  'customer-doctor-sheets',
  false,
  15728640,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object path: <branch UUID>/<sales invoice UUID>/<random filename>.
drop policy if exists customer_doctor_sheets_storage_select on storage.objects;
create policy customer_doctor_sheets_storage_select
on storage.objects for select to authenticated
using (
  bucket_id = 'customer-doctor-sheets'
  and (storage.foldername(name))[1] = public.my_branch_id()::text
  and exists (
    select 1 from public.customer_doctor_sheets d
    where d.storage_path = name
      and d.branch_id = public.my_branch_id()
  )
);

drop policy if exists customer_doctor_sheets_storage_insert on storage.objects;
create policy customer_doctor_sheets_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'customer-doctor-sheets'
  and (storage.foldername(name))[1] = public.my_branch_id()::text
  and exists (
    select 1 from public.sales_invoices si
    where si.id::text = (storage.foldername(name))[2]
      and si.branch_id = public.my_branch_id()
      and si.customer_id is not null
  )
);

commit;
