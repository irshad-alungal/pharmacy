-- Phase 3: inventory control. Run AFTER 0005. Re-runnable.
alter table medicines add column if not exists reorder_level numeric(14,3) not null default 0 check(reorder_level>=0);
grant select (reorder_level) on medicines to authenticated;
grant insert (reorder_level) on medicines to authenticated;
grant update (reorder_level) on medicines to authenticated;

alter table stock_movements add column if not exists reason text;
alter table stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check check (movement_type in
 ('purchase_in','sale_out','adjustment','return_in','return_out','damage','transfer','expiry_writeoff','physical_count'));

-- Defence in depth: a sale line can never be written for an expired/quarantined batch, and every sale logs a stock movement.
create or replace function public.sales_items_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare b medicine_batches;
begin
  select * into b from medicine_batches where id=new.batch_id;
  if b.expiry < current_date or b.quarantined then raise exception 'Batch % cannot be sold (expired or quarantined)', b.batch_no; end if;
  insert into stock_movements(medicine_id,batch_id,movement_type,qty,ref_type,ref_id,created_by)
    values(new.medicine_id,new.batch_id,'sale_out',-new.qty,'sales_invoice',new.invoice_id,auth.uid());
  return new;
end $$;
drop trigger if exists sales_items_guard_t on sales_items;
create trigger sales_items_guard_t after insert on sales_items for each row execute function sales_items_guard();

create or replace function public.adjust_stock(p_batch uuid, p_delta numeric, p_type text, p_reason text)
returns numeric language plpgsql security definer set search_path=public as $$
declare b medicine_batches;
begin
  if my_role() not in('super_admin','admin','pharmacist','inventory') then raise exception 'Not authorised'; end if;
  if p_type not in('adjustment','damage','expiry_writeoff') then raise exception 'Invalid adjustment type'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'A reason is required'; end if;
  if p_delta is null or p_delta=0 then raise exception 'Quantity must not be zero'; end if;
  if p_type<>'adjustment' and p_delta>0 then raise exception 'Damage and write-off must reduce stock'; end if;
  select * into b from medicine_batches where id=p_batch for update;
  if not found then raise exception 'Batch not found'; end if;
  if b.qty+p_delta<0 then raise exception 'Stock cannot go below zero (current %)', b.qty; end if;
  update medicine_batches set qty=qty+p_delta where id=b.id;
  insert into stock_movements(medicine_id,batch_id,movement_type,qty,ref_type,reason,created_by) values(b.medicine_id,b.id,p_type,p_delta,'manual',trim(p_reason),auth.uid());
  insert into audit_logs(actor,action,detail) values(auth.uid(),'stock_'||p_type,jsonb_build_object('batch',b.id,'delta',p_delta,'reason',p_reason));
  return b.qty+p_delta;
end $$;

