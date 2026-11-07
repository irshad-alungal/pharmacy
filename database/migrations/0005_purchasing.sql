
-- ALZA PHARMACY
-- Phase 2: Purchasing and Stock-In
-- Run after 0004_master_data.sql
-- Branch-aware version for the existing database.

begin;

-- =====================================================
-- 1. DISTRIBUTORS
-- =====================================================

create table if not exists public.distributors (
    id uuid primary key default gen_random_uuid(),
    branch_id uuid not null references public.branches(id),
    name text not null,
    contact_person text,
    phone text,
    email text,
    address text,
    gstin text,
    drug_licence text,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists distributors_branch_idx
    on public.distributors(branch_id);

create unique index if not exists distributors_name_branch_u
    on public.distributors(branch_id, lower(name));

create unique index if not exists distributors_gstin_branch_u
    on public.distributors(branch_id, gstin)
    where gstin is not null;


-- =====================================================
-- 2. PURCHASE INVOICES
-- =====================================================

create table if not exists public.purchase_invoices (
    id uuid primary key default gen_random_uuid(),
    branch_id uuid not null references public.branches(id),
    distributor_id uuid not null references public.distributors(id),
    supplier_invoice_no text not null,
    invoice_date date not null,
    status text not null default 'confirmed'
        check (status in ('confirmed', 'cancelled')),
    subtotal numeric(12,2) not null default 0,
    tax numeric(12,2) not null default 0,
    discount numeric(12,2) not null default 0,
    freight numeric(12,2) not null default 0,
    total numeric(12,2) not null default 0,
    notes text,
    created_by uuid references public.profiles(id),
    created_at timestamptz not null default now(),
    unique(branch_id, distributor_id, supplier_invoice_no)
);

create index if not exists purchase_invoices_branch_date_idx
    on public.purchase_invoices(branch_id, invoice_date desc);


-- =====================================================
-- 3. PURCHASE ITEMS
-- =====================================================

create table if not exists public.purchase_items (
    id uuid primary key default gen_random_uuid(),
    branch_id uuid not null references public.branches(id),
    invoice_id uuid not null references public.purchase_invoices(id),
    medicine_id uuid not null references public.medicines(id),
    batch_id uuid not null references public.medicine_batches(id),
    qty numeric(14,3) not null check (qty > 0),
    unit_id uuid references public.units(id),
    unit_factor numeric(14,4) not null check (unit_factor > 0),
    base_qty numeric(14,3) not null,
    unit_price numeric(12,2) not null check (unit_price >= 0),
    tax_rate numeric(5,2) not null,
    line_discount numeric(12,2) not null default 0,
    line_net numeric(12,2) not null
);

create index if not exists purchase_items_branch_idx
    on public.purchase_items(branch_id);

create index if not exists purchase_items_invoice_idx
    on public.purchase_items(invoice_id);


-- =====================================================
-- 4. STOCK MOVEMENTS
-- =====================================================

create table if not exists public.stock_movements (
    id bigserial primary key,
    branch_id uuid not null references public.branches(id),
    medicine_id uuid not null references public.medicines(id),
    batch_id uuid not null references public.medicine_batches(id),
    movement_type text not null check (
        movement_type in (
            'purchase_in',
            'sale_out',
            'adjustment',
            'return_in',
            'return_out',
            'damage',
            'transfer'
        )
    ),
    qty numeric(14,3) not null,
    ref_type text,
    ref_id uuid,
    created_by uuid references public.profiles(id),
    created_at timestamptz not null default now()
);

create index if not exists sm_med_idx
    on public.stock_movements(branch_id, medicine_id, created_at desc);


-- =====================================================
-- 5. ROW LEVEL SECURITY
-- =====================================================

alter table public.distributors enable row level security;
alter table public.purchase_invoices enable row level security;
alter table public.purchase_items enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists d_sel on public.distributors;
create policy d_sel on public.distributors
for select to authenticated
using (
    branch_id = public.my_branch_id()
    and public.my_role() is not null
);

drop policy if exists d_w on public.distributors;
create policy d_w on public.distributors
for all to authenticated
using (
    branch_id = public.my_branch_id()
    and public.my_role() in ('super_admin', 'admin', 'inventory')
)
with check (
    branch_id = public.my_branch_id()
    and public.my_role() in ('super_admin', 'admin', 'inventory')
);

drop policy if exists pi_sel on public.purchase_invoices;
create policy pi_sel on public.purchase_invoices
for select to authenticated
using (
    branch_id = public.my_branch_id()
    and public.my_role() in ('super_admin', 'admin')
);

drop policy if exists pit_sel on public.purchase_items;
create policy pit_sel on public.purchase_items
for select to authenticated
using (
    branch_id = public.my_branch_id()
    and public.my_role() in ('super_admin', 'admin')
);

drop policy if exists sm_sel on public.stock_movements;
create policy sm_sel on public.stock_movements
for select to authenticated
using (
    branch_id = public.my_branch_id()
    and public.my_role() in (
        'super_admin', 'admin', 'pharmacist', 'inventory'
    )
);


-- =====================================================
-- 6. TABLE PERMISSIONS
-- =====================================================

revoke all on public.distributors,
    public.purchase_invoices,
    public.purchase_items,
    public.stock_movements
from anon;

grant select, insert, update
    on public.distributors to authenticated;

grant select
    on public.purchase_invoices,
       public.purchase_items,
       public.stock_movements
to authenticated;

revoke insert, update, delete
    on public.purchase_invoices,
       public.purchase_items,
       public.stock_movements
from authenticated;


-- =====================================================
-- 7. MEDICINE COST PROTECTION
-- Preserve existing medicine form fields.
-- Do not grant direct purchase_price updates.
-- =====================================================

revoke insert, update on public.medicines from authenticated;

revoke insert (purchase_price)
    on public.medicines from authenticated;

revoke update (purchase_price)
    on public.medicines from authenticated;

grant insert (
    branch_id,
    name,
    generic_name,
    barcode,
    sku,
    mrp,
    selling_price,
    tax_rate,
    shelf_location,
    active,
    brand,
    composition,
    strength,
    dosage_form,
    rack,
    category_id,
    manufacturer_id,
    storage_location_id,
    base_unit_id,
    reorder_level
)
on public.medicines to authenticated;

grant update (
    branch_id,
    name,
    generic_name,
    barcode,
    sku,
    mrp,
    selling_price,
    tax_rate,
    shelf_location,
    active,
    brand,
    composition,
    strength,
    dosage_form,
    rack,
    category_id,
    manufacturer_id,
    storage_location_id,
    base_unit_id,
    reorder_level
)
on public.medicines to authenticated;


-- =====================================================
-- 8. CONFIRM PURCHASE FUNCTION
-- =====================================================

create or replace function public.confirm_purchase(
    p_distributor uuid,
    p_invoice_no text,
    p_date date,
    p_discount numeric,
    p_freight numeric,
    p_items jsonb,
    p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    it jsonb;
    m public.medicines%rowtype;
    b public.medicine_batches%rowtype;
    inv uuid;
    v_branch uuid;
    f numeric;
    q numeric;
    pr numeric;
    tr numeric;
    ld numeric;
    net numeric;
    sub numeric := 0;
    tx numeric := 0;
    tot numeric;
    uid uuid;
    bid uuid;
    bn text;
    ex date;
begin
    v_branch := public.my_branch_id();

    if auth.uid() is null or v_branch is null then
        raise exception 'Login and active branch required';
    end if;

    if public.my_role() not in ('super_admin', 'admin', 'inventory') then
        raise exception 'Not authorised';
    end if;

    if not exists (
        select 1
        from public.distributors
        where id = p_distributor
          and branch_id = v_branch
          and active = true
    ) then
        raise exception 'Distributor missing or inactive in this branch';
    end if;

    if coalesce(trim(p_invoice_no), '') = '' then
        raise exception 'Supplier invoice number required';
    end if;

    if jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'No purchase items';
    end if;

    if coalesce(p_discount, 0) < 0
       or coalesce(p_freight, 0) < 0 then
        raise exception 'Discount and freight cannot be negative';
    end if;

    insert into public.purchase_invoices (
        branch_id,
        distributor_id,
        supplier_invoice_no,
        invoice_date,
        discount,
        freight,
        notes,
        created_by
    )
    values (
        v_branch,
        p_distributor,
        trim(p_invoice_no),
        coalesce(p_date, current_date),
        coalesce(p_discount, 0),
        coalesce(p_freight, 0),
        p_notes,
        auth.uid()
    )
    returning id into inv;

    for it in select * from jsonb_array_elements(p_items)
    loop
        select *
        into m
        from public.medicines
        where id = (it->>'medicine_id')::uuid
          and branch_id = v_branch
          and active = true
        for update;

        if not found then
            raise exception 'Medicine not found or inactive in this branch';
        end if;

        q := (it->>'qty')::numeric;
        pr := (it->>'price')::numeric;
        tr := (it->>'tax_rate')::numeric;
        ld := coalesce((it->>'discount')::numeric, 0);

        bn := trim(coalesce(it->>'batch_no', ''));
        ex := (it->>'expiry')::date;

        if bn = '' then
            raise exception 'Batch number required for %', m.name;
        end if;

        if q is null or q <= 0
           or pr is null or pr < 0
           or tr is null or tr < 0 or tr > 40
           or ld < 0 then
            raise exception 'Invalid quantity, price, tax or discount for %', m.name;
        end if;

        if ex is null or ex <= current_date then
            raise exception 'Batch % of % is expired or has no expiry', bn, m.name;
        end if;

        uid := nullif(it->>'unit_id', '')::uuid;

        if uid is null or uid = m.base_unit_id then
            f := 1;
        else
            if m.base_unit_id is null then
                raise exception 'Set a base unit on % before buying in another unit', m.name;
            end if;

            select factor
            into f
            from public.unit_conversions
            where from_unit_id = uid
              and to_unit_id = m.base_unit_id;

            if f is null or f <= 0 then
                raise exception 'No valid unit conversion defined for %', m.name;
            end if;
        end if;

        net := round(q * pr - ld, 2);

        if net < 0 then
            raise exception 'Line discount exceeds line amount for %', m.name;
        end if;

        sub := sub + net;
        tx := tx + round(net * tr / 100, 2);

        select *
        into b
        from public.medicine_batches
        where branch_id = v_branch
          and medicine_id = m.id
          and batch_no = bn
        for update;

        if found then
            if b.expiry <> ex then
                raise exception 'Batch % already exists with a different expiry', bn;
            end if;

            update public.medicine_batches
            set qty = qty + q * f
            where id = b.id
              and branch_id = v_branch;

            bid := b.id;
        else
            insert into public.medicine_batches (
                branch_id,
                medicine_id,
                batch_no,
                expiry,
                qty,
                quarantined
            )
            values (
                v_branch,
                m.id,
                bn,
                ex,
                q * f,
                false
            )
            returning id into bid;
        end if;

        insert into public.purchase_items (
            branch_id,
            invoice_id,
            medicine_id,
            batch_id,
            qty,
            unit_id,
            unit_factor,
            base_qty,
            unit_price,
            tax_rate,
            line_discount,
            line_net
        )
        values (
            v_branch,
            inv,
            m.id,
            bid,
            q,
            uid,
            f,
            q * f,
            pr,
            tr,
            ld,
            net
        );

        insert into public.stock_movements (
            branch_id,
            medicine_id,
            batch_id,
            movement_type,
            qty,
            ref_type,
            ref_id,
            created_by
        )
        values (
            v_branch,
            m.id,
            bid,
            'purchase_in',
            q * f,
            'purchase_invoice',
            inv,
            auth.uid()
        );

        update public.medicines
        set purchase_price = round(pr / f, 2)
        where id = m.id
          and branch_id = v_branch;
    end loop;

    tot := sub + tx - coalesce(p_discount, 0) + coalesce(p_freight, 0);

    if tot < 0 then
        raise exception 'Discount exceeds invoice total';
    end if;

    update public.purchase_invoices
    set subtotal = sub,
        tax = tx,
        total = tot
    where id = inv
      and branch_id = v_branch;

    insert into public.audit_logs (
        branch_id,
        user_id,
        action,
        entity_type,
        entity_id,
        reason,
        before_data,
        after_data,
        at
    )
    values (
        v_branch,
        auth.uid(),
        'purchase_confirmed',
        'purchase_invoice',
        inv::text,
        'Purchase stock-in',
        null,
        jsonb_build_object(
            'invoice_id', inv,
            'total', tot,
            'distributor_id', p_distributor
        ),
        now()
    );

    return inv;
end;
$$;


-- =====================================================
-- 9. PURCHASE LIST FUNCTION
-- =====================================================

create or replace function public.purchase_list(
    p_limit int default 100
)
returns table (
    id uuid,
    supplier_invoice_no text,
    invoice_date date,
    distributor text,
    status text,
    total numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select
        i.id,
        i.supplier_invoice_no,
        i.invoice_date,
        d.name,
        i.status,
        case
            when public.my_role() in ('super_admin', 'admin')
            then i.total
        end
    from public.purchase_invoices i
    join public.distributors d
      on d.id = i.distributor_id
     and d.branch_id = i.branch_id
    where i.branch_id = public.my_branch_id()
      and public.my_role() in ('super_admin', 'admin', 'inventory')
    order by i.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;


-- =====================================================
-- 10. PURCHASE HISTORY FUNCTION
-- =====================================================

create or replace function public.purchase_history(
    p_medicine uuid
)
returns table (
    invoice_date date,
    supplier_invoice_no text,
    distributor text,
    batch_no text,
    qty numeric,
    unit_price numeric,
    tax_rate numeric,
    current_cost numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
    if public.my_role() not in ('super_admin', 'admin') then
        raise exception 'Not authorised';
    end if;

    return query
    select
        i.invoice_date,
        i.supplier_invoice_no,
        d.name,
        b.batch_no,
        pi.qty,
        pi.unit_price,
        pi.tax_rate,
        (
            select mm.purchase_price
            from public.medicines mm
            where mm.id = p_medicine
              and mm.branch_id = public.my_branch_id()
        )
    from public.purchase_items pi
    join public.purchase_invoices i
      on i.id = pi.invoice_id
     and i.branch_id = pi.branch_id
    join public.distributors d
      on d.id = i.distributor_id
     and d.branch_id = i.branch_id
    join public.medicine_batches b
      on b.id = pi.batch_id
     and b.branch_id = pi.branch_id
    where pi.medicine_id = p_medicine
      and pi.branch_id = public.my_branch_id()
    order by i.invoice_date desc, i.created_at desc
    limit 50;
end;
$$;


-- =====================================================
-- 11. FUNCTION PERMISSIONS
-- =====================================================

revoke all on function public.confirm_purchase(
    uuid, text, date, numeric, numeric, jsonb, text
) from public, anon;

revoke all on function public.purchase_list(int)
    from public, anon;

revoke all on function public.purchase_history(uuid)
    from public, anon;

grant execute on function public.confirm_purchase(
    uuid, text, date, numeric, numeric, jsonb, text
) to authenticated;

grant execute on function public.purchase_list(int)
    to authenticated;

grant execute on function public.purchase_history(uuid)
    to authenticated;

commit;
