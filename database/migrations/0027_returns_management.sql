-- =============================================================================
-- 0027  Returns Management page (returns.html) — sales and purchase returns
-- Run once in the Supabase SQL editor after 0026. Safe to run twice.
--
-- Adds (nothing existing is removed or changed in meaning):
--   • sales_returns.reason_code   — wrong_medicine, adverse_reaction, expired, damaged,
--                                   doctor_changed, not_needed, other
--   • sales_returns.refund_type   — 'refund' (money back) or 'exchange' (value used
--                                   against a new bill). Money still leaves by Cash/UPI,
--                                   so finance posting is unchanged.
--   • purchase_returns.reason_code — expired, damaged, wrong_item, excess, recall, other
--   Existing returns get a reason code guessed from their reason text.
--
--   • process_sales_return_v2(...)    — process_sales_return + reason code + refund type
--   • process_purchase_return_v2(...) — process_purchase_return + reason code
--   • sales_returns_list(from, to)    — credit notes with invoice, customer, items, value
--   • purchase_returns_list(from, to) — supplier returns with distributor, invoice, items
--   • returns_top_medicines(kind, from, to, n)
--   • returns_base_total(kind, from, to) — sales or purchases in the period (return rate)
--   • return_detail(kind, id)         — one return with items (credit / debit note print)
--   • expiry_return_candidates(days)  — expired / near-expiry stock that can go back to
--                                       the distributor it was bought from
-- Roles: sales returns — super_admin, admin, pharmacist, billing_staff (as before);
--        purchase returns — super_admin, admin (as before).
-- =============================================================================

