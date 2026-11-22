-- =============================================================================
-- 0032  Documents Management (documents.html)
-- Run once in the Supabase SQL editor after 0031. Safe to run twice.
--
--   pharmacy_documents        — licences, registrations, GST / tax, agreements, insurance,
--                               staff documents and others: name, reference no., issuing
--                               authority, issue / expiry date, reminder days, notes, file,
--                               folder, version history (renewals) and soft removal.
--   pharmacy_doc_folders      — folders ("New Folder")
--   pharmacy_doc_categories   — renamed built-in categories and your own categories
--   pharmacy_doc_settings     — default expiry reminder (days before expiry)
--   Functions                 — documents_overview, documents_list (pharmacy documents and the
--                               existing supplier documents in one list), document_register,
--                               document_update, document_renew, document_remove / _restore,
--                               document_versions, document_activity, document_move,
--                               document_folder_save / _delete, document_categories,
--                               document_category_save, document_settings_save,
--                               document_reminders_save, document_log_access
--   Storage                   — private bucket pharmacy-documents (branch folder, 15 MB,
--                               PDF / JPG / PNG / WEBP), opened through short-lived signed links.
-- Supplier documents (purchase_documents, bucket purchase-documents) are unchanged and keep their
-- own rules: upload by Admin / Inventory staff, open and remove by Admin only.
-- Roles: Admin and Super Admin manage everything. Pharmacist and Inventory staff can upload and
-- open pharmacy documents (not Staff Documents, which are Admin only).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pharmacy_doc_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  name text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_doc_folders_name ON public.pharmacy_doc_folders (branch_id, lower(name));

CREATE TABLE IF NOT EXISTS public.pharmacy_doc_categories (
  branch_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT 'gray',
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 50,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, code),
  CONSTRAINT pharmacy_doc_categories_code_chk CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT pharmacy_doc_categories_color_chk CHECK (color IN ('green','blue','amber','purple','teal','rose','gray','navy'))
);

CREATE TABLE IF NOT EXISTS public.pharmacy_doc_settings (
  branch_id uuid PRIMARY KEY,
  default_remind_days int NOT NULL DEFAULT 30,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pharmacy_doc_settings_days_chk CHECK (default_remind_days BETWEEN 1 AND 365)
);

CREATE TABLE IF NOT EXISTS public.pharmacy_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'others',
  folder_id uuid REFERENCES public.pharmacy_doc_folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  reference_no text,
  authority text,
  issue_date date,
  expiry_date date,
  remind_days int,
  notes text,
  path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  status text NOT NULL DEFAULT 'active',
  version int NOT NULL DEFAULT 1,
  root_id uuid,
  replaced_by uuid,
  removed_reason text,
  removed_at timestamptz,
  removed_by uuid,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pharmacy_documents_status_chk CHECK (status IN ('active','archived','removed')),
  CONSTRAINT pharmacy_documents_mime_chk CHECK (mime IN ('application/pdf','image/jpeg','image/png','image/webp')),
  CONSTRAINT pharmacy_documents_size_chk CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  CONSTRAINT pharmacy_documents_dates_chk CHECK (expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date),
  CONSTRAINT pharmacy_documents_remind_chk CHECK (remind_days IS NULL OR remind_days BETWEEN 1 AND 365)
);
CREATE INDEX IF NOT EXISTS pharmacy_documents_branch ON public.pharmacy_documents (branch_id, status, expiry_date);
CREATE INDEX IF NOT EXISTS pharmacy_documents_root ON public.pharmacy_documents (root_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pharmacy_documents','pharmacy_doc_folders','pharmacy_doc_categories','pharmacy_doc_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- Storage policies run as the caller, who has no direct access to the table: check through definer helpers.
CREATE OR REPLACE FUNCTION public._doc_file_readable(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.pharmacy_documents d WHERE d.path = p_name AND d.branch_id = public.my_branch_id()
        AND (d.category <> 'staff' OR COALESCE(public.my_role(), '') IN ('super_admin','admin'))) $$;
CREATE OR REPLACE FUNCTION public._doc_file_registered(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.pharmacy_documents d WHERE d.path = p_name) $$;
REVOKE ALL ON FUNCTION public._doc_file_readable(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._doc_file_registered(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._doc_file_readable(text), public._doc_file_registered(text) TO authenticated;

-- ---------------------------------------------------------------- storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pharmacy-documents', 'pharmacy-documents', false, 15728640, ARRAY['application/pdf','image/png','image/jpeg','image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS pharmacy_docs_insert ON storage.objects;
CREATE POLICY pharmacy_docs_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'pharmacy-documents'
  AND COALESCE(public.my_role(), '') IN ('super_admin','admin','pharmacist','inventory_staff','inventory')
  AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$'
  AND split_part(name, '/', 1) = public.my_branch_id()::text);

DROP POLICY IF EXISTS pharmacy_docs_select ON storage.objects;
CREATE POLICY pharmacy_docs_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'pharmacy-documents'
  AND split_part(name, '/', 1) = public.my_branch_id()::text
  AND COALESCE(public.my_role(), '') IN ('super_admin','admin','pharmacist','inventory_staff','inventory')
  AND (public._doc_file_readable(name) OR (owner = auth.uid() AND NOT public._doc_file_registered(name))));

-- The uploader may delete a file only while it is not registered (clean-up after a failed save).
DROP POLICY IF EXISTS pharmacy_docs_cleanup ON storage.objects;
CREATE POLICY pharmacy_docs_cleanup ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'pharmacy-documents' AND owner = auth.uid()
  AND split_part(name, '/', 1) = public.my_branch_id()::text
  AND NOT public._doc_file_registered(name));

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION public._doc_branch()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin','pharmacist','inventory_staff','inventory') THEN
    RAISE EXCEPTION 'Not authorised: documents are for Admin, Pharmacist and Inventory staff';
  END IF;
  RETURN v_branch;
