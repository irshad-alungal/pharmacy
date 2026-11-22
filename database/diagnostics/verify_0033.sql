-- Read-only checks after running 0033_settings_management.sql. Every row should say true.
SELECT 'settings functions installed' AS check_name, (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND p.proname IN ('settings_get','settings_system_info','settings_save','settings_reset','settings_save_billing','settings_save_branding',
     'settings_backup_export','settings_backup_list','settings_restore')) = 9 AS ok
UNION ALL SELECT 'backup log table', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'settings_backups')
UNION ALL SELECT 'backup log only through functions', NOT has_table_privilege('authenticated', 'public.settings_backups', 'SELECT')
UNION ALL SELECT 'anon cannot read settings', NOT has_function_privilege('anon', 'public.settings_get()', 'EXECUTE')
UNION ALL SELECT 'logo bucket (public)', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'pharmacy-branding' AND public)
UNION ALL SELECT 'logo upload policies', (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
   AND policyname IN ('pharmacy_branding_read','pharmacy_branding_insert','pharmacy_branding_delete')) = 3
UNION ALL SELECT 'pharmacy details functions still in place', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_branch_profile') AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'save_branch_profile');
