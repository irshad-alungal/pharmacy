-- =============================================================================
-- 0029  Reports & Analytics page (reports.html)
-- Run once in the Supabase SQL editor after 0028. Safe to run twice.
--
--   • reports_overview(from, to)        — sales, orders, customers, purchases, expenses,
--                                         estimated net profit & margin, sales / purchase
--                                         returns for the range AND the previous range of
--                                         the same length; low-stock, out-of-stock,
--                                         near-expiry counts and stock value (now)
--   • reports_sales_by_category(from,to)— sales split by medicine category (bill totals
--                                         shared across lines, so it adds up to sales)
--   • report_runs                       — "Recent reports" history (who generated what,
--                                         for which period, how many rows)
--     report_run_log / report_runs_list / report_run_delete
--
-- Uses the same guard as every report_* function: an active work session and the
-- reports.view permission (super_admin / admin). Dates are India dates.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  report_id text NOT NULL,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'custom',
  p_from date,
  p_to date,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_runs_branch_at ON public.report_runs (branch_id, created_at DESC);
ALTER TABLE public.report_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_runs FROM PUBLIC, anon, authenticated;

-- figures for one date range (internal)
CREATE OR REPLACE FUNCTION public._reports_figures(p_branch uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sales numeric; v_orders bigint; v_cust bigint; v_walk bigint; v_tax numeric;
  v_ex numeric; v_cogs numeric; v_ret_ex numeric; v_back numeric;
  v_rn bigint; v_rv numeric; v_prn bigint; v_prv numeric; v_pur numeric; v_pn bigint; v_exp numeric;
  v_net numeric; v_profit numeric;
BEGIN
  SELECT COALESCE(sum(i.total), 0), count(*), count(DISTINCT i.customer_id), count(*) FILTER (WHERE i.customer_id IS NULL),
         COALESCE(sum(i.tax), 0)
    INTO v_sales, v_orders, v_cust, v_walk, v_tax
  FROM public.sales_invoices i
  WHERE i.branch_id = p_branch AND i.status = 'final' AND public._ist_date(i.created_at) BETWEEN p_from AND p_to;

  SELECT COALESCE(sum(public._sale_line_taxable(si) * CASE WHEN i.subtotal > 0 THEN i.total / i.subtotal ELSE 1 END), 0),
         COALESCE(sum((SELECT sum(a.total_cost) FROM public.inventory_sale_allocations a WHERE a.sales_item_id = si.id)), 0)
    INTO v_ex, v_cogs
  FROM public.sales_items si JOIN public.sales_invoices i ON i.id = si.invoice_id
  WHERE si.branch_id = p_branch AND i.status = 'final' AND public._ist_date(i.created_at) BETWEEN p_from AND p_to;

  SELECT COALESCE(sum(ri.line_total * 100 / (100 + si.tax_rate)), 0),
         COALESCE(sum((SELECT sum(a.restored_cost) FROM public.inventory_customer_return_allocations a WHERE a.sales_return_item_id = ri.id)), 0)
    INTO v_ret_ex, v_back
  FROM public.sales_return_items ri JOIN public.sales_returns r ON r.id = ri.return_id
  JOIN public.sales_items si ON si.id = ri.sales_item_id
  WHERE ri.branch_id = p_branch AND public._ist_date(r.created_at) BETWEEN p_from AND p_to;

  SELECT count(*), COALESCE(sum(r.total), 0) INTO v_rn, v_rv FROM public.sales_returns r
  WHERE r.branch_id = p_branch AND public._ist_date(r.created_at) BETWEEN p_from AND p_to;
  SELECT count(*), COALESCE(sum(r.total_value), 0) INTO v_prn, v_prv FROM public.purchase_returns r
  WHERE r.branch_id = p_branch AND public._ist_date(r.created_at) BETWEEN p_from AND p_to;
  SELECT COALESCE(sum(x.total), 0), count(*) INTO v_pur, v_pn FROM public.purchase_invoices x
  WHERE x.branch_id = p_branch AND x.status = 'confirmed' AND x.invoice_date BETWEEN p_from AND p_to;
  SELECT COALESCE(sum(e.amount), 0) INTO v_exp FROM public.expenses e
  WHERE e.branch_id = p_branch AND e.status = 'posted' AND e.expense_date BETWEEN p_from AND p_to;

  v_net := v_ex - v_ret_ex;
  v_profit := v_net - (v_cogs - v_back) - v_exp;
  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sales', round(v_sales, 2), 'orders', v_orders, 'customers', v_cust, 'walkins', v_walk, 'tax', round(v_tax, 2),
    'net_sales_ex_tax', round(v_net, 2), 'cogs', round(v_cogs - v_back, 2),
    'gross_profit', round(v_net - (v_cogs - v_back), 2),
    'purchases', round(v_pur, 2), 'purchase_bills', v_pn, 'expenses', round(v_exp, 2),
    'net_profit', round(v_profit, 2),
    'margin', CASE WHEN v_net > 0 THEN round(v_profit * 100 / v_net, 2) END,
    'avg_bill', CASE WHEN v_orders > 0 THEN round(v_sales / v_orders, 2) ELSE 0 END,
    'returns', v_rn, 'returns_value', round(v_rv, 2),
    'purchase_returns', v_prn, 'purchase_returns_value', round(v_prv, 2));
