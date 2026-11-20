-- =============================================================================
-- 0023 · Stock transfer between branches of the same pharmacy
--
-- Adds (nothing existing is changed):
--   • stock_transfers           — one row per transfer (both branches can read it)
--   • stock_transfer_branches() — other active branches of the same pharmacy
--   • stock_transfer()          — moves quantity from a batch in my branch to the
--                                 same medicine / batch in the other branch
-- Stock, FIFO cost layers and stock_movements ('transfer') stay consistent on
-- both sides, and both branches get an audit-log row. Safe to run twice.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no     text NOT NULL,
  from_branch_id  uuid NOT NULL REFERENCES public.branches(id),
  to_branch_id    uuid NOT NULL REFERENCES public.branches(id),
  medicine_id     uuid NOT NULL REFERENCES public.medicines(id),
  from_batch_id   uuid NOT NULL REFERENCES public.medicine_batches(id),
  to_medicine_id  uuid NOT NULL REFERENCES public.medicines(id),
  to_batch_id     uuid NOT NULL REFERENCES public.medicine_batches(id),
  qty             numeric NOT NULL CHECK (qty > 0),
  unit_cost       numeric,
  reason          text NOT NULL,
  created_by      uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (from_branch_id <> to_branch_id)
);
CREATE INDEX IF NOT EXISTS stock_transfers_from_idx ON public.stock_transfers(from_branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_transfers_to_idx ON public.stock_transfers(to_branch_id, created_at DESC);
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_transfers_read ON public.stock_transfers;
CREATE POLICY stock_transfers_read ON public.stock_transfers FOR SELECT TO authenticated
  USING (public.my_branch_id() IN (from_branch_id, to_branch_id)
         AND COALESCE(public.my_role(), '') IN ('super_admin','admin','pharmacist','inventory_staff','inventory'));
REVOKE ALL ON public.stock_transfers FROM PUBLIC, anon;
GRANT SELECT ON public.stock_transfers TO authenticated;

-- Other active branches of my pharmacy
CREATE OR REPLACE FUNCTION public.stock_transfer_branches()
RETURNS TABLE(id uuid, name text, code text, city text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT b.id, b.name, b.code, b.city
  FROM public.branches b
  JOIN public.branches mine ON mine.id = public.my_branch_id()
  WHERE b.pharmacy_id = mine.pharmacy_id
    AND b.id <> mine.id
    AND b.is_active
    AND auth.uid() IS NOT NULL
    AND COALESCE(public.my_role(), '') IN ('super_admin','admin','pharmacist','inventory_staff','inventory')
  ORDER BY b.name;
$$;

CREATE OR REPLACE FUNCTION public.stock_transfer(p_batch uuid, p_qty numeric, p_to_branch uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app', 'pg_temp'
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := COALESCE(public.my_role(), '');
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_qty numeric := round(COALESCE(p_qty, 0), 3);
  v_reason text := NULLIF(left(trim(COALESCE(p_reason, '')), 300), '');
  b public.medicine_batches%ROWTYPE;
  m public.medicines%ROWTYPE;
  v_target public.branches%ROWTYPE;
  v_reserved numeric;
  v_to_med uuid;
  v_to_batch uuid;
  v_out_mv bigint;
  v_in_mv bigint;
  v_needed numeric;
  v_take numeric;
  v_cost_total numeric := 0;
  v_unit_cost numeric;
  v_layer record;
  v_id uuid := gen_random_uuid();
  v_no text;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login with an active branch is required'; END IF;
  IF v_role NOT IN ('super_admin','admin','pharmacist','inventory_staff','inventory') THEN RAISE EXCEPTION 'Not authorised to transfer stock'; END IF;
  IF NOT COALESCE(app.session_ok(), false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  IF v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF;

  SELECT * INTO v_target FROM public.branches WHERE id = p_to_branch;
  IF NOT FOUND OR NOT v_target.is_active OR v_target.id = v_branch
     OR v_target.pharmacy_id IS DISTINCT FROM (SELECT pharmacy_id FROM public.branches WHERE id = v_branch) THEN
    RAISE EXCEPTION 'Choose another active branch of this pharmacy';
  END IF;

  SELECT * INTO b FROM public.medicine_batches WHERE id = p_batch AND branch_id = v_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found in this branch'; END IF;
  IF b.expiry <= v_today THEN RAISE EXCEPTION 'Expired stock cannot be transferred'; END IF;
  IF b.quarantined OR COALESCE(b.stock_status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'Quarantined, blocked, recalled or damaged stock cannot be transferred';
  END IF;
  SELECT COALESCE(sum(r.qty), 0) INTO v_reserved FROM public.stock_reservations r WHERE r.batch_id = b.id AND r.expires_at > now();
  IF v_qty > b.qty - v_reserved THEN
    RAISE EXCEPTION 'Only % available to transfer (% in stock, % reserved by open bills)', b.qty - v_reserved, b.qty, v_reserved;
  END IF;
  SELECT * INTO m FROM public.medicines WHERE id = b.medicine_id;

  -- Same medicine in the target branch (name + strength), created if missing.
  SELECT id INTO v_to_med FROM public.medicines
  WHERE branch_id = v_target.id AND lower(trim(name)) = lower(trim(m.name))
    AND COALESCE(lower(trim(strength)), '') = COALESCE(lower(trim(m.strength)), '')
  ORDER BY active DESC, created_at LIMIT 1;
  IF v_to_med IS NULL THEN
    INSERT INTO public.medicines (branch_id, name, generic_name, barcode, sku, mrp, selling_price, purchase_price, tax_rate,
      brand, composition, strength, dosage_form, category_id, manufacturer_id, base_unit_id, reorder_level,
      ingredients, need_doctor_sheet, discount_percentage, price_includes_tax, active)
    VALUES (v_target.id, m.name, m.generic_name, m.barcode, m.sku, m.mrp, m.selling_price, m.purchase_price, m.tax_rate,
      m.brand, m.composition, m.strength, m.dosage_form, m.category_id, m.manufacturer_id, m.base_unit_id, 0,
      m.ingredients, m.need_doctor_sheet, m.discount_percentage, m.price_includes_tax, true)
    RETURNING id INTO v_to_med;
  END IF;

  -- Same batch number in the target branch, created if missing.
  SELECT id INTO v_to_batch FROM public.medicine_batches WHERE medicine_id = v_to_med AND batch_no = b.batch_no FOR UPDATE;
  IF v_to_batch IS NULL THEN
    INSERT INTO public.medicine_batches (branch_id, medicine_id, batch_no, expiry, qty, quarantined, unit_cost, mrp, tax_rate, price_includes_tax, stock_status)
    VALUES (v_target.id, v_to_med, b.batch_no, b.expiry, 0, false, b.unit_cost, b.mrp, b.tax_rate, b.price_includes_tax, 'active')
    RETURNING id INTO v_to_batch;
  END IF;

  -- Source: reduce stock, record movement, consume FIFO layers.
  UPDATE public.medicine_batches SET qty = qty - v_qty WHERE id = b.id;
  v_no := 'TRF-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD-HH24MISS') || '-' || left(v_id::text, 4);
  INSERT INTO public.stock_movements (branch_id, medicine_id, batch_id, movement_type, qty, ref_type, ref_id, reason, created_by)
  VALUES (v_branch, b.medicine_id, b.id, 'transfer', -v_qty, 'stock_transfer', v_id, 'To ' || v_target.name || ': ' || v_reason, auth.uid())
  RETURNING id INTO v_out_mv;
  v_needed := v_qty;
  FOR v_layer IN
    SELECT id, remaining_qty, unit_cost FROM public.inventory_cost_layers
    WHERE batch_id = b.id AND remaining_qty > 0 ORDER BY received_at, created_at, id FOR UPDATE
  LOOP
    EXIT WHEN v_needed <= 0;
    v_take := least(v_needed, v_layer.remaining_qty);
    UPDATE public.inventory_cost_layers SET remaining_qty = remaining_qty - v_take WHERE id = v_layer.id;
    INSERT INTO public.inventory_adjustment_allocations (branch_id, movement_id, cost_layer_id, allocation_action, qty, unit_cost)
    VALUES (v_branch, v_out_mv, v_layer.id, 'consume', v_take, v_layer.unit_cost);
    v_cost_total := v_cost_total + v_take * COALESCE(v_layer.unit_cost, b.unit_cost, 0);
    v_needed := v_needed - v_take;
  END LOOP;
  v_unit_cost := CASE WHEN v_qty > 0 THEN round((v_cost_total + v_needed * COALESCE(b.unit_cost, 0)) / v_qty, 4) END;

  -- Target: add stock, record movement, create one cost layer at the moved cost.
  UPDATE public.medicine_batches SET qty = qty + v_qty WHERE id = v_to_batch;
  INSERT INTO public.stock_movements (branch_id, medicine_id, batch_id, movement_type, qty, ref_type, ref_id, reason, created_by)
  VALUES (v_target.id, v_to_med, v_to_batch, 'transfer', v_qty, 'stock_transfer', v_id, 'From ' || (SELECT name FROM public.branches WHERE id = v_branch) || ': ' || v_reason, auth.uid())
  RETURNING id INTO v_in_mv;
  INSERT INTO public.inventory_cost_layers (branch_id, medicine_id, batch_id, layer_type, received_qty, remaining_qty, unit_cost, received_at, source_movement_id)
  VALUES (v_target.id, v_to_med, v_to_batch, 'adjustment', v_qty, v_qty, v_unit_cost, now(), v_in_mv);

  INSERT INTO public.stock_transfers (id, transfer_no, from_branch_id, to_branch_id, medicine_id, from_batch_id, to_medicine_id, to_batch_id, qty, unit_cost, reason, created_by)
  VALUES (v_id, v_no, v_branch, v_target.id, b.medicine_id, b.id, v_to_med, v_to_batch, v_qty, v_unit_cost, v_reason, auth.uid());

  INSERT INTO public.audit_logs (branch_id, user_id, action, entity_type, entity_id, reason, after_data)
  VALUES (v_branch, auth.uid(), 'stock_transfer_out', 'medicine_batch', b.id::text, v_reason,
          jsonb_build_object('transfer_no', v_no, 'to_branch', v_target.name, 'qty', v_qty, 'batch_no', b.batch_no)),
         (v_target.id, auth.uid(), 'stock_transfer_in', 'medicine_batch', v_to_batch::text, v_reason,
          jsonb_build_object('transfer_no', v_no, 'qty', v_qty, 'batch_no', b.batch_no));
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.stock_transfer_branches() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stock_transfer(uuid, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_transfer_branches() TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_transfer(uuid, numeric, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
