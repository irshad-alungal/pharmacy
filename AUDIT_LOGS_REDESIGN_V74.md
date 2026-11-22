# Audit Logs redesign (version 74)

`audit-logs.html` now follows the attached design on desktop and mobile. The sidebar, top bar, bell and mobile bottom navigation match the dashboard, and the "Your Trusted Healthcare Partner" block is gone. Access is unchanged: Admin and Super Admin (permission `audit.view`); failed sign-in attempts need `security.view`.

## Run once
1. Run `database/migrations/0034_audit_logs.sql` in the Supabase SQL editor. It is safe to run twice.
2. Check it with `database/diagnostics/verify_0034.sql`. Every row should be true.

Before 0034 is run, the page still opens. The activity list and the CSV export work straight from the audit table, sign-in history works, and a note asks you to run 0034.

## Existing functions kept
- **Activity trail:** read-only; entries can never be edited or deleted.
- **Search, filter and paging:** search the activity, filter by type of action (now "All Actions") and by date range (now a period menu with a custom range), and page through the results.
- **Entry details:** before / after values for each entry. They are now shown as a table with the changed fields highlighted, plus the raw entry.
- **CSV export:** now includes the IP address, module and critical flag.
- **Sign-in history** (`login_attempts`): now under Login History → Sign-in attempts.

## What's on the page
- **Period:** Today, Yesterday, Last 7 / 30 / 90 Days, This Month, All Time, or a custom range.
- **KPIs:**
  - **Total Activities**, compared with the previous period of the same length.
  - **Active Users:** people who did something in the period.
  - **Critical Actions:** count and % of all activity.
  - **Login Events:** logins and logouts, plus failed sign-ins.
  - Clicking a KPI filters the list or opens the matching report.
- **Activity Logs list:**
  - Columns: #, Date & Time, User, Action, Module, Details, IP Address.
  - Action types: Created, Updated, Deleted, Exported, Login, Logout.
  - Search, plus All Users / All Modules / All Actions filters and Clear.
  - Pages show "Showing 1 to 10 of N activities".
  - Logins and logouts appear in the same list; the logout row says why the person was logged out (idle, signed in elsewhere, by an administrator).
- **Entry details:**
  - When, user and staff ID, IP address, action code, record and reason.
  - Changes shown before → after, with the changed fields highlighted.
  - Buttons: open the record (bill, return, medicine, page), "More from this user", copy.
- **Activity by Module:** a donut chart. Click a module to filter the list.
- **Recent Critical Actions**, with View All (critical actions only).
- **Quick Actions:**
  - **Export Audit Logs:** CSV (Excel), Print / PDF, user activity CSV, login history CSV. Every export is itself recorded in the audit log.
  - **View Login History:** sessions with login, logout, duration and IP; sign-in attempts including failed ones; an "Unknown ID" flag for IDs that are not your staff.
  - **User Activity Report:** for each person, totals of created, updated, deleted, critical and logins, plus their most used module and last activity.
  - **Audit Log Settings:** default period, rows per page, bell alert for critical actions, bell alert for failed sign-ins.
- **List / Timeline:** switch between the two views (on mobile, from the View selector), and the top search box filters the activity list.
- **Bell:** critical actions in the last 2 days and failed sign-ins today.
- **Mobile:**
  - The 3 header buttons sit in one row, and the KPIs are 2 × 2.
  - Each list row shows an icon, the title, "user • module • time", and an action chip.
  - The module chart and Recent Critical Actions sit side by side, with 4 quick actions in a row below.

## Which actions count as critical
- Deletions, removals, cancellations, reversals and deactivations.
- Price, MRP and line overrides; role, status, permission and password changes.
- Settings, branding and pharmacy-profile changes; restored backups.
- Stock status changes, quarantines and edits to opening stock.

## IP address
- **New entries:** from now on, new audit entries and logins store the caller's IP address. Supabase sends it with every request (the X-Forwarded-For header).
- **Older entries:** entries made before 0034 have no IP, so they show "—".

## Tests
- `tests/live-replica/live-0034.test.mjs`: 36 checks.
- `tests/e2e/audit_flow.py`: 54 checks.
- The `flows.py` audit check was updated for the new layout.
