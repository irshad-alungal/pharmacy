-- ============================================================================
-- 0021 · Completes the backend for every page and fixes defects found in the
--        live database (schema export of 2026-11-19).
--
-- Written against, and tested on, a replica of the LIVE structure. Run once in
-- Supabase → SQL Editor after taking a backup. Re-runnable (idempotent).
-- Nothing is dropped except functions that are replaced by a newer signature.
--
-- Part A  Role-code fixes (inventory_staff / billing_staff were locked out)
-- Part B  Billing permission codes
-- Part C  FIFO cost layers for opening stock / physical counts + backfill
-- Part D  Initial stock (Excel) upgrade           (was 0011, never applied)
-- Part E  Distributor logos                       (was 0012, never applied)
-- Part F  Customer doctor's sheets                (was 0013, never applied)
-- Part G  Patient / prescription details on bills + finalize_sale_v2
-- Part H  invoice_detail with correct GST for tax-exclusive lines
-- Part I  Purchases: drafts, pack factor, free qty, payment, detail, attachments
-- Part J  Reports (13 report_* functions + ist_today)
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- Part A · Role-code fixes
-- Staff Management creates `inventory_staff`, but 14 live functions and three
-- storage policies only accepted the retired `inventory` code; the held-bill
-- insert policy only accepted `billing`, not `billing_staff`. Patch the live
-- definitions in place (same bodies, wider role list).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  f record;
  v_def text;
  v_new text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ~ '''(super_admin|admin|pharmacist|billing|billing_staff)''\s*,\s*''inventory'''
  LOOP
    v_def := pg_get_functiondef(f.oid);
    -- Only inside role lists: 'inventory' directly after another role code
    -- (so labels such as entity_type 'inventory' are never touched), and only
    -- where 'inventory_staff' is not already listed.
    v_new := regexp_replace(v_def,
      '(''(?:super_admin|admin|pharmacist|billing|billing_staff)''\s*,\s*)''inventory''(?!\s*,\s*''inventory_staff'')',
      '\1''inventory'', ''inventory_staff''', 'g');
    IF v_new <> v_def THEN
      EXECUTE v_new;
      RAISE NOTICE 'Role list widened in %', f.proname;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  p record;
  v_using text;
  v_check text;
  v_sql text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE (schemaname = 'storage' AND tablename = 'objects' AND policyname IN ('mi_insert', 'mi_delete', 'pd_insert'))
       OR (schemaname = 'public' AND tablename = 'held_bills' AND policyname = 'held_bills_insert')
  LOOP
    v_using := p.qual;
    v_check := p.with_check;
    IF p.tablename = 'held_bills' THEN
      v_check := regexp_replace(v_check, '''billing''::text(?!\s*,\s*''billing_staff'')', '''billing''::text, ''billing_staff''::text', 'g');
    ELSE
      v_using := regexp_replace(v_using, '''inventory''::text(?!\s*,\s*''inventory_staff'')', '''inventory''::text, ''inventory_staff''::text', 'g');
      v_check := regexp_replace(v_check, '''inventory''::text(?!\s*,\s*''inventory_staff'')', '''inventory''::text, ''inventory_staff''::text', 'g');
    END IF;
    v_sql := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF v_using IS NOT NULL THEN v_sql := v_sql || ' USING (' || v_using || ')'; END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || v_check || ')'; END IF;
    EXECUTE v_sql;
  END LOOP;
END $$;

-- Pharmacists and inventory staff upload purchase bills too; let them read
-- the documents of their own branch (previously admin-only).
DO $$
DECLARE v_q text;
BEGIN
  SELECT qual INTO v_q FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'pd_select';
  IF v_q IS NOT NULL AND v_q !~ 'inventory_staff' THEN
    EXECUTE 'ALTER POLICY pd_select ON storage.objects USING (' ||
      regexp_replace(v_q, '''admin''::text\]', '''admin''::text, ''pharmacist''::text, ''inventory_staff''::text, ''inventory''::text]') || ')';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Part B · Billing permission codes (0020 tried without the required module)
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (code, module, description) VALUES
  ('sales.gst_edit',       'sales', 'Billing: change GST rate on a bill line'),
  ('sales.mrp_edit',       'sales', 'Billing: change MRP on a bill line (never above printed MRP)'),
  ('sales.batch_override', 'sales', 'Billing: manually choose batches instead of FEFO')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Part C · FIFO cost layers
-- sales_items_guard() refuses a sale unless FIFO cost layers cover it, but
-- opening stock and physical counts never created layers, so that stock could
-- not be billed. A trigger now keeps layers in step for those movements, and
-- a one-time backfill covers stock that is already on the shelf.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fifo_sync_untracked_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch public.medicine_batches%ROWTYPE;
  v_layer record;
  v_needed numeric;
  v_take numeric;
  v_cost numeric;
BEGIN
  -- Only movements that no other routine layers itself.
  IF NOT (NEW.movement_type IN ('opening_stock', 'physical_count')
          OR COALESCE(NEW.ref_type, '') = 'opening_stock_batch_edit') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_batch FROM public.medicine_batches WHERE id = NEW.batch_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.qty > 0 THEN
    SELECT COALESCE(v_batch.unit_cost, m.purchase_price) INTO v_cost
    FROM public.medicines m WHERE m.id = v_batch.medicine_id;
    INSERT INTO public.inventory_cost_layers
      (branch_id, medicine_id, batch_id, layer_type, received_qty, remaining_qty, unit_cost, received_at, source_movement_id)
    VALUES
      (NEW.branch_id, NEW.medicine_id, NEW.batch_id,
       CASE WHEN NEW.movement_type = 'opening_stock' THEN 'opening_stock' ELSE 'adjustment' END,
       NEW.qty, NEW.qty, v_cost, now(), NEW.id);
  ELSIF NEW.qty < 0 THEN
    v_needed := abs(NEW.qty);
    FOR v_layer IN
      SELECT id, remaining_qty, unit_cost FROM public.inventory_cost_layers
      WHERE batch_id = NEW.batch_id AND remaining_qty > 0
      ORDER BY received_at, created_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_needed <= 0;
      v_take := least(v_needed, v_layer.remaining_qty);
      UPDATE public.inventory_cost_layers SET remaining_qty = remaining_qty - v_take WHERE id = v_layer.id;
      INSERT INTO public.inventory_adjustment_allocations
        (branch_id, movement_id, cost_layer_id, allocation_action, qty, unit_cost)
      VALUES (NEW.branch_id, NEW.id, v_layer.id, 'consume', v_take, v_layer.unit_cost);
      v_needed := v_needed - v_take;
    END LOOP;
    -- Layers already short (legacy data): nothing left to consume; do not block the count.
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fifo_sync_untracked_movement() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stock_movements_fifo_sync_trg ON public.stock_movements;
CREATE TRIGGER stock_movements_fifo_sync_trg
AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.fifo_sync_untracked_movement();

-- Backfill: every batch whose on-hand quantity exceeds its open cost layers
-- gets one layer for the gap, dated at the batch's creation so it is used first.
INSERT INTO public.inventory_cost_layers
  (branch_id, medicine_id, batch_id, layer_type, received_qty, remaining_qty, unit_cost, received_at)
SELECT b.branch_id, b.medicine_id, b.id,
       CASE WHEN EXISTS (SELECT 1 FROM public.stock_movements sm
                         WHERE sm.batch_id = b.id AND sm.movement_type = 'opening_stock')
            THEN 'opening_stock' ELSE 'legacy_unresolved' END,
       b.qty - COALESCE(l.open_qty, 0),
       b.qty - COALESCE(l.open_qty, 0),
       COALESCE(b.unit_cost, m.purchase_price),
       b.created_at
FROM public.medicine_batches b
JOIN public.medicines m ON m.id = b.medicine_id
LEFT JOIN (SELECT batch_id, sum(remaining_qty) AS open_qty
           FROM public.inventory_cost_layers GROUP BY batch_id) l ON l.batch_id = b.id
WHERE b.qty > COALESCE(l.open_qty, 0);

-- ---------------------------------------------------------------------------
-- Part D · Initial stock Excel upgrade (from 0011, unchanged logic, plus batch
-- MRP/GST so billing uses the imported per-unit MRP).
-- ---------------------------------------------------------------------------
ALTER TABLE public.opening_stock_items
  ADD COLUMN IF NOT EXISTS serial_no text,
  ADD COLUMN IF NOT EXISTS pack_size numeric(14,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pack_qty numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS srate numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prate numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS urate numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.medicine_batches(id);

ALTER TABLE public.medicine_batches
  ADD COLUMN IF NOT EXISTS pack_size numeric(14,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pack_qty numeric(14,3) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'opening_stock_items_pack_check') THEN
    ALTER TABLE public.opening_stock_items ADD CONSTRAINT opening_stock_items_pack_check
      CHECK (pack_size > 0 AND pack_qty >= 0 AND srate >= 0 AND prate >= 0 AND urate >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'medicine_batches_pack_check') THEN
    ALTER TABLE public.medicine_batches ADD CONSTRAINT medicine_batches_pack_check
      CHECK (pack_size > 0 AND pack_qty >= 0);
  END IF;
END $$;

-- medicine_batches has explicit column grants; expose the new columns for reading.
GRANT SELECT (pack_size, pack_qty) ON public.medicine_batches TO authenticated;

UPDATE public.opening_stock_items
SET pack_size = 1, pack_qty = qty, srate = mrp, prate = unit_cost, urate = mrp
WHERE pack_qty = 0;

UPDATE public.opening_stock_items oi
SET batch_id = mb.id
FROM public.medicine_batches mb
WHERE oi.batch_id IS NULL AND mb.branch_id = oi.branch_id
  AND mb.medicine_id = oi.medicine_id AND mb.batch_no = oi.batch_no;

UPDATE public.medicine_batches SET pack_qty = qty WHERE pack_qty = 0;

CREATE OR REPLACE FUNCTION public.opening_stock_get_draft()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_session public.opening_stock_sessions%rowtype;
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;

  SELECT * INTO v_session FROM public.opening_stock_sessions WHERE branch_id = v_branch;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'medicine_id',i.medicine_id,'medicine_name',m.name,'strength',m.strength,
    'batch_no',i.batch_no,'expiry',i.expiry,'qty',i.qty,'unit_cost',i.unit_cost,
    'mrp',i.mrp,'selling_price',i.selling_price,
    'serial_no',i.serial_no,'pack_size',i.pack_size,'pack_qty',i.pack_qty,
    'srate',i.srate,'prate',i.prate,'urate',i.urate,'batch_id',i.batch_id
  ) ORDER BY i.serial_no NULLS LAST, m.name, i.batch_no), '[]'::jsonb)
  INTO v_items
  FROM public.opening_stock_items i
  JOIN public.medicines m ON m.id = i.medicine_id
  WHERE i.session_id = v_session.id AND i.branch_id = v_branch;

  RETURN jsonb_build_object('id',v_session.id,'status',v_session.status,'notes',v_session.notes,
    'created_at',v_session.created_at,'updated_at',v_session.updated_at,
    'submitted_at',v_session.submitted_at,'items',v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.opening_stock_save_draft(p_items jsonb, p_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_session public.opening_stock_sessions%rowtype;
  x jsonb;
  v_med uuid;
  v_pack numeric; v_pack_qty numeric; v_total numeric;
  v_prate numeric; v_srate numeric; v_urate numeric;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Add at least one stock batch'; END IF;
  IF jsonb_array_length(p_items) > 2000 THEN RAISE EXCEPTION 'Maximum 2,000 batch rows per draft'; END IF;

  INSERT INTO public.opening_stock_sessions(branch_id,status,notes,created_by,updated_by)
  VALUES (v_branch,'draft',nullif(trim(p_notes),''),auth.uid(),auth.uid())
  ON CONFLICT (branch_id) DO NOTHING;
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
    IF v_pack <= 0 OR v_pack_qty <= 0 OR v_total <= 0 OR abs(v_total - (v_pack * v_pack_qty)) > 0.01
      OR coalesce(trim(x->>'batch_no'),'') = '' OR nullif(x->>'expiry','') IS NULL
      OR v_srate < 0 OR v_prate < 0 OR v_urate < 0 OR abs(v_urate - (v_srate / v_pack)) > 0.02 THEN
      RAISE EXCEPTION 'Invalid stock row: verify batch, expiry, pack, quantity and rates';
    END IF;
    INSERT INTO public.opening_stock_items(
      session_id,branch_id,medicine_id,batch_no,expiry,qty,unit_cost,mrp,selling_price,
      serial_no,pack_size,pack_qty,srate,prate,urate)
    VALUES (v_session.id,v_branch,v_med,trim(x->>'batch_no'),(x->>'expiry')::date,
      v_total,round(v_prate/v_pack,4),round(v_urate,2),round(v_urate,2),
      nullif(x->>'serial_no',''),v_pack,v_pack_qty,v_srate,v_prate,v_urate);
  END LOOP;

  UPDATE public.opening_stock_sessions
  SET notes = nullif(trim(p_notes),''), updated_by = auth.uid(), updated_at = now()
  WHERE id = v_session.id;
  RETURN v_session.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.opening_stock_submit()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_session public.opening_stock_sessions%rowtype;
  i public.opening_stock_items%rowtype;
  v_batch uuid;
  v_count integer := 0;
  v_value numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  SELECT * INTO v_session FROM public.opening_stock_sessions WHERE branch_id = v_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No saved opening-stock draft'; END IF;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'Opening stock has already been submitted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opening_stock_items WHERE session_id = v_session.id) THEN RAISE EXCEPTION 'Draft is empty'; END IF;
  IF EXISTS (SELECT 1 FROM public.opening_stock_items WHERE session_id = v_session.id GROUP BY medicine_id HAVING count(DISTINCT (mrp,selling_price)) > 1) THEN
    RAISE EXCEPTION 'A medicine has inconsistent per-unit MRP across batches.';
  END IF;

  FOR i IN SELECT * FROM public.opening_stock_items WHERE session_id = v_session.id AND branch_id = v_branch ORDER BY id LOOP
    IF EXISTS (SELECT 1 FROM public.medicine_batches b WHERE b.medicine_id = i.medicine_id AND b.batch_no = i.batch_no) THEN
      RAISE EXCEPTION 'Batch % already exists for this medicine. Resolve the duplicate before submitting.', i.batch_no;
    END IF;
    INSERT INTO public.medicine_batches(branch_id,medicine_id,batch_no,expiry,qty,quarantined,unit_cost,pack_size,pack_qty,mrp)
    VALUES (v_branch,i.medicine_id,i.batch_no,i.expiry,i.qty,(i.expiry <= current_date),i.unit_cost,i.pack_size,i.pack_qty,round(i.urate,2))
    RETURNING id INTO v_batch;

    UPDATE public.opening_stock_items SET batch_id = v_batch WHERE id = i.id;

    -- stock_movements_fifo_sync_trg creates the matching opening_stock cost layer.
    INSERT INTO public.stock_movements(branch_id,medicine_id,batch_id,movement_type,qty,ref_type,ref_id,created_by,reason)
    VALUES (v_branch,i.medicine_id,v_batch,'opening_stock',i.qty,'opening_stock',v_session.id,auth.uid(),
      CASE WHEN i.expiry <= current_date THEN 'Takeover opening stock; expired batch quarantined' ELSE 'Pharmacy takeover opening stock' END);

    UPDATE public.medicines SET mrp = i.urate, selling_price = i.urate, purchase_price = i.unit_cost
    WHERE id = i.medicine_id AND branch_id = v_branch;
    v_count := v_count + 1;
    v_value := v_value + (i.qty * i.unit_cost);
  END LOOP;

  UPDATE public.opening_stock_sessions
  SET status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), updated_at = now(), updated_by = auth.uid()
  WHERE id = v_session.id;

  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  VALUES (v_branch,auth.uid(),'opening_stock_submitted','opening_stock_session',v_session.id::text,
    'Initial takeover stock posted',jsonb_build_object('status','draft'),
    jsonb_build_object('status','submitted','batch_count',v_count,'stock_value',round(v_value,2)),now());
  RETURN v_session.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.opening_stock_edit_submitted_batch(
  p_batch uuid, p_batch_no text, p_expiry date, p_pack_size numeric,
  p_pack_qty numeric, p_srate numeric, p_prate numeric, p_urate numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  b public.medicine_batches%rowtype;
  v_old jsonb;
  v_new_qty numeric;
  v_delta numeric;
  v_item_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  IF coalesce(trim(p_batch_no),'') = '' OR p_expiry IS NULL OR p_pack_size <= 0 OR p_pack_qty <= 0
    OR p_srate < 0 OR p_prate < 0 OR p_urate < 0 OR abs(p_urate - (p_srate / p_pack_size)) > 0.02 THEN
    RAISE EXCEPTION 'Invalid batch details';
  END IF;

  SELECT mb.* INTO b
  FROM public.medicine_batches mb
  JOIN public.opening_stock_items oi ON oi.batch_id = mb.id
  JOIN public.opening_stock_sessions os ON os.id = oi.session_id
  WHERE mb.id = p_batch AND mb.branch_id = v_branch AND os.branch_id = v_branch AND os.status = 'submitted'
  FOR UPDATE OF mb;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submitted opening-stock batch not found in this branch'; END IF;

  v_new_qty := p_pack_size * p_pack_qty;
  IF EXISTS (SELECT 1 FROM public.medicine_batches x WHERE x.medicine_id = b.medicine_id
             AND lower(x.batch_no) = lower(trim(p_batch_no)) AND x.id <> b.id) THEN
    RAISE EXCEPTION 'Another batch already uses this batch number for the medicine';
  END IF;
  IF v_new_qty <> b.qty AND EXISTS (SELECT 1 FROM public.stock_movements sm
                                    WHERE sm.batch_id = b.id AND sm.movement_type <> 'opening_stock') THEN
    RAISE EXCEPTION 'Quantity cannot be changed after this batch has other stock movements. Edit only batch, expiry and rates, or reconcile movements first.';
  END IF;

  SELECT id INTO v_item_id FROM public.opening_stock_items WHERE batch_id = b.id LIMIT 1;
  v_old := jsonb_build_object('batch_no',b.batch_no,'expiry',b.expiry,'qty',b.qty,'unit_cost',b.unit_cost,
    'pack_size',b.pack_size,'pack_qty',b.pack_qty);
  v_delta := v_new_qty - b.qty;

  UPDATE public.medicine_batches
  SET batch_no = trim(p_batch_no), expiry = p_expiry, qty = v_new_qty, unit_cost = round(p_prate/p_pack_size,4),
      pack_size = p_pack_size, pack_qty = p_pack_qty, quarantined = (p_expiry <= current_date), mrp = round(p_urate,2)
  WHERE id = b.id;

  -- Cost of untouched opening layers follows the corrected purchase rate.
  UPDATE public.inventory_cost_layers SET unit_cost = round(p_prate/p_pack_size,6)
  WHERE batch_id = b.id AND layer_type = 'opening_stock' AND remaining_qty = received_qty;

  UPDATE public.opening_stock_items
  SET batch_no = trim(p_batch_no), expiry = p_expiry, qty = v_new_qty, unit_cost = round(p_prate/p_pack_size,4),
      mrp = round(p_urate,2), selling_price = round(p_urate,2), pack_size = p_pack_size, pack_qty = p_pack_qty,
      srate = p_srate, prate = p_prate, urate = p_urate
  WHERE id = v_item_id;

  IF v_delta <> 0 THEN
    -- stock_movements_fifo_sync_trg adds/consumes the cost layer for the difference.
    INSERT INTO public.stock_movements(branch_id,medicine_id,batch_id,movement_type,qty,ref_type,ref_id,created_by,reason)
    VALUES (v_branch,b.medicine_id,b.id,'adjustment',v_delta,'opening_stock_batch_edit',v_item_id,auth.uid(),
      'Opening-stock batch quantity corrected');
  END IF;

  UPDATE public.medicines SET mrp = round(p_urate,2), selling_price = round(p_urate,2),
    purchase_price = round(p_prate/p_pack_size,4)
  WHERE id = b.medicine_id AND branch_id = v_branch;

  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  VALUES (v_branch,auth.uid(),'opening_stock_batch_edited','medicine_batch',b.id::text,
    'Submitted opening-stock batch corrected',v_old,
    jsonb_build_object('batch_no',trim(p_batch_no),'expiry',p_expiry,'qty',v_new_qty,
      'pack_size',p_pack_size,'pack_qty',p_pack_qty,'srate',p_srate,'prate',p_prate,'urate',p_urate),now());
END;
$$;
REVOKE ALL ON FUNCTION public.opening_stock_edit_submitted_batch(uuid,text,date,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opening_stock_edit_submitted_batch(uuid,text,date,numeric,numeric,numeric,numeric,numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- Part E · Distributor logos (from 0012)
-- ---------------------------------------------------------------------------
ALTER TABLE public.distributors ADD COLUMN IF NOT EXISTS logo_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('distributor-logos', 'distributor-logos', true, 2097152, ARRAY['image/png','image/jpeg','image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS distributor_logos_public_read ON storage.objects;
CREATE POLICY distributor_logos_public_read ON storage.objects FOR SELECT
  USING (bucket_id = 'distributor-logos');

DROP POLICY IF EXISTS distributor_logos_branch_insert ON storage.objects;
CREATE POLICY distributor_logos_branch_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'distributor-logos'
    AND (storage.foldername(name))[1] = public.my_branch_id()::text
    AND COALESCE(public.my_role(), '') IN ('super_admin','admin','pharmacist','inventory_staff','inventory'));

DROP POLICY IF EXISTS distributor_logos_branch_update ON storage.objects;
CREATE POLICY distributor_logos_branch_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'distributor-logos'
    AND (storage.foldername(name))[1] = public.my_branch_id()::text
    AND COALESCE(public.my_role(), '') IN ('super_admin','admin','pharmacist','inventory_staff','inventory'))
  WITH CHECK (bucket_id = 'distributor-logos'
    AND (storage.foldername(name))[1] = public.my_branch_id()::text);

DROP POLICY IF EXISTS distributor_logos_branch_delete ON storage.objects;
CREATE POLICY distributor_logos_branch_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'distributor-logos'
    AND (storage.foldername(name))[1] = public.my_branch_id()::text
    AND COALESCE(public.my_role(), '') IN ('super_admin','admin','pharmacist','inventory_staff','inventory'));

-- ---------------------------------------------------------------------------
-- Part F · Customer doctor's sheets (from 0013)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_doctor_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.sales_invoices(id) ON DELETE RESTRICT,
  file_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 15728640),
  storage_path text NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_doctor_sheets_invoice_idx
  ON public.customer_doctor_sheets(branch_id, invoice_id, created_at DESC);
ALTER TABLE public.customer_doctor_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_doctor_sheets_select ON public.customer_doctor_sheets;
CREATE POLICY customer_doctor_sheets_select ON public.customer_doctor_sheets FOR SELECT TO authenticated
  USING (branch_id = public.my_branch_id());

DROP POLICY IF EXISTS customer_doctor_sheets_insert ON public.customer_doctor_sheets;
CREATE POLICY customer_doctor_sheets_insert ON public.customer_doctor_sheets FOR INSERT TO authenticated
  WITH CHECK (branch_id = public.my_branch_id() AND uploaded_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.sales_invoices si
                WHERE si.id = customer_doctor_sheets.invoice_id
                  AND si.customer_id = customer_doctor_sheets.customer_id
                  AND si.branch_id = customer_doctor_sheets.branch_id));

