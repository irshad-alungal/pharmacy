-- =============================================================================
-- 0037  Final requirements (version 78)
-- Run once in the Supabase SQL editor after 0036. Safe to run twice.
-- Sections:
--   1  Contact details (bills, home page, Ayurvedic store)
--   2  Sessions last the whole working day; a new day needs a fresh login
--   3  Medicines & billing rules (GST 0 allowed, % or ₹ discount, YYYY-MM-DD-#### bill no.)
--   4  Inventory → Initial stock: GST % and distributor per row
--   5  WhatsApp sending for every staff role
--   6  Staff page parity (generated role lists)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Contact details
--   Pharmacy : 8848642677 · pallikkalpharmacy@gmail.com · Pallikkal Bazar, Pallikkal PO, Malappuram 673634
--   Ayurvedic: 9895843039 · Pallikkal Bazar, Pallikkal PO, Malappuram 673634
--   These are printed on every bill and shown on the home page. No other contact details are shown.
-- -----------------------------------------------------------------------------
UPDATE public.branches
   SET phone = '8848642677', email = 'pallikkalpharmacy@gmail.com',
       address = 'Pallikkal Bazar, Pallikkal PO', city = 'Malappuram', state = NULL, pincode = '673634'
 WHERE is_active;

-- Website settings (0035): Ayurvedic store contact, WhatsApp = the pharmacy number, map, no other links.
DO $$
DECLARE b record; v jsonb;
BEGIN
  IF to_regclass('public.pharmacy_settings') IS NULL OR to_regprocedure('public._site_settings(uuid)') IS NULL THEN RETURN; END IF;
  FOR b IN SELECT id FROM public.branches WHERE is_active LOOP
    v := COALESCE((SELECT value FROM public.pharmacy_settings WHERE branch_id = b.id AND key = 'website'), '{}'::jsonb);
    v := v || jsonb_build_object(
      'whatsapp', '8848642677',
      'map_query', 'Pallikkal Bazar, Pallikkal PO, Malappuram 673634',
      'about_text', 'Pallikkal Pharmacy is a trusted local pharmacy at Pallikkal Bazar, Malappuram, dedicated to providing genuine medicines, reliable advice and everyday health essentials for you and your family.',
      'socials', jsonb_build_object('facebook', '', 'instagram', '', 'youtube', ''),
      'ayurveda', COALESCE(v->'ayurveda', '{}'::jsonb) || jsonb_build_object(
          'name', COALESCE(nullif(v->'ayurveda'->>'name', ''), 'Pallikkal Ayurvedic Store'),
          'phone', '9895843039', 'email', '', 'website', '',
          'address', 'Pallikkal Bazar, Pallikkal PO, Malappuram 673634',
          'map_query', 'Pallikkal Bazar, Pallikkal PO, Malappuram 673634'));
    INSERT INTO public.pharmacy_settings (branch_id, key, value, updated_at) VALUES (b.id, 'website', v, now())
    ON CONFLICT (branch_id, key) DO UPDATE SET value = excluded.value, updated_at = now();
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2 · Sessions last the whole day
--   A login stays valid until the end of the day (India time). Signing in on another
--   device no longer signs you out elsewhere; only sessions from earlier days are closed.
--   The next day everyone signs in again (the app checks the date too).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_work_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_branch uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT p.branch_id INTO v_branch
  FROM public.profiles p JOIN public.branches b ON b.id = p.branch_id
  WHERE p.id = v_user AND p.is_active = true AND p.must_change_password = false AND b.is_active = true;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Active staff profile and branch required'; END IF;

  -- close only sessions left open from earlier days
  UPDATE public.work_sessions SET logout_at = now(), logout_reason = 'new_login'
  WHERE user_id = v_user AND logout_at IS NULL AND work_date < v_today;

  INSERT INTO public.work_sessions (user_id, branch_id, work_date, login_at, last_activity_at)
  VALUES (v_user, v_branch, v_today, now(), now());
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.start_work_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_work_session() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3 · Medicines and billing rules
--   • Medicine discount: a percentage OR a fixed ₹ amount off each unit; billing applies it automatically.
--   • GST on the medicine is optional (0 by default); billing uses the GST of the batch
--     (from the purchase entry or the opening stock entry) and only shows it — MRP already includes GST.
--   • Unit price in billing = batch MRP (purchase / opening stock MRP ÷ pack size).
--   • Bill numbers: YYYY-MM-DD-#### (4 digits), e.g. 2026-11-23-0005.
-- -----------------------------------------------------------------------------
ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS discount_amount numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'medicines_discount_amount_check') THEN
    ALTER TABLE public.medicines ADD CONSTRAINT medicines_discount_amount_check CHECK (discount_amount IS NULL OR discount_amount >= 0);
  END IF;
END $$;
GRANT SELECT (discount_amount), INSERT (discount_amount), UPDATE (discount_amount) ON public.medicines TO authenticated;
ALTER TABLE public.medicines ALTER COLUMN tax_rate SET DEFAULT 0;
UPDATE public.medicines SET price_includes_tax = true WHERE price_includes_tax IS DISTINCT FROM true;
UPDATE public.medicine_batches SET price_includes_tax = true WHERE price_includes_tax = false;

