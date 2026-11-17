-- PALLIKKAL PHARMACY: allow any active branch staff member to complete
-- the once-per-branch/day cash opening during their first login.
-- Run once after 0012_daily_cash_opening_finance.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_daily_cash_opening(
  p_opening_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR public.my_role() IS NULL THEN
    RAISE EXCEPTION 'Login with an active branch staff profile is required';
  END IF;

  SELECT jsonb_build_object(
    'id', id, 'opening_date', opening_date, 'amount', amount
  ) INTO v_result
  FROM public.daily_cash_openings
  WHERE branch_id = v_branch AND opening_date = p_opening_date;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_daily_cash_opening(
  p_opening_date date,
  p_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_id uuid := gen_random_uuid();
  v_journal uuid;
BEGIN
  -- Any authenticated staff/admin profile assigned to this active branch may
  -- submit the branch-wide opening. UNIQUE(branch_id, opening_date) ensures
  -- that only the first submission can be recorded for that day.
  IF auth.uid() IS NULL OR v_branch IS NULL OR public.my_role() IS NULL THEN
    RAISE EXCEPTION 'Login with an active branch staff profile is required';
  END IF;

  IF p_opening_date IS NULL OR p_opening_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Invalid opening date';
  END IF;

  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 999999999999.99 THEN
    RAISE EXCEPTION 'Enter a valid non-negative opening amount';
  END IF;

  INSERT INTO public.daily_cash_openings (
    id, branch_id, opening_date, amount, created_by
  ) VALUES (
    v_id, v_branch, p_opening_date, round(p_amount,2), auth.uid()
  );

  IF round(p_amount,2) > 0 THEN
    v_journal := public.post_journal(
      'daily_cash_opening',
      v_id,
      'Daily cash opening - ' || to_char(p_opening_date, 'DD Mon YYYY'),
      jsonb_build_array(
        jsonb_build_object('account','cash','debit',round(p_amount,2),'credit',0),
        jsonb_build_object('account','opening_balance_equity','debit',0,'credit',round(p_amount,2))
      ),
      NULL
    );

    UPDATE public.daily_cash_openings
    SET journal_id = v_journal
    WHERE id = v_id;
  END IF;

  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Daily cash opening is already recorded for this branch and date. It cannot be submitted twice.';
END;
$function$;

REVOKE ALL ON FUNCTION public.get_daily_cash_opening(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_cash_opening(date) TO authenticated;
REVOKE ALL ON FUNCTION public.record_daily_cash_opening(date,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_daily_cash_opening(date,numeric) TO authenticated;

COMMIT;
