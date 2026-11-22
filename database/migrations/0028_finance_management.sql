-- =============================================================================
-- 0028  Finance Management page (finance.html)
-- Run once in the Supabase SQL editor after 0027. Safe to run twice.
-- Reporting functions read the source documents (bills, returns, receipts, supplier
-- payments, expenses, FIFO cost of medicines sold) so the figures match every other
-- page. New, admin-only actions:
--   • correct_daily_cash_opening(date, amount, reason) — fix a wrong morning opening
--     (the old journal is reversed and the corrected amount posted; audit logged)
--   • record_account_opening / reverse_account_opening — bank opening balance, so the
--     Bank Account figure starts from the real bank balance
-- Roles: super_admin, admin (as the existing Finance functions).
-- =============================================================================

CREATE OR REPLACE FUNCTION public._finance_guard()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  RETURN v_branch;
END;
$$;

-- ---------------------------------------------------------------------------
-- Bank / account opening balances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  account text NOT NULL CHECK (account IN ('bank')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  as_of_date date NOT NULL,
  label text,
  note text,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  journal_id uuid,
  reversal_journal_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_by uuid,
  reversed_at timestamptz,
  reversal_reason text
);
CREATE INDEX IF NOT EXISTS account_opening_balances_branch_idx ON public.account_opening_balances(branch_id, created_at DESC);
ALTER TABLE public.account_opening_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_opening_balances FROM anon, authenticated;
GRANT SELECT ON public.account_opening_balances TO authenticated;
DROP POLICY IF EXISTS account_opening_balances_read ON public.account_opening_balances;
CREATE POLICY account_opening_balances_read ON public.account_opening_balances FOR SELECT TO authenticated
  USING (branch_id = public.my_branch_id() AND COALESCE(public.my_role(), '') IN ('super_admin','admin'));

CREATE OR REPLACE FUNCTION public.record_account_opening(p_account text, p_amount numeric, p_as_of_date date, p_label text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._finance_guard(); v_id uuid := gen_random_uuid(); v_j uuid;
BEGIN
  IF COALESCE(p_account, '') <> 'bank' THEN RAISE EXCEPTION 'Only a bank opening balance can be recorded here'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 999999999999.99 THEN RAISE EXCEPTION 'Enter an amount greater than zero'; END IF;
  IF p_as_of_date IS NULL OR p_as_of_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Choose a date that is not in the future'; END IF;
  IF EXISTS (SELECT 1 FROM public.account_opening_balances WHERE branch_id = v_branch AND account = p_account AND status = 'posted') THEN
    RAISE EXCEPTION 'A bank opening balance is already recorded. Reverse it first to enter a new one.';
  END IF;
  INSERT INTO public.account_opening_balances(id, branch_id, account, amount, as_of_date, label, note, created_by)
  VALUES (v_id, v_branch, p_account, round(p_amount, 2), p_as_of_date, NULLIF(trim(p_label), ''), NULLIF(trim(p_note), ''), auth.uid());
  v_j := public.post_journal('account_opening', v_id, 'Bank opening balance as of ' || to_char(p_as_of_date, 'DD Mon YYYY'),
    jsonb_build_array(jsonb_build_object('account', p_account, 'debit', round(p_amount, 2), 'credit', 0),
                      jsonb_build_object('account', 'opening_balance_equity', 'debit', 0, 'credit', round(p_amount, 2))), NULL);
  UPDATE public.account_opening_balances SET journal_id = v_j WHERE id = v_id;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'account_opening_recorded', 'account_opening', v_id::text, COALESCE(NULLIF(trim(p_note), ''), 'Bank opening balance'), NULL,
          jsonb_build_object('account', p_account, 'amount', round(p_amount, 2), 'as_of_date', p_as_of_date, 'label', p_label));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_account_opening(p_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._finance_guard(); r public.account_opening_balances%ROWTYPE; v_j uuid;
BEGIN
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO r FROM public.account_opening_balances WHERE id = p_id AND branch_id = v_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opening balance not found in this branch'; END IF;
  IF r.status <> 'posted' THEN RAISE EXCEPTION 'This opening balance is already reversed'; END IF;
  v_j := public.post_journal('account_opening_reversal', r.id, 'Reversal: bank opening balance — ' || trim(p_reason),
    jsonb_build_array(jsonb_build_object('account', r.account, 'debit', 0, 'credit', r.amount),
                      jsonb_build_object('account', 'opening_balance_equity', 'debit', r.amount, 'credit', 0)), r.journal_id);
  UPDATE public.account_opening_balances SET status = 'reversed', reversal_journal_id = v_j, reversed_by = auth.uid(), reversed_at = now(), reversal_reason = trim(p_reason) WHERE id = r.id;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'account_opening_reversed', 'account_opening', r.id::text, trim(p_reason), jsonb_build_object('amount', r.amount), NULL);
  RETURN v_j;
