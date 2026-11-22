-- Read-only checks after running 0034_audit_logs.sql. Every row should say true.
SELECT 'audit functions installed' AS check_name, (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND p.proname IN ('audit_overview','audit_list','audit_user_report','audit_login_history','audit_log_export','audit_settings_get','audit_settings_save')) = 7 AS ok
UNION ALL SELECT 'IP capture triggers', (SELECT count(*) FROM pg_trigger WHERE tgname IN ('audit_logs_fill_ip','work_sessions_fill_ip') AND NOT tgisinternal) = 2
UNION ALL SELECT 'audit log still append-only', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_append_only')
UNION ALL SELECT 'anon cannot read audit', NOT has_function_privilege('anon', 'public.audit_list(date, date, text, uuid, text, text, boolean, integer, integer)', 'EXECUTE')
UNION ALL SELECT 'classification works', public._audit_module('sale_finalized', 'sales_invoice') = 'Sales' AND public._audit_kind('purchase_document_removed') = 'deleted';
