# PALLIKKAL PHARMACY — Delivery account and login update

## Implemented in this update
- Delivery Management now allows `super_admin` and `admin` to create a delivery-person account with Delivery ID, name, phone and temporary password.
- Delivery accounts use the existing Auth + `profiles` model and the dedicated `delivery_person` role.
- `delivery-boy-login.html` authenticates through the `delivery-login` Edge Function. It validates the active profile, branch assignment and role on the server before issuing a Supabase session.
- Delivery personnel are kept outside the normal pharmacy navigation and cannot use the staff/admin portal through this login.
- First login requires a password change; the shared password page routes delivery users back to the delivery dashboard after updating it.
- Delivery requests, assignments and statuses are stored in `delivery_jobs` and protected RPCs. The rider dashboard only returns jobs assigned to the authenticated delivery user in their branch.
- Existing rider status actions are preserved: **Mark out for delivery** and **Mark delivered**. Changes persist in Supabase and are reflected in Delivery Management after refresh.
- Assignment and status changes write audit-log events.

## Deployment
1. Back up the live Supabase database.
2. Run `database/migrations/0014_delivery_person_accounts_and_status.sql` in Supabase SQL Editor.
3. Deploy the updated `admin-staff` Edge Function.
4. Deploy the new `delivery-login` Edge Function.
5. Confirm `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are configured for Edge Functions (the service-role key must never be placed in frontend code).
6. Upload the updated project files to GitHub Pages.

## Validation notes
- `delivery_management_list`, `delivery_set_request`, `delivery_assign`, `delivery_my_jobs`, `delivery_update_status` and `complete_password_change` are created by migration 0014.
- Direct access to `delivery_jobs` is revoked; the frontend uses SECURITY DEFINER RPCs with branch and role checks.
- Static JavaScript syntax checks are required before deployment. Live Supabase and Edge Function testing must still be completed in the project.
