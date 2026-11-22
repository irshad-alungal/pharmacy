-- =============================================================================
-- 0030  WhatsApp Management (whatsapp.html) — free "one-tap" sending
-- Run once in the Supabase SQL editor after 0029. Safe to run twice.
--
-- How sending works (₹0, no WhatsApp Business API needed):
--   Every message is prepared and logged here (invoice, order update, payment / refill
--   reminder, offer, custom). Staff open it in WhatsApp with one tap (wa.me link with the
--   text filled in) and press Send. The message is then marked Sent.
--   Invoices go out as a private link to a read-only invoice page (view / download PDF)
--   that works without login: public_invoice(token). Links are random 64-hex tokens,
--   expire after 180 days and can be revoked.
--
--   Tables : whatsapp_settings, whatsapp_templates, whatsapp_campaigns,
--            whatsapp_messages, invoice_share_links ; storage bucket whatsapp-media
--   Billing: whatsapp_queue_invoice(invoice, base_url) right after a bill is finalised
--   Page   : whatsapp_overview, whatsapp_activity, whatsapp_conversations, whatsapp_thread,
--            whatsapp_queue_message, whatsapp_mark, whatsapp_log_reply, whatsapp_bills,
--            whatsapp_due_customers, whatsapp_refill_candidates, campaigns, templates,
--            settings.
-- Roles: billing counter roles (super_admin, admin, pharmacist, billing_staff) can prepare
-- and send customer messages; campaigns, templates and settings are admin only.
-- =============================================================================

