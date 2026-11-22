-- =============================================================================
-- 0026  Sales Management page (sales.html)
-- Run once in the Supabase SQL editor after 0025. Read-only reporting functions —
-- no table is changed. Safe to run twice.
--
--   • sales_list(from, to)            — every bill of my branch in the date range with
--                                       customer, item count, payment split, returns,
--                                       billed-by and medicine names / barcodes (search)
--   • sales_summary(from, to, until)  — sales, bills, unique customers, walk-ins,
--                                       discount, GST, returns, cash/UPI/card/credit
--   • sales_daily(from, to)           — sales, bills, customers and returns per day
--   • sales_top_medicines(from, to, n)— best sellers by quantity, with sales value
--
-- Dates are India dates (Asia/Kolkata). Cancelled / refunded bills are listed but are
-- not counted as sales. Roles: super_admin, admin, pharmacist, billing_staff
-- (the roles that already open the Sales page).
-- =============================================================================

CREATE OR REPLACE FUNCTION public._sales_guard()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin','pharmacist','billing_staff','billing') THEN
    RAISE EXCEPTION 'Not authorised to view sales';
  END IF;
  RETURN v_branch;
END;
$$;

DROP FUNCTION IF EXISTS public.sales_list(date, date);
CREATE FUNCTION public.sales_list(p_from date, p_to date)
RETURNS TABLE (
  id uuid, invoice_no text, created_at timestamptz, status text,
  customer_id uuid, customer_name text, customer_phone text, patient_name text, doctor_name text,
  items integer, qty numeric, subtotal numeric, discount numeric, tax numeric, total numeric,
  paid_cash numeric, paid_upi numeric, paid_card numeric, paid_credit numeric,
  returned numeric, returns integer, billed_by text, medicines text, barcodes text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._sales_guard();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  IF p_to - p_from > 400 THEN RAISE EXCEPTION 'Choose a date range of 400 days or less'; END IF;
  RETURN QUERY
  SELECT i.id, i.invoice_no, i.created_at, i.status,
         i.customer_id, c.name, c.phone, i.patient_name, i.doctor_name,
         COALESCE(it.n, 0)::integer, round(COALESCE(it.q, 0), 3),
         round(COALESCE(i.subtotal, 0), 2),
         round(COALESCE(i.discount, 0) + COALESCE(i.line_discount, 0), 2),
         round(COALESCE(i.tax, 0), 2), round(COALESCE(i.total, 0), 2),
         round(COALESCE(pm.cash, 0), 2), round(COALESCE(pm.upi, 0), 2),
         round(COALESCE(pm.card, 0), 2), round(COALESCE(pm.credit, 0), 2),
         round(COALESCE(rt.total, 0), 2), COALESCE(rt.n, 0)::integer,
         pr.full_name, it.meds, it.codes
  FROM public.sales_invoices i
  LEFT JOIN public.customers c ON c.id = i.customer_id
  LEFT JOIN public.profiles pr ON pr.id = i.created_by
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, sum(si.qty) AS q,
           string_agg(DISTINCT trim(m.name || ' ' || COALESCE(m.strength, '')), ', ') AS meds,
           string_agg(DISTINCT m.barcode, ' ') AS codes
    FROM public.sales_items si JOIN public.medicines m ON m.id = si.medicine_id
    WHERE si.invoice_id = i.id
  ) it ON true
  LEFT JOIN LATERAL (
    SELECT sum(p.amount) FILTER (WHERE p.method = 'cash') AS cash,
           sum(p.amount) FILTER (WHERE p.method = 'upi') AS upi,
           sum(p.amount) FILTER (WHERE p.method = 'card') AS card,
           sum(p.amount) FILTER (WHERE p.method = 'credit') AS credit
    FROM public.payments p WHERE p.invoice_id = i.id
  ) pm ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, sum(r.total) AS total FROM public.sales_returns r WHERE r.invoice_id = i.id
  ) rt ON true
  WHERE i.branch_id = v_branch
    AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  ORDER BY i.created_at DESC, i.id
  LIMIT 20000;
END;
$$;

