-- =============================================================================
-- 0033  Settings (settings.html)
-- Run once in the Supabase SQL editor after 0032. Safe to run twice.
--
--   Uses the existing pharmacy_settings table (branch_id, key, value) for these sections:
--     general        language, date / time format, currency, low-stock and expiry alerts,
--                    daily auto backup, pharmacy logo on invoices
--     invoice        default paper (thermal / A4), show GSTIN / drug licence / patient details,
--                    terms, UPI payment line, signature line
--     payments       payment methods shown on the billing screen, default method, UPI ID
--     notifications  expiry alert window and which alerts appear in the bell
--     license        licence type, valid up to, licensed to (Super Admin only)
--     support        support contact for "Contact Support"
--   settings_backups — log of backups (who, when, size, rows)
--   Storage          — public bucket pharmacy-branding (logo shown on invoices)
--   Functions        — settings_get, settings_save, settings_reset, settings_save_billing,
--                      settings_save_branding, settings_system_info, settings_backup_export,
--                      settings_backup_list, settings_restore
-- Everyone signed in can read the settings (billing and invoices need them); only Admin and
-- Super Admin can change them.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.settings_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'manual',
  tables int NOT NULL DEFAULT 0,
  rows_count bigint NOT NULL DEFAULT 0,
  size_bytes bigint NOT NULL DEFAULT 0,
  include_logs boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_backups_kind_chk CHECK (kind IN ('manual','auto','restore'))
);
CREATE INDEX IF NOT EXISTS settings_backups_branch ON public.settings_backups (branch_id, created_at DESC);
ALTER TABLE public.settings_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.settings_backups FROM PUBLIC, anon, authenticated;

-- Logo (public: it is printed on invoices and on the customer's invoice page)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pharmacy-branding', 'pharmacy-branding', true, 1048576, ARRAY['image/png','image/jpeg','image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
DROP POLICY IF EXISTS pharmacy_branding_read ON storage.objects;
CREATE POLICY pharmacy_branding_read ON storage.objects FOR SELECT USING (bucket_id = 'pharmacy-branding');
DROP POLICY IF EXISTS pharmacy_branding_insert ON storage.objects;
CREATE POLICY pharmacy_branding_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'pharmacy-branding' AND split_part(name, '/', 1) = public.my_branch_id()::text
  AND COALESCE(public.my_role(), '') IN ('super_admin','admin'));
DROP POLICY IF EXISTS pharmacy_branding_delete ON storage.objects;
CREATE POLICY pharmacy_branding_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'pharmacy-branding' AND split_part(name, '/', 1) = public.my_branch_id()::text
  AND COALESCE(public.my_role(), '') IN ('super_admin','admin'));

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION public._settings_branch()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  RETURN v_branch;
END;
$$;
REVOKE ALL ON FUNCTION public._settings_branch() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._settings_admin()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._settings_branch();
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised: only Admin and Super Admin can change settings'; END IF;
  RETURN v_branch;
END;
$$;
REVOKE ALL ON FUNCTION public._settings_admin() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._settings_defaults()
RETURNS jsonb LANGUAGE sql IMMUTABLE
AS $$ SELECT jsonb_build_object(
  'general', jsonb_build_object('language', 'en', 'date_format', 'DD MMM YYYY', 'time_format', '12h', 'currency', 'INR',
                                'low_stock_alerts', true, 'expiry_alerts', true, 'auto_backup', false, 'invoice_logo', true),
  'invoice', jsonb_build_object('default_format', 'thermal', 'show_gstin', true, 'show_drug_licence', true, 'show_patient', true,
                                'terms', '', 'show_upi', false, 'signature_line', false),
  'payments', jsonb_build_object('enabled', jsonb_build_array('cash','card','upi','wallet','credit','split'), 'default_method', 'cash',
                                 'upi_id', '', 'upi_name', ''),
  'notifications', jsonb_build_object('expiry_days', 30, 'deliveries', true, 'expense_drafts', true, 'deactivations', true, 'backup_reminder', true),
  'license', jsonb_build_object('type', 'Professional', 'valid_to', '', 'licensed_to', ''),
  'support', jsonb_build_object('name', '', 'phone', '', 'email', '', 'website', '')
) $$;

