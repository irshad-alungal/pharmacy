# Staff Management redesign (version 71)

`staff.html` now follows the attached design, desktop and mobile. The sidebar, top bar, bell and mobile bottom navigation match the dashboard, and there is no "Your Trusted Healthcare Partner" block. Access is Admin and Super Admin only, as before.

## Two things to run once
1. **Supabase SQL editor:** `database/migrations/0031_staff_management.sql`, then check it with `database/diagnostics/verify_0031.sql` (every row should be true). It is safe to run twice.
2. **Edge Function:** `supabase functions deploy admin-staff`.
   - The updated function saves designation, join date and address when a login is created, returns the new id, and logs the event.
   - It adds **Reset password**.
   - Listing and creating logins work exactly as before.

Before 0031 is run, the page still opens: the staff list comes from the login service, and a note asks you to run 0031.

## Existing functions kept
- **Create a login:**
  - Staff ID, full name, phone, role (Admin only for Super Admin), address, photo, temporary password of at least 12 characters.
  - Staff must change the password at first login.
- **List, search, refresh.**
- **Profile** with Call and WhatsApp.
- **Address and photo are now really saved.** Previously they were only previewed.
  - Photos go to a private `staff-photos` bucket.

## The page
- **Header:** Add Staff, Import (CSV), Export, More.
- **KPIs:**
  - **Total Staff** vs last month.
  - **Active Staff** (% of total).
  - **Today's Attendance** (% present, and how many are not marked yet).
  - **On Leave** (and leave requests waiting).
  - Clicking a KPI filters the list or opens attendance / leaves.
- **Staff Members table:**
  - Columns: Emp. ID, Name with photo, Role (designation), Phone (tap to call), Join Date, Status, edit ✎ and a ⋯ menu.
  - ⋯ menu: view, edit, attendance, leave, change role, reset password, call, WhatsApp, deactivate / activate.
  - Search, role filter, status filter (active / inactive / on leave today / absent or not marked / password change pending).
  - 5 per page, or View All Staff.
- **Staff Distribution:** donut by designation. Click a role to filter the list.
- **Attendance Trend:** 7 / 14 / 30 / 90 days. Click a day to mark it.
- **Recent Staff Activities:** new staff, attendance marked, leave requested / approved / rejected, role changed, login deactivated / activated, password reset, details updated.
- **Quick Actions:** Mark Attendance, Manage Leaves, Assign Roles & Permissions, View Attendance Report, Staff Performance.

## Attendance (automatic + manual)
- **Automatic:** a staff member who logs in on a day is **Present** automatically, with their login time. A manual mark always wins.
- **Marking:** Present, Absent, Half day, Leave, Holiday or Week off, with in / out times and a note.
  - Shortcuts: "mark everyone not marked as present" and "holiday for everyone".
  - A future date accepts only Leave, Holiday or Week off.
- **An approved leave** shows as On Leave for every day it covers.
- **Attendance report:** month register (P / A / H / L / W / ? for each day), with present / absent / leave totals, attendance %, and hours from logins or in / out times. CSV and print.

## Leaves
- **Types:** casual, sick, earned, unpaid, other.
- Full or half day; added as approved or as a request.
- Approve, reject (a reason is required) or cancel.
- No overlapping leaves for the same person. Days taken this year are shown.

## Roles & permissions
- Change the **login role** (pharmacist, billing staff, inventory staff, delivery person; Admin only by Super Admin) and the **designation** (the job title shown here).
- A role change signs the person out, so the new role applies at their next login.
- **Matrix** of what each role can do.
- **Rules:** nobody can change their own role or status; Super Admin accounts are never changed here; an Admin cannot see or change Admin / Super Admin accounts.

## Staff details
Designation, join date, shift, monthly salary, email, date of birth, gender, qualification, licence / registration no., emergency contact, address, notes and photo.

The salary amount is never written to the audit log.

## Staff performance
For any period, per person:
- bills and sales
- average bill
- returns
- purchases entered
- deliveries done
- attendance % and days present
- hours worked
- last login

Sortable, with CSV.

## Import / export
- **Import:** CSV columns `staff_id, full_name, phone, role, designation, join_date, address`.
  - A template can be downloaded, and each row is checked before anything is created.
  - A temporary password is made for each person; download the passwords at the end.
- **Export:** staff list (CSV / print), attendance register CSV, performance CSV.

## Tested
- `tests/live-replica/live-0031.test.mjs`: 43 checks.
  - Visibility rules; details and validation; roles; activate and deactivate.
  - Logins as present; manual marks; future dates; clearing a mark.
  - Leaves, including overlap, half day and the reason for rejecting.
  - Overview, trend, register, activities, performance, roles matrix, login history, privacy.
- `tests/e2e/staff_flow.py`: 69 checks.
  - Every KPI, table, filter and pager; add staff with photo; duplicate ID; edit; profile tabs; reset password.
  - Role change; deactivate / activate; attendance marking and the KPI update; future date.
  - Leaves (request, approve, reject, approved leave today); register and CSV; performance; activity log.
  - CSV import with credentials; export; View All.
  - Admin restrictions, deep link, mobile layout, pharmacist blocked, and the page without 0031.
- All other suites pass:
  - flows 45, flows2 40, dashboard 47, billing 41, delivery 41, medicines 32, inventory 69, purchases 64
  - distributors 42, customers 50, sales 56, returns 52, expenses 50, finance 50, reports 62, whatsapp 80
  - replica 0021–0031; admin click-through.
