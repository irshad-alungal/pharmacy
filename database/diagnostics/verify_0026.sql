-- Read-only checks after running 0026_sales_management.sql. Every row should say true.
SELECT 'sales functions installed' AS check_name, count(*) = 5 AS ok FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('_sales_guard','sales_list','sales_summary','sales_daily','sales_top_medicines')
UNION ALL SELECT 'anon cannot run sales_list', NOT has_function_privilege('anon', 'public.sales_list(date,date)', 'EXECUTE')
UNION ALL SELECT 'signed-in users can run sales_summary', has_function_privilege('authenticated', 'public.sales_summary(date,date,timestamptz)', 'EXECUTE')
UNION ALL SELECT 'index on bills by branch and date', EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'sales_invoices_branch_created_idx');