ALTER TABLE public.sales_returns
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS refund_type text NOT NULL DEFAULT 'refund';
ALTER TABLE public.purchase_returns
  ADD COLUMN IF NOT EXISTS reason_code text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_returns_refund_type_chk') THEN
    ALTER TABLE public.sales_returns ADD CONSTRAINT sales_returns_refund_type_chk CHECK (refund_type IN ('refund','exchange'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_returns_reason_code_chk') THEN
    ALTER TABLE public.sales_returns ADD CONSTRAINT sales_returns_reason_code_chk
      CHECK (reason_code IS NULL OR reason_code IN ('wrong_medicine','adverse_reaction','expired','damaged','doctor_changed','not_needed','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_returns_reason_code_chk') THEN
    ALTER TABLE public.purchase_returns ADD CONSTRAINT purchase_returns_reason_code_chk
      CHECK (reason_code IS NULL OR reason_code IN ('expired','damaged','wrong_item','excess','recall','other'));
  END IF;
END $$;

-- Guess a reason code for returns recorded before this migration (finance posting is idempotent).
UPDATE public.sales_returns SET reason_code = CASE
    WHEN reason ~* 'expir' THEN 'expired'
    WHEN reason ~* 'damag|broken|leak|torn' THEN 'damaged'
    WHEN reason ~* 'wrong|mistake|incorrect|strength' THEN 'wrong_medicine'
    WHEN reason ~* 'reaction|allerg|side.?effect|rash' THEN 'adverse_reaction'
    WHEN reason ~* 'doctor|prescri' THEN 'doctor_changed'
    WHEN reason ~* 'not needed|excess|extra|unused|no longer' THEN 'not_needed'
    ELSE 'other' END
WHERE reason_code IS NULL;
UPDATE public.purchase_returns SET reason_code = CASE
    WHEN reason ~* 'expir' THEN 'expired'
    WHEN reason ~* 'damag|broken|leak' THEN 'damaged'
    WHEN reason ~* 'wrong|incorrect|mistake' THEN 'wrong_item'
    WHEN reason ~* 'recall' THEN 'recall'
    WHEN reason ~* 'excess|slow|over.?stock|extra' THEN 'excess'
    ELSE 'other' END
WHERE reason_code IS NULL;

CREATE OR REPLACE FUNCTION public._returns_guard(p_kind text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF p_kind = 'sales' AND v_role NOT IN ('super_admin','admin','pharmacist','billing_staff') THEN RAISE EXCEPTION 'Not authorised to view sales returns'; END IF;
  IF p_kind = 'purchase' AND v_role NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised to view purchase returns'; END IF;
  IF p_kind NOT IN ('sales','purchase') THEN RAISE EXCEPTION 'Unknown return type'; END IF;
  RETURN v_branch;
END;
$$;

-- ---------------------------------------------------------------------------
-- Create returns (wrappers keep the proven stock / FIFO / finance logic)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_sales_return_v2(
  p_invoice uuid, p_items jsonb, p_method text, p_reason text,
  p_reason_code text DEFAULT 'other', p_refund_type text DEFAULT 'refund')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  IF COALESCE(p_reason_code, 'other') NOT IN ('wrong_medicine','adverse_reaction','expired','damaged','doctor_changed','not_needed','other') THEN
    RAISE EXCEPTION 'Choose a return reason';
  END IF;
  IF COALESCE(p_refund_type, 'refund') NOT IN ('refund','exchange') THEN
    RAISE EXCEPTION 'Refund type must be Refund or Exchange';
  END IF;
  v_id := public.process_sales_return(p_invoice, p_items, p_method, p_reason);
  UPDATE public.sales_returns
     SET reason_code = COALESCE(p_reason_code, 'other'), refund_type = COALESCE(p_refund_type, 'refund')
   WHERE id = v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_purchase_return_v2(
  p_invoice uuid, p_items jsonb, p_reason text, p_reason_code text DEFAULT 'other')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  IF COALESCE(p_reason_code, 'other') NOT IN ('expired','damaged','wrong_item','excess','recall','other') THEN
    RAISE EXCEPTION 'Choose a return reason';
  END IF;
  v_id := public.process_purchase_return(p_invoice, p_items, p_reason);
  UPDATE public.purchase_returns SET reason_code = COALESCE(p_reason_code, 'other') WHERE id = v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sales_returns_list(date, date);
CREATE FUNCTION public.sales_returns_list(p_from date, p_to date)
RETURNS TABLE (
  id uuid, return_no text, created_at timestamptz, invoice_id uuid, invoice_no text, invoice_at timestamptz,
  customer_id uuid, customer_name text, customer_phone text,
  items integer, qty numeric, total numeric, tax numeric, restocked numeric, damaged numeric,
  refund_method text, refund_type text, reason text, reason_code text, created_by_name text, medicines text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._returns_guard('sales');
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  IF p_to - p_from > 400 THEN RAISE EXCEPTION 'Choose a date range of 400 days or less'; END IF;
  RETURN QUERY
  SELECT r.id, r.return_no, r.created_at, r.invoice_id, i.invoice_no, i.created_at,
         r.customer_id, c.name, c.phone,
         COALESCE(it.n, 0)::integer, round(COALESCE(it.q, 0), 3), round(COALESCE(r.total, 0), 2), round(COALESCE(r.tax, 0), 2),
         round(COALESCE(it.good, 0), 2), round(COALESCE(it.bad, 0), 2),
         r.refund_method, COALESCE(r.refund_type, 'refund'), r.reason, COALESCE(r.reason_code, 'other'), pr.full_name, it.meds
  FROM public.sales_returns r
  LEFT JOIN public.sales_invoices i ON i.id = r.invoice_id
  LEFT JOIN public.customers c ON c.id = COALESCE(r.customer_id, i.customer_id)
  LEFT JOIN public.profiles pr ON pr.id = r.created_by
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, sum(x.qty) AS q,
           sum(x.line_total) FILTER (WHERE x.disposition = 'restock') AS good,
           sum(x.line_total) FILTER (WHERE x.disposition = 'damaged') AS bad,
           string_agg(DISTINCT trim(m.name || ' ' || COALESCE(m.strength, '')), ', ') AS meds
    FROM public.sales_return_items x JOIN public.medicines m ON m.id = x.medicine_id
    WHERE x.return_id = r.id
  ) it ON true
  WHERE r.branch_id = v_branch
    AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  ORDER BY r.created_at DESC, r.id
  LIMIT 20000;
END;
$$;

DROP FUNCTION IF EXISTS public.purchase_returns_list(date, date);
CREATE FUNCTION public.purchase_returns_list(p_from date, p_to date)
RETURNS TABLE (
  id uuid, return_no text, created_at timestamptz, purchase_invoice_id uuid, supplier_invoice_no text, invoice_date date,
  distributor_id uuid, distributor_name text, distributor_phone text,
  items integer, qty numeric, total numeric, reason text, reason_code text, created_by_name text, medicines text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._returns_guard('purchase');
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  IF p_to - p_from > 400 THEN RAISE EXCEPTION 'Choose a date range of 400 days or less'; END IF;
  RETURN QUERY
  SELECT r.id, r.return_no, r.created_at, r.purchase_invoice_id, pi.supplier_invoice_no, pi.invoice_date,
         r.distributor_id, d.name, d.phone,
         COALESCE(it.n, 0)::integer, round(COALESCE(it.q, 0), 3), round(COALESCE(r.total_value, 0), 2),
         r.reason, COALESCE(r.reason_code, 'other'), pr.full_name, it.meds
  FROM public.purchase_returns r
  LEFT JOIN public.purchase_invoices pi ON pi.id = r.purchase_invoice_id
  LEFT JOIN public.distributors d ON d.id = COALESCE(r.distributor_id, pi.distributor_id)
  LEFT JOIN public.profiles pr ON pr.id = r.created_by
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, sum(x.qty) AS q,
           string_agg(DISTINCT trim(m.name || ' ' || COALESCE(m.strength, '')), ', ') AS meds
    FROM public.purchase_return_items x JOIN public.medicines m ON m.id = x.medicine_id
    WHERE x.purchase_return_id = r.id
  ) it ON true
  WHERE r.branch_id = v_branch
    AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  ORDER BY r.created_at DESC, r.id
  LIMIT 20000;
END;
$$;

DROP FUNCTION IF EXISTS public.returns_top_medicines(text, date, date, integer);
CREATE FUNCTION public.returns_top_medicines(p_kind text, p_from date, p_to date, p_limit integer DEFAULT 10)
RETURNS TABLE (medicine_id uuid, name text, strength text, qty numeric, value numeric, returns integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._returns_guard(p_kind);
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  IF p_kind = 'sales' THEN
    RETURN QUERY
    SELECT m.id, m.name, m.strength, round(sum(x.qty), 3), round(sum(x.line_total), 2), count(DISTINCT x.return_id)::integer
    FROM public.sales_return_items x
    JOIN public.sales_returns r ON r.id = x.return_id
    JOIN public.medicines m ON m.id = x.medicine_id
    WHERE r.branch_id = v_branch AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    GROUP BY m.id, m.name, m.strength
    ORDER BY 4 DESC, 5 DESC, m.name
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 500);
  ELSE
    RETURN QUERY
    SELECT m.id, m.name, m.strength, round(sum(x.qty), 3), round(sum(x.line_value), 2), count(DISTINCT x.purchase_return_id)::integer
    FROM public.purchase_return_items x
    JOIN public.purchase_returns r ON r.id = x.purchase_return_id
    JOIN public.medicines m ON m.id = x.medicine_id
    WHERE r.branch_id = v_branch AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    GROUP BY m.id, m.name, m.strength
    ORDER BY 4 DESC, 5 DESC, m.name
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 500);
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.returns_base_total(text, date, date);
CREATE FUNCTION public.returns_base_total(p_kind text, p_from date, p_to date)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._returns_guard(p_kind); v numeric;
BEGIN
  IF p_kind = 'sales' THEN
    SELECT COALESCE(sum(total), 0) INTO v FROM public.sales_invoices
    WHERE branch_id = v_branch AND status = 'final' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to;
  ELSE
    SELECT COALESCE(sum(total), 0) INTO v FROM public.purchase_invoices
    WHERE branch_id = v_branch AND COALESCE(status, 'confirmed') <> 'cancelled' AND invoice_date BETWEEN p_from AND p_to;
  END IF;
  RETURN round(v, 2);
END;
$$;

DROP FUNCTION IF EXISTS public.return_detail(text, uuid);
CREATE FUNCTION public.return_detail(p_kind text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._returns_guard(p_kind); out jsonb; v_shop jsonb;
BEGIN
  SELECT jsonb_build_object('name', b.name, 'address', concat_ws(', ', nullif(b.address, ''), nullif(b.city, ''), nullif(b.state, ''), nullif(b.pincode, '')),
           'phone', b.phone, 'gstin', b.gstin,
           'drug_licence', (SELECT string_agg(v, ' / ') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(b.drug_licence_nos) = 'array' THEN b.drug_licence_nos ELSE '[]'::jsonb END) v))
    INTO v_shop FROM public.branches b WHERE b.id = v_branch;
  IF p_kind = 'sales' THEN
    SELECT jsonb_build_object(
      'kind', 'sales', 'shop', v_shop,
      'note', jsonb_build_object('id', r.id, 'return_no', r.return_no, 'created_at', r.created_at, 'reason', r.reason,
              'reason_code', COALESCE(r.reason_code, 'other'), 'refund_type', COALESCE(r.refund_type, 'refund'),
              'refund_method', r.refund_method, 'total', r.total, 'tax', r.tax, 'created_by', pr.full_name),
      'invoice_id', i.id, 'invoice_no', i.invoice_no, 'invoice_at', i.created_at, 'invoice_total', i.total,
      'customer', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone) END,
      'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', m.name, 'strength', m.strength, 'batch_no', b.batch_no, 'expiry', b.expiry,
                 'qty', x.qty, 'disposition', x.disposition, 'line_total', x.line_total) ORDER BY m.name)
               FROM public.sales_return_items x JOIN public.medicines m ON m.id = x.medicine_id
               LEFT JOIN public.medicine_batches b ON b.id = x.batch_id WHERE x.return_id = r.id), '[]'::jsonb))
    INTO out
    FROM public.sales_returns r
    LEFT JOIN public.sales_invoices i ON i.id = r.invoice_id
    LEFT JOIN public.customers c ON c.id = COALESCE(r.customer_id, i.customer_id)
    LEFT JOIN public.profiles pr ON pr.id = r.created_by
    WHERE r.id = p_id AND r.branch_id = v_branch;
  ELSE
    SELECT jsonb_build_object(
      'kind', 'purchase', 'shop', v_shop,
      'note', jsonb_build_object('id', r.id, 'return_no', r.return_no, 'created_at', r.created_at, 'reason', r.reason,
              'reason_code', COALESCE(r.reason_code, 'other'), 'total', r.total_value, 'created_by', pr.full_name),
      'invoice_id', pi.id, 'invoice_no', pi.supplier_invoice_no, 'invoice_date', pi.invoice_date, 'invoice_total', pi.total,
      'distributor', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('id', d.id, 'name', d.name, 'phone', d.phone,
                        'gstin', d.gstin, 'address', d.address, 'drug_licence', d.drug_licence) END,
      'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', m.name, 'strength', m.strength, 'batch_no', b.batch_no, 'expiry', b.expiry,
                 'qty', x.qty, 'base_qty', x.base_qty, 'unit_price', x.unit_price, 'line_total', x.line_value) ORDER BY m.name)
               FROM public.purchase_return_items x JOIN public.medicines m ON m.id = x.medicine_id
               LEFT JOIN public.medicine_batches b ON b.id = x.batch_id WHERE x.purchase_return_id = r.id), '[]'::jsonb))
    INTO out
    FROM public.purchase_returns r
    LEFT JOIN public.purchase_invoices pi ON pi.id = r.purchase_invoice_id
    LEFT JOIN public.distributors d ON d.id = COALESCE(r.distributor_id, pi.distributor_id)
    LEFT JOIN public.profiles pr ON pr.id = r.created_by
    WHERE r.id = p_id AND r.branch_id = v_branch;
  END IF;
  IF out IS NULL THEN RAISE EXCEPTION 'Return not found in this branch'; END IF;
  RETURN out;
