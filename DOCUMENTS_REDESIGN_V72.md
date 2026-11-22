# Documents Management redesign (version 72)

`documents.html` now follows the attached design, on desktop and mobile. The sidebar, top bar, bell and mobile bottom navigation match the dashboard. The "Your Trusted Healthcare Partner" block is not on the page.

## One thing to run
Run `database/migrations/0032_documents_management.sql` in the Supabase SQL editor. Then check it with `database/diagnostics/verify_0032.sql`; every row should be true. The migration is safe to run twice. No Edge Function change is needed.

Before 0032 is run, the page still opens. The supplier document archive keeps working, and a note asks you to run 0032.

## Existing functions kept (supplier documents)
- **Upload:** choose the **Supplier Documents** category in Upload Document.
  - Fields: distributor, purchase invoice (optional), type (purchase bill, credit note, delivery challan, other), date and notes.
  - Accepted files: PDF, JPG, PNG or WEBP, up to 15 MB.
  - Unassigned uploads are for Admin only, and the invoice must match the distributor.
  - Upload goes through the same bucket (`purchase-documents`) and `register_purchase_document`. If registration fails, the stored file is removed.
- **Search and filters:** search by file, supplier or invoice; a distributor filter appears when the Supplier category is selected; **More → Show removed documents**.
- **Open, download and remove:** for Admin only, as before. Open uses a short-lived signed link. Remove needs a reason, and the stored file is kept.
- **Roles:** Admin and Inventory staff see supplier documents. The rules are unchanged.

## New: pharmacy documents (0032)
- **Categories:**
  - Licenses
  - Registrations
  - Tax & Compliance
  - Agreements
  - Insurance
  - Staff Documents (Admin only)
  - Others
  - Your own categories
- **Fields:** document name (suggested from the file name), reference no., issued by, issue date, expiry date or "No expiry", reminder days, folder and notes.
- **Expiry status:**
  - **Valid**
  - **Expiring Soon:** inside the reminder window. The default is 30 days before expiry, and each document can have its own window.
  - **Expired**
- **Renew:** upload the new certificate with its new dates. It becomes the current version, and the old file stays in **Versions**.
- **Details:** opens with a preview (PDF or image) and these actions:
  - Open, Download, Edit, Renew, Move, WhatsApp share (text details), Remove / Restore.
  - Tabs: Details, Versions, Activity.
- **Folders:** New Folder, then rename or delete. Deleting a folder keeps its documents.
- **Manage Categories:** rename the built-in categories, choose colours, add your own, or hide categories you don't use (only when they are empty).
- **Set Expiry Reminders:**
  - Set the default number of days, with quick picks for 15, 30, 60 or 90.
  - Set days per document.
  - Export the list as CSV or share it on WhatsApp.
- **Download Report:**
  - Choose all documents, the current filter, or expiring and expired only.
  - Formats: CSV (opens in Excel) or Print / Save as PDF on A4.
  - Can also be shared as a WhatsApp expiry list.
- **Bell:** shows how many documents are expired or expiring soon, and links to the filtered list.
- **Activity log (Admin):** records uploads, edits, renewals, moves, removals and restores, plus every view and download.

## The page
- **KPIs:** Total (vs last month), Valid (% of total), Expiring Soon (within the reminder window), Expired (% of total). Clicking a KPI filters the list.
- **Document Categories:** tiles with counts and a dot when something is expiring or expired. Clicking a tile filters the list. **View All Categories** shows the full list.
- **All Documents:**
  - Columns: #, Document Name, Category, Reference No., Issue Date, Expiry Date, Status, Actions (view, download, ⋯).
  - Controls: View (List / Grid), search, All Categories, All Status, All Folders.
  - Clicking a column heading sorts the list.
  - The pager reads "Showing 1 to 8 of N documents".
- **Expiring Documents:** each entry shows the expiry date and a "days" chip; expired documents are shown in red.
- **Quick Actions:** Upload Document, Create New Folder, Manage Categories, Set Expiry Reminders (with a count badge), Download Report.
- **Mobile:**
  - The 3 header buttons sit in one row, and the KPIs are 2 × 2.
  - Category tiles show 5 at a time and swipe for more.
  - Each list row shows the name and reference, category, expiry date, status, view and ⋯.
  - Expiring Documents and Quick Actions sit side by side.

## Roles
| | Admin / Super Admin | Pharmacist | Inventory staff | Billing / Delivery |
|---|---|---|---|---|
| Open the page | ✓ | ✓ | ✓ | – |
| Upload pharmacy documents | ✓ (incl. Staff Documents) | ✓ | ✓ | – |
| View / download pharmacy documents | ✓ | ✓ (not Staff Documents) | ✓ (not Staff Documents) | – |
| Supplier documents | upload, open, remove | – (as before) | upload, list | – |
| Edit, renew, move, remove, folders, categories, reminders | ✓ | – | – | – |

Files are stored in a private `pharmacy-documents` bucket, inside the branch's folder. They are opened only through 5-minute signed links.

## Tests
- `tests/live-replica/live-0032.test.mjs`: 86 checks.
- `tests/e2e/documents_flow.py`: 83 checks.
- The `flows2.py` documents check was updated for the new upload dialog.
