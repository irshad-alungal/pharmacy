-- ============================================================================
-- 0020 · Intelligent billing: FEFO batch allocation, editable discount / GST /
--        MRP, tax-inclusive & tax-exclusive pricing, stock reservations,
--        deterministic calculation engine and audited finalize_sale_v2().
--
-- Run AFTER 0019_daily_bill_number_and_billing_search.sql and
-- 20261113_billing_partial_payments.sql. Re-runnable (idempotent).
--
-- Deploy this migration together with the matching frontend
-- (assets/js/billing.js, billing-engine.js, billing-assistant.js).
-- The legacy finalize_sale() is kept but no longer executable by browsers,
-- so stale clients cannot bypass reservations / FEFO / permission checks.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Pricing & tax treatment columns
-- ---------------------------------------------------------------------------
-- Indian retail MRP includes GST, so the default treatment stays tax-inclusive
-- (identical to how finalize_sale() treated selling_price before).
ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS price_includes_tax boolean NOT NULL DEFAULT true;

GRANT SELECT (price_includes_tax) ON public.medicines TO authenticated;
GRANT INSERT (price_includes_tax) ON public.medicines TO authenticated;
GRANT UPDATE (price_includes_tax) ON public.medicines TO authenticated;

-- Batch-level pricing. NULL means "inherit from the medicine master".
ALTER TABLE public.medicine_batches
  ADD COLUMN IF NOT EXISTS mrp numeric(12,2),
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2),
  ADD COLUMN IF NOT EXISTS price_includes_tax boolean,
  ADD COLUMN IF NOT EXISTS stock_status text NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.medicine_batches'::regclass
                   AND conname = 'medicine_batches_mrp_nonneg') THEN
    ALTER TABLE public.medicine_batches
      ADD CONSTRAINT medicine_batches_mrp_nonneg CHECK (mrp IS NULL OR mrp >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.medicine_batches'::regclass
                   AND conname = 'medicine_batches_tax_rate_range') THEN
    ALTER TABLE public.medicine_batches
      ADD CONSTRAINT medicine_batches_tax_rate_range CHECK (tax_rate IS NULL OR tax_rate BETWEEN 0 AND 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.medicine_batches'::regclass
                   AND conname = 'medicine_batches_stock_status_check') THEN
    ALTER TABLE public.medicine_batches
      ADD CONSTRAINT medicine_batches_stock_status_check
      CHECK (stock_status IN ('active','blocked','recalled','damaged'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS batch_fefo_idx
  ON public.medicine_batches (branch_id, medicine_id, expiry, batch_no);

-- Line-level billing detail on invoices.
ALTER TABLE public.sales_items
  ADD COLUMN IF NOT EXISTS mrp numeric(12,2),
  ADD COLUMN IF NOT EXISTS discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS gst_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS price_includes_tax boolean,
  ADD COLUMN IF NOT EXISTS manual_batch boolean NOT NULL DEFAULT false;

ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS line_discount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_total numeric(12,2);

-- ---------------------------------------------------------------------------
-- 2. Configuration: GST slabs and per-branch billing settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gst_rate_slabs (
  rate   numeric(5,2) PRIMARY KEY CHECK (rate BETWEEN 0 AND 40),
  label  text,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO public.gst_rate_slabs (rate, label) VALUES
  (0, 'Nil / exempt'), (5, 'GST 5%'), (12, 'GST 12% (legacy)'),
  (18, 'GST 18%'), (28, 'GST 28% (legacy)'), (40, 'GST 40%')
ON CONFLICT (rate) DO NOTHING;

ALTER TABLE public.gst_rate_slabs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gst_slabs_read ON public.gst_rate_slabs;
CREATE POLICY gst_slabs_read ON public.gst_rate_slabs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gst_slabs_admin ON public.gst_rate_slabs;
CREATE POLICY gst_slabs_admin ON public.gst_rate_slabs FOR ALL TO authenticated
  USING (public.my_role() IN ('super_admin','admin'))
  WITH CHECK (public.my_role() IN ('super_admin','admin'));
REVOKE ALL ON public.gst_rate_slabs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.gst_rate_slabs TO authenticated;

CREATE TABLE IF NOT EXISTS public.billing_settings (
  branch_id           uuid PRIMARY KEY REFERENCES public.branches(id),
  max_discount_pct    numeric(5,2) NOT NULL DEFAULT 30 CHECK (max_discount_pct BETWEEN 0 AND 100),
  reservation_minutes integer NOT NULL DEFAULT 15 CHECK (reservation_minutes BETWEEN 1 AND 240),
  near_expiry_days    integer NOT NULL DEFAULT 90 CHECK (near_expiry_days BETWEEN 0 AND 730),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_settings_read ON public.billing_settings;
CREATE POLICY billing_settings_read ON public.billing_settings FOR SELECT TO authenticated
  USING (branch_id = public.my_branch_id());
DROP POLICY IF EXISTS billing_settings_admin ON public.billing_settings;
CREATE POLICY billing_settings_admin ON public.billing_settings FOR ALL TO authenticated
  USING (branch_id = public.my_branch_id() AND public.my_role() IN ('super_admin','admin'))
  WITH CHECK (branch_id = public.my_branch_id() AND public.my_role() IN ('super_admin','admin'));
REVOKE ALL ON public.billing_settings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.billing_settings TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stock reservations (no direct client access; SECURITY DEFINER RPCs only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_reservations (
  id          bigserial PRIMARY KEY,
  branch_id   uuid NOT NULL REFERENCES public.branches(id),
  cart_token  uuid NOT NULL,
  medicine_id uuid NOT NULL REFERENCES public.medicines(id),
  batch_id    uuid NOT NULL REFERENCES public.medicine_batches(id),
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  UNIQUE (cart_token, batch_id)
);
CREATE INDEX IF NOT EXISTS stock_res_batch_idx ON public.stock_reservations (batch_id, expires_at);
CREATE INDEX IF NOT EXISTS stock_res_cart_idx  ON public.stock_reservations (cart_token);
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_reservations FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Permission codes (best effort: the live permissions table pre-dates the
--    repository, so insert defensively). super_admin/admin always pass.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_code text;
  v_has_desc boolean;
  v_has_name boolean;
BEGIN
  IF to_regclass('public.permissions') IS NULL THEN RETURN; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='permissions' AND column_name='description') INTO v_has_desc;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='permissions' AND column_name='name') INTO v_has_name;
  FOREACH v_code IN ARRAY ARRAY['sales.discount','sales.gst_edit','sales.mrp_edit','sales.batch_override'] LOOP
    BEGIN
      IF v_has_desc THEN
        EXECUTE 'INSERT INTO public.permissions(code, description) VALUES ($1, $2) ON CONFLICT DO NOTHING'
          USING v_code, 'Billing: ' || v_code;
      ELSIF v_has_name THEN
        EXECUTE 'INSERT INTO public.permissions(code, name) VALUES ($1, $2) ON CONFLICT DO NOTHING'
          USING v_code, 'Billing: ' || v_code;
      ELSE
        EXECUTE 'INSERT INTO public.permissions(code) VALUES ($1) ON CONFLICT DO NOTHING' USING v_code;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Permission % not inserted (%). Add it manually if needed.', v_code, SQLERRM;
    END;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.billing_has_permission(p_code text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(public.my_role(), '') IN ('super_admin','admin')
      OR EXISTS (
        SELECT 1
        FROM public.profiles pr
        JOIN public.role_permissions rp ON rp.role_id = pr.role_id
        WHERE pr.id = auth.uid()
          AND pr.is_active = true
          AND rp.permission_code = p_code
      );
$$;

-- ---------------------------------------------------------------------------
-- 5. Deterministic helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_today()
RETURNS date LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- Single source of truth for line arithmetic. assets/js/billing-engine.js
-- mirrors this exactly (same order of rounding, half-away-from-zero, 2 dp).
--   exclusive: base = mrp*qty; disc = base*d%; net = base-disc;
--              gst = net*g%; total = net+gst
--   inclusive: base = mrp*qty; disc = base*d%; gross = base-disc;
--              gst = gross*g/(100+g); net (taxable) = gross-gst; total = gross
CREATE OR REPLACE FUNCTION public.billing_calc_line(
  p_mrp numeric, p_qty numeric, p_discount_pct numeric,
  p_gst_pct numeric, p_price_includes_tax boolean
)
RETURNS TABLE (base_amount numeric, discount_amount numeric, taxable_amount numeric,
               gst_amount numeric, total_amount numeric)
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_mrp numeric; v_qty numeric; v_d numeric; v_g numeric;
  v_base numeric; v_disc numeric; v_after numeric; v_gst numeric;
BEGIN
  IF p_mrp IS NULL OR p_mrp < 0 THEN RAISE EXCEPTION 'MRP must not be negative'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Discount percentage must be between 0 and 100';
  END IF;
  IF p_gst_pct IS NULL OR p_gst_pct < 0 OR p_gst_pct > 40 THEN
    RAISE EXCEPTION 'GST percentage must be between 0 and 40';
  END IF;
  v_mrp := round(p_mrp, 2); v_qty := round(p_qty, 3);
  v_d := round(p_discount_pct, 2); v_g := round(p_gst_pct, 2);

  v_base  := round(v_mrp * v_qty, 2);
  v_disc  := round(v_base * v_d / 100, 2);
  v_after := v_base - v_disc;

  IF COALESCE(p_price_includes_tax, true) THEN
    v_gst := round(v_after * v_g / (100 + v_g), 2);
    RETURN QUERY SELECT v_base, v_disc, v_after - v_gst, v_gst, v_after;
  ELSE
    v_gst := round(v_after * v_g / 100, 2);
    RETURN QUERY SELECT v_base, v_disc, v_after, v_gst, v_after + v_gst;
  END IF;
END;
$$;

-- Default discount for a medicine: explicit discount_percentage, otherwise the
-- discount implied by selling_price < MRP (so existing shop pricing is kept).
CREATE OR REPLACE FUNCTION public.billing_default_discount_pct(
  p_med_mrp numeric, p_med_selling numeric, p_med_discount_pct numeric
)
RETURNS numeric LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_med_discount_pct IS NOT NULL THEN round(least(greatest(p_med_discount_pct, 0), 100), 2)
    WHEN COALESCE(p_med_mrp, 0) > 0 AND COALESCE(p_med_selling, 0) > 0 AND p_med_selling < p_med_mrp
      THEN round((p_med_mrp - p_med_selling) * 100 / p_med_mrp, 2)
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public._billing_reserved_by_others(p_batch uuid, p_cart uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(sum(qty), 0)
  FROM public.stock_reservations
  WHERE batch_id = p_batch
    AND expires_at > now()
    AND (p_cart IS NULL OR cart_token <> p_cart);
$$;

-- Same session / role / branch rules as finalize_sale(). Returns the branch.
CREATE OR REPLACE FUNCTION public._billing_assert_staff()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid;
  v_ok boolean := true;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Active staff session required';
  END IF;
  IF to_regprocedure('app.session_ok()') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(app.session_ok(), false)' INTO v_ok;
    IF NOT v_ok THEN RAISE EXCEPTION 'Active staff session required'; END IF;
  END IF;
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin','pharmacist','billing','billing_staff') THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  v_branch := public.my_branch_id();
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Staff branch not configured'; END IF;
  RETURN v_branch;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. FEFO allocation (pure, read-only computation)
-- ---------------------------------------------------------------------------
-- p_manual: optional [{batch_id, qty}] manual override, applied first; any
-- remainder is filled FEFO from the other eligible batches.
CREATE OR REPLACE FUNCTION public._billing_fefo_compute(
  p_branch uuid, p_medicine uuid, p_qty numeric, p_cart uuid, p_manual jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m public.medicines%ROWTYPE;
  r record;
  v_today date := public.billing_today();
  v_near int := 90;
  v_req numeric := round(p_qty, 3);
  v_manual jsonb := '{}'::jsonb;
  v_manual_sum numeric := 0;
  v_seen int := 0;
  mi jsonb;
  v_avail numeric;
  v_take numeric;
  v_remaining numeric;
  v_total_avail numeric := 0;
  v_rows jsonb := '[]'::jsonb;
  v_cands jsonb := '[]'::jsonb;
  v_expired int := 0; v_blocked int := 0; v_zero int := 0; v_reserved int := 0;
  v_alloc numeric := 0;
  v_mrp numeric; v_gst numeric; v_incl boolean; v_def_disc numeric;
BEGIN
  IF v_req IS NULL OR v_req <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;

  SELECT * INTO m FROM public.medicines
  WHERE id = p_medicine AND branch_id = p_branch AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medicine inactive or not found'; END IF;

  SELECT COALESCE(bs.near_expiry_days, 90) INTO v_near
  FROM public.billing_settings bs WHERE bs.branch_id = p_branch;
  v_near := COALESCE(v_near, 90);

  -- Normalise manual override into {batch_id: qty}
  IF p_manual IS NOT NULL AND jsonb_typeof(p_manual) = 'array' THEN
    FOR mi IN SELECT value FROM jsonb_array_elements(p_manual) LOOP
      IF mi->>'batch_id' IS NULL OR mi->>'qty' IS NULL OR (mi->>'qty')::numeric <= 0 THEN
        RAISE EXCEPTION 'Manual batch selection needs a batch and a positive quantity';
      END IF;
      IF v_manual ? (mi->>'batch_id') THEN
        RAISE EXCEPTION 'Duplicate batch in manual selection';
      END IF;
      v_manual := v_manual || jsonb_build_object(mi->>'batch_id', round((mi->>'qty')::numeric, 3));
      v_manual_sum := v_manual_sum + round((mi->>'qty')::numeric, 3);
    END LOOP;
    IF v_manual_sum > v_req THEN
      RAISE EXCEPTION 'Manual batch quantities (%) exceed requested quantity (%)', v_manual_sum, v_req;
    END IF;
  END IF;

  -- Exclusion statistics (explains why stock is not offered)
  SELECT
    count(*) FILTER (WHERE b.qty > 0 AND b.expiry <= v_today),
    count(*) FILTER (WHERE b.qty > 0 AND b.expiry > v_today AND (b.quarantined OR b.stock_status <> 'active')),
    count(*) FILTER (WHERE b.qty <= 0)
  INTO v_expired, v_blocked, v_zero
  FROM public.medicine_batches b
  WHERE b.branch_id = p_branch AND b.medicine_id = p_medicine;

  -- Pass 1: eligible candidates in FEFO order; apply manual quantities.
  FOR r IN
    SELECT b.*
    FROM public.medicine_batches b
    WHERE b.branch_id = p_branch
      AND b.medicine_id = p_medicine
      AND b.qty > 0
      AND b.expiry > v_today
      AND b.quarantined = false
      AND b.stock_status = 'active'
    ORDER BY b.expiry ASC, b.batch_no ASC, b.id ASC
  LOOP
    v_avail := r.qty - public._billing_reserved_by_others(r.id, p_cart);
    IF v_avail <= 0 THEN
      v_reserved := v_reserved + 1;
      IF v_manual ? r.id::text THEN
        RAISE EXCEPTION 'Batch % is fully reserved by another bill', r.batch_no;
      END IF;
      CONTINUE;
    END IF;
    v_total_avail := v_total_avail + v_avail;

    v_mrp  := COALESCE(r.mrp, NULLIF(m.mrp, 0), m.selling_price);
    v_gst  := COALESCE(r.tax_rate, m.tax_rate, 0);
    v_incl := COALESCE(r.price_includes_tax, m.price_includes_tax, true);
    v_def_disc := public.billing_default_discount_pct(m.mrp, m.selling_price, m.discount_percentage);

    v_take := 0;
    IF v_manual ? r.id::text THEN
      v_take := (v_manual->>r.id::text)::numeric;
      IF v_take > v_avail THEN
        RAISE EXCEPTION 'Batch % has only % available', r.batch_no, v_avail;
      END IF;
      v_seen := v_seen + 1;
    END IF;

    v_cands := v_cands || jsonb_build_array(jsonb_build_object(
      'batch_id', r.id, 'batch_no', r.batch_no, 'expiry', r.expiry,
      'available', v_avail, 'stock_qty', r.qty,
      'mrp', v_mrp, 'tax_rate', v_gst, 'price_includes_tax', v_incl,
      'default_discount_pct', v_def_disc,
      'days_to_expiry', (r.expiry - v_today),
      'near_expiry', (r.expiry - v_today) <= v_near,
      'manual_qty', v_take
    ));
  END LOOP;

  IF v_seen <> (SELECT count(*) FROM jsonb_object_keys(v_manual)) THEN
    RAISE EXCEPTION 'A manually selected batch is expired, blocked, recalled, empty or not in this branch';
  END IF;

  -- Pass 2: fill the remainder FEFO, emit allocation rows in expiry order.
  v_remaining := v_req - v_manual_sum;
  FOR mi IN SELECT value FROM jsonb_array_elements(v_cands) LOOP
    v_take := (mi->>'manual_qty')::numeric;
    IF v_remaining > 0 THEN
      v_avail := (mi->>'available')::numeric - v_take;
      IF v_avail > 0 THEN
        v_avail := least(v_avail, v_remaining);
        v_take := v_take + v_avail;
        v_remaining := v_remaining - v_avail;
      END IF;
    END IF;
    IF v_take > 0 THEN
      v_alloc := v_alloc + v_take;
      v_rows := v_rows || jsonb_build_array(
        (mi - 'manual_qty') || jsonb_build_object('qty', v_take, 'manual', (mi->>'manual_qty')::numeric > 0)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'medicine_id', m.id,
    'medicine_name', m.name,
    'requested', v_req,
    'allocated', v_alloc,
    'available_total', v_total_avail,
    'shortage', greatest(v_req - v_alloc, 0),
    'rows', v_rows,
    'candidates', v_cands,
    'excluded', jsonb_build_object('expired', v_expired, 'blocked_or_recalled', v_blocked,
                                   'zero_stock', v_zero, 'fully_reserved', v_reserved),
    'manual', v_manual_sum > 0
  );
END;
$$;
REVOKE ALL ON FUNCTION public._billing_fefo_compute(uuid, uuid, numeric, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._billing_reserved_by_others(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._billing_assert_staff() FROM PUBLIC, anon, authenticated;

-- Read-only preview (used by the AI assistant and for explanations).
CREATE OR REPLACE FUNCTION public.billing_fefo_preview(
  p_medicine uuid, p_qty numeric, p_cart uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid;
BEGIN
  v_branch := public._billing_assert_staff();
  RETURN public._billing_fefo_compute(v_branch, p_medicine, p_qty, p_cart, NULL);
END;
$$;

-- Allocate + reserve atomically for one medicine of one open bill.
CREATE OR REPLACE FUNCTION public.billing_allocate(
  p_cart uuid, p_medicine uuid, p_qty numeric,
  p_manual jsonb DEFAULT NULL, p_override_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid;
  v_minutes int := 15;
  v_result jsonb;
  v_row jsonb;
  v_has_manual boolean;
  v_until timestamptz;
BEGIN
  v_branch := public._billing_assert_staff();
  IF p_cart IS NULL THEN RAISE EXCEPTION 'Billing session token required'; END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF p_qty > 100000 THEN RAISE EXCEPTION 'Quantity is too large'; END IF;

  IF EXISTS (SELECT 1 FROM public.stock_reservations
             WHERE cart_token = p_cart AND (created_by <> auth.uid() OR branch_id <> v_branch)) THEN
    RAISE EXCEPTION 'Billing session belongs to another user';
  END IF;

  v_has_manual := p_manual IS NOT NULL AND jsonb_typeof(p_manual) = 'array' AND jsonb_array_length(p_manual) > 0;
  IF v_has_manual THEN
    IF NOT public.billing_has_permission('sales.batch_override') THEN
      RAISE EXCEPTION 'You do not have permission to override batch selection';
    END IF;
    IF length(trim(COALESCE(p_override_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'A reason is required for a manual batch override';
    END IF;
  END IF;

  SELECT COALESCE(reservation_minutes, 15) INTO v_minutes
  FROM public.billing_settings WHERE branch_id = v_branch;
  v_minutes := COALESCE(v_minutes, 15);
  v_until := now() + make_interval(mins => v_minutes);

  -- Serialise concurrent allocations of the same medicine.
  PERFORM 1 FROM public.medicine_batches
  WHERE branch_id = v_branch AND medicine_id = p_medicine
  ORDER BY id FOR UPDATE;

  DELETE FROM public.stock_reservations WHERE expires_at <= now();
  DELETE FROM public.stock_reservations WHERE cart_token = p_cart AND medicine_id = p_medicine;

  v_result := public._billing_fefo_compute(v_branch, p_medicine, p_qty, p_cart,
                                           CASE WHEN v_has_manual THEN p_manual ELSE NULL END);

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_result->'rows') LOOP
    INSERT INTO public.stock_reservations (branch_id, cart_token, medicine_id, batch_id, qty, created_by, expires_at)
    VALUES (v_branch, p_cart, p_medicine, (v_row->>'batch_id')::uuid, (v_row->>'qty')::numeric, auth.uid(), v_until);
  END LOOP;

  -- Keep the rest of this bill's reservations alive.
  UPDATE public.stock_reservations SET expires_at = v_until WHERE cart_token = p_cart;

  IF v_has_manual THEN
    INSERT INTO public.audit_logs (branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
    VALUES (v_branch, auth.uid(), 'billing_batch_override', 'billing_session', p_cart::text,
            trim(p_override_reason),
            public._billing_fefo_compute(v_branch, p_medicine, p_qty, p_cart, NULL)->'rows',
            v_result->'rows');
  END IF;

  RETURN v_result || jsonb_build_object('reserved_until', v_until);
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_release(p_cart uuid, p_medicine uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Active staff session required'; END IF;
  DELETE FROM public.stock_reservations
  WHERE cart_token = p_cart AND created_by = auth.uid()
    AND (p_medicine IS NULL OR medicine_id = p_medicine);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_touch(p_cart uuid)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid; v_minutes int; v_until timestamptz;
BEGIN
  v_branch := public._billing_assert_staff();
  SELECT reservation_minutes INTO v_minutes FROM public.billing_settings WHERE branch_id = v_branch;
  v_until := now() + make_interval(mins => COALESCE(v_minutes, 15));
  UPDATE public.stock_reservations SET expires_at = v_until
  WHERE cart_token = p_cart AND created_by = auth.uid() AND expires_at > now();
  RETURN v_until;
END;
$$;

-- Permissions + configuration for the billing screen in one call.
CREATE OR REPLACE FUNCTION public.billing_my_config()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid; s public.billing_settings%ROWTYPE;
BEGIN
  v_branch := public._billing_assert_staff();
  SELECT * INTO s FROM public.billing_settings WHERE branch_id = v_branch;
  RETURN jsonb_build_object(
    'permissions', jsonb_build_object(
      'discount',       public.billing_has_permission('sales.discount'),
      'gst_edit',       public.billing_has_permission('sales.gst_edit'),
      'mrp_edit',       public.billing_has_permission('sales.mrp_edit'),
      'batch_override', public.billing_has_permission('sales.batch_override')
    ),
    'max_discount_pct',    COALESCE(s.max_discount_pct, 30),
    'reservation_minutes', COALESCE(s.reservation_minutes, 15),
    'near_expiry_days',    COALESCE(s.near_expiry_days, 90),
    'gst_rates', COALESCE((SELECT jsonb_agg(rate ORDER BY rate) FROM public.gst_rate_slabs WHERE active), '[0,5,12,18,28]'::jsonb),
    'today', public.billing_today()
  );
END;
$$;

-- Audited live edits from the billing screen (discount / GST / MRP changes,
-- applied AI suggestions). Whitelisted actions only.
CREATE OR REPLACE FUNCTION public.billing_log_event(
  p_cart uuid, p_action text, p_before jsonb, p_after jsonb, p_reason text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid;
BEGIN
  v_branch := public._billing_assert_staff();
  IF p_action NOT IN ('billing_discount_change','billing_gst_change','billing_mrp_change',
                      'billing_ai_suggestion_applied','billing_bill_cleared') THEN
    RAISE EXCEPTION 'Unsupported billing audit action';
  END IF;
  IF octet_length(COALESCE(p_before::text,'')) + octet_length(COALESCE(p_after::text,'')) > 16000 THEN
    RAISE EXCEPTION 'Audit payload too large';
  END IF;
  INSERT INTO public.audit_logs (branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), p_action, 'billing_session', p_cart::text, left(p_reason, 500), p_before, p_after);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. finalize_sale_v2 — authoritative, atomic, re-validates everything
-- ---------------------------------------------------------------------------
-- p_items: [{batch_id, qty, discount_pct, gst_pct, mrp, manual, override_reason}]
CREATE OR REPLACE FUNCTION public.finalize_sale_v2(
  p_customer uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount numeric DEFAULT 0,
  p_cart uuid DEFAULT NULL,
  p_expected_total numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  it jsonb; pm jsonb;
  b public.medicine_batches%ROWTYPE;
  m public.medicines%ROWTYPE;
  c record;
  inv uuid; v_branch uuid; v_prefix text;
  v_today date := public.billing_today();
  v_max_disc numeric := 30;

  sub numeric := 0; tx numeric := 0; v_line_disc numeric := 0; v_taxable numeric := 0;
  tot numeric; paid numeric := 0;
  v_qty numeric; v_amount numeric; v_discount numeric;
  v_credit_due numeric := 0; v_outstanding numeric := 0;
  v_customer public.customers%ROWTYPE;

  v_def_mrp numeric; v_def_disc numeric; v_def_gst numeric; v_incl boolean;
  v_mrp numeric; v_disc numeric; v_gst numeric; v_manual boolean;
  v_avail numeric;
  v_calc record;
  v_changes jsonb := '[]'::jsonb;
  v_expected jsonb; v_submitted jsonb;
  v_med uuid;
BEGIN
  v_branch := public._billing_assert_staff();

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid cart'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;
  IF jsonb_array_length(p_items) > 300 THEN RAISE EXCEPTION 'Too many bill lines'; END IF;
  IF jsonb_typeof(p_payments) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid payment data'; END IF;
  IF p_discount IS NULL OR p_discount < 0 THEN RAISE EXCEPTION 'Invalid discount'; END IF;
  v_discount := round(p_discount, 2);
  IF v_discount > 0 AND NOT public.billing_has_permission('sales.discount') THEN
    RAISE EXCEPTION 'You do not have permission to apply discounts';
  END IF;

  SELECT COALESCE(max_discount_pct, 30) INTO v_max_disc FROM public.billing_settings WHERE branch_id = v_branch;
  v_max_disc := COALESCE(v_max_disc, 30);

  -- Structural validation: required fields, no duplicate batch allocations.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
             WHERE e.value->>'batch_id' IS NULL OR e.value->>'qty' IS NULL) THEN
    RAISE EXCEPTION 'Missing batch or quantity';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_items))
     <> (SELECT count(DISTINCT e.value->>'batch_id') FROM jsonb_array_elements(p_items) e) THEN
    RAISE EXCEPTION 'Duplicate batch allocation in bill';
  END IF;

  -- Lock every batch of every medicine on the bill, in id order (deadlock safe,
  -- same order as billing_allocate()).
  PERFORM 1 FROM public.medicine_batches
  WHERE branch_id = v_branch
    AND medicine_id IN (SELECT mb.medicine_id FROM public.medicine_batches mb
                        WHERE mb.id IN (SELECT (e.value->>'batch_id')::uuid FROM jsonb_array_elements(p_items) e))
  ORDER BY id FOR UPDATE;

  -- FEFO verification for medicines that were not manually overridden.
  FOR c IN
    SELECT mb.medicine_id,
           sum(round((e.value->>'qty')::numeric, 3)) AS total_qty,
           bool_or(COALESCE((e.value->>'manual')::boolean, false)) AS any_manual,
           jsonb_object_agg(e.value->>'batch_id', round((e.value->>'qty')::numeric, 3)) AS submitted
    FROM jsonb_array_elements(p_items) e
    JOIN public.medicine_batches mb ON mb.id = (e.value->>'batch_id')::uuid AND mb.branch_id = v_branch
    GROUP BY mb.medicine_id
  LOOP
    IF c.any_manual THEN
      IF NOT public.billing_has_permission('sales.batch_override') THEN
        RAISE EXCEPTION 'You do not have permission to override batch selection';
      END IF;
      CONTINUE;
    END IF;
    v_expected := public._billing_fefo_compute(v_branch, c.medicine_id, c.total_qty, p_cart, NULL);
    IF (v_expected->>'shortage')::numeric > 0 THEN
      RAISE EXCEPTION 'Insufficient stock for %: requested %, available %',
        v_expected->>'medicine_name', c.total_qty, v_expected->>'available_total';
    END IF;
    SELECT COALESCE(jsonb_object_agg(r.value->>'batch_id', (r.value->>'qty')::numeric), '{}'::jsonb)
      INTO v_submitted FROM jsonb_array_elements(v_expected->'rows') r;
    IF v_submitted <> c.submitted THEN
      RAISE EXCEPTION 'Stock changed for % since it was allocated. Re-enter the quantity to re-allocate (FEFO).',
        v_expected->>'medicine_name';
    END IF;
  END LOOP;

  IF p_customer IS NOT NULL THEN
    SELECT * INTO v_customer FROM public.customers
    WHERE id = p_customer AND branch_id = v_branch AND active = true
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found or inactive in this branch'; END IF;
  END IF;

  SELECT COALESCE(NULLIF(invoice_prefix, ''), 'ALZA') INTO v_prefix
  FROM public.branches WHERE id = v_branch AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch inactive or not found'; END IF;

  -- invoice_no is replaced by trg_assign_daily_invoice_number (0019).
  INSERT INTO public.sales_invoices (branch_id, invoice_no, customer_id, subtotal, discount, tax, total, status, created_by)
  VALUES (v_branch,
          v_prefix || '-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMM') || '-' ||
            lpad(nextval('public.invoice_seq'::regclass)::text, 6, '0'),
          p_customer, 0, v_discount, 0, 0, 'final', auth.uid())
  RETURNING id INTO inv;

  FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := round((it->>'qty')::numeric, 3);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;

    SELECT * INTO b FROM public.medicine_batches
    WHERE id = (it->>'batch_id')::uuid AND branch_id = v_branch;
    IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found in this branch'; END IF;
    IF b.expiry <= v_today THEN RAISE EXCEPTION 'Batch % expired', b.batch_no; END IF;
    IF b.quarantined THEN RAISE EXCEPTION 'Batch % quarantined', b.batch_no; END IF;
    IF b.stock_status <> 'active' THEN RAISE EXCEPTION 'Batch % is %', b.batch_no, b.stock_status; END IF;

    v_avail := b.qty - public._billing_reserved_by_others(b.id, p_cart);
    IF v_avail < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock: % (available %, requested %)', b.batch_no, greatest(v_avail, 0), v_qty;
    END IF;

    SELECT * INTO m FROM public.medicines
    WHERE id = b.medicine_id AND branch_id = v_branch AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Medicine inactive or not found'; END IF;

    -- Defaults from batch → medicine master.
    v_def_mrp  := COALESCE(b.mrp, NULLIF(m.mrp, 0), m.selling_price);
    v_def_gst  := COALESCE(b.tax_rate, m.tax_rate, 0);
    v_incl     := COALESCE(b.price_includes_tax, m.price_includes_tax, true);
    v_def_disc := public.billing_default_discount_pct(m.mrp, m.selling_price, m.discount_percentage);
    v_manual   := COALESCE((it->>'manual')::boolean, false);

    v_mrp  := round(COALESCE((it->>'mrp')::numeric, v_def_mrp), 2);
    v_disc := round(COALESCE((it->>'discount_pct')::numeric, v_def_disc), 2);
    v_gst  := round(COALESCE((it->>'gst_pct')::numeric, v_def_gst), 2);

    -- MRP edits
    IF v_mrp < 0 THEN RAISE EXCEPTION 'MRP must not be negative'; END IF;
    IF v_mrp <> v_def_mrp THEN
      IF NOT public.billing_has_permission('sales.mrp_edit') THEN
        RAISE EXCEPTION 'You do not have permission to change MRP (%)', m.name;
      END IF;
      IF v_def_mrp > 0 AND v_mrp > v_def_mrp THEN
        RAISE EXCEPTION 'Selling price for % cannot exceed the printed MRP %', m.name, v_def_mrp;
      END IF;
    END IF;

    -- Discount edits
    IF v_disc < 0 OR v_disc > 100 THEN RAISE EXCEPTION 'Discount percentage must be between 0 and 100'; END IF;
    IF v_disc <> v_def_disc THEN
      IF NOT public.billing_has_permission('sales.discount') THEN
        RAISE EXCEPTION 'You do not have permission to change discounts (%)', m.name;
      END IF;
      IF v_disc > greatest(v_max_disc, v_def_disc) THEN
        RAISE EXCEPTION 'Discount % %% on % exceeds the permitted maximum %', v_disc, m.name, v_max_disc;
      END IF;
    END IF;

    -- GST edits
    IF NOT EXISTS (SELECT 1 FROM public.gst_rate_slabs WHERE rate = v_gst AND active) THEN
      RAISE EXCEPTION 'GST rate % %% is not a configured GST rate', v_gst;
    END IF;
    IF v_gst <> v_def_gst AND NOT public.billing_has_permission('sales.gst_edit') THEN
      RAISE EXCEPTION 'You do not have permission to change GST (%)', m.name;
    END IF;

    SELECT * INTO v_calc FROM public.billing_calc_line(v_mrp, v_qty, v_disc, v_gst, v_incl);

    UPDATE public.medicine_batches SET qty = qty - v_qty WHERE id = b.id;

    INSERT INTO public.sales_items (
      branch_id, invoice_id, medicine_id, batch_id, qty, unit_price, tax_rate, line_total,
      mrp, discount_pct, discount_amount, taxable_amount, gst_amount, price_includes_tax, manual_batch
    ) VALUES (
      v_branch, inv, m.id, b.id, v_qty, v_mrp, v_gst, v_calc.total_amount,
      v_mrp, v_disc, v_calc.discount_amount, v_calc.taxable_amount, v_calc.gst_amount, v_incl, v_manual
    );

    sub := sub + v_calc.total_amount;
    tx := tx + v_calc.gst_amount;
    v_line_disc := v_line_disc + v_calc.discount_amount;
    v_taxable := v_taxable + v_calc.taxable_amount;

    IF v_mrp <> v_def_mrp OR v_disc <> v_def_disc OR v_gst <> v_def_gst OR v_manual THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'medicine', m.name, 'batch_no', b.batch_no, 'qty', v_qty,
        'before', jsonb_build_object('mrp', v_def_mrp, 'discount_pct', v_def_disc, 'gst_pct', v_def_gst),
        'after',  jsonb_build_object('mrp', v_mrp, 'discount_pct', v_disc, 'gst_pct', v_gst),
        'manual_batch', v_manual, 'override_reason', left(it->>'override_reason', 300)));
    END IF;
  END LOOP;

  tot := round(sub - v_discount, 2);
  IF tot < 0 THEN RAISE EXCEPTION 'Discount exceeds total'; END IF;
  IF p_expected_total IS NOT NULL AND abs(tot - round(p_expected_total, 2)) > 0.005 THEN
    RAISE EXCEPTION 'Bill total changed (server %, screen %). Review the bill and try again.', tot, round(p_expected_total, 2);
  END IF;

  FOR pm IN SELECT value FROM jsonb_array_elements(p_payments) LOOP
    IF COALESCE(pm->>'method', '') NOT IN ('cash','upi','card') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
    IF pm->>'amount' IS NULL THEN RAISE EXCEPTION 'Missing payment amount'; END IF;
    v_amount := round((pm->>'amount')::numeric, 2);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'Invalid payment amount'; END IF;
    paid := round(paid + v_amount, 2);
    IF paid > tot THEN RAISE EXCEPTION 'Payments (%) exceed invoice total (%)', paid, tot; END IF;
    INSERT INTO public.payments (branch_id, invoice_id, method, amount)
    VALUES (v_branch, inv, pm->>'method', v_amount);
  END LOOP;

  v_credit_due := round(tot - paid, 2);
  IF v_credit_due > 0 THEN
    IF p_customer IS NULL THEN RAISE EXCEPTION 'An active customer is required for an unpaid balance'; END IF;
    v_outstanding := public.customer_outstanding(p_customer);
    IF round(v_outstanding + v_credit_due, 2) > v_customer.credit_limit THEN
      RAISE EXCEPTION 'Customer credit limit exceeded. Available: %',
        greatest(0, round(v_customer.credit_limit - v_outstanding, 2));
    END IF;
    INSERT INTO public.payments (branch_id, invoice_id, method, amount)
    VALUES (v_branch, inv, 'credit', v_credit_due);
  END IF;
  IF round(paid + v_credit_due, 2) <> tot THEN
    RAISE EXCEPTION 'Payment allocation does not equal invoice total';
  END IF;

  UPDATE public.sales_invoices
  SET subtotal = sub, tax = tx, total = tot, line_discount = v_line_disc, taxable_total = v_taxable
  WHERE id = inv;

  -- Stock is now permanently deducted; release this bill's reservations.
  IF p_cart IS NOT NULL THEN
    DELETE FROM public.stock_reservations WHERE cart_token = p_cart;
  END IF;

  INSERT INTO public.audit_logs (branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'sale_finalized', 'sales_invoice', inv::text, 'POS sale completed (FEFO v2)', NULL,
          jsonb_build_object('invoice_id', inv, 'invoice_total', tot, 'subtotal', sub, 'tax', tx,
                             'line_discount', v_line_disc, 'taxable_total', v_taxable, 'discount', v_discount,
                             'cart_token', p_cart, 'line_overrides', jsonb_array_length(v_changes)));

  IF jsonb_array_length(v_changes) > 0 THEN
    INSERT INTO public.audit_logs (branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
    VALUES (v_branch, auth.uid(), 'billing_line_overrides', 'sales_invoice', inv::text,
            'Discount / GST / MRP / batch changes on finalized bill', NULL, v_changes);
  END IF;

  RETURN inv;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7b. Mark a batch blocked / recalled / damaged (or active again), audited.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_batch_stock_status(p_batch uuid, p_status text, p_reason text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE b public.medicine_batches%ROWTYPE; v_branch uuid := public.my_branch_id();
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin','pharmacist','inventory','inventory_staff') THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF p_status NOT IN ('active','blocked','recalled','damaged') THEN RAISE EXCEPTION 'Invalid stock status'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO b FROM public.medicine_batches WHERE id = p_batch AND branch_id = v_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found in this branch'; END IF;
  UPDATE public.medicine_batches SET stock_status = p_status WHERE id = b.id;
  IF p_status <> 'active' THEN
    DELETE FROM public.stock_reservations WHERE batch_id = b.id;  -- open bills must re-allocate
  END IF;
  INSERT INTO public.audit_logs (branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'batch_stock_status_changed', 'medicine_batch', b.id::text, trim(p_reason),
          jsonb_build_object('stock_status', b.stock_status), jsonb_build_object('stock_status', p_status, 'batch_no', b.batch_no));
  RETURN p_status;
END;
$$;
REVOKE ALL ON FUNCTION public.set_batch_stock_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_batch_stock_status(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.billing_has_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_calc_line(numeric, numeric, numeric, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_default_discount_pct(numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_today() TO authenticated;

REVOKE ALL ON FUNCTION public.billing_fefo_preview(uuid, numeric, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_allocate(uuid, uuid, numeric, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_release(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_touch(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_my_config() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_log_event(uuid, text, jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_sale_v2(uuid, jsonb, jsonb, numeric, uuid, numeric) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.billing_fefo_preview(uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_allocate(uuid, uuid, numeric, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_release(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_touch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_my_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.billing_log_event(uuid, text, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_sale_v2(uuid, jsonb, jsonb, numeric, uuid, numeric) TO authenticated;

-- Legacy entry point: kept for rollback, but browsers can no longer call it,
-- so reservations, FEFO verification and permission checks cannot be bypassed.
-- Rollback: GRANT EXECUTE ON FUNCTION public.finalize_sale(uuid, jsonb, jsonb, numeric) TO authenticated;
DO $$
BEGIN
  IF to_regprocedure('public.finalize_sale(uuid, jsonb, jsonb, numeric)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.finalize_sale(uuid, jsonb, jsonb, numeric) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

COMMIT;
