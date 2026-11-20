-- =============================================================================
-- 0024 · Purchases management: purchase orders and a richer purchase list
--
-- Adds (existing purchase posting is unchanged — confirm_purchase_v2 still
-- does all stock, FIFO-layer, payable and payment work):
--   • purchase_orders / purchase_order_items — orders sent to a distributor
--     (status ordered → partial → received, or cancelled / closed)
--   • purchase_invoices.purchase_order_id   — which order a bill received
--   • purchase_list_v2()      — bills with items, units, paid, returned, bill files
--                               and order status; money columns for admins only
--   • purchase_order_save()   — create / edit an order (while nothing is received)
--   • purchase_order_list()   — orders with their lines
--   • purchase_order_cancel() — cancel an order, or close a partly received one
--   • confirm_purchase_v3()   — posts a bill (confirm_purchase_v2) and, when it
--                               receives an order, updates the order's received
--                               quantities and status in the same transaction
-- Roles: super_admin, admin, pharmacist, inventory_staff, inventory (same as
-- purchase posting). Safe to run twice.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES public.branches(id),
  po_no          text NOT NULL,
  distributor_id uuid NOT NULL REFERENCES public.distributors(id),
  order_date     date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  expected_date  date,
  status         text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','partial','received','cancelled','closed')),
  notes          text,
  cancel_reason  text,
  created_by     uuid REFERENCES public.profiles(id),
  updated_by     uuid REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, po_no)
);
CREATE INDEX IF NOT EXISTS purchase_orders_branch_idx ON public.purchase_orders(branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL REFERENCES public.branches(id),
  medicine_id  uuid NOT NULL REFERENCES public.medicines(id),
  qty          numeric NOT NULL CHECK (qty > 0),            -- packs ordered
  pack         numeric NOT NULL DEFAULT 1 CHECK (pack >= 1), -- units per pack
  rate         numeric CHECK (rate IS NULL OR rate >= 0),   -- expected rate per pack
  received_qty numeric NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  note         text,
  UNIQUE (order_id, medicine_id)
);
CREATE INDEX IF NOT EXISTS purchase_order_items_order_idx ON public.purchase_order_items(order_id);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_orders, public.purchase_order_items FROM PUBLIC, anon, authenticated;

ALTER TABLE public.purchase_invoices ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES public.purchase_orders(id);

-- ---------------------------------------------------------------------------
-- Purchase list with everything the page shows
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.purchase_list_v2(date, date, integer);
CREATE FUNCTION public.purchase_list_v2(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit integer DEFAULT 2000)
RETURNS TABLE (
  id uuid, supplier_invoice_no text, invoice_date date, created_at timestamptz, due_date date,
  distributor_id uuid, distributor text, status text, line_count integer, pack_qty numeric, stock_units numeric,
  total numeric, paid numeric, returned numeric, doc_count integer,
  order_id uuid, order_no text, order_status text, created_by_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := COALESCE(public.my_role(), '');
  v_admin boolean := v_role IN ('super_admin','admin');
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF v_role NOT IN ('super_admin','admin','pharmacist','inventory_staff','inventory') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  RETURN QUERY
  SELECT i.id, i.supplier_invoice_no, i.invoice_date, i.created_at, i.due_date,
         i.distributor_id, d.name, i.status,
         COALESCE(it.n, 0)::integer, COALESCE(it.packs, 0), COALESCE(it.units, 0),
         CASE WHEN v_admin THEN i.total END,
         CASE WHEN v_admin THEN COALESCE((SELECT sum(sp.amount) FROM public.supplier_payments sp
                                  WHERE sp.purchase_invoice_id = i.id AND sp.status = 'posted'), 0) END,
         CASE WHEN v_admin THEN COALESCE((SELECT sum(pr.total_value) FROM public.purchase_returns pr
                                  WHERE pr.purchase_invoice_id = i.id), 0) END,
         (SELECT count(*) FROM public.purchase_documents pd WHERE pd.purchase_invoice_id = i.id AND pd.status = 'active')::integer,
         po.id, po.po_no, po.status, pf.full_name
  FROM public.purchase_invoices i
  JOIN public.distributors d ON d.id = i.distributor_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, sum(pi.qty + COALESCE(pi.free_qty, 0)) AS packs,
           sum(pi.base_qty + COALESCE(pi.free_base_qty, 0)) AS units
    FROM public.purchase_items pi WHERE pi.invoice_id = i.id) it ON true
  LEFT JOIN public.purchase_orders po ON po.id = i.purchase_order_id
  LEFT JOIN public.profiles pf ON pf.id = i.created_by
  WHERE i.branch_id = v_branch
    AND (p_from IS NULL OR i.invoice_date >= p_from)
    AND (p_to IS NULL OR i.invoice_date <= p_to)
  ORDER BY i.invoice_date DESC, i.created_at DESC
  LIMIT greatest(1, least(COALESCE(p_limit, 2000), 5000));