END;
$$;
REVOKE ALL ON FUNCTION public._doc_branch() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._doc_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT COALESCE(public.my_role(), '') IN ('super_admin','admin') $$;
REVOKE ALL ON FUNCTION public._doc_admin() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._doc_require_admin()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_branch();
BEGIN
  IF NOT public._doc_admin() THEN RAISE EXCEPTION 'Not authorised: only Admin and Super Admin can do this'; END IF;
  RETURN v_branch;
END;
$$;
REVOKE ALL ON FUNCTION public._doc_require_admin() FROM PUBLIC, anon, authenticated;

-- Supplier documents follow their existing rule (purchase_document_list): Admin and Inventory staff.
CREATE OR REPLACE FUNCTION public._doc_supplier_visible()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT COALESCE(public.my_role(), '') IN ('super_admin','admin','inventory','inventory_staff') $$;
REVOKE ALL ON FUNCTION public._doc_supplier_visible() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._doc_today()
RETURNS date LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

CREATE OR REPLACE FUNCTION public._doc_default_days(p_branch uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT COALESCE((SELECT default_remind_days FROM public.pharmacy_doc_settings WHERE branch_id = p_branch), 30) $$;
REVOKE ALL ON FUNCTION public._doc_default_days(uuid) FROM PUBLIC, anon, authenticated;

-- valid / expiring / expired from the expiry date and the reminder window
CREATE OR REPLACE FUNCTION public._doc_state(p_expiry date, p_days int, p_today date)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN p_expiry IS NULL THEN 'valid' WHEN p_expiry < p_today THEN 'expired'
                  WHEN p_expiry <= p_today + p_days THEN 'expiring' ELSE 'valid' END $$;

-- Built-in categories, with any rename / hide and the branch's own categories.
CREATE OR REPLACE FUNCTION public._doc_cats(p_branch uuid)
RETURNS TABLE (code text, name text, color text, active boolean, sort int, is_system boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH sys(code, name, color, sort) AS (VALUES
    ('licenses','Licenses','green',1), ('registrations','Registrations','blue',2), ('tax','Tax & Compliance','amber',3),
    ('agreements','Agreements','purple',4), ('insurance','Insurance','teal',5), ('staff','Staff Documents','rose',6),
    ('others','Others','gray',7), ('supplier','Supplier Documents','navy',8)),
  own AS (SELECT * FROM public.pharmacy_doc_categories c WHERE c.branch_id = p_branch)
  SELECT COALESCE(s.code, o.code), COALESCE(o.name, s.name), COALESCE(o.color, s.color),
         CASE WHEN s.code IN ('others','supplier') THEN true ELSE COALESCE(o.active, true) END,
         COALESCE(s.sort, o.sort), s.code IS NOT NULL
  FROM sys s FULL JOIN own o ON o.code = s.code
$$;
REVOKE ALL ON FUNCTION public._doc_cats(uuid) FROM PUBLIC, anon, authenticated;

-- One list of pharmacy and supplier documents, as the caller may see them.
CREATE OR REPLACE FUNCTION public._doc_rows(p_branch uuid)
RETURNS TABLE (source text, id uuid, name text, file_name text, mime text, size_bytes bigint, category text, folder_id uuid,
  reference_no text, authority text, issue_date date, expiry_date date, remind_days int, notes text, path text, status text,
  version int, root_id uuid, uploaded_by uuid, created_at timestamptz, updated_at timestamptz, removed_reason text, removed_at timestamptz,
  distributor text, supplier_invoice_no text, doc_type text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'pharmacy', d.id, d.name, d.file_name, d.mime, d.size_bytes, d.category, d.folder_id, d.reference_no, d.authority,
         d.issue_date, d.expiry_date, d.remind_days, d.notes, d.path, d.status, d.version, COALESCE(d.root_id, d.id), d.uploaded_by,
         d.created_at, d.updated_at, d.removed_reason, d.removed_at, NULL::text, NULL::text, NULL::text
  FROM public.pharmacy_documents d
  WHERE d.branch_id = p_branch AND (d.category <> 'staff' OR public._doc_admin())
  UNION ALL
  SELECT 'supplier', p.id, COALESCE(nullif(p.notes, ''), initcap(replace(p.doc_type, '_', ' ')) || COALESCE(' · ' || di.name, '')),
         p.file_name, p.mime, p.size_bytes, 'supplier', NULL::uuid, pi.supplier_invoice_no, di.name,
         COALESCE(p.doc_date, (p.created_at AT TIME ZONE 'Asia/Kolkata')::date), NULL::date, NULL::int, p.notes,
         CASE WHEN public._doc_admin() THEN p.path END, p.status, 1, p.id, p.uploaded_by, p.created_at, p.created_at,
         p.removed_reason, p.removed_at, di.name, pi.supplier_invoice_no, p.doc_type
  FROM public.purchase_documents p
  LEFT JOIN public.distributors di ON di.id = p.distributor_id AND di.branch_id = p.branch_id
  LEFT JOIN public.purchase_invoices pi ON pi.id = p.purchase_invoice_id AND pi.branch_id = p.branch_id
  WHERE p.branch_id = p_branch AND public._doc_supplier_visible()
$$;
REVOKE ALL ON FUNCTION public._doc_rows(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._doc_audit(p_branch uuid, p_action text, p_id uuid, p_reason text, p_before jsonb, p_after jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (p_branch, auth.uid(), p_action, 'pharmacy_document', p_id::text, p_reason, p_before, p_after)
$$;
REVOKE ALL ON FUNCTION public._doc_audit(uuid, text, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Validate a category code for a new / changed pharmacy document.
CREATE OR REPLACE FUNCTION public._doc_check_category(p_branch uuid, p_code text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_code text := lower(trim(COALESCE(p_code, 'others')));
BEGIN
  IF v_code = 'supplier' THEN RAISE EXCEPTION 'Supplier documents are uploaded with the supplier details (distributor / purchase invoice)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public._doc_cats(p_branch) c WHERE c.code = v_code AND c.active) THEN RAISE EXCEPTION 'Unknown document category'; END IF;
  IF v_code = 'staff' AND NOT public._doc_admin() THEN RAISE EXCEPTION 'Staff documents can be added by Admin only'; END IF;
  RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public._doc_check_category(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._doc_check_file(p_branch uuid, p_path text, p_mime text, p_size bigint)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE v_obj record;
BEGIN
  IF p_mime NOT IN ('application/pdf','image/jpeg','image/png','image/webp') OR p_size IS NULL OR p_size <= 0 OR p_size > 15728640 THEN
    RAISE EXCEPTION 'Use a PDF, JPG, PNG or WEBP file up to 15 MB';
  END IF;
  IF split_part(COALESCE(p_path, ''), '/', 1) <> p_branch::text THEN RAISE EXCEPTION 'Document path does not belong to this branch'; END IF;
  IF EXISTS (SELECT 1 FROM public.pharmacy_documents WHERE path = p_path) THEN RAISE EXCEPTION 'This file is already registered'; END IF;
  SELECT * INTO v_obj FROM storage.objects WHERE bucket_id = 'pharmacy-documents' AND name = p_path;
  IF NOT FOUND THEN RAISE EXCEPTION 'Uploaded document not found'; END IF;
  IF (v_obj.metadata->>'size') IS NOT NULL AND (v_obj.metadata->>'size')::bigint <> p_size THEN RAISE EXCEPTION 'Document size mismatch'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._doc_check_file(uuid, text, text, bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._doc_date(p jsonb, k text)
RETURNS date LANGUAGE sql IMMUTABLE
AS $$ SELECT nullif(trim(p->>k), '')::date $$;

-- ---------------------------------------------------------------- read
DROP FUNCTION IF EXISTS public.documents_overview();
CREATE FUNCTION public.documents_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._doc_branch();
  v_today date := public._doc_today();
  v_def int := public._doc_default_days(v_branch);
  v_month date := date_trunc('month', v_today)::date;
  r jsonb;
BEGIN
  WITH d AS (
    SELECT x.*, public._doc_state(x.expiry_date, COALESCE(x.remind_days, v_def), v_today) AS st
    FROM public._doc_rows(v_branch) x),
  act AS (SELECT * FROM d WHERE d.status = 'active')
  SELECT jsonb_build_object(
    'today', v_today,
    'default_remind_days', v_def,
    'total', (SELECT count(*) FROM act),
    'total_last_month', (SELECT count(*) FROM d WHERE d.created_at < v_month AND (d.status = 'active' OR d.removed_at >= v_month)
                          AND (d.status <> 'archived')),
    'valid', (SELECT count(*) FROM act WHERE st = 'valid'),
    'expiring', (SELECT count(*) FROM act WHERE st = 'expiring'),
    'expired', (SELECT count(*) FROM act WHERE st = 'expired'),
    'no_expiry', (SELECT count(*) FROM act WHERE expiry_date IS NULL),
    'removed', (SELECT count(*) FROM d WHERE d.status = 'removed'),
    'storage_bytes', (SELECT COALESCE(sum(size_bytes), 0) FROM d WHERE d.status <> 'removed'),
    'added_this_month', (SELECT count(*) FROM act WHERE created_at >= v_month),
    'categories', (SELECT COALESCE(jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'color', c.color, 'is_system', c.is_system,
                      'active', c.active, 'count', (SELECT count(*) FROM act WHERE act.category = c.code),
                      'expiring', (SELECT count(*) FROM act WHERE act.category = c.code AND act.st = 'expiring'),
                      'expired', (SELECT count(*) FROM act WHERE act.category = c.code AND act.st = 'expired')) ORDER BY c.sort, c.name), '[]'::jsonb)
                   FROM public._doc_cats(v_branch) c
                   WHERE (c.code <> 'supplier' OR public._doc_supplier_visible()) AND (c.code <> 'staff' OR public._doc_admin())),
    'expiring_list', (SELECT COALESCE(jsonb_agg(jsonb_build_object('source', e.source, 'id', e.id, 'name', e.name, 'category', e.category,
                         'reference_no', e.reference_no, 'expiry_date', e.expiry_date, 'days_left', e.expiry_date - v_today, 'status', e.st,
                         'remind_days', COALESCE(e.remind_days, v_def)) ORDER BY e.expiry_date), '[]'::jsonb)
                      FROM (SELECT * FROM act WHERE st IN ('expiring','expired') ORDER BY expiry_date LIMIT 30) e),
    'next_expiry', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'expiry_date', n.expiry_date,
                       'days_left', n.expiry_date - v_today) ORDER BY n.expiry_date), '[]'::jsonb)
                    FROM (SELECT * FROM act WHERE st = 'valid' AND expiry_date IS NOT NULL ORDER BY expiry_date LIMIT 5) n),
    'folders', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name,
                   'count', (SELECT count(*) FROM act WHERE act.folder_id = f.id)) ORDER BY lower(f.name)), '[]'::jsonb)
                FROM public.pharmacy_doc_folders f WHERE f.branch_id = v_branch),
    'can_manage', public._doc_admin(),
    'can_supplier', public._doc_supplier_visible(),
    'can_upload_supplier', COALESCE(public.my_role(), '') IN ('super_admin','admin','inventory','inventory_staff')
  ) INTO r;
  RETURN r;
