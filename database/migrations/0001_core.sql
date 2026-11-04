-- ALZA PHARMACY core schema (run in Supabase SQL editor). Idempotent where practical.
create table if not exists roles(code text primary key);
insert into roles values ('super_admin'),('admin'),('pharmacist'),('billing'),('inventory') on conflict do nothing;
create table if not exists profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  staff_id text unique not null, full_name text,
  role text not null references roles(code), active boolean not null default true,
  created_at timestamptz not null default now());
create or replace function public.my_role() returns text language sql stable security definer set search_path=public as
$$ select role from profiles where id=auth.uid() and active $$;
create table if not exists medicines(
  id uuid primary key default gen_random_uuid(), name text not null, generic_name text,
  barcode text unique, sku text, mrp numeric(12,2) not null check(mrp>=0),
  selling_price numeric(12,2) not null check(selling_price>=0),
  purchase_price numeric(12,2) check(purchase_price>=0),
  tax_rate numeric(5,2) not null default 12 check(tax_rate between 0 and 40),
  shelf_location text, active boolean not null default true, created_at timestamptz default now());
create index if not exists med_name_idx on medicines(lower(name));
create table if not exists medicine_batches(
  id uuid primary key default gen_random_uuid(), medicine_id uuid not null references medicines(id),
  batch_no text not null, expiry date not null, qty numeric(14,3) not null default 0 check(qty>=0),
  quarantined boolean not null default false, unique(medicine_id,batch_no));
create table if not exists customers(
  id uuid primary key default gen_random_uuid(), name text not null,
  phone text unique not null check(phone ~ '^[0-9+]{10,15}$'), consent boolean not null default false);
create sequence if not exists invoice_seq;
create table if not exists sales_invoices(
  id uuid primary key default gen_random_uuid(), invoice_no text unique not null,
  customer_id uuid references customers(id), subtotal numeric(12,2) not null,
  discount numeric(12,2) not null default 0, tax numeric(12,2) not null, total numeric(12,2) not null,
  status text not null default 'final', created_by uuid references profiles(id), created_at timestamptz default now());
create table if not exists sales_items(
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references sales_invoices(id),
  medicine_id uuid not null references medicines(id), batch_id uuid not null references medicine_batches(id),
  qty numeric(14,3) not null check(qty>0), unit_price numeric(12,2) not null, tax_rate numeric(5,2) not null,
  line_total numeric(12,2) not null);
create table if not exists payments(
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references sales_invoices(id),
  method text not null check(method in('cash','upi','card','credit')), amount numeric(12,2) not null check(amount>0));
create table if not exists audit_logs(
  id bigserial primary key, actor uuid, action text not null, detail jsonb, at timestamptz default now());

alter table roles enable row level security; alter table profiles enable row level security;
alter table medicines enable row level security; alter table medicine_batches enable row level security;
alter table customers enable row level security; alter table sales_invoices enable row level security;
alter table sales_items enable row level security; alter table payments enable row level security;
alter table audit_logs enable row level security;

drop policy if exists p_prof_sel on profiles; create policy p_prof_sel on profiles for select using (id=auth.uid() or my_role() in('super_admin','admin'));
drop policy if exists p_roles_sel on roles; create policy p_roles_sel on roles for select using (my_role() is not null);
drop policy if exists p_med_sel on medicines; create policy p_med_sel on medicines for select using (my_role() is not null);
drop policy if exists p_med_w on medicines; create policy p_med_w on medicines for all using (my_role() in('super_admin','admin','pharmacist','inventory')) with check (my_role() in('super_admin','admin','pharmacist','inventory'));
drop policy if exists p_b_sel on medicine_batches; create policy p_b_sel on medicine_batches for select using (my_role() is not null);
drop policy if exists p_b_w on medicine_batches; create policy p_b_w on medicine_batches for all using (my_role() in('super_admin','admin','pharmacist','inventory')) with check (my_role() in('super_admin','admin','pharmacist','inventory'));
drop policy if exists p_c_all on customers; create policy p_c_all on customers for all using (my_role() is not null) with check (my_role() is not null);
drop policy if exists p_si_sel on sales_invoices; create policy p_si_sel on sales_invoices for select using (my_role() is not null);
drop policy if exists p_sit_sel on sales_items; create policy p_sit_sel on sales_items for select using (my_role() is not null);
drop policy if exists p_pay_sel on payments; create policy p_pay_sel on payments for select using (my_role() is not null);
drop policy if exists p_audit_sel on audit_logs; create policy p_audit_sel on audit_logs for select using (my_role() in('super_admin','admin'));