END;
$$;

-- ---------------------------------------------------------------------------
-- Correct today's (or any day's) morning cash opening
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_daily_cash_opening(p_opening_date date, p_amount numeric, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._finance_guard(); r public.daily_cash_openings%ROWTYPE; v_j uuid;
BEGIN
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 999999999999.99 THEN RAISE EXCEPTION 'Enter a valid non-negative opening amount'; END IF;
  SELECT * INTO r FROM public.daily_cash_openings WHERE branch_id = v_branch AND opening_date = p_opening_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No opening cash was entered for this date'; END IF;
  IF round(p_amount, 2) = r.amount THEN RAISE EXCEPTION 'The amount is the same as the saved opening'; END IF;
  IF r.journal_id IS NOT NULL THEN PERFORM public.reverse_journal(r.journal_id, 'Opening cash corrected — ' || trim(p_reason)); END IF;
  v_j := NULL;
  IF round(p_amount, 2) > 0 THEN
    v_j := public.post_journal('daily_cash_opening', r.id, 'Daily cash opening (corrected) - ' || to_char(p_opening_date, 'DD Mon YYYY'),
      jsonb_build_array(jsonb_build_object('account', 'cash', 'debit', round(p_amount, 2), 'credit', 0),
                        jsonb_build_object('account', 'opening_balance_equity', 'debit', 0, 'credit', round(p_amount, 2))), NULL);
  END IF;
  UPDATE public.daily_cash_openings
     SET amount = round(p_amount, 2), journal_id = v_j,
         note = concat_ws(' | ', NULLIF(note, ''), 'Corrected from ' || r.amount || ' on ' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') || ': ' || trim(p_reason))
   WHERE id = r.id;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'daily_cash_opening_corrected', 'daily_cash_opening', r.id::text, trim(p_reason),
          jsonb_build_object('amount', r.amount), jsonb_build_object('amount', round(p_amount, 2)));
  RETURN r.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Profit & cash figures for a period (India dates)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_overview(date, date);
CREATE FUNCTION public.finance_overview(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._finance_guard(); out jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  WITH inv AS (
    SELECT i.id, i.total FROM public.sales_invoices i
    WHERE i.branch_id = v_branch AND i.status = 'final' AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  ), ret AS (
    SELECT r.id, r.total, r.refund_method FROM public.sales_returns r
    WHERE r.branch_id = v_branch AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  ), cogs AS (
    SELECT COALESCE(sum(a.qty * a.unit_cost), 0) AS v, count(*) FILTER (WHERE a.unit_cost IS NULL) AS unknown
    FROM public.inventory_sale_allocations a JOIN public.sales_items si ON si.id = a.sales_item_id JOIN inv ON inv.id = si.invoice_id
  ), back AS (
    SELECT COALESCE(sum(c.restored_cost), 0) AS v FROM public.inventory_customer_return_allocations c
    JOIN public.sales_return_items x ON x.id = c.sales_return_item_id JOIN ret ON ret.id = x.return_id
  ), pay AS (
    SELECT p.method, sum(p.amount) AS v FROM public.payments p JOIN inv ON inv.id = p.invoice_id GROUP BY p.method
  ), rcpt AS (
    SELECT COALESCE(sum(amount), 0) AS v, count(*) AS n FROM public.customer_receipts
    WHERE branch_id = v_branch AND status = 'posted' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  ), spay AS (
    SELECT COALESCE(sum(amount), 0) AS v, count(*) AS n FROM public.supplier_payments
    WHERE branch_id = v_branch AND status = 'posted' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  ), exps AS (
    SELECT COALESCE(sum(amount), 0) AS v, count(*) AS n FROM public.expenses
    WHERE branch_id = v_branch AND status = 'posted' AND expense_date BETWEEN p_from AND p_to
  ), pur AS (
    SELECT COALESCE(sum(total), 0) AS v FROM public.purchase_invoices
    WHERE branch_id = v_branch AND COALESCE(status, 'confirmed') <> 'cancelled' AND invoice_date BETWEEN p_from AND p_to
  ), pret AS (
    SELECT COALESCE(sum(total_value), 0) AS v FROM public.purchase_returns
    WHERE branch_id = v_branch AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  )
  SELECT jsonb_build_object(
    'sales', round((SELECT COALESCE(sum(total), 0) FROM inv), 2),
    'bills', (SELECT count(*) FROM inv),
    'returns', round((SELECT COALESCE(sum(total), 0) FROM ret), 2),
    'cogs', round((SELECT v FROM cogs) - (SELECT v FROM back), 2),
    'cogs_unknown', (SELECT unknown FROM cogs),
    'expenses', round((SELECT v FROM exps), 2), 'expense_count', (SELECT n FROM exps),
    'purchases', round((SELECT v FROM pur), 2), 'purchase_returns', round((SELECT v FROM pret), 2),
    'sales_cash', round(COALESCE((SELECT v FROM pay WHERE method = 'cash'), 0), 2),
    'sales_upi', round(COALESCE((SELECT v FROM pay WHERE method = 'upi'), 0), 2),
    'sales_card', round(COALESCE((SELECT v FROM pay WHERE method = 'card'), 0), 2),
    'sales_credit', round(COALESCE((SELECT v FROM pay WHERE method = 'credit'), 0), 2),
    'receipts', round((SELECT v FROM rcpt), 2), 'receipt_count', (SELECT n FROM rcpt),
    'supplier_payments', round((SELECT v FROM spay), 2), 'supplier_payment_count', (SELECT n FROM spay),
    'refunds', round((SELECT COALESCE(sum(total), 0) FROM ret), 2)
  ) INTO out;
  RETURN out;
END;
$$;

-- Month by month (income, costs, cash in / out) for the charts.
DROP FUNCTION IF EXISTS public.finance_monthly(date, date);
CREATE FUNCTION public.finance_monthly(p_from date, p_to date)
RETURNS TABLE (month date, sales numeric, returns numeric, cogs numeric, expenses numeric, money_in numeric, money_out numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._finance_guard();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  IF p_to - p_from > 800 THEN RAISE EXCEPTION 'Choose 2 years or less'; END IF;
  RETURN QUERY
  WITH m AS (SELECT gs::date AS month FROM generate_series(date_trunc('month', p_from)::date, date_trunc('month', p_to)::date, interval '1 month') gs),
  inv AS (SELECT i.id, i.total, date_trunc('month', i.created_at AT TIME ZONE 'Asia/Kolkata')::date AS mo FROM public.sales_invoices i
          WHERE i.branch_id = v_branch AND i.status = 'final' AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to),
  ret AS (SELECT r.id, r.total, date_trunc('month', r.created_at AT TIME ZONE 'Asia/Kolkata')::date AS mo FROM public.sales_returns r
          WHERE r.branch_id = v_branch AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to),
  s AS (SELECT mo, sum(total) v FROM inv GROUP BY mo),
  rt AS (SELECT mo, sum(total) v FROM ret GROUP BY mo),
  cg AS (SELECT inv.mo, sum(a.qty * a.unit_cost) v FROM public.inventory_sale_allocations a JOIN public.sales_items si ON si.id = a.sales_item_id JOIN inv ON inv.id = si.invoice_id GROUP BY inv.mo),
  bk AS (SELECT ret.mo, sum(c.restored_cost) v FROM public.inventory_customer_return_allocations c JOIN public.sales_return_items x ON x.id = c.sales_return_item_id JOIN ret ON ret.id = x.return_id GROUP BY ret.mo),
  ex AS (SELECT date_trunc('month', expense_date)::date mo, sum(amount) v FROM public.expenses WHERE branch_id = v_branch AND status = 'posted' AND expense_date BETWEEN p_from AND p_to GROUP BY 1),
  pin AS (SELECT inv.mo, sum(p.amount) v FROM public.payments p JOIN inv ON inv.id = p.invoice_id WHERE p.method <> 'credit' GROUP BY inv.mo),
  rc AS (SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata')::date mo, sum(amount) v FROM public.customer_receipts WHERE branch_id = v_branch AND status = 'posted' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to GROUP BY 1),
  sp AS (SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata')::date mo, sum(amount) v FROM public.supplier_payments WHERE branch_id = v_branch AND status = 'posted' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to GROUP BY 1)
  SELECT m.month,
         round(COALESCE(s.v, 0), 2), round(COALESCE(rt.v, 0), 2),
         round(COALESCE(cg.v, 0) - COALESCE(bk.v, 0), 2), round(COALESCE(ex.v, 0), 2),
         round(COALESCE(pin.v, 0) + COALESCE(rc.v, 0), 2),
         round(COALESCE(ex.v, 0) + COALESCE(sp.v, 0) + COALESCE(rt.v, 0), 2)
  FROM m LEFT JOIN s ON s.mo = m.month LEFT JOIN rt ON rt.mo = m.month LEFT JOIN cg ON cg.mo = m.month LEFT JOIN bk ON bk.mo = m.month
  LEFT JOIN ex ON ex.mo = m.month LEFT JOIN pin ON pin.mo = m.month LEFT JOIN rc ON rc.mo = m.month LEFT JOIN sp ON sp.mo = m.month
  ORDER BY m.month;
END;
$$;

-- Every money movement in one list: sales receipts, credit received, refunds,
-- supplier payments, expenses and the morning cash opening.
DROP FUNCTION IF EXISTS public.finance_transactions(date, date);
CREATE FUNCTION public.finance_transactions(p_from date, p_to date)
RETURNS TABLE (kind text, id uuid, ref_no text, at timestamptz, description text, party text, type text, amount numeric, method text, status text, doc_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._finance_guard();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  IF p_to - p_from > 400 THEN RAISE EXCEPTION 'Choose a date range of 400 days or less'; END IF;
  RETURN QUERY
  SELECT * FROM (
    SELECT 'sale'::text, i.id, i.invoice_no, i.created_at, 'Sales Receipt - ' || i.invoice_no, c.name, 'income'::text,
           round(p.paid, 2), CASE WHEN p.n > 1 THEN 'split' ELSE p.m END,
           CASE WHEN i.status = 'final' THEN 'completed' ELSE i.status END, i.id
    FROM public.sales_invoices i
    LEFT JOIN public.customers c ON c.id = i.customer_id
    JOIN LATERAL (SELECT sum(x.amount) AS paid, count(DISTINCT x.method) AS n, min(x.method) AS m FROM public.payments x WHERE x.invoice_id = i.id AND x.method <> 'credit') p ON p.paid > 0
    WHERE i.branch_id = v_branch AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT 'receipt', r.id, r.receipt_no, r.created_at, 'Credit Received - ' || COALESCE(c.name, 'Customer'), c.name, 'income',
           r.amount, r.method, CASE WHEN r.status = 'posted' THEN 'completed' ELSE r.status END, r.customer_id
    FROM public.customer_receipts r LEFT JOIN public.customers c ON c.id = r.customer_id
    WHERE r.branch_id = v_branch AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT 'refund', r.id, r.return_no, r.created_at, 'Customer Refund - ' || r.return_no, c.name, 'expense',
           r.total, r.refund_method, 'completed', r.id
    FROM public.sales_returns r LEFT JOIN public.customers c ON c.id = r.customer_id
    WHERE r.branch_id = v_branch AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT 'supplier', s.id, s.payment_no, s.created_at,
           CASE WHEN pi.supplier_invoice_no IS NOT NULL THEN 'Purchase Payment - ' || pi.supplier_invoice_no ELSE 'Distributor Payment' END,
           d.name, 'expense', s.amount, s.method, CASE WHEN s.status = 'posted' THEN 'completed' ELSE s.status END, s.distributor_id
    FROM public.supplier_payments s LEFT JOIN public.distributors d ON d.id = s.distributor_id LEFT JOIN public.purchase_invoices pi ON pi.id = s.purchase_invoice_id
    WHERE s.branch_id = v_branch AND (s.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT 'expense', e.id, e.expense_no, COALESCE(e.posted_at, e.created_at), e.description, ec.name, 'expense',
           e.amount, e.payment_method, CASE WHEN e.status = 'posted' THEN 'completed' ELSE e.status END, e.id
    FROM public.expenses e LEFT JOIN public.expense_categories ec ON ec.id = e.category_id
    WHERE e.branch_id = v_branch AND e.status <> 'draft' AND e.expense_date BETWEEN p_from AND p_to
    UNION ALL
    SELECT 'opening', o.id, 'OPEN-' || to_char(o.opening_date, 'YYYYMMDD'), o.created_at, 'Opening Cash (morning)', pr.full_name, 'opening',
           o.amount, 'cash', 'completed', o.id
    FROM public.daily_cash_openings o LEFT JOIN public.profiles pr ON pr.id = o.created_by
    WHERE o.branch_id = v_branch AND o.opening_date BETWEEN p_from AND p_to
  ) t
  ORDER BY 4 DESC
  LIMIT 20000;
END;
$$;

-- Daily cash book from the morning opening: opening + cash in − cash out = cash that
-- should be in the drawer; the next morning's opening shows any shortage / excess.
DROP FUNCTION IF EXISTS public.cash_book(date, date);
CREATE FUNCTION public.cash_book(p_from date, p_to date)
RETURNS TABLE (day date, opening numeric, opening_by text, opening_at timestamptz, opening_note text,
               cash_sales numeric, cash_receipts numeric, cash_refunds numeric, cash_expenses numeric, cash_supplier numeric,
               cash_in numeric, cash_out numeric, expected_close numeric, next_opening numeric, difference numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._finance_guard();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  IF p_to - p_from > 400 THEN RAISE EXCEPTION 'Choose a date range of 400 days or less'; END IF;
  RETURN QUERY
  WITH d AS (SELECT gs::date AS day FROM generate_series(p_from, p_to, interval '1 day') gs),
  sc AS (SELECT (i.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sum(p.amount) v FROM public.payments p JOIN public.sales_invoices i ON i.id = p.invoice_id
         WHERE i.branch_id = v_branch AND i.status = 'final' AND p.method = 'cash' AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to GROUP BY 1),
  rc AS (SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sum(amount) v FROM public.customer_receipts
         WHERE branch_id = v_branch AND status = 'posted' AND method = 'cash' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to GROUP BY 1),
  rf AS (SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sum(total) v FROM public.sales_returns
         WHERE branch_id = v_branch AND refund_method = 'cash' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to GROUP BY 1),
  ex AS (SELECT expense_date AS day, sum(amount) v FROM public.expenses
         WHERE branch_id = v_branch AND status = 'posted' AND payment_method = 'cash' AND expense_date BETWEEN p_from AND p_to GROUP BY 1),
  sp AS (SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sum(amount) v FROM public.supplier_payments
         WHERE branch_id = v_branch AND status = 'posted' AND method = 'cash' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to GROUP BY 1),
  op AS (SELECT o.opening_date AS day, o.amount, pr.full_name, o.created_at, o.note FROM public.daily_cash_openings o LEFT JOIN public.profiles pr ON pr.id = o.created_by
         WHERE o.branch_id = v_branch AND o.opening_date BETWEEN p_from AND p_to + 1)
  SELECT d.day, op.amount, op.full_name, op.created_at, op.note,
         round(COALESCE(sc.v, 0), 2), round(COALESCE(rc.v, 0), 2), round(COALESCE(rf.v, 0), 2), round(COALESCE(ex.v, 0), 2), round(COALESCE(sp.v, 0), 2),
         round(COALESCE(sc.v, 0) + COALESCE(rc.v, 0), 2),
         round(COALESCE(rf.v, 0) + COALESCE(ex.v, 0) + COALESCE(sp.v, 0), 2),
         CASE WHEN op.amount IS NULL THEN NULL ELSE round(op.amount + COALESCE(sc.v, 0) + COALESCE(rc.v, 0) - COALESCE(rf.v, 0) - COALESCE(ex.v, 0) - COALESCE(sp.v, 0), 2) END,
         nx.amount,
         CASE WHEN op.amount IS NULL OR nx.amount IS NULL THEN NULL
              ELSE round(nx.amount - (op.amount + COALESCE(sc.v, 0) + COALESCE(rc.v, 0) - COALESCE(rf.v, 0) - COALESCE(ex.v, 0) - COALESCE(sp.v, 0)), 2) END
  FROM d
  LEFT JOIN op ON op.day = d.day
  LEFT JOIN op nx ON nx.day = d.day + 1
  LEFT JOIN sc ON sc.day = d.day LEFT JOIN rc ON rc.day = d.day LEFT JOIN rf ON rf.day = d.day LEFT JOIN ex ON ex.day = d.day LEFT JOIN sp ON sp.day = d.day
  ORDER BY d.day DESC;
END;
$$;

-- Bank (UPI + card + bank transfers settle to the bank) and cash in hand today.
DROP FUNCTION IF EXISTS public.finance_balances();
CREATE FUNCTION public.finance_balances()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._finance_guard(); v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; c record; out jsonb;
BEGIN
  SELECT * INTO c FROM public.cash_book(v_today, v_today) LIMIT 1;
  SELECT jsonb_build_object(
    'bank', round(COALESCE(sum(debit - credit) FILTER (WHERE account = 'bank'), 0), 2),
    'upi', round(COALESCE(sum(debit - credit) FILTER (WHERE account = 'upi'), 0), 2),
    'card', round(COALESCE(sum(debit - credit) FILTER (WHERE account = 'card'), 0), 2),
    'receivables', round(COALESCE(sum(debit - credit) FILTER (WHERE account = 'receivables'), 0), 2),
    'payables', round(COALESCE(sum(credit - debit) FILTER (WHERE account = 'payables'), 0), 2),
    'bank_opening', (SELECT jsonb_build_object('id', a.id, 'amount', a.amount, 'as_of_date', a.as_of_date, 'label', a.label)
                     FROM public.account_opening_balances a WHERE a.branch_id = v_branch AND a.account = 'bank' AND a.status = 'posted' LIMIT 1),
    'cash_today', jsonb_build_object('date', v_today, 'opening', c.opening, 'opening_by', c.opening_by, 'opening_at', c.opening_at,
                     'cash_in', c.cash_in, 'cash_out', c.cash_out, 'expected', c.expected_close)
  ) INTO out
  FROM public.financial_ledger WHERE branch_id = v_branch;
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public._finance_guard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_account_opening(text, numeric, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_account_opening(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_daily_cash_opening(date, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_overview(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_monthly(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_transactions(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cash_book(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._finance_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_account_opening(text, numeric, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_account_opening(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_daily_cash_opening(date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_overview(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_monthly(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_transactions(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_book(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_balances() TO authenticated;

CREATE INDEX IF NOT EXISTS customer_receipts_branch_created_idx ON public.customer_receipts(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_payments_branch_created_idx ON public.supplier_payments(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS financial_ledger_branch_account_idx ON public.financial_ledger(branch_id, account);