-- Keep only known keys with the right type, then check the allowed values.
CREATE OR REPLACE FUNCTION public._settings_clean(p_section text, p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  d jsonb := public._settings_defaults()->p_section;
  r jsonb := '{}'::jsonb;
  k text; v jsonb; x text;
BEGIN
  IF d IS NULL THEN RAISE EXCEPTION 'Unknown settings section %', p_section; END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN RAISE EXCEPTION 'Invalid settings'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(d) LOOP
    IF p_value ? k AND jsonb_typeof(p_value->k) = jsonb_typeof(v) THEN r := r || jsonb_build_object(k, p_value->k);
    ELSIF p_value ? k AND jsonb_typeof(p_value->k) = 'null' AND jsonb_typeof(v) = 'string' THEN r := r || jsonb_build_object(k, '');
    ELSIF p_value ? k THEN RAISE EXCEPTION 'Invalid value for %', k;
    ELSE r := r || jsonb_build_object(k, v); END IF;
  END LOOP;
  IF p_section = 'general' THEN
    IF r->>'language' NOT IN ('en') THEN RAISE EXCEPTION 'Only English is available'; END IF;
    IF r->>'date_format' NOT IN ('DD MMM YYYY','DD/MM/YYYY','DD-MM-YYYY','MM/DD/YYYY','YYYY-MM-DD') THEN RAISE EXCEPTION 'Unknown date format'; END IF;
    IF r->>'time_format' NOT IN ('12h','24h') THEN RAISE EXCEPTION 'Unknown time format'; END IF;
    IF r->>'currency' NOT IN ('INR') THEN RAISE EXCEPTION 'Only Indian Rupee is available'; END IF;
  ELSIF p_section = 'invoice' THEN
    IF r->>'default_format' NOT IN ('thermal','a4') THEN RAISE EXCEPTION 'Paper must be Thermal 80mm or A4'; END IF;
    IF length(r->>'terms') > 500 THEN RAISE EXCEPTION 'Terms can be up to 500 characters'; END IF;
  ELSIF p_section = 'payments' THEN
    IF jsonb_array_length(r->'enabled') = 0 THEN RAISE EXCEPTION 'Keep at least one payment method'; END IF;
    FOR x IN SELECT jsonb_array_elements_text(r->'enabled') LOOP
      IF x NOT IN ('cash','card','upi','wallet','credit','split') THEN RAISE EXCEPTION 'Unknown payment method %', x; END IF;
    END LOOP;
    IF NOT (r->'enabled') ? (r->>'default_method') OR r->>'default_method' IN ('credit','split') THEN
      RAISE EXCEPTION 'The default method must be Cash, Card, UPI or Wallet and switched on';
    END IF;
    IF r->>'upi_id' <> '' AND r->>'upi_id' !~ '^[A-Za-z0-9._-]{2,200}@[A-Za-z][A-Za-z0-9.-]{1,63}$' THEN RAISE EXCEPTION 'Enter a valid UPI ID, e.g. pallikkal@okaxis'; END IF;
    IF length(r->>'upi_name') > 80 THEN RAISE EXCEPTION 'UPI name is too long'; END IF;
  ELSIF p_section = 'notifications' THEN
    IF (r->>'expiry_days')::numeric NOT BETWEEN 7 AND 365 THEN RAISE EXCEPTION 'Expiry alert window must be 7 to 365 days'; END IF;
    r := jsonb_set(r, '{expiry_days}', to_jsonb(round((r->>'expiry_days')::numeric)::int));
  ELSIF p_section = 'license' THEN
    IF r->>'valid_to' <> '' AND r->>'valid_to' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Valid up to must be a date'; END IF;
    IF length(r->>'type') > 40 OR length(r->>'licensed_to') > 120 THEN RAISE EXCEPTION 'Licence details are too long'; END IF;
  ELSIF p_section = 'support' THEN
    IF r->>'phone' <> '' AND length(regexp_replace(r->>'phone', '\D', '', 'g')) < 10 THEN RAISE EXCEPTION 'Enter a valid support phone number'; END IF;
    IF r->>'email' <> '' AND r->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid support email'; END IF;
    IF r->>'website' <> '' AND r->>'website' !~* '^https?://' THEN RAISE EXCEPTION 'Website must start with http:// or https://'; END IF;
  END IF;
  RETURN r;
END;
$$;

-- ---------------------------------------------------------------- read
DROP FUNCTION IF EXISTS public.settings_get();
CREATE FUNCTION public.settings_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._settings_branch();
  d jsonb := public._settings_defaults();
  r jsonb := '{}'::jsonb;
  k text;
  v_meta jsonb := '{}'::jsonb;
  v_ph record;
  v_br record;
BEGIN
  FOR k IN SELECT jsonb_object_keys(d) LOOP
    r := r || jsonb_build_object(k, (d->k) || COALESCE((SELECT s.value FROM public.pharmacy_settings s WHERE s.branch_id = v_branch AND s.key = k), '{}'::jsonb));
  END LOOP;
  SELECT COALESCE(jsonb_object_agg(s.key, jsonb_build_object('at', s.updated_at, 'by', p.full_name)), '{}'::jsonb) INTO v_meta
  FROM public.pharmacy_settings s LEFT JOIN public.profiles p ON p.id = s.updated_by
  WHERE s.branch_id = v_branch AND s.key IN (SELECT jsonb_object_keys(d));
  SELECT * INTO v_br FROM public.branches WHERE id = v_branch;
  SELECT * INTO v_ph FROM public.pharmacies WHERE id = v_br.pharmacy_id;
  RETURN r || jsonb_build_object(
    'billing', COALESCE((SELECT jsonb_build_object('max_discount_pct', b.max_discount_pct, 'reservation_minutes', b.reservation_minutes,
                          'near_expiry_days', b.near_expiry_days, 'updated_at', b.updated_at) FROM public.billing_settings b WHERE b.branch_id = v_branch),
                        jsonb_build_object('max_discount_pct', 30, 'reservation_minutes', 15, 'near_expiry_days', 90)),
    'branding', jsonb_build_object('pharmacy_name', v_ph.name, 'tagline', v_ph.tagline, 'logo_path', v_ph.logo_path,
                                   'branch_name', v_br.name, 'branch_code', v_br.code, 'timezone', v_br.timezone),
    'updated', v_meta,
    'role', public.my_role(),
    'is_admin', COALESCE(public.my_role(), '') IN ('super_admin','admin'),
    'is_super', COALESCE(public.my_role(), '') = 'super_admin');
END;
$$;

DROP FUNCTION IF EXISTS public.settings_system_info();
CREATE FUNCTION public.settings_system_info()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE v_branch uuid := public._settings_admin(); v_size bigint; r jsonb;
BEGIN
  BEGIN v_size := pg_database_size(current_database()); EXCEPTION WHEN OTHERS THEN v_size := NULL; END;
  SELECT jsonb_build_object(
    'database_size', v_size,
    'server_time', now(),
    'postgres', current_setting('server_version'),
    'counts', jsonb_build_object(
      'medicines', (SELECT count(*) FROM public.medicines WHERE branch_id = v_branch AND active),
      'customers', (SELECT count(*) FROM public.customers WHERE branch_id = v_branch),
      'distributors', (SELECT count(*) FROM public.distributors WHERE branch_id = v_branch),
      'invoices', (SELECT count(*) FROM public.sales_invoices WHERE branch_id = v_branch),
      'purchases', (SELECT count(*) FROM public.purchase_invoices WHERE branch_id = v_branch),
      'staff', (SELECT count(*) FROM public.profiles WHERE branch_id = v_branch AND is_active),
      'audit_logs', (SELECT count(*) FROM public.audit_logs WHERE branch_id = v_branch)),
    'files', COALESCE((SELECT jsonb_object_agg(bucket_id, jsonb_build_object('count', n, 'bytes', b)) FROM (
        SELECT o.bucket_id, count(*) n, COALESCE(sum((o.metadata->>'size')::bigint), 0) b FROM storage.objects o
        WHERE split_part(o.name, '/', 1) = v_branch::text
           OR (o.bucket_id = 'purchase-documents' AND EXISTS (SELECT 1 FROM public.purchase_documents pd WHERE pd.path = o.name AND pd.branch_id = v_branch))
        GROUP BY o.bucket_id) f), '{}'::jsonb),
    'last_backup', (SELECT jsonb_build_object('at', b.created_at, 'kind', b.kind, 'size_bytes', b.size_bytes, 'rows', b.rows_count, 'by', p.full_name)
                    FROM public.settings_backups b LEFT JOIN public.profiles p ON p.id = b.created_by
                    WHERE b.branch_id = v_branch AND b.kind <> 'restore' ORDER BY b.created_at DESC LIMIT 1),
    'backups', (SELECT count(*) FROM public.settings_backups WHERE branch_id = v_branch AND kind <> 'restore')
  ) INTO r;
  RETURN r;
END;
$$;

-- ---------------------------------------------------------------- write
DROP FUNCTION IF EXISTS public.settings_save(text, jsonb);
CREATE FUNCTION public.settings_save(p_section text, p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._settings_admin(); v_clean jsonb; v_before jsonb;
BEGIN
  IF p_section = 'license' AND COALESCE(public.my_role(), '') <> 'super_admin' THEN RAISE EXCEPTION 'Only Super Admin can change licence details'; END IF;
  v_clean := public._settings_clean(p_section, p_value);
  SELECT value INTO v_before FROM public.pharmacy_settings WHERE branch_id = v_branch AND key = p_section;
  INSERT INTO public.pharmacy_settings(branch_id, key, value, updated_by, updated_at) VALUES (v_branch, p_section, v_clean, auth.uid(), now())
  ON CONFLICT (branch_id, key) DO UPDATE SET value = excluded.value, updated_by = auth.uid(), updated_at = now();
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'settings_saved', 'settings', p_section, v_before, v_clean);
  RETURN public.settings_get();
END;
$$;

DROP FUNCTION IF EXISTS public.settings_reset(text);
CREATE FUNCTION public.settings_reset(p_section text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._settings_admin(); v_before jsonb;
BEGIN
  IF p_section = 'license' AND COALESCE(public.my_role(), '') <> 'super_admin' THEN RAISE EXCEPTION 'Only Super Admin can change licence details'; END IF;
  IF p_section = 'billing' THEN
    SELECT to_jsonb(b) INTO v_before FROM public.billing_settings b WHERE b.branch_id = v_branch;
    INSERT INTO public.billing_settings(branch_id, max_discount_pct, reservation_minutes, near_expiry_days, updated_by, updated_at)
    VALUES (v_branch, 30, 15, 90, auth.uid(), now())
    ON CONFLICT (branch_id) DO UPDATE SET max_discount_pct = 30, reservation_minutes = 15, near_expiry_days = 90, updated_by = auth.uid(), updated_at = now();
  ELSE
    IF public._settings_defaults()->p_section IS NULL THEN RAISE EXCEPTION 'Unknown settings section %', p_section; END IF;
    DELETE FROM public.pharmacy_settings WHERE branch_id = v_branch AND key = p_section RETURNING value INTO v_before;
  END IF;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, before_data)
  VALUES (v_branch, auth.uid(), 'settings_reset', 'settings', p_section, v_before);
  RETURN public.settings_get();
END;
$$;

DROP FUNCTION IF EXISTS public.settings_save_billing(numeric, int, int);
CREATE FUNCTION public.settings_save_billing(p_max_discount numeric, p_reservation int, p_near_expiry int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._settings_admin(); v_before jsonb;
BEGIN
  IF p_max_discount IS NULL OR p_max_discount NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Maximum discount must be between 0 and 100%%'; END IF;
  IF p_reservation IS NULL OR p_reservation NOT BETWEEN 1 AND 240 THEN RAISE EXCEPTION 'Reservation must be 1 to 240 minutes'; END IF;
  IF p_near_expiry IS NULL OR p_near_expiry NOT BETWEEN 0 AND 730 THEN RAISE EXCEPTION 'Near-expiry warning must be 0 to 730 days'; END IF;
  SELECT jsonb_build_object('max_discount_pct', max_discount_pct, 'reservation_minutes', reservation_minutes, 'near_expiry_days', near_expiry_days)
  INTO v_before FROM public.billing_settings WHERE branch_id = v_branch;
  INSERT INTO public.billing_settings(branch_id, max_discount_pct, reservation_minutes, near_expiry_days, updated_by, updated_at)
  VALUES (v_branch, p_max_discount, p_reservation, p_near_expiry, auth.uid(), now())
  ON CONFLICT (branch_id) DO UPDATE SET max_discount_pct = excluded.max_discount_pct, reservation_minutes = excluded.reservation_minutes,
    near_expiry_days = excluded.near_expiry_days, updated_by = auth.uid(), updated_at = now();
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'billing_settings_changed', 'settings', 'billing', v_before,
          jsonb_build_object('max_discount_pct', p_max_discount, 'reservation_minutes', p_reservation, 'near_expiry_days', p_near_expiry));
  RETURN public.settings_get();
END;
$$;

-- Tagline and logo belong to the pharmacy (shown on invoices of every branch).
DROP FUNCTION IF EXISTS public.settings_save_branding(text, text);
CREATE FUNCTION public.settings_save_branding(p_tagline text, p_logo_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE v_branch uuid := public._settings_admin(); v_ph uuid; v_before jsonb; v_logo text := nullif(trim(COALESCE(p_logo_path, '')), '');
BEGIN
  IF length(COALESCE(p_tagline, '')) > 120 THEN RAISE EXCEPTION 'Tagline can be up to 120 characters'; END IF;
  IF v_logo IS NOT NULL THEN
    IF split_part(v_logo, '/', 1) <> v_branch::text THEN RAISE EXCEPTION 'Logo must be uploaded for this branch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'pharmacy-branding' AND name = v_logo) THEN RAISE EXCEPTION 'Uploaded logo not found'; END IF;
  END IF;
  SELECT pharmacy_id INTO v_ph FROM public.branches WHERE id = v_branch;
  SELECT jsonb_build_object('tagline', tagline, 'logo_path', logo_path) INTO v_before FROM public.pharmacies WHERE id = v_ph;
  UPDATE public.pharmacies SET tagline = nullif(trim(COALESCE(p_tagline, '')), ''), logo_path = v_logo WHERE id = v_ph;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'branding_saved', 'settings', 'branding', v_before, jsonb_build_object('tagline', p_tagline, 'logo_path', v_logo));
  RETURN public.settings_get();
END;
$$;

-- ---------------------------------------------------------------- backup / restore
-- Every table of this branch (rows with branch_id = this branch) plus the shared lists
-- (categories, manufacturers, storage locations, units, unit conversions, GST slabs, roles).
-- Files in storage are not inside the backup (their paths are).
DROP FUNCTION IF EXISTS public.settings_backup_export(boolean, text);
CREATE FUNCTION public.settings_backup_export(p_include_logs boolean DEFAULT false, p_kind text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._settings_admin();
  v_tables jsonb := '{}'::jsonb;
  v_rows bigint := 0; v_n int := 0;
  t text; j jsonb; c bigint;
  v_out jsonb; v_id uuid;
BEGIN
  IF p_kind NOT IN ('manual','auto') THEN RAISE EXCEPTION 'Invalid backup kind'; END IF;
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'branch_id')
      AND c.relname NOT IN ('settings_backups','login_attempts')
      AND (p_include_logs OR c.relname <> 'audit_logs')
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x)), ''[]''::jsonb), count(*) FROM public.%I x WHERE x.branch_id = $1', t) INTO j, c USING v_branch;
    v_tables := v_tables || jsonb_build_object(t, j); v_rows := v_rows + c; v_n := v_n + 1;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['categories','manufacturers','storage_locations','units','unit_conversions','gst_rate_slabs','roles','role_permissions'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x)), ''[]''::jsonb), count(*) FROM public.%I x', t) INTO j, c;
      v_tables := v_tables || jsonb_build_object(t, j); v_rows := v_rows + c; v_n := v_n + 1;
    END IF;
  END LOOP;
  v_tables := v_tables || jsonb_build_object('branches', (SELECT jsonb_agg(to_jsonb(b)) FROM public.branches b WHERE b.id = v_branch),
                                             'pharmacies', (SELECT jsonb_agg(to_jsonb(p)) FROM public.pharmacies p JOIN public.branches b ON b.pharmacy_id = p.id WHERE b.id = v_branch));
  v_out := jsonb_build_object('format', 'pallikkal-pharmacy-backup', 'format_version', 1, 'created_at', now(), 'branch_id', v_branch,
    'branch', (SELECT name FROM public.branches WHERE id = v_branch), 'include_logs', p_include_logs, 'tables', v_tables);
  INSERT INTO public.settings_backups(branch_id, kind, tables, rows_count, size_bytes, include_logs, created_by)
  VALUES (v_branch, p_kind, v_n, v_rows, octet_length(v_out::text), p_include_logs, auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, after_data)
  VALUES (v_branch, auth.uid(), 'backup_downloaded', 'settings', v_id::text, jsonb_build_object('kind', p_kind, 'tables', v_n, 'rows', v_rows, 'include_logs', p_include_logs));
  RETURN v_out || jsonb_build_object('backup_id', v_id, 'rows', v_rows, 'table_count', v_n);
