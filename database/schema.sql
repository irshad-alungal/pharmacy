
-- ============================================================
-- ALZA PHARMACY V2
-- MIGRATION FOR EXISTING SUPABASE DATABASE
--
-- PRESERVES:
-- pharmacies, branches, roles, profiles, permissions,
-- role_permissions, login_attempts, work_sessions,
-- pharmacy_settings, audit_logs.
--
-- Does not recreate existing authentication tables.
-- ============================================================


-- ============================================================
-- 1. ROLE LOOKUP
-- ============================================================

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT r.code
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
      AND p.is_active = true
    LIMIT 1;
$$;


-- ============================================================
-- 2. CURRENT STAFF BRANCH
-- ============================================================

CREATE OR REPLACE FUNCTION public.my_branch_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.branch_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
    LIMIT 1;
$$;


REVOKE ALL ON FUNCTION public.my_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_branch_id() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_branch_id() TO authenticated;


-- ============================================================
-- 3. INVOICE SEQUENCE
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS public.invoice_seq;


-- ============================================================
-- 4. MEDICINES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.medicines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    branch_id uuid NOT NULL
        REFERENCES public.branches(id),

    name text NOT NULL,
    generic_name text,

    barcode text,
    sku text,

    mrp numeric(12,2) NOT NULL CHECK (mrp >= 0),

    selling_price numeric(12,2) NOT NULL
        CHECK (selling_price >= 0),

    purchase_price numeric(12,2)
        CHECK (purchase_price >= 0),

    tax_rate numeric(5,2) NOT NULL DEFAULT 12
        CHECK (tax_rate BETWEEN 0 AND 40),

    shelf_location text,

    active boolean NOT NULL DEFAULT true,

    created_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (branch_id, barcode),
    UNIQUE (branch_id, sku)
);


CREATE INDEX IF NOT EXISTS med_name_idx
ON public.medicines (lower(name));

CREATE INDEX IF NOT EXISTS med_branch_idx
ON public.medicines (branch_id);


-- ============================================================
-- 5. MEDICINE BATCHES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.medicine_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    branch_id uuid NOT NULL
        REFERENCES public.branches(id),

    medicine_id uuid NOT NULL
        REFERENCES public.medicines(id),

    batch_no text NOT NULL,

    expiry date NOT NULL,

    qty numeric(14,3) NOT NULL DEFAULT 0
        CHECK (qty >= 0),

    quarantined boolean NOT NULL DEFAULT false,

    created_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (medicine_id, batch_no)
);


CREATE INDEX IF NOT EXISTS batch_branch_idx
ON public.medicine_batches (branch_id);

CREATE INDEX IF NOT EXISTS batch_expiry_idx
ON public.medicine_batches (expiry);


-- ============================================================
-- 6. CUSTOMERS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    branch_id uuid NOT NULL
        REFERENCES public.branches(id),

    name text NOT NULL,

    phone text NOT NULL
        CHECK (phone ~ '^[0-9+]{10,15}$'),

    consent boolean NOT NULL DEFAULT false,

    created_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (branch_id, phone)
);


CREATE INDEX IF NOT EXISTS customer_branch_idx
ON public.customers (branch_id);


-- ============================================================
-- 7. SALES INVOICES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sales_invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    branch_id uuid NOT NULL
        REFERENCES public.branches(id),

    invoice_no text NOT NULL UNIQUE,

    customer_id uuid
        REFERENCES public.customers(id),

    subtotal numeric(12,2) NOT NULL DEFAULT 0,

    discount numeric(12,2) NOT NULL DEFAULT 0,

    tax numeric(12,2) NOT NULL DEFAULT 0,

    total numeric(12,2) NOT NULL DEFAULT 0,

    status text NOT NULL DEFAULT 'final'
        CHECK (status IN ('final','cancelled','refunded')),

    created_by uuid
        REFERENCES public.profiles(id),

    created_at timestamptz NOT NULL DEFAULT now()
);


CREATE INDEX IF NOT EXISTS sales_branch_idx
ON public.sales_invoices (branch_id);

CREATE INDEX IF NOT EXISTS sales_date_idx
ON public.sales_invoices (created_at);


