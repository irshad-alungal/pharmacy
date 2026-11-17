# PALLIKKAL PHARMACY — Delivery workflow update

## Delivery Management
- Only final bills explicitly marked as delivery requested enter the default queue.
- Staff/admin can review final bills, mark/remove delivery requests and assign requests to an active delivery-person account.
- Delivery requests, assignments and status are stored in Supabase, scoped to the authenticated branch.
- Admin and Super Admin can create delivery-person accounts from Staff Management (Role → Delivery → Delivery Person) and Delivery Management.

## Delivery-person access
- Delivery personnel sign in through `delivery-boy-login.html` using their Delivery ID and password, then land on `delivery.html`.
- The `delivery-login` Edge Function validates the active profile, branch and `delivery_person` role before issuing an Auth session.
- `delivery.html` renders a role-restricted delivery view for delivery-person accounts; only assigned jobs are visible. Admin/staff continue to see the existing Delivery Management screen.
- Status actions are persisted: **Mark out for delivery** then **Mark delivered**. The database enforces the allowed sequence and records audit events.
- Delivery personnel do not receive the normal pharmacy navigation or access to finance/admin pages.

## Backend requirements
Apply `database/migrations/0014_delivery_person_accounts_and_status.sql`, deploy the updated `admin-staff` Edge Function and deploy the new `delivery-login` Edge Function. See `DELIVERY_ACCOUNT_AND_LOGIN_UPDATE.md` for deployment and verification steps.