-- purchase_price is confidential: not readable via direct table access (admins would use a protected RPC; not yet built).
revoke select on medicines from authenticated, anon;
grant select (id,name,generic_name,barcode,sku,mrp,selling_price,tax_rate,shelf_location,active,created_at) on medicines to authenticated;
grant insert, update on medicines to authenticated;
revoke all on roles, profiles, medicine_batches, customers, sales_invoices, sales_items, payments, audit_logs from anon;
revoke insert, update, delete on sales_invoices, sales_items, payments, audit_logs from authenticated;

create or replace function public.finalize_sale(p_customer uuid, p_items jsonb, p_payments jsonb, p_discount numeric default 0)
returns uuid language plpgsql security definer set search_path=public as $$
declare it jsonb; b medicine_batches; m medicines; inv uuid; sub numeric:=0; tx numeric:=0; tot numeric; paid numeric:=0; lt numeric; pm jsonb;
begin
  if my_role() not in('super_admin','admin','pharmacist','billing') then raise exception 'Not authorised'; end if;
  if jsonb_array_length(p_items)=0 then raise exception 'Empty cart'; end if;
  if p_discount<0 then raise exception 'Bad discount'; end if;
  insert into sales_invoices(invoice_no,customer_id,subtotal,tax,total,discount,created_by)
   values('ALZA-'||to_char(now() at time zone 'Asia/Kolkata','YYMM')||'-'||lpad(nextval('invoice_seq')::text,6,'0'),p_customer,0,0,0,p_discount,auth.uid()) returning id into inv;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into b from medicine_batches where id=(it->>'batch_id')::uuid for update;
    if not found then raise exception 'Batch not found'; end if;
    if b.expiry < current_date then raise exception 'Batch % is expired', b.batch_no; end if;
    if b.quarantined then raise exception 'Batch % is quarantined', b.batch_no; end if;
    if (it->>'qty')::numeric<=0 or b.qty<(it->>'qty')::numeric then raise exception 'Insufficient stock in batch %', b.batch_no; end if;
    select * into m from medicines where id=b.medicine_id and active;
    if not found then raise exception 'Medicine inactive'; end if;
    lt:=round(m.selling_price*(it->>'qty')::numeric,2);
    sub:=sub+lt; tx:=tx+round(lt*m.tax_rate/(100+m.tax_rate),2);
    update medicine_batches set qty=qty-(it->>'qty')::numeric where id=b.id;
    insert into sales_items(invoice_id,medicine_id,batch_id,qty,unit_price,tax_rate,line_total)
      values(inv,m.id,b.id,(it->>'qty')::numeric,m.selling_price,m.tax_rate,lt);
  end loop;
  tot:=sub-p_discount; if tot<0 then raise exception 'Discount exceeds total'; end if;
  for pm in select * from jsonb_array_elements(p_payments) loop
    if pm->>'method'='credit' and p_customer is null then raise exception 'Credit needs a customer'; end if;
    insert into payments(invoice_id,method,amount) values(inv,pm->>'method',(pm->>'amount')::numeric);
    paid:=paid+(pm->>'amount')::numeric;
  end loop;
  if paid<>tot then raise exception 'Payments (%) must equal total (%)',paid,tot; end if;
  update sales_invoices set subtotal=sub,tax=tx,total=tot where id=inv;
  insert into audit_logs(actor,action,detail) values(auth.uid(),'sale_finalized',jsonb_build_object('invoice',inv,'total',tot));
  return inv;
end $$;
revoke all on function public.finalize_sale from public, anon; grant execute on function public.finalize_sale to authenticated;