-- Default discount % for one unit: the medicine's percentage, or its ₹ amount as a percentage of the unit MRP.
CREATE OR REPLACE FUNCTION public.billing_medicine_discount_pct(
  p_pct numeric, p_amount numeric, p_unit_mrp numeric, p_med_mrp numeric, p_med_selling numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_pct IS NOT NULL THEN round(least(greatest(p_pct, 0), 100), 2)
    WHEN COALESCE(p_amount, 0) > 0 AND COALESCE(p_unit_mrp, 0) > 0 THEN round(least(p_amount * 100 / p_unit_mrp, 100), 2)
    ELSE public.billing_default_discount_pct(p_med_mrp, p_med_selling, NULL)
  END
$$;

-- Bill numbers with a 4-digit daily sequence.
CREATE OR REPLACE FUNCTION public.assign_daily_invoice_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_date date; v_number integer;
BEGIN
  v_date := (COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Kolkata')::date;
  INSERT INTO public.daily_invoice_counters AS counters (invoice_date, last_value) VALUES (v_date, 1)
  ON CONFLICT (invoice_date) DO UPDATE SET last_value = counters.last_value + 1
  RETURNING last_value INTO v_number;
  NEW.invoice_no := to_char(v_date, 'YYYY-MM-DD') || '-' || lpad(v_number::text, 4, '0');
  RETURN NEW;
END;
$function$;

-- (The billing engine functions that use these rules are regenerated in section 6 below.)


-- -----------------------------------------------------------------------------
-- 4 · Inventory → Initial stock: GST % and Distributor per row
--   GST % is stored on the batch and shown in billing as entered (MRP already includes GST).
--   Distributor is optional; a new name is added to Distributors.
-- -----------------------------------------------------------------------------
ALTER TABLE public.opening_stock_items ADD COLUMN IF NOT EXISTS tax_rate numeric;
ALTER TABLE public.opening_stock_items ADD COLUMN IF NOT EXISTS distributor_id uuid REFERENCES public.distributors(id);
ALTER TABLE public.medicine_batches ADD COLUMN IF NOT EXISTS distributor_id uuid REFERENCES public.distributors(id);
GRANT SELECT (distributor_id) ON public.medicine_batches TO authenticated;

-- find (or add) a distributor of this branch by name
CREATE OR REPLACE FUNCTION public._distributor_by_name(p_branch uuid, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_name text := nullif(left(trim(COALESCE(p_name, '')), 120), '');
BEGIN
  IF v_name IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.distributors WHERE branch_id = p_branch AND lower(trim(name)) = lower(v_name) ORDER BY active DESC NULLS LAST LIMIT 1;
  IF v_id IS NULL THEN INSERT INTO public.distributors(branch_id, name) VALUES (p_branch, v_name) RETURNING id INTO v_id; END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public._distributor_by_name(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.opening_stock_get_draft()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); v_session public.opening_stock_sessions%rowtype; v_items jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  SELECT * INTO v_session FROM public.opening_stock_sessions WHERE branch_id = v_branch;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'medicine_id',i.medicine_id,'medicine_name',m.name,'strength',m.strength,
    'batch_no',i.batch_no,'expiry',i.expiry,'qty',i.qty,'unit_cost',i.unit_cost,'mrp',i.mrp,'selling_price',i.selling_price,
    'serial_no',i.serial_no,'pack_size',i.pack_size,'pack_qty',i.pack_qty,'srate',i.srate,'prate',i.prate,'urate',i.urate,'batch_id',i.batch_id,
    'tax_rate', COALESCE(i.tax_rate, b.tax_rate), 'distributor_id', i.distributor_id, 'distributor_name', d.name
  ) ORDER BY i.serial_no NULLS LAST, m.name, i.batch_no), '[]'::jsonb)
  INTO v_items
  FROM public.opening_stock_items i
  JOIN public.medicines m ON m.id = i.medicine_id
  LEFT JOIN public.medicine_batches b ON b.id = i.batch_id
  LEFT JOIN public.distributors d ON d.id = i.distributor_id
  WHERE i.session_id = v_session.id AND i.branch_id = v_branch;
  RETURN jsonb_build_object('id',v_session.id,'status',v_session.status,'notes',v_session.notes,'created_at',v_session.created_at,
    'updated_at',v_session.updated_at,'submitted_at',v_session.submitted_at,'items',v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.opening_stock_save_draft(p_items jsonb, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public.my_branch_id(); v_session public.opening_stock_sessions%rowtype; x jsonb; v_med uuid;
  v_pack numeric; v_pack_qty numeric; v_total numeric; v_prate numeric; v_srate numeric; v_urate numeric; v_gst numeric;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Add at least one stock batch'; END IF;
  IF jsonb_array_length(p_items) > 2000 THEN RAISE EXCEPTION 'Maximum 2,000 batch rows per draft'; END IF;
  INSERT INTO public.opening_stock_sessions(branch_id,status,notes,created_by,updated_by)
  VALUES (v_branch,'draft',nullif(trim(p_notes),''),auth.uid(),auth.uid()) ON CONFLICT (branch_id) DO NOTHING;
  SELECT * INTO v_session FROM public.opening_stock_sessions WHERE branch_id = v_branch FOR UPDATE;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'Opening stock has already been submitted and is locked'; END IF;
  DELETE FROM public.opening_stock_items WHERE session_id = v_session.id;
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_med := (x->>'medicine_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.medicines m WHERE m.id = v_med AND m.branch_id = v_branch AND m.active) THEN
      RAISE EXCEPTION 'Medicine missing, inactive or outside this branch';
    END IF;
    v_pack := coalesce(nullif(x->>'pack_size','')::numeric, 1);
    v_pack_qty := coalesce(nullif(x->>'pack_qty','')::numeric, nullif(x->>'qty','')::numeric);
    v_total := coalesce(nullif(x->>'qty','')::numeric, 0);
    v_srate := coalesce(nullif(x->>'srate','')::numeric, nullif(x->>'mrp','')::numeric, 0);
    v_prate := coalesce(nullif(x->>'prate','')::numeric, 0);
    v_urate := coalesce(nullif(x->>'urate','')::numeric, CASE WHEN v_pack > 0 THEN v_srate / v_pack ELSE 0 END);
    v_gst := nullif(x->>'tax_rate','')::numeric;
    IF v_pack <= 0 OR v_pack_qty <= 0 OR v_total <= 0 OR abs(v_total - (v_pack * v_pack_qty)) > 0.01
      OR coalesce(trim(x->>'batch_no'),'') = '' OR nullif(x->>'expiry','') IS NULL
      OR v_srate < 0 OR v_prate < 0 OR v_urate < 0 OR abs(v_urate - (v_srate / v_pack)) > 0.02
      OR (v_gst IS NOT NULL AND (v_gst < 0 OR v_gst > 100)) THEN
      RAISE EXCEPTION 'Invalid stock row: verify batch, expiry, pack, quantity, rates and GST %%';
    END IF;
    INSERT INTO public.opening_stock_items(session_id,branch_id,medicine_id,batch_no,expiry,qty,unit_cost,mrp,selling_price,
      serial_no,pack_size,pack_qty,srate,prate,urate,tax_rate,distributor_id)
    VALUES (v_session.id,v_branch,v_med,trim(x->>'batch_no'),(x->>'expiry')::date,v_total,round(v_prate/v_pack,4),round(v_urate,2),round(v_urate,2),
      nullif(x->>'serial_no',''),v_pack,v_pack_qty,v_srate,v_prate,v_urate,v_gst,
      COALESCE(nullif(x->>'distributor_id','')::uuid, public._distributor_by_name(v_branch, x->>'distributor_name')));
  END LOOP;
  UPDATE public.opening_stock_sessions SET notes = nullif(trim(p_notes),''), updated_by = auth.uid(), updated_at = now() WHERE id = v_session.id;
  RETURN v_session.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.opening_stock_submit()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public.my_branch_id(); v_session public.opening_stock_sessions%rowtype; i public.opening_stock_items%rowtype;
  v_batch uuid; v_count integer := 0; v_value numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  SELECT * INTO v_session FROM public.opening_stock_sessions WHERE branch_id = v_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No saved opening-stock draft'; END IF;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'Opening stock has already been submitted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opening_stock_items WHERE session_id = v_session.id) THEN RAISE EXCEPTION 'Draft is empty'; END IF;
  FOR i IN SELECT * FROM public.opening_stock_items WHERE session_id = v_session.id AND branch_id = v_branch ORDER BY id LOOP
    IF EXISTS (SELECT 1 FROM public.medicine_batches b WHERE b.medicine_id = i.medicine_id AND b.batch_no = i.batch_no) THEN
      RAISE EXCEPTION 'Batch % already exists for this medicine. Resolve the duplicate before submitting.', i.batch_no;
    END IF;
    INSERT INTO public.medicine_batches(branch_id,medicine_id,batch_no,expiry,qty,quarantined,unit_cost,pack_size,pack_qty,mrp,tax_rate,price_includes_tax,distributor_id)
    VALUES (v_branch,i.medicine_id,i.batch_no,i.expiry,i.qty,(i.expiry <= current_date),i.unit_cost,i.pack_size,i.pack_qty,round(i.urate,2),i.tax_rate,true,i.distributor_id)
    RETURNING id INTO v_batch;
    UPDATE public.opening_stock_items SET batch_id = v_batch WHERE id = i.id;
    INSERT INTO public.stock_movements(branch_id,medicine_id,batch_id,movement_type,qty,ref_type,ref_id,created_by,reason)
    VALUES (v_branch,i.medicine_id,v_batch,'opening_stock',i.qty,'opening_stock',v_session.id,auth.uid(),
      CASE WHEN i.expiry <= current_date THEN 'Takeover opening stock; expired batch quarantined' ELSE 'Pharmacy takeover opening stock' END);
    UPDATE public.medicines SET mrp = i.urate, selling_price = i.urate, purchase_price = i.unit_cost,
           tax_rate = CASE WHEN COALESCE(tax_rate, 0) = 0 AND i.tax_rate IS NOT NULL THEN i.tax_rate ELSE tax_rate END
    WHERE id = i.medicine_id AND branch_id = v_branch;
    v_count := v_count + 1; v_value := v_value + (i.qty * i.unit_cost);
  END LOOP;
  UPDATE public.opening_stock_sessions SET status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), updated_at = now(), updated_by = auth.uid()
  WHERE id = v_session.id;
  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  VALUES (v_branch,auth.uid(),'opening_stock_submitted','opening_stock_session',v_session.id::text,'Initial takeover stock posted',
    jsonb_build_object('status','draft'),jsonb_build_object('status','submitted','batch_count',v_count,'stock_value',round(v_value,2)),now());
  RETURN v_session.id;
END;
$$;

-- Correct the GST % of a submitted opening-stock batch (audited).
CREATE OR REPLACE FUNCTION public.opening_stock_set_batch_gst(p_batch uuid, p_tax_rate numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); v_old numeric;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF p_tax_rate IS NULL OR p_tax_rate < 0 OR p_tax_rate > 100 THEN RAISE EXCEPTION 'GST must be from 0 to 100%%'; END IF;
  SELECT tax_rate INTO v_old FROM public.medicine_batches WHERE id = p_batch AND branch_id = v_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found in this branch'; END IF;
  UPDATE public.medicine_batches SET tax_rate = p_tax_rate WHERE id = p_batch;
  UPDATE public.opening_stock_items SET tax_rate = p_tax_rate WHERE batch_id = p_batch;
  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  VALUES (v_branch,auth.uid(),'opening_stock_batch_edited','medicine_batch',p_batch::text,'GST % corrected',
          jsonb_build_object('tax_rate',v_old),jsonb_build_object('tax_rate',p_tax_rate),now());
END;
$$;
REVOKE ALL ON FUNCTION public.opening_stock_set_batch_gst(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opening_stock_set_batch_gst(uuid, numeric) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5 · WhatsApp: every staff role can prepare and send messages (one tap, wa.me link).
--   Campaigns, templates and settings stay Admin-only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._wa_guard(p_admin boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF p_admin AND v_role NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised: only Admin can manage WhatsApp campaigns, templates and settings'; END IF;
  IF v_role NOT IN ('super_admin','admin','admin_staff','pharmacist','billing_staff','billing','inventory_staff','inventory') THEN RAISE EXCEPTION 'Not authorised to send WhatsApp messages'; END IF;
  RETURN v_branch;
END;
$$;
REVOKE ALL ON FUNCTION public._wa_guard(boolean) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6 · Staff pages: every staff role (Pharmacist, Billing Staff, Inventory Staff) gets the
--   same access on Billing, Delivery, Medicines, Inventory, Customers, Sales, Returns,
--   Distributors and WhatsApp. Admin-only actions stay admin-only. (Generated from the
--   current function and policy definitions: only the role lists change.)
-- -----------------------------------------------------------------------------

-- >>> staff-parity (generated) >>>
CREATE OR REPLACE FUNCTION public._billing_assert_staff()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin','pharmacist','billing','billing_staff', 'inventory_staff', 'inventory') THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  v_branch := public.my_branch_id();
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Staff branch not configured'; END IF;
  RETURN v_branch;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_list_v2(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 2000)
 RETURNS TABLE(id uuid, supplier_invoice_no text, invoice_date date, created_at timestamp with time zone, due_date date, distributor_id uuid, distributor text, status text, line_count integer, pack_qty numeric, stock_units numeric, total numeric, paid numeric, returned numeric, doc_count integer, order_id uuid, order_no text, order_status text, created_by_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := COALESCE(public.my_role(), '');
  v_admin boolean := v_role IN ('super_admin','admin');
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF v_role NOT IN ('super_admin','admin','pharmacist','inventory_staff','inventory', 'billing_staff', 'billing') THEN RAISE EXCEPTION 'Not authorised'; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.finalize_sale(p_customer uuid, p_items jsonb, p_payments jsonb, p_discount numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

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
        'billing_staff', 'inventory_staff', 'inventory') THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.invoice_detail(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
DECLARE
  inv public.sales_invoices%ROWTYPE;
  r jsonb;
  f numeric;
  v_branch uuid;
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT COALESCE(app.session_ok(), false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  v_role := COALESCE(public.my_role(), '');
  v_branch := public.my_branch_id();
  IF v_role NOT IN ('super_admin','admin','pharmacist','billing_staff','billing', 'inventory_staff', 'inventory') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'No branch assigned'; END IF;

  SELECT * INTO inv FROM public.sales_invoices WHERE id = p_invoice AND branch_id = v_branch;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found in this branch'; END IF;

  -- Share of each line left after the bill-level discount.
  f := CASE WHEN inv.subtotal > 0 THEN inv.total / inv.subtotal ELSE 1 END;

  SELECT jsonb_build_object(
    'shop', (SELECT jsonb_build_object('name', b.name, 'address', b.address, 'city', b.city, 'state', b.state,
               'pincode', b.pincode, 'phone', b.phone, 'email', b.email, 'gstin', b.gstin,
               'drug_licence', b.drug_licence_nos, 'invoice_prefix', b.invoice_prefix, 'footer_note', b.invoice_footer)
             FROM public.branches b WHERE b.id = v_branch AND b.is_active = true),
    'invoice', jsonb_build_object('id', inv.id, 'branch_id', inv.branch_id, 'invoice_no', inv.invoice_no,
               'created_at', inv.created_at, 'subtotal', inv.subtotal, 'discount', inv.discount, 'tax', inv.tax,
               'total', inv.total, 'status', inv.status, 'line_discount', inv.line_discount,
               'taxable_total', inv.taxable_total, 'doctor_name', inv.doctor_name, 'patient_name', inv.patient_name,
               'patient_phone', inv.patient_phone, 'patient_address', inv.patient_address, 'diagnosis', inv.diagnosis),
    'customer', (SELECT jsonb_build_object('name', c.name, 'phone', c.phone) FROM public.customers c WHERE c.id = inv.customer_id),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', m.name, 'strength', m.strength, 'batch_no', b.batch_no, 'expiry', b.expiry,
               'qty', i.qty, 'unit_price', i.unit_price, 'tax_rate', i.tax_rate, 'line_total', i.line_total,
               'mrp', COALESCE(i.mrp, i.unit_price), 'discount_pct', i.discount_pct, 'discount_amount', i.discount_amount,
               'taxable_amount', i.taxable_amount, 'gst_amount', i.gst_amount,
               'price_includes_tax', COALESCE(i.price_includes_tax, true)) ORDER BY i.id), '[]'::jsonb)
             FROM public.sales_items i
             JOIN public.medicines m ON m.id = i.medicine_id
             JOIN public.medicine_batches b ON b.id = i.batch_id
             WHERE i.invoice_id = inv.id),
    'payments', (SELECT COALESCE(jsonb_agg(jsonb_build_object('method', pp.method, 'amount', pp.amount)), '[]'::jsonb)
                 FROM public.payments pp WHERE pp.invoice_id = inv.id),
    'tax_summary', (SELECT COALESCE(jsonb_agg(jsonb_build_object('rate', t.rate, 'taxable', t.taxable, 'tax', t.tax) ORDER BY t.rate), '[]'::jsonb)
                    FROM (SELECT i.tax_rate AS rate,
                                 ROUND(SUM(COALESCE(i.taxable_amount, i.line_total * 100 / (100 + i.tax_rate)) * f), 2) AS taxable,
                                 ROUND(SUM(COALESCE(i.gst_amount, i.line_total * i.tax_rate / (100 + i.tax_rate)) * f), 2) AS tax
                          FROM public.sales_items i WHERE i.invoice_id = inv.id GROUP BY i.tax_rate) t)
  ) INTO r;
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invoice_search(p_q text DEFAULT ''::text, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, invoice_no text, customer_name text, total numeric, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_branch uuid := public.my_branch_id();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not coalesce(app.session_ok(), false) then raise exception 'An active work session is required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin','pharmacist','billing_staff', 'billing', 'inventory_staff', 'inventory') then
    raise exception 'Not authorised';
  end if;
  if v_branch is null then raise exception 'No branch assigned'; end if;

  return query
  select i.id, i.invoice_no, coalesce(c.name, 'Walk-in'), i.total, i.created_at
  from public.sales_invoices i
  left join public.customers c
    on c.id = i.customer_id and c.branch_id = v_branch
  where i.branch_id = v_branch
    and i.status = 'final'
    and (
      coalesce(trim(p_q),'') = ''
      or i.invoice_no ilike '%' || trim(p_q) || '%'
      or coalesce(c.name,'') ilike '%' || trim(p_q) || '%'
      or coalesce(c.phone,'') ilike '%' || trim(p_q) || '%'
    )
  order by i.created_at desc
  limit greatest(1, least(coalesce(p_limit,10),50));
end;
$function$;

CREATE OR REPLACE FUNCTION public._sales_guard()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin','pharmacist','billing_staff','billing', 'inventory_staff', 'inventory') THEN
    RAISE EXCEPTION 'Not authorised to view sales';
  END IF;
  RETURN v_branch;
END;
$function$;

CREATE OR REPLACE FUNCTION public._returns_guard(p_kind text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_branch uuid := public.my_branch_id(); v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF p_kind = 'sales' AND v_role NOT IN ('super_admin','admin','pharmacist','billing_staff', 'billing', 'inventory_staff', 'inventory') THEN RAISE EXCEPTION 'Not authorised to view sales returns'; END IF;
  IF p_kind = 'purchase' AND v_role NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised to view purchase returns'; END IF;
  IF p_kind NOT IN ('sales','purchase') THEN RAISE EXCEPTION 'Unknown return type'; END IF;
  RETURN v_branch;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_sales_return(p_invoice uuid, p_items jsonb, p_method text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_branch uuid := public.my_branch_id();
    v_role text := COALESCE(public.my_role(), '');
    inv public.sales_invoices%ROWTYPE;
    si public.sales_items%ROWTYPE;
    it jsonb;
    rq numeric;
    done numeric;
    factor numeric;
    line_amount numeric;
    line_tax numeric;
    subtotal_return numeric := 0;
    tax_return numeric := 0;
    disposition text;
    return_id uuid;
    return_item_id uuid;
    return_number text;

    v_return_base numeric;
    v_to_restore numeric;
    v_available numeric;
    v_take numeric;
    v_alloc record;
    v_updated integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT COALESCE(app.session_ok(), false) THEN
        RAISE EXCEPTION 'An active work session is required';
    END IF;

    IF v_role NOT IN (
        'super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory') THEN
        RAISE EXCEPTION 'Not authorised';
    END IF;

    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'No branch assigned';
    END IF;

    IF COALESCE(TRIM(p_reason), '') = '' THEN
        RAISE EXCEPTION 'A reason is required';
    END IF;

    IF p_method NOT IN ('cash', 'upi') THEN
        RAISE EXCEPTION 'Refund method must be Cash or UPI';
    END IF;

    IF jsonb_typeof(p_items) <> 'array'
       OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Nothing selected to return';
    END IF;

    SELECT *
    INTO inv
    FROM public.sales_invoices
    WHERE id = p_invoice
      AND branch_id = v_branch
      AND status = 'final'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found';
    END IF;

    factor := CASE
        WHEN inv.subtotal > 0 THEN inv.total / inv.subtotal
        ELSE 1
    END;

    return_number :=
        'CN-' ||
        to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMM') ||
        '-' ||
        lpad(nextval('public.sales_return_doc_seq')::text, 6, '0');

    INSERT INTO public.sales_returns (
        branch_id, return_no, invoice_id, customer_id,
        reason, refund_method, created_by
    )
    VALUES (
        v_branch, return_number, p_invoice, inv.customer_id,
        TRIM(p_reason), p_method, auth.uid()
    )
    RETURNING id INTO return_id;

    FOR it IN
        SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        IF COALESCE(it->>'sales_item_id', '') = '' THEN
            RAISE EXCEPTION 'Invalid sale item';
        END IF;

        SELECT *
        INTO si
        FROM public.sales_items
        WHERE id = (it->>'sales_item_id')::uuid
          AND invoice_id = p_invoice
          AND branch_id = v_branch
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Item does not belong to this invoice';
        END IF;

        rq := (it->>'qty')::numeric;

        IF rq IS NULL OR rq <= 0 THEN
            RAISE EXCEPTION 'Invalid return quantity';
        END IF;

        SELECT COALESCE(SUM(sri.qty), 0)
        INTO done
        FROM public.sales_return_items sri
        JOIN public.sales_returns sr ON sr.id = sri.return_id
        WHERE sri.sales_item_id = si.id
          AND sr.branch_id = v_branch;

        IF done + rq > si.qty THEN
            RAISE EXCEPTION
                'Cannot return more than sold. Sold %, already returned %',
                si.qty, done;
        END IF;

        disposition := COALESCE(it->>'disposition', 'restock');

        IF disposition NOT IN ('restock', 'damaged') THEN
            RAISE EXCEPTION 'Invalid item condition';
        END IF;

        line_amount := ROUND(si.unit_price * rq * factor, 2);

        line_tax := CASE
            WHEN (100 + si.tax_rate) > 0
            THEN ROUND(
                line_amount * si.tax_rate / (100 + si.tax_rate), 2
            )
            ELSE 0
        END;

        IF line_amount <= 0 THEN
            RAISE EXCEPTION 'Return amount must be positive';
        END IF;

        -- Convert the returned sale quantity into base units.
        v_return_base := rq * COALESCE(
            si.base_qty / NULLIF(si.qty, 0),
            si.unit_factor,
            1
        );

        INSERT INTO public.sales_return_items (
            branch_id, return_id, sales_item_id,
            medicine_id, batch_id, qty, base_qty,
            disposition, line_total
        )
        VALUES (
            v_branch, return_id, si.id,
            si.medicine_id, si.batch_id, rq, v_return_base,
            disposition, line_amount
        )
        RETURNING id INTO return_item_id;

        IF disposition = 'restock' THEN

            -- Restore physical stock to the original batch.
            UPDATE public.medicine_batches
            SET qty = qty + v_return_base
            WHERE id = si.batch_id
              AND medicine_id = si.medicine_id
              AND branch_id = v_branch;

            IF NOT FOUND THEN
                RAISE EXCEPTION
                    'Original batch not found in this branch';
            END IF;

            -- Restore the original FIFO sale allocations.
            v_to_restore := v_return_base;

            FOR v_alloc IN
                SELECT
                    sa.id AS sale_allocation_id,
                    sa.cost_layer_id,
                    sa.qty,
                    sa.unit_cost,
                    COALESCE((
                        SELECT SUM(cra.qty)
                        FROM public.inventory_customer_return_allocations cra
                        WHERE cra.sale_allocation_id = sa.id
                    ), 0) AS already_restored
                FROM public.inventory_sale_allocations sa
                WHERE sa.sales_item_id = si.id
                  AND sa.branch_id = v_branch
                ORDER BY sa.created_at, sa.id
                FOR UPDATE
            LOOP
                EXIT WHEN v_to_restore <= 0;

                v_available := v_alloc.qty - v_alloc.already_restored;

                IF v_available <= 0 THEN
                    CONTINUE;
                END IF;

                v_take := LEAST(v_to_restore, v_available);

                UPDATE public.inventory_cost_layers
                SET remaining_qty = remaining_qty + v_take
                WHERE id = v_alloc.cost_layer_id
                  AND branch_id = v_branch
                  AND batch_id = si.batch_id;

                GET DIAGNOSTICS v_updated = ROW_COUNT;

                IF v_updated <> 1 THEN
                    RAISE EXCEPTION
                        'Original FIFO cost layer could not be restored';
                END IF;

                INSERT INTO public.inventory_customer_return_allocations (
                    branch_id,
                    sales_return_item_id,
                    sale_allocation_id,
                    qty,
                    unit_cost,
                    restored_cost
                )
                VALUES (
                    v_branch,
                    return_item_id,
                    v_alloc.sale_allocation_id,
                    v_take,
                    v_alloc.unit_cost,
                    CASE
                        WHEN v_alloc.unit_cost IS NULL THEN NULL
                        ELSE ROUND(v_take * v_alloc.unit_cost, 6)
                    END
                );

                v_to_restore := v_to_restore - v_take;
            END LOOP;

            IF v_to_restore > 0 THEN
                RAISE EXCEPTION
                    'Original FIFO allocation insufficient for return. Unallocated base quantity: %',
                    v_to_restore;
            END IF;

            INSERT INTO public.stock_movements (
                branch_id, medicine_id, batch_id,
                movement_type, qty, ref_type, ref_id,
                created_by, reason
            )
            VALUES (
                v_branch, si.medicine_id, si.batch_id,
                'return_in', v_return_base,
                'sales_return', return_id,
                auth.uid(), 'Customer return ' || return_number
            );
        END IF;

        subtotal_return := subtotal_return + line_amount;
        tax_return := tax_return + line_tax;
    END LOOP;

    IF subtotal_return <= 0 THEN
        RAISE EXCEPTION 'Return amount is zero';
    END IF;

    UPDATE public.sales_returns
    SET total = subtotal_return,
        tax = tax_return
    WHERE id = return_id
      AND branch_id = v_branch;

    INSERT INTO public.audit_logs (
        branch_id, user_id, action, entity_type,
        entity_id, reason, before_data, after_data
    )
    VALUES (
        v_branch, auth.uid(), 'sales_return_created',
        'sales_return', return_id::text,
        TRIM(p_reason), NULL,
        jsonb_build_object(
            'return_no', return_number,
            'invoice_id', p_invoice,
            'total', subtotal_return,
            'tax', tax_return,
            'refund_method', p_method
        )
    );

    RETURN return_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.returnable_items(p_invoice uuid)
 RETURNS TABLE(sales_item_id uuid, name text, strength text, batch_no text, qty_sold numeric, qty_returned numeric, unit_refund numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_branch uuid := public.my_branch_id();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not coalesce(app.session_ok(), false) then raise exception 'An active work session is required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin','pharmacist','billing_staff', 'billing', 'inventory_staff', 'inventory') then
    raise exception 'Not authorised';
  end if;
  if v_branch is null then raise exception 'No branch assigned'; end if;
  if not exists (
    select 1 from public.sales_invoices i
    where i.id = p_invoice and i.branch_id = v_branch and i.status = 'final'
  ) then raise exception 'Invoice not found'; end if;

  return query
  select si.id, m.name, m.strength, b.batch_no, si.qty,
         coalesce(r.returned_qty,0),
         case when i.subtotal > 0
              then round(si.unit_price * (i.total / i.subtotal), 2)
              else round(si.unit_price, 2) end
  from public.sales_items si
  join public.sales_invoices i on i.id = si.invoice_id and i.branch_id = v_branch
  join public.medicines m on m.id = si.medicine_id and m.branch_id = v_branch
  join public.medicine_batches b on b.id = si.batch_id and b.branch_id = v_branch
  left join (
    select sri.sales_item_id, sum(sri.qty) as returned_qty
    from public.sales_return_items sri
    join public.sales_returns sr on sr.id = sri.return_id and sr.branch_id = v_branch
    where sri.branch_id = v_branch
    group by sri.sales_item_id
  ) r on r.sales_item_id = si.id
  where si.invoice_id = p_invoice and si.branch_id = v_branch
  order by m.name, b.batch_no;
end;
$function$;

CREATE OR REPLACE FUNCTION public.credit_note_detail(p_return uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_branch uuid := public.my_branch_id();
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not coalesce(app.session_ok(), false) then raise exception 'An active work session is required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin','pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory') then
    raise exception 'Not authorised';
  end if;

  select jsonb_build_object(
    'note', jsonb_build_object(
      'return_no', sr.return_no, 'created_at', sr.created_at,
      'reason', sr.reason, 'refund_method', sr.refund_method,
      'tax', sr.tax, 'total', sr.total
    ),
    'invoice_no', si.invoice_no,
    'shop', jsonb_build_object(
      'name', br.name,
      'address', concat_ws(', ', br.address, br.city, br.state, br.pincode),
      'phone', br.phone, 'gstin', br.gstin,
      'drug_licence', (select string_agg(lic.value, ', ') from jsonb_array_elements_text(br.drug_licence_nos) as lic(value))
    ),
    'customer', case when c.id is null then null
      else jsonb_build_object('name', c.name, 'phone', c.phone) end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', m.name, 'strength', m.strength, 'batch_no', mb.batch_no,
        'qty', sri.qty, 'line_total', sri.line_total
      ) order by m.name)
      from public.sales_return_items sri
      join public.medicines m on m.id = sri.medicine_id and m.branch_id = v_branch
      join public.medicine_batches mb on mb.id = sri.batch_id and mb.branch_id = v_branch
      where sri.return_id = sr.id and sri.branch_id = v_branch
    ), '[]'::jsonb)
  ) into v_result
  from public.sales_returns sr
  join public.sales_invoices si on si.id = sr.invoice_id and si.branch_id = v_branch
  left join public.customers c on c.id = sr.customer_id and c.branch_id = v_branch
  join public.branches br on br.id = sr.branch_id
  where sr.id = p_return and sr.branch_id = v_branch;

  if v_result is null then raise exception 'Credit note not found'; end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.customer_dues()
 RETURNS TABLE(customer_id uuid, name text, phone text, outstanding numeric, credit_limit numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    c.id,
    c.name,
    c.phone,
    public.customer_outstanding(c.id),
    c.credit_limit
  FROM public.customers c
  WHERE c.branch_id = public.my_branch_id()
    AND auth.uid() IS NOT NULL
    AND COALESCE(public.my_role(), '') IN (
      'super_admin',
      'admin',
      'pharmacist',
      'billing_staff', 'billing', 'inventory_staff', 'inventory')
    AND public.customer_outstanding(c.id) > 0
  ORDER BY 4 DESC;
$function$;

CREATE OR REPLACE FUNCTION public.customer_outstanding(p_customer uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT
        CASE
            WHEN auth.uid() IS NOT NULL
             AND public.my_branch_id() IS NOT NULL
             AND COALESCE(public.my_role(), '') IN (
                'super_admin',
                'admin',
                'pharmacist',
                'billing_staff', 'billing', 'inventory_staff', 'inventory')
            THEN
                COALESCE((
                    SELECT SUM(p.amount)
                    FROM public.payments p
                    JOIN public.sales_invoices i
                      ON i.id = p.invoice_id
                    WHERE p.branch_id = public.my_branch_id()
                      AND i.branch_id = public.my_branch_id()
                      AND i.customer_id = p_customer
                      AND p.method = 'credit'
                      AND i.status = 'final'
                ), 0)

                -

                COALESCE((
                    SELECT SUM(r.amount)
                    FROM public.customer_receipts r
                    WHERE r.branch_id = public.my_branch_id()
                      AND r.customer_id = p_customer
                      AND r.status = 'posted'
                ), 0)

                +

                COALESCE((
                    SELECT SUM(l.debit - l.credit)
                    FROM public.financial_ledger l
                    WHERE l.branch_id = public.my_branch_id()
                      AND l.account = 'receivables'
                      AND l.party_type = 'customer'
                      AND l.party_id = p_customer
                      AND l.ref_type = 'opening_balance'
                ), 0)

            ELSE 0
        END;
$function$;

CREATE OR REPLACE FUNCTION public.customer_stats()
 RETURNS TABLE(customer_id uuid, bills integer, spent numeric, returned numeric, first_bill timestamp with time zone, last_bill timestamp with time zone, spent_12m numeric, outstanding numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin','pharmacist','billing_staff','billing', 'inventory_staff', 'inventory') THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  RETURN QUERY
  SELECT c.id,
         COALESCE(s.n, 0)::integer,
         round(COALESCE(s.total, 0), 2),
         round(COALESCE(r.total, 0), 2),
         s.first_at, s.last_at,
         round(COALESCE(s.total_12m, 0), 2),
         round(public.customer_outstanding(c.id), 2)
  FROM public.customers c
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, sum(i.total) AS total, min(i.created_at) AS first_at, max(i.created_at) AS last_at,
           sum(i.total) FILTER (WHERE i.created_at >= now() - interval '12 months') AS total_12m
    FROM public.sales_invoices i
    WHERE i.branch_id = v_branch AND i.customer_id = c.id AND i.status = 'final') s ON true
  LEFT JOIN LATERAL (
    SELECT sum(x.total) AS total FROM public.sales_returns x
    WHERE x.branch_id = v_branch AND x.customer_id = c.id) r ON true
  WHERE c.branch_id = v_branch;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_customer_receipt(p_customer uuid, p_amount numeric, p_method text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_branch uuid := public.my_branch_id();
    v_customer public.customers%rowtype;
    v_id uuid;
    v_no text;
    v_journal uuid;
BEGIN
    IF auth.uid() IS NULL OR v_branch IS NULL THEN
        RAISE EXCEPTION 'Login and active branch required';
    END IF;

    IF COALESCE(public.my_role(), '') NOT IN (
        'super_admin',
        'admin',
        'pharmacist',
        'billing_staff', 'billing', 'inventory_staff', 'inventory') THEN
        RAISE EXCEPTION 'Not authorised';
    END IF;

    IF p_amount IS NULL
       OR p_amount <= 0
       OR p_method NOT IN ('cash', 'upi') THEN
        RAISE EXCEPTION
            'Enter a positive amount and choose Cash or UPI';
    END IF;

    SELECT *
    INTO v_customer
    FROM public.customers
    WHERE id = p_customer
      AND branch_id = v_branch
      AND active = true
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Customer not found or inactive in this branch';
    END IF;

    -- Overpayments are now allowed.
    -- The excess becomes a customer advance (credit receivable).

    v_no := public.finance_next_doc('RCPT');

    INSERT INTO public.customer_receipts (
        branch_id,
        receipt_no,
        customer_id,
        amount,
        method,
        note,
        created_by
    )
    VALUES (
        v_branch,
        v_no,
        p_customer,
        p_amount,
        p_method,
        NULLIF(TRIM(p_note), ''),
        auth.uid()
    )
    RETURNING id INTO v_id;

    v_journal := public.post_journal(
        'customer_receipt',
        v_id,
        'Receipt ' || v_no || ' from ' || v_customer.name,
        jsonb_build_array(
            jsonb_build_object(
                'account', p_method,
                'debit', p_amount,
                'credit', 0
            ),
            jsonb_build_object(
                'account', 'receivables',
                'debit', 0,
                'credit', p_amount,
                'party_type', 'customer',
                'party_id', p_customer
            )
        )
    );

    UPDATE public.customer_receipts
    SET journal_id = v_journal
    WHERE id = v_id
      AND branch_id = v_branch;

    INSERT INTO public.audit_logs (
        branch_id,
        user_id,
        action,
        entity_type,
        entity_id,
        reason,
        before_data,
        after_data,
        at
    )
    VALUES (
        v_branch,
        auth.uid(),
        'customer_receipt_recorded',
        'customer_receipt',
        v_id::text,
        'Customer dues receipt',
        NULL,
        jsonb_build_object(
            'receipt_no', v_no,
            'customer_id', p_customer,
            'amount', p_amount,
            'method', p_method
        ),
        now()
    );

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delivery_assign(p_invoice_id uuid, p_delivery_person_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := public.my_role();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Login with an active branch profile is required';
  END IF;
  IF v_role NOT IN ('super_admin','admin','admin_staff','pharmacist','billing_staff','billing', 'inventory_staff', 'inventory') THEN
    RAISE EXCEPTION 'Not authorised to assign deliveries';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = p_delivery_person_id AND p.branch_id = v_branch
      AND p.is_active = true AND r.code = 'delivery_person'
  ) THEN RAISE EXCEPTION 'Active delivery-person account not found in this branch'; END IF;

  UPDATE public.delivery_jobs
  SET assigned_to = p_delivery_person_id, assigned_by = auth.uid(), assigned_at = now(),
      status = 'pending', updated_by = auth.uid(), updated_at = now()
  WHERE branch_id = v_branch AND invoice_id = p_invoice_id AND is_requested = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mark this invoice as delivery requested before assigning it'; END IF;

  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,after_data,at)
  VALUES (v_branch,auth.uid(),'delivery_assigned','sales_invoice',p_invoice_id::text,
          jsonb_build_object('delivery_person_id',p_delivery_person_id),now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.delivery_is_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL AND public.my_branch_id() IS NOT NULL
     AND COALESCE(public.my_role(), '') IN ('super_admin','admin','admin_staff','pharmacist','billing_staff','billing', 'inventory_staff', 'inventory');
$function$;

CREATE OR REPLACE FUNCTION public.delivery_management_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := public.my_role();
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Login with an active branch profile is required';
  END IF;
  IF v_role NOT IN ('super_admin','admin','admin_staff','pharmacist','billing_staff','billing', 'inventory_staff', 'inventory') THEN
    RAISE EXCEPTION 'Not authorised to manage deliveries';
  END IF;

  SELECT jsonb_build_object(
    'invoices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id,
        'branch_id', i.branch_id,
        'invoice_no', i.invoice_no,
        'customer_id', i.customer_id,
        'total', i.total,
        'status', i.status,
        'created_at', i.created_at,
        'customer', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', c.id, 'name', c.name, 'phone', c.phone, 'address', c.address
        ) END,
        'delivery', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', d.id, 'is_requested', d.is_requested, 'assigned_to', d.assigned_to,
          'status', d.status, 'requested_at', d.requested_at, 'assigned_at', d.assigned_at
        ) END,
        'delivery_person', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', p.id, 'staff_id', p.staff_id, 'full_name', p.full_name, 'phone', p.phone
        ) END
      ) ORDER BY i.created_at DESC)
      FROM public.sales_invoices i
      LEFT JOIN public.customers c ON c.id = i.customer_id AND c.branch_id = v_branch
      LEFT JOIN public.delivery_jobs d ON d.invoice_id = i.id AND d.branch_id = v_branch
      LEFT JOIN public.profiles p ON p.id = d.assigned_to AND p.branch_id = v_branch
      WHERE i.branch_id = v_branch AND i.status = 'final'
    ), '[]'::jsonb),
    'delivery_people', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'staff_id', p.staff_id, 'full_name', p.full_name, 'phone', p.phone
      ) ORDER BY p.full_name)
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.branch_id = v_branch AND p.is_active = true AND r.code = 'delivery_person'
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delivery_presence_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := public.my_role();
  v_available integer := 0;
  v_purchasing integer := 0;
  v_offline integer := 0;
  v_updated timestamptz;
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL
     OR v_role NOT IN ('super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory')
     OR NOT COALESCE(app.session_ok(), false) THEN
    RAISE EXCEPTION 'An active branch staff login is required';
  END IF;

  SELECT
    count(*) FILTER (WHERE r.code = 'delivery_person' AND p.is_active = true AND pr.status = 'available')::integer,
    count(*) FILTER (WHERE r.code = 'delivery_person' AND p.is_active = true AND pr.status = 'purchasing')::integer,
    count(*) FILTER (WHERE r.code = 'delivery_person' AND p.is_active = true AND COALESCE(pr.status, 'offline') = 'offline')::integer,
    max(pr.updated_at)
  INTO v_available, v_purchasing, v_offline, v_updated
  FROM public.profiles p
  JOIN public.roles r ON r.id = p.role_id
  LEFT JOIN public.delivery_person_presence pr
    ON pr.profile_id = p.id AND pr.branch_id = v_branch
  WHERE p.branch_id = v_branch
    AND p.is_active = true
    AND r.code = 'delivery_person';

  v_status := CASE
    WHEN v_available > 0 THEN 'available'
    WHEN v_purchasing > 0 THEN 'purchasing'
    ELSE 'offline'
  END;

  RETURN jsonb_build_object(
    'status', v_status,
    'available_count', v_available,
    'purchasing_count', v_purchasing,
    'offline_count', v_offline,
    'updated_at', v_updated
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delivery_set_request(p_invoice_id uuid, p_requested boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := public.my_role();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Login with an active branch profile is required';
  END IF;
  IF v_role NOT IN ('super_admin','admin','admin_staff','pharmacist','billing_staff','billing', 'inventory_staff', 'inventory') THEN
    RAISE EXCEPTION 'Not authorised to update delivery requests';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = p_invoice_id AND branch_id = v_branch AND status = 'final') THEN
    RAISE EXCEPTION 'Final invoice not found in this branch';
  END IF;

  INSERT INTO public.delivery_jobs(branch_id, invoice_id, is_requested, requested_by, requested_at, updated_by, updated_at)
  VALUES (v_branch, p_invoice_id, COALESCE(p_requested,false), CASE WHEN p_requested THEN auth.uid() END,
          CASE WHEN p_requested THEN now() END, auth.uid(), now())
  ON CONFLICT (branch_id, invoice_id) DO UPDATE SET
    is_requested = EXCLUDED.is_requested,
    requested_by = CASE WHEN EXCLUDED.is_requested THEN auth.uid() ELSE delivery_jobs.requested_by END,
    requested_at = CASE WHEN EXCLUDED.is_requested THEN now() ELSE delivery_jobs.requested_at END,
    assigned_to = CASE WHEN EXCLUDED.is_requested THEN delivery_jobs.assigned_to ELSE NULL END,
    assigned_by = CASE WHEN EXCLUDED.is_requested THEN delivery_jobs.assigned_by ELSE NULL END,
    status = CASE WHEN EXCLUDED.is_requested THEN delivery_jobs.status ELSE 'pending' END,
    updated_by = auth.uid(), updated_at = now();

  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,after_data,at)
  VALUES (v_branch,auth.uid(),CASE WHEN p_requested THEN 'delivery_requested' ELSE 'delivery_request_removed' END,
          'sales_invoice',p_invoice_id::text,jsonb_build_object('is_requested',p_requested),now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_shop_open_status(p_is_open boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := public.my_role();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL
     OR v_role NOT IN ('super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory')
     OR NOT COALESCE(app.session_ok(), false) THEN
    RAISE EXCEPTION 'An active authorised branch session is required';
  END IF;

  INSERT INTO public.branch_shop_status(branch_id, is_open, updated_at, updated_by)
  VALUES (v_branch, COALESCE(p_is_open, false), now(), auth.uid())
  ON CONFLICT (branch_id) DO UPDATE
    SET is_open = EXCLUDED.is_open,
        updated_at = now(),
        updated_by = auth.uid();

  RETURN COALESCE(p_is_open, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_stock(p_batch uuid, p_delta numeric, p_type text, p_reason text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_branch uuid;
    v_batch public.medicine_batches%rowtype;
    v_new_qty numeric;
    v_movement_id bigint;
    v_needed numeric;
    v_take numeric;
    v_layer record;
    v_updated integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    v_branch := public.my_branch_id();

    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'No active branch assigned';
    END IF;

    IF COALESCE(public.my_role(), '') NOT IN ('super_admin', 'admin', 'pharmacist', 'inventory', 'inventory_staff', 'billing_staff', 'billing') THEN
        RAISE EXCEPTION 'Not authorised';
    END IF;

    IF p_type IS NULL OR p_type NOT IN
        ('adjustment', 'damage', 'expiry_writeoff') THEN
        RAISE EXCEPTION 'Invalid adjustment type';
    END IF;

    IF COALESCE(TRIM(p_reason), '') = '' THEN
        RAISE EXCEPTION 'A reason is required';
    END IF;

    IF p_delta IS NULL OR p_delta = 0 THEN
        RAISE EXCEPTION 'Quantity must not be zero';
    END IF;

    IF p_type <> 'adjustment' AND p_delta > 0 THEN
        RAISE EXCEPTION 'Damage and write-off must reduce stock';
    END IF;

    SELECT *
    INTO v_batch
    FROM public.medicine_batches
    WHERE id = p_batch
      AND branch_id = v_branch
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Batch not found in this branch';
    END IF;

    v_new_qty := v_batch.qty + p_delta;

    IF v_new_qty < 0 THEN
        RAISE EXCEPTION 'Stock cannot go below zero (current %)',
            v_batch.qty;
    END IF;

    UPDATE public.medicine_batches
    SET qty = v_new_qty
    WHERE id = v_batch.id
      AND branch_id = v_branch;

    INSERT INTO public.stock_movements (
        branch_id,
        medicine_id,
        batch_id,
        movement_type,
        qty,
        ref_type,
        reason,
        created_by
    )
    VALUES (
        v_branch,
        v_batch.medicine_id,
        v_batch.id,
        p_type,
        p_delta,
        'manual',
        TRIM(p_reason),
        auth.uid()
    )
    RETURNING id INTO v_movement_id;

    IF p_delta > 0 THEN
        -- Positive manual adjustment creates its own cost layer.
        INSERT INTO public.inventory_cost_layers (
            branch_id,
            medicine_id,
            batch_id,
            layer_type,
            received_qty,
            remaining_qty,
            unit_cost,
            received_at,
            source_movement_id
        )
        VALUES (
            v_branch,
            v_batch.medicine_id,
            v_batch.id,
            'adjustment',
            p_delta,
            p_delta,
            v_batch.unit_cost,
            now(),
            v_movement_id
        );

    ELSE
        -- Negative adjustment consumes existing FIFO layers.
        v_needed := ABS(p_delta);

        FOR v_layer IN
            SELECT
                l.id,
                l.remaining_qty,
                l.unit_cost
            FROM public.inventory_cost_layers l
            WHERE l.branch_id = v_branch
              AND l.medicine_id = v_batch.medicine_id
              AND l.batch_id = v_batch.id
              AND l.remaining_qty > 0
            ORDER BY
                l.received_at,
                l.created_at,
                l.id
            FOR UPDATE
        LOOP
            EXIT WHEN v_needed <= 0;

            v_take := LEAST(v_needed, v_layer.remaining_qty);

            UPDATE public.inventory_cost_layers
            SET remaining_qty = remaining_qty - v_take
            WHERE id = v_layer.id
              AND remaining_qty >= v_take;

            GET DIAGNOSTICS v_updated = ROW_COUNT;

            IF v_updated <> 1 THEN
                RAISE EXCEPTION
                    'FIFO layer changed while processing adjustment';
            END IF;

            INSERT INTO public.inventory_adjustment_allocations (
                branch_id,
                movement_id,
                cost_layer_id,
                allocation_action,
                qty,
                unit_cost
            )
            VALUES (
                v_branch,
                v_movement_id,
                v_layer.id,
                'consume',
                v_take,
                v_layer.unit_cost
            );

            v_needed := v_needed - v_take;
        END LOOP;

        IF v_needed > 0 THEN
            RAISE EXCEPTION
                'Insufficient FIFO layer quantity. Unallocated quantity: %',
                v_needed;
        END IF;
    END IF;

    INSERT INTO public.audit_logs (
        branch_id,
        user_id,
        action,
        entity_type,
        entity_id,
        reason,
        before_data,
        after_data,
        at
    )
    VALUES (
        v_branch,
        auth.uid(),
        'stock_' || p_type,
        'medicine_batch',
        v_batch.id::text,
        TRIM(p_reason),
        jsonb_build_object('qty', v_batch.qty),
        jsonb_build_object('qty', v_new_qty),
        now()
    );

    RETURN v_new_qty;
END;
$function$;

CREATE OR REPLACE FUNCTION public.low_stock()
 RETURNS TABLE(medicine_id uuid, name text, sellable numeric, reorder_level numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    m.id,
    m.name,
    coalesce(
      sum(b.qty) filter (
        where b.expiry >= current_date and not b.quarantined
      ), 0
    ) as sellable,
    m.reorder_level
  from public.medicines m
  left join public.medicine_batches b
    on b.medicine_id = m.id
   and b.branch_id = m.branch_id
  where auth.uid() is not null
    and public.my_branch_id() is not null
    and m.branch_id = public.my_branch_id()
    and coalesce(public.my_role(), '') in ('super_admin', 'admin', 'pharmacist', 'inventory', 'inventory_staff', 'billing_staff', 'billing')
    and m.active
    and m.reorder_level > 0
  group by m.id, m.name, m.reorder_level
  having coalesce(
    sum(b.qty) filter (
      where b.expiry >= current_date and not b.quarantined
    ), 0
  ) <= m.reorder_level
  order by sellable;
$function$;

CREATE OR REPLACE FUNCTION public.physical_count(p_counts jsonb, p_note text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_branch uuid;
  v_item jsonb;
  v_batch public.medicine_batches%rowtype;
  v_counted numeric;
  v_delta numeric;
  v_adjusted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_branch := public.my_branch_id();
  if v_branch is null then
    raise exception 'No active branch assigned';
  end if;

  if coalesce(public.my_role(), '') not in ('super_admin', 'admin', 'pharmacist', 'inventory', 'inventory_staff', 'billing_staff', 'billing') then
    raise exception 'Not authorised';
  end if;

  if jsonb_typeof(p_counts) <> 'array' then
    raise exception 'Counts must be a JSON array';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'A note is required';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_counts)
  loop
    if not (v_item ? 'batch_id') or not (v_item ? 'counted') then
      raise exception 'Each count needs batch_id and counted';
    end if;

    v_counted := (v_item ->> 'counted')::numeric;
    if v_counted < 0 then
      raise exception 'Counted quantity cannot be negative';
    end if;

    select *
      into v_batch
    from public.medicine_batches
    where id = (v_item ->> 'batch_id')::uuid
      and branch_id = v_branch
    for update;

    if not found then
      raise exception 'Batch not found in this branch';
    end if;

    v_delta := v_counted - v_batch.qty;
    if v_delta <> 0 then
      update public.medicine_batches
      set qty = v_counted
      where id = v_batch.id
        and branch_id = v_branch;

      insert into public.stock_movements
        (branch_id, medicine_id, batch_id, movement_type, qty,
         ref_type, reason, created_by)
      values
        (v_branch, v_batch.medicine_id, v_batch.id, 'physical_count',
         v_delta, 'physical_count', trim(p_note), auth.uid());

      v_adjusted := v_adjusted + 1;
    end if;
  end loop;

  insert into public.audit_logs
    (branch_id, user_id, action, entity_type, entity_id,
     reason, before_data, after_data, at)
  values
    (v_branch, auth.uid(), 'physical_count', 'inventory',
     null, trim(p_note), null,
     jsonb_build_object('adjusted_batches', v_adjusted), now());

  return v_adjusted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_quarantine(p_batch uuid, p_flag boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_branch uuid;
  v_batch public.medicine_batches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_branch := public.my_branch_id();
  if v_branch is null then
    raise exception 'No active branch assigned';
  end if;

  if coalesce(public.my_role(), '') not in ('super_admin', 'admin', 'pharmacist', 'inventory', 'inventory_staff', 'billing_staff', 'billing') then
    raise exception 'Not authorised';
  end if;

  if p_flag is null then
    raise exception 'Quarantine flag is required';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required';
  end if;

  select *
    into v_batch
  from public.medicine_batches
  where id = p_batch
    and branch_id = v_branch
  for update;

  if not found then
    raise exception 'Batch not found in this branch';
  end if;

  update public.medicine_batches
  set quarantined = p_flag
  where id = v_batch.id
    and branch_id = v_branch;

  insert into public.audit_logs
    (branch_id, user_id, action, entity_type, entity_id,
     reason, before_data, after_data, at)
  values
    (v_branch, auth.uid(),
     case when p_flag then 'batch_quarantined' else 'batch_released' end,
     'medicine_batch', v_batch.id::text, trim(p_reason),
     jsonb_build_object('quarantined', v_batch.quarantined),
     jsonb_build_object('quarantined', p_flag), now());
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_batch_stock_status(p_batch uuid, p_status text, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE b public.medicine_batches%ROWTYPE; v_branch uuid := public.my_branch_id();
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin','pharmacist','inventory','inventory_staff', 'billing_staff', 'billing') THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_medicine_image(p_image uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_branch uuid;
  v_image record;
begin
  v_branch := public.my_branch_id();

  if auth.uid() is null or v_branch is null then
    raise exception 'Login and active branch required';
  end if;

  if public.my_role() not in ('super_admin','admin','pharmacist','inventory', 'inventory_staff', 'billing_staff', 'billing') then
    raise exception 'Not authorised';
  end if;

  select * into v_image
  from medicine_images
  where id = p_image
    and branch_id = v_branch
  for update;

  if not found then
    raise exception 'Image not found';
  end if;

  delete from medicine_images
  where id = p_image
    and branch_id = v_branch;

  if v_image.is_primary then
    update medicine_images
    set is_primary = true
    where id = (
      select id
      from medicine_images
      where medicine_id = v_image.medicine_id
        and branch_id = v_branch
      order by sort_order,created_at
      limit 1
    );
  end if;

  insert into audit_logs (
    branch_id,user_id,action,entity_type,entity_id,
    before_data,at
  )
  values (
    v_branch,auth.uid(),'medicine_image_deleted',
    'medicine_image',p_image::text,
    jsonb_build_object('path',v_image.path),
    now()
  );

  return v_image.path;
end;
$function$;

CREATE OR REPLACE FUNCTION public.register_medicine_image(p_medicine uuid, p_path text, p_name text, p_mime text, p_size bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  v_branch uuid;
  v_count integer;
  v_id uuid;
  v_object record;
begin
  v_branch := public.my_branch_id();

  if auth.uid() is null or v_branch is null then
    raise exception 'Login and active branch required';
  end if;

  if public.my_role() not in ('super_admin','admin','pharmacist','inventory', 'inventory_staff', 'billing_staff', 'billing') then
    raise exception 'Not authorised';
  end if;

  if p_mime not in ('image/jpeg','image/png','image/webp')
     or p_size is null or p_size <= 0
     or p_size > 5242880 then
    raise exception 'Invalid image type or size';
  end if;

  if split_part(p_path,'/',1) <> p_medicine::text then
    raise exception 'Invalid medicine image path';
  end if;

  if not exists (
    select 1 from medicines
    where id = p_medicine and branch_id = v_branch
  ) then
    raise exception 'Medicine not found in active branch';
  end if;

  select * into v_object
  from storage.objects
  where bucket_id = 'medicine-images'
    and name = p_path;

  if not found then
    raise exception 'Uploaded image not found';
  end if;

  if (v_object.metadata->>'size') is not null
     and (v_object.metadata->>'size')::bigint <> p_size then
    raise exception 'Image size mismatch';
  end if;

  if (v_object.metadata->>'mimetype') is not null
     and v_object.metadata->>'mimetype' <> p_mime then
    raise exception 'Image type mismatch';
  end if;

  select count(*) into v_count
  from medicine_images
  where medicine_id = p_medicine
    and branch_id = v_branch;

  if v_count >= 8 then
    raise exception 'Maximum 8 photos per medicine';
  end if;

  insert into medicine_images (
    branch_id, medicine_id, path, file_name,
    mime, size_bytes, is_primary, sort_order, uploaded_by
  )
  values (
    v_branch, p_medicine, p_path, left(p_name,200),
    p_mime, p_size, v_count = 0, v_count, auth.uid()
  )
  returning id into v_id;

  insert into audit_logs (
    branch_id,user_id,action,entity_type,entity_id,
    after_data,at
  )
  values (
    v_branch,auth.uid(),'medicine_image_added',
    'medicine_image',v_id::text,
    jsonb_build_object('medicine_id',p_medicine,'file_name',p_name),
    now()
  );

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_primary_image(p_image uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_branch uuid;
  v_medicine uuid;
begin
  v_branch := public.my_branch_id();

  if auth.uid() is null or v_branch is null then
    raise exception 'Login and active branch required';
  end if;

  if public.my_role() not in ('super_admin','admin','pharmacist','inventory', 'inventory_staff', 'billing_staff', 'billing') then
    raise exception 'Not authorised';
  end if;

  select medicine_id into v_medicine
  from medicine_images
  where id = p_image
    and branch_id = v_branch;

  if v_medicine is null then
    raise exception 'Image not found';
  end if;

  update medicine_images
  set is_primary = false
  where medicine_id = v_medicine
    and branch_id = v_branch;

  update medicine_images
  set is_primary = true
  where id = p_image
    and branch_id = v_branch;

  insert into audit_logs (
    branch_id,user_id,action,entity_type,entity_id,at
  )
  values (
    v_branch,auth.uid(),'medicine_image_primary',
    'medicine_image',p_image::text,now()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.stock_transfer(p_batch uuid, p_qty numeric, p_to_branch uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
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
  IF v_role NOT IN ('super_admin','admin','pharmacist','inventory_staff','inventory', 'billing_staff', 'billing') THEN RAISE EXCEPTION 'Not authorised to transfer stock'; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.stock_transfer_branches()
 RETURNS TABLE(id uuid, name text, code text, city text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT b.id, b.name, b.code, b.city
  FROM public.branches b
  JOIN public.branches mine ON mine.id = public.my_branch_id()
  WHERE b.pharmacy_id = mine.pharmacy_id
    AND b.id <> mine.id
    AND b.is_active
    AND auth.uid() IS NOT NULL
    AND COALESCE(public.my_role(), '') IN ('super_admin','admin','pharmacist','inventory_staff','inventory', 'billing_staff', 'billing')
  ORDER BY b.name;
$function$;

CREATE OR REPLACE FUNCTION public.inventory_batches(p_search text DEFAULT NULL::text)
 RETURNS TABLE(batch_id uuid, medicine_id uuid, name text, strength text, batch_no text, expiry date, qty numeric, quarantined boolean, location text, status text, cost_value numeric, reorder_level numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT b.id,m.id,m.name,m.strength,b.batch_no,b.expiry,b.qty,b.quarantined,
    concat_ws(' ',m.shelf_location,m.rack),
    CASE WHEN b.expiry<current_date THEN 'expired' WHEN b.quarantined THEN 'quarantined' ELSE 'ok' END,
    CASE WHEN public.my_role() IN ('super_admin','admin') THEN round(b.qty*coalesce(b.unit_cost,m.purchase_price,0),2) END,
    m.reorder_level
  FROM public.medicine_batches b JOIN public.medicines m ON m.id=b.medicine_id
  WHERE b.branch_id=public.my_branch_id()
    AND public.my_role() IN ('super_admin','admin','pharmacist','inventory', 'inventory_staff', 'billing_staff', 'billing')
    AND (p_search IS NULL OR m.name ILIKE '%'||p_search||'%' OR b.batch_no ILIKE '%'||p_search||'%' OR m.barcode=p_search)
  ORDER BY m.name,b.expiry LIMIT 1000;
$function$;

CREATE OR REPLACE FUNCTION public._billing_fefo_compute(p_branch uuid, p_medicine uuid, p_qty numeric, p_cart uuid, p_manual jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    v_def_disc := public.billing_medicine_discount_pct(m.discount_percentage, m.discount_amount, v_mrp, m.mrp, m.selling_price);

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
      'default_discount_pct', v_def_disc, 'discount_amount', CASE WHEN m.discount_percentage IS NULL THEN m.discount_amount END, 'shelf', COALESCE(nullif(m.rack, ''), m.shelf_location),
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
$function$;

CREATE OR REPLACE FUNCTION public.finalize_sale_v3(p_customer uuid, p_items jsonb, p_payments jsonb, p_discount numeric DEFAULT 0, p_cart uuid DEFAULT NULL::uuid, p_expected_total numeric DEFAULT NULL::numeric, p_patient jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Patient / prescription details (all optional, trimmed, length-limited).
  IF p_patient IS NOT NULL AND jsonb_typeof(p_patient) = 'object' THEN
    UPDATE public.sales_invoices SET
      doctor_name     = nullif(left(trim(p_patient->>'doctor_name'), 120), ''),
      patient_name    = nullif(left(trim(p_patient->>'patient_name'), 120), ''),
      patient_phone   = nullif(left(regexp_replace(COALESCE(p_patient->>'patient_phone', ''), '[^0-9+ ]', '', 'g'), 20), ''),
      patient_address = nullif(left(trim(p_patient->>'patient_address'), 300), ''),
      diagnosis       = nullif(left(trim(p_patient->>'diagnosis'), 500), '')
    WHERE id = inv;
  END IF;

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
    v_def_disc := public.billing_medicine_discount_pct(m.discount_percentage, m.discount_amount, v_def_mrp, m.mrp, m.selling_price);
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
    IF v_gst < 0 OR v_gst > 100 THEN
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
  VALUES (v_branch, auth.uid(), 'sale_finalized', 'sales_invoice', inv::text, 'POS sale completed (FEFO v3)', NULL,
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
$function$;

CREATE OR REPLACE FUNCTION public.sales_summary(p_from date, p_to date, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(sales numeric, orders integer, customers integer, walkins integer, discount numeric, tax numeric, returns numeric, return_count integer, cash numeric, upi numeric, card numeric, credit numeric, cancelled integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_branch uuid := public._sales_guard();
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Only administrators can see sales and return totals'; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.sales_daily(p_from date, p_to date)
 RETURNS TABLE(day date, sales numeric, orders integer, customers integer, returns numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_branch uuid := public._sales_guard();
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Only administrators can see sales and return totals'; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.sales_top_medicines(p_from date, p_to date, p_limit integer DEFAULT 10)
 RETURNS TABLE(medicine_id uuid, name text, strength text, qty numeric, sales numeric, bills integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_branch uuid := public._sales_guard();
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Only administrators can see sales and return totals'; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.returns_base_total(p_kind text, p_from date, p_to date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_branch uuid := public._returns_guard(p_kind); v numeric;
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Only administrators can see sales and return totals'; END IF;
  IF p_kind = 'sales' THEN
    SELECT COALESCE(sum(total), 0) INTO v FROM public.sales_invoices
    WHERE branch_id = v_branch AND status = 'final' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to;
  ELSE
    SELECT COALESCE(sum(total), 0) INTO v FROM public.purchase_invoices
    WHERE branch_id = v_branch AND COALESCE(status, 'confirmed') <> 'cancelled' AND invoice_date BETWEEN p_from AND p_to;
  END IF;
  RETURN round(v, 2);
END;
$function$;

CREATE OR REPLACE FUNCTION public.returns_top_medicines(p_kind text, p_from date, p_to date, p_limit integer DEFAULT 10)
 RETURNS TABLE(medicine_id uuid, name text, strength text, qty numeric, value numeric, returns integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_branch uuid := public._returns_guard(p_kind);
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Only administrators can see sales and return totals'; END IF;
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
$function$;

DROP POLICY IF EXISTS "categories_w" ON public.categories;
CREATE POLICY "categories_w" ON public.categories AS PERMISSIVE FOR ALL TO authenticated
  USING ((my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text])))
  WITH CHECK ((my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text])));

DROP POLICY IF EXISTS "manufacturers_w" ON public.manufacturers;
CREATE POLICY "manufacturers_w" ON public.manufacturers AS PERMISSIVE FOR ALL TO authenticated
  USING ((my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text])))
  WITH CHECK ((my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text])));

DROP POLICY IF EXISTS "d_w" ON public.distributors;
CREATE POLICY "d_w" ON public.distributors AS PERMISSIVE FOR ALL TO authenticated
  USING (((branch_id = my_branch_id()) AND (COALESCE(my_role(), ''::text) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text]))))
  WITH CHECK (((branch_id = my_branch_id()) AND (COALESCE(my_role(), ''::text) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text]))));

DROP POLICY IF EXISTS "alza_batch_write" ON public.medicine_batches;
CREATE POLICY "alza_batch_write" ON public.medicine_batches AS PERMISSIVE FOR ALL TO authenticated
  USING (((branch_id = my_branch_id()) AND (my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text]))))
  WITH CHECK (((branch_id = my_branch_id()) AND (my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text]))));

DROP POLICY IF EXISTS "alza_med_write" ON public.medicines;
CREATE POLICY "alza_med_write" ON public.medicines AS PERMISSIVE FOR ALL TO authenticated
  USING (((branch_id = my_branch_id()) AND (my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text]))))
  WITH CHECK (((branch_id = my_branch_id()) AND (my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text]))));

DROP POLICY IF EXISTS "held_bills_insert" ON public.held_bills;
CREATE POLICY "held_bills_insert" ON public.held_bills AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((branch_id = my_branch_id()) AND (created_by = auth.uid()) AND (COALESCE(my_role(), ''::text) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'billing'::text, 'billing_staff'::text, 'inventory_staff'::text, 'inventory'::text]))));

