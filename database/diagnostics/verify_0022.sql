-- Read-only checks after running 0022_delivery_management_v2.sql. Every row should say true.
SELECT 'status check allows failed' AS check_name,
       pg_get_constraintdef(oid) LIKE '%failed%' AS ok
FROM pg_constraint WHERE conname = 'delivery_jobs_status_check'
UNION ALL
SELECT 'new delivery_jobs columns', count(*) = 10
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'delivery_jobs'
  AND column_name IN ('delivery_address','delivery_phone','delivery_note','out_at','delivered_at','failed_at','failure_reason','issue_note','issue_at','fee_earned')
UNION ALL
SELECT 'delivery_settings table', to_regclass('public.delivery_settings') IS NOT NULL
UNION ALL
SELECT 'status-time trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'delivery_jobs_stamp')
UNION ALL
SELECT 'new functions', count(*) = 7
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('delivery_management_list_v2','delivery_set_details','delivery_settings_set','delivery_my_jobs_v2','delivery_update_status_v2','delivery_report_issue','delivery_is_manager')
UNION ALL
SELECT 'existing functions kept', count(*) = 5
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('delivery_management_list','delivery_my_jobs','delivery_set_request','delivery_assign','delivery_update_status');
