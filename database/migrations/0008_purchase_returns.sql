-- ALZA PHARMACY: branch-scoped supplier purchase returns
-- This file documents the migration already applied in the Supabase project.
-- Do NOT rerun against a database where these objects already exist.

begin;

create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  purchase_invoice_id uuid not null references public.purchase_invoices(id),
  distributor_id uuid not null references public.distributors(id),
  return_no text not null,
  reason text not null,
  total_value numeric(14,2) not null default 0 check (total_value >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (branch_id, return_no)
);

create table if not exists public.purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  purchase_return_id uuid not null references public.purchase_returns(id),
  purchase_item_id uuid not null references public.purchase_items(id),
  medicine_id uuid not null references public.medicines(id),
  batch_id uuid not null references public.medicine_batches(id),
  qty numeric not null check (qty > 0),
  unit_factor numeric not null check (unit_factor > 0),
  base_qty numeric not null check (base_qty > 0),
  unit_price numeric not null check (unit_price >= 0),
  line_value numeric(14,2) not null default 0 check (line_value >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_purchase_returns_branch_date
  on public.purchase_returns(branch_id, created_at desc);
create index if not exists idx_purchase_return_items_header
  on public.purchase_return_items(purchase_return_id);
create index if not exists idx_purchase_return_items_purchase_item
  on public.purchase_return_items(purchase_item_id);

alter table public.purchase_returns enable row level security;
alter table public.purchase_return_items enable row level security;

revoke all on public.purchase_returns from anon;
revoke all on public.purchase_return_items from anon;
revoke insert, update, delete on public.purchase_returns from authenticated;
revoke insert, update, delete on public.purchase_return_items from authenticated;
grant select on public.purchase_returns, public.purchase_return_items to authenticated;

drop policy if exists purchase_returns_branch_read on public.purchase_returns;
create policy purchase_returns_branch_read on public.purchase_returns
for select to authenticated
using (branch_id = public.my_branch_id()
  and coalesce(public.my_role(), '') in ('super_admin','admin','inventory'));

drop policy if exists purchase_return_items_branch_read on public.purchase_return_items;
create policy purchase_return_items_branch_read on public.purchase_return_items
for select to authenticated
using (branch_id = public.my_branch_id()
  and coalesce(public.my_role(), '') in ('super_admin','admin','inventory'));

create or replace function public.purchase_returnable(p_invoice uuid)
returns table (
  purchase_item_id uuid, medicine_id uuid, medicine_name text,
  batch_id uuid, batch_no text, purchased_qty numeric, returned_qty numeric,
  remaining_qty numeric, unit_factor numeric, base_qty numeric,
  unit_price numeric, tax_rate numeric
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_branch uuid;
begin
  v_branch := public.my_branch_id();
  if auth.uid() is null or v_branch is null then raise exception 'Login and active branch required'; end if;
  if coalesce(public.my_role(), '') not in ('super_admin','admin','inventory') then raise exception 'Not authorised'; end if;
  if not exists (select 1 from public.purchase_invoices pi where pi.id=p_invoice and pi.branch_id=v_branch) then
    raise exception 'Purchase invoice not found in this branch';
  end if;
  return query
  select p.id,p.medicine_id,m.name::text,b.id,b.batch_no::text,p.qty,
    coalesce(r.returned_qty,0),greatest(p.qty-coalesce(r.returned_qty,0),0),
    p.unit_factor,p.base_qty,p.unit_price,p.tax_rate
  from public.purchase_items p
  join public.medicines m on m.id=p.medicine_id and m.branch_id=v_branch
  join public.medicine_batches b on b.id=p.batch_id and b.branch_id=v_branch
  left join (
    select pri.purchase_item_id,sum(pri.qty) returned_qty
    from public.purchase_return_items pri where pri.branch_id=v_branch
    group by pri.purchase_item_id
  ) r on r.purchase_item_id=p.id
  where p.invoice_id=p_invoice and p.branch_id=v_branch
  order by m.name,b.batch_no;
end;
$$;

create or replace function public.process_purchase_return(
  p_invoice uuid,p_items jsonb,p_reason text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_branch uuid; v_return uuid; v_return_no text; v_item jsonb;
  v_purchase_item public.purchase_items%rowtype;
  v_batch public.medicine_batches%rowtype;
  v_qty numeric; v_base_qty numeric; v_returned numeric;
  v_line_value numeric; v_total numeric := 0;
begin
  v_branch := public.my_branch_id();
  if auth.uid() is null or v_branch is null then raise exception 'Login and active branch required'; end if;
  if coalesce(public.my_role(), '') not in ('super_admin','admin','inventory') then raise exception 'Not authorised'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Return reason is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'Select at least one item to return'; end if;

  perform 1 from public.purchase_invoices pi
  where pi.id=p_invoice and pi.branch_id=v_branch for update;
  if not found then raise exception 'Purchase invoice not found in this branch'; end if;

  v_return_no := 'PR-' || to_char(now() at time zone 'Asia/Kolkata','YYMMDD-HH24MISS')
    || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.purchase_returns(branch_id,purchase_invoice_id,distributor_id,return_no,reason,created_by)
  select v_branch,pi.id,pi.distributor_id,v_return_no,trim(p_reason),auth.uid()
  from public.purchase_invoices pi where pi.id=p_invoice and pi.branch_id=v_branch
  returning id into v_return;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'purchase_item_id','')='' then raise exception 'Purchase item ID is required'; end if;
    v_qty := (v_item->>'qty')::numeric;
    if v_qty is null or v_qty<=0 then raise exception 'Return quantity must be greater than zero'; end if;

    select * into v_purchase_item from public.purchase_items p
    where p.id=(v_item->>'purchase_item_id')::uuid and p.invoice_id=p_invoice and p.branch_id=v_branch
    for update;
    if not found then raise exception 'Purchase item not found in this invoice'; end if;

    select coalesce(sum(pri.qty),0) into v_returned from public.purchase_return_items pri
    where pri.purchase_item_id=v_purchase_item.id and pri.branch_id=v_branch;
    if v_qty > v_purchase_item.qty-v_returned then raise exception 'Return quantity exceeds remaining purchased quantity'; end if;

    v_base_qty := v_qty*v_purchase_item.unit_factor;
    select * into v_batch from public.medicine_batches b
    where b.id=v_purchase_item.batch_id and b.branch_id=v_branch and b.medicine_id=v_purchase_item.medicine_id
    for update;
    if not found then raise exception 'Original purchase batch not found'; end if;
    if v_batch.qty < v_base_qty then
      raise exception 'Insufficient stock in batch %: available %, requested %',v_batch.batch_no,v_batch.qty,v_base_qty;
    end if;

    v_line_value := round((v_purchase_item.line_net/v_purchase_item.qty)*v_qty*(1+v_purchase_item.tax_rate/100),2);

    update public.medicine_batches set qty=qty-v_base_qty
    where id=v_batch.id and branch_id=v_branch;

    insert into public.purchase_return_items(
      branch_id,purchase_return_id,purchase_item_id,medicine_id,batch_id,
      qty,unit_factor,base_qty,unit_price,line_value
    ) values (
      v_branch,v_return,v_purchase_item.id,v_purchase_item.medicine_id,v_purchase_item.batch_id,
      v_qty,v_purchase_item.unit_factor,v_base_qty,v_purchase_item.unit_price,v_line_value
    );

    insert into public.stock_movements(
      branch_id,medicine_id,batch_id,movement_type,qty,ref_type,ref_id,created_by,reason
    ) values (
      v_branch,v_purchase_item.medicine_id,v_purchase_item.batch_id,'return_out',
      -v_base_qty,'purchase_return',v_return,auth.uid(),'Supplier return '||v_return_no
    );
    v_total := v_total+v_line_value;
  end loop;

  update public.purchase_returns set total_value=round(v_total,2)
  where id=v_return and branch_id=v_branch;

  insert into public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  values (v_branch,auth.uid(),'purchase_return_created','purchase_return',v_return::text,trim(p_reason),null,
    jsonb_build_object('return_id',v_return,'return_no',v_return_no,'purchase_invoice_id',p_invoice,'total_value',round(v_total,2)),now());
  return v_return;
end;
$$;

revoke all on function public.purchase_returnable(uuid) from public, anon;
revoke all on function public.process_purchase_return(uuid,jsonb,text) from public, anon;
grant execute on function public.purchase_returnable(uuid) to authenticated;
grant execute on function public.process_purchase_return(uuid,jsonb,text) to authenticated;

commit;
