-- ALZA Pharmacy: Initial Stock Excel fields + submitted batch editor
-- Review against the live schema before applying. Run once in Supabase SQL Editor.
-- This migration preserves the existing opening-stock session workflow.

ALTER TABLE public.opening_stock_items
  ADD COLUMN IF NOT EXISTS serial_no text,
  ADD COLUMN IF NOT EXISTS pack_size numeric(14,3) NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  ADD COLUMN IF NOT EXISTS pack_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (pack_qty >= 0),
  ADD COLUMN IF NOT EXISTS srate numeric(14,2) NOT NULL DEFAULT 0 CHECK (srate >= 0),
  ADD COLUMN IF NOT EXISTS prate numeric(14,2) NOT NULL DEFAULT 0 CHECK (prate >= 0),
  ADD COLUMN IF NOT EXISTS urate numeric(14,4) NOT NULL DEFAULT 0 CHECK (urate >= 0),
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.medicine_batches(id);

-- Store pack metadata on the posted batch so submitted rows remain editable.
ALTER TABLE public.medicine_batches
  ADD COLUMN IF NOT EXISTS pack_size numeric(14,3) NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  ADD COLUMN IF NOT EXISTS pack_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (pack_qty >= 0);

-- Backfill legacy rows as one unit per pack so existing drafts/submissions remain readable.
UPDATE public.opening_stock_items
SET pack_size=1,
    pack_qty=qty,
    srate=mrp,
    prate=unit_cost,
    urate=mrp
WHERE pack_qty=0;

-- Link already-submitted opening-stock items to their existing batch records.
UPDATE public.opening_stock_items oi
SET batch_id=mb.id
FROM public.medicine_batches mb
WHERE oi.batch_id IS NULL
  AND mb.branch_id=oi.branch_id
  AND mb.medicine_id=oi.medicine_id
  AND mb.batch_no=oi.batch_no;

