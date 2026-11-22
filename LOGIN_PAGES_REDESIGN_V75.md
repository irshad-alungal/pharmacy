# Sign-in pages redesign (version 75)

`admin-login.html`, `staff-login.html`, `delivery-boy-login.html` and `change-password.html` now follow the attached designs on desktop and mobile:
- the pharmacy background, the green curves and the mortar & pestle illustration;
- "Pharmacy Management System" with the 5 features (a list on desktop, a row of icons on mobile);
- the white card with the logo, title, fields, "Forgot Password?", a green Login button and the access note.

There is no "Your Trusted Healthcare Partner" block.

The logos are the same Pallikkal Pharmacy logo as the dashboard sidebar. On the white card a navy version is used (`assets/images/brand/logo-horizontal-dark.png`).

**Nothing to run.** These are page changes only: no database migration and no Edge Function change.

## Existing functions kept
- **Admin login**
  - Signs in with the administrator email through Supabase Auth.
  - Only Admin / Super Admin can continue; anyone else is signed out with a message.
  - Starts the work session and asks for today's opening balance.
- **Staff login**
  - Staff ID + password through the `staff-login` function.
  - Checks the profile is active; forces a first-login password change when required.
  - Starts the work session and asks for the opening balance, then opens the first page the role can use.
- **Delivery login**
  - Uses the `delivery-login` function and accepts only the delivery role.
  - Checks the account is active and handles the first-login password change.
  - Starts the work session, then opens `delivery.html`.
- **Change password**
  - Minimum 12 characters and must match the confirmation.
  - Calls `complete_password_change`.
  - Delivery accounts then start their session and go to Delivery; staff and admins start a session, give the opening balance and go to their home page.
  - If no one is signed in, the page goes to Admin login.

## New
- **Admin "Username / Email"**: an email signs in as before. An admin Staff ID (e.g. SA001) signs in through the `staff-login` function.
- **Admin home page**: admins now land on the Dashboard (the admin home page) instead of Billing.
- **Return to the page you were on**: if a session expires or a new day starts, the sign-in page reopens that page afterwards (`?next=`). Only pages of this site that the role may open are accepted.
- **Field helpers**:
  - Show / hide password (the eye icon) and a Caps Lock warning.
  - Clear error, progress and success messages; a spinner on the button while signing in.
  - The last username used on each page is filled in for you.
- **Forgot Password?**
  - **Admin page**: sends a Supabase reset email. The link opens the Change Password page without asking for the current password.
  - **Staff and delivery pages**: these logins have no email of their own, so the page explains how to get a reset: the Admin uses Staff → Reset password, and the person sets their own password at the next login.
- **Change password**:
  - **Current password is required and checked** before the change (except when opened from a reset link).
  - **Live checklist and strength bar**: at least 12 characters, an uppercase letter, a lowercase letter, a number and a special character. The new password must differ from the current one.
  - **Opened while signed in** (Settings → Change My Password): it returns to where you came from, and you stay signed in.
  - **Back to Login** ends the half-finished sign-in so the next person starts clean.
- **Delivery account on the Staff page**: you are sent to Delivery login.
- **Links to the other sign-in pages**: small links under each card, as before.

## Honest notes
- **12 characters, not 8**: the password rule stays at **12 characters**, the existing rule. The design said 8, and 12 is safer.
- **Forgot-password email for admins**: Supabase sends it with its built-in mail. On the free plan it is limited to a few emails per hour. Add `…/change-password.html` to **Authentication → URL Configuration → Redirect URLs** in Supabase so the link is accepted.
- **Background and illustration**: these are drawn in code (`auth-shelves.svg`, `auth-illustration.svg`), not a stock photo, so they load fast and need no licence.

## Tests
- `tests/e2e/auth_flow.py`: 42 checks.
  - Admin email, admin Staff ID, wrong password, non-admin refused, `?next=`, forgot password.
  - Staff login, a delivery account refused on the Staff page, first-login forced change.
  - Delivery login, and a non-delivery account refused.
  - Change password while signed in, wrong current password, reset link, Back to Login, no session.
  - The mobile layout of all three login pages.
- The harness stand-in for supabase-js now supports `setSession` and test hooks for email sign-in.
