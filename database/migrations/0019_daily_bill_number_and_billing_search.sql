-- Date-based, concurrency-safe bill numbers: YYYY-MM-DD-###
-- The counter is global per IST calendar date so invoice_no remains unique
-- across all branches sharing this Supabase project.
BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_invoice_counters (
  invoice_date date PRIMARY KEY,
  last_value integer NOT NULL CHECK (last_value > 0)
);

REVOKE ALL ON TABLE public.daily_invoice_counters FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assign_daily_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_date date;
  v_number integer;
BEGIN
  v_date := (COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Kolkata')::date;

  INSERT INTO public.daily_invoice_counters AS counters (invoice_date, last_value)
  VALUES (v_date, 1)
  ON CONFLICT (invoice_date)
  DO UPDATE SET last_value = counters.last_value + 1
  RETURNING last_value INTO v_number;

  NEW.invoice_no := to_char(v_date, 'YYYY-MM-DD') || '-' || lpad(v_number::text, 3, '0');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_assign_daily_invoice_number ON public.sales_invoices;
CREATE TRIGGER trg_assign_daily_invoice_number
BEFORE INSERT ON public.sales_invoices
FOR EACH ROW
EXECUTE FUNCTION public.assign_daily_invoice_number();

COMMIT;
