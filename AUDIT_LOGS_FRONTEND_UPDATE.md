# Audit Logs frontend update

Updated: `audit-logs.html`, `assets/js/audit-logs.js`, `assets/css/audit-logs.css`.

The page reads `public.audit_logs` fields used by current project migrations: `id, branch_id, user_id, action, entity_type, entity_id, reason, before_data, after_data, at`. Includes read-only table, search, action/date filters, detail modal, client-side pagination and CSV export. Dates display in Asia/Kolkata time.

Access remains controlled by `mountShell`, role permissions and Supabase RLS. Login-history UI is not included because this current repository mentions `login_attempts` but does not define its columns or an authorized listing policy. No SQL migration was added. Verify the live table schema and RLS before deployment.
