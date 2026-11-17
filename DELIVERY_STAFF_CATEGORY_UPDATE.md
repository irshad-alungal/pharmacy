# PALLIKKAL PHARMACY — Delivery role in Staff Management

## Behaviour
- Staff Management now groups account roles into Staff, Delivery and (for Super Admin) Admin categories.
- Selecting Delivery → Delivery Person creates a branch-linked profile using the existing `admin-staff` Edge Function and the `delivery_person` role from migration 0014.
- Delivery accounts use the Delivery ID and temporary password; the first login requires a password change.
- The delivery login page displays in-progress, success and error status messages.
- Successful login routes to `delivery.html`. That page checks the authenticated role before rendering: delivery people receive only their own assigned delivery queue; pharmacy administrators/staff continue to receive the existing management view according to their permissions.
- The delivery-only view calls `delivery_my_jobs` and `delivery_update_status`; the database RPCs enforce branch, account ownership and status transitions.

## Deployment
1. Upload the updated project files to GitHub Pages.
2. Ensure migration `0014_delivery_person_accounts_and_status.sql` has been applied successfully. Do not rerun it if already applied.
3. Ensure the `admin-staff` and `delivery-login` Edge Functions are deployed with the versions included in this project.
4. Create a Delivery Person account in Staff Management and test with its Delivery ID/password at `delivery-boy-login.html`.

## Validation
- `node --check assets/js/staff.js` and `node --check assets/js/delivery.js` pass.
- Live account creation/login, role-based page access, and delivery RPCs must be verified against the user's Supabase project after deployment.