-- ============================================================
-- 8. SALES ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sales_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    branch_id uuid NOT NULL
        REFERENCES public.branches(id),

    invoice_id uuid NOT NULL
        REFERENCES public.sales_invoices(id),

    medicine_id uuid NOT NULL
        REFERENCES public.medicines(id),

    batch_id uuid NOT NULL
        REFERENCES public.medicine_batches(id),

    qty numeric(14,3) NOT NULL
        CHECK (qty > 0),

    unit_price numeric(12,2) NOT NULL
        CHECK (unit_price >= 0),

    tax_rate numeric(5,2) NOT NULL
        CHECK (tax_rate BETWEEN 0 AND 40),

    line_total numeric(12,2) NOT NULL
        CHECK (line_total >= 0)
);


CREATE INDEX IF NOT EXISTS sales_items_invoice_idx
ON public.sales_items (invoice_id);

CREATE INDEX IF NOT EXISTS sales_items_branch_idx
ON public.sales_items (branch_id);


-- ============================================================
-- 9. PAYMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    branch_id uuid NOT NULL
        REFERENCES public.branches(id),

    invoice_id uuid NOT NULL
        REFERENCES public.sales_invoices(id),

    method text NOT NULL
        CHECK (method IN ('cash','upi','card','credit')),

    amount numeric(12,2) NOT NULL
        CHECK (amount > 0),

    created_at timestamptz NOT NULL DEFAULT now()
);


CREATE INDEX IF NOT EXISTS payments_invoice_idx
ON public.payments (invoice_id);

CREATE INDEX IF NOT EXISTS payments_branch_idx
ON public.payments (branch_id);


-- ============================================================
-- 10. ENABLE RLS ON NEW TABLES
-- ============================================================

ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 11. REMOVE OUR PREVIOUS POLICIES
-- ============================================================

DROP POLICY IF EXISTS alza_med_read ON public.medicines;
DROP POLICY IF EXISTS alza_med_write ON public.medicines;

DROP POLICY IF EXISTS alza_batch_read ON public.medicine_batches;
DROP POLICY IF EXISTS alza_batch_write ON public.medicine_batches;

DROP POLICY IF EXISTS alza_customer_read ON public.customers;
DROP POLICY IF EXISTS alza_customer_write ON public.customers;

DROP POLICY IF EXISTS alza_invoice_read ON public.sales_invoices;
DROP POLICY IF EXISTS alza_items_read ON public.sales_items;
DROP POLICY IF EXISTS alza_payments_read ON public.payments;


-- ============================================================
-- 12. MEDICINE POLICIES
-- ============================================================

CREATE POLICY alza_med_read
ON public.medicines
FOR SELECT
TO authenticated
USING (
    branch_id = public.my_branch_id()
);

CREATE POLICY alza_med_write
ON public.medicines
FOR ALL
TO authenticated
USING (
    branch_id = public.my_branch_id()
    AND public.my_role() IN
    ('super_admin','admin','pharmacist','inventory','inventory_staff')
)
WITH CHECK (
    branch_id = public.my_branch_id()
    AND public.my_role() IN
    ('super_admin','admin','pharmacist','inventory','inventory_staff')
);


-- ============================================================
-- 13. BATCH POLICIES
-- ============================================================

CREATE POLICY alza_batch_read
ON public.medicine_batches
FOR SELECT
TO authenticated
USING (
    branch_id = public.my_branch_id()
);

CREATE POLICY alza_batch_write
ON public.medicine_batches
FOR ALL
TO authenticated
USING (
    branch_id = public.my_branch_id()
    AND public.my_role() IN
    ('super_admin','admin','pharmacist','inventory','inventory_staff')
)
WITH CHECK (
    branch_id = public.my_branch_id()
    AND public.my_role() IN
    ('super_admin','admin','pharmacist','inventory','inventory_staff')
);


-- ============================================================
-- 14. CUSTOMER POLICIES
-- ============================================================

CREATE POLICY alza_customer_read
ON public.customers
FOR SELECT
TO authenticated
USING (
    branch_id = public.my_branch_id()
);

CREATE POLICY alza_customer_write
ON public.customers
FOR ALL
TO authenticated
USING (
    branch_id = public.my_branch_id()
    AND public.my_role() IS NOT NULL
)
WITH CHECK (
    branch_id = public.my_branch_id()
    AND public.my_role() IS NOT NULL
);


-- ============================================================
-- 15. SALES POLICIES
-- ============================================================

CREATE POLICY alza_invoice_read
ON public.sales_invoices
FOR SELECT
TO authenticated
USING (
    branch_id = public.my_branch_id()
);

