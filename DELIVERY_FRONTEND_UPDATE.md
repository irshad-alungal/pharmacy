# ALZA Pharmacy — Delivery Frontend Update

## Requested-delivery workflow
- The default Delivery queue shows only invoices marked as delivery requested in the current frontend session.
- Use **All final bills** to find a bill and open **View**.
- In View, choose **Mark delivery requested** when the customer asks for delivery. Remove the request if the customer changes their mind.
- A requested bill displays an **Assign** button. Assign a delivery person by entering their name and optional phone number.
- Summary cards count only requested bills.

## Important persistence limitation
The current uploaded project does not contain a delivery request, assignment, rider, or delivery-status table/RPC. Request flags and assignments are therefore frontend preview state and reset on refresh. This update does not change invoices, stock, or database records. A branch-scoped database migration and server-side RPCs are required to persist requests and assignments safely.

## Validation
Run `node --check assets/js/delivery.js`. Browser and live Supabase testing remain necessary.