REVOKE ALL ON public.customer_doctor_sheets FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.customer_doctor_sheets TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('customer-doctor-sheets', 'customer-doctor-sheets', false, 15728640,
        ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS customer_doctor_sheets_storage_select ON storage.objects;
CREATE POLICY customer_doctor_sheets_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'customer-doctor-sheets'
    AND (storage.foldername(name))[1] = public.my_branch_id()::text
    AND EXISTS (SELECT 1 FROM public.customer_doctor_sheets d
                WHERE d.storage_path = objects.name AND d.branch_id = public.my_branch_id()));

DROP POLICY IF EXISTS customer_doctor_sheets_storage_insert ON storage.objects;
CREATE POLICY customer_doctor_sheets_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'customer-doctor-sheets'
    AND (storage.foldername(name))[1] = public.my_branch_id()::text
    AND EXISTS (SELECT 1 FROM public.sales_invoices si
                WHERE si.id::text = (storage.foldername(objects.name))[2]
                  AND si.branch_id = public.my_branch_id()
                  AND si.customer_id IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Part G · Patient / prescription details saved on the bill
-- finalize_sale_v3 = finalize_sale_v2 + optional p_patient. v2 is kept as is.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_invoices
  ADD COLUMN IF NOT EXISTS doctor_name text,
  ADD COLUMN IF NOT EXISTS patient_name text,
  ADD COLUMN IF NOT EXISTS patient_phone text,
  ADD COLUMN IF NOT EXISTS patient_address text,
  ADD COLUMN IF NOT EXISTS diagnosis text;

CREATE OR REPLACE FUNCTION public.finalize_sale_v3(
  p_customer uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount numeric DEFAULT 0,
  p_cart uuid DEFAULT NULL,
  p_expected_total numeric DEFAULT NULL,
  p_patient jsonb DEFAULT NULL
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
$$;
REVOKE ALL ON FUNCTION public.finalize_sale_v3(uuid, jsonb, jsonb, numeric, uuid, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_sale_v3(uuid, jsonb, jsonb, numeric, uuid, numeric, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Part H · invoice_detail: same output as before, plus line discount, MRP,
-- patient details, and a GST summary that is correct for tax-exclusive lines
-- (uses the stored taxable/GST amounts; legacy lines keep the old formula).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_detail(p_invoice uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
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
  IF v_role NOT IN ('super_admin','admin','pharmacist','billing_staff','billing') THEN RAISE EXCEPTION 'Not authorised'; END IF;
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
$$;

-- ---------------------------------------------------------------------------
-- Part I · Purchases
-- * purchase_drafts: save an unfinished supplier bill (no stock change).
-- * confirm_purchase_v2: pack factor, free quantity, batch MRP/GST, due date,
--   round-off, optional supplier payment (admins) — all in one transaction.
-- * purchase_detail: lines, payments and documents of one purchase.
-- confirm_purchase() (v1) is unchanged except its role list (Part A).
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS order_no text,
  ADD COLUMN IF NOT EXISTS order_date date,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS round_off numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS printed_total numeric;

ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS mrp numeric,
  ADD COLUMN IF NOT EXISTS hsn text,
  ADD COLUMN IF NOT EXISTS rate_mode text;

CREATE TABLE IF NOT EXISTS public.purchase_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  distributor_id uuid REFERENCES public.distributors(id),
  supplier_invoice_no text,
  invoice_date date,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_drafts_branch_idx ON public.purchase_drafts(branch_id, updated_at DESC);
ALTER TABLE public.purchase_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_drafts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._purchase_assert_writer()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF NOT COALESCE(app.session_ok(), false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin','pharmacist','inventory_staff','inventory') THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  RETURN v_branch;
END;
$$;
REVOKE ALL ON FUNCTION public._purchase_assert_writer() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purchase_draft_save(p_id uuid, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._purchase_assert_writer(); v_id uuid;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'Invalid draft'; END IF;
  IF octet_length(p_payload::text) > 1000000 THEN RAISE EXCEPTION 'Draft is too large'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.purchase_drafts (branch_id, distributor_id, supplier_invoice_no, invoice_date, payload, created_by, updated_by)
    VALUES (v_branch, nullif(p_payload->>'distributor_id','')::uuid, nullif(trim(p_payload->>'invoice_no'),''),
            nullif(p_payload->>'invoice_date','')::date, p_payload, auth.uid(), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.purchase_drafts SET
      distributor_id = nullif(p_payload->>'distributor_id','')::uuid,
      supplier_invoice_no = nullif(trim(p_payload->>'invoice_no'),''),
      invoice_date = nullif(p_payload->>'invoice_date','')::date,
      payload = p_payload, updated_by = auth.uid(), updated_at = now()
    WHERE id = p_id AND branch_id = v_branch
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Draft not found in this branch'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_draft_list()
RETURNS TABLE (id uuid, distributor text, supplier_invoice_no text, invoice_date date, item_count integer,
               updated_at timestamptz, updated_by_name text, payload jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._purchase_assert_writer();
BEGIN
  RETURN QUERY
  SELECT d.id, dist.name, d.supplier_invoice_no, d.invoice_date,
         COALESCE(jsonb_array_length(d.payload->'items'), 0), d.updated_at, p.full_name, d.payload
  FROM public.purchase_drafts d
  LEFT JOIN public.distributors dist ON dist.id = d.distributor_id
  LEFT JOIN public.profiles p ON p.id = COALESCE(d.updated_by, d.created_by)
  WHERE d.branch_id = v_branch
  ORDER BY d.updated_at DESC
  LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_draft_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._purchase_assert_writer();
BEGIN
  DELETE FROM public.purchase_drafts WHERE id = p_id AND branch_id = v_branch;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_invoice_exists(p_distributor uuid, p_invoice_no text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.id FROM public.purchase_invoices i
  WHERE i.branch_id = public.my_branch_id() AND i.distributor_id = p_distributor
    AND lower(trim(i.supplier_invoice_no)) = lower(trim(p_invoice_no))
    AND COALESCE(public.my_role(), '') IN ('super_admin','admin','pharmacist','inventory_staff','inventory')
  LIMIT 1;
$$;

-- p_header: {distributor_id, invoice_no, invoice_date, due_date, order_no, order_date, payment_terms,
--            discount, freight, round_off, printed_total, notes}
-- p_items:  [{medicine_id, batch_no, expiry, qty (packs), free_qty (packs), pack (units per pack),
--             price (per pack, excl. GST), tax_rate, discount (excl. GST), mrp (per pack), hsn, rate_mode}]
-- p_payment: {amount, method (cash|upi), reference}   (admins only; optional)
CREATE OR REPLACE FUNCTION public.confirm_purchase_v2(
  p_header jsonb, p_items jsonb, p_payment jsonb DEFAULT NULL, p_draft uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._purchase_assert_writer();
  it jsonb;
  m public.medicines%ROWTYPE;
  b public.medicine_batches%ROWTYPE;
  inv uuid; bid uuid; pid uuid;
  v_dist uuid := nullif(p_header->>'distributor_id','')::uuid;
  v_no text := trim(COALESCE(p_header->>'invoice_no',''));
  v_date date := COALESCE(nullif(p_header->>'invoice_date','')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_disc numeric := round(COALESCE(nullif(p_header->>'discount','')::numeric, 0), 2);
  v_freight numeric := round(COALESCE(nullif(p_header->>'freight','')::numeric, 0), 2);
  v_round numeric := round(COALESCE(nullif(p_header->>'round_off','')::numeric, 0), 2);
  q numeric; fq numeric; pk numeric; pr numeric; tr numeric; ld numeric; net numeric; v_mrp numeric;
  bn text; ex date;
  sub numeric := 0; tx numeric := 0; tot numeric;
  v_pay numeric; v_lines int := 0;
BEGIN
  IF v_dist IS NULL OR NOT EXISTS (SELECT 1 FROM public.distributors WHERE id = v_dist AND branch_id = v_branch AND active) THEN
    RAISE EXCEPTION 'Distributor missing or inactive in this branch';
  END IF;
  IF v_no = '' THEN RAISE EXCEPTION 'Supplier invoice number required'; END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_invoices WHERE branch_id = v_branch AND distributor_id = v_dist
             AND lower(trim(supplier_invoice_no)) = lower(v_no)) THEN
    RAISE EXCEPTION 'Supplier invoice % from this distributor is already posted', v_no;
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'No purchase items'; END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'Too many purchase lines'; END IF;
  IF v_disc < 0 OR v_freight < 0 THEN RAISE EXCEPTION 'Discount and freight cannot be negative'; END IF;
  IF abs(v_round) > 100 THEN RAISE EXCEPTION 'Round off must be within ±100'; END IF;

  INSERT INTO public.purchase_invoices (branch_id, distributor_id, supplier_invoice_no, invoice_date, discount, freight,
    notes, created_by, due_date, order_no, order_date, payment_terms, round_off, printed_total)
  VALUES (v_branch, v_dist, v_no, v_date, v_disc, v_freight, nullif(trim(p_header->>'notes'),''), auth.uid(),
    nullif(p_header->>'due_date','')::date, nullif(trim(p_header->>'order_no'),''), nullif(p_header->>'order_date','')::date,
    nullif(p_header->>'payment_terms',''), v_round, nullif(p_header->>'printed_total','')::numeric)
  RETURNING id INTO inv;

  FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO m FROM public.medicines WHERE id = nullif(it->>'medicine_id','')::uuid AND branch_id = v_branch AND active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Medicine not found or inactive in this branch'; END IF;

    q  := COALESCE(nullif(it->>'qty','')::numeric, 0);
    fq := COALESCE(nullif(it->>'free_qty','')::numeric, 0);
    pk := COALESCE(nullif(it->>'pack','')::numeric, 1);
    pr := nullif(it->>'price','')::numeric;
    tr := nullif(it->>'tax_rate','')::numeric;
    ld := COALESCE(nullif(it->>'discount','')::numeric, 0);
    v_mrp := nullif(it->>'mrp','')::numeric;
    bn := trim(COALESCE(it->>'batch_no',''));
    ex := nullif(it->>'expiry','')::date;

    IF bn = '' THEN RAISE EXCEPTION 'Batch number required for %', m.name; END IF;
    IF q <= 0 OR fq < 0 OR pk <= 0 OR pk <> trunc(pk) OR pr IS NULL OR pr < 0 OR tr IS NULL OR tr < 0 OR tr > 40 OR ld < 0
       OR (v_mrp IS NOT NULL AND v_mrp < 0) THEN
      RAISE EXCEPTION 'Invalid quantity, pack, price, tax or discount for %', m.name;
    END IF;
    IF ex IS NULL OR ex <= (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
      RAISE EXCEPTION 'Batch % of % is expired or has no expiry', bn, m.name;
    END IF;

    net := round(q * pr - ld, 2);
    IF net < 0 THEN RAISE EXCEPTION 'Line discount exceeds line amount for %', m.name; END IF;
    sub := sub + net;
    tx := tx + round(net * tr / 100, 2);

    SELECT * INTO b FROM public.medicine_batches WHERE branch_id = v_branch AND medicine_id = m.id AND batch_no = bn FOR UPDATE;
    IF FOUND THEN
      IF b.expiry <> ex THEN RAISE EXCEPTION 'Batch % of % already exists with a different expiry (%)', bn, m.name, b.expiry; END IF;
      UPDATE public.medicine_batches SET
        qty = qty + (q + fq) * pk,
        mrp = COALESCE(round(v_mrp / pk, 2), mrp),
        tax_rate = tr,
        unit_cost = round(net / (q * pk), 4),
        pack_size = pk
      WHERE id = b.id;
      bid := b.id;
    ELSE
      INSERT INTO public.medicine_batches (branch_id, medicine_id, batch_no, expiry, qty, quarantined, unit_cost, mrp, tax_rate, pack_size, pack_qty)
      VALUES (v_branch, m.id, bn, ex, (q + fq) * pk, false, round(net / (q * pk), 4), round(v_mrp / pk, 2), tr, pk, q + fq)
      RETURNING id INTO bid;
    END IF;

    -- fifo_create_purchase_layer (trigger) creates the paid cost layer for base_qty.
    INSERT INTO public.purchase_items (branch_id, invoice_id, medicine_id, batch_id, qty, unit_id, unit_factor, base_qty,
      unit_price, tax_rate, line_discount, line_net, free_qty, free_base_qty, mrp, hsn, rate_mode)
    VALUES (v_branch, inv, m.id, bid, q, NULL, pk, q * pk, pr, tr, ld, net,
      CASE WHEN fq > 0 THEN fq END, CASE WHEN fq > 0 THEN fq * pk END, v_mrp,
      nullif(trim(it->>'hsn'),''), nullif(it->>'rate_mode',''))
    RETURNING id INTO pid;

    IF fq > 0 THEN
      INSERT INTO public.inventory_cost_layers (branch_id, medicine_id, batch_id, purchase_item_id, layer_type,
        received_qty, remaining_qty, unit_cost, received_at)
      VALUES (v_branch, m.id, bid, pid, 'free', fq * pk, fq * pk, 0, now());
    END IF;

    INSERT INTO public.stock_movements (branch_id, medicine_id, batch_id, movement_type, qty, ref_type, ref_id, created_by, reason)
    VALUES (v_branch, m.id, bid, 'purchase_in', (q + fq) * pk, 'purchase_invoice', inv, auth.uid(),
      CASE WHEN fq > 0 THEN format('Purchase incl. %s free', fq * pk) ELSE 'Purchase' END);

    UPDATE public.medicines SET
      purchase_price = round(pr / pk, 2),
      -- New medicines created from the purchase screen start with MRP 0: take it from the bill.
      mrp = CASE WHEN mrp = 0 AND v_mrp > 0 THEN round(v_mrp / pk, 2) ELSE mrp END,
      selling_price = CASE WHEN mrp = 0 AND v_mrp > 0 THEN round(v_mrp / pk, 2) ELSE selling_price END,
      tax_rate = CASE WHEN mrp = 0 THEN tr ELSE tax_rate END
    WHERE id = m.id AND branch_id = v_branch;
    v_lines := v_lines + 1;
  END LOOP;

  tot := round(sub + tx - v_disc + v_freight + v_round, 2);
  IF tot < 0 THEN RAISE EXCEPTION 'Discount exceeds invoice total'; END IF;

  -- finance_purchase_invoice_trg posts the purchase journal on this update.
  UPDATE public.purchase_invoices SET subtotal = sub, tax = tx, total = tot WHERE id = inv;

  v_pay := round(COALESCE(nullif(p_payment->>'amount','')::numeric, 0), 2);
  IF v_pay > 0 THEN
    IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN
      RAISE EXCEPTION 'Only an admin can record a supplier payment';
    END IF;
    IF v_pay > tot THEN RAISE EXCEPTION 'Payment (%) exceeds the invoice total (%)', v_pay, tot; END IF;
    PERFORM public.record_supplier_payment(v_dist, v_pay, COALESCE(p_payment->>'method','cash'),
      nullif(trim(p_payment->>'reference'),''), 'Paid with purchase ' || v_no, inv);
  END IF;

  IF p_draft IS NOT NULL THEN
    DELETE FROM public.purchase_drafts WHERE id = p_draft AND branch_id = v_branch;
  END IF;

  INSERT INTO public.audit_logs (branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data, at)
  VALUES (v_branch, auth.uid(), 'purchase_confirmed', 'purchase_invoice', inv::text, 'Purchase stock-in (v2)', NULL,
    jsonb_build_object('invoice_id', inv, 'total', tot, 'distributor_id', v_dist, 'lines', v_lines, 'paid', v_pay), now());
  RETURN inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_detail(p_invoice uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := COALESCE(public.my_role(), '');
  v_admin boolean;
  inv public.purchase_invoices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF v_role NOT IN ('super_admin','admin','pharmacist','inventory_staff','inventory') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  v_admin := v_role IN ('super_admin','admin');
  SELECT * INTO inv FROM public.purchase_invoices WHERE id = p_invoice AND branch_id = v_branch;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found in this branch'; END IF;
  RETURN jsonb_build_object(
    'invoice', jsonb_build_object('id', inv.id, 'supplier_invoice_no', inv.supplier_invoice_no, 'invoice_date', inv.invoice_date,
       'status', inv.status, 'notes', inv.notes, 'due_date', inv.due_date, 'order_no', inv.order_no, 'order_date', inv.order_date,
       'payment_terms', inv.payment_terms, 'created_at', inv.created_at,
       'distributor', (SELECT jsonb_build_object('id', d.id, 'name', d.name, 'phone', d.phone, 'gstin', d.gstin) FROM public.distributors d WHERE d.id = inv.distributor_id),
       'created_by', (SELECT full_name FROM public.profiles WHERE id = inv.created_by),
       'subtotal', CASE WHEN v_admin THEN inv.subtotal END, 'tax', CASE WHEN v_admin THEN inv.tax END,
       'discount', CASE WHEN v_admin THEN inv.discount END, 'freight', CASE WHEN v_admin THEN inv.freight END,
       'round_off', CASE WHEN v_admin THEN inv.round_off END, 'total', CASE WHEN v_admin THEN inv.total END,
       'printed_total', CASE WHEN v_admin THEN inv.printed_total END,
       'balance', CASE WHEN v_admin THEN inv.total - COALESCE((SELECT sum(sp.amount) FROM public.supplier_payments sp
                    WHERE sp.purchase_invoice_id = inv.id AND sp.status = 'posted'), 0) END),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
       'medicine', m.name, 'strength', m.strength, 'batch_no', b.batch_no, 'expiry', b.expiry,
       'qty', pi.qty, 'free_qty', pi.free_qty, 'pack', pi.unit_factor, 'stock_units', pi.base_qty + COALESCE(pi.free_base_qty, 0),
       'hsn', pi.hsn, 'mrp', pi.mrp, 'tax_rate', pi.tax_rate,
       'unit_price', CASE WHEN v_admin THEN pi.unit_price END, 'line_discount', CASE WHEN v_admin THEN pi.line_discount END,
       'line_net', CASE WHEN v_admin THEN pi.line_net END) ORDER BY m.name), '[]'::jsonb)
       FROM public.purchase_items pi JOIN public.medicines m ON m.id = pi.medicine_id
       JOIN public.medicine_batches b ON b.id = pi.batch_id WHERE pi.invoice_id = inv.id),
    'payments', CASE WHEN v_admin THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('payment_no', sp.payment_no, 'amount', sp.amount,
       'method', sp.method, 'reference', sp.reference, 'status', sp.status, 'created_at', sp.created_at) ORDER BY sp.created_at), '[]'::jsonb)
       FROM public.supplier_payments sp WHERE sp.purchase_invoice_id = inv.id) ELSE '[]'::jsonb END,
    'documents', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pd.id, 'file_name', pd.file_name, 'mime', pd.mime,
       'path', pd.path, 'size_bytes', pd.size_bytes, 'created_at', pd.created_at) ORDER BY pd.created_at), '[]'::jsonb)
       FROM public.purchase_documents pd WHERE pd.purchase_invoice_id = inv.id AND pd.status = 'active'),
    'can_see_costs', v_admin);
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_draft_save(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_draft_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_draft_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_invoice_exists(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_purchase_v2(jsonb, jsonb, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_draft_save(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_draft_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_draft_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_invoice_exists(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_purchase_v2(jsonb, jsonb, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_detail(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Part J · Reports (13 report_* functions used by reports.html) + ist_today()
-- Branch-scoped; require an active work session and the reports.view
-- permission (super_admin / admin). Dates are India-local calendar dates.
-- p_from / p_to are 'YYYY-MM-DD' or '' for open-ended ranges.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ist_today()
RETURNS date LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;
GRANT EXECUTE ON FUNCTION public.ist_today() TO authenticated;

CREATE OR REPLACE FUNCTION public._report_guard()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF NOT COALESCE(app.has_perm('reports.view'), false) THEN RAISE EXCEPTION 'Not authorised to view reports'; END IF;
  RETURN v_branch;
END;
$$;
REVOKE ALL ON FUNCTION public._report_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._report_from(p text) RETURNS date LANGUAGE sql IMMUTABLE
AS $$ SELECT COALESCE(nullif(trim(p), '')::date, DATE '2000-01-01') $$;
CREATE OR REPLACE FUNCTION public._report_to(p text) RETURNS date LANGUAGE sql STABLE
AS $$ SELECT COALESCE(nullif(trim(p), '')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date) $$;
CREATE OR REPLACE FUNCTION public._ist_date(t timestamptz) RETURNS date LANGUAGE sql IMMUTABLE
AS $$ SELECT (t AT TIME ZONE 'Asia/Kolkata')::date $$;
-- Ex-tax value of a sale line (stored for v2+ bills, derived for legacy inclusive lines).
CREATE OR REPLACE FUNCTION public._sale_line_taxable(i public.sales_items) RETURNS numeric LANGUAGE sql IMMUTABLE
AS $$ SELECT COALESCE(i.taxable_amount, i.line_total * 100 / (100 + i.tax_rate)) $$;
CREATE OR REPLACE FUNCTION public._sale_line_gst(i public.sales_items) RETURNS numeric LANGUAGE sql IMMUTABLE
AS $$ SELECT COALESCE(i.gst_amount, i.line_total * i.tax_rate / (100 + i.tax_rate)) $$;

-- 1 · Period summary
CREATE OR REPLACE FUNCTION public.report_period_summary(p_from text DEFAULT NULL, p_to text DEFAULT NULL, p_bucket text DEFAULT 'day')
RETURNS TABLE (period date, invoices bigint, gross_sales numeric, tax numeric, returns numeric, net_sales numeric, purchases numeric, expenses numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._report_guard();
  v_b text := CASE WHEN p_bucket IN ('day','week','month') THEN p_bucket ELSE 'day' END;
  v_from date := public._report_from(p_from);
  v_to date := public._report_to(p_to);
BEGIN
  IF nullif(trim(p_from), '') IS NULL THEN
    SELECT COALESCE(min(public._ist_date(created_at)), v_to) INTO v_from FROM public.sales_invoices WHERE branch_id = v_branch;
  END IF;
  IF v_from > v_to THEN RAISE EXCEPTION 'From date is after To date'; END IF;
  RETURN QUERY
  WITH s AS (
    SELECT date_trunc(v_b, public._ist_date(i.created_at))::date AS k, count(*) AS n, sum(i.total) AS gross, sum(i.tax) AS tx
    FROM public.sales_invoices i WHERE i.branch_id = v_branch AND i.status = 'final'
      AND public._ist_date(i.created_at) BETWEEN v_from AND v_to GROUP BY 1),
  r AS (
    SELECT date_trunc(v_b, public._ist_date(x.created_at))::date AS k, sum(x.total) AS amt
    FROM public.sales_returns x WHERE x.branch_id = v_branch AND public._ist_date(x.created_at) BETWEEN v_from AND v_to GROUP BY 1),
  p AS (
    SELECT date_trunc(v_b, x.invoice_date)::date AS k, sum(x.total) AS amt
    FROM public.purchase_invoices x WHERE x.branch_id = v_branch AND x.status = 'confirmed'
      AND x.invoice_date BETWEEN v_from AND v_to GROUP BY 1),
  e AS (
    SELECT date_trunc(v_b, x.expense_date)::date AS k, sum(x.amount) AS amt
    FROM public.expenses x WHERE x.branch_id = v_branch AND x.status = 'posted'
      AND x.expense_date BETWEEN v_from AND v_to GROUP BY 1),
  keys AS (
    SELECT generate_series(date_trunc(v_b, v_from), date_trunc(v_b, v_to), ('1 ' || v_b)::interval)::date AS k)
  SELECT keys.k, COALESCE(s.n, 0), round(COALESCE(s.gross, 0), 2), round(COALESCE(s.tx, 0), 2),
         round(COALESCE(r.amt, 0), 2), round(COALESCE(s.gross, 0) - COALESCE(r.amt, 0), 2),
         round(COALESCE(p.amt, 0), 2), round(COALESCE(e.amt, 0), 2)
  FROM keys LEFT JOIN s ON s.k = keys.k LEFT JOIN r ON r.k = keys.k
  LEFT JOIN p ON p.k = keys.k LEFT JOIN e ON e.k = keys.k
  ORDER BY keys.k;
END;
$$;

-- 2 · Sales (invoice-wise)
CREATE OR REPLACE FUNCTION public.report_sales(p_from text DEFAULT NULL, p_to text DEFAULT NULL)
RETURNS TABLE (invoice_no text, sale_date date, customer text, subtotal numeric, discount numeric, tax numeric,
               total numeric, returned numeric, payments text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard();
BEGIN
  RETURN QUERY
  SELECT i.invoice_no, public._ist_date(i.created_at), COALESCE(c.name, 'Walk-in'),
         i.subtotal + i.line_discount, i.discount + i.line_discount, i.tax, i.total,
         COALESCE((SELECT sum(x.total) FROM public.sales_returns x WHERE x.invoice_id = i.id), 0),
         (SELECT string_agg(initcap(pp.method) || ' ' || to_char(pp.amount, 'FM9999999990.00'), ', ' ORDER BY pp.method)
            FROM public.payments pp WHERE pp.invoice_id = i.id)
  FROM public.sales_invoices i LEFT JOIN public.customers c ON c.id = i.customer_id
  WHERE i.branch_id = v_branch AND i.status = 'final'
    AND public._ist_date(i.created_at) BETWEEN public._report_from(p_from) AND public._report_to(p_to)
  ORDER BY i.created_at;
END;
$$;

-- 3 · Purchases
CREATE OR REPLACE FUNCTION public.report_purchases(p_from text DEFAULT NULL, p_to text DEFAULT NULL)
RETURNS TABLE (invoice_date date, supplier_invoice_no text, distributor text, subtotal numeric, tax numeric,
               discount numeric, freight numeric, total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard();
BEGIN
  RETURN QUERY
  SELECT x.invoice_date, x.supplier_invoice_no, d.name, x.subtotal, x.tax, x.discount, x.freight, x.total
  FROM public.purchase_invoices x JOIN public.distributors d ON d.id = x.distributor_id
  WHERE x.branch_id = v_branch AND x.status = 'confirmed'
    AND x.invoice_date BETWEEN public._report_from(p_from) AND public._report_to(p_to)
  ORDER BY x.invoice_date, x.created_at;
END;
$$;

-- 4 · Medicine-wise sales & estimated profit (FIFO costs)
CREATE OR REPLACE FUNCTION public.report_medicines(p_from text DEFAULT NULL, p_to text DEFAULT NULL)
RETURNS TABLE (name text, strength text, qty_sold numeric, qty_returned numeric, net_qty numeric,
               net_sales_ex_tax numeric, est_cogs numeric, est_gross_profit numeric, stock_now numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard(); v_from date := public._report_from(p_from); v_to date := public._report_to(p_to);
BEGIN
  RETURN QUERY
  WITH sold AS (
    SELECT si.medicine_id, sum(si.qty) AS q,
           sum(public._sale_line_taxable(si) * CASE WHEN i.subtotal > 0 THEN i.total / i.subtotal ELSE 1 END) AS ex_tax,
           sum(COALESCE((SELECT sum(a.total_cost) FROM public.inventory_sale_allocations a WHERE a.sales_item_id = si.id), 0)) AS cogs
    FROM public.sales_items si JOIN public.sales_invoices i ON i.id = si.invoice_id
    WHERE si.branch_id = v_branch AND i.status = 'final' AND public._ist_date(i.created_at) BETWEEN v_from AND v_to
    GROUP BY si.medicine_id),
  ret AS (
    SELECT ri.medicine_id, sum(ri.qty) AS q,
           sum(ri.line_total * 100 / (100 + si.tax_rate)) AS ex_tax,
           sum(COALESCE((SELECT sum(a.restored_cost) FROM public.inventory_customer_return_allocations a WHERE a.sales_return_item_id = ri.id), 0)) AS cogs
    FROM public.sales_return_items ri JOIN public.sales_returns r ON r.id = ri.return_id
    JOIN public.sales_items si ON si.id = ri.sales_item_id
    WHERE ri.branch_id = v_branch AND public._ist_date(r.created_at) BETWEEN v_from AND v_to
    GROUP BY ri.medicine_id)
  SELECT m.name, m.strength, COALESCE(sold.q, 0), COALESCE(ret.q, 0), COALESCE(sold.q, 0) - COALESCE(ret.q, 0),
         round(COALESCE(sold.ex_tax, 0) - COALESCE(ret.ex_tax, 0), 2),
         round(COALESCE(sold.cogs, 0) - COALESCE(ret.cogs, 0), 2),
         round(COALESCE(sold.ex_tax, 0) - COALESCE(ret.ex_tax, 0) - (COALESCE(sold.cogs, 0) - COALESCE(ret.cogs, 0)), 2),
         COALESCE((SELECT sum(b.qty) FROM public.medicine_batches b WHERE b.medicine_id = m.id AND b.branch_id = v_branch), 0)
  FROM public.medicines m
  LEFT JOIN sold ON sold.medicine_id = m.id LEFT JOIN ret ON ret.medicine_id = m.id
  WHERE m.branch_id = v_branch AND (sold.medicine_id IS NOT NULL OR ret.medicine_id IS NOT NULL)
  ORDER BY 6 DESC, m.name;
END;
$$;

-- 5 · Customer-wise
CREATE OR REPLACE FUNCTION public.report_customers(p_from text DEFAULT NULL, p_to text DEFAULT NULL)
RETURNS TABLE (name text, phone text, invoices bigint, purchases numeric, returns numeric, credit_taken numeric,
               receipts numeric, outstanding_now numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard(); v_from date := public._report_from(p_from); v_to date := public._report_to(p_to);
BEGIN
  RETURN QUERY
  WITH inv AS (
    SELECT i.customer_id, count(*) AS n, sum(i.total) AS amt,
           sum(COALESCE((SELECT sum(pp.amount) FROM public.payments pp WHERE pp.invoice_id = i.id AND pp.method = 'credit'), 0)) AS credit
    FROM public.sales_invoices i
    WHERE i.branch_id = v_branch AND i.status = 'final' AND i.customer_id IS NOT NULL
      AND public._ist_date(i.created_at) BETWEEN v_from AND v_to GROUP BY i.customer_id),
  ret AS (
    SELECT r.customer_id, sum(r.total) AS amt FROM public.sales_returns r
    WHERE r.branch_id = v_branch AND public._ist_date(r.created_at) BETWEEN v_from AND v_to GROUP BY r.customer_id),
  rec AS (
    SELECT x.customer_id, sum(x.amount) AS amt FROM public.customer_receipts x
    WHERE x.branch_id = v_branch AND x.status = 'posted' AND public._ist_date(x.created_at) BETWEEN v_from AND v_to GROUP BY x.customer_id)
  SELECT c.name, c.phone, COALESCE(inv.n, 0), round(COALESCE(inv.amt, 0), 2), round(COALESCE(ret.amt, 0), 2),
         round(COALESCE(inv.credit, 0), 2), round(COALESCE(rec.amt, 0), 2), round(public.customer_outstanding(c.id), 2)
  FROM public.customers c
  LEFT JOIN inv ON inv.customer_id = c.id LEFT JOIN ret ON ret.customer_id = c.id LEFT JOIN rec ON rec.customer_id = c.id
  WHERE c.branch_id = v_branch AND (inv.customer_id IS NOT NULL OR ret.customer_id IS NOT NULL OR rec.customer_id IS NOT NULL)
  ORDER BY 4 DESC, c.name;
END;
$$;

-- 6 · Distributor-wise
CREATE OR REPLACE FUNCTION public.report_distributors(p_from text DEFAULT NULL, p_to text DEFAULT NULL)
RETURNS TABLE (name text, purchases numeric, purchase_returns numeric, payments numeric, balance_now numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard(); v_from date := public._report_from(p_from); v_to date := public._report_to(p_to);
BEGIN
  RETURN QUERY
  SELECT d.name,
    round(COALESCE((SELECT sum(x.total) FROM public.purchase_invoices x WHERE x.distributor_id = d.id AND x.branch_id = v_branch
                    AND x.status = 'confirmed' AND x.invoice_date BETWEEN v_from AND v_to), 0), 2),
    round(COALESCE((SELECT sum(x.total_value) FROM public.purchase_returns x WHERE x.distributor_id = d.id AND x.branch_id = v_branch
                    AND public._ist_date(x.created_at) BETWEEN v_from AND v_to), 0), 2),
    round(COALESCE((SELECT sum(x.amount) FROM public.supplier_payments x WHERE x.distributor_id = d.id AND x.branch_id = v_branch
                    AND x.status = 'posted' AND public._ist_date(x.created_at) BETWEEN v_from AND v_to), 0), 2),
    round(public.distributor_balance(d.id), 2)
  FROM public.distributors d
  WHERE d.branch_id = v_branch
  ORDER BY 2 DESC, d.name;
END;
$$;

-- 7 · Stock (batch-wise)
CREATE OR REPLACE FUNCTION public.report_stock()
RETURNS TABLE (name text, strength text, batch_no text, expiry date, qty numeric, status text, cost_value numeric, retail_value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard(); v_today date := public.ist_today();
BEGIN
  RETURN QUERY
  SELECT m.name, m.strength, b.batch_no, b.expiry, b.qty,
    CASE WHEN b.expiry <= v_today THEN 'Expired' WHEN b.quarantined THEN 'Quarantined'
         WHEN b.stock_status <> 'active' THEN initcap(b.stock_status)
         WHEN b.expiry <= v_today + 90 THEN 'Near expiry' ELSE 'OK' END,
    round(COALESCE((SELECT sum(l.remaining_qty * COALESCE(l.unit_cost, 0)) FROM public.inventory_cost_layers l WHERE l.batch_id = b.id),
                   b.qty * COALESCE(b.unit_cost, m.purchase_price, 0)), 2),
    round(b.qty * COALESCE(b.mrp, m.selling_price), 2)
  FROM public.medicine_batches b JOIN public.medicines m ON m.id = b.medicine_id
  WHERE b.branch_id = v_branch AND b.qty > 0
  ORDER BY m.name, b.expiry;
END;
$$;

-- 8 · Expiry
CREATE OR REPLACE FUNCTION public.report_expiry(p_days integer DEFAULT 90)
RETURNS TABLE (name text, strength text, batch_no text, expiry date, days_left integer, qty numeric, cost_value numeric, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard(); v_today date := public.ist_today();
BEGIN
  IF p_days IS NULL OR p_days < 0 OR p_days > 3650 THEN RAISE EXCEPTION 'Expiry window must be 0–3650 days'; END IF;
  RETURN QUERY
  SELECT m.name, m.strength, b.batch_no, b.expiry, (b.expiry - v_today)::int, b.qty,
    round(b.qty * COALESCE(b.unit_cost, m.purchase_price, 0), 2),
    CASE WHEN b.expiry <= v_today THEN 'Expired' WHEN b.quarantined THEN 'Quarantined'
         WHEN b.stock_status <> 'active' THEN initcap(b.stock_status) ELSE 'Expiring' END
  FROM public.medicine_batches b JOIN public.medicines m ON m.id = b.medicine_id
  WHERE b.branch_id = v_branch AND b.qty > 0 AND b.expiry <= v_today + p_days
  ORDER BY b.expiry, m.name;
END;
$$;

-- 9 · Returns & refunds
CREATE OR REPLACE FUNCTION public.report_returns(p_from text DEFAULT NULL, p_to text DEFAULT NULL)
RETURNS TABLE (kind text, return_no text, return_date date, party text, total numeric, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard(); v_from date := public._report_from(p_from); v_to date := public._report_to(p_to);
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT 'Customer return'::text, r.return_no, public._ist_date(r.created_at), COALESCE(c.name, 'Walk-in'), r.total,
           'Refund ' || upper(r.refund_method) || ' · ' || r.reason
    FROM public.sales_returns r LEFT JOIN public.customers c ON c.id = r.customer_id
    WHERE r.branch_id = v_branch AND public._ist_date(r.created_at) BETWEEN v_from AND v_to
    UNION ALL
    SELECT 'Return to distributor', r.return_no, public._ist_date(r.created_at), d.name, r.total_value, r.reason
    FROM public.purchase_returns r JOIN public.distributors d ON d.id = r.distributor_id
    WHERE r.branch_id = v_branch AND public._ist_date(r.created_at) BETWEEN v_from AND v_to
  ) x ORDER BY 3, 2;
END;
$$;

-- 10 · Expenses
CREATE OR REPLACE FUNCTION public.report_expenses(p_from text DEFAULT NULL, p_to text DEFAULT NULL)
RETURNS TABLE (expense_no text, expense_date date, category text, description text, method text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard();
BEGIN
  RETURN QUERY
  SELECT e.expense_no, e.expense_date, c.name, e.description, upper(e.payment_method), e.amount
  FROM public.expenses e JOIN public.expense_categories c ON c.id = e.category_id
  WHERE e.branch_id = v_branch AND e.status = 'posted'
    AND e.expense_date BETWEEN public._report_from(p_from) AND public._report_to(p_to)
  ORDER BY e.expense_date, e.expense_no;
END;
$$;

-- 11 · Tax summary (indicative)
CREATE OR REPLACE FUNCTION public.report_tax(p_from text DEFAULT NULL, p_to text DEFAULT NULL)
RETURNS TABLE (label text, rate numeric, taxable numeric, tax numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard(); v_from date := public._report_from(p_from); v_to date := public._report_to(p_to);
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT 'Output GST — sales'::text, si.tax_rate,
           round(sum(public._sale_line_taxable(si) * CASE WHEN i.subtotal > 0 THEN i.total / i.subtotal ELSE 1 END), 2),
           round(sum(public._sale_line_gst(si) * CASE WHEN i.subtotal > 0 THEN i.total / i.subtotal ELSE 1 END), 2)
    FROM public.sales_items si JOIN public.sales_invoices i ON i.id = si.invoice_id
    WHERE si.branch_id = v_branch AND i.status = 'final' AND public._ist_date(i.created_at) BETWEEN v_from AND v_to
    GROUP BY si.tax_rate
    UNION ALL
    SELECT 'Less: customer returns', si.tax_rate,
           -round(sum(ri.line_total * 100 / (100 + si.tax_rate)), 2), -round(sum(ri.line_total * si.tax_rate / (100 + si.tax_rate)), 2)
    FROM public.sales_return_items ri JOIN public.sales_returns r ON r.id = ri.return_id
    JOIN public.sales_items si ON si.id = ri.sales_item_id
    WHERE ri.branch_id = v_branch AND public._ist_date(r.created_at) BETWEEN v_from AND v_to
    GROUP BY si.tax_rate
    UNION ALL
    SELECT 'Input GST — purchases', pi.tax_rate, round(sum(pi.line_net), 2), round(sum(pi.line_net * pi.tax_rate / 100), 2)
    FROM public.purchase_items pi JOIN public.purchase_invoices x ON x.id = pi.invoice_id
    WHERE pi.branch_id = v_branch AND x.status = 'confirmed' AND x.invoice_date BETWEEN v_from AND v_to
    GROUP BY pi.tax_rate
  ) t ORDER BY 1, 2;
END;
$$;

-- 12 · Profit & loss (estimated)
CREATE OR REPLACE FUNCTION public.report_pnl(p_from text DEFAULT NULL, p_to text DEFAULT NULL)
RETURNS TABLE (label text, amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._report_guard(); v_from date := public._report_from(p_from); v_to date := public._report_to(p_to);
  v_sales numeric; v_ret numeric; v_cogs numeric; v_cogs_back numeric; v_exp numeric;
BEGIN
  SELECT COALESCE(sum(public._sale_line_taxable(si) * CASE WHEN i.subtotal > 0 THEN i.total / i.subtotal ELSE 1 END), 0),
         COALESCE(sum((SELECT sum(a.total_cost) FROM public.inventory_sale_allocations a WHERE a.sales_item_id = si.id)), 0)
    INTO v_sales, v_cogs
  FROM public.sales_items si JOIN public.sales_invoices i ON i.id = si.invoice_id
  WHERE si.branch_id = v_branch AND i.status = 'final' AND public._ist_date(i.created_at) BETWEEN v_from AND v_to;

  SELECT COALESCE(sum(ri.line_total * 100 / (100 + si.tax_rate)), 0),
         COALESCE(sum((SELECT sum(a.restored_cost) FROM public.inventory_customer_return_allocations a WHERE a.sales_return_item_id = ri.id)), 0)
    INTO v_ret, v_cogs_back
  FROM public.sales_return_items ri JOIN public.sales_returns r ON r.id = ri.return_id
  JOIN public.sales_items si ON si.id = ri.sales_item_id
  WHERE ri.branch_id = v_branch AND public._ist_date(r.created_at) BETWEEN v_from AND v_to;

  SELECT COALESCE(sum(e.amount), 0) INTO v_exp FROM public.expenses e
  WHERE e.branch_id = v_branch AND e.status = 'posted' AND e.expense_date BETWEEN v_from AND v_to;

  RETURN QUERY VALUES
    ('Sales (excl. GST)', round(v_sales, 2)),
    ('Less: customer returns (excl. GST)', -round(v_ret, 2)),
    ('Net sales', round(v_sales - v_ret, 2)),
    ('Less: cost of goods sold (FIFO)', -round(v_cogs - v_cogs_back, 2)),
    ('Gross profit', round(v_sales - v_ret - (v_cogs - v_cogs_back), 2)),
    ('Less: expenses', -round(v_exp, 2)),
    ('Net profit (estimated)', round(v_sales - v_ret - (v_cogs - v_cogs_back) - v_exp, 2));
END;
$$;

-- 13 · Financial ledger
CREATE OR REPLACE FUNCTION public.report_ledger(p_from text DEFAULT NULL, p_to text DEFAULT NULL)
RETURNS TABLE (entry_date date, account text, debit numeric, credit numeric, memo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._report_guard();
BEGIN
  RETURN QUERY
  SELECT public._ist_date(l.entry_at), l.account, l.debit, l.credit, COALESCE(l.memo, l.ref_type)
  FROM public.financial_ledger l
  WHERE l.branch_id = v_branch AND public._ist_date(l.entry_at) BETWEEN public._report_from(p_from) AND public._report_to(p_to)
  ORDER BY l.entry_at, l.id
  LIMIT 5000;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'report_period_summary(text,text,text)', 'report_sales(text,text)', 'report_purchases(text,text)',
    'report_medicines(text,text)', 'report_customers(text,text)', 'report_distributors(text,text)',
    'report_stock()', 'report_expiry(integer)', 'report_returns(text,text)', 'report_expenses(text,text)',
    'report_tax(text,text)', 'report_pnl(text,text)', 'report_ledger(text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