DROP FUNCTION IF EXISTS public.sales_summary(date, date, timestamptz);
CREATE FUNCTION public.sales_summary(p_from date, p_to date, p_until timestamptz DEFAULT NULL)
RETURNS TABLE (
  sales numeric, orders integer, customers integer, walkins integer,
  discount numeric, tax numeric, returns numeric, return_count integer,
  cash numeric, upi numeric, card numeric, credit numeric, cancelled integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._sales_guard();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  RETURN QUERY
  WITH inv AS (
    SELECT i.* FROM public.sales_invoices i
    WHERE i.branch_id = v_branch
      AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
      AND (p_until IS NULL OR i.created_at <= p_until)
  ), fin AS (SELECT * FROM inv WHERE inv.status = 'final'),
  pay AS (
    SELECT p.method, sum(p.amount) AS amt FROM public.payments p JOIN fin ON fin.id = p.invoice_id GROUP BY p.method
  ), ret AS (
    SELECT count(*) AS n, sum(r.total) AS total FROM public.sales_returns r
    WHERE r.branch_id = v_branch
      AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
      AND (p_until IS NULL OR r.created_at <= p_until)
  )
  SELECT round(COALESCE((SELECT sum(total) FROM fin), 0), 2),
         (SELECT count(*) FROM fin)::integer,
         (SELECT count(DISTINCT customer_id) FROM fin)::integer,
         (SELECT count(*) FROM fin WHERE customer_id IS NULL)::integer,
         round(COALESCE((SELECT sum(COALESCE(fin.discount, 0) + COALESCE(fin.line_discount, 0)) FROM fin), 0), 2),
         round(COALESCE((SELECT sum(fin.tax) FROM fin), 0), 2),
         round(COALESCE((SELECT ret.total FROM ret), 0), 2),
         COALESCE((SELECT ret.n FROM ret), 0)::integer,
         round(COALESCE((SELECT amt FROM pay WHERE method = 'cash'), 0), 2),
         round(COALESCE((SELECT amt FROM pay WHERE method = 'upi'), 0), 2),
         round(COALESCE((SELECT amt FROM pay WHERE method = 'card'), 0), 2),
         round(COALESCE((SELECT amt FROM pay WHERE method = 'credit'), 0), 2),
         (SELECT count(*) FROM inv WHERE inv.status <> 'final')::integer;
END;
$$;

DROP FUNCTION IF EXISTS public.sales_daily(date, date);
CREATE FUNCTION public.sales_daily(p_from date, p_to date)
RETURNS TABLE (day date, sales numeric, orders integer, customers integer, returns numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._sales_guard();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  IF p_to - p_from > 400 THEN RAISE EXCEPTION 'Choose a date range of 400 days or less'; END IF;
  RETURN QUERY
  WITH d AS (SELECT gs::date AS day FROM generate_series(p_from, p_to, interval '1 day') gs),
  s AS (
    SELECT (i.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sum(i.total) AS sales, count(*) AS n, count(DISTINCT i.customer_id) AS c
    FROM public.sales_invoices i
    WHERE i.branch_id = v_branch AND i.status = 'final'
      AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    GROUP BY 1
  ), r AS (
    SELECT (x.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sum(x.total) AS total
    FROM public.sales_returns x
    WHERE x.branch_id = v_branch AND (x.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    GROUP BY 1
  )
  SELECT d.day, round(COALESCE(s.sales, 0), 2), COALESCE(s.n, 0)::integer, COALESCE(s.c, 0)::integer, round(COALESCE(r.total, 0), 2)
  FROM d LEFT JOIN s ON s.day = d.day LEFT JOIN r ON r.day = d.day
  ORDER BY d.day;
END;
$$;

DROP FUNCTION IF EXISTS public.sales_top_medicines(date, date, integer);
CREATE FUNCTION public.sales_top_medicines(p_from date, p_to date, p_limit integer DEFAULT 10)
RETURNS TABLE (medicine_id uuid, name text, strength text, qty numeric, sales numeric, bills integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._sales_guard();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  RETURN QUERY
  SELECT m.id, m.name, m.strength,
         round(sum(COALESCE(si.base_qty, si.qty)), 3), round(sum(si.line_total), 2), count(DISTINCT si.invoice_id)::integer
  FROM public.sales_items si
  JOIN public.sales_invoices i ON i.id = si.invoice_id
  JOIN public.medicines m ON m.id = si.medicine_id
  WHERE i.branch_id = v_branch AND i.status = 'final'
    AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  GROUP BY m.id, m.name, m.strength
  ORDER BY 4 DESC, 5 DESC, m.name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 500);
END;
$$;

REVOKE ALL ON FUNCTION public._sales_guard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_list(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_summary(date, date, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_daily(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sales_top_medicines(date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._sales_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_list(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_summary(date, date, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_daily(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_top_medicines(date, date, integer) TO authenticated;

CREATE INDEX IF NOT EXISTS sales_invoices_branch_created_idx ON public.sales_invoices(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_invoice_method_idx ON public.payments(invoice_id, method);
CREATE INDEX IF NOT EXISTS sales_returns_invoice_idx ON public.sales_returns(invoice_id);