UPDATE public.medicine_batches mb
SET pack_qty=mb.qty
WHERE mb.pack_qty=0;

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

  SELECT * INTO v_session FROM public.opening_stock_sessions WHERE branch_id=v_branch;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'medicine_id',i.medicine_id,'medicine_name',m.name,'strength',m.strength,
    'batch_no',i.batch_no,'expiry',i.expiry,'qty',i.qty,'unit_cost',i.unit_cost,
    'mrp',i.mrp,'selling_price',i.selling_price,
    'serial_no',i.serial_no,'pack_size',i.pack_size,'pack_qty',i.pack_qty,
    'srate',i.srate,'prate',i.prate,'urate',i.urate,'batch_id',i.batch_id
  ) ORDER BY i.serial_no NULLS LAST,m.name,i.batch_no),'[]'::jsonb)
  INTO v_items
  FROM public.opening_stock_items i
  JOIN public.medicines m ON m.id=i.medicine_id
  WHERE i.session_id=v_session.id AND i.branch_id=v_branch;

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
  v_pack numeric;
  v_pack_qty numeric;
  v_total numeric;
  v_prate numeric;
  v_srate numeric;
  v_urate numeric;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Add at least one stock batch'; END IF;
  IF jsonb_array_length(p_items)>2000 THEN RAISE EXCEPTION 'Maximum 2,000 batch rows per draft'; END IF;

  INSERT INTO public.opening_stock_sessions(branch_id,status,notes,created_by,updated_by)
  VALUES(v_branch,'draft',nullif(trim(p_notes),''),auth.uid(),auth.uid())
  ON CONFLICT(branch_id) DO NOTHING;
  SELECT * INTO v_session FROM public.opening_stock_sessions WHERE branch_id=v_branch FOR UPDATE;
  IF v_session.status<>'draft' THEN RAISE EXCEPTION 'Opening stock has already been submitted and is locked'; END IF;
  DELETE FROM public.opening_stock_items WHERE session_id=v_session.id;

  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_med := (x->>'medicine_id')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.medicines m WHERE m.id=v_med AND m.branch_id=v_branch AND m.active) THEN
      RAISE EXCEPTION 'Medicine missing, inactive or outside this branch';
    END IF;
    v_pack := coalesce(nullif(x->>'pack_size','')::numeric,1);
    v_pack_qty := coalesce(nullif(x->>'pack_qty','')::numeric,nullif(x->>'qty','')::numeric);
    v_total := coalesce(nullif(x->>'qty','')::numeric,0);
    v_srate := coalesce(nullif(x->>'srate','')::numeric,nullif(x->>'mrp','')::numeric,0);
    v_prate := coalesce(nullif(x->>'prate','')::numeric,0);
    v_urate := coalesce(nullif(x->>'urate','')::numeric,CASE WHEN v_pack>0 THEN v_srate/v_pack ELSE 0 END);
    IF v_pack<=0 OR v_pack_qty<=0 OR v_total<=0 OR abs(v_total-(v_pack*v_pack_qty))>0.01
      OR coalesce(trim(x->>'batch_no'),'')='' OR nullif(x->>'expiry','') IS NULL
      OR v_srate<0 OR v_prate<0 OR v_urate<0 OR abs(v_urate-(v_srate/v_pack))>0.02 THEN
      RAISE EXCEPTION 'Invalid stock row: verify batch, expiry, pack, quantity and rates';
    END IF;

    INSERT INTO public.opening_stock_items(
      session_id,branch_id,medicine_id,batch_no,expiry,qty,unit_cost,mrp,selling_price,
      serial_no,pack_size,pack_qty,srate,prate,urate
    ) VALUES(
      v_session.id,v_branch,v_med,trim(x->>'batch_no'),(x->>'expiry')::date,
      v_total,round(v_prate/v_pack,4),round(v_urate,2),round(v_urate,2),
      nullif(x->>'serial_no',''),v_pack,v_pack_qty,v_srate,v_prate,v_urate
    );
  END LOOP;

  UPDATE public.opening_stock_sessions
  SET notes=nullif(trim(p_notes),''),updated_by=auth.uid(),updated_at=now()
  WHERE id=v_session.id;
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
  v_count integer:=0;
  v_value numeric:=0;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  SELECT * INTO v_session FROM public.opening_stock_sessions WHERE branch_id=v_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No saved opening-stock draft'; END IF;
  IF v_session.status<>'draft' THEN RAISE EXCEPTION 'Opening stock has already been submitted'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.opening_stock_items WHERE session_id=v_session.id) THEN RAISE EXCEPTION 'Draft is empty'; END IF;
  IF EXISTS(SELECT 1 FROM public.opening_stock_items WHERE session_id=v_session.id GROUP BY medicine_id HAVING count(DISTINCT (mrp,selling_price))>1) THEN
    RAISE EXCEPTION 'A medicine has inconsistent per-unit MRP across batches.';
  END IF;

  FOR i IN SELECT * FROM public.opening_stock_items WHERE session_id=v_session.id AND branch_id=v_branch ORDER BY id LOOP
    IF EXISTS(SELECT 1 FROM public.medicine_batches b WHERE b.medicine_id=i.medicine_id AND b.batch_no=i.batch_no) THEN
      RAISE EXCEPTION 'Batch % already exists for this medicine. Resolve the duplicate before submitting.',i.batch_no;
    END IF;
    INSERT INTO public.medicine_batches(branch_id,medicine_id,batch_no,expiry,qty,quarantined,unit_cost,pack_size,pack_qty)
    VALUES(v_branch,i.medicine_id,i.batch_no,i.expiry,i.qty,(i.expiry<=current_date),i.unit_cost,i.pack_size,i.pack_qty)
    RETURNING id INTO v_batch;

    UPDATE public.opening_stock_items SET batch_id=v_batch WHERE id=i.id;

    INSERT INTO public.stock_movements(branch_id,medicine_id,batch_id,movement_type,qty,ref_type,ref_id,created_by,reason)
    VALUES(v_branch,i.medicine_id,v_batch,'opening_stock',i.qty,'opening_stock',v_session.id,auth.uid(),
      CASE WHEN i.expiry<=current_date THEN 'Takeover opening stock; expired batch quarantined' ELSE 'Pharmacy takeover opening stock' END);

    UPDATE public.medicines SET mrp=i.urate,selling_price=i.urate,purchase_price=i.unit_cost
    WHERE id=i.medicine_id AND branch_id=v_branch;
    v_count:=v_count+1;
    v_value:=v_value+(i.qty*i.unit_cost);
  END LOOP;

  UPDATE public.opening_stock_sessions
  SET status='submitted',submitted_by=auth.uid(),submitted_at=now(),updated_at=now(),updated_by=auth.uid()
  WHERE id=v_session.id;

  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  VALUES(v_branch,auth.uid(),'opening_stock_submitted','opening_stock_session',v_session.id::text,
    'Initial takeover stock posted',jsonb_build_object('status','draft'),
    jsonb_build_object('status','submitted','batch_count',v_count,'stock_value',round(v_value,2)),now());
  RETURN v_session.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.opening_stock_edit_submitted_batch(
  p_batch uuid,
  p_batch_no text,
  p_expiry date,
  p_pack_size numeric,
  p_pack_qty numeric,
  p_srate numeric,
  p_prate numeric,
  p_urate numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_branch uuid:=public.my_branch_id();
  b public.medicine_batches%rowtype;
  v_old jsonb;
  v_new_qty numeric;
  v_delta numeric;
  v_item_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  IF coalesce(trim(p_batch_no),'')='' OR p_expiry IS NULL OR p_pack_size<=0 OR p_pack_qty<=0
    OR p_srate<0 OR p_prate<0 OR p_urate<0 OR abs(p_urate-(p_srate/p_pack_size))>0.02 THEN
    RAISE EXCEPTION 'Invalid batch details';
  END IF;

  SELECT mb.* INTO b
  FROM public.medicine_batches mb
  JOIN public.opening_stock_items oi ON oi.batch_id=mb.id
  JOIN public.opening_stock_sessions os ON os.id=oi.session_id
  WHERE mb.id=p_batch AND mb.branch_id=v_branch AND os.branch_id=v_branch AND os.status='submitted'
  FOR UPDATE OF mb;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submitted opening-stock batch not found in this branch'; END IF;

  v_new_qty:=p_pack_size*p_pack_qty;
  IF EXISTS(SELECT 1 FROM public.medicine_batches x WHERE x.medicine_id=b.medicine_id AND lower(x.batch_no)=lower(trim(p_batch_no)) AND x.id<>b.id) THEN
    RAISE EXCEPTION 'Another batch already uses this batch number for the medicine';
  END IF;
  IF v_new_qty<>b.qty AND EXISTS(
    SELECT 1 FROM public.stock_movements sm
    WHERE sm.batch_id=b.id AND sm.movement_type<>'opening_stock'
  ) THEN
    RAISE EXCEPTION 'Quantity cannot be changed after this batch has other stock movements. Edit only batch, expiry and rates, or reconcile movements first.';
  END IF;

  SELECT id INTO v_item_id FROM public.opening_stock_items WHERE batch_id=b.id LIMIT 1;
  v_old:=jsonb_build_object('batch_no',b.batch_no,'expiry',b.expiry,'qty',b.qty,'unit_cost',b.unit_cost,
    'pack_size',b.pack_size,'pack_qty',b.pack_qty);
  v_delta:=v_new_qty-b.qty;

  UPDATE public.medicine_batches
  SET batch_no=trim(p_batch_no),expiry=p_expiry,qty=v_new_qty,unit_cost=round(p_prate/p_pack_size,4),
      pack_size=p_pack_size,pack_qty=p_pack_qty,quarantined=(p_expiry<=current_date)
  WHERE id=b.id;

  UPDATE public.opening_stock_items
  SET batch_no=trim(p_batch_no),expiry=p_expiry,qty=v_new_qty,unit_cost=round(p_prate/p_pack_size,4),
      mrp=round(p_urate,2),selling_price=round(p_urate,2),pack_size=p_pack_size,pack_qty=p_pack_qty,
      srate=p_srate,prate=p_prate,urate=p_urate
  WHERE id=v_item_id;

  IF v_delta<>0 THEN
    INSERT INTO public.stock_movements(branch_id,medicine_id,batch_id,movement_type,qty,ref_type,ref_id,created_by,reason)
    VALUES(v_branch,b.medicine_id,b.id,'adjustment',v_delta,'opening_stock_batch_edit',v_item_id,auth.uid(),
      'Opening-stock batch quantity corrected');
  END IF;

  UPDATE public.medicines SET mrp=round(p_urate,2),selling_price=round(p_urate,2),
    purchase_price=round(p_prate/p_pack_size,4)
  WHERE id=b.medicine_id AND branch_id=v_branch;

  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  VALUES(v_branch,auth.uid(),'opening_stock_batch_edited','medicine_batch',b.id::text,
    'Submitted opening-stock batch corrected',v_old,
    jsonb_build_object('batch_no',trim(p_batch_no),'expiry',p_expiry,'qty',v_new_qty,
      'pack_size',p_pack_size,'pack_qty',p_pack_qty,'srate',p_srate,'prate',p_prate,'urate',p_urate),now());
END;
$$;

REVOKE ALL ON FUNCTION public.opening_stock_edit_submitted_batch(uuid,text,date,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.opening_stock_edit_submitted_batch(uuid,text,date,numeric,numeric,numeric,numeric,numeric) TO authenticated;
