-- Phase 2: purchasing + stock-in. Run AFTER 0004. Re-runnable.
create table if not exists distributors(
  id uuid primary key default gen_random_uuid(), name text not null, contact_person text, phone text, email text, address text,
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  drug_licence text, active boolean not null default true, created_at timestamptz not null default now());
create unique index if not exists distributors_name_u on distributors(lower(name));
create unique index if not exists distributors_gstin_u on distributors(gstin) where gstin is not null;

create table if not exists purchase_invoices(
  id uuid primary key default gen_random_uuid(), distributor_id uuid not null references distributors(id),
  supplier_invoice_no text not null, invoice_date date not null, status text not null default 'confirmed' check(status in('confirmed','cancelled')),
  subtotal numeric(12,2) not null default 0, tax numeric(12,2) not null default 0, discount numeric(12,2) not null default 0,
  freight numeric(12,2) not null default 0, total numeric(12,2) not null default 0, notes text,
  created_by uuid references profiles(id), created_at timestamptz not null default now(),
  unique(distributor_id, supplier_invoice_no));
create table if not exists purchase_items(
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references purchase_invoices(id),
  medicine_id uuid not null references medicines(id), batch_id uuid not null references medicine_batches(id),
  qty numeric(14,3) not null check(qty>0), unit_id uuid references units(id), unit_factor numeric(14,4) not null check(unit_factor>0),
  base_qty numeric(14,3) not null, unit_price numeric(12,2) not null check(unit_price>=0), tax_rate numeric(5,2) not null,
  line_discount numeric(12,2) not null default 0, line_net numeric(12,2) not null);
create table if not exists stock_movements(
  id bigserial primary key, medicine_id uuid not null references medicines(id), batch_id uuid not null references medicine_batches(id),
  movement_type text not null check(movement_type in('purchase_in','sale_out','adjustment','return_in','return_out','damage','transfer')),
  qty numeric(14,3) not null, ref_type text, ref_id uuid, created_by uuid, created_at timestamptz not null default now());
create index if not exists sm_med_idx on stock_movements(medicine_id, created_at desc);

alter table distributors enable row level security; alter table purchase_invoices enable row level security;
alter table purchase_items enable row level security; alter table stock_movements enable row level security;
drop policy if exists d_sel on distributors; create policy d_sel on distributors for select using (my_role() is not null);
drop policy if exists d_w on distributors; create policy d_w on distributors for all using (my_role() in('super_admin','admin','inventory')) with check (my_role() in('super_admin','admin','inventory'));
-- Prices on purchase documents: admins only. Inventory staff use purchase_list() / confirm_purchase().
drop policy if exists pi_sel on purchase_invoices; create policy pi_sel on purchase_invoices for select using (my_role() in('super_admin','admin'));
drop policy if exists pit_sel on purchase_items; create policy pit_sel on purchase_items for select using (my_role() in('super_admin','admin'));
drop policy if exists sm_sel on stock_movements; create policy sm_sel on stock_movements for select using (my_role() in('super_admin','admin','pharmacist','inventory'));
revoke all on distributors, purchase_invoices, purchase_items, stock_movements from anon;
grant select, insert, update on distributors to authenticated;
revoke insert, update, delete on purchase_invoices, purchase_items, stock_movements from authenticated;
grant select on purchase_invoices, purchase_items, stock_movements to authenticated;

-- purchase_price can only be written by confirm_purchase() and read via purchase_history().
revoke insert, update on medicines from authenticated;
grant insert (name,generic_name,barcode,sku,mrp,selling_price,tax_rate,shelf_location,active,brand,composition,strength,dosage_form,rack,category_id,manufacturer_id,storage_location_id,base_unit_id) on medicines to authenticated;
grant update (name,generic_name,barcode,sku,mrp,selling_price,tax_rate,shelf_location,active,brand,composition,strength,dosage_form,rack,category_id,manufacturer_id,storage_location_id,base_unit_id) on medicines to authenticated;