END;
$$;

DROP FUNCTION IF EXISTS public.settings_backup_list(int);
CREATE FUNCTION public.settings_backup_list(p_limit int DEFAULT 20)
RETURNS TABLE (id uuid, kind text, tables int, rows_count bigint, size_bytes bigint, include_logs boolean, created_at timestamptz, by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._settings_admin();
BEGIN
  RETURN QUERY SELECT b.id, b.kind, b.tables, b.rows_count, b.size_bytes, b.include_logs, b.created_at, p.full_name
  FROM public.settings_backups b LEFT JOIN public.profiles p ON p.id = b.created_by
  WHERE b.branch_id = v_branch ORDER BY b.created_at DESC LIMIT least(greatest(COALESCE(p_limit, 20), 1), 200);
END;
$$;

-- Restore from a backup file: settings, pharmacy details and master lists only. Missing master
-- rows are added (matched by name / code); nothing is deleted. Sales, stock, purchases and
-- accounts are never overwritten from a file.
DROP FUNCTION IF EXISTS public.settings_restore(jsonb, text[]);
CREATE FUNCTION public.settings_restore(p_data jsonb, p_parts text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._settings_admin();
  t jsonb := p_data->'tables';
  r jsonb; k text; n int; out jsonb := '{}'::jsonb; v_from uuid; v_to uuid;
BEGIN
  IF p_data->>'format' IS DISTINCT FROM 'pallikkal-pharmacy-backup' OR jsonb_typeof(t) <> 'object' THEN RAISE EXCEPTION 'This is not a Pallikkal Pharmacy backup file'; END IF;
  IF p_parts IS NULL OR cardinality(p_parts) = 0 THEN RAISE EXCEPTION 'Choose what to restore'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_parts) x WHERE x NOT IN ('settings','branch','masters','expense_categories')) THEN RAISE EXCEPTION 'Unknown restore option'; END IF;

  IF 'settings' = ANY (p_parts) THEN
    n := 0;
    FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(t->'pharmacy_settings', '[]'::jsonb)) LOOP
      k := r->>'key';
      IF public._settings_defaults() ? k AND k <> 'license' THEN
        INSERT INTO public.pharmacy_settings(branch_id, key, value, updated_by, updated_at)
        VALUES (v_branch, k, public._settings_clean(k, r->'value'), auth.uid(), now())
        ON CONFLICT (branch_id, key) DO UPDATE SET value = excluded.value, updated_by = auth.uid(), updated_at = now();
        n := n + 1;
      END IF;
    END LOOP;
    r := t->'billing_settings'->0;
    IF r IS NOT NULL THEN
      PERFORM public.settings_save_billing((r->>'max_discount_pct')::numeric, (r->>'reservation_minutes')::int, (r->>'near_expiry_days')::int);
      n := n + 1;
    END IF;
    out := out || jsonb_build_object('settings', n);
  END IF;

  IF 'branch' = ANY (p_parts) AND t->'branches'->0 IS NOT NULL THEN
    r := t->'branches'->0;
    UPDATE public.branches SET name = COALESCE(nullif(r->>'name', ''), name), address = r->>'address', city = r->>'city', state = r->>'state',
      pincode = r->>'pincode', phone = r->>'phone', email = r->>'email', gstin = r->>'gstin',
      drug_licence_nos = COALESCE(r->'drug_licence_nos', '[]'::jsonb), invoice_prefix = COALESCE(nullif(r->>'invoice_prefix', ''), invoice_prefix),
      invoice_footer = r->>'invoice_footer'
    WHERE id = v_branch;
    out := out || jsonb_build_object('branch', 1);
  END IF;

  IF 'masters' = ANY (p_parts) THEN
    FOREACH k IN ARRAY ARRAY['categories','manufacturers','storage_locations'] LOOP
      n := 0;
      FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(t->k, '[]'::jsonb)) LOOP
        IF nullif(trim(r->>'name'), '') IS NOT NULL THEN
          EXECUTE format('INSERT INTO public.%I(name, active) SELECT $1, COALESCE($2, true) WHERE NOT EXISTS (SELECT 1 FROM public.%I WHERE lower(name) = lower($1))', k, k)
          USING trim(r->>'name'), (r->>'active')::boolean;
          GET DIAGNOSTICS n = ROW_COUNT; out := jsonb_set(out, ARRAY[k], to_jsonb(COALESCE((out->>k)::int, 0) + n));
        END IF;
      END LOOP;
      IF NOT out ? k THEN out := out || jsonb_build_object(k, 0); END IF;
    END LOOP;
    n := 0;
    FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(t->'units', '[]'::jsonb)) LOOP
      IF nullif(trim(r->>'name'), '') IS NOT NULL AND nullif(trim(r->>'code'), '') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.units u WHERE lower(u.code) = lower(trim(r->>'code')) OR lower(u.name) = lower(trim(r->>'name'))) THEN
        INSERT INTO public.units(name, code, active) VALUES (trim(r->>'name'), trim(r->>'code'), COALESCE((r->>'active')::boolean, true)); n := n + 1;
      END IF;
    END LOOP;
    out := out || jsonb_build_object('units', n);
    n := 0;
    FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(t->'unit_conversions', '[]'::jsonb)) LOOP
      SELECT u.id INTO v_from FROM public.units u JOIN jsonb_array_elements(t->'units') x ON lower(x->>'code') = lower(u.code) WHERE x->>'id' = r->>'from_unit_id' LIMIT 1;
      SELECT u.id INTO v_to FROM public.units u JOIN jsonb_array_elements(t->'units') x ON lower(x->>'code') = lower(u.code) WHERE x->>'id' = r->>'to_unit_id' LIMIT 1;
      IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from <> v_to AND (r->>'factor')::numeric > 0
         AND NOT EXISTS (SELECT 1 FROM public.unit_conversions c WHERE c.from_unit_id = v_from AND c.to_unit_id = v_to) THEN
        INSERT INTO public.unit_conversions(from_unit_id, to_unit_id, factor) VALUES (v_from, v_to, (r->>'factor')::numeric); n := n + 1;
      END IF;
    END LOOP;
    out := out || jsonb_build_object('unit_conversions', n);
  END IF;

  IF 'expense_categories' = ANY (p_parts) THEN
    n := 0;
    FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(t->'expense_categories', '[]'::jsonb)) LOOP
      IF nullif(trim(r->>'name'), '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.expense_categories e WHERE (e.branch_id = v_branch OR e.branch_id IS NULL) AND lower(e.name) = lower(trim(r->>'name'))) THEN
        INSERT INTO public.expense_categories(branch_id, name, active, created_by) VALUES (v_branch, trim(r->>'name'), COALESCE((r->>'active')::boolean, true), auth.uid()); n := n + 1;
      END IF;
    END LOOP;
    out := out || jsonb_build_object('expense_categories', n);
  END IF;

  INSERT INTO public.settings_backups(branch_id, kind, created_by) VALUES (v_branch, 'restore', auth.uid());
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, after_data)
  VALUES (v_branch, auth.uid(), 'backup_restored', 'settings', COALESCE(p_data->>'created_at', ''), out || jsonb_build_object('parts', to_jsonb(p_parts)));
  RETURN out;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['settings_get()', 'settings_system_info()', 'settings_save(text, jsonb)', 'settings_reset(text)',
    'settings_save_billing(numeric, int, int)', 'settings_save_branding(text, text)', 'settings_backup_export(boolean, text)',
    'settings_backup_list(int)', 'settings_restore(jsonb, text[])'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
