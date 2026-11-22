-- Read-only checks after running 0031_staff_management.sql. Every row should say true.
SELECT 'staff tables' AS check_name, (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
   AND table_name IN ('staff_details','staff_attendance','staff_leaves')) = 3 AS ok
UNION ALL SELECT 'staff functions installed', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND p.proname IN ('staff_list','staff_overview','staff_update','staff_set_role','staff_set_active','staff_attendance_day','staff_attendance_save',
     'staff_attendance_trend','staff_attendance_register','staff_leave_save','staff_leave_decide','staff_leaves_list','staff_roles_permissions',
     'staff_activities','staff_performance','staff_login_history','staff_log_event')) = 17
UNION ALL SELECT 'tables only through the functions', NOT has_table_privilege('authenticated', 'public.staff_details', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.staff_attendance', 'SELECT')
UNION ALL SELECT 'anon cannot read staff', NOT has_function_privilege('anon', 'public.staff_list()', 'EXECUTE')
UNION ALL SELECT 'staff photo bucket is private', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'staff-photos' AND NOT public)
UNION ALL SELECT 'work sessions still in place (automatic attendance)', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_sessions');
