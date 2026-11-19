-- =============================================================================
-- 0022 · Delivery management v2 (admin Delivery page + Delivery Boy dashboard)
--
-- Adds, without changing existing behaviour:
--   • a "failed" (failed / returned) delivery status with a reason
--   • status timestamps (out / delivered / failed), stamped by a trigger so the
--     existing delivery_update_status() and delivery_assign() also record them
--   • per-delivery address / phone / note (for walk-in bills or another address)
--   • rider-reported issues
--   • a branch delivery fee; each completed delivery records the fee it earned
--   • delivery_management_list_v2(), delivery_my_jobs_v2() and small RPCs used
--     by the new pages
-- Existing functions (delivery_management_list, delivery_my_jobs,
-- delivery_set_request, delivery_assign, delivery_update_status, presence RPCs)
-- are left exactly as they are. Safe to run more than once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 · delivery_jobs: new status + columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.delivery_jobs DROP CONSTRAINT IF EXISTS delivery_jobs_status_check;
ALTER TABLE public.delivery_jobs ADD CONSTRAINT delivery_jobs_status_check
  CHECK (status IN ('pending', 'out', 'done', 'failed'));

ALTER TABLE public.delivery_jobs
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_phone   text,
  ADD COLUMN IF NOT EXISTS delivery_note    text,
  ADD COLUMN IF NOT EXISTS out_at           timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at     timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason   text,
  ADD COLUMN IF NOT EXISTS issue_note       text,
  ADD COLUMN IF NOT EXISTS issue_at         timestamptz,
  ADD COLUMN IF NOT EXISTS fee_earned       numeric(10,2);

CREATE INDEX IF NOT EXISTS delivery_jobs_assigned_idx ON public.delivery_jobs(branch_id, assigned_to, status);
CREATE INDEX IF NOT EXISTS delivery_jobs_requested_idx ON public.delivery_jobs(branch_id, is_requested, requested_at DESC);

-- ---------------------------------------------------------------------------
-- 2 · Branch delivery settings (fee paid per completed delivery)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_settings (
  branch_id        uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  fee_per_delivery numeric(10,2) NOT NULL DEFAULT 0 CHECK (fee_per_delivery >= 0 AND fee_per_delivery <= 100000),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES public.profiles(id)
);
ALTER TABLE public.delivery_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delivery_settings_read ON public.delivery_settings;
CREATE POLICY delivery_settings_read ON public.delivery_settings FOR SELECT TO authenticated
  USING (branch_id = public.my_branch_id());
REVOKE ALL ON public.delivery_settings FROM PUBLIC, anon;
GRANT SELECT ON public.delivery_settings TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Trigger: stamp status times and the earned fee on every status change
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delivery_jobs_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'out' THEN
    NEW.out_at := COALESCE(NEW.out_at, now());
  ELSIF NEW.status = 'done' THEN
    NEW.delivered_at := now();
    NEW.fee_earned := COALESCE((SELECT fee_per_delivery FROM public.delivery_settings s WHERE s.branch_id = NEW.branch_id), 0);
  ELSIF NEW.status = 'failed' THEN
    NEW.failed_at := now();
  ELSIF NEW.status = 'pending' THEN
    -- (re)assignment or request reset starts a fresh attempt
    NEW.out_at := NULL;
    NEW.delivered_at := NULL;
    NEW.fee_earned := NULL;
    IF TG_OP = 'UPDATE' AND OLD.status = 'failed' THEN
      NEW.failed_at := NULL;
      NEW.failure_reason := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS delivery_jobs_stamp ON public.delivery_jobs;
CREATE TRIGGER delivery_jobs_stamp BEFORE INSERT OR UPDATE ON public.delivery_jobs
  FOR EACH ROW EXECUTE FUNCTION public.delivery_jobs_stamp();

-- Backfill times for jobs that already moved on before this migration.
UPDATE public.delivery_jobs SET out_at = COALESCE(out_at, updated_at) WHERE status IN ('out','done') AND out_at IS NULL;
UPDATE public.delivery_jobs SET delivered_at = COALESCE(delivered_at, updated_at) WHERE status = 'done' AND delivered_at IS NULL;

