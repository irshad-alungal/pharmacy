# WhatsApp Management redesign (version 70)

`whatsapp.html` now follows the attached design, desktop and mobile. The sidebar, top bar, bell and mobile bottom navigation match the dashboard, and there is no "Your Trusted Healthcare Partner" block. The page is for Admin and Super Admin. Billing staff and pharmacists send invoices from Billing.

## How sending works (free, ₹0)
- **Messages are prepared by the app.** Invoices, order updates, payment and refill reminders, and campaign messages are written from templates and saved in the database.
- **Staff send with one tap.** *Send on WhatsApp* opens WhatsApp (the app, or WhatsApp Web on a PC) with the customer and the text already filled in. Staff press **Send** in WhatsApp, and the message is marked **Sent** here.
- **No paid service is used.**
  - The official WhatsApp Business API is not used: since 1 Oct 2026 Meta charges for every message a business sends through it.
  - Unofficial "WhatsApp Web robots" are not used either: they can get the shop's number banned.
  - Google Apps Script is not needed.
- **The official API can be added later without changing the screens.**

## Invoice after every bill (automatic)
1. When Billing finalises a bill for a customer (or a walk-in with a patient phone), the invoice message is prepared, and **WhatsApp opens straight away**. The counter only presses Send.
2. The message has a **private link** to `invoice-view.html`:
   - The customer can view the invoice, **download it as a PDF** or print it.
   - No login is needed, and it works on any phone.
   - Each link uses a random code, works for 180 days, and can be withdrawn.
   - The page never shows diagnosis, doctor or address, and the phone number is masked.
3. The invoice window in Billing and in Sales has a **Send on WhatsApp** button, for sending again or later.
4. Settings (More → WhatsApp settings):
   - Turn the automatic invoice on or off.
   - Choose whether WhatsApp opens at once or the message waits in **Waiting to send**.
5. Bills where nothing was sent appear in **More → Bills not shared yet**, and on the bell.

## The page
- **KPIs:**
  - **Messages Sent** this month vs last month.
  - **Invoices Shared**, as a percentage of bills that have a phone.
  - **Waiting to Send**: invoices waiting and the oldest one.
  - **Active Customers** vs last month.
  - Clicking a KPI opens its list.
- **Quick Actions:**
  - **Send Order Update** (invoice / confirmed / out for delivery / delivered, for the last 14 days of bills).
  - **Payment Reminder**: customers with dues, the amount filled in, last reminder date; one at a time or the selected ones one after another.
  - **Refill Reminder**: customers whose medicine bought about 30 days ago is due. The period can be changed, and each reminder is remembered per medicine.
  - **Health Campaign** and **Custom Message**.
- **Recent Conversations:**
  - Search by name or number. Shows how many messages are waiting, and ticks.
  - The conversation window shows every message to and from the customer.
  - From it you can send now, write a reply, or **log the customer's reply**.
- **WhatsApp Campaigns:** status (Active / Paused / Completed / Cancelled) and the Sent count.
  - View All has continue, pause, cancel, the recipients list, and *Send again (copy)*.
- **Message Templates:**
  - 8 ready-made templates (invoice, order confirmation, delivery update, delivered, payment reminder, refill reminder, offer, health tip) and your own.
  - Placeholders: `{{name}}`, `{{shop}}`, `{{order_no}}`, `{{amount}}`, `{{date}}`, `{{link}}`, `{{due}}`, `{{medicine_name}}`, `{{photo}}`.
  - Live preview. A ready-made template can be reset to its original text.
- **Recent WhatsApp Activity:**
  - Filter by period, type and status; search; 10 per page.
  - Row menu: send now or again, conversation, invoice link, copy, mark sent, skip, put back in the waiting list.
  - CSV export.
- **More menu:** waiting to send (and "send all one by one"), bills not shared, campaigns, templates, conversations, export, settings, *How sending works*.

## Bulk messages with text and photo (your existing feature, now working)
Everything from the old page is kept:
- consent-only recipients
- search, select all, clear
- message up to 1024 characters
- photo (JPG / PNG / WEBP, up to 5 MB) with preview
- interval from 30 s to 60 min, with a duration estimate
- campaign summary and reset

What is new:
- **The campaign is saved.** The photo is uploaded, and every message is personalised and logged.
- **The sender opens one chat at a time** and enforces the interval, which keeps the number safe from WhatsApp spam limits. It has *Copy photo* (paste with Ctrl + V), *Share photo* on phones, Skip, and **Pause**.
- **A paused campaign can be continued later from any device.** Cancel skips the rest.
- **The photo link is added to the text**, so customers can open the photo even if it was not pasted.

## Run once in Supabase
**`database/migrations/0030_whatsapp_management.sql`**, then check it with `database/diagnostics/verify_0030.sql` (every row should be true). It is safe to run twice.

Before 0030 is run, the page still opens and messages can still be sent in WhatsApp, but nothing is recorded, and a note asks you to run 0030.

## Tested
- `tests/live-replica/live-0030.test.mjs`: 48 checks.
  - Invoice link and message, no duplicates, walk-in with a patient phone.
  - The public page as anon: masked phone, no medical details, views counted, revoke.
  - Queue, mark, put back; replies and conversations.
  - Campaigns: consent only, personalised, photo link, complete, pause, cancel.
  - Templates, settings and signature, dues, refills, roles, privacy.
- `tests/e2e/whatsapp_flow.py`: 80 checks.
  - Billing opens WhatsApp with the invoice link; walk-in without a phone; "open after bill" off; automatic invoice off.
  - The customer's invoice page.
  - Every KPI and card; thread and logged reply; new message and the consent rule; waiting list; order update; bills not shared.
  - Payment and refill reminders; a campaign with a photo (upload, interval, skip, pause, continue, cancel).
  - Templates, settings, activity filters and row menu, CSV, deep link, mobile layout, roles, and the page without 0030.
- All other suites pass:
  - flows 45, flows2 40 (WhatsApp part updated), dashboard 47, billing 41, delivery 41, medicines 32, inventory 69, purchases 64
  - distributors 42, customers 50, sales 56, returns 52, expenses 50, finance 50, reports 62
  - replica 0021–0030; admin click-through.
