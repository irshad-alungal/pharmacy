-- ALZA Pharmacy: Initial / takeover stock with persistent draft and atomic posting.
-- Run once in Supabase SQL Editor. Does not alter confirm_purchase().

ALTER TABLE public.medicine_batches
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14,4);
DO $$ BEGIN
  ALTER TABLE public.medicine_batches ADD CONSTRAINT medicine_batches_unit_cost_check CHECK (unit_cost IS NULL OR unit_cost >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN (
    'purchase_in','sale_out','adjustment','return_in','return_out',
    'damage','transfer','expiry_writeoff','physical_count','opening_stock'
  ));

CREATE TABLE IF NOT EXISTS public.opening_stock_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL UNIQUE REFERENCES public.branches(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id),
  submitted_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.opening_stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.opening_stock_sessions(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  medicine_id uuid NOT NULL REFERENCES public.medicines(id),
  batch_no text NOT NULL CHECK (length(trim(batch_no)) > 0),
  expiry date NOT NULL,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  mrp numeric(14,2) NOT NULL CHECK (mrp >= 0),
  selling_price numeric(14,2) NOT NULL CHECK (selling_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, medicine_id, batch_no)
);

CREATE INDEX IF NOT EXISTS opening_stock_items_session_idx
  ON public.opening_stock_items(session_id);

ALTER TABLE public.opening_stock_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opening_stock_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opening_stock_sessions, public.opening_stock_items FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.opening_stock_get_draft()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); v_session public.opening_stock_sessions%rowtype; v_items jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  SELECT * INTO v_session FROM public.opening_stock_sessions WHERE branch_id=v_branch;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'medicine_id',i.medicine_id,'medicine_name',m.name,'strength',m.strength,
    'batch_no',i.batch_no,'expiry',i.expiry,'qty',i.qty,'unit_cost',i.unit_cost,
    'mrp',i.mrp,'selling_price',i.selling_price
  ) ORDER BY m.name,i.batch_no),'[]'::jsonb)
  INTO v_items FROM public.opening_stock_items i
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
DECLARE v_branch uuid := public.my_branch_id(); v_session public.opening_stock_sessions%rowtype; x jsonb; v_med uuid;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Add at least one stock batch'; END IF;
  IF jsonb_array_length(p_items) > 2000 THEN RAISE EXCEPTION 'Maximum 2,000 batch rows per draft'; END IF;
  INSERT INTO public.opening_stock_sessions(branch_id,status,notes,created_by,updated_by)
  VALUES(v_branch,'draft',nullif(trim(p_notes),''),auth.uid(),auth.uid())
  ON CONFLICT(branch_id) DO NOTHING;
  SELECT * INTO v_session FROM public.opening_stock_sessions WHERE branch_id=v_branch FOR UPDATE;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'Opening stock has already been submitted and is locked'; END IF;
  DELETE FROM public.opening_stock_items WHERE session_id=v_session.id;
  FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_med := (x->>'medicine_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.medicines m WHERE m.id=v_med AND m.branch_id=v_branch AND m.active) THEN
      RAISE EXCEPTION 'Medicine missing, inactive or outside this branch';
    END IF;
    IF coalesce(trim(x->>'batch_no'),'')='' OR nullif(x->>'expiry','') IS NULL
      OR coalesce((x->>'qty')::numeric,0)<=0
      OR coalesce((x->>'unit_cost')::numeric,-1)<0
      OR coalesce((x->>'mrp')::numeric,-1)<0
      OR coalesce((x->>'selling_price')::numeric,-1)<0 THEN
      RAISE EXCEPTION 'Invalid batch, expiry, quantity or price details';
    END IF;
    INSERT INTO public.opening_stock_items(session_id,branch_id,medicine_id,batch_no,expiry,qty,unit_cost,mrp,selling_price)
    VALUES(v_session.id,v_branch,v_med,trim(x->>'batch_no'),(x->>'expiry')::date,
      (x->>'qty')::numeric,(x->>'unit_cost')::numeric,(x->>'mrp')::numeric,(x->>'selling_price')::numeric);
  END LOOP;
  UPDATE public.opening_stock_sessions SET notes=nullif(trim(p_notes),''),updated_by=auth.uid(),updated_at=now()
  WHERE id=v_session.id;
  RETURN v_session.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.opening_stock_submit()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); v_session public.opening_stock_sessions%rowtype; i public.opening_stock_items%rowtype; v_batch uuid; v_count integer:=0; v_value numeric:=0;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  IF NOT coalesce(app.session_ok(),false) THEN RAISE EXCEPTION 'An active work session is required'; END IF;
  SELECT * INTO v_session FROM public.opening_stock_sessions WHERE branch_id=v_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No saved opening-stock draft'; END IF;
  IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'Opening stock has already been submitted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.opening_stock_items WHERE session_id=v_session.id) THEN RAISE EXCEPTION 'Draft is empty'; END IF;
  IF EXISTS (SELECT 1 FROM public.opening_stock_items WHERE session_id=v_session.id GROUP BY medicine_id HAVING count(DISTINCT (mrp,selling_price)) > 1) THEN
    RAISE EXCEPTION 'A medicine has different MRP or selling prices across its batches. The medicine master supports one price per medicine; make the prices consistent before submitting.';
  END IF;
  FOR i IN SELECT * FROM public.opening_stock_items WHERE session_id=v_session.id AND branch_id=v_branch ORDER BY id LOOP
    IF EXISTS (SELECT 1 FROM public.medicine_batches b WHERE b.medicine_id=i.medicine_id AND b.batch_no=i.batch_no) THEN
      RAISE EXCEPTION 'Batch % already exists for this medicine. Resolve the duplicate before submitting.',i.batch_no;
    END IF;
    INSERT INTO public.medicine_batches(branch_id,medicine_id,batch_no,expiry,qty,quarantined,unit_cost)
    VALUES(v_branch,i.medicine_id,i.batch_no,i.expiry,i.qty,(i.expiry<=current_date),i.unit_cost)
    RETURNING id INTO v_batch;
    INSERT INTO public.stock_movements(branch_id,medicine_id,batch_id,movement_type,qty,ref_type,ref_id,created_by,reason)
    VALUES(v_branch,i.medicine_id,v_batch,'opening_stock',i.qty,'opening_stock',v_session.id,auth.uid(),
      CASE WHEN i.expiry<=current_date THEN 'Takeover opening stock; expired batch quarantined' ELSE 'Pharmacy takeover opening stock' END);
    UPDATE public.medicines SET mrp=i.mrp,selling_price=i.selling_price WHERE id=i.medicine_id AND branch_id=v_branch;
    v_count:=v_count+1; v_value:=v_value+(i.qty*i.unit_cost);
  END LOOP;
  UPDATE public.opening_stock_sessions SET status='submitted',submitted_by=auth.uid(),submitted_at=now(),updated_at=now(),updated_by=auth.uid()
  WHERE id=v_session.id;
  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  VALUES(v_branch,auth.uid(),'opening_stock_submitted','opening_stock_session',v_session.id::text,
    'Initial takeover stock posted',jsonb_build_object('status','draft'),
    jsonb_build_object('status','submitted','batch_count',v_count,'stock_value',round(v_value,2)),now());
  RETURN v_session.id;
