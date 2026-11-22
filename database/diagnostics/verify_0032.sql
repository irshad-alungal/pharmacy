-- Read-only checks after running 0032_documents_management.sql. Every row should say true.
SELECT 'document tables' AS check_name, (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'
   AND table_name IN ('pharmacy_documents','pharmacy_doc_folders','pharmacy_doc_categories','pharmacy_doc_settings')) = 4 AS ok
UNION ALL SELECT 'document functions installed', (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
   AND p.proname IN ('documents_overview','documents_list','document_categories','document_versions','document_activity','document_register','document_update',
     'document_renew','document_remove','document_restore','document_move','document_folder_save','document_folder_delete','document_category_save',
     'document_settings_save','document_reminders_save','document_log_access')) = 17
UNION ALL SELECT 'tables only through the functions', NOT has_table_privilege('authenticated', 'public.pharmacy_documents', 'SELECT')
UNION ALL SELECT 'anon cannot read documents', NOT has_function_privilege('anon', 'public.documents_overview()', 'EXECUTE')
UNION ALL SELECT 'pharmacy-documents bucket is private', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'pharmacy-documents' AND NOT public)
UNION ALL SELECT 'storage policies (insert / select / cleanup)', (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
   AND policyname IN ('pharmacy_docs_insert','pharmacy_docs_select','pharmacy_docs_cleanup')) = 3
UNION ALL SELECT 'supplier documents unchanged', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'register_purchase_document') AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'purchase_document_list');
