-- =============================================================================
-- 0034  Audit Logs (audit-logs.html)
-- Run once in the Supabase SQL editor after 0033. Safe to run twice.
--
--   One activity list: audit_logs entries plus staff logins and logouts (work_sessions), each with
--   module (Sales, Inventory, Medicines, Purchase, …), action type (Created / Updated / Deleted /
--   Exported / Login / Logout) and a "critical" flag for sensitive changes.
--   IP address — from now on the caller's IP (X-Forwarded-For sent by Supabase) is saved on new
--   audit entries and work sessions. Older entries have no IP.
--   Functions — audit_overview, audit_list, audit_user_report, audit_login_history,
--               audit_log_export, audit_settings_get, audit_settings_save
-- Same access as before: Admin and Super Admin (permission audit.view); failed sign-in attempts
-- need security.view. Audit entries stay append-only — nothing here edits or deletes them.
-- =============================================================================

-- ---------------------------------------------------------------- IP capture
CREATE OR REPLACE FUNCTION public._audit_request_ip()
RETURNS inet LANGUAGE plpgsql STABLE
AS $$
DECLARE h text; v text;
BEGIN
  h := current_setting('request.headers', true);
  IF h IS NULL OR h = '' THEN RETURN NULL; END IF;
  v := trim(split_part(COALESCE(h::json->>'x-forwarded-for', h::json->>'x-real-ip', ''), ',', 1));
  IF v = '' THEN RETURN NULL; END IF;
  RETURN v::inet;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._audit_fill_ip()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ip IS NULL THEN NEW.ip := public._audit_request_ip(); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_logs_fill_ip ON public.audit_logs;
CREATE TRIGGER audit_logs_fill_ip BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public._audit_fill_ip();
DROP TRIGGER IF EXISTS work_sessions_fill_ip ON public.work_sessions;
CREATE TRIGGER work_sessions_fill_ip BEFORE INSERT ON public.work_sessions FOR EACH ROW EXECUTE FUNCTION public._audit_fill_ip();

CREATE INDEX IF NOT EXISTS audit_logs_branch_at ON public.audit_logs (branch_id, at DESC);
CREATE INDEX IF NOT EXISTS work_sessions_branch_login ON public.work_sessions (branch_id, login_at DESC);