END;
$$;

REVOKE ALL ON FUNCTION public.opening_stock_get_draft(), public.opening_stock_save_draft(jsonb,text), public.opening_stock_submit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opening_stock_get_draft(), public.opening_stock_save_draft(jsonb,text), public.opening_stock_submit() TO authenticated;

-- Existing valuation now prefers the recorded batch-specific takeover cost, falling back to the
-- medicine's current purchase_price for all older/purchase-created batches.
CREATE OR REPLACE FUNCTION public.inventory_valuation()
RETURNS TABLE(cost_total numeric,cost_sellable numeric,cost_expired numeric,cost_quarantined numeric,retail_sellable numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF coalesce(public.my_role(),'') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  RETURN QUERY SELECT
    coalesce(sum(b.qty*coalesce(b.unit_cost,m.purchase_price,0)),0)::numeric,
    coalesce(sum(b.qty*coalesce(b.unit_cost,m.purchase_price,0)) FILTER (WHERE b.expiry>=current_date AND NOT b.quarantined),0)::numeric,
    coalesce(sum(b.qty*coalesce(b.unit_cost,m.purchase_price,0)) FILTER (WHERE b.expiry<current_date),0)::numeric,
    coalesce(sum(b.qty*coalesce(b.unit_cost,m.purchase_price,0)) FILTER (WHERE b.expiry>=current_date AND b.quarantined),0)::numeric,
    coalesce(sum(b.qty*m.selling_price) FILTER (WHERE b.expiry>=current_date AND NOT b.quarantined),0)::numeric
  FROM public.medicine_batches b JOIN public.medicines m ON m.id=b.medicine_id
  WHERE b.branch_id=public.my_branch_id();
END; $$;

-- Keep the existing inventory_batches result shape; cost value is batch-specific where available.
CREATE OR REPLACE FUNCTION public.inventory_batches(p_search text DEFAULT NULL)
RETURNS TABLE(batch_id uuid,medicine_id uuid,name text,strength text,batch_no text,expiry date,qty numeric,quarantined boolean,location text,status text,cost_value numeric,reorder_level numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT b.id,m.id,m.name,m.strength,b.batch_no,b.expiry,b.qty,b.quarantined,
    concat_ws(' ',m.shelf_location,m.rack),
    CASE WHEN b.expiry<current_date THEN 'expired' WHEN b.quarantined THEN 'quarantined' ELSE 'ok' END,
    CASE WHEN public.my_role() IN ('super_admin','admin') THEN round(b.qty*coalesce(b.unit_cost,m.purchase_price,0),2) END,
    m.reorder_level
  FROM public.medicine_batches b JOIN public.medicines m ON m.id=b.medicine_id
  WHERE b.branch_id=public.my_branch_id()
    AND public.my_role() IN ('super_admin','admin','pharmacist','inventory')
    AND (p_search IS NULL OR m.name ILIKE '%'||p_search||'%' OR b.batch_no ILIKE '%'||p_search||'%' OR m.barcode=p_search)
  ORDER BY m.name,b.expiry LIMIT 1000;
$$;
