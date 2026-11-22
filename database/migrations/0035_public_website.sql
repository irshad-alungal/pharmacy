-- =============================================================================
-- 0035  Public website (index.html) — content from Settings → Website
-- Run once in the Supabase SQL editor after 0033 (Settings). Safe to run twice.
--
--   pharmacy_settings key 'website' — headline, texts, opening hours, delivery rules, offers,
--   Ayurvedic sister store, map, WhatsApp number, social links, photos and switches.
--   public_site_info()          — everything the home page shows (visitors, no login): pharmacy
--                                 name / address / phone / email / drug licence, open now, hours,
--                                 delivery, current offers, sister store, photos, links.
--   public_medicine_search(q)   — "Is it in stock?" for visitors: name, strength and
--                                 Available / Ask us only (no quantity, no price). Can be switched off.
--   website_settings_get / website_settings_save — Admin and Super Admin.
-- Nothing private is exposed: no stock counts, prices, customers, staff or sales.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._site_defaults()
RETURNS jsonb LANGUAGE sql IMMUTABLE
AS $$ SELECT jsonb_build_object(
  'published', true,
  'headline', 'Your Health. Our Priority.',
  'hero_text', 'Trusted pharmacy care, genuine medicines and everyday health essentials for you and your family.',
  'about_text', 'Pallikkal Pharmacy is a trusted local pharmacy in Thrissur, dedicated to providing genuine medicines, reliable advice and everyday health essentials for you and your family.',
  'whatsapp', '',
  'hours', jsonb_build_array(
     jsonb_build_object('day', 0, 'open', '09:00', 'close', '13:00', 'closed', false),
     jsonb_build_object('day', 1, 'open', '08:00', 'close', '21:00', 'closed', false),
     jsonb_build_object('day', 2, 'open', '08:00', 'close', '21:00', 'closed', false),
     jsonb_build_object('day', 3, 'open', '08:00', 'close', '21:00', 'closed', false),
     jsonb_build_object('day', 4, 'open', '08:00', 'close', '21:00', 'closed', false),
     jsonb_build_object('day', 5, 'open', '08:00', 'close', '21:00', 'closed', false),
     jsonb_build_object('day', 6, 'open', '08:00', 'close', '21:00', 'closed', false)),
  'delivery', jsonb_build_object('enabled', true, 'radius_km', 5, 'min_order', 300, 'note', 'Please call or WhatsApp to confirm delivery to your address.'),
  'offers', '[]'::jsonb,
  'ayurveda', jsonb_build_object('enabled', true, 'name', 'Pallikkal Ayurvedic Store', 'text', 'Traditional Ayurvedic products and wellness essentials for a natural and healthier lifestyle.',
                                 'address', '', 'phone', '', 'email', '', 'website', '', 'map_query', ''),
  'map_query', '',
  'socials', jsonb_build_object('facebook', '', 'instagram', '', 'youtube', ''),
  'images', jsonb_build_object('hero', '', 'about', '', 'ayurveda', '', 'store_main', '', 'store_ayur', ''),
  'stock_check', true,
  'show_drug_licence', true
) $$;

-- Which branch the public site describes: the one whose website settings were saved most recently,
-- otherwise the main branch.
CREATE OR REPLACE FUNCTION public._site_branch()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT s.branch_id FROM public.pharmacy_settings s JOIN public.branches b ON b.id = s.branch_id AND b.is_active
      WHERE s.key = 'website' AND COALESCE((s.value->>'published')::boolean, true) ORDER BY s.updated_at DESC LIMIT 1),
    (SELECT b.id FROM public.branches b WHERE b.is_active ORDER BY (b.code = 'MAIN') DESC, b.name LIMIT 1))