-- ---------------------------------------------------------------- tables
CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  branch_id uuid PRIMARY KEY,
  auto_invoice boolean NOT NULL DEFAULT true,      -- prepare the invoice message after every bill with a phone
  open_after_bill boolean NOT NULL DEFAULT true,   -- open WhatsApp straight after the bill
  attach_link_offers boolean NOT NULL DEFAULT true,-- add the offer photo link to campaign messages
  signature text,
  base_url text,                                   -- where invoice-view.html is hosted (learned from the browser)
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'custom',
  body text NOT NULL,
  default_body text,
  is_system boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 100,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, code)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  kind text NOT NULL DEFAULT 'offer',
  body text NOT NULL,
  image_url text,
  image_path text,
  interval_sec integer NOT NULL DEFAULT 120,
  status text NOT NULL DEFAULT 'active',
  total integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT whatsapp_campaigns_status_chk CHECK (status IN ('draft','active','paused','completed','cancelled'))
);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  direction text NOT NULL DEFAULT 'out',
  customer_id uuid,
  phone text NOT NULL,
  recipient_name text,
  kind text NOT NULL DEFAULT 'custom',
  body text NOT NULL,
  link text,
  image_url text,
  invoice_id uuid,
  campaign_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  note text,
  queued_by uuid,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid,
  sent_at timestamptz,
  CONSTRAINT whatsapp_messages_dir_chk CHECK (direction IN ('out','in')),
  CONSTRAINT whatsapp_messages_status_chk CHECK (status IN ('queued','sent','skipped','failed','received')),
  CONSTRAINT whatsapp_messages_kind_chk CHECK (kind IN ('invoice','order_update','delivery','payment_reminder','refill_reminder','health','offer','custom','customer_query'))
);
CREATE INDEX IF NOT EXISTS whatsapp_messages_branch_at ON public.whatsapp_messages (branch_id, queued_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_phone ON public.whatsapp_messages (branch_id, phone, queued_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_invoice ON public.whatsapp_messages (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_campaign ON public.whatsapp_messages (campaign_id, status) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_queued ON public.whatsapp_messages (branch_id, status) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS public.invoice_share_links (
  token text PRIMARY KEY,
  branch_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '180 days',
  views integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS invoice_share_links_invoice ON public.invoice_share_links (invoice_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_settings','whatsapp_templates','whatsapp_campaigns','whatsapp_messages','invoice_share_links'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- Offer photos for campaigns: public (they are sent to customers), uploads into the
-- signed-in user's branch folder only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('whatsapp-media', 'whatsapp-media', true, 5242880, ARRAY['image/png','image/jpeg','image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
DROP POLICY IF EXISTS whatsapp_media_public_read ON storage.objects;
CREATE POLICY whatsapp_media_public_read ON storage.objects FOR SELECT USING (bucket_id = 'whatsapp-media');
DROP POLICY IF EXISTS whatsapp_media_branch_insert ON storage.objects;
CREATE POLICY whatsapp_media_branch_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'whatsapp-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active AND p.branch_id::text = (storage.foldername(name))[1]));
DROP POLICY IF EXISTS whatsapp_media_branch_delete ON storage.objects;
CREATE POLICY whatsapp_media_branch_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'whatsapp-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active AND p.branch_id::text = (storage.foldername(name))[1]));

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION public._wa_guard(p_admin boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id(); v_role text := COALESCE(public.my_role(), '');
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'Login and active branch required'; END IF;
  IF p_admin AND v_role NOT IN ('super_admin','admin') THEN RAISE EXCEPTION 'Not authorised: only Admin can manage WhatsApp campaigns, templates and settings'; END IF;
  IF v_role NOT IN ('super_admin','admin','pharmacist','billing_staff','billing') THEN RAISE EXCEPTION 'Not authorised to send WhatsApp messages'; END IF;
  RETURN v_branch;
END;
$$;
REVOKE ALL ON FUNCTION public._wa_guard(boolean) FROM PUBLIC, anon, authenticated;

-- 10-digit Indian numbers get 91; anything shorter than 10 digits is not a WhatsApp number.
CREATE OR REPLACE FUNCTION public._wa_phone(p text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN d IS NULL OR length(d) < 10 OR length(d) > 15 THEN NULL
    WHEN length(d) = 10 THEN '91' || d
    WHEN length(d) = 11 AND left(d, 1) = '0' THEN '91' || substr(d, 2)
    ELSE d END
  FROM (SELECT nullif(regexp_replace(COALESCE(p, ''), '\D', '', 'g'), '') AS d) x
$$;

CREATE OR REPLACE FUNCTION public._wa_fill(p_body text, p_vars jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE k text; v text; r text := COALESCE(p_body, '');
BEGIN
  FOR k, v IN SELECT key, value FROM jsonb_each_text(COALESCE(p_vars, '{}'::jsonb)) LOOP
    r := regexp_replace(r, '\{\{\s*' || k || '\s*\}\}', replace(COALESCE(v, ''), '\', '\\'), 'gi');
  END LOOP;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public._wa_first_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT COALESCE(nullif(split_part(trim(COALESCE(p, '')), ' ', 1), ''), 'Customer') $$;

CREATE OR REPLACE FUNCTION public._wa_seed(p_branch uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.whatsapp_settings (branch_id) VALUES (p_branch) ON CONFLICT DO NOTHING;
  INSERT INTO public.whatsapp_templates (branch_id, code, name, kind, body, default_body, is_system, sort)
  SELECT p_branch, t.code, t.name, t.kind, t.body, t.body, true, t.sort FROM (VALUES
    ('invoice', 'Invoice', 'invoice', 1,
     E'Hello {{name}}, thank you for choosing {{shop}}.\nYour bill {{order_no}} dated {{date}} for ₹{{amount}} is ready.\nView / download your invoice: {{link}}\nGet well soon!'),
    ('order_confirmation', 'Order Confirmation', 'order_update', 2,
     E'Hello {{name}}, your order {{order_no}} for ₹{{amount}} has been confirmed. We will let you know when it is ready. – {{shop}}'),
    ('delivery_update', 'Delivery Update', 'delivery', 3,
     E'Hello {{name}}, your order {{order_no}} is out for delivery and will reach you shortly. – {{shop}}'),
    ('order_delivered', 'Order Delivered', 'delivery', 4,
     E'Hello {{name}}, your order {{order_no}} has been delivered. Thank you for choosing {{shop}}!'),
    ('payment_reminder', 'Payment Reminder', 'payment_reminder', 5,
     E'Hello {{name}}, this is a gentle reminder that ₹{{due}} is pending at {{shop}}. You can pay by cash or UPI at your convenience. Thank you!'),
    ('refill_reminder', 'Medicine Refill Reminder', 'refill_reminder', 6,
     E'Hello {{name}}, it''s time to refill {{medicine_name}}. Reply to this message or visit {{shop}} and we will keep it ready for you.'),
    ('offer', 'Special Offer', 'offer', 7,
     E'Hello {{name}}! Special offer at {{shop}}: up to 20% off on selected medicines and health products this week. Visit us today!'),
    ('health_tip', 'Health Tip', 'health', 8,
     E'Hello {{name}}, a health tip from {{shop}}: drink plenty of water, take your medicines on time and complete the full course. Stay healthy!')
  ) AS t(code, name, kind, sort, body)
  ON CONFLICT (branch_id, code) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public._wa_seed(uuid) FROM PUBLIC, anon, authenticated;
DO $$ DECLARE b uuid; BEGIN FOR b IN SELECT id FROM public.branches LOOP PERFORM public._wa_seed(b); END LOOP; END $$;

CREATE OR REPLACE FUNCTION public._wa_template(p_branch uuid, p_code text, p_fallback text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT COALESCE((SELECT body FROM public.whatsapp_templates WHERE branch_id = p_branch AND code = p_code AND active), p_fallback) $$;
REVOKE ALL ON FUNCTION public._wa_template(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._wa_shop(p_branch uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT COALESCE((SELECT name FROM public.branches WHERE id = p_branch), 'Pallikkal Pharmacy') $$;
REVOKE ALL ON FUNCTION public._wa_shop(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._wa_signed(p_branch uuid, p_body text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN s.signature IS NULL OR trim(s.signature) = '' OR position(trim(s.signature) IN p_body) > 0 THEN p_body
              ELSE p_body || E'\n' || trim(s.signature) END
  FROM (SELECT (SELECT signature FROM public.whatsapp_settings WHERE branch_id = p_branch) AS signature) s
$$;
REVOKE ALL ON FUNCTION public._wa_signed(uuid, text) FROM PUBLIC, anon, authenticated;

-- Recompute a campaign's counters; complete it when nothing is left to send.
CREATE OR REPLACE FUNCTION public._wa_campaign_sync(p_campaign uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_q integer; v_s integer; v_k integer; v_t integer;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'queued'), count(*) FILTER (WHERE status = 'sent'),
         count(*) FILTER (WHERE status IN ('skipped','failed')), count(*)
    INTO v_q, v_s, v_k, v_t FROM public.whatsapp_messages WHERE campaign_id = p_campaign;
  UPDATE public.whatsapp_campaigns SET total = v_t, sent = v_s, skipped = v_k,
    status = CASE WHEN v_q = 0 AND status IN ('active','paused') THEN 'completed' ELSE status END,
    completed_at = CASE WHEN v_q = 0 AND status IN ('active','paused') THEN now() ELSE completed_at END
  WHERE id = p_campaign;
END;
$$;
REVOKE ALL ON FUNCTION public._wa_campaign_sync(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- settings & templates
DROP FUNCTION IF EXISTS public.whatsapp_settings_get();
CREATE FUNCTION public.whatsapp_settings_get()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(); r jsonb;
BEGIN
  PERFORM public._wa_seed(v_branch);
  SELECT jsonb_build_object('auto_invoice', s.auto_invoice, 'open_after_bill', s.open_after_bill, 'attach_link_offers', s.attach_link_offers,
           'signature', s.signature, 'base_url', s.base_url, 'shop', public._wa_shop(v_branch), 'updated_at', s.updated_at,
           'can_manage', COALESCE(public.my_role(), '') IN ('super_admin','admin'))
    INTO r FROM public.whatsapp_settings s WHERE s.branch_id = v_branch;
  RETURN r;
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_settings_save(boolean, boolean, boolean, text);
CREATE FUNCTION public.whatsapp_settings_save(p_auto_invoice boolean, p_open_after_bill boolean, p_attach_link_offers boolean, p_signature text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(true);
BEGIN
  IF length(COALESCE(p_signature, '')) > 200 THEN RAISE EXCEPTION 'Signature can be 200 characters at most'; END IF;
  PERFORM public._wa_seed(v_branch);
  UPDATE public.whatsapp_settings SET auto_invoice = COALESCE(p_auto_invoice, auto_invoice), open_after_bill = COALESCE(p_open_after_bill, open_after_bill),
    attach_link_offers = COALESCE(p_attach_link_offers, attach_link_offers), signature = nullif(trim(COALESCE(p_signature, '')), ''),
    updated_by = auth.uid(), updated_at = now()
  WHERE branch_id = v_branch;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'whatsapp_settings_saved', 'whatsapp_settings', v_branch::text, NULL, NULL,
          jsonb_build_object('auto_invoice', p_auto_invoice, 'open_after_bill', p_open_after_bill, 'attach_link_offers', p_attach_link_offers));
  RETURN public.whatsapp_settings_get();
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_templates_list();
CREATE FUNCTION public.whatsapp_templates_list()
RETURNS TABLE (id uuid, code text, name text, kind text, body text, default_body text, is_system boolean, active boolean, sort integer, updated_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard();
BEGIN
  PERFORM public._wa_seed(v_branch);
  RETURN QUERY SELECT t.id, t.code, t.name, t.kind, t.body, t.default_body, t.is_system, t.active, t.sort, t.updated_at
  FROM public.whatsapp_templates t WHERE t.branch_id = v_branch ORDER BY t.sort, t.name;
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_template_save(uuid, text, text, text, boolean);
CREATE FUNCTION public.whatsapp_template_save(p_id uuid, p_name text, p_kind text, p_body text, p_active boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(true); v_id uuid; v_sys boolean;
BEGIN
  IF nullif(trim(p_name), '') IS NULL OR length(p_name) > 80 THEN RAISE EXCEPTION 'Template name is required (80 characters max)'; END IF;
  IF nullif(trim(p_body), '') IS NULL OR length(p_body) > 1024 THEN RAISE EXCEPTION 'Message is required (1024 characters max)'; END IF;
  IF p_kind NOT IN ('invoice','order_update','delivery','payment_reminder','refill_reminder','health','offer','custom') THEN RAISE EXCEPTION 'Unknown template type'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.whatsapp_templates (branch_id, code, name, kind, body, active, updated_by, sort)
    VALUES (v_branch, 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), trim(p_name), p_kind, trim(p_body), COALESCE(p_active, true), auth.uid(), 200)
    RETURNING id INTO v_id;
  ELSE
    SELECT is_system INTO v_sys FROM public.whatsapp_templates WHERE id = p_id AND branch_id = v_branch;
    IF NOT FOUND THEN RAISE EXCEPTION 'Template not found'; END IF;
    UPDATE public.whatsapp_templates SET name = trim(p_name), kind = CASE WHEN v_sys THEN kind ELSE p_kind END, body = trim(p_body),
      active = COALESCE(p_active, true), updated_by = auth.uid(), updated_at = now()
    WHERE id = p_id RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_template_delete(uuid);
CREATE FUNCTION public.whatsapp_template_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(true); v_sys boolean;
BEGIN
  SELECT is_system INTO v_sys FROM public.whatsapp_templates WHERE id = p_id AND branch_id = v_branch;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template not found'; END IF;
  IF v_sys THEN
    UPDATE public.whatsapp_templates SET body = default_body, active = true, updated_by = auth.uid(), updated_at = now() WHERE id = p_id;
  ELSE
    DELETE FROM public.whatsapp_templates WHERE id = p_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------- messages
DROP FUNCTION IF EXISTS public.whatsapp_queue_message(uuid, text, text, text, text, uuid, text, text, jsonb);
CREATE FUNCTION public.whatsapp_queue_message(p_customer uuid, p_phone text, p_name text, p_kind text, p_body text,
  p_invoice uuid DEFAULT NULL, p_link text DEFAULT NULL, p_image_url text DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(); c record; v_phone text; v_name text; v_id uuid; v_body text;
BEGIN
  IF p_kind NOT IN ('invoice','order_update','delivery','payment_reminder','refill_reminder','health','offer','custom') THEN RAISE EXCEPTION 'Unknown message type'; END IF;
  IF nullif(trim(p_body), '') IS NULL THEN RAISE EXCEPTION 'Write a message first'; END IF;
  IF length(p_body) > 4000 THEN RAISE EXCEPTION 'Message is too long (4000 characters max)'; END IF;
  IF p_customer IS NOT NULL THEN
    SELECT id, name, phone, consent, active INTO c FROM public.customers WHERE id = p_customer AND branch_id = v_branch;
    IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found in this branch'; END IF;
    IF p_kind IN ('offer','health') AND NOT c.consent THEN RAISE EXCEPTION '% has not agreed to receive offers on WhatsApp', c.name; END IF;
    v_phone := public._wa_phone(COALESCE(nullif(p_phone, ''), c.phone)); v_name := COALESCE(nullif(trim(p_name), ''), c.name);
  ELSE
    IF p_kind IN ('offer','health') THEN RAISE EXCEPTION 'Offers and health campaigns can only go to customers who agreed to receive them'; END IF;
    v_phone := public._wa_phone(p_phone); v_name := nullif(trim(COALESCE(p_name, '')), '');
  END IF;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'Enter a valid WhatsApp number (10 digits)'; END IF;
  IF p_invoice IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = p_invoice AND branch_id = v_branch) THEN RAISE EXCEPTION 'Bill not found in this branch'; END IF;
  v_body := public._wa_signed(v_branch, trim(p_body));
  INSERT INTO public.whatsapp_messages (branch_id, customer_id, phone, recipient_name, kind, body, link, image_url, invoice_id, meta, queued_by)
  VALUES (v_branch, p_customer, v_phone, v_name, p_kind, v_body, nullif(p_link, ''), nullif(p_image_url, ''), p_invoice, COALESCE(p_meta, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'phone', v_phone, 'name', v_name, 'body', v_body, 'status', 'queued');
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_mark(uuid[], text, text);
CREATE FUNCTION public.whatsapp_mark(p_ids uuid[], p_status text, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(); v_n integer; v_c uuid;
BEGIN
  IF p_status NOT IN ('sent','skipped','failed','queued') THEN RAISE EXCEPTION 'Unknown status'; END IF;
  UPDATE public.whatsapp_messages SET status = p_status,
    sent_at = CASE WHEN p_status = 'sent' THEN now() WHEN p_status = 'queued' THEN NULL ELSE sent_at END,
    sent_by = CASE WHEN p_status = 'sent' THEN auth.uid() WHEN p_status = 'queued' THEN NULL ELSE sent_by END,
    note = COALESCE(nullif(trim(p_note), ''), CASE WHEN p_status = 'queued' THEN NULL ELSE note END)
  WHERE id = ANY(p_ids) AND branch_id = v_branch AND direction = 'out';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  FOR v_c IN SELECT DISTINCT campaign_id FROM public.whatsapp_messages WHERE id = ANY(p_ids) AND campaign_id IS NOT NULL LOOP
    PERFORM public._wa_campaign_sync(v_c);
  END LOOP;
  RETURN v_n;
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_log_reply(text, text, uuid);
CREATE FUNCTION public.whatsapp_log_reply(p_phone text, p_body text, p_customer uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(); v_phone text := public._wa_phone(p_phone); v_cust uuid := p_customer; v_name text; v_id uuid;
BEGIN
  IF v_phone IS NULL THEN RAISE EXCEPTION 'Enter a valid WhatsApp number (10 digits)'; END IF;
  IF nullif(trim(p_body), '') IS NULL OR length(p_body) > 4000 THEN RAISE EXCEPTION 'Type what the customer wrote (4000 characters max)'; END IF;
  IF v_cust IS NULL THEN SELECT id INTO v_cust FROM public.customers WHERE branch_id = v_branch AND public._wa_phone(phone) = v_phone ORDER BY active DESC, created_at LIMIT 1; END IF;
  SELECT name INTO v_name FROM public.customers WHERE id = v_cust AND branch_id = v_branch;
  INSERT INTO public.whatsapp_messages (branch_id, direction, customer_id, phone, recipient_name, kind, body, status, queued_by, sent_by, sent_at)
  VALUES (v_branch, 'in', v_cust, v_phone, v_name, 'customer_query', trim(p_body), 'received', auth.uid(), auth.uid(), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Invoice link + message, prepared right after the bill (idempotent per bill).
DROP FUNCTION IF EXISTS public.whatsapp_queue_invoice(uuid, text);
CREATE FUNCTION public.whatsapp_queue_invoice(p_invoice uuid, p_base_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._wa_guard(); inv record; v_phone text; v_name text; v_token text; v_base text; v_link text;
  m record; v_body text; v_id uuid; s record;
BEGIN
  PERFORM public._wa_seed(v_branch);
  SELECT * INTO s FROM public.whatsapp_settings WHERE branch_id = v_branch;
  SELECT i.id, i.invoice_no, i.total, i.created_at, i.status, i.customer_id, i.patient_phone, i.patient_name, c.name AS cname, c.phone AS cphone
    INTO inv FROM public.sales_invoices i LEFT JOIN public.customers c ON c.id = i.customer_id
  WHERE i.id = p_invoice AND i.branch_id = v_branch;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found in this branch'; END IF;
  v_phone := COALESCE(public._wa_phone(inv.cphone), public._wa_phone(inv.patient_phone));
  v_name := COALESCE(inv.cname, inv.patient_name);
  IF v_phone IS NULL THEN RETURN jsonb_build_object('status', 'no_phone', 'invoice_no', inv.invoice_no); END IF;

  v_base := nullif(trim(COALESCE(p_base_url, '')), '');
  IF v_base IS NOT NULL AND (v_base !~* '^https?://[^ ]+$' OR length(v_base) > 300) THEN v_base := NULL; END IF;
  IF v_base IS NOT NULL THEN
    v_base := regexp_replace(v_base, '[^/]*$', '');
    UPDATE public.whatsapp_settings SET base_url = v_base WHERE branch_id = v_branch AND base_url IS DISTINCT FROM v_base;
  ELSE v_base := s.base_url; END IF;

  SELECT token INTO v_token FROM public.invoice_share_links
  WHERE invoice_id = inv.id AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NULL THEN
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.invoice_share_links (token, branch_id, invoice_id, created_by) VALUES (v_token, v_branch, inv.id, auth.uid());
  END IF;
  v_link := CASE WHEN v_base IS NULL THEN NULL ELSE v_base || 'invoice-view.html?t=' || v_token END;

  SELECT * INTO m FROM public.whatsapp_messages WHERE invoice_id = inv.id AND kind = 'invoice' AND direction = 'out' AND status <> 'skipped'
  ORDER BY queued_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status', m.status, 'id', m.id, 'phone', m.phone, 'name', m.recipient_name, 'body', m.body, 'link', m.link,
                              'token', v_token, 'invoice_no', inv.invoice_no, 'already', true,
                              'auto_invoice', s.auto_invoice, 'open_after_bill', s.open_after_bill);
  END IF;
  v_body := public._wa_fill(public._wa_template(v_branch, 'invoice',
              E'Hello {{name}}, thank you for choosing {{shop}}.\nYour bill {{order_no}} for ₹{{amount}} is ready.\nView / download your invoice: {{link}}'),
            jsonb_build_object('name', public._wa_first_name(v_name), 'shop', public._wa_shop(v_branch), 'order_no', inv.invoice_no,
              'amount', to_char(round(inv.total, 2), 'FM99,99,99,990.00'), 'date', to_char(inv.created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY'),
              'link', COALESCE(v_link, '')));
  IF v_link IS NULL THEN v_body := regexp_replace(v_body, E'\n?[^\n]*:\\s*$', ''); END IF;
  v_body := public._wa_signed(v_branch, v_body);
  INSERT INTO public.whatsapp_messages (branch_id, customer_id, phone, recipient_name, kind, body, link, invoice_id, queued_by, meta)
  VALUES (v_branch, inv.customer_id, v_phone, v_name, 'invoice', v_body, v_link, inv.id, auth.uid(), jsonb_build_object('token', v_token))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', 'queued', 'id', v_id, 'phone', v_phone, 'name', v_name, 'body', v_body, 'link', v_link, 'token', v_token,
                            'invoice_no', inv.invoice_no, 'already', false, 'auto_invoice', s.auto_invoice, 'open_after_bill', s.open_after_bill);
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_invoice_link_revoke(uuid);
CREATE FUNCTION public.whatsapp_invoice_link_revoke(p_invoice uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(true); v_n integer;
BEGIN
  UPDATE public.invoice_share_links SET revoked_at = now() WHERE invoice_id = p_invoice AND branch_id = v_branch AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Read-only invoice for the customer's link (no login). Diagnosis, doctor and address are never shown.
DROP FUNCTION IF EXISTS public.public_invoice(text);
CREATE FUNCTION public.public_invoice(p_token text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE l record; inv public.sales_invoices%ROWTYPE; f numeric; r jsonb; v_phone text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'This invoice link is not valid'; END IF;
  SELECT * INTO l FROM public.invoice_share_links WHERE token = p_token;
  IF NOT FOUND OR l.revoked_at IS NOT NULL OR l.expires_at < now() THEN RAISE EXCEPTION 'This invoice link is not valid or has expired. Please contact the pharmacy.'; END IF;
  SELECT * INTO inv FROM public.sales_invoices WHERE id = l.invoice_id AND branch_id = l.branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'This invoice link is not valid'; END IF;
  UPDATE public.invoice_share_links SET views = views + 1, last_viewed_at = now() WHERE token = p_token;
  f := CASE WHEN inv.subtotal > 0 THEN inv.total / inv.subtotal ELSE 1 END;
  SELECT phone INTO v_phone FROM public.customers WHERE id = inv.customer_id;
  v_phone := COALESCE(v_phone, inv.patient_phone);
  SELECT jsonb_build_object(
    'shop', (SELECT jsonb_build_object('name', b.name, 'address', concat_ws(', ', nullif(b.address, ''), nullif(b.city, ''), nullif(b.state, ''), nullif(b.pincode, '')),
               'phone', b.phone, 'email', b.email, 'gstin', b.gstin,
               'drug_licence', (SELECT string_agg(x, ' / ') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(b.drug_licence_nos) = 'array' THEN b.drug_licence_nos ELSE '[]'::jsonb END) x),
               'footer_note', b.invoice_footer) FROM public.branches b WHERE b.id = inv.branch_id),
    'invoice', jsonb_build_object('invoice_no', inv.invoice_no, 'created_at', inv.created_at, 'subtotal', inv.subtotal, 'discount', inv.discount,
               'tax', inv.tax, 'total', inv.total, 'status', inv.status, 'line_discount', inv.line_discount, 'patient_name', inv.patient_name),
    'customer', (SELECT jsonb_build_object('name', c.name,
                   'phone', CASE WHEN length(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g')) >= 4 THEN '******' || right(regexp_replace(c.phone, '\D', '', 'g'), 4) ELSE '' END)
                 FROM public.customers c WHERE c.id = inv.customer_id),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', m.name, 'strength', m.strength, 'batch_no', b.batch_no, 'expiry', b.expiry,
               'qty', i.qty, 'unit_price', i.unit_price, 'tax_rate', i.tax_rate, 'line_total', i.line_total, 'mrp', COALESCE(i.mrp, i.unit_price),
               'discount_pct', i.discount_pct, 'price_includes_tax', COALESCE(i.price_includes_tax, true)) ORDER BY i.id), '[]'::jsonb)
             FROM public.sales_items i JOIN public.medicines m ON m.id = i.medicine_id JOIN public.medicine_batches b ON b.id = i.batch_id
             WHERE i.invoice_id = inv.id),
    'payments', (SELECT COALESCE(jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount)), '[]'::jsonb) FROM public.payments p WHERE p.invoice_id = inv.id),
    'tax_summary', (SELECT COALESCE(jsonb_agg(jsonb_build_object('rate', t.rate, 'taxable', t.taxable, 'tax', t.tax) ORDER BY t.rate), '[]'::jsonb)
                    FROM (SELECT i.tax_rate AS rate,
                                 round(sum(COALESCE(i.taxable_amount, i.line_total * 100 / (100 + i.tax_rate)) * f), 2) AS taxable,
                                 round(sum(COALESCE(i.gst_amount, i.line_total * i.tax_rate / (100 + i.tax_rate)) * f), 2) AS tax
                          FROM public.sales_items i WHERE i.invoice_id = inv.id GROUP BY i.tax_rate) t),
    'returned', (SELECT COALESCE(sum(total), 0) FROM public.sales_returns WHERE invoice_id = inv.id)
  ) INTO r;
  RETURN r;
END;
$$;

-- ---------------------------------------------------------------- page data
DROP FUNCTION IF EXISTS public.whatsapp_overview(date, date);
CREATE FUNCTION public.whatsapp_overview(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._wa_guard(); v_len integer; v_pf date; v_pt date; r jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  v_len := p_to - p_from + 1; v_pt := p_from - 1; v_pf := p_from - v_len;
  WITH m AS (
    SELECT *, (COALESCE(sent_at, queued_at) AT TIME ZONE 'Asia/Kolkata')::date AS d FROM public.whatsapp_messages WHERE branch_id = v_branch),
  bills AS (
    SELECT i.id, (i.created_at AT TIME ZONE 'Asia/Kolkata')::date AS d,
           COALESCE(public._wa_phone(c.phone), public._wa_phone(i.patient_phone)) IS NOT NULL AS has_phone,
           EXISTS (SELECT 1 FROM public.whatsapp_messages w WHERE w.invoice_id = i.id AND w.kind = 'invoice' AND w.status = 'sent') AS shared
    FROM public.sales_invoices i LEFT JOIN public.customers c ON c.id = i.customer_id
    WHERE i.branch_id = v_branch AND i.status = 'final' AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to)
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'prev_from', v_pf, 'prev_to', v_pt,
    'sent', (SELECT count(*) FROM m WHERE direction = 'out' AND status = 'sent' AND d BETWEEN p_from AND p_to),
    'sent_prev', (SELECT count(*) FROM m WHERE direction = 'out' AND status = 'sent' AND d BETWEEN v_pf AND v_pt),
    'by_kind', (SELECT COALESCE(jsonb_object_agg(kind, n), '{}'::jsonb) FROM (SELECT kind, count(*) n FROM m WHERE direction = 'out' AND status = 'sent' AND d BETWEEN p_from AND p_to GROUP BY kind) k),
    'skipped', (SELECT count(*) FROM m WHERE direction = 'out' AND status IN ('skipped','failed') AND d BETWEEN p_from AND p_to),
    'replies', (SELECT count(*) FROM m WHERE direction = 'in' AND d BETWEEN p_from AND p_to),
    'bills', (SELECT count(*) FROM bills), 'bills_with_phone', (SELECT count(*) FROM bills WHERE has_phone),
    'bills_shared', (SELECT count(*) FROM bills WHERE shared),
    'pending', (SELECT count(*) FROM public.whatsapp_messages WHERE branch_id = v_branch AND status = 'queued'),
    'pending_oldest', (SELECT min(queued_at) FROM public.whatsapp_messages WHERE branch_id = v_branch AND status = 'queued'),
    'pending_invoices', (SELECT count(*) FROM public.whatsapp_messages WHERE branch_id = v_branch AND status = 'queued' AND kind = 'invoice'),
    'active_customers', (SELECT count(DISTINCT COALESCE(customer_id::text, phone)) FROM m WHERE status IN ('sent','received') AND d BETWEEN p_from AND p_to),
    'active_customers_prev', (SELECT count(DISTINCT COALESCE(customer_id::text, phone)) FROM m WHERE status IN ('sent','received') AND d BETWEEN v_pf AND v_pt),
    'consented', (SELECT count(*) FROM public.customers WHERE branch_id = v_branch AND active AND consent AND public._wa_phone(phone) IS NOT NULL),
    'customers_with_phone', (SELECT count(*) FROM public.customers WHERE branch_id = v_branch AND active AND public._wa_phone(phone) IS NOT NULL),
    'campaigns_active', (SELECT count(*) FROM public.whatsapp_campaigns WHERE branch_id = v_branch AND status IN ('active','paused'))
  ) INTO r;
  RETURN r;
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_activity(date, date, text, text, text, integer, integer);
CREATE FUNCTION public.whatsapp_activity(p_from date, p_to date, p_kind text DEFAULT NULL, p_status text DEFAULT NULL, p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS TABLE (id uuid, at timestamptz, queued_at timestamptz, sent_at timestamptz, direction text, kind text, status text, phone text, name text,
  customer_id uuid, body text, link text, image_url text, invoice_id uuid, invoice_no text, campaign_id uuid, campaign_name text,
  by_name text, note text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(); v_q text := lower(nullif(trim(COALESCE(p_search, '')), ''));
BEGIN
  RETURN QUERY
  SELECT w.id, COALESCE(w.sent_at, w.queued_at), w.queued_at, w.sent_at, w.direction, w.kind, w.status, w.phone,
         COALESCE(c.name, w.recipient_name)::text, w.customer_id, w.body, w.link, w.image_url, w.invoice_id, i.invoice_no,
         w.campaign_id, cp.name, COALESCE(ps.full_name, pq.full_name)::text, w.note, count(*) OVER ()
  FROM public.whatsapp_messages w
  LEFT JOIN public.customers c ON c.id = w.customer_id
  LEFT JOIN public.sales_invoices i ON i.id = w.invoice_id
  LEFT JOIN public.whatsapp_campaigns cp ON cp.id = w.campaign_id
  LEFT JOIN public.profiles ps ON ps.id = w.sent_by
  LEFT JOIN public.profiles pq ON pq.id = w.queued_by
  WHERE w.branch_id = v_branch
    AND (p_from IS NULL OR (COALESCE(w.sent_at, w.queued_at) AT TIME ZONE 'Asia/Kolkata')::date >= p_from)
    AND (p_to IS NULL OR (COALESCE(w.sent_at, w.queued_at) AT TIME ZONE 'Asia/Kolkata')::date <= p_to)
    AND (nullif(p_kind, '') IS NULL OR w.kind = p_kind)
    AND (nullif(p_status, '') IS NULL OR w.status = p_status)
    AND (v_q IS NULL OR lower(COALESCE(c.name, w.recipient_name, '')) LIKE '%' || v_q || '%' OR w.phone LIKE '%' || regexp_replace(v_q, '\D', '', 'g') || '%' AND regexp_replace(v_q, '\D', '', 'g') <> ''
         OR lower(w.body) LIKE '%' || v_q || '%' OR lower(COALESCE(i.invoice_no, '')) LIKE '%' || v_q || '%')
  ORDER BY COALESCE(w.sent_at, w.queued_at) DESC, w.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_conversations(text, integer);
CREATE FUNCTION public.whatsapp_conversations(p_search text DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS TABLE (phone text, name text, customer_id uuid, last_at timestamptz, last_body text, last_direction text, last_status text,
  last_kind text, pending integer, replies integer, messages integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(); v_q text := lower(nullif(trim(COALESCE(p_search, '')), '')); v_d text;
BEGIN
  v_d := regexp_replace(COALESCE(v_q, ''), '\D', '', 'g');
  RETURN QUERY
  WITH w AS (
    SELECT m.*, COALESCE(m.sent_at, m.queued_at) AS t FROM public.whatsapp_messages m WHERE m.branch_id = v_branch),
  agg AS (
    SELECT w.phone, count(*) FILTER (WHERE w.status = 'queued')::int AS pending, count(*) FILTER (WHERE w.direction = 'in')::int AS replies, count(*)::int AS n,
           (array_agg(w.customer_id ORDER BY (w.customer_id IS NULL), w.t DESC))[1] AS cust
    FROM w GROUP BY w.phone),
  last AS (
    SELECT DISTINCT ON (w.phone) w.phone, w.t, w.body, w.direction, w.status, w.kind, w.recipient_name FROM w ORDER BY w.phone, w.t DESC)
  SELECT l.phone, COALESCE(c.name, l.recipient_name, '+' || l.phone)::text, a.cust, l.t, l.body, l.direction, l.status, l.kind, a.pending, a.replies, a.n
  FROM last l JOIN agg a ON a.phone = l.phone LEFT JOIN public.customers c ON c.id = a.cust
  WHERE v_q IS NULL OR lower(COALESCE(c.name, l.recipient_name, '')) LIKE '%' || v_q || '%' OR (v_d <> '' AND l.phone LIKE '%' || v_d || '%')
  ORDER BY l.t DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_thread(text);
CREATE FUNCTION public.whatsapp_thread(p_phone text)
RETURNS TABLE (id uuid, at timestamptz, direction text, kind text, status text, body text, link text, image_url text, invoice_no text, by_name text, campaign_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(); v_phone text := public._wa_phone(p_phone);
BEGIN
  RETURN QUERY
  SELECT w.id, COALESCE(w.sent_at, w.queued_at), w.direction, w.kind, w.status, w.body, w.link, w.image_url, i.invoice_no,
         COALESCE(ps.full_name, pq.full_name)::text, cp.name
  FROM public.whatsapp_messages w
  LEFT JOIN public.sales_invoices i ON i.id = w.invoice_id
  LEFT JOIN public.profiles ps ON ps.id = w.sent_by LEFT JOIN public.profiles pq ON pq.id = w.queued_by
  LEFT JOIN public.whatsapp_campaigns cp ON cp.id = w.campaign_id
  WHERE w.branch_id = v_branch AND w.phone = v_phone
  ORDER BY COALESCE(w.sent_at, w.queued_at) DESC
  LIMIT 200;
END;
$$;

-- Bills (with phone) for "Send order update" and "bills not yet shared".
DROP FUNCTION IF EXISTS public.whatsapp_bills(date, date, boolean);
CREATE FUNCTION public.whatsapp_bills(p_from date, p_to date, p_unshared_only boolean DEFAULT false)
RETURNS TABLE (invoice_id uuid, invoice_no text, created_at timestamptz, total numeric, status text, customer_id uuid, name text, phone text,
  delivery_status text, shared boolean, invoice_message_status text, last_update_kind text, last_update_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard();
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  RETURN QUERY
  SELECT * FROM (
    SELECT i.id AS x_id, i.invoice_no AS x_no, i.created_at AS x_at, round(i.total, 2) AS x_total, i.status AS x_status, i.customer_id AS x_cust,
           COALESCE(c.name, i.patient_name, 'Walk-in')::text AS x_name,
           COALESCE(public._wa_phone(c.phone), public._wa_phone(i.patient_phone)) AS x_phone,
           (SELECT j.status FROM public.delivery_jobs j WHERE j.invoice_id = i.id ORDER BY j.created_at DESC LIMIT 1) AS x_del,
           EXISTS (SELECT 1 FROM public.whatsapp_messages w WHERE w.invoice_id = i.id AND w.kind = 'invoice' AND w.status = 'sent') AS x_shared,
           (SELECT w.status FROM public.whatsapp_messages w WHERE w.invoice_id = i.id AND w.kind = 'invoice' ORDER BY w.queued_at DESC LIMIT 1) AS x_msg,
           u.kind AS x_kind, u.t AS x_t
    FROM public.sales_invoices i
    LEFT JOIN public.customers c ON c.id = i.customer_id
    LEFT JOIN LATERAL (SELECT w.kind, COALESCE(w.sent_at, w.queued_at) AS t FROM public.whatsapp_messages w
                       WHERE w.invoice_id = i.id AND w.kind IN ('order_update','delivery') AND w.status = 'sent' ORDER BY w.sent_at DESC LIMIT 1) u ON true
    WHERE i.branch_id = v_branch AND i.status = 'final' AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  ) x
  WHERE x.x_phone IS NOT NULL AND (NOT p_unshared_only OR NOT x.x_shared)
  ORDER BY x.x_at DESC
  LIMIT 300;
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_due_customers();
CREATE FUNCTION public.whatsapp_due_customers()
RETURNS TABLE (customer_id uuid, name text, phone text, outstanding numeric, credit_limit numeric, last_reminder_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard();
BEGIN
  RETURN QUERY
  SELECT c.id, c.name, c.phone, round(public.customer_outstanding(c.id), 2), c.credit_limit,
         (SELECT max(w.sent_at) FROM public.whatsapp_messages w WHERE w.customer_id = c.id AND w.kind = 'payment_reminder' AND w.status = 'sent')
  FROM public.customers c
  WHERE c.branch_id = v_branch AND c.active AND public._wa_phone(c.phone) IS NOT NULL AND public.customer_outstanding(c.id) > 0
  ORDER BY 4 DESC;
END;
$$;

-- Customers whose medicine (bought p_days ago) is due for a refill: due date within ±p_window days of today,
-- and not reminded since that purchase.
DROP FUNCTION IF EXISTS public.whatsapp_refill_candidates(integer, integer);
CREATE FUNCTION public.whatsapp_refill_candidates(p_days integer DEFAULT 30, p_window integer DEFAULT 5)
RETURNS TABLE (customer_id uuid, name text, phone text, consent boolean, medicine_id uuid, medicine text, last_date date, qty numeric,
  days_since integer, due_date date, reminded_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(); v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN RAISE EXCEPTION 'Refill period must be 1–365 days'; END IF;
  IF p_window IS NULL OR p_window < 0 OR p_window > 60 THEN RAISE EXCEPTION 'Window must be 0–60 days'; END IF;
  RETURN QUERY
  WITH last AS (
    SELECT i.customer_id AS cid, si.medicine_id AS mid, max((i.created_at AT TIME ZONE 'Asia/Kolkata')::date) AS d,
           sum(si.qty) FILTER (WHERE true) AS q
    FROM public.sales_items si JOIN public.sales_invoices i ON i.id = si.invoice_id
    WHERE i.branch_id = v_branch AND i.status = 'final' AND i.customer_id IS NOT NULL
      AND i.created_at >= now() - make_interval(days => p_days + p_window + 120)
    GROUP BY 1, 2),
  lastq AS (
    SELECT l.cid, l.mid, l.d,
           (SELECT sum(si.qty) FROM public.sales_items si JOIN public.sales_invoices i ON i.id = si.invoice_id
             WHERE i.customer_id = l.cid AND si.medicine_id = l.mid AND i.status = 'final' AND (i.created_at AT TIME ZONE 'Asia/Kolkata')::date = l.d) AS q
    FROM last l WHERE l.d + p_days BETWEEN v_today - p_window AND v_today + p_window)
  SELECT c.id, c.name, c.phone, c.consent, m.id, trim(m.name || ' ' || COALESCE(m.strength, ''))::text, x.d, round(x.q, 3), (v_today - x.d)::int, x.d + p_days,
         (SELECT max(w.sent_at) FROM public.whatsapp_messages w WHERE w.customer_id = c.id AND w.kind = 'refill_reminder' AND w.status = 'sent'
            AND w.meta->>'medicine_id' = m.id::text AND (w.sent_at AT TIME ZONE 'Asia/Kolkata')::date >= x.d)
  FROM lastq x JOIN public.customers c ON c.id = x.cid JOIN public.medicines m ON m.id = x.mid
  WHERE c.active AND public._wa_phone(c.phone) IS NOT NULL
  ORDER BY x.d + p_days, c.name;
END;
$$;

-- ---------------------------------------------------------------- campaigns
DROP FUNCTION IF EXISTS public.whatsapp_campaign_create(text, text, text, text, text, text, integer, uuid[]);
CREATE FUNCTION public.whatsapp_campaign_create(p_name text, p_description text, p_kind text, p_body text, p_image_url text, p_image_path text,
  p_interval integer, p_customers uuid[])
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(true); v_id uuid; v_n integer; v_shop text; v_attach boolean; v_body text;
BEGIN
  IF nullif(trim(p_name), '') IS NULL OR length(p_name) > 80 THEN RAISE EXCEPTION 'Campaign name is required (80 characters max)'; END IF;
  IF nullif(trim(p_body), '') IS NULL OR length(p_body) > 1024 THEN RAISE EXCEPTION 'Message is required (1024 characters max)'; END IF;
  IF p_kind NOT IN ('offer','health','payment_reminder','refill_reminder','custom') THEN RAISE EXCEPTION 'Unknown campaign type'; END IF;
  IF p_interval IS NULL OR p_interval < 30 OR p_interval > 3600 THEN RAISE EXCEPTION 'Interval must be 30 seconds to 60 minutes'; END IF;
  IF p_image_url IS NOT NULL AND p_image_url !~* '^https?://' THEN RAISE EXCEPTION 'Photo link must be a web address'; END IF;
  IF p_image_path IS NOT NULL AND split_part(p_image_path, '/', 1) <> v_branch::text THEN RAISE EXCEPTION 'Photo must be in this branch''s folder'; END IF;
  IF COALESCE(array_length(p_customers, 1), 0) = 0 THEN RAISE EXCEPTION 'Select at least one customer'; END IF;
  IF array_length(p_customers, 1) > 5000 THEN RAISE EXCEPTION 'A campaign can have 5000 customers at most'; END IF;
  PERFORM public._wa_seed(v_branch);
  v_shop := public._wa_shop(v_branch);
  SELECT attach_link_offers INTO v_attach FROM public.whatsapp_settings WHERE branch_id = v_branch;
  INSERT INTO public.whatsapp_campaigns (branch_id, name, description, kind, body, image_url, image_path, interval_sec, status, created_by, started_at)
  VALUES (v_branch, trim(p_name), nullif(trim(COALESCE(p_description, '')), ''), p_kind, trim(p_body), nullif(p_image_url, ''), nullif(p_image_path, ''), p_interval, 'active', auth.uid(), now())
  RETURNING id INTO v_id;
  v_body := trim(p_body) || CASE WHEN COALESCE(v_attach, true) AND nullif(p_image_url, '') IS NOT NULL AND position('{{photo}}' IN p_body) = 0 THEN E'\n\n{{photo}}' ELSE '' END;
  INSERT INTO public.whatsapp_messages (branch_id, customer_id, phone, recipient_name, kind, body, image_url, campaign_id, queued_by)
  SELECT v_branch, c.id, public._wa_phone(c.phone), c.name, p_kind,
         public._wa_signed(v_branch, public._wa_fill(v_body, jsonb_build_object('name', public._wa_first_name(c.name), 'shop', v_shop, 'photo', COALESCE(p_image_url, ''),
           'due', to_char(round(public.customer_outstanding(c.id), 2), 'FM99,99,99,990.00')))),
         nullif(p_image_url, ''), v_id, auth.uid()
  FROM (SELECT DISTINCT unnest(p_customers) AS id) s JOIN public.customers c ON c.id = s.id
  WHERE c.branch_id = v_branch AND c.active AND public._wa_phone(c.phone) IS NOT NULL
    AND (c.consent OR p_kind IN ('payment_reminder','refill_reminder'))
  ORDER BY c.name;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'None of the selected customers can receive this campaign (WhatsApp consent and a valid phone are needed)'; END IF;
  UPDATE public.whatsapp_campaigns SET total = v_n WHERE id = v_id;
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'whatsapp_campaign_created', 'whatsapp_campaign', v_id::text, trim(p_name), NULL, jsonb_build_object('recipients', v_n, 'kind', p_kind));
  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_campaigns_list(integer);
CREATE FUNCTION public.whatsapp_campaigns_list(p_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, name text, description text, kind text, body text, image_url text, interval_sec integer, status text,
  total integer, sent integer, skipped integer, queued integer, created_at timestamptz, started_at timestamptz, completed_at timestamptz, created_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard();
BEGIN
  RETURN QUERY
  SELECT c.id, c.name, c.description, c.kind, c.body, c.image_url, c.interval_sec, c.status,
         COALESCE(k.t, 0), COALESCE(k.s, 0), COALESCE(k.k, 0), COALESCE(k.q, 0), c.created_at, c.started_at, c.completed_at, p.full_name::text
  FROM public.whatsapp_campaigns c
  LEFT JOIN LATERAL (SELECT count(*)::int t, count(*) FILTER (WHERE m.status = 'sent')::int s, count(*) FILTER (WHERE m.status IN ('skipped','failed'))::int k,
                            count(*) FILTER (WHERE m.status = 'queued')::int q FROM public.whatsapp_messages m WHERE m.campaign_id = c.id) k ON true
  LEFT JOIN public.profiles p ON p.id = c.created_by
  WHERE c.branch_id = v_branch
  ORDER BY (c.status IN ('active','paused')) DESC, c.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_campaign_queue(uuid);
CREATE FUNCTION public.whatsapp_campaign_queue(p_id uuid)
RETURNS TABLE (id uuid, customer_id uuid, name text, phone text, body text, image_url text, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_campaigns c WHERE c.id = p_id AND c.branch_id = v_branch) THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  RETURN QUERY SELECT m.id, m.customer_id, m.recipient_name, m.phone, m.body, m.image_url, m.status
  FROM public.whatsapp_messages m WHERE m.campaign_id = p_id ORDER BY m.recipient_name, m.id;
END;
$$;

DROP FUNCTION IF EXISTS public.whatsapp_campaign_status(uuid, text);
CREATE FUNCTION public.whatsapp_campaign_status(p_id uuid, p_status text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._wa_guard(true); v_old text;
BEGIN
  SELECT status INTO v_old FROM public.whatsapp_campaigns WHERE id = p_id AND branch_id = v_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  IF p_status NOT IN ('active','paused','cancelled') THEN RAISE EXCEPTION 'Unknown status'; END IF;
  IF v_old IN ('completed','cancelled') THEN RAISE EXCEPTION 'This campaign is already %', v_old; END IF;
  IF p_status = 'cancelled' THEN
    UPDATE public.whatsapp_messages SET status = 'skipped', note = 'Campaign cancelled' WHERE campaign_id = p_id AND status = 'queued';
    UPDATE public.whatsapp_campaigns SET status = 'cancelled', completed_at = now() WHERE id = p_id;
    INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data)
    VALUES (v_branch, auth.uid(), 'whatsapp_campaign_cancelled', 'whatsapp_campaign', p_id::text, NULL, jsonb_build_object('status', v_old), NULL);
  ELSE
    UPDATE public.whatsapp_campaigns SET status = p_status WHERE id = p_id;
  END IF;
  PERFORM public._wa_campaign_sync(p_id);
  RETURN (SELECT status FROM public.whatsapp_campaigns WHERE id = p_id);
END;
$$;

-- ---------------------------------------------------------------- grants
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'whatsapp_settings_get()', 'whatsapp_settings_save(boolean,boolean,boolean,text)', 'whatsapp_templates_list()',
    'whatsapp_template_save(uuid,text,text,text,boolean)', 'whatsapp_template_delete(uuid)',
    'whatsapp_queue_message(uuid,text,text,text,text,uuid,text,text,jsonb)', 'whatsapp_mark(uuid[],text,text)', 'whatsapp_log_reply(text,text,uuid)',
    'whatsapp_queue_invoice(uuid,text)', 'whatsapp_invoice_link_revoke(uuid)', 'whatsapp_overview(date,date)',
    'whatsapp_activity(date,date,text,text,text,integer,integer)', 'whatsapp_conversations(text,integer)', 'whatsapp_thread(text)',
    'whatsapp_bills(date,date,boolean)', 'whatsapp_due_customers()', 'whatsapp_refill_candidates(integer,integer)',
    'whatsapp_campaign_create(text,text,text,text,text,text,integer,uuid[])', 'whatsapp_campaigns_list(integer)',
    'whatsapp_campaign_queue(uuid)', 'whatsapp_campaign_status(uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.public_invoice(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_invoice(text) TO anon, authenticated;
