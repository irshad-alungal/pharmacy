-- Read-only checks after running 0027_returns_management.sql. Every row should say true.
SELECT 'new return columns' AS check_name,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_returns' AND column_name IN ('reason_code','refund_type')) = 2
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchase_returns' AND column_name='reason_code') AS ok
UNION ALL SELECT 'every sales return has a reason code', NOT EXISTS (SELECT 1 FROM public.sales_returns WHERE reason_code IS NULL)
UNION ALL SELECT 'every purchase return has a reason code', NOT EXISTS (SELECT 1 FROM public.purchase_returns WHERE reason_code IS NULL)
UNION ALL SELECT 'returns functions installed', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND p.proname IN ('_returns_guard','process_sales_return_v2','process_purchase_return_v2','sales_returns_list','purchase_returns_list','returns_top_medicines','returns_base_total','return_detail','expiry_return_candidates')) = 9
UNION ALL SELECT 'anon cannot read returns', NOT has_function_privilege('anon', 'public.sales_returns_list(date,date)', 'EXECUTE')
UNION ALL SELECT 'existing return functions untouched', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_sales_return') AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_purchase_return');