CREATE POLICY alza_items_read
ON public.sales_items
FOR SELECT
TO authenticated
USING (
    branch_id = public.my_branch_id()
);

CREATE POLICY alza_payments_read
ON public.payments
FOR SELECT
TO authenticated
USING (
    branch_id = public.my_branch_id()
);


-- ============================================================
-- 16. DATABASE PRIVILEGES
-- ============================================================

REVOKE ALL ON public.medicines FROM PUBLIC, anon, authenticated;

GRANT SELECT (
    id,
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
    created_at
)
ON public.medicines TO authenticated;

GRANT INSERT (
    branch_id,
    name,
    generic_name,
    barcode,
    sku,
    mrp,
    selling_price,
    tax_rate,
    shelf_location,
    active
)
ON public.medicines TO authenticated;

GRANT UPDATE (
    name,
    generic_name,
    barcode,
    sku,
    mrp,
    selling_price,
    tax_rate,
    shelf_location,
    active
)
ON public.medicines TO authenticated;


REVOKE ALL ON public.medicine_batches FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE
ON public.medicine_batches TO authenticated;


REVOKE ALL ON public.customers FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE
ON public.customers TO authenticated;


REVOKE ALL ON public.sales_invoices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.sales_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.payments FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.sales_invoices TO authenticated;
GRANT SELECT ON public.sales_items TO authenticated;
GRANT SELECT ON public.payments TO authenticated;