END;
$$;

DROP FUNCTION IF EXISTS public.documents_list(text, text, text, uuid, boolean, text, int, int);
CREATE FUNCTION public.documents_list(p_q text DEFAULT NULL, p_category text DEFAULT NULL, p_status text DEFAULT NULL,
  p_folder uuid DEFAULT NULL, p_include_removed boolean DEFAULT false, p_sort text DEFAULT 'recent', p_limit int DEFAULT 8, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._doc_branch();
  v_today date := public._doc_today();
  v_def int := public._doc_default_days(v_branch);
  v_q text := nullif(trim(COALESCE(p_q, '')), '');
  v_st text := nullif(trim(COALESCE(p_status, '')), '');
  v_lim int := least(greatest(COALESCE(p_limit, 8), 1), 5000);
  v_off int := greatest(COALESCE(p_offset, 0), 0);
  r jsonb;
BEGIN
  WITH d AS (
    SELECT x.*, CASE WHEN x.status = 'active' THEN public._doc_state(x.expiry_date, COALESCE(x.remind_days, v_def), v_today) ELSE x.status END AS st
    FROM public._doc_rows(v_branch) x),
  f AS (
    SELECT d.* FROM d
    WHERE (p_category IS NULL OR p_category = '' OR d.category = p_category)
      AND (p_folder IS NULL OR d.folder_id = p_folder)
      AND (CASE WHEN v_st IS NULL THEN d.status = 'active' OR (p_include_removed AND d.status = 'removed')
                WHEN v_st = 'removed' THEN d.status = 'removed'
                WHEN v_st = 'archived' THEN d.status = 'archived'
                WHEN v_st = 'no_expiry' THEN d.status = 'active' AND d.expiry_date IS NULL
                WHEN v_st = 'attention' THEN d.st IN ('expiring','expired')
                ELSE d.st = v_st END)
      AND (v_q IS NULL OR concat_ws(' ', d.name, d.file_name, d.reference_no, d.authority, d.notes, d.distributor, d.supplier_invoice_no) ILIKE '%' || v_q || '%')),
  page AS (
    SELECT f.* FROM f
    ORDER BY
      CASE WHEN p_sort = 'expiry' THEN f.expiry_date END ASC NULLS LAST,
      CASE WHEN p_sort = 'name' THEN lower(f.name) END ASC,
      CASE WHEN p_sort = 'oldest' THEN f.created_at END ASC,
      f.created_at DESC, f.id
    LIMIT v_lim OFFSET v_off)
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM f),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'source', p.source, 'id', p.id, 'name', p.name, 'file_name', p.file_name, 'mime', p.mime, 'size_bytes', p.size_bytes,
        'category', p.category, 'category_name', c.name, 'color', COALESCE(c.color, 'gray'),
        'folder_id', p.folder_id, 'folder', fo.name, 'reference_no', p.reference_no, 'authority', p.authority,
        'issue_date', p.issue_date, 'expiry_date', p.expiry_date, 'remind_days', p.remind_days,
        'days_left', CASE WHEN p.expiry_date IS NOT NULL THEN p.expiry_date - v_today END,
        'status', p.st, 'record_status', p.status, 'notes', p.notes, 'version', p.version, 'root_id', p.root_id,
        'uploaded_by', pr.full_name, 'created_at', p.created_at, 'updated_at', p.updated_at,
        'removed_reason', p.removed_reason, 'distributor', p.distributor, 'supplier_invoice_no', p.supplier_invoice_no, 'doc_type', p.doc_type,
        'path', p.path,
        'can_open', CASE WHEN p.source = 'supplier' THEN public._doc_admin() AND p.status = 'active' ELSE p.status <> 'removed' OR public._doc_admin() END,
        'can_edit', p.source = 'pharmacy' AND public._doc_admin() AND p.status = 'active')
      ORDER BY
        CASE WHEN p_sort = 'expiry' THEN p.expiry_date END ASC NULLS LAST,
        CASE WHEN p_sort = 'name' THEN lower(p.name) END ASC,
        CASE WHEN p_sort = 'oldest' THEN p.created_at END ASC,
        p.created_at DESC, p.id)
      FROM page p
      LEFT JOIN public._doc_cats(v_branch) c ON c.code = p.category
      LEFT JOIN public.pharmacy_doc_folders fo ON fo.id = p.folder_id
      LEFT JOIN public.profiles pr ON pr.id = p.uploaded_by), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END;