END;
$$;
REVOKE ALL ON FUNCTION public._reports_figures(uuid, date, date) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.reports_overview(date, date);
CREATE FUNCTION public.reports_overview(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._report_guard();
  v_today date := public.ist_today();
  v_len integer; v_pf date; v_pt date;
  v_low bigint; v_out bigint; v_near bigint; v_expired bigint; v_value numeric; v_meds bigint;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  IF p_to - p_from > 1830 THEN RAISE EXCEPTION 'Choose a date range of 5 years or less'; END IF;
  v_len := p_to - p_from + 1;
  v_pt := p_from - 1; v_pf := p_from - v_len;

  WITH s AS (
    SELECT m.id, m.reorder_level,
           COALESCE(sum(b.qty) FILTER (WHERE b.expiry > v_today AND NOT b.quarantined AND b.stock_status = 'active'), 0) AS sellable
    FROM public.medicines m
    LEFT JOIN public.medicine_batches b ON b.medicine_id = m.id AND b.branch_id = m.branch_id
    WHERE m.branch_id = v_branch AND m.active
    GROUP BY m.id, m.reorder_level)
  SELECT count(*) FILTER (WHERE reorder_level > 0 AND sellable > 0 AND sellable <= reorder_level),
         count(*) FILTER (WHERE sellable <= 0), count(*)
    INTO v_low, v_out, v_meds FROM s;

  SELECT count(*) FILTER (WHERE b.expiry > v_today AND b.expiry <= v_today + 90),
         count(*) FILTER (WHERE b.expiry <= v_today),
         COALESCE(sum(b.qty * COALESCE(b.unit_cost, m.purchase_price, 0)) FILTER (WHERE b.expiry > v_today), 0)
    INTO v_near, v_expired, v_value
  FROM public.medicine_batches b JOIN public.medicines m ON m.id = b.medicine_id
  WHERE b.branch_id = v_branch AND b.qty > 0;

  RETURN jsonb_build_object(
    'current', public._reports_figures(v_branch, p_from, p_to),
    'previous', public._reports_figures(v_branch, v_pf, v_pt),
    'stock', jsonb_build_object('medicines', v_meds, 'low_stock', v_low, 'out_of_stock', v_out,
                                'near_expiry_batches', v_near, 'expired_batches', v_expired,
                                'stock_value', round(v_value, 2)));
END;
$$;

DROP FUNCTION IF EXISTS public.reports_sales_by_category(date, date);
CREATE FUNCTION public.reports_sales_by_category(p_from date, p_to date)
RETURNS TABLE (category text, sales numeric, qty numeric, bills bigint, medicines bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  RETURN QUERY
  WITH inv AS (
    SELECT i.id, i.total FROM public.sales_invoices i
    WHERE i.branch_id = v_branch AND i.status = 'final' AND public._ist_date(i.created_at) BETWEEN p_from AND p_to),
  lines AS (
    SELECT si.invoice_id, si.medicine_id, si.qty, si.line_total, inv.total,
           sum(si.line_total) OVER (PARTITION BY si.invoice_id) AS inv_lines
    FROM public.sales_items si JOIN inv ON inv.id = si.invoice_id),
  parts AS (
    SELECT COALESCE(c.name, 'Uncategorised')::text AS cat,
           CASE WHEN l.inv_lines > 0 THEN l.line_total / l.inv_lines * l.total ELSE 0 END AS amt,
           l.qty, l.invoice_id, l.medicine_id
    FROM lines l JOIN public.medicines m ON m.id = l.medicine_id
    LEFT JOIN public.categories c ON c.id = m.category_id
    UNION ALL   -- bills without item lines (legacy / imported) still count towards sales
    SELECT 'Uncategorised', inv.total, 0, inv.id, NULL FROM inv
    WHERE NOT EXISTS (SELECT 1 FROM public.sales_items si WHERE si.invoice_id = inv.id) OR
          NOT EXISTS (SELECT 1 FROM public.sales_items si WHERE si.invoice_id = inv.id AND si.line_total <> 0))
  SELECT p.cat, round(sum(p.amt), 2), round(sum(p.qty), 3), count(DISTINCT p.invoice_id), count(DISTINCT p.medicine_id)
  FROM parts p
  GROUP BY 1 ORDER BY 2 DESC, 1;
END;
$$;

-- Recent reports history -----------------------------------------------------
DROP FUNCTION IF EXISTS public.report_run_log(text, text, text, date, date, jsonb, integer);
CREATE FUNCTION public.report_run_log(p_report text, p_title text, p_category text, p_from date, p_to date, p_params jsonb, p_rows integer)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard(); v_id uuid;
BEGIN
  IF nullif(trim(p_report), '') IS NULL OR length(p_report) > 40 THEN RAISE EXCEPTION 'Report id is required'; END IF;
  IF nullif(trim(p_title), '') IS NULL OR length(p_title) > 160 THEN RAISE EXCEPTION 'Report name is required (160 characters max)'; END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_to < p_from THEN RAISE EXCEPTION 'From date is after To date'; END IF;
  INSERT INTO public.report_runs (branch_id, report_id, title, category, p_from, p_to, params, row_count, created_by)
  VALUES (v_branch, trim(p_report), trim(p_title), COALESCE(nullif(lower(trim(p_category)), ''), 'custom'),
          p_from, p_to, COALESCE(p_params, '{}'::jsonb), GREATEST(COALESCE(p_rows, 0), 0), auth.uid())
  RETURNING id INTO v_id;
  -- keep the newest 500 per branch
  DELETE FROM public.report_runs WHERE branch_id = v_branch AND id IN (
    SELECT id FROM public.report_runs WHERE branch_id = v_branch ORDER BY created_at DESC OFFSET 500);
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.report_runs_list(integer, text);
CREATE FUNCTION public.report_runs_list(p_limit integer DEFAULT 50, p_category text DEFAULT NULL)
RETURNS TABLE (id uuid, report_id text, title text, category text, p_from date, p_to date, params jsonb,
               row_count integer, created_at timestamptz, created_by uuid, generated_by text, mine boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard();
BEGIN
  RETURN QUERY
  SELECT r.id, r.report_id, r.title, r.category, r.p_from, r.p_to, r.params, r.row_count, r.created_at, r.created_by,
         COALESCE(p.full_name, 'Staff')::text, r.created_by = auth.uid()
  FROM public.report_runs r LEFT JOIN public.profiles p ON p.id = r.created_by
  WHERE r.branch_id = v_branch AND (nullif(trim(p_category), '') IS NULL OR r.category = lower(trim(p_category)))
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
END;
$$;

DROP FUNCTION IF EXISTS public.report_run_delete(uuid);
CREATE FUNCTION public.report_run_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard(); v_by uuid;
BEGIN
  SELECT created_by INTO v_by FROM public.report_runs WHERE id = p_id AND branch_id = v_branch;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report not found'; END IF;
  IF v_by IS DISTINCT FROM auth.uid() AND COALESCE(public.my_role(), '') <> 'super_admin' THEN
    RAISE EXCEPTION 'Only the person who generated it (or the owner) can remove this report';
  END IF;
  DELETE FROM public.report_runs WHERE id = p_id;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['reports_overview(date,date)', 'reports_sales_by_category(date,date)',
    'report_run_log(text,text,text,date,date,jsonb,integer)', 'report_runs_list(integer,text)', 'report_run_delete(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
