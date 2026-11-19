# PALLIKKAL MEDICALS — Version 53: complete backend + live fixes

Version 53 completes every page. It was built and tested against a replica of your **live** database: the structure export from `database/diagnostics/full_live_schema_export.sql`, run on 19 Nov 2026.

## Step 1 — Database (already done)
`database/migrations/0021_complete_backend_and_live_fixes.sql` ran successfully on your live Supabase project on 19 Nov 2026.

To confirm everything is installed, run `database/diagnostics/verify_0021.sql`. It is read-only, and every row should show `ok = true`.

Do **not** run 0011, 0012 or 0013 separately. They are included in 0021.

## Step 2 — Upload the website
Replace the whole project in GitHub with this ZIP, then hard-refresh the browser (Ctrl+Shift+R). The new pages need 0021, which is now installed.

## Step 3 — Optional
- **Edge Function `admin-staff`:** redeploy it (`supabase functions deploy admin-staff`). Staff-ID validation now matches the database rule: 3–32 characters; letters, numbers, `.`, `_`, `-`.
- **AI billing assistant:** `supabase secrets set ANTHROPIC_API_KEY=...`, then `supabase functions deploy billing-assistant`.

---

## Bugs found in the live database (now fixed by 0021)
| Problem | Effect | Fix |
|---|---|---|
| Opening stock and physical-count increases never created FIFO cost layers. | Billing that stock failed with "Insufficient FIFO cost-layer stock". | Cost layers are now created automatically. Missing layers for existing stock were back-filled. |
| 14 functions and 3 storage rules accepted only the retired `inventory` role, not `inventory_staff`. This includes `confirm_purchase`, `adjust_stock`, `physical_count`, `post_journal`, `low_stock`, medicine images and purchase documents. | Inventory staff got "Not authorised" on purchases, adjustments, counts, photos and bill uploads. | Role lists widened. Labels such as audit `entity_type 'inventory'` were left untouched. |
| The held-bill rule accepted `billing`, not `billing_staff`. | Billing staff could not hold bills. | Fixed. |
| Migrations 0011 (Initial Stock Excel), 0012 (distributor logos) and 0013 (doctor's sheets) were never applied. | Those three features failed. | Included and installed. |
| The 13 `report_*` functions and `ist_today` did not exist. | Every report failed. | Written for your live tables, with FIFO cost of goods sold. |
| `invoice_detail` worked out GST as if every price included tax. | Wrong GST summary for "GST extra" medicines. | Uses the stored taxable and GST amounts. |
| The `sales.gst_edit`, `sales.mrp_edit` and `sales.batch_override` permission codes were missing. | Permissions could not be assigned. | Added. |

## Website changes
- **Purchases (rebuilt):**
  - Save, continue and delete drafts.
  - Pack factor and free quantity (free goods carry zero cost).
  - Batch MRP and GST taken from the bill.
  - Due date, order number and round-off.
  - Optional supplier payment (admins).
  - Bill files uploaded and linked on posting.
  - Duplicate-invoice warning.
  - "+ Create" a missing medicine from a bill row.
  - Full purchase view with lines, payments and documents (costs shown to admins only).
- **Reports:** all 13 reports run, with PDF and Excel export.
- **Audit Logs (new page):** activity trail with filters, detail view, sign-in history and CSV export.
- **Billing:** doctor, patient, phone, address and diagnosis are saved on the bill, kept in held bills and printed on the invoice.
- **Invoice:** shows patient and doctor, discount % per line, savings, and "GST" vs "GST included" correctly.
- **Inventory:**
  - New "Block / recall" button. Billing never allocates a blocked or recalled batch.
  - Adjust buttons are shown only to roles that may use them.
  - Initial Stock now works even if the Excel library fails to load.
  - Import of new medicine names fixed: it was writing a protected column.
- **WhatsApp:** "Start sending" opens each selected customer's chat in turn with the message filled in. `{{name}}` is personalised. The chosen interval is enforced between chats, and photos can be copied. Staff still press Send in WhatsApp. Fully automatic sending needs a Meta WhatsApp Business Cloud API account.
- **Page access by role:**
  - pharmacist: billing, delivery, medicines, inventory, purchases, distributors, customers, sales, returns, documents.
  - billing_staff: billing, delivery, medicines, inventory, customers, sales, returns.
  - inventory_staff: medicines, inventory, purchases, distributors, documents.
  - Admins: everything.
  - After login, each role opens on its first allowed page.
- **Documents:** pharmacists and inventory staff can upload and view supplier documents.

## Tests (all passing)
- `tests/live-replica/live-0021.test.mjs`: 63 database checks on the live-structure replica.
- `tests/billing-engine.test.mjs`: 25 billing calculation checks.
- `tests/e2e/`: the real pages run in Chrome against the replica as each role.
  - `flows.py` + `flows2.py`: 80 workflow checks.
  - `monkey.py`: clicks every button on every page for every role.

## Still needs your input
- The public home page (`index.html`) still shows demo phone, email and address. Send the real details.
- Automatic WhatsApp sending needs a Meta WhatsApp Business Cloud API account.
- Automatic reading of purchase-bill photos (OCR) is not built.
