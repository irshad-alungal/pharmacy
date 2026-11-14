# ALZA Pharmacy - WhatsApp Bulk Campaign Frontend

This update adds a branch-scoped promotional campaign preparation interface to `whatsapp.html`.

## Included
- Loads customers for the signed-in user's branch.
- Selects only active customers with `consent = true` and a valid-looking phone number.
- Search, select all eligible, clear selection and recipient count.
- Promotional message editor (1024 character UI limit).
- Optional JPG/PNG/WEBP photo selection (5 MB UI limit) with local preview.
- Adjustable interval (30 seconds to 60 minutes; default 120 seconds).
- Estimated interval from first to last scheduled send.
- Campaign preview and preparation summary.

## Important limitation
This is frontend-only. The existing `whatsapp-send` Supabase Edge Function in this project is a 501 stub. The Prepare campaign button intentionally does not send messages or create a false delivery status. Actual background bulk delivery requires a configured WhatsApp Business Platform/Cloud API, approved marketing template where required, secure server-side queue, scheduler/worker, webhook status updates, and opt-out/suppression handling.

No database migrations or live records are changed by this update. The frontend checks the existing `customers` fields `id`, `name`, `phone`, `consent`, `active`, and `branch_id`.
