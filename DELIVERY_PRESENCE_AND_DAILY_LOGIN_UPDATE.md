# PALLIKKAL PHARMACY — Delivery availability and daily login update

## Included frontend changes
- `delivery.html` remains role-aware: management page for authorised pharmacy staff/admin; My Deliveries page for `delivery_person`.
- Delivery-person dashboard has three availability buttons: Delivery Available (green), Purchasing (blue), Offline (red).
- Manual status selection is saved to Supabase.
- Manual delivery-person sign-out sets their presence to Offline and closes the work session.
- Billing reads branch-level delivery availability and displays the corresponding colored status.
- Removed frontend inactivity heartbeats and five-minute idle logout behavior.
- Protected staff/admin and delivery pages still require a valid daily login when opened on a new India Standard Time date.

## Required Supabase SQL
Run `database/migrations/0015_delivery_presence_daily_session_policy.sql` in the Supabase SQL Editor after migration 0014. This:
- removes inactivity as a work-session expiry condition;
- keeps the active work session tied to the current IST date;
- adds branch-scoped delivery-person presence storage and secure RPC functions.

Do not drop or recreate `complete_password_change()`.

## Existing Edge Functions
No new Edge Function is required for these three presence buttons. They use authenticated Supabase RPC functions created by migration 0015.
The existing `delivery-login` and `admin-staff` Edge Functions remain as previously deployed.

## Status aggregation shown in Billing
- Green `Delivery Available` if at least one active delivery person selected Available.
- Blue `Purchasing` if none selected Available and at least one selected Purchasing.
- Red `Offline` if all active delivery people are Offline, or no active delivery accounts exist.
Counts are shown below the status.

## Validation
The modified JavaScript files were syntax-checked with Node.js. Live Supabase behavior cannot be verified from this local archive; run migration 0015 before testing the new controls.
