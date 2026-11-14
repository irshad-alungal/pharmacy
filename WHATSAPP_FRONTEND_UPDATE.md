# ALZA Pharmacy WhatsApp frontend update

Replaces the previous WhatsApp stub with a branch-scoped customer messaging workspace.

## Frontend features
- Loads active customers for the signed-in user's branch.
- Shows recorded WhatsApp consent and only permits selecting customers whose `consent` field is true.
- Search and select consented customers.
- Message templates: custom, invoice/bill, payment reminder, refill reminder and pharmacy update.
- Supports `{{name}}` and `{{phone}}` placeholders.
- Opens WhatsApp Web/app with a prefilled message for one recipient at a time. Staff must review and press Send in WhatsApp.
- Responsive layout.

## Important limitations
- This is a manual WhatsApp handoff, not automated bulk messaging.
- The existing `supabase/functions/whatsapp-send/index.ts` in the uploaded project is a 501 stub. No Meta WhatsApp Business Cloud API connection, delivery receipts, campaign history, scheduling, opt-out management, or send audit log is implemented.
- Do not put WhatsApp API tokens/secrets in browser JavaScript.
- Invoice number, amount and outstanding balance placeholders are not auto-populated yet; enter those values in the message or implement a secure invoice/payment lookup before enabling those templates for broad use.
- The customer schema's `consent` boolean is used as the consent gate. Confirm the meaning and collection process for this field before sending.
- WhatsApp phone numbers are assumed to be Indian when a 10-digit number is supplied (prefix 91). Other numbers should include their country code.

## Files changed
- `whatsapp.html`
- `assets/js/whatsapp.js`
- `assets/css/whatsapp.css`

No database migration is included or required for this frontend-only manual handoff.
