-- ALZA PHARMACY: branch-safe customer returns (Cash / UPI only)
-- Run in Supabase SQL Editor after the existing 0001-0006 migrations.
-- Does NOT install the Phase 4/5 finance ledger or alter billing/finalize_sale.

create sequence if not exists public.sales_return_doc_seq;

create table if not exists public.sales_returns (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  return_no text not null unique,
  invoice_id uuid not null references public.sales_invoices(id),
  customer_id uuid references public.customers(id),
  reason text not null check (length(trim(reason)) > 0),
  refund_method text not null check (refund_method in ('cash','upi')),
  total numeric(12,2) not null default 0 check (total >= 0),
  tax numeric(12,2) not null default 0 check (tax >= 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sales_return_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  return_id uuid not null references public.sales_returns(id),
  sales_item_id uuid not null references public.sales_items(id),
  medicine_id uuid not null references public.medicines(id),
  batch_id uuid not null references public.medicine_batches(id),
  qty numeric(14,3) not null check (qty > 0),
  disposition text not null check (disposition in ('restock','damaged')),
  line_total numeric(12,2) not null check (line_total > 0)
);

create index if not exists sales_returns_branch_created_idx
  on public.sales_returns(branch_id, created_at desc);
create index if not exists sales_return_items_return_idx
  on public.sales_return_items(branch_id, return_id);

alter table public.sales_returns enable row level security;
alter table public.sales_return_items enable row level security;

revoke all on public.sales_returns from anon;
revoke all on public.sales_return_items from anon;
revoke insert, update, delete on public.sales_returns from authenticated;
revoke insert, update, delete on public.sales_return_items from authenticated;
grant select on public.sales_returns, public.sales_return_items to authenticated;

drop policy if exists sales_returns_branch_select on public.sales_returns;
create policy sales_returns_branch_select on public.sales_returns
for select to authenticated
using (
  branch_id = public.my_branch_id()
  and coalesce(public.my_role(),'') in ('super_admin','admin','pharmacist')
);

drop policy if exists sales_return_items_branch_select on public.sales_return_items;
create policy sales_return_items_branch_select on public.sales_return_items
for select to authenticated
using (
  branch_id = public.my_branch_id()
  and coalesce(public.my_role(),'') in ('super_admin','admin','pharmacist')
);

create or replace function public.invoice_search(p_q text default '', p_limit integer default 10)
returns table (
  id uuid, invoice_no text, customer_name text, total numeric, created_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
declare v_branch uuid := public.my_branch_id();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin','pharmacist') then
    raise exception 'Not authorised';
  end if;
  if v_branch is null then raise exception 'No branch assigned'; end if;

  return query
  select i.id, i.invoice_no, coalesce(c.name, 'Walk-in'), i.total, i.created_at
  from public.sales_invoices i
  left join public.customers c
    on c.id = i.customer_id and c.branch_id = v_branch
  where i.branch_id = v_branch
    and i.status = 'final'
    and (
      coalesce(trim(p_q),'') = ''
      or i.invoice_no ilike '%' || trim(p_q) || '%'
      or coalesce(c.name,'') ilike '%' || trim(p_q) || '%'
      or coalesce(c.phone,'') ilike '%' || trim(p_q) || '%'
    )
  order by i.created_at desc
  limit greatest(1, least(coalesce(p_limit,10),50));
end;
$$;

create or replace function public.returnable_items(p_invoice uuid)
returns table (
  sales_item_id uuid, name text, strength text, batch_no text,
  qty_sold numeric, qty_returned numeric, unit_refund numeric
)
language plpgsql stable security definer set search_path = public
as $$
declare v_branch uuid := public.my_branch_id();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin','pharmacist') then
    raise exception 'Not authorised';
  end if;
  if not exists (
    select 1 from public.sales_invoices i
    where i.id = p_invoice and i.branch_id = v_branch and i.status = 'final'
  ) then raise exception 'Invoice not found'; end if;

  return query
  select si.id, m.name, m.strength, b.batch_no, si.qty,
         coalesce(r.returned_qty,0),
         case when i.subtotal > 0
              then round(si.unit_price * (i.total / i.subtotal), 2)
              else round(si.unit_price, 2) end
  from public.sales_items si
  join public.sales_invoices i on i.id = si.invoice_id and i.branch_id = v_branch
  join public.medicines m on m.id = si.medicine_id and m.branch_id = v_branch
  join public.medicine_batches b on b.id = si.batch_id and b.branch_id = v_branch
  left join (
    select sri.sales_item_id, sum(sri.qty) as returned_qty
    from public.sales_return_items sri
    join public.sales_returns sr on sr.id = sri.return_id and sr.branch_id = v_branch
    where sri.branch_id = v_branch
    group by sri.sales_item_id
  ) r on r.sales_item_id = si.id
  where si.invoice_id = p_invoice and si.branch_id = v_branch
  order by m.name, b.batch_no;
end;
$$;

create or replace function public.process_sales_return(
  p_invoice uuid, p_items jsonb, p_method text, p_reason text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_branch uuid := public.my_branch_id();
  v_role text := coalesce(public.my_role(),'');
  inv public.sales_invoices%rowtype;
  si public.sales_items%rowtype;
  it jsonb;
  rq numeric;
  done numeric;
  factor numeric;
  line_amount numeric;
  line_tax numeric;
  subtotal_return numeric := 0;
  tax_return numeric := 0;
  disposition text;
  return_id uuid;
  return_number text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_role not in ('super_admin','admin','pharmacist') then raise exception 'Not authorised'; end if;
  if v_branch is null then raise exception 'No branch assigned'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  if p_method not in ('cash','upi') then raise exception 'Refund method must be Cash or UPI'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Nothing selected to return';
  end if;

  select * into inv
  from public.sales_invoices
  where id = p_invoice and branch_id = v_branch and status = 'final'
  for update;
  if not found then raise exception 'Invoice not found'; end if;

  factor := case when inv.subtotal > 0 then inv.total / inv.subtotal else 1 end;
  return_number := 'CN-' || to_char(now() at time zone 'Asia/Kolkata','YYMM')
                   || '-' || lpad(nextval('public.sales_return_doc_seq')::text,6,'0');

  insert into public.sales_returns
    (branch_id, return_no, invoice_id, customer_id, reason, refund_method, created_by)
  values
    (v_branch, return_number, p_invoice, inv.customer_id, trim(p_reason), p_method, auth.uid())
  returning id into return_id;

  for it in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(it->>'sales_item_id','') = '' then raise exception 'Invalid sale item'; end if;
    select * into si
    from public.sales_items
    where id = (it->>'sales_item_id')::uuid
      and invoice_id = p_invoice
      and branch_id = v_branch;
    if not found then raise exception 'Item does not belong to this invoice'; end if;

    rq := (it->>'qty')::numeric;
    if rq is null or rq <= 0 then raise exception 'Invalid return quantity'; end if;

    select coalesce(sum(sri.qty),0) into done
    from public.sales_return_items sri
    join public.sales_returns sr on sr.id = sri.return_id
    where sri.sales_item_id = si.id and sr.branch_id = v_branch;
    if done + rq > si.qty then
      raise exception 'Cannot return more than sold. Sold %, already returned %', si.qty, done;
    end if;

    disposition := coalesce(it->>'disposition','restock');
    if disposition not in ('restock','damaged') then raise exception 'Invalid item condition'; end if;

    line_amount := round(si.unit_price * rq * factor, 2);
    line_tax := case when (100 + si.tax_rate) > 0
                     then round(line_amount * si.tax_rate / (100 + si.tax_rate), 2)
                     else 0 end;
    if line_amount <= 0 then raise exception 'Return amount must be positive'; end if;

    insert into public.sales_return_items
      (branch_id, return_id, sales_item_id, medicine_id, batch_id, qty, disposition, line_total)
    values
      (v_branch, return_id, si.id, si.medicine_id, si.batch_id, rq, disposition, line_amount);

    if disposition = 'restock' then
      update public.medicine_batches
      set qty = qty + rq
      where id = si.batch_id and medicine_id = si.medicine_id and branch_id = v_branch;
      if not found then raise exception 'Original batch not found in this branch'; end if;

      insert into public.stock_movements
        (branch_id, medicine_id, batch_id, movement_type, qty, ref_type, ref_id, created_by, reason)
      values
        (v_branch, si.medicine_id, si.batch_id, 'return_in', rq,
         'sales_return', return_id, auth.uid(), 'Customer return ' || return_number);
    end if;

    subtotal_return := subtotal_return + line_amount;
    tax_return := tax_return + line_tax;
  end loop;

  if subtotal_return <= 0 then raise exception 'Return amount is zero'; end if;

  update public.sales_returns
  set total = subtotal_return, tax = tax_return
  where id = return_id and branch_id = v_branch;

  insert into public.audit_logs
    (branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  values
    (v_branch, auth.uid(), 'sales_return_created', 'sales_return', return_id::text,
     trim(p_reason), null,
     jsonb_build_object('return_no', return_number, 'invoice_id', p_invoice,
                        'total', subtotal_return, 'tax', tax_return,
                        'refund_method', p_method));

  return return_id;
end;
$$;

revoke all on function public.invoice_search(text, integer) from public, anon;
revoke all on function public.returnable_items(uuid) from public, anon;
revoke all on function public.process_sales_return(uuid, jsonb, text, text) from public, anon;
grant execute on function public.invoice_search(text, integer) to authenticated;
grant execute on function public.returnable_items(uuid) to authenticated;
grant execute on function public.process_sales_return(uuid, jsonb, text, text) to authenticated;