END;
$$;

-- Expired / near-expiry stock that came from a purchase invoice and can still be returned.
DROP FUNCTION IF EXISTS public.expiry_return_candidates(integer);
CREATE FUNCTION public.expiry_return_candidates(p_days integer DEFAULT 90)
RETURNS TABLE (
  batch_id uuid, medicine_id uuid, name text, strength text, batch_no text, expiry date, stock numeric,
  purchase_item_id uuid, purchase_invoice_id uuid, supplier_invoice_no text, invoice_date date,
  distributor_id uuid, distributor_name text, returnable numeric, unit_factor numeric, unit_price numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._returns_guard('purchase');
BEGIN
  RETURN QUERY
  SELECT b.id, m.id, m.name, m.strength, b.batch_no, b.expiry, b.qty,
         p.id, pi.id, pi.supplier_invoice_no, pi.invoice_date, d.id, d.name,
         GREATEST(LEAST(p.qty - COALESCE(rt.q, 0), floor(b.qty / NULLIF(COALESCE(p.unit_factor, 1), 0))), 0),
         COALESCE(p.unit_factor, 1), p.unit_price
  FROM public.medicine_batches b
  JOIN public.medicines m ON m.id = b.medicine_id
  JOIN LATERAL (
    SELECT x.* FROM public.purchase_items x JOIN public.purchase_invoices y ON y.id = x.invoice_id
    WHERE x.batch_id = b.id AND x.branch_id = v_branch ORDER BY y.invoice_date DESC, x.id LIMIT 1
  ) p ON true
  JOIN public.purchase_invoices pi ON pi.id = p.invoice_id
  LEFT JOIN public.distributors d ON d.id = pi.distributor_id
  LEFT JOIN LATERAL (SELECT sum(z.qty) AS q FROM public.purchase_return_items z WHERE z.purchase_item_id = p.id) rt ON true
  WHERE b.branch_id = v_branch AND b.qty > 0
    AND b.expiry IS NOT NULL AND b.expiry <= (now() AT TIME ZONE 'Asia/Kolkata')::date + GREATEST(COALESCE(p_days, 90), 0)
  ORDER BY b.expiry, m.name;
END;
$$;

REVOKE ALL ON FUNCTION public._returns_guard(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_sales_return_v2(uuid, jsonb, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_purchase_return_v2(uuid, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_returns_list(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_returns_list(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.returns_top_medicines(text, date, date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.returns_base_total(text, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_detail(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expiry_return_candidates(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._returns_guard(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_sales_return_v2(uuid, jsonb, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_purchase_return_v2(uuid, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_returns_list(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_returns_list(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.returns_top_medicines(text, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.returns_base_total(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_detail(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expiry_return_candidates(integer) TO authenticated;
GRANT SELECT (reason_code, refund_type) ON public.sales_returns TO authenticated;
GRANT SELECT (reason_code) ON public.purchase_returns TO authenticated;

CREATE INDEX IF NOT EXISTS purchase_returns_branch_created_idx ON public.purchase_returns(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_return_items_return_idx ON public.purchase_return_items(purchase_return_id);