-- Prices are EXCLUSIVE of tax on purchase bills: line net = qty*price - line discount; tax = net*rate; total = net+tax - invoice discount + freight.
create or replace function public.confirm_purchase(p_distributor uuid, p_invoice_no text, p_date date, p_discount numeric,
  p_freight numeric, p_items jsonb, p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare it jsonb; m medicines; b medicine_batches; inv uuid; f numeric; q numeric; pr numeric; tr numeric; ld numeric; net numeric;
  sub numeric:=0; tx numeric:=0; tot numeric; uid uuid; bid uuid; bn text; ex date;
begin
  if my_role() not in('super_admin','admin','inventory') then raise exception 'Not authorised'; end if;
  if not exists(select 1 from distributors where id=p_distributor and active) then raise exception 'Distributor missing or inactive'; end if;
  if coalesce(trim(p_invoice_no),'')='' then raise exception 'Supplier invoice number required'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'No items'; end if;
  if coalesce(p_discount,0)<0 or coalesce(p_freight,0)<0 then raise exception 'Discount and freight cannot be negative'; end if;
  insert into purchase_invoices(distributor_id,supplier_invoice_no,invoice_date,discount,freight,notes,created_by)
    values(p_distributor,trim(p_invoice_no),coalesce(p_date,current_date),coalesce(p_discount,0),coalesce(p_freight,0),p_notes,auth.uid()) returning id into inv;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into m from medicines where id=(it->>'medicine_id')::uuid and active;
    if not found then raise exception 'Medicine not found or inactive'; end if;
    q:=(it->>'qty')::numeric; pr:=(it->>'price')::numeric; tr:=(it->>'tax_rate')::numeric; ld:=coalesce((it->>'discount')::numeric,0);
    bn:=trim(coalesce(it->>'batch_no','')); ex:=(it->>'expiry')::date;
    if bn='' then raise exception 'Batch number required for %', m.name; end if;
    if q<=0 or pr<0 or tr<0 or tr>40 or ld<0 then raise exception 'Invalid quantity, price, tax or discount for %', m.name; end if;
    if ex is null or ex<=current_date then raise exception 'Batch % of % is expired or has no expiry', bn, m.name; end if;
    uid:=nullif(it->>'unit_id','')::uuid;
    if uid is null or uid=m.base_unit_id then f:=1;
    else
      if m.base_unit_id is null then raise exception 'Set a base unit on % before buying in another unit', m.name; end if;
      select factor into f from unit_conversions where from_unit_id=uid and to_unit_id=m.base_unit_id;
      if f is null then raise exception 'No unit conversion defined for %', m.name; end if;
    end if;
    net:=round(q*pr-ld,2); if net<0 then raise exception 'Line discount exceeds line amount for %', m.name; end if;
    sub:=sub+net; tx:=tx+round(net*tr/100,2);
    select * into b from medicine_batches where medicine_id=m.id and batch_no=bn for update;
    if found then
      if b.expiry<>ex then raise exception 'Batch % already exists with a different expiry', bn; end if;
      update medicine_batches set qty=qty+q*f where id=b.id; bid:=b.id;
    else
      insert into medicine_batches(medicine_id,batch_no,expiry,qty) values(m.id,bn,ex,q*f) returning id into bid;
    end if;
    insert into purchase_items(invoice_id,medicine_id,batch_id,qty,unit_id,unit_factor,base_qty,unit_price,tax_rate,line_discount,line_net)
      values(inv,m.id,bid,q,uid,f,q*f,pr,tr,ld,net);
    insert into stock_movements(medicine_id,batch_id,movement_type,qty,ref_type,ref_id,created_by)
      values(m.id,bid,'purchase_in',q*f,'purchase_invoice',inv,auth.uid());
    update medicines set purchase_price=round(pr/f,2) where id=m.id;   -- cost per base unit
  end loop;
  tot:=sub+tx-coalesce(p_discount,0)+coalesce(p_freight,0); if tot<0 then raise exception 'Discount exceeds invoice total'; end if;
  update purchase_invoices set subtotal=sub,tax=tx,total=tot where id=inv;
  insert into audit_logs(actor,action,detail) values(auth.uid(),'purchase_confirmed',jsonb_build_object('invoice',inv,'total',tot));
  return inv;
end $$;

create or replace function public.purchase_list(p_limit int default 100)
returns table(id uuid, supplier_invoice_no text, invoice_date date, distributor text, status text, total numeric)
language sql stable security definer set search_path=public as $$
  select i.id,i.supplier_invoice_no,i.invoice_date,d.name,i.status,
         case when my_role() in('super_admin','admin') then i.total end
  from purchase_invoices i join distributors d on d.id=i.distributor_id
  where my_role() in('super_admin','admin','inventory') order by i.created_at desc limit least(p_limit,500) $$;

create or replace function public.purchase_history(p_medicine uuid)
returns table(invoice_date date, supplier_invoice_no text, distributor text, batch_no text, qty numeric, unit_price numeric, tax_rate numeric, current_cost numeric)
language plpgsql stable security definer set search_path=public as $$
begin
  if my_role() not in('super_admin','admin') then raise exception 'Not authorised'; end if;
  return query select i.invoice_date,i.supplier_invoice_no,d.name,b.batch_no,pi.qty,pi.unit_price,pi.tax_rate,
    (select purchase_price from medicines where id=p_medicine)
  from purchase_items pi join purchase_invoices i on i.id=pi.invoice_id join distributors d on d.id=i.distributor_id
  join medicine_batches b on b.id=pi.batch_id where pi.medicine_id=p_medicine order by i.invoice_date desc, i.created_at desc limit 50;
end $$;
revoke all on function public.confirm_purchase, public.purchase_list, public.purchase_history from public, anon;
grant execute on function public.confirm_purchase, public.purchase_list, public.purchase_history to authenticated;
