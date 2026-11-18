# PALLIKKAL PHARMACY — Delivery Person Login Flow Update

This archive is based on the latest GitHub ZIP supplied in this conversation. It is not based on earlier sample frontend ZIPs.

## Intended flow
1. Create a Delivery Person account from `staff.html` (Role → Delivery → Delivery Person).
2. Delivery person signs in at `delivery-boy-login.html` using Staff ID/Delivery ID and temporary password.
3. First login requires a password change at `change-password.html`; after that the user is sent to `delivery.html`.
4. Later logins start the daily work session and open `delivery.html` directly.

## Files changed
- `delivery-boy-login.html`
  - Starts the daily work session for an existing-password login.
  - Records the daily login marker.
  - Sends first-time users to password change before starting the work session.
- `change-password.html`
  - After successful password change, starts a work session for `delivery_person`, records daily login and redirects to `delivery.html`.
  - Preserves the existing `complete_password_change()` RPC; does not drop or recreate it.
- `assets/js/delivery.js`
  - Validates the delivery user's daily login marker and active work session.
  - Adds activity-based session heartbeat and redirects expired sessions to delivery login.

## Already present in the supplied latest code
- `staff.html` / `assets/js/staff.js` already include a Delivery role group and create accounts through `admin-staff`.
- `supabase/functions/admin-staff/index.ts` already allows `delivery_person`.
- `supabase/functions/delivery-login/index.ts` already verifies Delivery ID, password, active profile and delivery role.
- `delivery.html` loads `assets/js/delivery.js`; the same page branches between management and delivery-person dashboard based on role.

## Supabase deployment required
Deploy these Edge Functions from this archive to the same Supabase project:
- `admin-staff`
- `delivery-login`

The `admin-staff` deployment is needed so staff.html can create the `delivery_person` role account. The `delivery-login` deployment is needed for the dedicated Delivery ID login.

The latest supplied project includes `database/migrations/0014_delivery_person_accounts_and_status.sql`. Do not rerun it blindly if it has already been applied successfully. This frontend update does not require dropping or changing `complete_password_change()`.

## Verification
This is a source-code review and patch, not a live Supabase authentication test. Test with a newly created delivery account after deploying the Edge Functions:
- First login → change password → delivery.html
- Sign out → sign in again → delivery.html
- End/expire the work session → next access should return to delivery-boy-login.html
