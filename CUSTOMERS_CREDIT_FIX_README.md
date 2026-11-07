# ALZA PHARMACY — Customers page fix

Based on the latest uploaded GitHub project ZIP.

Changes:
- Fixed the blank Customers page by removing the duplicate `branchId` declaration.
- Uses the authenticated profile's `branch_id` from `mountShell`.
- Adds a Credit limit column.
- Adds an admin/super_admin-only Edit limit action using `set_credit_limit`.
- Adds a Credit status action using `customer_outstanding`, showing limit, outstanding and available amount.

No SQL migration is required for this update; it uses the Phase 5 functions already installed.

Important testing note:
The current `customer_outstanding()` function totals credit payment rows only. It does not yet subtract customer receipts because the receipts/settlement workflow has not been implemented. Treat the displayed outstanding as provisional until receipt support is added.
