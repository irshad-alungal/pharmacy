-- =============================================================================
-- 0031  Staff Management (staff.html)
-- Run once in the Supabase SQL editor after 0030. Safe to run twice.
-- Also deploy the updated Edge Function: supabase functions deploy admin-staff
--
--   staff_details       — designation (job title), join date, address, photo, email, DOB,
--                         gender, emergency contact, qualification / licence no., shift,
--                         monthly salary, notes (one row per staff login)
--   staff_attendance    — manual marks (present / absent / half day / leave / holiday / week off,
--                         in / out time). A day with a login (work_sessions) counts as Present
--                         automatically; a manual mark always wins.
--   staff_leaves        — casual / sick / earned / unpaid / other, pending → approved / rejected
--   Functions           — staff_list, staff_overview, staff_update, staff_set_role, staff_set_active,
--                         staff_attendance_day / _save / _trend / _register, staff_leave_save /
--                         _decide / staff_leaves_list, staff_roles_permissions, staff_activities,
--                         staff_performance, staff_login_history
--   Storage             — private bucket staff-photos (branch folder, admins only)
-- Admin and Super Admin only. An Admin cannot see or change Admin / Super Admin accounts
-- (same rule as the admin-staff Edge Function); nobody can change their own role or status.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.staff_details (
  profile_id uuid PRIMARY KEY,
  branch_id uuid NOT NULL,
  designation text,
  join_date date,
  address text,
  photo_path text,
  email text,
  dob date,
  gender text,
  emergency_name text,
  emergency_phone text,
  qualification text,
  licence_no text,
  shift text,
  salary numeric,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  att_date date NOT NULL,
  status text NOT NULL,
  check_in time,
  check_out time,
  note text,
  marked_by uuid,
  marked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, att_date),
  CONSTRAINT staff_attendance_status_chk CHECK (status IN ('present','absent','half_day','leave','holiday','week_off'))
);
CREATE INDEX IF NOT EXISTS staff_attendance_branch_date ON public.staff_attendance (branch_id, att_date);

CREATE TABLE IF NOT EXISTS public.staff_leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  leave_type text NOT NULL DEFAULT 'casual',
  from_date date NOT NULL,
  to_date date NOT NULL,
  half_day boolean NOT NULL DEFAULT false,
  days numeric NOT NULL DEFAULT 1,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  CONSTRAINT staff_leaves_type_chk CHECK (leave_type IN ('casual','sick','earned','unpaid','other')),
  CONSTRAINT staff_leaves_status_chk CHECK (status IN ('pending','approved','rejected','cancelled')),
  CONSTRAINT staff_leaves_dates_chk CHECK (to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS staff_leaves_branch ON public.staff_leaves (branch_id, from_date);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_details','staff_attendance','staff_leaves'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- Staff photos: private, branch folder, admins only (shown through short-lived signed links).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('staff-photos', 'staff-photos', false, 5242880, ARRAY['image/png','image/jpeg','image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
DROP POLICY IF EXISTS staff_photos_admin_read ON storage.objects;
CREATE POLICY staff_photos_admin_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'staff-photos' AND COALESCE(public.my_role(), '') IN ('super_admin','admin') AND (storage.foldername(name))[1] = public.my_branch_id()::text);
DROP POLICY IF EXISTS staff_photos_admin_insert ON storage.objects;
CREATE POLICY staff_photos_admin_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'staff-photos' AND COALESCE(public.my_role(), '') IN ('super_admin','admin') AND (storage.foldername(name))[1] = public.my_branch_id()::text);
DROP POLICY IF EXISTS staff_photos_admin_delete ON storage.objects;
CREATE POLICY staff_photos_admin_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'staff-photos' AND COALESCE(public.my_role(), '') IN ('super_admin','admin') AND (storage.foldername(name))[1] = public.my_branch_id()::text);

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION public._staff_guard()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised: staff management is for Admin and Super Admin'; END IF;
  RETURN v_branch;
END;
$$;
REVOKE ALL ON FUNCTION public._staff_guard() FROM PUBLIC, anon, authenticated;

