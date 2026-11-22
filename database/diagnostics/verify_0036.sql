-- Read-only checks after running 0036_invoice_view.sql. Every row should say true.
SELECT 'invoice view functions installed' AS check_name, (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND p.proname IN ('invoice_view_info','invoice_lookup','invoice_share_link')) = 3 AS ok
UNION ALL SELECT 'staff can use them', has_function_privilege('authenticated', 'public.invoice_view_info(uuid)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.invoice_share_link(uuid, text)', 'EXECUTE')
UNION ALL SELECT 'visitors cannot', NOT has_function_privilege('anon', 'public.invoice_view_info(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.invoice_lookup(text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.invoice_share_link(uuid, text)', 'EXECUTE')
UNION ALL SELECT 'customer link page still public', has_function_privilege('anon', 'public.public_invoice(text)', 'EXECUTE')
UNION ALL SELECT 'needs Sales (0026) and WhatsApp (0030)', to_regprocedure('public._sales_guard()') IS NOT NULL AND to_regclass('public.invoice_share_links') IS NOT NULL;
