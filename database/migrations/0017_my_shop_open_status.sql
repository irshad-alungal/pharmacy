-- Read the authenticated user's own branch shop status for the Billing toggle.
-- Public visitors continue to use public_shop_is_open(), which exposes only
-- the aggregate open/closed value.
BEGIN;

CREATE OR REPLACE FUNCTION public.my_shop_open_status()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL
     OR NOT COALESCE(app.session_ok(), false) THEN
    RAISE EXCEPTION 'An active authorised branch session is required';
  END IF;

  RETURN COALESCE((
    SELECT s.is_open
    FROM public.branch_shop_status AS s
    WHERE s.branch_id = v_branch
  ), false);
END;
$function$;

REVOKE ALL ON FUNCTION public.my_shop_open_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_shop_open_status() TO authenticated;

COMMIT;
