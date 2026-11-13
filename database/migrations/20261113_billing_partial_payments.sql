-- ALZA Billing Increment 2: safe partial payments and customer credit limit enforcement
-- Apply only after reviewing/backup. Built for the live schema inspected on 2026-11-13.
-- Does not alter finance_post_sale_journal(): its existing trigger posts once payment rows
-- (including the generated credit remainder) equal the invoice total.

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
    v_credit_due numeric := 0;
    v_outstanding numeric := 0;
    v_customer public.customers%ROWTYPE;

BEGIN

    -- Require an authenticated, active staff session.
    IF auth.uid() IS NULL OR NOT COALESCE(app.session_ok(), false) THEN
        RAISE EXCEPTION 'Active staff session required';
    END IF;

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

    IF v_discount > 0 AND NOT EXISTS (
        SELECT 1
        FROM public.profiles pr
        JOIN public.role_permissions rp ON rp.role_id = pr.role_id
        WHERE pr.id = auth.uid()
          AND pr.branch_id = v_branch
          AND pr.is_active = true
          AND rp.permission_code = 'sales.discount'
    ) THEN
        RAISE EXCEPTION 'You do not have permission to apply discounts';
    END IF;


    -- Lock the customer row so concurrent bills cannot exceed the credit limit.
    IF p_customer IS NOT NULL THEN
        SELECT * INTO v_customer
        FROM public.customers
        WHERE id = p_customer
          AND branch_id = v_branch
          AND active = true
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Customer not found or inactive in this branch';
        END IF;
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


    -- Record actual tendered payments only. The unpaid remainder is
    -- generated below as a credit row, never supplied by the browser.
    FOR pm IN
        SELECT value
        FROM jsonb_array_elements(p_payments)
    LOOP
        IF COALESCE(pm->>'method', '') NOT IN ('cash', 'upi', 'card') THEN
            RAISE EXCEPTION 'Invalid payment method';
        END IF;

        IF pm->>'amount' IS NULL THEN
            RAISE EXCEPTION 'Missing payment amount';
        END IF;

        v_amount := round((pm->>'amount')::numeric, 2);

        IF v_amount <= 0 THEN
            RAISE EXCEPTION 'Invalid payment amount';
        END IF;

        paid := round(paid + v_amount, 2);

        IF paid > tot THEN
            RAISE EXCEPTION 'Payments (%) exceed invoice total (%)', paid, tot;
        END IF;

        INSERT INTO public.payments (
            branch_id, invoice_id, method, amount
        ) VALUES (
            v_branch, inv, pm->>'method', v_amount
        );
    END LOOP;

    -- Create customer receivable for the unpaid remainder.
    v_credit_due := round(tot - paid, 2);

    IF v_credit_due < 0 THEN
        RAISE EXCEPTION 'Payments cannot exceed invoice total';
    END IF;

    IF v_credit_due > 0 THEN
        IF p_customer IS NULL THEN
            RAISE EXCEPTION 'An active customer is required for an unpaid balance';
        END IF;

        -- Customer row was locked above to serialize concurrent credit sales.
        v_outstanding := public.customer_outstanding(p_customer);

        IF round(v_outstanding + v_credit_due, 2) > v_customer.credit_limit THEN
            RAISE EXCEPTION
                'Customer credit limit exceeded. Available: %',
                greatest(0, round(v_customer.credit_limit - v_outstanding, 2));
        END IF;

        INSERT INTO public.payments (
            branch_id, invoice_id, method, amount
        ) VALUES (
            v_branch, inv, 'credit', v_credit_due
        );
    END IF;

    -- All payment rows (including generated credit) must equal invoice total.
    IF round(paid + v_credit_due, 2) <> tot THEN
        RAISE EXCEPTION 'Payment allocation does not equal invoice total';
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


REVOKE ALL ON FUNCTION public.finalize_sale(uuid, jsonb, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_sale(uuid, jsonb, jsonb, numeric) TO authenticated;