-- Helper: roles that manage deliveries (same list as the existing RPCs)
CREATE OR REPLACE FUNCTION public.delivery_is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.uid() IS NOT NULL AND public.my_branch_id() IS NOT NULL
     AND COALESCE(public.my_role(), '') IN ('super_admin','admin','admin_staff','pharmacist','billing_staff','billing');
$$;

-- ---------------------------------------------------------------------------
-- 4 · Management list v2 (recent final bills + every requested delivery)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delivery_management_list_v2(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_since timestamptz := now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 90), 730)));
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NOT public.delivery_is_manager() THEN
    RAISE EXCEPTION 'Not authorised to manage deliveries';
  END IF;

  RETURN jsonb_build_object(
    'invoices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id,
        'invoice_no', i.invoice_no,
        'customer_id', i.customer_id,
        'total', i.total,
        'created_at', i.created_at,
        'customer', jsonb_build_object(
          'id', c.id,
          'name', COALESCE(c.name, NULLIF(i.patient_name, '')),
          'phone', COALESCE(NULLIF(d.delivery_phone, ''), c.phone, NULLIF(i.patient_phone, '')),
          'address', COALESCE(NULLIF(d.delivery_address, ''), c.address, NULLIF(i.patient_address, ''))
        ),
        'delivery', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', d.id, 'is_requested', d.is_requested, 'assigned_to', d.assigned_to, 'status', d.status,
          'requested_at', d.requested_at, 'assigned_at', d.assigned_at, 'updated_at', d.updated_at,
          'out_at', d.out_at, 'delivered_at', d.delivered_at, 'failed_at', d.failed_at,
          'failure_reason', d.failure_reason, 'issue_note', d.issue_note, 'issue_at', d.issue_at,
          'delivery_address', d.delivery_address, 'delivery_phone', d.delivery_phone, 'delivery_note', d.delivery_note,
          'fee_earned', d.fee_earned
        ) END,
        'delivery_person', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', p.id, 'staff_id', p.staff_id, 'full_name', p.full_name, 'phone', p.phone
        ) END
      ) ORDER BY COALESCE(d.requested_at, i.created_at) DESC)
      FROM public.sales_invoices i
      LEFT JOIN public.customers c ON c.id = i.customer_id AND c.branch_id = v_branch
      LEFT JOIN public.delivery_jobs d ON d.invoice_id = i.id AND d.branch_id = v_branch
      LEFT JOIN public.profiles p ON p.id = d.assigned_to AND p.branch_id = v_branch
      WHERE i.branch_id = v_branch AND i.status = 'final'
        AND (i.created_at >= v_since OR d.is_requested = true)
    ), '[]'::jsonb),
    'delivery_people', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'staff_id', p.staff_id, 'full_name', p.full_name, 'phone', p.phone,
        'presence', COALESCE(pr.status, 'offline'), 'presence_at', pr.updated_at,
        'active_orders', (SELECT count(*) FROM public.delivery_jobs j WHERE j.branch_id = v_branch AND j.assigned_to = p.id AND j.is_requested AND j.status IN ('pending','out')),
        'delivered_today', (SELECT count(*) FROM public.delivery_jobs j WHERE j.branch_id = v_branch AND j.assigned_to = p.id AND j.status = 'done' AND (j.delivered_at AT TIME ZONE 'Asia/Kolkata')::date = v_today),
        'assigned_today', (SELECT count(*) FROM public.delivery_jobs j WHERE j.branch_id = v_branch AND j.assigned_to = p.id AND j.is_requested AND (j.assigned_at AT TIME ZONE 'Asia/Kolkata')::date = v_today)
      ) ORDER BY (COALESCE(pr.status, 'offline') = 'offline'), p.full_name)
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      LEFT JOIN public.delivery_person_presence pr ON pr.profile_id = p.id AND pr.branch_id = v_branch
      WHERE p.branch_id = v_branch AND p.is_active = true AND r.code = 'delivery_person'
    ), '[]'::jsonb),
    'settings', jsonb_build_object('fee_per_delivery',
      COALESCE((SELECT fee_per_delivery FROM public.delivery_settings s WHERE s.branch_id = v_branch), 0)),
    'days', GREATEST(1, LEAST(COALESCE(p_days, 90), 730))
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5 · Delivery address / phone / note for a requested delivery
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delivery_set_details(
  p_invoice_id uuid, p_address text DEFAULT NULL, p_phone text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
BEGIN
  IF NOT public.delivery_is_manager() THEN
    RAISE EXCEPTION 'Not authorised to update deliveries';
  END IF;
  UPDATE public.delivery_jobs
  SET delivery_address = NULLIF(left(trim(COALESCE(p_address, '')), 400), ''),
      delivery_phone   = NULLIF(left(regexp_replace(COALESCE(p_phone, ''), '[^0-9+ ]', '', 'g'), 20), ''),
      delivery_note    = NULLIF(left(trim(COALESCE(p_note, '')), 500), ''),
      updated_by = auth.uid(), updated_at = now()
  WHERE branch_id = v_branch AND invoice_id = p_invoice_id AND is_requested = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mark this invoice as delivery requested first'; END IF;
  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,after_data,at)
  VALUES (v_branch, auth.uid(), 'delivery_details_updated', 'sales_invoice', p_invoice_id::text,
          jsonb_build_object('address', p_address, 'phone', p_phone, 'note', p_note), now());
