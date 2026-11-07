-- ALZA PHARMACY
-- Phase 3: branch-safe inventory control
-- Run AFTER 0005_purchasing.sql.
-- Re-runnable. This version matches the existing audit_logs and stock_movements schemas.

begin;

-- 1. Reorder level and stock movement reason/type support.
alter table public.medicines
  add column if not exists reorder_level numeric(14,3) default 0;

update public.medicines
set reorder_level = 0
where reorder_level is null;

alter table public.medicines
  alter column reorder_level set default 0,
  alter column reorder_level set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.medicines'::regclass
      and conname = 'medicines_reorder_level_nonnegative_check'
  ) then
    alter table public.medicines
      add constraint medicines_reorder_level_nonnegative_check
      check (reorder_level >= 0);
  end if;
end
$$;

grant select (reorder_level) on public.medicines to authenticated;
grant insert (reorder_level) on public.medicines to authenticated;
grant update (reorder_level) on public.medicines to authenticated;

alter table public.stock_movements
  add column if not exists reason text;

alter table public.stock_movements
  drop constraint if exists stock_movements_movement_type_check;

alter table public.stock_movements
  add constraint stock_movements_movement_type_check
  check (movement_type in (
    'purchase_in', 'sale_out', 'adjustment', 'return_in', 'return_out',
    'damage', 'transfer', 'expiry_writeoff', 'physical_count'
  ));

-- 2. Record sale movements only. finalize_sale() remains responsible for
-- deducting batch quantity; this trigger deliberately does NOT deduct it again.
create or replace function public.sales_items_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.medicine_batches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if new.branch_id is null or new.branch_id <> public.my_branch_id() then
    raise exception 'Sale item branch does not match the current branch';
  end if;

  select *
    into v_batch
  from public.medicine_batches
  where id = new.batch_id
    and branch_id = new.branch_id
  for update;

  if not found then
    raise exception 'Batch not found in this branch';
  end if;

  if v_batch.medicine_id <> new.medicine_id then
    raise exception 'Sale medicine does not match the selected batch';
  end if;

  if v_batch.expiry < current_date or v_batch.quarantined then
    raise exception 'Batch % cannot be sold (expired or quarantined)', v_batch.batch_no;
  end if;

  insert into public.stock_movements
    (branch_id, medicine_id, batch_id, movement_type, qty,
     ref_type, ref_id, created_by, reason)
  values
    (new.branch_id, new.medicine_id, new.batch_id, 'sale_out', -new.qty,
     'sales_invoice', new.invoice_id::text, auth.uid(), 'Sale');

  return new;
end;
$$;

drop trigger if exists sales_items_guard_t on public.sales_items;

create trigger sales_items_guard_t
after insert on public.sales_items
for each row
execute function public.sales_items_guard();

