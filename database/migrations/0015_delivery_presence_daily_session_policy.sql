-- PALLIKKAL PHARMACY: daily-only login sessions and delivery-person availability.
-- Run after 0014_delivery_person_accounts_and_status.sql.
BEGIN;

-- Keep sessions valid for the whole branch workday. Inactivity is NOT a
-- logout condition. A fresh login is still required on the next IST date.
CREATE OR REPLACE FUNCTION app.session_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.work_sessions ws
      ON ws.user_id = p.id
     AND ws.branch_id = p.branch_id
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.branch_id IS NOT NULL
      AND p.must_change_password = false
      AND ws.logout_at IS NULL
      AND ws.work_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
  );
$function$;

-- Touching a session only updates activity. It never expires a session due
-- to inactivity; the work_date boundary enforces the next-day login.
CREATE OR REPLACE FUNCTION public.touch_work_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.work_sessions ws
     SET last_activity_at = now()
   WHERE ws.user_id = auth.uid()
     AND ws.logout_at IS NULL
     AND ws.work_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND EXISTS (
       SELECT 1
       FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.is_active = true
         AND p.branch_id = ws.branch_id
         AND p.must_change_password = false
     );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$function$;

REVOKE ALL ON FUNCTION app.session_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.session_ok() TO authenticated;
REVOKE ALL ON FUNCTION public.touch_work_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_work_session() TO authenticated;

-- Each delivery person has one branch-scoped presence state.
CREATE TABLE IF NOT EXISTS public.delivery_person_presence (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'offline'
    CHECK (status IN ('available', 'purchasing', 'offline')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivery_person_presence_branch_status_idx
  ON public.delivery_person_presence(branch_id, status, updated_at DESC);

ALTER TABLE public.delivery_person_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_person_presence FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delivery_set_presence(p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL
     OR public.my_role() <> 'delivery_person'
     OR NOT COALESCE(app.session_ok(), false) THEN
    RAISE EXCEPTION 'An active delivery-person daily login is required';
  END IF;

  IF p_status NOT IN ('available', 'purchasing', 'offline') THEN
    RAISE EXCEPTION 'Invalid delivery availability status';
  END IF;

  INSERT INTO public.delivery_person_presence(profile_id, branch_id, status, updated_at)
  VALUES (auth.uid(), v_branch, p_status, now())
  ON CONFLICT (profile_id) DO UPDATE
    SET branch_id = EXCLUDED.branch_id,
        status = EXCLUDED.status,
        updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.delivery_presence_my_status()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $function$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR public.my_role() <> 'delivery_person'
     OR NOT COALESCE(app.session_ok(), false) THEN
    RAISE EXCEPTION 'An active delivery-person daily login is required';
  END IF;

  SELECT status INTO v_status
  FROM public.delivery_person_presence
  WHERE profile_id = auth.uid()
    AND branch_id = public.my_branch_id();

  RETURN COALESCE(v_status, 'offline');
END;
$function$;

CREATE OR REPLACE FUNCTION public.delivery_presence_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
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
     OR v_role NOT IN ('super_admin', 'admin', 'pharmacist', 'billing_staff', 'billing')
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

REVOKE ALL ON FUNCTION public.delivery_set_presence(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_presence_my_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delivery_presence_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_set_presence(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_presence_my_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_presence_summary() TO authenticated;

COMMIT;