create or replace function public.set_quarantine(p_batch uuid, p_flag boolean, p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if my_role() not in('super_admin','admin','pharmacist','inventory') then raise exception 'Not authorised'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'A reason is required'; end if;
  update medicine_batches set quarantined=p_flag where id=p_batch;
  if not found then raise exception 'Batch not found'; end if;
  insert into audit_logs(actor,action,detail) values(auth.uid(),case when p_flag then 'batch_quarantined' else 'batch_released' end,jsonb_build_object('batch',p_batch,'reason',p_reason));
end $$;

-- Physical verification: send only the batches you counted; differences become 'physical_count' movements.
create or replace function public.physical_count(p_counts jsonb, p_note text)
returns int language plpgsql security definer set search_path=public as $$
declare c jsonb; b medicine_batches; n int:=0; d numeric;
begin
  if my_role() not in('super_admin','admin','pharmacist','inventory') then raise exception 'Not authorised'; end if;
  if coalesce(trim(p_note),'')='' then raise exception 'A note is required'; end if;
  for c in select * from jsonb_array_elements(p_counts) loop
    if (c->>'counted')::numeric<0 then raise exception 'Counted quantity cannot be negative'; end if;
    select * into b from medicine_batches where id=(c->>'batch_id')::uuid for update;
    if not found then raise exception 'Batch not found'; end if;
    d:=(c->>'counted')::numeric-b.qty;
    if d<>0 then
      update medicine_batches set qty=qty+d where id=b.id;
      insert into stock_movements(medicine_id,batch_id,movement_type,qty,ref_type,reason,created_by) values(b.medicine_id,b.id,'physical_count',d,'physical_count',trim(p_note),auth.uid());
      n:=n+1;
    end if;
  end loop;
  insert into audit_logs(actor,action,detail) values(auth.uid(),'physical_count',jsonb_build_object('adjusted',n,'note',p_note));
  return n;
end $$;

create or replace function public.inventory_batches(p_search text default null)
returns table(batch_id uuid, medicine_id uuid, name text, strength text, batch_no text, expiry date, qty numeric, quarantined boolean,
              location text, status text, cost_value numeric, reorder_level numeric)
language sql stable security definer set search_path=public as $$
  select b.id,m.id,m.name,m.strength,b.batch_no,b.expiry,b.qty,b.quarantined,concat_ws(' ',m.shelf_location,m.rack),
    case when b.expiry<current_date then 'expired' when b.quarantined then 'quarantined' else 'ok' end,
    case when my_role() in('super_admin','admin') then round(b.qty*coalesce(m.purchase_price,0),2) end, m.reorder_level
  from medicine_batches b join medicines m on m.id=b.medicine_id
  where my_role() in('super_admin','admin','pharmacist','inventory')
    and (p_search is null or m.name ilike '%'||p_search||'%' or b.batch_no ilike '%'||p_search||'%' or m.barcode=p_search)
  order by m.name,b.expiry limit 1000 $$;

create or replace function public.low_stock()
returns table(medicine_id uuid, name text, sellable numeric, reorder_level numeric)
language sql stable security definer set search_path=public as $$
  select m.id,m.name,coalesce(sum(b.qty) filter (where b.expiry>=current_date and not b.quarantined),0) s,m.reorder_level
  from medicines m left join medicine_batches b on b.medicine_id=m.id
  where my_role() in('super_admin','admin','pharmacist','inventory') and m.active and m.reorder_level>0
  group by m.id having coalesce(sum(b.qty) filter (where b.expiry>=current_date and not b.quarantined),0)<=m.reorder_level order by s $$;

create or replace function public.inventory_valuation()
returns table(cost_total numeric, cost_sellable numeric, cost_expired numeric, cost_quarantined numeric, retail_sellable numeric)
language plpgsql stable security definer set search_path=public as $$
begin
  if my_role() not in('super_admin','admin') then raise exception 'Not authorised'; end if;
  return query select
    coalesce(sum(b.qty*coalesce(m.purchase_price,0)),0)::numeric,
    coalesce(sum(b.qty*coalesce(m.purchase_price,0)) filter (where b.expiry>=current_date and not b.quarantined),0)::numeric,
    coalesce(sum(b.qty*coalesce(m.purchase_price,0)) filter (where b.expiry<current_date),0)::numeric,
    coalesce(sum(b.qty*coalesce(m.purchase_price,0)) filter (where b.expiry>=current_date and b.quarantined),0)::numeric,
    coalesce(sum(b.qty*m.selling_price) filter (where b.expiry>=current_date and not b.quarantined),0)::numeric
  from medicine_batches b join medicines m on m.id=b.medicine_id;
end $$;
revoke all on function public.adjust_stock, public.set_quarantine, public.physical_count, public.inventory_batches, public.low_stock, public.inventory_valuation from public, anon;
grant execute on function public.adjust_stock, public.set_quarantine, public.physical_count, public.inventory_batches, public.low_stock, public.inventory_valuation to authenticated;
-- Batch rows are changed ONLY through the functions above.
revoke insert, update, delete on medicine_batches from authenticated;
