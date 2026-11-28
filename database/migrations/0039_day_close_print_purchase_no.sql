-- =============================================================================
-- 0039  Day close, printing and purchase numbers (version 80)
-- Run once in the Supabase SQL editor after 0038. Safe to run again.
--
--   1  Daily closing balance — one per day per branch (counted cash at closing).
--      Any staff member can record it; Admin can correct it (audited).
--      Admins also see the expected cash and the difference.
--   2  All bills of one day in one call (Billing / Sales → "All Bills for Today").
--   3  Purchase number 1, 2, 3 … given automatically to every posted purchase
--      (existing purchases are numbered in the order they were entered).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Daily closing balance
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_cash_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  closing_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  expected numeric(14,2),
  difference numeric(14,2),
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  corrected_by uuid,
  corrected_at timestamptz,
  correction_reason text,
  UNIQUE (branch_id, closing_date)
);
CREATE INDEX IF NOT EXISTS daily_cash_closings_branch_date_idx ON public.daily_cash_closings(branch_id, closing_date DESC);
ALTER TABLE public.daily_cash_closings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_cash_closings FROM anon, authenticated;

-- Cash that should be in the drawer at the end of a day (same rule as the Finance cash book):
-- morning opening + cash sales + cash receipts − cash refunds − cash expenses − cash supplier payments.
CREATE OR REPLACE FUNCTION public._cash_day_expected(p_branch uuid, p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_open numeric; v_sales numeric := 0; v_rec numeric := 0; v_ref numeric := 0; v_exp numeric := 0; v_sup numeric := 0;
BEGIN
  SELECT amount INTO v_open FROM public.daily_cash_openings WHERE branch_id = p_branch AND opening_date = p_day;
  SELECT COALESCE(sum(p.amount), 0) INTO v_sales FROM public.payments p JOIN public.sales_invoices i ON i.id = p.invoice_id
   WHERE i.branch_id = p_branch AND i.status = 'final' AND p.method = 'cash' AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_day;
  IF to_regclass('public.customer_receipts') IS NOT NULL THEN
    EXECUTE $q$SELECT COALESCE(sum(amount), 0) FROM public.customer_receipts WHERE branch_id = $1 AND status = 'posted' AND method = 'cash'
             AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = $2$q$ INTO v_rec USING p_branch, p_day;
  END IF;
  SELECT COALESCE(sum(total), 0) INTO v_ref FROM public.sales_returns
   WHERE branch_id = p_branch AND refund_method = 'cash' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = p_day;
  IF to_regclass('public.expenses') IS NOT NULL THEN
    EXECUTE $q$SELECT COALESCE(sum(amount), 0) FROM public.expenses WHERE branch_id = $1 AND status = 'posted' AND payment_method = 'cash' AND expense_date = $2$q$
      INTO v_exp USING p_branch, p_day;
  END IF;
  IF to_regclass('public.supplier_payments') IS NOT NULL THEN
    EXECUTE $q$SELECT COALESCE(sum(amount), 0) FROM public.supplier_payments WHERE branch_id = $1 AND status = 'posted' AND method = 'cash'
             AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = $2$q$ INTO v_sup USING p_branch, p_day;
  END IF;
  RETURN jsonb_build_object('opening', v_open, 'cash_in', round(v_sales + v_rec, 2), 'cash_out', round(v_ref + v_exp + v_sup, 2),
    'expected', CASE WHEN v_open IS NULL THEN NULL ELSE round(v_open + v_sales + v_rec - v_ref - v_exp - v_sup, 2) END);
END;
$$;
REVOKE ALL ON FUNCTION public._cash_day_expected(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_daily_cash_closing(p_closing_date date, p_amount numeric, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); v_id uuid; v_exp jsonb; v_expected numeric;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR public.my_role() IS NULL THEN RAISE EXCEPTION 'Login with an active branch staff profile is required'; END IF;
  IF public.my_role() IN ('delivery_person','delivery') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF p_closing_date IS NULL OR p_closing_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Choose today or an earlier day'; END IF;
  IF p_closing_date < (now() AT TIME ZONE 'Asia/Kolkata')::date - 7 THEN RAISE EXCEPTION 'A closing balance can be entered up to 7 days back only'; END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 999999999999.99 THEN RAISE EXCEPTION 'Enter the cash counted at closing (0 or more)'; END IF;
  v_exp := public._cash_day_expected(v_branch, p_closing_date);
  v_expected := (v_exp->>'expected')::numeric;
  INSERT INTO public.daily_cash_closings(branch_id, closing_date, amount, expected, difference, note, created_by)
  VALUES (v_branch, p_closing_date, round(p_amount, 2), v_expected,
          CASE WHEN v_expected IS NULL THEN NULL ELSE round(p_amount - v_expected, 2) END, nullif(trim(p_note), ''), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data, at)
  VALUES (v_branch, auth.uid(), 'daily_cash_closing_recorded', 'daily_cash_closing', v_id::text, 'Closing balance',
          NULL, jsonb_build_object('date', p_closing_date, 'amount', round(p_amount, 2), 'expected', v_expected), now());
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'The closing balance for this day is already recorded. Only one closing balance can be added per day.';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_daily_cash_closing(p_closing_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); v_admin boolean; r jsonb; v_exp jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR public.my_role() IS NULL THEN RAISE EXCEPTION 'Login with an active branch staff profile is required'; END IF;
  v_admin := public.my_role() IN ('super_admin','admin');
  v_exp := CASE WHEN v_admin THEN public._cash_day_expected(v_branch, p_closing_date) END;
  SELECT jsonb_build_object('id', c.id, 'closing_date', c.closing_date, 'amount', c.amount, 'note', c.note,
           'created_by', pr.full_name, 'created_at', c.created_at, 'corrected_at', c.corrected_at, 'correction_reason', c.correction_reason,
           'expected', CASE WHEN v_admin THEN COALESCE((v_exp->>'expected')::numeric, c.expected) END,
           'difference', CASE WHEN v_admin AND COALESCE((v_exp->>'expected')::numeric, c.expected) IS NOT NULL
                              THEN round(c.amount - COALESCE((v_exp->>'expected')::numeric, c.expected), 2) END)
    INTO r
  FROM public.daily_cash_closings c LEFT JOIN public.profiles pr ON pr.id = c.created_by
  WHERE c.branch_id = v_branch AND c.closing_date = p_closing_date;
  IF r IS NULL AND v_admin THEN
    RETURN jsonb_build_object('id', NULL, 'closing_date', p_closing_date, 'expected', v_exp->'expected', 'opening', v_exp->'opening',
                              'cash_in', v_exp->'cash_in', 'cash_out', v_exp->'cash_out');
  END IF;
  IF r IS NOT NULL AND v_admin THEN r := r || jsonb_build_object('opening', v_exp->'opening', 'cash_in', v_exp->'cash_in', 'cash_out', v_exp->'cash_out'); END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_daily_cash_closing(p_closing_date date, p_amount numeric, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); c public.daily_cash_closings%rowtype; v_expected numeric;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Only Admin can correct a closing balance'; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'Enter the corrected closing amount (0 or more)'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Give a reason for the correction'; END IF;
  SELECT * INTO c FROM public.daily_cash_closings WHERE branch_id = v_branch AND closing_date = p_closing_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No closing balance recorded for this day'; END IF;
  v_expected := (public._cash_day_expected(v_branch, p_closing_date)->>'expected')::numeric;
  UPDATE public.daily_cash_closings SET amount = round(p_amount, 2), expected = v_expected,
         difference = CASE WHEN v_expected IS NULL THEN NULL ELSE round(p_amount - v_expected, 2) END,
         corrected_by = auth.uid(), corrected_at = now(), correction_reason = trim(p_reason)
  WHERE id = c.id;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data, at)
  VALUES (v_branch, auth.uid(), 'daily_cash_closing_corrected', 'daily_cash_closing', c.id::text, trim(p_reason),
          jsonb_build_object('amount', c.amount), jsonb_build_object('amount', round(p_amount, 2)), now());
END;
$$;

-- Admin history: opening, expected, counted closing and difference per day.
CREATE OR REPLACE FUNCTION public.cash_closing_list(p_from date, p_to date)
RETURNS TABLE (day date, opening numeric, cash_in numeric, cash_out numeric, expected numeric, closing numeric, difference numeric,
               closed_by text, closed_at timestamptz, note text, corrected boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); d date; x jsonb; c record;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'Choose a date range of 400 days or less'; END IF;
  FOR d IN SELECT gs::date FROM generate_series(p_to, p_from, interval '-1 day') gs LOOP
    x := public._cash_day_expected(v_branch, d);
    SELECT k.amount, k.note, k.created_at, k.corrected_at, pr.full_name AS who INTO c
      FROM public.daily_cash_closings k LEFT JOIN public.profiles pr ON pr.id = k.created_by
     WHERE k.branch_id = v_branch AND k.closing_date = d;
    day := d; opening := (x->>'opening')::numeric; cash_in := (x->>'cash_in')::numeric; cash_out := (x->>'cash_out')::numeric;
    expected := (x->>'expected')::numeric; closing := c.amount;
    difference := CASE WHEN c.amount IS NULL OR expected IS NULL THEN NULL ELSE round(c.amount - expected, 2) END;
    closed_by := c.who; closed_at := c.created_at; note := c.note; corrected := c.corrected_at IS NOT NULL;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.record_daily_cash_closing(date, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_daily_cash_closing(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_daily_cash_closing(date, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cash_closing_list(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_daily_cash_closing(date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_cash_closing(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_daily_cash_closing(date, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_closing_list(date, date) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2 · All bills of one day (full bill details, oldest first)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoices_for_day(p_date date, p_include_cancelled boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); v_out jsonb := '[]'::jsonb; r record;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Choose today or an earlier day'; END IF;
  FOR r IN SELECT i.id FROM public.sales_invoices i
           WHERE i.branch_id = v_branch AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date = p_date
             AND (i.status = 'final' OR (p_include_cancelled AND i.status <> 'draft'))
           ORDER BY i.created_at, i.invoice_no
           LIMIT 2000 LOOP
    v_out := v_out || jsonb_build_array(public.invoice_detail(r.id));   -- same role and session checks as one bill
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.invoices_for_day(date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoices_for_day(date, boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3 · Purchase number 1, 2, 3 … (per branch, automatic)
-- -----------------------------------------------------------------------------
ALTER TABLE public.purchase_invoices ADD COLUMN IF NOT EXISTS purchase_no integer;
CREATE TABLE IF NOT EXISTS public.purchase_no_counters (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id),
  last_value integer NOT NULL DEFAULT 0
);
ALTER TABLE public.purchase_no_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_no_counters FROM anon, authenticated;

-- Number existing purchases in the order they were entered.
WITH mx AS (SELECT branch_id, COALESCE(max(purchase_no), 0) m FROM public.purchase_invoices GROUP BY branch_id),
     nx AS (SELECT p.id, mx.m + row_number() OVER (PARTITION BY p.branch_id ORDER BY p.created_at, p.id) AS n
            FROM public.purchase_invoices p JOIN mx ON mx.branch_id = p.branch_id WHERE p.purchase_no IS NULL)
UPDATE public.purchase_invoices p SET purchase_no = nx.n FROM nx WHERE nx.id = p.id;

INSERT INTO public.purchase_no_counters(branch_id, last_value)
SELECT branch_id, max(purchase_no) FROM public.purchase_invoices GROUP BY branch_id
ON CONFLICT (branch_id) DO UPDATE SET last_value = greatest(purchase_no_counters.last_value, excluded.last_value);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoices_branch_purchase_no_uq ON public.purchase_invoices(branch_id, purchase_no);

CREATE OR REPLACE FUNCTION public.assign_purchase_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v integer;
BEGIN
  IF NEW.purchase_no IS NULL THEN
    INSERT INTO public.purchase_no_counters AS c (branch_id, last_value) VALUES (NEW.branch_id, 1)
    ON CONFLICT (branch_id) DO UPDATE SET last_value = c.last_value + 1
    RETURNING last_value INTO v;
    NEW.purchase_no := v;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_assign_purchase_no ON public.purchase_invoices;
CREATE TRIGGER trg_assign_purchase_no BEFORE INSERT ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.assign_purchase_no();
-- purchase_no cannot be changed afterwards.
CREATE OR REPLACE FUNCTION public.keep_purchase_no()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.purchase_no IS NOT NULL AND NEW.purchase_no IS DISTINCT FROM OLD.purchase_no THEN NEW.purchase_no := OLD.purchase_no; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_keep_purchase_no ON public.purchase_invoices;
CREATE TRIGGER trg_keep_purchase_no BEFORE UPDATE ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.keep_purchase_no();

-- Next number (shown on a new purchase form before it is posted).
CREATE OR REPLACE FUNCTION public.next_purchase_no()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT last_value FROM public.purchase_no_counters WHERE branch_id = public.my_branch_id()), 0) + 1
  WHERE COALESCE(public.my_role(), '') IN ('super_admin','admin','admin_staff','pharmacist','inventory_staff','inventory')
$$;
REVOKE ALL ON FUNCTION public.next_purchase_no() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_purchase_no() TO authenticated;
GRANT SELECT (purchase_no) ON public.purchase_invoices TO authenticated;

-- -----------------------------------------------------------------------------
-- 4 · Print & Invoice settings: QR code at the bottom of the bill
--   qr_mode: whatsapp (chat with the pharmacy) · upi (pay the bill) · link (any link / text) · none
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._settings_defaults()
RETURNS jsonb LANGUAGE sql IMMUTABLE
AS $$ SELECT jsonb_build_object(
  'general', jsonb_build_object('language', 'en', 'date_format', 'DD MMM YYYY', 'time_format', '12h', 'currency', 'INR',
                                'low_stock_alerts', true, 'expiry_alerts', true, 'auto_backup', false, 'invoice_logo', true),
  'invoice', jsonb_build_object('default_format', 'thermal', 'show_gstin', true, 'show_drug_licence', true, 'show_patient', true,
                                'terms', '', 'show_upi', false, 'signature_line', false,
                                'qr_mode', 'whatsapp', 'qr_link', '', 'qr_phone', '', 'qr_caption', ''),
  'payments', jsonb_build_object('enabled', jsonb_build_array('cash','card','upi','wallet','credit','split'), 'default_method', 'cash',
                                 'upi_id', '', 'upi_name', ''),
  'notifications', jsonb_build_object('expiry_days', 30, 'deliveries', true, 'expense_drafts', true, 'deactivations', true, 'backup_reminder', true),
  'license', jsonb_build_object('type', 'Professional', 'valid_to', '', 'licensed_to', ''),
  'support', jsonb_build_object('name', '', 'phone', '', 'email', '', 'website', '')
) $$;

DO $$
DECLARE f record; v_def text; v_new text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '_settings_clean' LOOP
    v_def := pg_get_functiondef(f.oid);
    IF position('qr_mode' IN v_def) = 0 THEN
      v_new := replace(v_def, $o$IF length(r->>'terms') > 500 THEN RAISE EXCEPTION 'Terms can be up to 500 characters'; END IF;$o$,
        $n$IF length(r->>'terms') > 500 THEN RAISE EXCEPTION 'Terms can be up to 500 characters'; END IF;
    IF r->>'qr_mode' NOT IN ('whatsapp','upi','link','none') THEN RAISE EXCEPTION 'Unknown QR code option'; END IF;
    IF length(r->>'qr_link') > 300 OR length(r->>'qr_caption') > 60 OR length(r->>'qr_phone') > 15 THEN RAISE EXCEPTION 'QR code details are too long'; END IF;
    IF r->>'qr_mode' = 'link' AND trim(r->>'qr_link') = '' THEN RAISE EXCEPTION 'Enter the link or text for the QR code'; END IF;$n$);
      IF v_new <> v_def THEN EXECUTE v_new; END IF;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 5 · Fix: "today" means today in India. Supabase runs on UTC, so between 00:00 and 05:30
--   India time CURRENT_DATE is still yesterday and today's opening balances were refused.
-- -----------------------------------------------------------------------------
DO $$
DECLARE f record; v_def text; v_new text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('record_party_opening_balance', 'record_account_opening') LOOP
    v_def := pg_get_functiondef(f.oid);
    v_new := regexp_replace(v_def, 'p_as_of_date\s*>\s*CURRENT_DATE', 'p_as_of_date > (now() AT TIME ZONE ''Asia/Kolkata'')::date', 'gi');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END $$;
