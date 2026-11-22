-- Read-only checks after running 0029_reports_analytics.sql. Every row should say true.
SELECT 'reports functions installed' AS check_name, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND p.proname IN ('_reports_figures','reports_overview','reports_sales_by_category','report_run_log','report_runs_list','report_run_delete')) = 6 AS ok
UNION ALL SELECT 'report history table', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'report_runs')
UNION ALL SELECT 'report history is RPC-only (RLS on, no direct read)', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.report_runs'::regclass) AND NOT has_table_privilege('authenticated', 'public.report_runs', 'SELECT')
UNION ALL SELECT 'anon cannot read the overview', NOT has_function_privilege('anon', 'public.reports_overview(date,date)', 'EXECUTE')
UNION ALL SELECT 'signed-in users can call the overview', has_function_privilege('authenticated', 'public.reports_overview(date,date)', 'EXECUTE')
UNION ALL SELECT 'existing report_* functions still in place', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'report\_%' AND p.proname NOT IN ('report_run_log','report_runs_list','report_run_delete')) >= 13;