-- Staff the caller may see: everyone in the branch for Super Admin; Admin does not see Admin / Super Admin.
CREATE OR REPLACE FUNCTION public._staff_visible(p_branch uuid)
RETURNS TABLE (id uuid, role text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, r.code FROM public.profiles p JOIN public.roles r ON r.id = p.role_id
  WHERE p.branch_id = p_branch
    AND (COALESCE(public.my_role(), '') = 'super_admin' OR r.code NOT IN ('super_admin','admin'))
$$;
REVOKE ALL ON FUNCTION public._staff_visible(uuid) FROM PUBLIC, anon, authenticated;

-- Can the caller change this person? (visible, not themselves, never another Super Admin)
CREATE OR REPLACE FUNCTION public._staff_target(p_branch uuid, p_profile uuid, p_allow_self boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_role text;
BEGIN
  SELECT v.role INTO v_role FROM public._staff_visible(p_branch) v WHERE v.id = p_profile;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  IF NOT p_allow_self AND p_profile = auth.uid() THEN RAISE EXCEPTION 'You cannot change your own role or status'; END IF;
  IF v_role = 'super_admin' AND p_profile <> auth.uid() THEN RAISE EXCEPTION 'Super Admin accounts cannot be changed here'; END IF;
  RETURN v_role;
END;
$$;
REVOKE ALL ON FUNCTION public._staff_target(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._staff_role_name(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE p_code WHEN 'super_admin' THEN 'Super Admin' WHEN 'admin' THEN 'Admin' WHEN 'pharmacist' THEN 'Pharmacist'
  WHEN 'billing_staff' THEN 'Billing Staff' WHEN 'billing' THEN 'Billing Staff' WHEN 'inventory_staff' THEN 'Inventory Staff' WHEN 'inventory' THEN 'Inventory Staff'
  WHEN 'delivery_person' THEN 'Delivery Staff' ELSE initcap(replace(COALESCE(p_code, ''), '_', ' ')) END $$;

-- Effective attendance per staff and day: manual mark > approved leave > login (work session).
CREATE OR REPLACE FUNCTION public._staff_att(p_branch uuid, p_from date, p_to date)
RETURNS TABLE (profile_id uuid, d date, status text, source text, check_in time, check_out time, hours numeric, note text, leave_type text, joined boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH staff AS (
    SELECT p.id, COALESCE(sd.join_date, (p.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS jd
    FROM public._staff_visible(p_branch) v JOIN public.profiles p ON p.id = v.id LEFT JOIN public.staff_details sd ON sd.profile_id = p.id),
  days AS (SELECT generate_series(p_from, p_to, interval '1 day')::date AS d),
  ws AS (
    SELECT w.user_id, w.work_date AS d, min(w.login_at) AS first_in, max(COALESCE(w.logout_at, w.last_activity_at)) AS last_out,
           sum(EXTRACT(epoch FROM (COALESCE(w.logout_at, w.last_activity_at) - w.login_at))) / 3600.0 AS h
    FROM public.work_sessions w WHERE w.branch_id = p_branch AND w.work_date BETWEEN p_from AND p_to GROUP BY 1, 2)
  SELECT s.id, x.d,
    CASE WHEN a.status IS NOT NULL THEN a.status WHEN l.id IS NOT NULL THEN 'leave' WHEN ws.user_id IS NOT NULL THEN 'present' END,
    CASE WHEN a.status IS NOT NULL THEN 'manual' WHEN l.id IS NOT NULL THEN 'leave' WHEN ws.user_id IS NOT NULL THEN 'login' END,
    COALESCE(a.check_in, (ws.first_in AT TIME ZONE 'Asia/Kolkata')::time),
    COALESCE(a.check_out, CASE WHEN ws.user_id IS NOT NULL THEN (ws.last_out AT TIME ZONE 'Asia/Kolkata')::time END),
    round(COALESCE(CASE WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL AND a.check_out > a.check_in
                         THEN EXTRACT(epoch FROM (a.check_out - a.check_in)) / 3600.0 END, ws.h, 0)::numeric, 2),
    a.note, l.leave_type, x.d >= s.jd
  FROM staff s CROSS JOIN days x
  LEFT JOIN public.staff_attendance a ON a.profile_id = s.id AND a.att_date = x.d
  LEFT JOIN LATERAL (SELECT sl.id, sl.leave_type FROM public.staff_leaves sl WHERE sl.profile_id = s.id AND sl.status = 'approved'
                     AND x.d BETWEEN sl.from_date AND sl.to_date LIMIT 1) l ON true
  LEFT JOIN ws ON ws.user_id = s.id AND ws.d = x.d
$$;
REVOKE ALL ON FUNCTION public._staff_att(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- list / overview
DROP FUNCTION IF EXISTS public.staff_list();
CREATE FUNCTION public.staff_list()
RETURNS TABLE (id uuid, staff_id text, full_name text, phone text, role text, role_name text, designation text, is_active boolean,
  must_change_password boolean, created_at timestamptz, join_date date, address text, email text, dob date, gender text,
  emergency_name text, emergency_phone text, qualification text, licence_no text, shift text, salary numeric, notes text, photo_path text,
  today_status text, today_source text, today_in time, today_out time, last_login timestamptz, is_self boolean, can_manage boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard(); v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_super boolean := public.my_role() = 'super_admin';
BEGIN
  RETURN QUERY
  SELECT p.id, p.staff_id::text, p.full_name, p.phone, v.role, public._staff_role_name(v.role),
         COALESCE(nullif(sd.designation, ''), public._staff_role_name(v.role)), p.is_active, p.must_change_password, p.created_at,
         COALESCE(sd.join_date, (p.created_at AT TIME ZONE 'Asia/Kolkata')::date), sd.address, sd.email, sd.dob, sd.gender,
         sd.emergency_name, sd.emergency_phone, sd.qualification, sd.licence_no, sd.shift, sd.salary, sd.notes, sd.photo_path,
         CASE WHEN p.is_active THEN t.status END, t.source, t.check_in, t.check_out,
         (SELECT max(w.login_at) FROM public.work_sessions w WHERE w.user_id = p.id),
         p.id = auth.uid(),
         p.id <> auth.uid() AND v.role <> 'super_admin' AND (v_super OR v.role <> 'admin')
  FROM public._staff_visible(v_branch) v
  JOIN public.profiles p ON p.id = v.id
  LEFT JOIN public.staff_details sd ON sd.profile_id = p.id
  LEFT JOIN public._staff_att(v_branch, v_today, v_today) t ON t.profile_id = p.id
  ORDER BY p.is_active DESC, p.staff_id;
END;
$$;

DROP FUNCTION IF EXISTS public.staff_overview();
CREATE FUNCTION public.staff_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._staff_guard(); v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_ms date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date; r jsonb;
BEGIN
  WITH s AS (
    SELECT p.id, p.is_active, COALESCE(nullif(sd.designation, ''), public._staff_role_name(v.role)) AS des,
           COALESCE(sd.join_date, (p.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS jd
    FROM public._staff_visible(v_branch) v JOIN public.profiles p ON p.id = v.id LEFT JOIN public.staff_details sd ON sd.profile_id = p.id),
  t AS (SELECT a.* FROM public._staff_att(v_branch, v_today, v_today) a JOIN s ON s.id = a.profile_id AND s.is_active)
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM s),
    'total_last_month', (SELECT count(*) FROM s WHERE s.jd < v_ms),
    'active', (SELECT count(*) FROM s WHERE s.is_active),
    'inactive', (SELECT count(*) FROM s WHERE NOT s.is_active),
    'present', (SELECT count(*) FROM t WHERE t.status = 'present'),
    'half_day', (SELECT count(*) FROM t WHERE t.status = 'half_day'),
    'absent', (SELECT count(*) FROM t WHERE t.status = 'absent'),
    'on_leave', (SELECT count(*) FROM t WHERE t.status = 'leave'),
    'off', (SELECT count(*) FROM t WHERE t.status IN ('holiday','week_off')),
    'not_marked', (SELECT count(*) FROM t WHERE t.status IS NULL),
    'pending_leaves', (SELECT count(*) FROM public.staff_leaves l JOIN s ON s.id = l.profile_id WHERE l.status = 'pending'),
    'password_change', (SELECT count(*) FROM s JOIN public.profiles p ON p.id = s.id WHERE s.is_active AND p.must_change_password),
    'distribution', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', des, 'count', n) ORDER BY n DESC, des), '[]'::jsonb)
                     FROM (SELECT s.des, count(*) n FROM s GROUP BY s.des) g),
    'today', v_today
  ) INTO r;
  RETURN r;
END;
$$;

-- ---------------------------------------------------------------- edit
DROP FUNCTION IF EXISTS public.staff_update(uuid, jsonb);
CREATE FUNCTION public.staff_update(p_profile uuid, p jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._staff_guard(); v_before jsonb; v_name text; v_phone text; v_salary numeric; v_photo text;
BEGIN
  PERFORM public._staff_target(v_branch, p_profile, true);
  v_name := nullif(trim(COALESCE(p->>'full_name', '')), '');
  IF p ? 'full_name' AND (v_name IS NULL OR length(v_name) > 120) THEN RAISE EXCEPTION 'Enter a valid staff name (120 characters max)'; END IF;
  v_phone := nullif(trim(COALESCE(p->>'phone', '')), '');
  IF v_phone IS NOT NULL AND (length(v_phone) > 30 OR length(regexp_replace(v_phone, '\D', '', 'g')) < 10) THEN RAISE EXCEPTION 'Enter a valid phone number (10 digits)'; END IF;
  IF nullif(p->>'salary', '') IS NOT NULL THEN
    BEGIN v_salary := (p->>'salary')::numeric; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Salary must be a number'; END;
    IF v_salary < 0 OR v_salary > 10000000 THEN RAISE EXCEPTION 'Salary must be between 0 and 1,00,00,000'; END IF;
  END IF;
  IF nullif(p->>'join_date', '') IS NOT NULL AND (p->>'join_date')::date > (now() AT TIME ZONE 'Asia/Kolkata')::date + 60 THEN RAISE EXCEPTION 'Join date is too far in the future'; END IF;
  IF nullif(p->>'dob', '') IS NOT NULL AND (p->>'dob')::date > (now() AT TIME ZONE 'Asia/Kolkata')::date - interval '14 years' THEN RAISE EXCEPTION 'Check the date of birth'; END IF;
  IF nullif(p->>'email', '') IS NOT NULL AND (p->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid email address'; END IF;
  IF nullif(p->>'gender', '') IS NOT NULL AND p->>'gender' NOT IN ('female','male','other') THEN RAISE EXCEPTION 'Unknown gender'; END IF;
  IF nullif(p->>'shift', '') IS NOT NULL AND p->>'shift' NOT IN ('morning','evening','night','full_day','rotational') THEN RAISE EXCEPTION 'Unknown shift'; END IF;
  IF length(COALESCE(p->>'address', '')) > 500 OR length(COALESCE(p->>'notes', '')) > 1000 OR length(COALESCE(p->>'designation', '')) > 60 THEN RAISE EXCEPTION 'Some details are too long'; END IF;
  v_photo := nullif(p->>'photo_path', '');
  IF v_photo IS NOT NULL AND split_part(v_photo, '/', 1) <> v_branch::text THEN RAISE EXCEPTION 'Photo must be in this branch''s folder'; END IF;

  SELECT to_jsonb(sd) - 'updated_at' - 'updated_by' || jsonb_build_object('full_name', pr.full_name, 'phone', pr.phone) INTO v_before
  FROM public.profiles pr LEFT JOIN public.staff_details sd ON sd.profile_id = pr.id WHERE pr.id = p_profile;

  UPDATE public.profiles SET full_name = COALESCE(CASE WHEN p ? 'full_name' THEN v_name END, full_name),
    phone = CASE WHEN p ? 'phone' THEN v_phone ELSE phone END, updated_at = now()
  WHERE id = p_profile;

  INSERT INTO public.staff_details (profile_id, branch_id) VALUES (p_profile, v_branch) ON CONFLICT (profile_id) DO NOTHING;
  UPDATE public.staff_details SET
    designation = CASE WHEN p ? 'designation' THEN nullif(trim(p->>'designation'), '') ELSE designation END,
    join_date = CASE WHEN p ? 'join_date' THEN nullif(p->>'join_date', '')::date ELSE join_date END,
    address = CASE WHEN p ? 'address' THEN nullif(trim(p->>'address'), '') ELSE address END,
    photo_path = CASE WHEN p ? 'photo_path' THEN v_photo ELSE photo_path END,
    email = CASE WHEN p ? 'email' THEN nullif(trim(p->>'email'), '') ELSE email END,
    dob = CASE WHEN p ? 'dob' THEN nullif(p->>'dob', '')::date ELSE dob END,
    gender = CASE WHEN p ? 'gender' THEN nullif(p->>'gender', '') ELSE gender END,
    emergency_name = CASE WHEN p ? 'emergency_name' THEN nullif(trim(p->>'emergency_name'), '') ELSE emergency_name END,
    emergency_phone = CASE WHEN p ? 'emergency_phone' THEN nullif(trim(p->>'emergency_phone'), '') ELSE emergency_phone END,
    qualification = CASE WHEN p ? 'qualification' THEN nullif(trim(p->>'qualification'), '') ELSE qualification END,
    licence_no = CASE WHEN p ? 'licence_no' THEN nullif(trim(p->>'licence_no'), '') ELSE licence_no END,
    shift = CASE WHEN p ? 'shift' THEN nullif(p->>'shift', '') ELSE shift END,
    salary = CASE WHEN p ? 'salary' THEN v_salary ELSE salary END,
    notes = CASE WHEN p ? 'notes' THEN nullif(trim(p->>'notes'), '') ELSE notes END,
    updated_by = auth.uid(), updated_at = now()
  WHERE profile_id = p_profile;

  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'staff_updated', 'staff', p_profile::text, NULL, v_before - 'salary', (p - 'salary') || CASE WHEN p ? 'salary' THEN '{"salary":"changed"}'::jsonb ELSE '{}'::jsonb END);
END;
$$;

DROP FUNCTION IF EXISTS public.staff_set_role(uuid, text);
CREATE FUNCTION public.staff_set_role(p_profile uuid, p_role text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard(); v_old text; v_rid uuid;
BEGIN
  v_old := public._staff_target(v_branch, p_profile);
  IF p_role NOT IN ('pharmacist','billing_staff','inventory_staff','delivery_person','admin') THEN RAISE EXCEPTION 'Choose a valid role'; END IF;
  IF (p_role = 'admin' OR v_old = 'admin') AND public.my_role() <> 'super_admin' THEN RAISE EXCEPTION 'Only Super Admin can give or remove the Admin role'; END IF;
  SELECT id INTO v_rid FROM public.roles WHERE code = p_role;
  IF v_rid IS NULL THEN RAISE EXCEPTION 'Role % is not set up in this database', p_role; END IF;
  IF v_old = p_role THEN RETURN; END IF;
  UPDATE public.profiles SET role_id = v_rid, updated_at = now() WHERE id = p_profile;
  -- sign the person out so the new role applies at their next login
  UPDATE public.work_sessions SET logout_at = now(), logout_reason = 'admin' WHERE user_id = p_profile AND logout_at IS NULL;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'staff_role_changed', 'staff', p_profile::text, NULL, jsonb_build_object('role', v_old), jsonb_build_object('role', p_role));
END;
$$;

DROP FUNCTION IF EXISTS public.staff_set_active(uuid, boolean, text);
CREATE FUNCTION public.staff_set_active(p_profile uuid, p_active boolean, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard(); v_role text;
BEGIN
  v_role := public._staff_target(v_branch, p_profile);
  IF v_role = 'admin' AND public.my_role() <> 'super_admin' THEN RAISE EXCEPTION 'Only Super Admin can change an Admin account'; END IF;
  IF NOT p_active AND nullif(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Give a reason for deactivating this login'; END IF;
  UPDATE public.profiles SET is_active = p_active, updated_at = now() WHERE id = p_profile;
  IF NOT p_active THEN
    UPDATE public.work_sessions SET logout_at = now(), logout_reason = 'deactivated' WHERE user_id = p_profile AND logout_at IS NULL;
  END IF;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), CASE WHEN p_active THEN 'staff_activated' ELSE 'staff_deactivated' END, 'staff', p_profile::text,
          nullif(trim(COALESCE(p_reason, '')), ''), NULL, jsonb_build_object('is_active', p_active));
END;
$$;

-- ---------------------------------------------------------------- attendance
DROP FUNCTION IF EXISTS public.staff_attendance_day(date);
CREATE FUNCTION public.staff_attendance_day(p_date date)
RETURNS TABLE (profile_id uuid, staff_id text, full_name text, designation text, status text, source text, check_in time, check_out time,
  hours numeric, note text, leave_type text, login_in time, login_out time, joined boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard();
BEGIN
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE 'Asia/Kolkata')::date + 31 THEN RAISE EXCEPTION 'Choose a date up to one month ahead'; END IF;
  RETURN QUERY
  SELECT a.profile_id, p.staff_id::text, p.full_name, COALESCE(nullif(sd.designation, ''), public._staff_role_name(v.role)), a.status, a.source,
         a.check_in, a.check_out, a.hours, a.note, a.leave_type,
         (SELECT (min(w.login_at) AT TIME ZONE 'Asia/Kolkata')::time FROM public.work_sessions w WHERE w.user_id = a.profile_id AND w.work_date = p_date),
         (SELECT (max(COALESCE(w.logout_at, w.last_activity_at)) AT TIME ZONE 'Asia/Kolkata')::time FROM public.work_sessions w WHERE w.user_id = a.profile_id AND w.work_date = p_date),
         a.joined
  FROM public._staff_att(v_branch, p_date, p_date) a
  JOIN public.profiles p ON p.id = a.profile_id
  JOIN public._staff_visible(v_branch) v ON v.id = p.id
  LEFT JOIN public.staff_details sd ON sd.profile_id = p.id
  WHERE p.is_active OR a.status IS NOT NULL
  ORDER BY p.staff_id;
END;
$$;

-- p_rows: [{profile_id, status ('' clears the manual mark), check_in 'HH:MM', check_out, note}]
DROP FUNCTION IF EXISTS public.staff_attendance_save(date, jsonb);
CREATE FUNCTION public.staff_attendance_save(p_date date, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard(); x jsonb; v_st text; v_in time; v_out time; v_n integer := 0; v_cleared integer := 0; v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; s jsonb;
BEGIN
  IF p_date IS NULL OR p_date > v_today + 31 THEN RAISE EXCEPTION 'Choose a date up to one month ahead'; END IF;
  IF p_date < v_today - 400 THEN RAISE EXCEPTION 'Attendance older than 400 days cannot be changed'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'Nothing to save'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF NOT EXISTS (SELECT 1 FROM public._staff_visible(v_branch) v WHERE v.id = (x->>'profile_id')::uuid) THEN RAISE EXCEPTION 'Staff member not found'; END IF;
    v_st := nullif(x->>'status', '');
    IF v_st IS NULL THEN
      DELETE FROM public.staff_attendance WHERE profile_id = (x->>'profile_id')::uuid AND att_date = p_date;
      v_cleared := v_cleared + 1; CONTINUE;
    END IF;
    IF v_st NOT IN ('present','absent','half_day','leave','holiday','week_off') THEN RAISE EXCEPTION 'Unknown attendance status %', v_st; END IF;
    IF p_date > v_today AND v_st NOT IN ('leave','holiday','week_off') THEN RAISE EXCEPTION 'Only leave, holiday or week off can be marked for a future date'; END IF;
    v_in := nullif(x->>'check_in', '')::time; v_out := nullif(x->>'check_out', '')::time;
    IF v_in IS NOT NULL AND v_out IS NOT NULL AND v_out <= v_in THEN RAISE EXCEPTION 'Out time must be after in time'; END IF;
    IF length(COALESCE(x->>'note', '')) > 200 THEN RAISE EXCEPTION 'Note is too long'; END IF;
    INSERT INTO public.staff_attendance (branch_id, profile_id, att_date, status, check_in, check_out, note, marked_by, marked_at)
    VALUES (v_branch, (x->>'profile_id')::uuid, p_date, v_st, CASE WHEN v_st IN ('present','half_day') THEN v_in END,
            CASE WHEN v_st IN ('present','half_day') THEN v_out END, nullif(trim(COALESCE(x->>'note', '')), ''), auth.uid(), now())
    ON CONFLICT (profile_id, att_date) DO UPDATE SET status = excluded.status, check_in = excluded.check_in, check_out = excluded.check_out,
      note = excluded.note, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
    v_n := v_n + 1;
  END LOOP;
  SELECT jsonb_build_object('date', p_date,
    'present', count(*) FILTER (WHERE a.status = 'present'), 'half_day', count(*) FILTER (WHERE a.status = 'half_day'),
    'absent', count(*) FILTER (WHERE a.status = 'absent'), 'leave', count(*) FILTER (WHERE a.status = 'leave'),
    'off', count(*) FILTER (WHERE a.status IN ('holiday','week_off')), 'saved', v_n, 'cleared', v_cleared)
  INTO s FROM public._staff_att(v_branch, p_date, p_date) a JOIN public.profiles p ON p.id = a.profile_id WHERE p.is_active;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'staff_attendance_marked', 'staff', p_date::text, NULL, NULL, s);
  RETURN s;
END;
$$;

DROP FUNCTION IF EXISTS public.staff_attendance_trend(date, date);
CREATE FUNCTION public.staff_attendance_trend(p_from date, p_to date)
RETURNS TABLE (day date, staff integer, present integer, half_day integer, absent integer, on_leave integer, off integer, not_marked integer, pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'Choose a date range of up to 400 days'; END IF;
  RETURN QUERY
  SELECT a.d, count(*)::int,
         count(*) FILTER (WHERE a.status = 'present')::int, count(*) FILTER (WHERE a.status = 'half_day')::int,
         count(*) FILTER (WHERE a.status = 'absent')::int, count(*) FILTER (WHERE a.status = 'leave')::int,
         count(*) FILTER (WHERE a.status IN ('holiday','week_off'))::int, count(*) FILTER (WHERE a.status IS NULL)::int,
         CASE WHEN count(*) FILTER (WHERE a.status IS DISTINCT FROM 'holiday' AND a.status IS DISTINCT FROM 'week_off') = 0 THEN NULL
              ELSE round((count(*) FILTER (WHERE a.status = 'present') + 0.5 * count(*) FILTER (WHERE a.status = 'half_day')) * 100.0
                   / count(*) FILTER (WHERE a.status IS DISTINCT FROM 'holiday' AND a.status IS DISTINCT FROM 'week_off'), 1) END
  FROM public._staff_att(v_branch, p_from, p_to) a JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.joined AND (p.is_active OR a.status IS NOT NULL)
  GROUP BY a.d ORDER BY a.d;
END;
$$;

DROP FUNCTION IF EXISTS public.staff_attendance_register(date, date);
CREATE FUNCTION public.staff_attendance_register(p_from date, p_to date)
RETURNS TABLE (profile_id uuid, staff_id text, full_name text, designation text, days jsonb, present numeric, absent integer, on_leave integer,
  half_days integer, off integer, not_marked integer, hours numeric, pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard(); v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 62 THEN RAISE EXCEPTION 'Choose up to two months'; END IF;
  RETURN QUERY
  SELECT a.profile_id, p.staff_id::text, p.full_name, COALESCE(nullif(sd.designation, ''), public._staff_role_name(v.role)),
         jsonb_object_agg(a.d::text, CASE WHEN NOT a.joined THEN '-' ELSE COALESCE(a.status, CASE WHEN a.d > v_today THEN '' ELSE 'not_marked' END) END),
         (count(*) FILTER (WHERE a.status = 'present' AND a.joined) + 0.5 * count(*) FILTER (WHERE a.status = 'half_day' AND a.joined))::numeric,
         count(*) FILTER (WHERE a.status = 'absent' AND a.joined)::int, count(*) FILTER (WHERE a.status = 'leave' AND a.joined)::int,
         count(*) FILTER (WHERE a.status = 'half_day' AND a.joined)::int, count(*) FILTER (WHERE a.status IN ('holiday','week_off') AND a.joined)::int,
         count(*) FILTER (WHERE a.status IS NULL AND a.joined AND a.d <= v_today)::int,
         round(sum(a.hours) FILTER (WHERE a.joined), 1),
         CASE WHEN count(*) FILTER (WHERE a.joined AND a.d <= v_today AND a.status IS DISTINCT FROM 'holiday' AND a.status IS DISTINCT FROM 'week_off') = 0 THEN NULL
              ELSE round((count(*) FILTER (WHERE a.status = 'present' AND a.joined) + 0.5 * count(*) FILTER (WHERE a.status = 'half_day' AND a.joined)) * 100.0
                   / count(*) FILTER (WHERE a.joined AND a.d <= v_today AND a.status IS DISTINCT FROM 'holiday' AND a.status IS DISTINCT FROM 'week_off'), 1) END
  FROM public._staff_att(v_branch, p_from, p_to) a
  JOIN public.profiles p ON p.id = a.profile_id
  JOIN public._staff_visible(v_branch) v ON v.id = p.id
  LEFT JOIN public.staff_details sd ON sd.profile_id = p.id
  WHERE p.is_active OR a.status IS NOT NULL
  GROUP BY a.profile_id, p.staff_id, p.full_name, sd.designation, v.role
  ORDER BY p.staff_id;
END;
$$;

-- ---------------------------------------------------------------- leaves
DROP FUNCTION IF EXISTS public.staff_leave_save(uuid, uuid, text, date, date, boolean, text, text);
CREATE FUNCTION public.staff_leave_save(p_id uuid, p_profile uuid, p_type text, p_from date, p_to date, p_half boolean, p_reason text, p_status text DEFAULT 'approved')
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard(); v_id uuid; v_days numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public._staff_visible(v_branch) v WHERE v.id = p_profile) THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  IF p_type NOT IN ('casual','sick','earned','unpaid','other') THEN RAISE EXCEPTION 'Choose a leave type'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose valid leave dates'; END IF;
  IF p_to - p_from > 90 THEN RAISE EXCEPTION 'A leave can be 91 days at most'; END IF;
  IF COALESCE(p_half, false) AND p_to <> p_from THEN RAISE EXCEPTION 'A half-day leave must be a single day'; END IF;
  IF p_status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'New leave must be pending or approved'; END IF;
  IF length(COALESCE(p_reason, '')) > 300 THEN RAISE EXCEPTION 'Reason is too long (300 characters max)'; END IF;
  IF EXISTS (SELECT 1 FROM public.staff_leaves l WHERE l.profile_id = p_profile AND l.status IN ('pending','approved') AND l.id IS DISTINCT FROM p_id
             AND daterange(l.from_date, l.to_date, '[]') && daterange(p_from, p_to, '[]')) THEN
    RAISE EXCEPTION 'This staff member already has a leave on these dates';
  END IF;
  v_days := CASE WHEN COALESCE(p_half, false) THEN 0.5 ELSE p_to - p_from + 1 END;
  IF p_id IS NULL THEN
    INSERT INTO public.staff_leaves (branch_id, profile_id, leave_type, from_date, to_date, half_day, days, reason, status, requested_by, decided_by, decided_at)
    VALUES (v_branch, p_profile, p_type, p_from, p_to, COALESCE(p_half, false), v_days, nullif(trim(COALESCE(p_reason, '')), ''), p_status, auth.uid(),
            CASE WHEN p_status = 'approved' THEN auth.uid() END, CASE WHEN p_status = 'approved' THEN now() END)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.staff_leaves SET profile_id = p_profile, leave_type = p_type, from_date = p_from, to_date = p_to, half_day = COALESCE(p_half, false), days = v_days,
      reason = nullif(trim(COALESCE(p_reason, '')), '')
    WHERE id = p_id AND branch_id = v_branch AND status IN ('pending','approved') RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Leave not found or already closed'; END IF;
  END IF;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), CASE WHEN p_id IS NULL THEN 'staff_leave_added' ELSE 'staff_leave_changed' END, 'staff', p_profile::text,
          nullif(trim(COALESCE(p_reason, '')), ''), NULL, jsonb_build_object('leave_id', v_id, 'type', p_type, 'from', p_from, 'to', p_to, 'days', v_days, 'status', p_status));
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.staff_leave_decide(uuid, text, text);
CREATE FUNCTION public.staff_leave_decide(p_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard(); l record;
BEGIN
  SELECT * INTO l FROM public.staff_leaves WHERE id = p_id AND branch_id = v_branch FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public._staff_visible(v_branch) v WHERE v.id = l.profile_id) THEN RAISE EXCEPTION 'Leave not found'; END IF;
  IF p_status NOT IN ('approved','rejected','cancelled') THEN RAISE EXCEPTION 'Unknown decision'; END IF;
  IF l.status IN ('rejected','cancelled') THEN RAISE EXCEPTION 'This leave is already %', l.status; END IF;
  IF l.status = 'approved' AND p_status <> 'cancelled' THEN RAISE EXCEPTION 'An approved leave can only be cancelled'; END IF;
  IF p_status = 'rejected' AND nullif(trim(COALESCE(p_note, '')), '') IS NULL THEN RAISE EXCEPTION 'Give a reason for rejecting'; END IF;
  UPDATE public.staff_leaves SET status = p_status, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(COALESCE(p_note, '')), '') WHERE id = p_id;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'staff_leave_' || p_status, 'staff', l.profile_id::text, nullif(trim(COALESCE(p_note, '')), ''),
          jsonb_build_object('status', l.status), jsonb_build_object('leave_id', p_id, 'type', l.leave_type, 'from', l.from_date, 'to', l.to_date, 'days', l.days, 'status', p_status));
END;
$$;

DROP FUNCTION IF EXISTS public.staff_leaves_list(text, date, date);
CREATE FUNCTION public.staff_leaves_list(p_status text DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (id uuid, profile_id uuid, staff_id text, full_name text, designation text, leave_type text, from_date date, to_date date, half_day boolean,
  days numeric, reason text, status text, requested_at timestamptz, requested_by_name text, decided_at timestamptz, decided_by_name text, decision_note text, taken_this_year numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard();
BEGIN
  RETURN QUERY
  SELECT l.id, l.profile_id, p.staff_id::text, p.full_name, COALESCE(nullif(sd.designation, ''), public._staff_role_name(v.role)), l.leave_type, l.from_date, l.to_date,
         l.half_day, l.days, l.reason, l.status, l.requested_at, rq.full_name::text, l.decided_at, dc.full_name::text, l.decision_note,
         (SELECT COALESCE(sum(x.days), 0) FROM public.staff_leaves x WHERE x.profile_id = l.profile_id AND x.status = 'approved'
            AND date_part('year', x.from_date) = date_part('year', (now() AT TIME ZONE 'Asia/Kolkata')))
  FROM public.staff_leaves l
  JOIN public._staff_visible(v_branch) v ON v.id = l.profile_id
  JOIN public.profiles p ON p.id = l.profile_id
  LEFT JOIN public.staff_details sd ON sd.profile_id = p.id
  LEFT JOIN public.profiles rq ON rq.id = l.requested_by LEFT JOIN public.profiles dc ON dc.id = l.decided_by
  WHERE l.branch_id = v_branch AND (nullif(p_status, '') IS NULL OR l.status = p_status)
    AND (p_from IS NULL OR l.to_date >= p_from) AND (p_to IS NULL OR l.from_date <= p_to)
  ORDER BY (l.status = 'pending') DESC, l.from_date DESC
  LIMIT 500;
END;
$$;

-- ---------------------------------------------------------------- roles, activity, performance
DROP FUNCTION IF EXISTS public.staff_roles_permissions();
CREATE FUNCTION public.staff_roles_permissions()
RETURNS TABLE (code text, name text, assignable boolean, staff integer, permissions text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard(); v_super boolean := public.my_role() = 'super_admin';
BEGIN
  RETURN QUERY
  SELECT r.code, public._staff_role_name(r.code), r.code IN ('pharmacist','billing_staff','inventory_staff','delivery_person') OR (v_super AND r.code = 'admin'),
         (SELECT count(*)::int FROM public.profiles p WHERE p.role_id = r.id AND p.branch_id = v_branch AND p.is_active),
         COALESCE((SELECT array_agg(rp.permission_code ORDER BY rp.permission_code) FROM public.role_permissions rp WHERE rp.role_id = r.id), ARRAY[]::text[])
  FROM public.roles r
  WHERE r.code IN ('super_admin','admin','pharmacist','billing_staff','inventory_staff','delivery_person')
  ORDER BY array_position(ARRAY['super_admin','admin','pharmacist','billing_staff','inventory_staff','delivery_person'], r.code::text);
END;
$$;

DROP FUNCTION IF EXISTS public.staff_activities(integer);
CREATE FUNCTION public.staff_activities(p_limit integer DEFAULT 20)
RETURNS TABLE (at timestamptz, kind text, title text, detail text, staff_name text, actor text, profile_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard();
BEGIN
  RETURN QUERY
  SELECT * FROM (
    SELECT p.created_at, 'added'::text, 'New staff added'::text,
           (p.full_name || ' (' || COALESCE(nullif(sd.designation, ''), public._staff_role_name(v.role)) || ')')::text, p.full_name::text, cb.full_name::text, p.id
    FROM public._staff_visible(v_branch) v JOIN public.profiles p ON p.id = v.id LEFT JOIN public.staff_details sd ON sd.profile_id = p.id
    LEFT JOIN public.profiles cb ON cb.id = p.created_by
    UNION ALL
    SELECT a.at,
      CASE WHEN a.action = 'staff_attendance_marked' THEN 'attendance' WHEN a.action LIKE 'staff_leave%' THEN 'leave' WHEN a.action = 'staff_role_changed' THEN 'role'
           WHEN a.action IN ('staff_deactivated','staff_activated') THEN 'status' WHEN a.action = 'staff_password_reset' THEN 'password' ELSE 'updated' END,
      CASE a.action WHEN 'staff_attendance_marked' THEN 'Attendance marked' WHEN 'staff_leave_added' THEN CASE WHEN a.after_data->>'status' = 'pending' THEN 'Leave request' ELSE 'Leave added' END
           WHEN 'staff_leave_changed' THEN 'Leave changed' WHEN 'staff_leave_approved' THEN 'Leave approved' WHEN 'staff_leave_rejected' THEN 'Leave rejected'
           WHEN 'staff_leave_cancelled' THEN 'Leave cancelled' WHEN 'staff_role_changed' THEN 'Role changed' WHEN 'staff_deactivated' THEN 'Login deactivated'
           WHEN 'staff_activated' THEN 'Login activated' WHEN 'staff_password_reset' THEN 'Password reset' ELSE 'Staff details updated' END,
      (CASE
        WHEN a.action = 'staff_attendance_marked' THEN
          COALESCE(a.after_data->>'present', '0') || ' staff present' ||
          CASE WHEN COALESCE((a.after_data->>'leave')::int, 0) > 0 THEN ', ' || (a.after_data->>'leave') || ' on leave' ELSE '' END ||
          CASE WHEN COALESCE((a.after_data->>'absent')::int, 0) > 0 THEN ', ' || (a.after_data->>'absent') || ' absent' ELSE '' END ||
          ' · ' || to_char((a.after_data->>'date')::date, 'DD Mon')
        WHEN a.action LIKE 'staff_leave%' THEN COALESCE(p.full_name, '') || ' (' ||
          CASE WHEN (a.after_data->>'days')::numeric = 0.5 THEN 'half day' WHEN (a.after_data->>'days')::numeric = 1 THEN '1 day' ELSE (a.after_data->>'days') || ' days' END
          || ' - ' || to_char((a.after_data->>'from')::date, 'DD Mon') || ')'
        WHEN a.action = 'staff_role_changed' THEN COALESCE(p.full_name, '') || ': ' || public._staff_role_name(a.before_data->>'role') || ' → ' || public._staff_role_name(a.after_data->>'role')
        ELSE COALESCE(p.full_name, '') || COALESCE(' (' || COALESCE(nullif(sd.designation, ''), public._staff_role_name(v.role)) || ')', '')
      END)::text,
      p.full_name::text, ac.full_name::text, p.id
    FROM public.audit_logs a
    LEFT JOIN public.profiles p ON a.action <> 'staff_attendance_marked' AND p.id::text = a.entity_id
    LEFT JOIN public._staff_visible(v_branch) v ON v.id = p.id
    LEFT JOIN public.staff_details sd ON sd.profile_id = p.id
    LEFT JOIN public.profiles ac ON ac.id = a.user_id
    WHERE a.branch_id = v_branch AND a.entity_type = 'staff' AND a.action <> 'staff_created' AND (a.action = 'staff_attendance_marked' OR v.id IS NOT NULL)
  ) x
  ORDER BY 1 DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 300);
END;
$$;

DROP FUNCTION IF EXISTS public.staff_performance(date, date);
CREATE FUNCTION public.staff_performance(p_from date, p_to date)
RETURNS TABLE (profile_id uuid, staff_id text, full_name text, designation text, role text, is_active boolean, bills integer, sales numeric, avg_bill numeric,
  returns integer, returns_value numeric, purchases integer, deliveries integer, days_present numeric, working_days integer, attendance_pct numeric, hours numeric, last_login timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard(); v_to date := LEAST(p_to, (now() AT TIME ZONE 'Asia/Kolkata')::date);
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'Choose a date range of up to 400 days'; END IF;
  RETURN QUERY
  WITH att AS (
    SELECT a.profile_id AS pid,
           sum(CASE WHEN a.status = 'present' THEN 1 WHEN a.status = 'half_day' THEN 0.5 ELSE 0 END) FILTER (WHERE a.joined) AS dp,
           count(*) FILTER (WHERE a.joined AND a.status IS DISTINCT FROM 'holiday' AND a.status IS DISTINCT FROM 'week_off')::int AS wd,
           sum(a.hours) FILTER (WHERE a.joined) AS h
    FROM public._staff_att(v_branch, p_from, GREATEST(v_to, p_from)) a GROUP BY 1)
  SELECT p.id, p.staff_id::text, p.full_name, COALESCE(nullif(sd.designation, ''), public._staff_role_name(v.role)), v.role, p.is_active,
         COALESCE(s.n, 0)::int, round(COALESCE(s.t, 0), 2), CASE WHEN COALESCE(s.n, 0) > 0 THEN round(s.t / s.n, 2) ELSE 0 END,
         COALESCE(r.n, 0)::int, round(COALESCE(r.t, 0), 2), COALESCE(pu.n, 0)::int, COALESCE(dj.n, 0)::int,
         COALESCE(att.dp, 0), COALESCE(att.wd, 0), CASE WHEN COALESCE(att.wd, 0) > 0 THEN round(att.dp * 100.0 / att.wd, 1) END,
         round(COALESCE(att.h, 0), 1), (SELECT max(w.login_at) FROM public.work_sessions w WHERE w.user_id = p.id)
  FROM public._staff_visible(v_branch) v
  JOIN public.profiles p ON p.id = v.id
  LEFT JOIN public.staff_details sd ON sd.profile_id = p.id
  LEFT JOIN att ON att.pid = p.id
  LEFT JOIN LATERAL (SELECT count(*) n, sum(i.total) t FROM public.sales_invoices i WHERE i.created_by = p.id AND i.branch_id = v_branch AND i.status = 'final'
                     AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to) s ON true
  LEFT JOIN LATERAL (SELECT count(*) n, sum(x.total) t FROM public.sales_returns x WHERE x.created_by = p.id AND x.branch_id = v_branch
                     AND (x.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to) r ON true
  LEFT JOIN LATERAL (SELECT count(*) n FROM public.purchase_invoices x WHERE x.created_by = p.id AND x.branch_id = v_branch AND x.status = 'confirmed'
                     AND x.invoice_date BETWEEN p_from AND p_to) pu ON true
  LEFT JOIN LATERAL (SELECT count(*) n FROM public.delivery_jobs j WHERE j.assigned_to = p.id AND j.branch_id = v_branch AND j.status = 'done'
                     AND (j.updated_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to) dj ON true
  WHERE p.is_active OR COALESCE(s.n, 0) + COALESCE(att.dp, 0) > 0
  ORDER BY COALESCE(s.t, 0) DESC, p.staff_id;
END;
$$;

DROP FUNCTION IF EXISTS public.staff_login_history(uuid, integer);
CREATE FUNCTION public.staff_login_history(p_profile uuid, p_limit integer DEFAULT 30)
RETURNS TABLE (work_date date, login_at timestamptz, last_activity_at timestamptz, logout_at timestamptz, logout_reason text, hours numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public._staff_visible(v_branch) v WHERE v.id = p_profile) THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  RETURN QUERY
  SELECT w.work_date, w.login_at, w.last_activity_at, w.logout_at, w.logout_reason,
         round((EXTRACT(epoch FROM (COALESCE(w.logout_at, w.last_activity_at) - w.login_at)) / 3600.0)::numeric, 2)
  FROM public.work_sessions w WHERE w.user_id = p_profile ORDER BY w.login_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 200);
END;
$$;

-- Called by the admin-staff Edge Function after a password reset (service role), and by the UI as a fallback log.
DROP FUNCTION IF EXISTS public.staff_log_event(uuid, text, text);
CREATE FUNCTION public.staff_log_event(p_profile uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._staff_guard();
BEGIN
  IF p_action NOT IN ('staff_password_reset','staff_created') THEN RAISE EXCEPTION 'Unknown event'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public._staff_visible(v_branch) v WHERE v.id = p_profile) THEN RAISE EXCEPTION 'Staff member not found'; END IF;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), p_action, 'staff', p_profile::text, nullif(trim(COALESCE(p_reason, '')), ''), NULL, NULL);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['staff_list()', 'staff_overview()', 'staff_update(uuid,jsonb)', 'staff_set_role(uuid,text)', 'staff_set_active(uuid,boolean,text)',
    'staff_attendance_day(date)', 'staff_attendance_save(date,jsonb)', 'staff_attendance_trend(date,date)', 'staff_attendance_register(date,date)',
    'staff_leave_save(uuid,uuid,text,date,date,boolean,text,text)', 'staff_leave_decide(uuid,text,text)', 'staff_leaves_list(text,date,date)',
    'staff_roles_permissions()', 'staff_activities(integer)', 'staff_performance(date,date)', 'staff_login_history(uuid,integer)', 'staff_log_event(uuid,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
