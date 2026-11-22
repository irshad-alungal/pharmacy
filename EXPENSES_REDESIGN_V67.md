# Expenses Management redesign (version 67)

`expenses.html` now follows the attached design. The sidebar, top bar, bell and mobile bottom navigation match the dashboard, and there is no "Your Trusted Healthcare Partner" block.

**No database change is needed.** The page uses only the expense functions already in Supabase: draft, post, cancel with reversal, receipts, categories and summary. Access is still Admin and Super Admin only.

## Page
- **Header:**
  - **Add Expense**
  - **Export** (Excel)
  - **More:** copy last month's regular expenses, drafts waiting, manage categories, daily / monthly / category reports, CSV, print list, Finance
- **KPIs** (posted expenses; drafts and cancelled are not counted):
  - **Total Expenses (This Month)** vs. last month up to the same day
  - **Expense Transactions**, with drafts waiting
  - **Average Expense**
  - **Expenses (This Year)** vs. the same dates last year
- **Expense Transactions list:**
  - Period: this month, last month, 3 months, this year, last year, 2 years, or any dates.
  - Search by title, category, reference or expense number.
  - Filter by status (Completed = posted, Draft, Cancelled), category, payment method, with / without receipt, minimum amount; sort.
  - Columns: date & time, title (📎 if a receipt is attached), category, amount, payment method (Cash, UPI, Card, Bank Transfer), status, 👁 and ⋯.
- **Expenses by Category:** donut with % and amount, for this month, last month, 3 months or this year. Click a category to list its expenses.
- **Expense Trend:** last 6 or 12 months, last 30 days, or this month.
- **Expense Summary:** This Month, Last Month, This Year, Last Year. Below them:
  - drafts waiting
  - expenses this month without a receipt
  - split by payment method
  - month-end estimate
- **Bell:**
  - drafts not posted
  - big regular expenses not yet recorded this month (rent, salary, electricity, internet)
  - ₹1,000+ expenses without a receipt

## Add / edit expense (popup)
- **Fields:** date, category (**+** adds a new category on the spot), title, amount, payment method (tap Cash / UPI / Card / Bank Transfer), reference no., receipt file, notes.
- **Quick fill:** chips for your recent expenses, e.g. "Shop Rent". One tap fills the title, category, amount and payment.
- **Save draft** or **Save & post:** posting creates the ledger journal, as before.
- **Warnings:** a future date, or the same title, date and amount entered twice.
- **Drafts can be edited.** Posted expenses are corrected by cancelling (reversal journal, reason required) and adding again, as before.

## Expense details and row ⋯ menu
- **View details:** amount, payment and reference, who created / posted / cancelled it and when, notes, receipts (open with a 5-minute private link).
- **Actions:**
  - Post (drafts)
  - Edit draft
  - Take receipt photo / upload a PDF or image (as before)
  - View receipts
  - **Duplicate** (same expense, dated today)
  - **Print payment voucher** (A4, with signature lines)
  - Cancel expense (posted only)

## Copy last month's regular expenses
Lists last month's expenses that are not yet recorded this month, such as rent and salary. Tick them and adjust the amounts if needed; each becomes a **draft** dated today. Check them, then post.

## Manage categories
Add, rename, deactivate or reactivate your branch's categories, with how much has been spent in each. Default shared categories cannot be renamed, as before.

## Tested
- `tests/e2e/expenses_flow.py`: 50 checks against the database. Covers KPIs, list, filters, save & post, draft with receipt, edit, post, cancel with reason, duplicate, category chart, trend, summary, copy last month, categories, reports, export, links, mobile and roles.
- All other suites pass: flows 40, flows2 40, dashboard 47, billing 41, delivery 41, medicines 32, inventory 69, purchases 64, distributors 42, customers 50, sales 56, returns 52; replica 0021–0027; admin click-through.