$$;
REVOKE ALL ON FUNCTION public._site_branch() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._site_settings(p_branch uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH d AS (SELECT public._site_defaults() v),
       s AS (SELECT COALESCE((SELECT value FROM public.pharmacy_settings WHERE branch_id = p_branch AND key = 'website'), '{}'::jsonb) v)
  SELECT d.v || s.v
    || jsonb_build_object('delivery', (d.v->'delivery') || COALESCE(s.v->'delivery', '{}'::jsonb),
                          'ayurveda', (d.v->'ayurveda') || COALESCE(s.v->'ayurveda', '{}'::jsonb),
                          'socials', (d.v->'socials') || COALESCE(s.v->'socials', '{}'::jsonb),
                          'images', (d.v->'images') || COALESCE(s.v->'images', '{}'::jsonb))
  FROM d, s
$$;
REVOKE ALL ON FUNCTION public._site_settings(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- public (no login)
DROP FUNCTION IF EXISTS public.public_site_info();
CREATE FUNCTION public.public_site_info()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch uuid := public._site_branch();
  w jsonb; b record; ph record;
  v_now timestamp := now() AT TIME ZONE 'Asia/Kolkata';
  v_dow int := EXTRACT(dow FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int;
  v_today jsonb; v_open boolean := false; v_manual boolean;
BEGIN
  IF v_branch IS NULL THEN RETURN jsonb_build_object('available', false); END IF;
  w := public._site_settings(v_branch);
  SELECT * INTO b FROM public.branches WHERE id = v_branch;
  SELECT * INTO ph FROM public.pharmacies WHERE id = b.pharmacy_id;
  SELECT x INTO v_today FROM jsonb_array_elements(w->'hours') x WHERE (x->>'day')::int = v_dow LIMIT 1;
  IF v_today IS NOT NULL AND NOT COALESCE((v_today->>'closed')::boolean, false) THEN
    v_open := v_now::time >= (v_today->>'open')::time AND v_now::time < (v_today->>'close')::time;
  END IF;
  SELECT is_open INTO v_manual FROM public.branch_shop_status WHERE branch_id = v_branch;
  RETURN jsonb_build_object(
    'available', true,
    'published', COALESCE((w->>'published')::boolean, true),
    'name', COALESCE(ph.name, b.name), 'branch', b.name, 'tagline', ph.tagline, 'logo_path', ph.logo_path,
    'address', b.address, 'city', b.city, 'state', b.state, 'pincode', b.pincode, 'phone', b.phone, 'email', b.email,
    'drug_licence_nos', CASE WHEN COALESCE((w->>'show_drug_licence')::boolean, true) THEN b.drug_licence_nos ELSE '[]'::jsonb END,
    'whatsapp', COALESCE(nullif(w->>'whatsapp', ''), b.phone),
    'today', v_today, 'dow', v_dow, 'now', to_char(v_now, 'HH24:MI'),
    'open_by_hours', v_open,
    -- The counter's Open / Closed switch (Billing) wins when it has been set.
    'shop_open', COALESCE(v_manual, v_open), 'manual_status', v_manual IS NOT NULL,
    'site', (w - 'offers' - 'stock_check')
      || jsonb_build_object('offers', COALESCE((SELECT jsonb_agg(o) FROM jsonb_array_elements(w->'offers') o
                                                 WHERE COALESCE(nullif(o->>'valid_till', ''), '9999-12-31')::date >= v_now::date), '[]'::jsonb),
                            'stock_check', COALESCE((w->>'stock_check')::boolean, true))
  );
END;
$$;

DROP FUNCTION IF EXISTS public.public_medicine_search(text);
CREATE FUNCTION public.public_medicine_search(p_q text)
RETURNS TABLE (name text, strength text, dosage_form text, available boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._site_branch(); v_q text := regexp_replace(trim(COALESCE(p_q, '')), '[%_\\]', '', 'g');
BEGIN
  IF v_branch IS NULL OR length(v_q) < 3 OR length(v_q) > 60 THEN RETURN; END IF;
  IF NOT COALESCE((public._site_settings(v_branch)->>'stock_check')::boolean, true) THEN RETURN; END IF;
  RETURN QUERY
  SELECT m.name, m.strength, m.dosage_form,
         EXISTS (SELECT 1 FROM public.medicine_batches mb WHERE mb.medicine_id = m.id AND mb.branch_id = v_branch AND mb.qty > 0
                 AND mb.expiry > (now() AT TIME ZONE 'Asia/Kolkata')::date AND NOT mb.quarantined AND mb.stock_status = 'active')
  FROM public.medicines m
  WHERE m.branch_id = v_branch AND m.active
    AND (m.name ILIKE '%' || v_q || '%' OR m.generic_name ILIKE '%' || v_q || '%' OR m.brand ILIKE '%' || v_q || '%')
  ORDER BY (m.name ILIKE v_q || '%') DESC, m.name
  LIMIT 8;
END;
$$;

-- ---------------------------------------------------------------- admin
DROP FUNCTION IF EXISTS public.website_settings_get();
CREATE FUNCTION public.website_settings_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public.my_branch_id();
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN
    RAISE EXCEPTION 'Not authorised: only Admin and Super Admin can change the website';
  END IF;
  RETURN public._site_settings(v_branch) || jsonb_build_object('updated_at', (SELECT updated_at FROM public.pharmacy_settings WHERE branch_id = v_branch AND key = 'website'));
END;
$$;

DROP FUNCTION IF EXISTS public.website_settings_save(jsonb);
CREATE FUNCTION public.website_settings_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_branch uuid := public.my_branch_id();
  d jsonb := public._site_defaults();
  v jsonb; x jsonb; k text; v_before jsonb; n int := 0;
  hours jsonb := '[]'::jsonb; offers jsonb := '[]'::jsonb; imgs jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL OR COALESCE(public.my_role(), '') NOT IN ('super_admin','admin') THEN
    RAISE EXCEPTION 'Not authorised: only Admin and Super Admin can change the website';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'Invalid website settings'; END IF;

  -- texts
  IF length(COALESCE(p->>'headline', '')) NOT BETWEEN 3 AND 80 THEN RAISE EXCEPTION 'Headline must be 3 to 80 characters'; END IF;
  IF length(COALESCE(p->>'hero_text', '')) > 300 OR length(COALESCE(p->>'about_text', '')) > 800 THEN RAISE EXCEPTION 'Text is too long'; END IF;
  IF COALESCE(p->>'whatsapp', '') <> '' AND length(regexp_replace(p->>'whatsapp', '\D', '', 'g')) NOT BETWEEN 10 AND 13 THEN RAISE EXCEPTION 'Enter a valid WhatsApp number'; END IF;

  -- hours: 7 days, HH:MM, close after open
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p->'hours', d->'hours')) LOOP
    IF (x->>'day')::int NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'Invalid day'; END IF;
    IF NOT COALESCE((x->>'closed')::boolean, false) THEN
      IF COALESCE(x->>'open', '') !~ '^\d{2}:\d{2}$' OR COALESCE(x->>'close', '') !~ '^\d{2}:\d{2}$' OR (x->>'close')::time <= (x->>'open')::time THEN
        RAISE EXCEPTION 'Opening hours: closing time must be after opening time';
      END IF;
    END IF;
    hours := hours || jsonb_build_array(jsonb_build_object('day', (x->>'day')::int, 'open', COALESCE(x->>'open', '08:00'), 'close', COALESCE(x->>'close', '21:00'),
                                                         'closed', COALESCE((x->>'closed')::boolean, false)));
  END LOOP;
  IF jsonb_array_length(hours) <> 7 THEN RAISE EXCEPTION 'Give opening hours for all 7 days'; END IF;

  -- delivery
  x := COALESCE(p->'delivery', '{}'::jsonb);
  IF COALESCE((x->>'radius_km')::numeric, 5) NOT BETWEEN 0 AND 100 OR COALESCE((x->>'min_order')::numeric, 0) NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'Check the delivery distance and minimum order'; END IF;

  -- offers (max 12)
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p->'offers', '[]'::jsonb)) LOOP
    n := n + 1;
    IF n > 12 THEN RAISE EXCEPTION 'Up to 12 offers'; END IF;
    IF length(COALESCE(x->>'title', '')) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Each offer needs a title (up to 80 characters)'; END IF;
    IF length(COALESCE(x->>'text', '')) > 300 THEN RAISE EXCEPTION 'Offer text is too long'; END IF;
    IF COALESCE(x->>'valid_till', '') <> '' AND x->>'valid_till' !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Offer end date is not a date'; END IF;
    offers := offers || jsonb_build_array(jsonb_build_object('title', trim(x->>'title'), 'text', COALESCE(trim(x->>'text'), ''), 'tag', left(COALESCE(trim(x->>'tag'), ''), 20),
                                                           'valid_till', COALESCE(x->>'valid_till', '')));
  END LOOP;

  -- images: files in this branch's folder of pharmacy-branding (0033)
  FOR k IN SELECT jsonb_object_keys(d->'images') LOOP
    x := to_jsonb(COALESCE(p->'images'->>k, ''));
    IF x #>> '{}' <> '' THEN
      IF split_part(x #>> '{}', '/', 1) <> v_branch::text OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'pharmacy-branding' AND name = x #>> '{}') THEN
        RAISE EXCEPTION 'Photo % was not uploaded for this branch', k;
      END IF;
    END IF;
    imgs := imgs || jsonb_build_object(k, x);
  END LOOP;

  v := jsonb_build_object(
    'published', COALESCE((p->>'published')::boolean, true),
    'headline', trim(p->>'headline'), 'hero_text', COALESCE(trim(p->>'hero_text'), ''), 'about_text', COALESCE(trim(p->>'about_text'), ''),
    'whatsapp', COALESCE(trim(p->>'whatsapp'), ''), 'hours', hours,
    'delivery', jsonb_build_object('enabled', COALESCE((p->'delivery'->>'enabled')::boolean, true), 'radius_km', COALESCE((p->'delivery'->>'radius_km')::numeric, 5),
                                   'min_order', COALESCE((p->'delivery'->>'min_order')::numeric, 0), 'note', left(COALESCE(p->'delivery'->>'note', ''), 200)),
    'offers', offers,
    'ayurveda', jsonb_build_object('enabled', COALESCE((p->'ayurveda'->>'enabled')::boolean, true),
                                   'name', left(COALESCE(nullif(trim(p->'ayurveda'->>'name'), ''), d->'ayurveda'->>'name'), 80),
                                   'text', left(COALESCE(p->'ayurveda'->>'text', ''), 300), 'address', left(COALESCE(p->'ayurveda'->>'address', ''), 200),
                                   'phone', left(COALESCE(p->'ayurveda'->>'phone', ''), 30), 'email', left(COALESCE(p->'ayurveda'->>'email', ''), 120),
                                   'website', left(COALESCE(p->'ayurveda'->>'website', ''), 200), 'map_query', left(COALESCE(p->'ayurveda'->>'map_query', ''), 200)),
    'map_query', left(COALESCE(p->>'map_query', ''), 200),
    'socials', jsonb_build_object('facebook', left(COALESCE(p->'socials'->>'facebook', ''), 200), 'instagram', left(COALESCE(p->'socials'->>'instagram', ''), 200),
                                  'youtube', left(COALESCE(p->'socials'->>'youtube', ''), 200)),
    'images', imgs,
    'stock_check', COALESCE((p->>'stock_check')::boolean, true),
    'show_drug_licence', COALESCE((p->>'show_drug_licence')::boolean, true));
  FOR k IN SELECT unnest(ARRAY['facebook','instagram','youtube']) LOOP
    IF v->'socials'->>k <> '' AND v->'socials'->>k !~* '^https://' THEN RAISE EXCEPTION 'Social links must start with https://'; END IF;
  END LOOP;
  IF v->'ayurveda'->>'website' <> '' AND v->'ayurveda'->>'website' !~* '^https?://' THEN RAISE EXCEPTION 'Website must start with http:// or https://'; END IF;
  IF v->'ayurveda'->>'email' <> '' AND v->'ayurveda'->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Enter a valid email for the Ayurvedic store'; END IF;

  SELECT value INTO v_before FROM public.pharmacy_settings WHERE branch_id = v_branch AND key = 'website';
  INSERT INTO public.pharmacy_settings(branch_id, key, value, updated_by, updated_at) VALUES (v_branch, 'website', v, auth.uid(), now())
  ON CONFLICT (branch_id, key) DO UPDATE SET value = excluded.value, updated_by = auth.uid(), updated_at = now();
  INSERT INTO public.audit_logs(branch_id, user_id, action, entity_type, entity_id, before_data, after_data)
  VALUES (v_branch, auth.uid(), 'settings_saved', 'settings', 'website', v_before, v);
  RETURN public.website_settings_get();
END;
$$;

REVOKE ALL ON FUNCTION public.public_site_info() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_medicine_search(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_site_info(), public.public_medicine_search(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.website_settings_get() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.website_settings_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.website_settings_get(), public.website_settings_save(jsonb) TO authenticated;
