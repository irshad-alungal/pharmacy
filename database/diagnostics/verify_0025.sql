-- Read-only checks after running 0025_customers_management.sql. Every row should say true.
SELECT 'new customer columns' AS check_name, count(*) = 5 AS ok FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'customers' AND column_name IN ('customer_no','loyalty_member','loyalty_joined_at','dob','notes')
UNION ALL SELECT 'every customer has an ID', NOT EXISTS (SELECT 1 FROM public.customers WHERE customer_no IS NULL)
UNION ALL SELECT 'IDs unique per branch', NOT EXISTS (SELECT 1 FROM public.customers GROUP BY branch_id, customer_no HAVING count(*) > 1)
UNION ALL SELECT 'numbering trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'customers_assign_no_trg')
UNION ALL SELECT 'customer_stats function', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'customer_stats');