$$;

DROP FUNCTION IF EXISTS public.document_categories();
CREATE FUNCTION public.document_categories()
RETURNS TABLE (code text, name text, color text, active boolean, is_system boolean, doc_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_branch();
BEGIN
  RETURN QUERY
  SELECT c.code, c.name, c.color, c.active, c.is_system,
         (SELECT count(*) FROM public._doc_rows(v_branch) x WHERE x.category = c.code AND x.status = 'active')
  FROM public._doc_cats(v_branch) c
  WHERE (c.code <> 'supplier' OR public._doc_supplier_visible()) AND (c.code <> 'staff' OR public._doc_admin())
  ORDER BY c.sort, c.name;
END;
$$;

DROP FUNCTION IF EXISTS public.document_versions(uuid);
CREATE FUNCTION public.document_versions(p_id uuid)
RETURNS TABLE (id uuid, version int, name text, file_name text, mime text, size_bytes bigint, reference_no text, issue_date date,
  expiry_date date, status text, uploaded_by text, created_at timestamptz, can_open boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_branch(); v_root uuid;
BEGIN
  SELECT COALESCE(d.root_id, d.id) INTO v_root FROM public.pharmacy_documents d
  WHERE d.id = p_id AND d.branch_id = v_branch AND (d.category <> 'staff' OR public._doc_admin());
  IF v_root IS NULL THEN RAISE EXCEPTION 'Document not found'; END IF;
  RETURN QUERY
  SELECT d.id, d.version, d.name, d.file_name, d.mime, d.size_bytes, d.reference_no, d.issue_date, d.expiry_date, d.status,
         pr.full_name, d.created_at, d.status <> 'removed' OR public._doc_admin()
  FROM public.pharmacy_documents d LEFT JOIN public.profiles pr ON pr.id = d.uploaded_by
  WHERE d.branch_id = v_branch AND COALESCE(d.root_id, d.id) = v_root
  ORDER BY d.version DESC, d.created_at DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.document_activity(uuid, int);
CREATE FUNCTION public.document_activity(p_id uuid DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS TABLE (at timestamptz, action text, title text, detail text, by_name text, doc_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_branch(); v_root uuid; v_ids text[];
BEGIN
  IF p_id IS NOT NULL THEN
    SELECT COALESCE(d.root_id, d.id) INTO v_root FROM public.pharmacy_documents d
    WHERE d.id = p_id AND d.branch_id = v_branch AND (d.category <> 'staff' OR public._doc_admin());
    IF v_root IS NULL THEN RAISE EXCEPTION 'Document not found'; END IF;
    SELECT array_agg(d.id::text) INTO v_ids FROM public.pharmacy_documents d WHERE COALESCE(d.root_id, d.id) = v_root;
  ELSIF NOT public._doc_admin() THEN
    RAISE EXCEPTION 'Not authorised: only Admin and Super Admin can see all document activity';
  END IF;
  RETURN QUERY
  SELECT a.at, a.action,
    CASE a.action WHEN 'document_uploaded' THEN 'Uploaded' WHEN 'document_updated' THEN 'Details updated' WHEN 'document_renewed' THEN 'Renewed (new version)'
      WHEN 'document_removed' THEN 'Removed' WHEN 'document_restored' THEN 'Restored' WHEN 'document_viewed' THEN 'Viewed'
      WHEN 'document_downloaded' THEN 'Downloaded' WHEN 'document_moved' THEN 'Moved to folder' ELSE initcap(replace(a.action, '_', ' ')) END,
    COALESCE(a.after_data->>'name', a.before_data->>'name', '') || COALESCE(' — ' || a.reason, ''),
    pr.full_name, a.entity_id
  FROM public.audit_logs a LEFT JOIN public.profiles pr ON pr.id = a.user_id
  WHERE a.branch_id = v_branch AND a.entity_type = 'pharmacy_document' AND (v_ids IS NULL OR a.entity_id = ANY (v_ids))
  ORDER BY a.at DESC
  LIMIT least(greatest(COALESCE(p_limit, 50), 1), 500);
END;
$$;

-- ---------------------------------------------------------------- write
DROP FUNCTION IF EXISTS public.document_register(jsonb);
CREATE FUNCTION public.document_register(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._doc_branch();
  v_cat text := public._doc_check_category(v_branch, p->>'category');
  v_name text := nullif(trim(COALESCE(p->>'name', '')), '');
  v_folder uuid := nullif(p->>'folder_id', '')::uuid;
  v_remind int := nullif(p->>'remind_days', '')::int;
  v_id uuid;
BEGIN
  IF v_name IS NULL OR length(v_name) > 200 THEN RAISE EXCEPTION 'Document name is required (up to 200 characters)'; END IF;
  IF v_folder IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pharmacy_doc_folders WHERE id = v_folder AND branch_id = v_branch) THEN
    RAISE EXCEPTION 'Folder not found';
  END IF;
  PERFORM public._doc_check_file(v_branch, p->>'path', p->>'mime', (p->>'size_bytes')::bigint);
  INSERT INTO public.pharmacy_documents(branch_id, category, folder_id, name, reference_no, authority, issue_date, expiry_date, remind_days,
    notes, path, file_name, mime, size_bytes, uploaded_by, updated_by)
  VALUES (v_branch, v_cat, v_folder, v_name, nullif(trim(p->>'reference_no'), ''), nullif(trim(p->>'authority'), ''),
    public._doc_date(p, 'issue_date'), public._doc_date(p, 'expiry_date'), v_remind, nullif(trim(p->>'notes'), ''),
    p->>'path', COALESCE(nullif(trim(p->>'file_name'), ''), 'document'), p->>'mime', (p->>'size_bytes')::bigint, auth.uid(), auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.pharmacy_documents SET root_id = v_id WHERE id = v_id;
  PERFORM public._doc_audit(v_branch, 'document_uploaded', v_id, NULL, NULL,
    jsonb_build_object('name', v_name, 'category', v_cat, 'expiry_date', public._doc_date(p, 'expiry_date')));
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.document_update(uuid, jsonb);
CREATE FUNCTION public.document_update(p_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._doc_require_admin();
  v_old public.pharmacy_documents;
  v_cat text;
  v_name text;
  v_folder uuid;
BEGIN
  SELECT * INTO v_old FROM public.pharmacy_documents WHERE id = p_id AND branch_id = v_branch AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found or not active'; END IF;
  v_cat := CASE WHEN p ? 'category' THEN public._doc_check_category(v_branch, p->>'category') ELSE v_old.category END;
  v_name := CASE WHEN p ? 'name' THEN nullif(trim(COALESCE(p->>'name', '')), '') ELSE v_old.name END;
  IF v_name IS NULL OR length(v_name) > 200 THEN RAISE EXCEPTION 'Document name is required (up to 200 characters)'; END IF;
  v_folder := CASE WHEN p ? 'folder_id' THEN nullif(p->>'folder_id', '')::uuid ELSE v_old.folder_id END;
  IF v_folder IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pharmacy_doc_folders WHERE id = v_folder AND branch_id = v_branch) THEN
    RAISE EXCEPTION 'Folder not found';
  END IF;
  UPDATE public.pharmacy_documents SET
    category = v_cat, name = v_name, folder_id = v_folder,
    reference_no = CASE WHEN p ? 'reference_no' THEN nullif(trim(p->>'reference_no'), '') ELSE reference_no END,
    authority = CASE WHEN p ? 'authority' THEN nullif(trim(p->>'authority'), '') ELSE authority END,
    issue_date = CASE WHEN p ? 'issue_date' THEN public._doc_date(p, 'issue_date') ELSE issue_date END,
    expiry_date = CASE WHEN p ? 'expiry_date' THEN public._doc_date(p, 'expiry_date') ELSE expiry_date END,
    remind_days = CASE WHEN p ? 'remind_days' THEN nullif(p->>'remind_days', '')::int ELSE remind_days END,
    notes = CASE WHEN p ? 'notes' THEN nullif(trim(p->>'notes'), '') ELSE notes END,
    updated_by = auth.uid(), updated_at = now()
  WHERE id = p_id;
  PERFORM public._doc_audit(v_branch, 'document_updated', p_id, NULL,
    jsonb_build_object('name', v_old.name, 'category', v_old.category, 'reference_no', v_old.reference_no, 'issue_date', v_old.issue_date, 'expiry_date', v_old.expiry_date),
    jsonb_build_object('name', v_name, 'category', v_cat) || (p - 'name' - 'category'));
END;
$$;

-- Renewal: the new file becomes the active version; the old one is kept as history.
DROP FUNCTION IF EXISTS public.document_renew(uuid, jsonb);
CREATE FUNCTION public.document_renew(p_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._doc_require_admin();
  v_old public.pharmacy_documents;
  v_id uuid;
BEGIN
  SELECT * INTO v_old FROM public.pharmacy_documents WHERE id = p_id AND branch_id = v_branch AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found or not active'; END IF;
  PERFORM public._doc_check_file(v_branch, p->>'path', p->>'mime', (p->>'size_bytes')::bigint);
  INSERT INTO public.pharmacy_documents(branch_id, category, folder_id, name, reference_no, authority, issue_date, expiry_date, remind_days,
    notes, path, file_name, mime, size_bytes, version, root_id, uploaded_by, updated_by)
  VALUES (v_branch, v_old.category, v_old.folder_id, COALESCE(nullif(trim(p->>'name'), ''), v_old.name),
    CASE WHEN p ? 'reference_no' THEN nullif(trim(p->>'reference_no'), '') ELSE v_old.reference_no END,
    CASE WHEN p ? 'authority' THEN nullif(trim(p->>'authority'), '') ELSE v_old.authority END,
    public._doc_date(p, 'issue_date'), public._doc_date(p, 'expiry_date'),
    CASE WHEN p ? 'remind_days' THEN nullif(p->>'remind_days', '')::int ELSE v_old.remind_days END,
    CASE WHEN p ? 'notes' THEN nullif(trim(p->>'notes'), '') ELSE v_old.notes END,
    p->>'path', COALESCE(nullif(trim(p->>'file_name'), ''), 'document'), p->>'mime', (p->>'size_bytes')::bigint,
    v_old.version + 1, COALESCE(v_old.root_id, v_old.id), auth.uid(), auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.pharmacy_documents SET status = 'archived', replaced_by = v_id, updated_by = auth.uid(), updated_at = now() WHERE id = p_id;
  PERFORM public._doc_audit(v_branch, 'document_renewed', v_id, NULL,
    jsonb_build_object('name', v_old.name, 'version', v_old.version, 'expiry_date', v_old.expiry_date),
    jsonb_build_object('name', COALESCE(nullif(trim(p->>'name'), ''), v_old.name), 'version', v_old.version + 1, 'expiry_date', public._doc_date(p, 'expiry_date')));
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.document_remove(uuid, text);
CREATE FUNCTION public.document_remove(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_require_admin(); v_old public.pharmacy_documents;
BEGIN
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Removal reason required'; END IF;
  UPDATE public.pharmacy_documents SET status = 'removed', removed_reason = trim(p_reason), removed_at = now(), removed_by = auth.uid(),
    updated_by = auth.uid(), updated_at = now()
  WHERE id = p_id AND branch_id = v_branch AND status = 'active'
  RETURNING * INTO v_old;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found or already removed'; END IF;
  PERFORM public._doc_audit(v_branch, 'document_removed', p_id, trim(p_reason), jsonb_build_object('name', v_old.name, 'file_name', v_old.file_name), NULL);
END;
$$;

DROP FUNCTION IF EXISTS public.document_restore(uuid);
CREATE FUNCTION public.document_restore(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_require_admin(); v_old public.pharmacy_documents;
BEGIN
  SELECT * INTO v_old FROM public.pharmacy_documents WHERE id = p_id AND branch_id = v_branch AND status = 'removed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found or not removed'; END IF;
  IF v_old.replaced_by IS NOT NULL OR EXISTS (SELECT 1 FROM public.pharmacy_documents x WHERE COALESCE(x.root_id, x.id) = COALESCE(v_old.root_id, v_old.id)
      AND x.status = 'active' AND x.id <> p_id) THEN
    RAISE EXCEPTION 'A newer version of this document is active';
  END IF;
  UPDATE public.pharmacy_documents SET status = 'active', removed_reason = NULL, removed_at = NULL, removed_by = NULL, updated_by = auth.uid(), updated_at = now()
  WHERE id = p_id;
  PERFORM public._doc_audit(v_branch, 'document_restored', p_id, NULL, NULL, jsonb_build_object('name', v_old.name));
END;
$$;

DROP FUNCTION IF EXISTS public.document_move(uuid[], uuid);
CREATE FUNCTION public.document_move(p_ids uuid[], p_folder uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_require_admin(); v_n int; v_fname text;
BEGIN
  IF p_folder IS NOT NULL THEN
    SELECT name INTO v_fname FROM public.pharmacy_doc_folders WHERE id = p_folder AND branch_id = v_branch;
    IF v_fname IS NULL THEN RAISE EXCEPTION 'Folder not found'; END IF;
  END IF;
  UPDATE public.pharmacy_documents SET folder_id = p_folder, updated_by = auth.uid(), updated_at = now()
  WHERE branch_id = v_branch AND id = ANY (COALESCE(p_ids, '{}')) AND status = 'active';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, after_data)
  SELECT v_branch, auth.uid(), 'document_moved', 'pharmacy_document', d.id::text, jsonb_build_object('name', d.name, 'folder', COALESCE(v_fname, 'No folder'))
  FROM public.pharmacy_documents d WHERE d.branch_id = v_branch AND d.id = ANY (COALESCE(p_ids, '{}'));
  RETURN v_n;
END;
$$;

DROP FUNCTION IF EXISTS public.document_folder_save(uuid, text);
CREATE FUNCTION public.document_folder_save(p_id uuid, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_require_admin(); v_name text := nullif(trim(COALESCE(p_name, '')), ''); v_id uuid;
BEGIN
  IF v_name IS NULL OR length(v_name) > 80 THEN RAISE EXCEPTION 'Folder name is required (up to 80 characters)'; END IF;
  IF EXISTS (SELECT 1 FROM public.pharmacy_doc_folders WHERE branch_id = v_branch AND lower(name) = lower(v_name) AND id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'A folder with this name already exists';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.pharmacy_doc_folders(branch_id, name, created_by) VALUES (v_branch, v_name, auth.uid()) RETURNING id INTO v_id;
  ELSE
    UPDATE public.pharmacy_doc_folders SET name = v_name WHERE id = p_id AND branch_id = v_branch RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Folder not found'; END IF;
  END IF;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, after_data)
  VALUES (v_branch, auth.uid(), CASE WHEN p_id IS NULL THEN 'document_folder_created' ELSE 'document_folder_renamed' END, 'document_folder', v_id::text, jsonb_build_object('name', v_name));
  RETURN v_id;
END;
$$;

-- Deleting a folder keeps its documents (they move to "No folder").
DROP FUNCTION IF EXISTS public.document_folder_delete(uuid);
CREATE FUNCTION public.document_folder_delete(p_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_require_admin(); v_name text; v_n int;
BEGIN
  SELECT name INTO v_name FROM public.pharmacy_doc_folders WHERE id = p_id AND branch_id = v_branch;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Folder not found'; END IF;
  UPDATE public.pharmacy_documents SET folder_id = NULL WHERE folder_id = p_id AND branch_id = v_branch;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.pharmacy_doc_folders WHERE id = p_id;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, before_data)
  VALUES (v_branch, auth.uid(), 'document_folder_deleted', 'document_folder', p_id::text, jsonb_build_object('name', v_name, 'documents_kept', v_n));
  RETURN v_n;
END;
$$;

-- Rename / hide a built-in category, or add / edit your own (code is made from the name when empty).
DROP FUNCTION IF EXISTS public.document_category_save(text, text, text, boolean);
CREATE FUNCTION public.document_category_save(p_code text, p_name text, p_color text DEFAULT NULL, p_active boolean DEFAULT true)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._doc_require_admin();
  v_name text := nullif(trim(COALESCE(p_name, '')), '');
  v_code text := lower(nullif(trim(COALESCE(p_code, '')), ''));
  v_cur record;
BEGIN
  IF v_name IS NULL OR length(v_name) > 60 THEN RAISE EXCEPTION 'Category name is required (up to 60 characters)'; END IF;
  IF v_code IS NULL THEN
    v_code := 'c_' || left(trim(BOTH '_' FROM regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), 30);
    IF v_code = 'c_' THEN v_code := 'c_' || substr(md5(v_name), 1, 8); END IF;
    IF EXISTS (SELECT 1 FROM public._doc_cats(v_branch) c WHERE c.code = v_code) THEN v_code := v_code || '_' || substr(md5(random()::text), 1, 4); END IF;
  END IF;
  SELECT * INTO v_cur FROM public._doc_cats(v_branch) c WHERE c.code = v_code;
  IF FOUND IS FALSE AND v_code !~ '^c_' THEN RAISE EXCEPTION 'Unknown category'; END IF;
  IF EXISTS (SELECT 1 FROM public._doc_cats(v_branch) c WHERE lower(c.name) = lower(v_name) AND c.code <> v_code) THEN
    RAISE EXCEPTION 'A category with this name already exists';
  END IF;
  IF COALESCE(p_active, true) = false AND v_code IN ('others','supplier') THEN RAISE EXCEPTION 'This category cannot be hidden'; END IF;
  IF COALESCE(p_active, true) = false AND EXISTS (SELECT 1 FROM public.pharmacy_documents WHERE branch_id = v_branch AND category = v_code AND status = 'active') THEN
    RAISE EXCEPTION 'Move or remove the documents in this category before hiding it';
  END IF;
  INSERT INTO public.pharmacy_doc_categories(branch_id, code, name, color, active, sort, updated_by)
  VALUES (v_branch, v_code, v_name, COALESCE(nullif(p_color, ''), v_cur.color, 'gray'), COALESCE(p_active, true), COALESCE(v_cur.sort, 50), auth.uid())
  ON CONFLICT (branch_id, code) DO UPDATE SET name = excluded.name, color = excluded.color, active = excluded.active, updated_by = auth.uid(), updated_at = now();
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, after_data)
  VALUES (v_branch, auth.uid(), 'document_category_saved', 'document_category', v_code, jsonb_build_object('name', v_name, 'active', COALESCE(p_active, true)));
  RETURN v_code;
END;
$$;

DROP FUNCTION IF EXISTS public.document_settings_save(int);
CREATE FUNCTION public.document_settings_save(p_default_days int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_require_admin();
BEGIN
  IF p_default_days IS NULL OR p_default_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'Reminder must be 1 to 365 days before expiry'; END IF;
  INSERT INTO public.pharmacy_doc_settings(branch_id, default_remind_days, updated_by) VALUES (v_branch, p_default_days, auth.uid())
  ON CONFLICT (branch_id) DO UPDATE SET default_remind_days = excluded.default_remind_days, updated_by = auth.uid(), updated_at = now();
END;
$$;

-- p_items: [{"id": uuid, "remind_days": int|null}]  (null = use the default)
DROP FUNCTION IF EXISTS public.document_reminders_save(int, jsonb);
CREATE FUNCTION public.document_reminders_save(p_default_days int, p_items jsonb DEFAULT '[]'::jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_require_admin(); v_n int := 0; it jsonb; v_days int;
BEGIN
  IF p_default_days IS NOT NULL THEN PERFORM public.document_settings_save(p_default_days); END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    v_days := nullif(it->>'remind_days', '')::int;
    IF v_days IS NOT NULL AND v_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'Reminder must be 1 to 365 days before expiry'; END IF;
    UPDATE public.pharmacy_documents SET remind_days = v_days, updated_by = auth.uid(), updated_at = now()
    WHERE id = (it->>'id')::uuid AND branch_id = v_branch AND status = 'active' AND remind_days IS DISTINCT FROM v_days;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

-- View / download audit (pharmacy and supplier documents).
DROP FUNCTION IF EXISTS public.document_log_access(text, uuid, text);
CREATE FUNCTION public.document_log_access(p_source text, p_id uuid, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._doc_branch(); v_name text;
BEGIN
  IF p_action NOT IN ('viewed','downloaded') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  SELECT x.name INTO v_name FROM public._doc_rows(v_branch) x WHERE x.id = p_id AND x.source = p_source;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Document not found'; END IF;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, after_data)
  VALUES (v_branch, auth.uid(), 'document_' || p_action, CASE WHEN p_source = 'supplier' THEN 'purchase_document' ELSE 'pharmacy_document' END, p_id::text,
          jsonb_build_object('name', v_name));
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['documents_overview()', 'documents_list(text, text, text, uuid, boolean, text, int, int)', 'document_categories()',
    'document_versions(uuid)', 'document_activity(uuid, int)', 'document_register(jsonb)', 'document_update(uuid, jsonb)', 'document_renew(uuid, jsonb)',
    'document_remove(uuid, text)', 'document_restore(uuid)', 'document_move(uuid[], uuid)', 'document_folder_save(uuid, text)',
    'document_folder_delete(uuid)', 'document_category_save(text, text, text, boolean)', 'document_settings_save(int)',
    'document_reminders_save(int, jsonb)', 'document_log_access(text, uuid, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
