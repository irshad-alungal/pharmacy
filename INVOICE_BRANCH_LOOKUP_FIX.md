# Invoice branch profile lookup fix

The invoice preview no longer assumes the active profile's branch id is the same as the invoice branch id, and uses `maybeSingle()` rather than `.single()` so an unavailable branch profile does not prevent invoice preview.

If branch data is not visible, invoice transaction details still preview and a warning appears. Check branch-table SELECT RLS and the branch id used by Settings to make pharmacy contact details appear. No database schema, sales, stock, or payment records are changed.
