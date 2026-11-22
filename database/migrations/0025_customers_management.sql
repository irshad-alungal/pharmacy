-- =============================================================================
-- 0025 · Customers management: customer ID, loyalty membership, birthday,
--        notes and one-call customer statistics for the Customers page
--
-- Adds (nothing existing is removed or changed in behaviour):
--   • customers.customer_no        — CUS-00001, CUS-00002 … per branch, given
--                                    automatically to every new customer (also
--                                    customers created from Billing) and back-filled
--   • customers.loyalty_member, loyalty_joined_at — loyalty programme enrolment
--   • customers.dob, customers.notes
--   • customer_stats()             — bills, spend, returns, first/last bill, last
--                                    12 months spend and credit outstanding for every
--                                    customer of the branch, in one call
-- Roles for customer_stats: super_admin, admin, pharmacist, billing_staff
-- (the same roles that can see customer credit). Safe to run twice.
-- =============================================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_no text,
  ADD COLUMN IF NOT EXISTS loyalty_member boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS loyalty_joined_at timestamptz,
  ADD COLUMN IF NOT EXISTS dob date,
  ADD COLUMN IF NOT EXISTS notes text;

-- Number new customers per branch: CUS-00001 …
CREATE OR REPLACE FUNCTION public.customers_assign_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_next int;
BEGIN
  IF TG_OP = 'INSERT' AND (NEW.customer_no IS NULL OR trim(NEW.customer_no) = '') THEN
    PERFORM pg_advisory_xact_lock(hashtext('customer_no:' || NEW.branch_id::text));
    SELECT COALESCE(max(nullif(regexp_replace(customer_no, '^CUS-', ''), '')::int), 0) + 1 INTO v_next
    FROM public.customers WHERE branch_id = NEW.branch_id AND customer_no ~ '^CUS-[0-9]+$';
    NEW.customer_no := 'CUS-' || lpad(v_next::text, 5, '0');
  ELSIF TG_OP = 'UPDATE' AND OLD.customer_no IS NOT NULL THEN
    NEW.customer_no := OLD.customer_no;   -- the ID never changes once given
  END IF;
  IF NEW.loyalty_member AND (TG_OP = 'INSERT' OR NOT OLD.loyalty_member) AND NEW.loyalty_joined_at IS NULL THEN
    NEW.loyalty_joined_at := now();
  END IF;
  IF TG_OP = 'UPDATE' AND NOT NEW.loyalty_member AND OLD.loyalty_member THEN
    NEW.loyalty_joined_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS customers_assign_no_trg ON public.customers;
CREATE TRIGGER customers_assign_no_trg BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_assign_no();

-- Back-fill existing customers in the order they were created.
DO $$
DECLARE b record;
BEGIN
  FOR b IN SELECT DISTINCT branch_id FROM public.customers WHERE customer_no IS NULL LOOP
    WITH base AS (
      SELECT COALESCE(max(nullif(regexp_replace(customer_no, '^CUS-', ''), '')::int), 0) AS n
      FROM public.customers WHERE branch_id = b.branch_id AND customer_no ~ '^CUS-[0-9]+$'),
    todo AS (
      SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
      FROM public.customers WHERE branch_id = b.branch_id AND customer_no IS NULL)
    UPDATE public.customers c SET customer_no = 'CUS-' || lpad((base.n + todo.rn)::text, 5, '0')
    FROM todo, base WHERE c.id = todo.id;
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS customers_branch_customer_no_key ON public.customers(branch_id, customer_no);

GRANT SELECT (customer_no, loyalty_member, loyalty_joined_at, dob, notes) ON public.customers TO authenticated;
GRANT INSERT (loyalty_member, dob, notes), UPDATE (loyalty_member, dob, notes) ON public.customers TO authenticated;

-- Statistics for every customer of my branch in one call.
DROP FUNCTION IF EXISTS public.customer_stats();
CREATE FUNCTION public.customer_stats()
RETURNS TABLE (
  customer_id uuid, bills integer, spent numeric, returned numeric,
  first_bill timestamptz, last_bill timestamptz, spent_12m numeric, outstanding numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin','pharmacist','billing_staff','billing') THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  RETURN QUERY
  SELECT c.id,
         COALESCE(s.n, 0)::integer,
         round(COALESCE(s.total, 0), 2),
         round(COALESCE(r.total, 0), 2),
         s.first_at, s.last_at,
         round(COALESCE(s.total_12m, 0), 2),
         round(public.customer_outstanding(c.id), 2)
  FROM public.customers c
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, sum(i.total) AS total, min(i.created_at) AS first_at, max(i.created_at) AS last_at,
           sum(i.total) FILTER (WHERE i.created_at >= now() - interval '12 months') AS total_12m
    FROM public.sales_invoices i
    WHERE i.branch_id = v_branch AND i.customer_id = c.id AND i.status = 'final') s ON true
  LEFT JOIN LATERAL (
    SELECT sum(x.total) AS total FROM public.sales_returns x
    WHERE x.branch_id = v_branch AND x.customer_id = c.id) r ON true
  WHERE c.branch_id = v_branch;
END;
$$;
REVOKE ALL ON FUNCTION public.customer_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_stats() TO authenticated;
