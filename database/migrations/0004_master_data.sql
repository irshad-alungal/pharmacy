-- Phase 1: master data. Run AFTER schema.sql + bootstrap-admin.sql. Re-runnable.
create table if not exists categories(id uuid primary key default gen_random_uuid(), name text not null, active boolean not null default true);
create unique index if not exists categories_name_u on categories(lower(name));
create table if not exists manufacturers(id uuid primary key default gen_random_uuid(), name text not null, active boolean not null default true);
create unique index if not exists manufacturers_name_u on manufacturers(lower(name));
create table if not exists storage_locations(id uuid primary key default gen_random_uuid(), name text not null, active boolean not null default true);
create unique index if not exists storage_locations_name_u on storage_locations(lower(name));
create table if not exists units(id uuid primary key default gen_random_uuid(), name text not null, code text not null, active boolean not null default true);
create unique index if not exists units_code_u on units(lower(code));
create table if not exists unit_conversions(
  id uuid primary key default gen_random_uuid(),
  from_unit_id uuid not null references units(id), to_unit_id uuid not null references units(id),
  factor numeric(14,4) not null check(factor>0), check(from_unit_id<>to_unit_id), unique(from_unit_id,to_unit_id));
-- e.g. 1 Strip = 10 Tablet  => from=Strip, to=Tablet, factor=10

alter table medicines
  add column if not exists brand text, add column if not exists composition text, add column if not exists strength text,
  add column if not exists dosage_form text, add column if not exists rack text,
  add column if not exists category_id uuid references categories(id),
  add column if not exists manufacturer_id uuid references manufacturers(id),
  add column if not exists storage_location_id uuid references storage_locations(id),
  add column if not exists base_unit_id uuid references units(id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname='med_price_chk') then
    alter table medicines add constraint med_price_chk check (selling_price<=mrp); end if; end $$;

alter table customers
  add column if not exists email text, add column if not exists address text,
  add column if not exists age int check(age between 0 and 120),
  add column if not exists gender text check(gender in('male','female','other')),
  add column if not exists consent_at timestamptz, add column if not exists active boolean not null default true;

-- Normalise phone so "98765 43210", "+91 98765-43210" and "9876543210" are the SAME customer.
create or replace function public.customers_norm() returns trigger language plpgsql as $$
declare p text := regexp_replace(coalesce(new.phone,''),'[^0-9+]','','g');
begin
  if p ~ '^[0-9]{10}$' then p := '+91'||p;
  elsif p ~ '^91[0-9]{10}$' then p := '+'||p; end if;
  new.phone := p;
  if new.consent and (tg_op='INSERT' or not old.consent) then new.consent_at := now(); end if;
  if not new.consent then new.consent_at := null; end if;
  return new;
end $$;
drop trigger if exists customers_norm_t on customers;
create trigger customers_norm_t before insert or update on customers for each row execute function customers_norm();
-- normalise any existing rows
update customers set phone=phone;

-- RLS: everyone signed in with a profile can read masters; stock-related roles can write.
do $$ declare t text; begin
  foreach t in array array['categories','manufacturers','storage_locations','units','unit_conversions'] loop
    execute format('alter table %I enable row level security',t);
    execute format('drop policy if exists %I on %I',t||'_sel',t);
    execute format('create policy %I on %I for select using (my_role() is not null)',t||'_sel',t);
    execute format('drop policy if exists %I on %I',t||'_w',t);
    execute format('create policy %I on %I for all using (my_role() in (''super_admin'',''admin'',''pharmacist'',''inventory'')) with check (my_role() in (''super_admin'',''admin'',''pharmacist'',''inventory''))',t||'_w',t);
    execute format('revoke all on %I from anon',t);
    execute format('grant select, insert, update on %I to authenticated',t);
  end loop; end $$;
grant delete on unit_conversions to authenticated;

-- purchase_price stays hidden: re-issue the column grant with the new columns.
revoke select on medicines from authenticated, anon;
grant select (id,name,generic_name,barcode,sku,mrp,selling_price,tax_rate,shelf_location,active,created_at,
  brand,composition,strength,dosage_form,rack,category_id,manufacturer_id,storage_location_id,base_unit_id) on medicines to authenticated;

insert into units(name,code) values ('Tablet','tab'),('Capsule','cap'),('Strip','strip'),('Box','box'),('Bottle','btl'),('Piece','pc')
  on conflict do nothing;
insert into unit_conversions(from_unit_id,to_unit_id,factor)
  select s.id,t.id,10 from units s, units t where s.code='strip' and t.code='tab' on conflict do nothing;
