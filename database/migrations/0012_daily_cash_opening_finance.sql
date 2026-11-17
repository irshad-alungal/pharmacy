-- PALLIKKAL PHARMACY: persist the Billing daily cash opening in Finance.
-- Run once in Supabase SQL Editor after migration 0010.
BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_cash_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  opening_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  journal_id uuid,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, opening_date)
);

CREATE INDEX IF NOT EXISTS daily_cash_openings_branch_date_idx
  ON public.daily_cash_openings(branch_id, opening_date DESC);

ALTER TABLE public.daily_cash_openings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_cash_openings FROM anon, authenticated;
GRANT SELECT ON public.daily_cash_openings TO authenticated;

DROP POLICY IF EXISTS daily_cash_openings_branch_read ON public.daily_cash_openings;
CREATE POLICY daily_cash_openings_branch_read
ON public.daily_cash_openings FOR SELECT TO authenticated
USING (
  branch_id = public.my_branch_id()
  AND COALESCE(public.my_role(),'') IN ('super_admin','admin')
);

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
  IF auth.uid() IS NULL OR v_branch IS NULL THEN
    RAISE EXCEPTION 'Login and active branch required';
  END IF;
  IF COALESCE(public.my_role(),'') NOT IN
    ('super_admin','admin','pharmacist','billing','billing_staff') THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  SELECT jsonb_build_object(
    'id', id, 'opening_date', opening_date, 'amount', amount
  ) INTO v_result
  FROM public.daily_cash_openings
  WHERE branch_id = v_branch AND opening_date = p_opening_date;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_daily_cash_opening(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_cash_opening(date) TO authenticated;

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
  IF auth.uid() IS NULL OR v_branch IS NULL THEN
    RAISE EXCEPTION 'Login and active branch required';
  END IF;

  IF COALESCE(public.my_role(),'') NOT IN
    ('super_admin','admin','pharmacist','billing','billing_staff') THEN
    RAISE EXCEPTION 'Not authorised to record daily cash opening';
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

  -- A zero opening is still recorded in the daily table, but creates no
  -- zero-value journal lines. Positive cash is posted into the Finance ledger.
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
    RAISE EXCEPTION 'Daily cash opening is already recorded for this branch and date. Contact Admin if it needs correction.';
END;
$function$;

REVOKE ALL ON FUNCTION public.record_daily_cash_opening(date,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_daily_cash_opening(date,numeric) TO authenticated;

COMMIT;
