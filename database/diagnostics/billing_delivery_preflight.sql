-- ALZA Pharmacy: read-only preflight for the Billing redesign and Delivery Boy feature.
-- Safe to run in Supabase SQL Editor. This script performs SELECTs only.
-- It does NOT create/alter tables, functions, policies, roles, or data.

-- 1) Confirm current schema objects relevant to billing and staff.
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles','roles','branches','medicines','medicine_batches','customers',
    'sales_invoices','sales_items','payments','held_bills','work_sessions',
    'audit_logs','role_permissions','permissions'
  )
ORDER BY table_name;

-- 2) Inspect relevant columns (actual live schema is authoritative).
SELECT table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles','roles','medicines','medicine_batches','sales_invoices',
    'sales_items','payments','held_bills','work_sessions'
  )
ORDER BY table_name, ordinal_position;

-- 3) Inspect existing billing and session RPC signatures/definitions.
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS result_type,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'finalize_sale','invoice_detail','customer_outstanding',
    'my_role','my_branch_id','get_my_context','app_session_ok'
  )
ORDER BY p.proname, arguments;

-- 4) Inspect EXECUTE grants for the functions above.
SELECT routine_name, grantee, privilege_type, is_grantable
FROM information_schema.routine_privileges
WHERE specific_schema = 'public'
  AND routine_name IN ('finalize_sale','invoice_detail','customer_outstanding','get_my_context')
ORDER BY routine_name, grantee, privilege_type;

-- 5) Inspect RLS state and policies for affected tables.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('profiles','roles','sales_invoices','sales_items','payments','held_bills','work_sessions')
ORDER BY c.relname;

SELECT schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles','roles','sales_invoices','sales_items','payments','held_bills','work_sessions')
ORDER BY tablename, policyname;

-- 6) Inspect triggers that could affect invoice/stock/payment writes.
SELECT event_object_table AS table_name, trigger_name,
       event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('sales_invoices','sales_items','payments','medicine_batches','profiles','work_sessions')
ORDER BY event_object_table, trigger_name, event_manipulation;

-- 7) Inspect role vocabulary and existing profile role distribution (no personal names/emails).
SELECT role, count(*) AS profile_count
FROM public.profiles
GROUP BY role
ORDER BY role;

-- 8) Inspect medicine/batch data types and key constraints for FEFO allocation.
SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
       kcu.column_name, ccu.table_name AS referenced_table,
       ccu.column_name AS referenced_column
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON tc.constraint_schema = kcu.constraint_schema
 AND tc.constraint_name = kcu.constraint_name
LEFT JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_schema = ccu.constraint_schema
 AND tc.constraint_name = ccu.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('medicine_batches','medicines','sales_items','sales_invoices','payments')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- 9) Inspect existing indexes for branch-scoped batch lookup and invoice lookup.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('medicine_batches','sales_items','sales_invoices','payments','profiles','work_sessions')
ORDER BY tablename, indexname;

-- 10) Verify whether app migration tracking exists; do not infer live migration state from Git files.
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog','information_schema')
  AND (table_name ILIKE '%migration%' OR table_name ILIKE '%schema_version%')
ORDER BY table_schema, table_name;
