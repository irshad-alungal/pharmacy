-- Read-only checks after running 0030_whatsapp_management.sql. Every row should say true.
SELECT 'whatsapp tables' AS check_name, (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
   AND table_name IN ('whatsapp_settings','whatsapp_templates','whatsapp_campaigns','whatsapp_messages','invoice_share_links')) = 5 AS ok
UNION ALL SELECT 'whatsapp functions installed', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND p.proname IN ('whatsapp_settings_get','whatsapp_settings_save','whatsapp_templates_list','whatsapp_template_save','whatsapp_template_delete',
     'whatsapp_queue_message','whatsapp_mark','whatsapp_log_reply','whatsapp_queue_invoice','whatsapp_invoice_link_revoke','whatsapp_overview',
     'whatsapp_activity','whatsapp_conversations','whatsapp_thread','whatsapp_bills','whatsapp_due_customers','whatsapp_refill_candidates',
     'whatsapp_campaign_create','whatsapp_campaigns_list','whatsapp_campaign_queue','whatsapp_campaign_status','public_invoice')) = 22
UNION ALL SELECT 'ready-made templates for every branch', NOT EXISTS (SELECT 1 FROM public.branches b WHERE (SELECT count(*) FROM public.whatsapp_templates t WHERE t.branch_id = b.id AND t.is_system) < 8)
UNION ALL SELECT 'customer invoice page works without login (anon)', has_function_privilege('anon', 'public.public_invoice(text)', 'EXECUTE')
UNION ALL SELECT 'anon cannot read anything else', NOT has_function_privilege('anon', 'public.whatsapp_overview(date,date)', 'EXECUTE') AND NOT has_table_privilege('anon', 'public.invoice_share_links', 'SELECT')
UNION ALL SELECT 'tables only through the functions', NOT has_table_privilege('authenticated', 'public.whatsapp_messages', 'SELECT')
UNION ALL SELECT 'offer photo bucket (public)', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'whatsapp-media' AND public);
