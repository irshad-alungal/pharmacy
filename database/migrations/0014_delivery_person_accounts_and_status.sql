-- PALLIKKAL PHARMACY: delivery-person accounts, assignments and persistent status.
-- Apply after the branch-aware profile/role and sales migrations.
BEGIN;

-- Delivery role is the lowest-privilege account type. admin-staff Edge Function
-- uses rank ordering to prevent an administrator creating an equal/higher role.
INSERT INTO public.roles (code, name, rank)
SELECT 'delivery_person', 'Delivery Person', COALESCE(MAX(rank), 0) + 10
FROM public.roles
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, rank = EXCLUDED.rank;


-- complete_password_change() already exists in this project.
-- Preserve its deployed return type and implementation; only retain its
-- authenticated execution grants for the existing password-change flow.
REVOKE ALL ON FUNCTION public.complete_password_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_password_change() TO authenticated;

CREATE TABLE IF NOT EXISTS public.delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  is_requested boolean NOT NULL DEFAULT false,
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','out','done')),
  requested_by uuid REFERENCES public.profiles(id),
  assigned_by uuid REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id),
  requested_at timestamptz,
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS delivery_jobs_branch_requested_idx
  ON public.delivery_jobs(branch_id, is_requested, status, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_jobs_assigned_idx
  ON public.delivery_jobs(branch_id, assigned_to, status);

ALTER TABLE public.delivery_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_jobs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.delivery_management_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  IF v_role NOT IN ('super_admin','admin','admin_staff','pharmacist','billing_staff','billing') THEN
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

CREATE OR REPLACE FUNCTION public.delivery_set_request(
  p_invoice_id uuid,
  p_requested boolean
)
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
  IF v_role NOT IN ('super_admin','admin','admin_staff','pharmacist','billing_staff','billing') THEN
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

CREATE OR REPLACE FUNCTION public.delivery_assign(
  p_invoice_id uuid,
  p_delivery_person_id uuid
)
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
  IF v_role NOT IN ('super_admin','admin','admin_staff','pharmacist','billing_staff','billing') THEN
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

CREATE OR REPLACE FUNCTION public.delivery_my_jobs()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := public.my_role();
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR v_role <> 'delivery_person' THEN
    RAISE EXCEPTION 'Delivery-person login is required';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'invoice_no', i.invoice_no, 'total', i.total, 'created_at', i.created_at,
    'customer', jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address),
    'status', d.status, 'updated_at', d.updated_at
  ) ORDER BY d.assigned_at DESC), '[]'::jsonb)
  INTO v_result
  FROM public.delivery_jobs d
  JOIN public.sales_invoices i ON i.id = d.invoice_id AND i.branch_id = v_branch
  LEFT JOIN public.customers c ON c.id = i.customer_id AND c.branch_id = v_branch
  WHERE d.branch_id = v_branch AND d.assigned_to = auth.uid() AND d.is_requested = true;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delivery_update_status(
  p_invoice_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := public.my_role();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR v_role <> 'delivery_person' THEN
    RAISE EXCEPTION 'Delivery-person login is required';
  END IF;
  IF p_status NOT IN ('out','done') THEN RAISE EXCEPTION 'Unsupported delivery status'; END IF;

  UPDATE public.delivery_jobs
  SET status = p_status, updated_by = auth.uid(), updated_at = now()
  WHERE branch_id = v_branch AND invoice_id = p_invoice_id
    AND assigned_to = auth.uid() AND is_requested = true
    AND ((p_status = 'out' AND status = 'pending') OR (p_status = 'done' AND status = 'out'));
  IF NOT FOUND THEN RAISE EXCEPTION 'This delivery is not assigned to you or the requested status transition is not allowed'; END IF;

  INSERT INTO public.audit_logs(branch_id,user_id,action,entity_type,entity_id,after_data,at)
  VALUES (v_branch,auth.uid(),'delivery_status_updated','sales_invoice',p_invoice_id::text,
          jsonb_build_object('status',p_status),now());
END;
$function$;

REVOKE ALL ON FUNCTION public.delivery_management_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_set_request(uuid,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_assign(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_my_jobs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_update_status(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_management_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_set_request(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_assign(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_my_jobs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_update_status(uuid,text) TO authenticated;

COMMIT;