-- ============================================================
-- 17. FINALIZE SALE
-- Branch-aware, atomic billing and stock deduction.
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalize_sale(
    p_customer uuid,
    p_items jsonb,
    p_payments jsonb,
    p_discount numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$

DECLARE

    it jsonb;
    pm jsonb;

    b public.medicine_batches%ROWTYPE;
    m public.medicines%ROWTYPE;

    inv uuid;
    v_branch uuid;
    v_prefix text;

    sub numeric := 0;
    tx numeric := 0;
    tot numeric;
    paid numeric := 0;
    lt numeric;

    v_qty numeric;
    v_amount numeric;
    v_discount numeric;

BEGIN

    -- Staff authorization

    IF COALESCE(public.my_role(), '') NOT IN (
        'super_admin',
        'admin',
        'pharmacist',
        'billing',
        'billing_staff'
    ) THEN
        RAISE EXCEPTION 'Not authorised';
    END IF;


    -- Staff branch

    v_branch := public.my_branch_id();

    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'Staff branch not configured';
    END IF;


    -- Validate cart

    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Invalid cart';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Empty cart';
    END IF;


    -- Validate payments

    IF jsonb_typeof(p_payments) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Invalid payment data';
    END IF;


    IF p_discount IS NULL OR p_discount < 0 THEN
        RAISE EXCEPTION 'Invalid discount';
    END IF;

    v_discount := round(p_discount, 2);


    -- Customer must belong to the same branch

    IF p_customer IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.customers
        WHERE id = p_customer
          AND branch_id = v_branch
    ) THEN
        RAISE EXCEPTION 'Customer not found in this branch';
    END IF;


    -- Branch invoice prefix

    SELECT COALESCE(NULLIF(invoice_prefix, ''), 'ALZA')
    INTO v_prefix
    FROM public.branches
    WHERE id = v_branch
      AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Branch inactive or not found';
    END IF;


    -- Create invoice

    INSERT INTO public.sales_invoices (
        branch_id,
        invoice_no,
        customer_id,
        subtotal,
        discount,
        tax,
        total,
        status,
        created_by
    )
    VALUES (
        v_branch,
        v_prefix || '-' ||
        to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMM') ||
        '-' ||
        lpad(nextval('public.invoice_seq'::regclass)::text, 6, '0'),
        p_customer,
        0,
        v_discount,
        0,
        0,
        'final',
        auth.uid()
    )
    RETURNING id INTO inv;


    -- Process each cart item

    FOR it IN
        SELECT value
        FROM jsonb_array_elements(p_items)
    LOOP

        IF it->>'batch_id' IS NULL
           OR it->>'qty' IS NULL THEN
            RAISE EXCEPTION 'Missing batch or quantity';
        END IF;

        v_qty := round((it->>'qty')::numeric, 3);

        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'Invalid quantity';
        END IF;


        -- Lock branch batch

        SELECT *
        INTO b
        FROM public.medicine_batches
        WHERE id = (it->>'batch_id')::uuid
          AND branch_id = v_branch
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Batch not found in this branch';
        END IF;


        -- Expiry check

        IF b.expiry <= current_date THEN
            RAISE EXCEPTION 'Batch % expired', b.batch_no;
        END IF;


        -- Quarantine check

        IF b.quarantined THEN
            RAISE EXCEPTION 'Batch % quarantined', b.batch_no;
        END IF;


        -- Stock check

        IF b.qty < v_qty THEN
            RAISE EXCEPTION 'Insufficient stock: %', b.batch_no;
        END IF;


        -- Medicine validation

        SELECT *
        INTO m
        FROM public.medicines
        WHERE id = b.medicine_id
          AND branch_id = v_branch
          AND active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Medicine inactive or not found';
        END IF;


        -- Calculate line total

        lt := round(m.selling_price * v_qty, 2);

        sub := sub + lt;

        -- Tax included in selling price

        tx := tx + round(
            lt * m.tax_rate / (100 + m.tax_rate),
            2
        );


        -- Deduct stock

        UPDATE public.medicine_batches
        SET qty = qty - v_qty
        WHERE id = b.id;


        -- Record sale item

        INSERT INTO public.sales_items (
            branch_id,
            invoice_id,
            medicine_id,
            batch_id,
            qty,
            unit_price,
            tax_rate,
            line_total
        )
        VALUES (
            v_branch,
            inv,
            m.id,
            b.id,
            v_qty,
            m.selling_price,
            m.tax_rate,
            lt
        );

    END LOOP;


    -- Calculate total

    tot := round(sub - v_discount, 2);

    IF tot < 0 THEN
        RAISE EXCEPTION 'Discount exceeds total';
    END IF;


    -- Process payments

    FOR pm IN
        SELECT value
        FROM jsonb_array_elements(p_payments)
    LOOP

        IF COALESCE(pm->>'method', '') NOT IN (
            'cash',
            'upi',
            'card',
            'credit'
        ) THEN
            RAISE EXCEPTION 'Invalid payment method';
        END IF;

        IF pm->>'amount' IS NULL THEN
            RAISE EXCEPTION 'Missing payment amount';
        END IF;

        v_amount := round((pm->>'amount')::numeric, 2);

        IF v_amount <= 0 THEN
            RAISE EXCEPTION 'Invalid payment amount';
        END IF;

        IF pm->>'method' = 'credit'
           AND p_customer IS NULL THEN
            RAISE EXCEPTION 'Credit requires a customer';
        END IF;


        INSERT INTO public.payments (
            branch_id,
            invoice_id,
            method,
            amount
        )
        VALUES (
            v_branch,
            inv,
            pm->>'method',
            v_amount
        );

        paid := paid + v_amount;

    END LOOP;


    -- Exact payment validation

    IF round(paid, 2) <> tot THEN
        RAISE EXCEPTION
            'Payment total (%) does not match invoice total (%)',
            paid,
            tot;
    END IF;


    -- Update invoice

    UPDATE public.sales_invoices
    SET
        subtotal = sub,
        tax = tx,
        total = tot
    WHERE id = inv;


    -- Existing audit log structure

    INSERT INTO public.audit_logs (
        branch_id,
        user_id,
        action,
        entity_type,
        entity_id,
        reason,
        before_data,
        after_data
    )
    VALUES (
        v_branch,
        auth.uid(),
        'sale_finalized',
        'sales_invoice',
        inv::text,
        'POS sale completed',
        NULL,
        jsonb_build_object(
            'invoice_id', inv,
            'invoice_total', tot,
            'subtotal', sub,
            'tax', tx,
            'discount', v_discount
        )
    );


    RETURN inv;

END;
$$;


-- ============================================================
-- 18. FINAL FUNCTION SECURITY
-- ============================================================

REVOKE ALL ON FUNCTION public.finalize_sale(
    uuid, jsonb, jsonb, numeric
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.finalize_sale(
    uuid, jsonb, jsonb, numeric
) TO authenticated;


-- ============================================================
-- 19. INSTALLATION CHECK
-- ============================================================

SELECT
    table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
    'medicines',
    'medicine_batches',
    'customers',
    'sales_invoices',
    'sales_items',
    'payments'
)
ORDER BY table_name;


-- ============================================================
-- END ALZA PHARMACY V2
-- ============================================================