DROP POLICY IF EXISTS "sm_sel" ON public.stock_movements;
CREATE POLICY "sm_sel" ON public.stock_movements AS PERMISSIVE FOR SELECT TO authenticated
  USING (((branch_id = my_branch_id()) AND (my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text]))));

DROP POLICY IF EXISTS "units_w" ON public.units;
CREATE POLICY "units_w" ON public.units AS PERMISSIVE FOR ALL TO authenticated
  USING ((my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text])))
  WITH CHECK ((my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text])));

DROP POLICY IF EXISTS "storage_locations_w" ON public.storage_locations;
CREATE POLICY "storage_locations_w" ON public.storage_locations AS PERMISSIVE FOR ALL TO authenticated
  USING ((my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text])))
  WITH CHECK ((my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text])));

DROP POLICY IF EXISTS "unit_conversions_w" ON public.unit_conversions;
CREATE POLICY "unit_conversions_w" ON public.unit_conversions AS PERMISSIVE FOR ALL TO authenticated
  USING ((my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text])))
  WITH CHECK ((my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text, 'pharmacist'::text, 'inventory_staff'::text, 'billing_staff'::text, 'billing'::text, 'inventory'::text])));

INSERT INTO public.role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM public.roles r CROSS JOIN (VALUES ('customer.manage'), ('customer.view'), ('distributor.manage'), ('inventory.adjust'), ('inventory.view'), ('medicine.manage'), ('medicine.view'), ('sales.create'), ('sales.discount'), ('sales.return'), ('sales.view')) AS p(code)
WHERE r.code IN ('pharmacist', 'billing_staff', 'billing', 'inventory_staff', 'inventory') AND EXISTS (SELECT 1 FROM public.permissions x WHERE x.code = p.code)
ON CONFLICT DO NOTHING;
-- <<< staff-parity (generated) <<<
