# New Purchase popup redesign (version 62)

The **New Purchase** popup now matches the Purchases theme and works like the printed supplier bill. You enter the supplier once at the top, then every medicine on that invoice line by line, and post it as **one purchase**.

No new SQL is needed beyond `0024_purchases_management.sql` from version 61.

## 1 · Supplier & invoice
- Pick the supplier. A card shows its GSTIN, drug licence, phone, address, last bill date and (for admins) the amount payable now.
- **+ New** adds a distributor straight from the bill header (name, phone, GSTIN, DL no., address, contact) and selects it.
- Fields: supplier invoice no., invoice date, payment terms, due date, order no./date, notes.
  - Due date has quick chips: Today, 15, 30, 45 and 60 days.
- **Rates on the bill are:** before GST (trade price), including GST, or set per item.
- You are warned if the same invoice from the same supplier is already posted.

## 2 · Medicine items (one row per bill line)
- **Columns:** # · Medicine · HSN · Pack · Batch · Expiry · Qty · Free · MRP/pack · Rate/pack · Sch ₹ · Disc % · GST % · Taxable · Net.
- **Pack** is the strip size (15'S → 15).
- **Expiry** can be typed as on the bill: `06/28` means 30 Jun 2028. `06-28`, `12/2027`, `30/06/2028` and `2028-06-30` also work. A coloured date under the box confirms it.
- **Sch ₹** (scheme discount) and **Disc %** (cash discount) work exactly like the bill. For example, 2 × 101.23 less 3% = 196.39 taxable, plus 5% GST = 206.21.
- Under each line you see the stock units added, the MRP per unit, and the medicine's GST and master MRP.
- **Enter** jumps to the next box; Enter on the last box adds a new line.
- Other ways to add lines:
  - **Add another medicine** or **+5 lines** for long bills.
  - **⧉** repeats a line for a second batch of the same medicine.
  - **Import Excel** reads bill-style columns (Pack 15'S, Trade Price, Sch Disc, Disc %, Exp 06/28) and has a new template.
- An unknown medicine turns red and offers **+ Create**.
- The footer row shows total qty, free, taxable and net.

## 3 · GST & bill total
- A GST-wise summary (5 / 12 / 18 / 28%) shows taxable value, CGST, SGST and total GST, as printed on bills.
- Bill discount, freight and round off. **Auto** rounds the net amount to the nearest rupee.
- **Net amount on bill:** type the bill's net amount and it shows ✓ when it matches, or the difference when it doesn't.
- The bill total shows gross, scheme + cash discount, taxable, CGST, SGST, GST, bill discount, freight, round off and net amount.

## 4 · Payment · 5 · Bill copy
- **Payment (admins):** amount, a **Full** button, cash/UPI and a reference.
- **Bill copy:** upload a PDF or images, or take a photo.

A sticky footer always shows the item count, stock units and net amount, with Save draft, Delete draft and **Review & confirm stock-in**. The confirmation screen lists every line with batch, expiry, qty + free, stock added and net.

Drafts keep the scheme ₹, disc % and expiry of every line.

## Also fixed
Form boxes showed dark green when the computer was in dark mode. Branded pages now always use the light theme.

## Tested
- `tests/e2e/purchases_flow.py` now has 64 checks. The new ones cover:
  - the new-distributor form;
  - the line maths against the sample bill;
  - expiry parsing;
  - Enter adding a new line, duplicate line;
  - the GST summary, auto round-off and the printed-total cross-check;
  - drafts;
  - posting a 4-line bill and checking it in the database.
- All other suites pass: flows 40, flows2 40, dashboard 47, billing 41, delivery 41, medicines 32, inventory 69.
