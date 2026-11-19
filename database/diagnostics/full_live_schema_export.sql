-- PALLIKKAL PHARMACY — full live schema export (READ-ONLY)
-- Safe to run in the Supabase SQL Editor: SELECT statements only.
-- It does not create, change or delete anything.
--
-- How to use:
--   1. Paste this whole file into Supabase → SQL Editor → Run.
--   2. Click "Download" (CSV) above the results grid.
--   3. Upload that CSV back to Claude.
--
-- The result has one row per database object: section, object name, detail.
-- It contains structure only (tables, columns, functions, policies, triggers,
-- buckets, role/permission codes). It contains NO customer, sales or staff data.

WITH
tbl AS (
  SELECT 'table' AS section,
         c.table_schema || '.' || c.table_name AS name,
         string_agg(
           c.column_name || ' ' || c.data_type ||
           CASE WHEN c.is_nullable = 'NO' THEN ' not null' ELSE '' END ||
           CASE WHEN c.column_default IS NOT NULL THEN ' default ' || left(c.column_default, 60) ELSE '' END,
           ', ' ORDER BY c.ordinal_position) AS detail
  FROM information_schema.columns c
  WHERE c.table_schema IN ('public', 'app')
  GROUP BY c.table_schema, c.table_name
),
cons AS (
  SELECT 'constraint' AS section,
         n.nspname || '.' || t.relname || '.' || co.conname AS name,
         pg_get_constraintdef(co.oid) AS detail
  FROM pg_constraint co
  JOIN pg_class t ON t.oid = co.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname IN ('public', 'app') AND co.contype IN ('c', 'u', 'f', 'p')
),
fn AS (
  SELECT 'function' AS section,
         n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name,
         'returns ' || pg_get_function_result(p.oid) ||
         CASE WHEN p.prosecdef THEN ' | SECURITY DEFINER' ELSE '' END ||
         ' | grants: ' || COALESCE((
            SELECT string_agg(DISTINCT rp.grantee, ',')
            FROM information_schema.routine_privileges rp
            WHERE rp.specific_schema = n.nspname
              AND rp.specific_name = p.proname || '_' || p.oid
              AND rp.privilege_type = 'EXECUTE'), '-') ||
         E'\n' || pg_get_functiondef(p.oid) AS detail
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'app')
    AND p.prokind = 'f'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
),
pol AS (
  SELECT 'policy' AS section,
         schemaname || '.' || tablename || '.' || policyname AS name,
         cmd || ' to ' || array_to_string(roles, ',') ||
         ' | using: ' || COALESCE(qual, '-') || ' | check: ' || COALESCE(with_check, '-') AS detail
  FROM pg_policies
  WHERE schemaname IN ('public', 'app', 'storage')
),
rls AS (
  SELECT 'rls' AS section, n.nspname || '.' || c.relname AS name,
         'enabled=' || c.relrowsecurity || ' forced=' || c.relforcerowsecurity AS detail
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'app') AND c.relkind = 'r'
),
tgr AS (
  SELECT 'trigger' AS section,
         event_object_schema || '.' || event_object_table || '.' || trigger_name AS name,
         action_timing || ' ' || string_agg(event_manipulation, '/') || ' → ' || max(action_statement) AS detail
  FROM information_schema.triggers
  WHERE trigger_schema IN ('public', 'app')
  GROUP BY event_object_schema, event_object_table, trigger_name, action_timing
),
grt AS (
  SELECT 'table_grant' AS section, table_schema || '.' || table_name AS name,
         string_agg(DISTINCT grantee || ':' || privilege_type, ', ') AS detail
  FROM information_schema.role_table_grants
  WHERE table_schema IN ('public', 'app') AND grantee IN ('anon', 'authenticated')
  GROUP BY table_schema, table_name
),
colgrt AS (
  SELECT 'column_grant' AS section, table_schema || '.' || table_name AS name,
         string_agg(DISTINCT grantee || ':' || privilege_type || ':' || column_name, ', ') AS detail
  FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
    AND table_name IN ('medicines', 'medicine_batches', 'customers', 'distributors', 'profiles', 'branches')
  GROUP BY table_schema, table_name
),
seqs AS (
  SELECT 'sequence' AS section, sequence_schema || '.' || sequence_name AS name, '' AS detail
  FROM information_schema.sequences WHERE sequence_schema IN ('public', 'app')
),
views AS (
  SELECT 'view' AS section, table_schema || '.' || table_name AS name, left(view_definition, 4000) AS detail
  FROM information_schema.views WHERE table_schema IN ('public', 'app')
),
bkt AS (
  SELECT 'bucket' AS section, 'storage.' || id AS name,
         'public=' || public || ' size_limit=' || COALESCE(file_size_limit::text, '-') ||
         ' mime=' || COALESCE(array_to_string(allowed_mime_types, ','), '-') AS detail
  FROM storage.buckets
),
role_codes AS (
  SELECT 'role_code' AS section, 'roles.' || r.code AS name,
         (SELECT count(*) FROM public.profiles p WHERE p.role_id = r.id)::text || ' profile(s)' AS detail
  FROM public.roles r
),
perm_codes AS (
  SELECT 'role_permission' AS section, 'role_permissions.' || r.code AS name,
         string_agg(rp.permission_code, ', ' ORDER BY rp.permission_code) AS detail
  FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
  GROUP BY r.code
),
counts AS (
  -- Row counts only (no data), to know which features are in use.
  SELECT 'row_count' AS section, n.nspname || '.' || c.relname AS name, c.reltuples::bigint::text AS detail
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
ext AS (
  SELECT 'extension' AS section, extname AS name, extversion AS detail FROM pg_extension
)
SELECT * FROM tbl
UNION ALL SELECT * FROM cons
UNION ALL SELECT * FROM fn
UNION ALL SELECT * FROM pol
UNION ALL SELECT * FROM rls
UNION ALL SELECT * FROM tgr
UNION ALL SELECT * FROM grt
UNION ALL SELECT * FROM colgrt
UNION ALL SELECT * FROM seqs
UNION ALL SELECT * FROM views
UNION ALL SELECT * FROM bkt
UNION ALL SELECT * FROM role_codes
UNION ALL SELECT * FROM perm_codes
UNION ALL SELECT * FROM counts
UNION ALL SELECT * FROM ext
ORDER BY 1, 2;