END;
$$;

-- ---------------------------------------------------------------------------
-- 6 · Branch delivery fee (admins)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delivery_settings_set(p_fee_per_delivery numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_fee numeric := round(COALESCE(p_fee_per_delivery, 0), 2);
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN
    RAISE EXCEPTION 'Only an administrator can change delivery settings';
  END IF;
  IF v_fee < 0 OR v_fee > 100000 THEN RAISE EXCEPTION 'Delivery fee must be between 0 and 100000'; END IF;
  INSERT INTO public.delivery_settings(branch_id, fee_per_delivery, updated_at, updated_by)
  VALUES (v_branch, v_fee, now(), auth.uid())
  ON CONFLICT (branch_id) DO UPDATE SET fee_per_delivery = EXCLUDED.fee_per_delivery, updated_at = now(), updated_by = auth.uid();
  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,after_data,at)
  VALUES (v_branch, auth.uid(), 'delivery_settings_changed', 'branch', v_branch::text, jsonb_build_object('fee_per_delivery', v_fee), now());
  RETURN v_fee;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7 · Rider: my jobs v2, status v2 (adds failed / returned), report issue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delivery_my_jobs_v2()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'app', 'pg_temp'
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR COALESCE(public.my_role(), '') <> 'delivery_person'
     OR NOT COALESCE(app.session_ok(), false) THEN
    RAISE EXCEPTION 'An active delivery-person daily login is required';
  END IF;
  RETURN jsonb_build_object(
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'invoice_no', i.invoice_no, 'total', i.total, 'created_at', i.created_at,
        'customer', jsonb_build_object(
          'name', COALESCE(c.name, NULLIF(i.patient_name, ''), 'Walk-in customer'),
          'phone', COALESCE(NULLIF(d.delivery_phone, ''), c.phone, NULLIF(i.patient_phone, '')),
          'address', COALESCE(NULLIF(d.delivery_address, ''), c.address, NULLIF(i.patient_address, ''))
        ),
        'note', d.delivery_note,
        'status', d.status, 'updated_at', d.updated_at, 'requested_at', d.requested_at, 'assigned_at', d.assigned_at,
        'out_at', d.out_at, 'delivered_at', d.delivered_at, 'failed_at', d.failed_at,
        'failure_reason', d.failure_reason, 'issue_note', d.issue_note, 'issue_at', d.issue_at,
        'fee_earned', d.fee_earned
      ) ORDER BY COALESCE(d.assigned_at, d.requested_at) DESC)
      FROM public.delivery_jobs d
      JOIN public.sales_invoices i ON i.id = d.invoice_id AND i.branch_id = v_branch
      LEFT JOIN public.customers c ON c.id = i.customer_id AND c.branch_id = v_branch
      WHERE d.branch_id = v_branch AND d.assigned_to = auth.uid() AND d.is_requested = true
    ), '[]'::jsonb),
    'fee_per_delivery', COALESCE((SELECT fee_per_delivery FROM public.delivery_settings s WHERE s.branch_id = v_branch), 0),
    'me', (SELECT jsonb_build_object('full_name', p.full_name, 'staff_id', p.staff_id, 'phone', p.phone)
           FROM public.profiles p WHERE p.id = auth.uid()),
    'branch', (SELECT jsonb_build_object('name', b.name, 'phone', b.phone, 'address', b.address, 'city', b.city)
               FROM public.branches b WHERE b.id = v_branch),
    'presence', COALESCE((SELECT status FROM public.delivery_person_presence pr WHERE pr.profile_id = auth.uid()), 'offline')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delivery_update_status_v2(p_invoice_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app', 'pg_temp'
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_note text := NULLIF(left(trim(COALESCE(p_note, '')), 500), '');
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR COALESCE(public.my_role(), '') <> 'delivery_person'
     OR NOT COALESCE(app.session_ok(), false) THEN
    RAISE EXCEPTION 'An active delivery-person daily login is required';
  END IF;
  IF p_status NOT IN ('out', 'done', 'failed') THEN RAISE EXCEPTION 'Unsupported delivery status'; END IF;
  IF p_status = 'failed' AND v_note IS NULL THEN RAISE EXCEPTION 'Enter the reason the delivery failed or was returned'; END IF;

  UPDATE public.delivery_jobs
  SET status = p_status,
      failure_reason = CASE WHEN p_status = 'failed' THEN v_note ELSE failure_reason END,
      updated_by = auth.uid(), updated_at = now()
  WHERE branch_id = v_branch AND invoice_id = p_invoice_id
    AND assigned_to = auth.uid() AND is_requested = true
    AND ((p_status = 'out' AND status = 'pending')
      OR (p_status = 'done' AND status = 'out')
      OR (p_status = 'failed' AND status IN ('pending', 'out')));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This delivery is not assigned to you or the requested status change is not allowed';
  END IF;

  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,after_data,at)
  VALUES (v_branch, auth.uid(), 'delivery_status_updated', 'sales_invoice', p_invoice_id::text,
          jsonb_build_object('status', p_status, 'note', v_note), now());
  RETURN p_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.delivery_report_issue(p_invoice_id uuid, p_issue text, p_mark_failed boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app', 'pg_temp'
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_issue text := NULLIF(left(trim(COALESCE(p_issue, '')), 500), '');
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR COALESCE(public.my_role(), '') <> 'delivery_person'
     OR NOT COALESCE(app.session_ok(), false) THEN
    RAISE EXCEPTION 'An active delivery-person daily login is required';
  END IF;
  IF v_issue IS NULL THEN RAISE EXCEPTION 'Describe the issue'; END IF;

  SELECT status INTO v_status FROM public.delivery_jobs
  WHERE branch_id = v_branch AND invoice_id = p_invoice_id AND assigned_to = auth.uid() AND is_requested = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'This delivery is not assigned to you'; END IF;
  IF COALESCE(p_mark_failed, false) AND v_status NOT IN ('pending', 'out') THEN
    RAISE EXCEPTION 'Only a pending or out-for-delivery order can be marked failed / returned';
  END IF;

  UPDATE public.delivery_jobs
  SET issue_note = v_issue, issue_at = now(),
      status = CASE WHEN COALESCE(p_mark_failed, false) THEN 'failed' ELSE status END,
      failure_reason = CASE WHEN COALESCE(p_mark_failed, false) THEN v_issue ELSE failure_reason END,
      updated_by = auth.uid(), updated_at = now()
  WHERE branch_id = v_branch AND invoice_id = p_invoice_id AND assigned_to = auth.uid();

  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,after_data,at)
  VALUES (v_branch, auth.uid(), 'delivery_issue_reported', 'sales_invoice', p_invoice_id::text,
          jsonb_build_object('issue', v_issue, 'marked_failed', COALESCE(p_mark_failed, false)), now());
  RETURN CASE WHEN COALESCE(p_mark_failed, false) THEN 'failed' ELSE v_status END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8 · Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.delivery_jobs_stamp() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delivery_is_manager() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_management_list_v2(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_set_details(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_settings_set(numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_my_jobs_v2() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_update_status_v2(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_report_issue(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_is_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_management_list_v2(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_set_details(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_settings_set(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_my_jobs_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_update_status_v2(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_report_issue(uuid, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
