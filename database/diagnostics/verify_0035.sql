-- Read-only checks after running 0035_public_website.sql. Every row should say true.
SELECT 'website functions installed' AS check_name, (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND p.proname IN ('_site_defaults','_site_branch','_site_settings','public_site_info','public_medicine_search','website_settings_get','website_settings_save')) = 7 AS ok
UNION ALL SELECT 'visitors can read the home page info', has_function_privilege('anon', 'public.public_site_info()', 'EXECUTE')
UNION ALL SELECT 'visitors can use the stock check', has_function_privilege('anon', 'public.public_medicine_search(text)', 'EXECUTE')
UNION ALL SELECT 'visitors cannot change the website', NOT has_function_privilege('anon', 'public.website_settings_save(jsonb)', 'EXECUTE')
UNION ALL SELECT 'internal helpers are private', NOT has_function_privilege('anon', 'public._site_settings(uuid)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public._site_branch()', 'EXECUTE')
UNION ALL SELECT 'still the counter switch for old pages', has_function_privilege('anon', 'public.public_shop_is_open()', 'EXECUTE')
UNION ALL SELECT 'home page info is available', (public.public_site_info()->>'available')::boolean
UNION ALL SELECT 'opening hours for 7 days', jsonb_array_length(public.public_site_info()->'site'->'hours') = 7
UNION ALL SELECT 'stock check hides quantity and price', NOT EXISTS (SELECT 1 FROM information_schema.parameters WHERE specific_schema = 'public' AND specific_name LIKE 'public_medicine_search%' AND parameter_name IN ('qty','mrp','selling_price'));