-- 3. Manual stock adjustment. Batch updates are always restricted to the
-- caller's active branch and all movements/audit records include that branch.
create or replace function public.adjust_stock(
  p_batch uuid,
  p_delta numeric,
  p_type text,
  p_reason text
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch uuid;
  v_batch public.medicine_batches%rowtype;
  v_new_qty numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_branch := public.my_branch_id();
  if v_branch is null then
    raise exception 'No active branch assigned';
  end if;

  if coalesce(public.my_role(), '') not in
    ('super_admin', 'admin', 'pharmacist', 'inventory') then
    raise exception 'Not authorised';
  end if;

  if p_type not in ('adjustment', 'damage', 'expiry_writeoff') then
    raise exception 'Invalid adjustment type';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'Quantity must not be zero';
  end if;
  if p_type <> 'adjustment' and p_delta > 0 then
    raise exception 'Damage and write-off must reduce stock';
  end if;

  select *
    into v_batch
  from public.medicine_batches
  where id = p_batch
    and branch_id = v_branch
  for update;

  if not found then
    raise exception 'Batch not found in this branch';
  end if;

  v_new_qty := v_batch.qty + p_delta;
  if v_new_qty < 0 then
    raise exception 'Stock cannot go below zero (current %)', v_batch.qty;
  end if;

  update public.medicine_batches
  set qty = v_new_qty
  where id = v_batch.id
    and branch_id = v_branch;

  insert into public.stock_movements
    (branch_id, medicine_id, batch_id, movement_type, qty,
     ref_type, reason, created_by)
  values
    (v_branch, v_batch.medicine_id, v_batch.id, p_type, p_delta,
     'manual', trim(p_reason), auth.uid());

  insert into public.audit_logs
    (branch_id, user_id, action, entity_type, entity_id,
     reason, before_data, after_data, at)
  values
    (v_branch, auth.uid(), 'stock_' || p_type, 'medicine_batch',
     v_batch.id::text, trim(p_reason),
     jsonb_build_object('qty', v_batch.qty),
     jsonb_build_object('qty', v_new_qty), now());

  return v_new_qty;
end;
$$;

-- 4. Quarantine/release a batch, scoped to the active branch.
create or replace function public.set_quarantine(
  p_batch uuid,
  p_flag boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch uuid;
  v_batch public.medicine_batches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_branch := public.my_branch_id();
  if v_branch is null then
    raise exception 'No active branch assigned';
  end if;

  if coalesce(public.my_role(), '') not in
    ('super_admin', 'admin', 'pharmacist', 'inventory') then
    raise exception 'Not authorised';
  end if;

  if p_flag is null then
    raise exception 'Quarantine flag is required';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required';
  end if;

  select *
    into v_batch
  from public.medicine_batches
  where id = p_batch
    and branch_id = v_branch
  for update;

  if not found then
    raise exception 'Batch not found in this branch';
  end if;

  update public.medicine_batches
  set quarantined = p_flag
  where id = v_batch.id
    and branch_id = v_branch;

  insert into public.audit_logs
    (branch_id, user_id, action, entity_type, entity_id,
     reason, before_data, after_data, at)
  values
    (v_branch, auth.uid(),
     case when p_flag then 'batch_quarantined' else 'batch_released' end,
     'medicine_batch', v_batch.id::text, trim(p_reason),
     jsonb_build_object('quarantined', v_batch.quarantined),
     jsonb_build_object('quarantined', p_flag), now());
end;
$$;

-- 5. Physical count. Each item must contain batch_id and counted.
create or replace function public.physical_count(
  p_counts jsonb,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch uuid;
  v_item jsonb;
  v_batch public.medicine_batches%rowtype;
  v_counted numeric;
  v_delta numeric;
  v_adjusted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_branch := public.my_branch_id();
  if v_branch is null then
    raise exception 'No active branch assigned';
  end if;

  if coalesce(public.my_role(), '') not in
    ('super_admin', 'admin', 'pharmacist', 'inventory') then
    raise exception 'Not authorised';
  end if;

  if jsonb_typeof(p_counts) <> 'array' then
    raise exception 'Counts must be a JSON array';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_counts)
  loop
    if not (v_item ? 'batch_id') or not (v_item ? 'counted') then
      raise exception 'Each count needs batch_id and counted';
    end if;

    v_counted := (v_item ->> 'counted')::numeric;
    if v_counted < 0 then
      raise exception 'Counted quantity cannot be negative';
    end if;

    select *
      into v_batch
    from public.medicine_batches
    where id = (v_item ->> 'batch_id')::uuid
      and branch_id = v_branch
    for update;

    if not found then
      raise exception 'Batch not found in this branch';
    end if;

    v_delta := v_counted - v_batch.qty;
    if v_delta <> 0 then
      update public.medicine_batches
      set qty = v_counted
      where id = v_batch.id
        and branch_id = v_branch;

      insert into public.stock_movements
        (branch_id, medicine_id, batch_id, movement_type, qty,
         ref_type, reason, created_by)
      values
        (v_branch, v_batch.medicine_id, v_batch.id, 'physical_count',
         v_delta, 'physical_count', trim(p_note), auth.uid());

      v_adjusted := v_adjusted + 1;
    end if;
  end loop;

  insert into public.audit_logs
    (branch_id, user_id, action, entity_type, entity_id,
     reason, before_data, after_data, at)
  values
    (v_branch, auth.uid(), 'physical_count', 'inventory',
     null, trim(p_note), null,
     jsonb_build_object('adjusted_batches', v_adjusted), now());

  return v_adjusted;
end;
$$;

-- 6. Branch-scoped inventory list. Return columns remain compatible with
-- the existing Inventory page.
create or replace function public.inventory_batches(p_search text default null)
returns table(
  batch_id uuid,
  medicine_id uuid,
  name text,
  strength text,
  batch_no text,
  expiry date,
  qty numeric,
  quarantined boolean,
  location text,
  status text,
  cost_value numeric,
  reorder_level numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    b.id,
    m.id,
    m.name,
    m.strength,
    b.batch_no,
    b.expiry,
    b.qty,
    b.quarantined,
    concat_ws(' ', m.shelf_location, m.rack),
    case
      when b.expiry < current_date then 'expired'
      when b.quarantined then 'quarantined'
      else 'ok'
    end,
    case
      when coalesce(public.my_role(), '') in ('super_admin', 'admin')
        then round(b.qty * coalesce(m.purchase_price, 0), 2)
      else null
    end,
    m.reorder_level
  from public.medicine_batches b
  join public.medicines m
    on m.id = b.medicine_id
   and m.branch_id = b.branch_id
  where auth.uid() is not null
    and public.my_branch_id() is not null
    and b.branch_id = public.my_branch_id()
    and coalesce(public.my_role(), '') in
      ('super_admin', 'admin', 'pharmacist', 'inventory')
    and (
      p_search is null
      or m.name ilike '%' || p_search || '%'
      or b.batch_no ilike '%' || p_search || '%'
      or m.barcode = p_search
    )
  order by m.name, b.expiry
  limit 1000;
$$;

-- 7. Branch-scoped low-stock report.
create or replace function public.low_stock()
returns table(
  medicine_id uuid,
  name text,
  sellable numeric,
  reorder_level numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.id,
    m.name,
    coalesce(
      sum(b.qty) filter (
        where b.expiry >= current_date and not b.quarantined
      ), 0
    ) as sellable,
    m.reorder_level
  from public.medicines m
  left join public.medicine_batches b
    on b.medicine_id = m.id
   and b.branch_id = m.branch_id
  where auth.uid() is not null
    and public.my_branch_id() is not null
    and m.branch_id = public.my_branch_id()
    and coalesce(public.my_role(), '') in
      ('super_admin', 'admin', 'pharmacist', 'inventory')
    and m.active
    and m.reorder_level > 0
  group by m.id, m.name, m.reorder_level
  having coalesce(
    sum(b.qty) filter (
      where b.expiry >= current_date and not b.quarantined
    ), 0
  ) <= m.reorder_level
  order by sellable;
$$;

-- 8. Branch-scoped valuation; only admins can view purchase-cost totals.
create or replace function public.inventory_valuation()
returns table(
  cost_total numeric,
  cost_sellable numeric,
  cost_expired numeric,
  cost_quarantined numeric,
  retail_sellable numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_branch := public.my_branch_id();
  if v_branch is null then
    raise exception 'No active branch assigned';
  end if;

  if coalesce(public.my_role(), '') not in ('super_admin', 'admin') then
    raise exception 'Not authorised';
  end if;

  return query
  select
    coalesce(sum(b.qty * coalesce(m.purchase_price, 0)), 0)::numeric,
    coalesce(sum(b.qty * coalesce(m.purchase_price, 0))
      filter (where b.expiry >= current_date and not b.quarantined), 0)::numeric,
    coalesce(sum(b.qty * coalesce(m.purchase_price, 0))
      filter (where b.expiry < current_date), 0)::numeric,
    coalesce(sum(b.qty * coalesce(m.purchase_price, 0))
      filter (where b.expiry >= current_date and b.quarantined), 0)::numeric,
    coalesce(sum(b.qty * m.selling_price)
      filter (where b.expiry >= current_date and not b.quarantined), 0)::numeric
  from public.medicine_batches b
  join public.medicines m
    on m.id = b.medicine_id
   and m.branch_id = b.branch_id
  where b.branch_id = v_branch;
end;
$$;

-- 9. Restrict direct batch writes; controlled SECURITY DEFINER functions above
-- perform branch checks and write the audit/stock movement records.
revoke insert, update, delete on public.medicine_batches from authenticated;

revoke all on function public.sales_items_guard() from public, anon;
revoke all on function public.adjust_stock(uuid, numeric, text, text) from public, anon;
revoke all on function public.set_quarantine(uuid, boolean, text) from public, anon;
revoke all on function public.physical_count(jsonb, text) from public, anon;
revoke all on function public.inventory_batches(text) from public, anon;
revoke all on function public.low_stock() from public, anon;
revoke all on function public.inventory_valuation() from public, anon;

grant execute on function public.adjust_stock(uuid, numeric, text, text) to authenticated;
grant execute on function public.set_quarantine(uuid, boolean, text) to authenticated;
grant execute on function public.physical_count(jsonb, text) to authenticated;
grant execute on function public.inventory_batches(text) to authenticated;
grant execute on function public.low_stock() to authenticated;
grant execute on function public.inventory_valuation() to authenticated;

commit;
