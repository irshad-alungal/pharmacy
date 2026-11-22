# Settings redesign (version 73)

`settings.html` now follows the attached design, on desktop and mobile. The sidebar, top bar, bell and mobile bottom navigation match the dashboard, and the "Your Trusted Healthcare Partner" block is not on the page. Only Admin and Super Admin can open it, as before.

## Run once
1. In the Supabase SQL editor, run `database/migrations/0033_settings_management.sql`. It is safe to run twice.
2. Check it with `database/diagnostics/verify_0033.sql`. Every row should be true.
3. Upload `version.json` together with the site files. **Check for Updates** reads it.

Before 0033 is run, the page still opens. Pharmacy details and the master lists keep working, and a note asks you to run 0033.

## Existing functions kept
- **Pharmacy details** (Business Information):
  - Name, address, city, state, PIN, phone, email, GSTIN, drug licence numbers.
  - Saved through `get_branch_profile` / `save_branch_profile`.
  - New checks: GSTIN format, 6-digit PIN, email.
- **Invoice prefix and footer:** now under Print & Invoice. They are saved on the branch, as before.
- **Master lists** (System Preferences):
  - Categories, manufacturers, storage locations and units (with code).
  - Add, activate / deactivate.
  - New: rename, search, duplicate check.
- **Unit conversions:** add and remove.

## Sections
| Section | What it does |
|---|---|
| General Settings | Language (English), date format, time format, currency (₹) and 4 switches: low stock alerts, expiry alerts, daily auto backup, logo on invoice. Also Quick Configuration, System Information (version, licence, database size, last backup, Backup Now) and Support & Help (user guide, contact support, check for updates). |
| Business Information | Pharmacy details, plus logo (PNG/JPG/WEBP up to 1 MB) and tagline. |
| Users & Permissions | Login counts, roles, a matrix of what each role can do, and the staff list with last login. Links to Add Staff, Assign Roles, Change My Password and Audit Logs. |
| Billing & Subscription | Billing rules enforced by the server (maximum discount, stock reservation minutes, near-expiry warning), plus plan and licence with days left. |
| Notifications | Low stock and expiry alerts, the expiry alert window, delivery / expense-draft / deactivation alerts, the backup reminder, and the document reminder default from 0032. |
| Print & Invoice | Prefix, default paper (Thermal 80 mm or A4), footer and terms, and which items to show: logo, GSTIN, drug licence, patient and doctor, UPI line, signature line. Includes a **live preview**. |
| Payment Methods | Turn Cash, Card, UPI, Wallet, Credit and Split on or off, choose the default, and set the UPI ID and name (with a copyable UPI link). |
| WhatsApp Integration | Prepare the invoice after each bill, open WhatsApp after the bill, add offer links, and the message signature. Free one-tap mode. |
| Backup & Data | Backup Now (optionally including audit logs), daily auto backup, backup reminder, stored data counts, database size, files per storage bucket, backup history, and **Restore** from a file. |
| Integrations | Live status of the Supabase database, the staff login service, WhatsApp, the customer invoice link and file storage. |
| System Preferences | The master lists and unit conversions described above. |
| About & License | Version and build, licence (Super Admin only), support contact, and what's new. |

**Reset to Default** sets the open section back to its default values; on Business Information it is **Undo Changes**. **Save Changes** saves only the open section. If you leave a section with unsaved changes, the page asks first.

The top search box also finds Settings sections, for example "upi" or "backup".

## Other pages that now follow these settings
- **Invoices** (print, PDF and the preview in Sales, Billing, Delivery and Customers):
  - Date and time format, default paper, logo.
  - Show or hide GSTIN, drug licence, and patient and doctor lines.
  - Terms, UPI line and signature line.
- **Billing screen:** only shows the payment methods that are switched on, and starts each bill with the default method.
- **Dashboard bell:**
  - Low stock and expiry alerts follow the switches, and the expiry window follows Notifications.
  - Delivery, expense-draft and deactivation alerts can be switched off.
  - Backup reminder.
- **Auto Backup (Daily):**
  - The first Dashboard visit of the day by an Admin downloads a backup file to that computer.
  - It is skipped if a backup was already taken that day.

## Backups
- **What a backup contains:** one JSON file with every record of this branch (bills, stock, purchases, customers, accounts, staff details, settings) plus the shared lists. Uploaded files are not inside it.
- **Where to keep it:** keep backup files outside the computer, for example on a pen drive or in Google Drive.
- **What Restore brings back:** settings, pharmacy details, master lists and expense categories. It only adds or replaces these; nothing is deleted.
- **What Restore never touches:** bills, stock and accounts are never overwritten from a file. Restoring the whole database is done from the Supabase dashboard.

## What is honest about these settings
- **Language:** only English is available. Malayalam and Hindi are listed as "coming soon".
- **Currency:** only Indian Rupee is available.
- **Date and time formats:** used on invoices, PDFs and in Settings. Other pages keep their own display format.
- **Licence:** the details are informational, edited by Super Admin. No licence server is contacted and no payment is taken.
- **Logo:** not drawn in the PDF download, which is text-only. It does show on printed and previewed invoices.
- **Auto backup:** works in the browser. It runs when an Admin opens the Dashboard; nothing runs while all computers are off.

## Tests
- `tests/live-replica/live-0033.test.mjs`: 54 checks.
- `tests/e2e/settings_flow.py`: 86 checks.
- The `flows2.py` settings check was updated for the new layout.
