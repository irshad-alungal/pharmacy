-- PALLIKKAL PHARMACY: shared shop open/closed status.
-- Apply after the existing daily-session and delivery-presence migrations.
BEGIN;

CREATE TABLE IF NOT EXISTS public.branch_shop_status (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  is_open boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.branch_shop_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.branch_shop_status FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_shop_open_status(p_is_open boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_role text := public.my_role();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL
     OR v_role NOT IN ('super_admin', 'admin', 'pharmacist', 'billing_staff')
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

-- Public website may read only the aggregate open/closed state.
-- If any branch is open, the public pharmacy website displays Shop Open.
CREATE OR REPLACE FUNCTION public.public_shop_is_open()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.branch_shop_status
    WHERE is_open = true
  );
$function$;

REVOKE ALL ON FUNCTION public.set_shop_open_status(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_shop_open_status(boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.public_shop_is_open() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_shop_is_open() TO anon, authenticated;

COMMIT;