END;
$$;

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------
-- p_header: {distributor_id, order_date, expected_date, notes}
-- p_items : [{medicine_id, qty (packs), pack, rate (per pack, optional), note}]
CREATE OR REPLACE FUNCTION public.purchase_order_save(p_id uuid, p_header jsonb, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._purchase_assert_writer();
  v_dist uuid := nullif(p_header->>'distributor_id','')::uuid;
  v_date date := COALESCE(nullif(p_header->>'order_date','')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_exp date := nullif(p_header->>'expected_date','')::date;
  v_id uuid; v_no text; v_seq int; it jsonb; v_med uuid; v_qty numeric; v_pack numeric; v_rate numeric;
  po public.purchase_orders%ROWTYPE;
BEGIN
  IF v_dist IS NULL OR NOT EXISTS (SELECT 1 FROM public.distributors WHERE id = v_dist AND branch_id = v_branch AND active) THEN
    RAISE EXCEPTION 'Distributor missing or inactive in this branch';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one medicine to the order';
  END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'Too many lines in one order'; END IF;
  IF v_exp IS NOT NULL AND v_exp < v_date THEN RAISE EXCEPTION 'Expected date is before the order date'; END IF;

  IF p_id IS NULL THEN
    SELECT COALESCE(max(nullif(regexp_replace(po_no, '^PO-\d{6}-', ''), '')::int), 0) + 1 INTO v_seq
    FROM public.purchase_orders
    WHERE branch_id = v_branch AND po_no LIKE 'PO-' || to_char(v_date, 'YYYYMM') || '-%' AND po_no ~ '^PO-\d{6}-\d+$';
    v_no := 'PO-' || to_char(v_date, 'YYYYMM') || '-' || lpad(v_seq::text, 4, '0');
    INSERT INTO public.purchase_orders (branch_id, po_no, distributor_id, order_date, expected_date, notes, created_by, updated_by)
    VALUES (v_branch, v_no, v_dist, v_date, v_exp, nullif(trim(p_header->>'notes'), ''), auth.uid(), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO po FROM public.purchase_orders WHERE id = p_id AND branch_id = v_branch FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found in this branch'; END IF;
    IF po.status <> 'ordered' OR EXISTS (SELECT 1 FROM public.purchase_order_items WHERE order_id = p_id AND received_qty > 0) THEN
      RAISE EXCEPTION 'Only orders with nothing received can be edited';
    END IF;
    UPDATE public.purchase_orders SET distributor_id = v_dist, order_date = v_date, expected_date = v_exp,
      notes = nullif(trim(p_header->>'notes'), ''), updated_by = auth.uid(), updated_at = now()
    WHERE id = p_id;
    DELETE FROM public.purchase_order_items WHERE order_id = p_id;
    v_id := p_id; v_no := po.po_no;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_med := nullif(it->>'medicine_id','')::uuid;
    v_qty := nullif(it->>'qty','')::numeric;
    v_pack := COALESCE(nullif(it->>'pack','')::numeric, 1);
    v_rate := nullif(it->>'rate','')::numeric;
    IF v_med IS NULL OR NOT EXISTS (SELECT 1 FROM public.medicines WHERE id = v_med AND branch_id = v_branch) THEN
      RAISE EXCEPTION 'Medicine not found in this branch';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Order quantity must be above zero'; END IF;
    IF v_pack < 1 THEN RAISE EXCEPTION 'Pack factor must be at least 1'; END IF;
    IF v_rate IS NOT NULL AND v_rate < 0 THEN RAISE EXCEPTION 'Rate cannot be negative'; END IF;
    INSERT INTO public.purchase_order_items (order_id, branch_id, medicine_id, qty, pack, rate, note)
    VALUES (v_id, v_branch, v_med, v_qty, v_pack, v_rate, nullif(trim(it->>'note'), ''))
    ON CONFLICT (order_id, medicine_id) DO UPDATE SET qty = purchase_order_items.qty + EXCLUDED.qty;
  END LOOP;

  INSERT INTO public.audit_logs (branch_id, user_id, action, entity_type, entity_id, after_data)
  VALUES (v_branch, auth.uid(), CASE WHEN p_id IS NULL THEN 'purchase_order_create' ELSE 'purchase_order_update' END,
          'purchase_order', v_id::text, jsonb_build_object('po_no', v_no, 'lines', jsonb_array_length(p_items)));
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.purchase_order_list(integer);
CREATE FUNCTION public.purchase_order_list(p_limit integer DEFAULT 500)
RETURNS TABLE (
  id uuid, po_no text, order_date date, expected_date date, distributor_id uuid, distributor text,
  status text, notes text, cancel_reason text, line_count integer, ordered_qty numeric, received_qty numeric,
  est_value numeric, created_at timestamptz, created_by_name text, items jsonb, bills jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._purchase_assert_writer();
BEGIN
  RETURN QUERY
  SELECT po.id, po.po_no, po.order_date, po.expected_date, po.distributor_id, d.name, po.status, po.notes, po.cancel_reason,
         (SELECT count(*) FROM public.purchase_order_items x WHERE x.order_id = po.id)::integer,
         COALESCE((SELECT sum(x.qty) FROM public.purchase_order_items x WHERE x.order_id = po.id), 0),
         COALESCE((SELECT sum(least(x.received_qty, x.qty)) FROM public.purchase_order_items x WHERE x.order_id = po.id), 0),
         (SELECT round(sum(x.qty * x.rate), 2) FROM public.purchase_order_items x WHERE x.order_id = po.id AND x.rate IS NOT NULL),
         po.created_at, pf.full_name,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('medicine_id', x.medicine_id, 'name', m.name, 'strength', m.strength,
                     'qty', x.qty, 'pack', x.pack, 'rate', x.rate, 'received_qty', x.received_qty, 'note', x.note,
                     'tax_rate', m.tax_rate, 'mrp', m.mrp) ORDER BY m.name)
                   FROM public.purchase_order_items x JOIN public.medicines m ON m.id = x.medicine_id WHERE x.order_id = po.id), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'invoice_no', i.supplier_invoice_no, 'invoice_date', i.invoice_date) ORDER BY i.invoice_date)
                   FROM public.purchase_invoices i WHERE i.purchase_order_id = po.id), '[]'::jsonb)
  FROM public.purchase_orders po
  JOIN public.distributors d ON d.id = po.distributor_id
  LEFT JOIN public.profiles pf ON pf.id = po.created_by
  WHERE po.branch_id = v_branch
  ORDER BY po.created_at DESC
  LIMIT greatest(1, least(COALESCE(p_limit, 500), 2000));
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_cancel(p_id uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._purchase_assert_writer(); po public.purchase_orders%ROWTYPE; v_new text;
BEGIN
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Enter a reason'; END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_id AND branch_id = v_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found in this branch'; END IF;
  IF po.status NOT IN ('ordered','partial') THEN RAISE EXCEPTION 'This order is already %', po.status; END IF;
  v_new := CASE WHEN po.status = 'partial' THEN 'closed' ELSE 'cancelled' END;
  UPDATE public.purchase_orders SET status = v_new, cancel_reason = trim(p_reason), updated_by = auth.uid(), updated_at = now() WHERE id = p_id;
  INSERT INTO public.audit_logs (branch_id, user_id, action, entity_type, entity_id, reason, after_data)
  VALUES (v_branch, auth.uid(), 'purchase_order_' || v_new, 'purchase_order', p_id::text, trim(p_reason), jsonb_build_object('po_no', po.po_no));
  RETURN v_new;
END;
$$;

-- Post a bill and, if it receives an order, update the order in the same transaction.
CREATE OR REPLACE FUNCTION public.confirm_purchase_v3(
  p_header jsonb, p_items jsonb, p_payment jsonb DEFAULT NULL, p_draft uuid DEFAULT NULL, p_order uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._purchase_assert_writer();
  po public.purchase_orders%ROWTYPE;
  inv uuid;
  v_open int;
BEGIN
  IF p_order IS NOT NULL THEN
    SELECT * INTO po FROM public.purchase_orders WHERE id = p_order AND branch_id = v_branch FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found in this branch'; END IF;
    IF po.status NOT IN ('ordered','partial') THEN RAISE EXCEPTION 'Purchase order % is %', po.po_no, po.status; END IF;
    IF po.distributor_id <> nullif(p_header->>'distributor_id','')::uuid THEN
      RAISE EXCEPTION 'The bill supplier is not the supplier of order %', po.po_no;
    END IF;
  END IF;

  inv := public.confirm_purchase_v2(p_header, p_items, p_payment, p_draft);

  IF p_order IS NOT NULL THEN
    UPDATE public.purchase_invoices SET purchase_order_id = p_order, order_no = COALESCE(order_no, po.po_no),
           order_date = COALESCE(order_date, po.order_date)
    WHERE id = inv;
    UPDATE public.purchase_order_items x SET received_qty = x.received_qty + r.q
    FROM (SELECT pi.medicine_id, sum(pi.qty) AS q FROM public.purchase_items pi WHERE pi.invoice_id = inv GROUP BY 1) r
    WHERE x.order_id = p_order AND x.medicine_id = r.medicine_id;
    SELECT count(*) INTO v_open FROM public.purchase_order_items WHERE order_id = p_order AND received_qty < qty;
    UPDATE public.purchase_orders SET status = CASE WHEN v_open = 0 THEN 'received' ELSE 'partial' END,
           updated_by = auth.uid(), updated_at = now()
    WHERE id = p_order;
    INSERT INTO public.audit_logs (branch_id, user_id, action, entity_type, entity_id, after_data)
    VALUES (v_branch, auth.uid(), 'purchase_order_receive', 'purchase_order', p_order::text,
            jsonb_build_object('po_no', po.po_no, 'invoice', inv, 'status', CASE WHEN v_open = 0 THEN 'received' ELSE 'partial' END));
  END IF;
  RETURN inv;
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_list_v2(date, date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_order_save(uuid, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_order_list(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_order_cancel(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_purchase_v3(jsonb, jsonb, jsonb, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_list_v2(date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_order_save(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_order_list(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_order_cancel(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_purchase_v3(jsonb, jsonb, jsonb, uuid, uuid) TO authenticated;