-- ---------------------------------------------------------------- classification
CREATE OR REPLACE FUNCTION public._audit_module(p_action text, p_entity text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE
  WHEN p_action IN ('login','logout') THEN 'System'
  WHEN p_action ~ '^(settings|branding|pharmacy_profile|billing_settings|backup|delivery_settings|whatsapp_settings|audit_settings)' OR p_entity IN ('settings','branch') THEN 'Settings'
  WHEN p_action ~ '^audit_' OR p_entity IN ('report','report_run') OR p_action ~ 'report' THEN 'Reports'
  WHEN p_action ~ '^document' OR p_entity ~ '(pharmacy_document|purchase_document|document_)' OR p_action ~ '^purchase_document' THEN 'Documents'
  WHEN p_entity = 'sales_return' OR p_action ~ '^sales?_return' THEN 'Returns'
  WHEN p_entity = 'purchase_return' OR p_action ~ '^(purchase|supplier|po_)' OR p_entity ~ '^(purchase_invoice|purchase_order|supplier)' THEN 'Purchase'
  WHEN p_action ~ '^(sale_|billing_|invoice)' OR p_entity IN ('sales_invoice','invoice','billing_session','billing') THEN 'Sales'
  WHEN p_action ~ '(batch|stock|physical_count|opening_stock|transfer|inventory)' OR p_entity ~ '(batch|stock|physical_count|opening_stock|inventory|transfer)' THEN 'Inventory'
  WHEN p_action ~ '^medicine' OR p_entity ~ '^medicine' THEN 'Medicines'
  WHEN p_action ~ '^(customer|credit_limit)' OR p_entity ~ '^customer' THEN 'Customer'
  WHEN p_action ~ '^delivery' OR p_entity ~ '^delivery' THEN 'Delivery'
  WHEN p_action ~ '^expense' OR p_entity ~ '^expense' THEN 'Expenses'
  WHEN p_action ~ '^(account|daily_cash|journal|ledger)' OR p_entity ~ '^(account|daily_cash|journal)' THEN 'Finance'
  WHEN p_action ~ '^(staff|role)' OR p_entity IN ('staff','profile') THEN 'Staff'
  WHEN p_action ~ '^whatsapp' OR p_entity ~ '^whatsapp' THEN 'WhatsApp'
  ELSE 'Other' END $$;

CREATE OR REPLACE FUNCTION public._audit_kind(p_action text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE
  WHEN p_action = 'login' THEN 'login'
  WHEN p_action = 'logout' THEN 'logout'
  WHEN p_action ~ '(exported|downloaded|_export$)' THEN 'exported'
  WHEN p_action ~ '(viewed|_view$)' THEN 'viewed'
  WHEN p_action ~ '(deleted|removed|cancelled|canceled|void|reversed|deactivated|_delete$|_remove$)' THEN 'deleted'
  WHEN p_action ~ '(created|_create$|added|recorded|finalized|uploaded|submitted|requested|registered|confirmed|posted|_receive$)' THEN 'created'
  WHEN p_action ~ '(updated|_update$|changed|saved|renamed|edited|corrected|adjusted|_set$|marked|moved|assigned|reset|override|quarantined|released|activated|primary|restored|decided|approved|rejected|reported)' THEN 'updated'
  ELSE 'other' END $$;

CREATE OR REPLACE FUNCTION public._audit_critical(p_action text, p_entity text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT public._audit_kind(p_action) = 'deleted'
  OR p_action ~ '(override|role_changed|reset|settings|reversed|cancelled|corrected|password|restored|quarantined|stock_status|price|mrp|branding|permission|credit_limit|pharmacy_profile|opening_stock_batch_edited)'
  OR p_entity = 'settings' $$;

-- One line describing the entry: action + the record's name / number + amount.
CREATE OR REPLACE FUNCTION public._audit_details(p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb, p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  WITH x AS (
    SELECT COALESCE(p_after, '{}'::jsonb) a, COALESCE(p_before, '{}'::jsonb) b),
  y AS (
    SELECT COALESCE(a->>'invoice_no', a->>'return_no', a->>'purchase_no', a->>'supplier_invoice_no', a->>'expense_no', a->>'payment_no', a->>'receipt_no',
                    a->>'po_no', a->>'transfer_no', a->>'name', a->>'full_name', a->>'file_name', a->>'title', a->>'staff_id',
                    b->>'invoice_no', b->>'return_no', b->>'name', b->>'file_name', b->>'title') AS nm,
           COALESCE(a->>'total', a->>'amount', b->>'total', b->>'amount') AS amt
    FROM x)
  SELECT initcap(replace(regexp_replace(p_action, '^(sale|staff|document|whatsapp|expense|delivery|purchase|medicine|customer|settings)_', '\1 '), '_', ' '))
    || CASE WHEN nm IS NOT NULL THEN ': ' || nm
            WHEN p_entity_id IS NOT NULL AND p_entity_id !~ '^[0-9a-f]{8}-' THEN ': ' || p_entity_id ELSE '' END
    || CASE WHEN amt ~ '^-?\d+(\.\d+)?$' THEN ' (₹' || to_char(amt::numeric, 'FM99,99,99,990.00') || ')' ELSE '' END
    || CASE WHEN p_reason IS NOT NULL AND p_reason <> '' THEN ' — ' || p_reason ELSE '' END
  FROM y
$$;

CREATE OR REPLACE FUNCTION public._audit_guard()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF NOT app.has_perm('audit.view') THEN RAISE EXCEPTION 'Not authorised: audit logs are for Admin and Super Admin'; END IF;
  RETURN v_branch;
END;
$$;
REVOKE ALL ON FUNCTION public._audit_guard() FROM PUBLIC, anon, authenticated;

-- Unified rows for a period (IST dates; NULL = open ended).
CREATE OR REPLACE FUNCTION public._audit_rows(p_branch uuid, p_from date, p_to date)
RETURNS TABLE (src text, id text, at timestamptz, user_id uuid, user_name text, staff_id text, action text, entity_type text, entity_id text,
  reason text, before_data jsonb, after_data jsonb, ip text, module text, kind text, critical boolean, details text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH lim AS (
    SELECT CASE WHEN p_from IS NULL THEN '-infinity'::timestamptz ELSE (p_from::timestamp AT TIME ZONE 'Asia/Kolkata') END AS f,
           CASE WHEN p_to IS NULL THEN 'infinity'::timestamptz ELSE ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') END AS t),
  ev AS (
    SELECT 'audit'::text src, a.id::text id, a.at, a.user_id, a.action, a.entity_type, a.entity_id, a.reason, a.before_data, a.after_data, host(a.ip) ip
    FROM public.audit_logs a, lim WHERE a.branch_id = p_branch AND a.at >= lim.f AND a.at < lim.t
    UNION ALL
    SELECT 'session', 'in-' || w.id, w.login_at, w.user_id, 'login', 'session', w.id::text, NULL, NULL, NULL, host(w.ip)
    FROM public.work_sessions w, lim WHERE w.branch_id = p_branch AND w.login_at >= lim.f AND w.login_at < lim.t
    UNION ALL
    SELECT 'session', 'out-' || w.id, w.logout_at, w.user_id, 'logout', 'session', w.id::text,
           CASE w.logout_reason WHEN 'manual' THEN NULL WHEN 'idle' THEN 'Signed out after being idle' WHEN 'new_login' THEN 'Signed in on another device'
             WHEN 'admin' THEN 'Signed out by an administrator' WHEN 'deactivated' THEN 'Login deactivated' ELSE w.logout_reason END,
           NULL, NULL, host(w.ip)
    FROM public.work_sessions w, lim WHERE w.branch_id = p_branch AND w.logout_at IS NOT NULL AND w.logout_at >= lim.f AND w.logout_at < lim.t)
  SELECT e.src, e.id, e.at, e.user_id, COALESCE(p.full_name, CASE WHEN e.user_id IS NULL THEN 'System' ELSE 'Unknown user' END), p.staff_id::text,
         e.action, e.entity_type, e.entity_id, e.reason, e.before_data, e.after_data, e.ip,
         public._audit_module(e.action, e.entity_type), public._audit_kind(e.action), public._audit_critical(e.action, e.entity_type),
         CASE e.action WHEN 'login' THEN 'User logged in' WHEN 'logout' THEN 'User logged out' || COALESCE(' — ' || e.reason, '')
           ELSE public._audit_details(e.action, e.entity_type, e.entity_id, e.before_data, e.after_data, e.reason) END
  FROM ev e LEFT JOIN public.profiles p ON p.id = e.user_id
$$;
REVOKE ALL ON FUNCTION public._audit_rows(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- read
DROP FUNCTION IF EXISTS public.audit_overview(date, date);
CREATE FUNCTION public.audit_overview(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_branch uuid := public._audit_guard();
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_to date := COALESCE(p_to, v_today);
  v_len int; v_prev bigint := NULL; r jsonb;
BEGIN
  IF p_from IS NOT NULL THEN
    v_len := v_to - p_from + 1;
    SELECT count(*) INTO v_prev FROM public._audit_rows(v_branch, p_from - v_len, p_from - 1);
  END IF;
  WITH x AS (SELECT * FROM public._audit_rows(v_branch, p_from, p_to))
  SELECT jsonb_build_object(
    'from', p_from, 'to', v_to, 'previous_total', v_prev,
    'total', (SELECT count(*) FROM x),
    'active_users', (SELECT count(DISTINCT user_id) FROM x WHERE user_id IS NOT NULL),
    'critical', (SELECT count(*) FROM x WHERE critical),
    'login_events', (SELECT count(*) FROM x WHERE kind IN ('login','logout')),
    'logins', (SELECT count(*) FROM x WHERE kind = 'login'),
    'logouts', (SELECT count(*) FROM x WHERE kind = 'logout'),
    'failed_logins', CASE WHEN app.has_perm('security.view') THEN (SELECT count(*) FROM public.login_attempts la
        WHERE NOT la.success AND (p_from IS NULL OR la.at >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata'))
          AND la.at < ((v_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')) END,
    'kinds', (SELECT COALESCE(jsonb_object_agg(kind, n), '{}'::jsonb) FROM (SELECT kind, count(*) n FROM x GROUP BY kind) k),
    'modules', (SELECT COALESCE(jsonb_agg(jsonb_build_object('module', module, 'count', n) ORDER BY n DESC, module), '[]'::jsonb)
                FROM (SELECT module, count(*) n FROM x GROUP BY module) m),
    'critical_recent', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'src', c.src, 'at', c.at, 'user_name', c.user_name, 'action', c.action,
                          'module', c.module, 'kind', c.kind, 'details', c.details) ORDER BY c.at DESC), '[]'::jsonb)
                        FROM (SELECT * FROM x WHERE critical ORDER BY at DESC LIMIT 6) c),
    'users', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', u.user_id, 'name', u.user_name, 'count', u.n) ORDER BY u.user_name), '[]'::jsonb)
              FROM (SELECT user_id, min(user_name) user_name, count(*) n FROM x WHERE user_id IS NOT NULL GROUP BY user_id) u),
    'all_users', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) ORDER BY p.full_name), '[]'::jsonb)
                  FROM public.profiles p WHERE p.branch_id = v_branch),
    'first_entry', (SELECT min(a.at) FROM public.audit_logs a WHERE a.branch_id = v_branch),
    'can_security', app.has_perm('security.view')
  ) INTO r;
  RETURN r;
END;
$$;

DROP FUNCTION IF EXISTS public.audit_list(date, date, text, uuid, text, text, boolean, int, int);
CREATE FUNCTION public.audit_list(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_q text DEFAULT NULL, p_user uuid DEFAULT NULL,
  p_module text DEFAULT NULL, p_kind text DEFAULT NULL, p_critical boolean DEFAULT false, p_limit int DEFAULT 10, p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_branch uuid := public._audit_guard();
  v_q text := nullif(trim(COALESCE(p_q, '')), '');
  r jsonb;
BEGIN
  WITH f AS (
    SELECT x.* FROM public._audit_rows(v_branch, p_from, p_to) x
    WHERE (p_user IS NULL OR x.user_id = p_user)
      AND (p_module IS NULL OR p_module = '' OR x.module = p_module)
      AND (p_kind IS NULL OR p_kind = '' OR x.kind = p_kind)
      AND (NOT COALESCE(p_critical, false) OR x.critical)
      AND (v_q IS NULL OR concat_ws(' ', x.details, x.action, x.user_name, x.staff_id, x.module, x.entity_type, x.entity_id, x.reason, x.ip) ILIKE '%' || v_q || '%'
           OR x.after_data::text ILIKE '%' || v_q || '%' OR x.before_data::text ILIKE '%' || v_q || '%')),
  pg AS (SELECT * FROM f ORDER BY at DESC, id DESC LIMIT least(greatest(COALESCE(p_limit, 10), 1), 5000) OFFSET greatest(COALESCE(p_offset, 0), 0))
  SELECT jsonb_build_object('total', (SELECT count(*) FROM f),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(pg) ORDER BY pg.at DESC, pg.id DESC) FROM pg), '[]'::jsonb)) INTO r;
  RETURN r;
END;
$$;

-- Per staff member: how much they did, what kind, and when.
DROP FUNCTION IF EXISTS public.audit_user_report(date, date);
CREATE FUNCTION public.audit_user_report(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (user_id uuid, user_name text, staff_id text, role text, total bigint, created bigint, updated bigint, deleted bigint, exported bigint,
  critical bigint, logins bigint, first_at timestamptz, last_at timestamptz, top_module text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE v_branch uuid := public._audit_guard();
BEGIN
  RETURN QUERY
  WITH x AS (SELECT * FROM public._audit_rows(v_branch, p_from, p_to) z WHERE z.user_id IS NOT NULL)
  SELECT x.user_id, min(x.user_name), min(x.staff_id), min(r.name)::text, count(*),
         count(*) FILTER (WHERE x.kind = 'created'), count(*) FILTER (WHERE x.kind = 'updated'), count(*) FILTER (WHERE x.kind = 'deleted'),
         count(*) FILTER (WHERE x.kind = 'exported'), count(*) FILTER (WHERE x.critical), count(*) FILTER (WHERE x.kind = 'login'),
         min(x.at), max(x.at),
         (SELECT y.module FROM x y WHERE y.user_id = x.user_id AND y.module <> 'System' GROUP BY y.module ORDER BY count(*) DESC, y.module LIMIT 1)
  FROM x LEFT JOIN public.profiles p ON p.id = x.user_id LEFT JOIN public.roles r ON r.id = p.role_id
  GROUP BY x.user_id
  ORDER BY count(*) DESC;
END;
$$;

-- Logins with session length, and (security.view) every sign-in attempt incl. failed ones.
DROP FUNCTION IF EXISTS public.audit_login_history(date, date, int);
CREATE FUNCTION public.audit_login_history(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_branch uuid := public._audit_guard();
  v_f timestamptz := CASE WHEN p_from IS NULL THEN '-infinity'::timestamptz ELSE (p_from::timestamp AT TIME ZONE 'Asia/Kolkata') END;
  v_t timestamptz := CASE WHEN p_to IS NULL THEN 'infinity'::timestamptz ELSE ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') END;
  v_lim int := least(greatest(COALESCE(p_limit, 200), 1), 2000);
BEGIN
  RETURN jsonb_build_object(
    'sessions', (SELECT COALESCE(jsonb_agg(s ORDER BY s.login_at DESC), '[]'::jsonb) FROM (
        SELECT w.id, w.login_at, w.logout_at, w.last_activity_at, w.logout_reason, host(w.ip) ip, w.user_agent, p.full_name user_name, p.staff_id::text staff_id,
               round(EXTRACT(epoch FROM (COALESCE(w.logout_at, w.last_activity_at) - w.login_at)) / 60.0)::int minutes,
               w.logout_at IS NULL AND w.last_activity_at > now() - interval '30 minutes' AS active
        FROM public.work_sessions w LEFT JOIN public.profiles p ON p.id = w.user_id
        WHERE w.branch_id = v_branch AND w.login_at >= v_f AND w.login_at < v_t
        ORDER BY w.login_at DESC LIMIT v_lim) s),
    'attempts', CASE WHEN app.has_perm('security.view') THEN (SELECT COALESCE(jsonb_agg(a ORDER BY a.at DESC), '[]'::jsonb) FROM (
        SELECT la.id, la.at, la.staff_id, la.portal, la.success, la.reason, host(la.ip) ip,
               EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.staff_id::text) = lower(la.staff_id) AND p.branch_id = v_branch) AS known
        FROM public.login_attempts la WHERE la.at >= v_f AND la.at < v_t ORDER BY la.at DESC LIMIT v_lim) a) END);
END;
$$;

-- Record an export (CSV / print) in the audit trail itself.
DROP FUNCTION IF EXISTS public.audit_log_export(text, int, jsonb);
CREATE FUNCTION public.audit_log_export(p_format text, p_rows int, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE v_branch uuid := public._audit_guard();
BEGIN
  IF p_format NOT IN ('csv','print','login_csv','user_csv') THEN RAISE EXCEPTION 'Invalid export format'; END IF;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, after_data)
  VALUES (v_branch, auth.uid(), 'audit_log_exported', 'report', p_format,
          jsonb_build_object('name', CASE p_format WHEN 'csv' THEN 'Audit log (CSV)' WHEN 'print' THEN 'Audit log (print / PDF)'
                                   WHEN 'login_csv' THEN 'Login history (CSV)' ELSE 'User activity report (CSV)' END,
                             'rows', p_rows, 'filters', COALESCE(p_filters, '{}'::jsonb)));
END;
$$;

-- Page settings (stored in pharmacy_settings, key 'audit').
DROP FUNCTION IF EXISTS public.audit_settings_get();
CREATE FUNCTION public.audit_settings_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE v_branch uuid := public._audit_guard();
BEGIN
  RETURN jsonb_build_object('default_range', '7d', 'page_size', 10, 'alert_critical', true, 'alert_failed_logins', true)
    || COALESCE((SELECT value FROM public.pharmacy_settings WHERE branch_id = v_branch AND key = 'audit'), '{}'::jsonb);
END;
$$;

DROP FUNCTION IF EXISTS public.audit_settings_save(jsonb);
CREATE FUNCTION public.audit_settings_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE v_branch uuid := public._audit_guard(); v jsonb; v_before jsonb;
BEGIN
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised'; END IF;
  v := jsonb_build_object(
    'default_range', COALESCE(p->>'default_range', '7d'),
    'page_size', COALESCE((p->>'page_size')::int, 10),
    'alert_critical', COALESCE((p->>'alert_critical')::boolean, true),
    'alert_failed_logins', COALESCE((p->>'alert_failed_logins')::boolean, true));
  IF v->>'default_range' NOT IN ('today','yesterday','7d','30d','90d','month','all') THEN RAISE EXCEPTION 'Invalid default period'; END IF;
  IF (v->>'page_size')::int NOT IN (10, 25, 50, 100) THEN RAISE EXCEPTION 'Rows per page must be 10, 25, 50 or 100'; END IF;
  SELECT value INTO v_before FROM public.pharmacy_settings WHERE branch_id = v_branch AND key = 'audit';
  INSERT INTO public.pharmacy_settings(branch_id, key, value, updated_by, updated_at) VALUES (v_branch, 'audit', v, auth.uid(), now())
  ON CONFLICT (branch_id, key) DO UPDATE SET value = excluded.value, updated_by = auth.uid(), updated_at = now();
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'audit_settings_saved', 'settings', 'audit', v_before, v);
  RETURN v;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['audit_overview(date, date)', 'audit_list(date, date, text, uuid, text, text, boolean, int, int)', 'audit_user_report(date, date)',
    'audit_login_history(date, date, int)', 'audit_log_export(text, int, jsonb)', 'audit_settings_get()', 'audit_settings_save(jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
