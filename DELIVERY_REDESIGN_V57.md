# Delivery redesign — version 57

## 1 · Run the SQL (once)
In Supabase SQL Editor run **`database/migrations/0022_delivery_management_v2.sql`**. It is safe to run twice. Then run `database/diagnostics/verify_0022.sql`, and every row should say **true**.

The migration only adds to the database:
- a **Failed / Returned** status with a reason;
- out-for-delivery, delivered and failed times, recorded automatically;
- a per-delivery address, phone and note;
- issues reported by the rider;
- a branch **delivery fee**, with each completed delivery recording the fee it earned;
- new functions for the two pages.

Every existing delivery function keeps working unchanged. Until the SQL is run, both pages fall back to the old functions, without failed status, times or earnings.

## 2 · Admin / staff page — `delivery.html`
- **Layout:** same sidebar, top search, bell and user menu as the dashboard, without the "Your Trusted Healthcare Partner" block.
- **New Delivery:**
  - choose any final bill from the last 120 days;
  - the address and phone are filled in from the customer or the bill's patient details, and can be edited;
  - add a note and optionally assign a delivery boy straight away.
- **Assign Orders:** assign several pending or failed orders to one delivery boy at once. The list refreshes first.
- **Delivery Boy Login:** opens the delivery login page, which now uses the same branding.
- **KPIs:**
  - Total Deliveries, Delivered and Failed / Returned for the chosen period, compared with the previous period of the same length;
  - Out for Delivery, with how many are on the road right now.
- **Delivery Orders:**
  - period: Today, 7, 30 or 90 days;
  - Filter: by delivery boy, by date range, and "also show bills without a delivery request";
  - tabs: All, Pending, Out, Delivered, Failed, with counts;
  - search by order, customer, phone or address;
  - pages of 8 orders.
- **Row actions:**
  - 👁 opens the details: timeline, contact, edit address / phone / note, remove the request, assign or reassign, view invoice;
  - 📍 opens the address in Google Maps while the order is out for delivery;
  - 📄 opens the invoice once delivered;
  - ✏️ assigns or reassigns while pending or failed. Reassigning a failed order starts a new attempt.
- **Delivery Boy Status:** each delivery boy shows as Online, Purchasing or Offline, with their order counts.
- **View All:**
  - every delivery boy with call and "show their orders";
  - admins also get the **delivery fee** setting and the **create delivery boy account** form, the same function as before.
- **Delivery Summary:** donut chart for the period. Click a legend item to open that tab.
- **Updates and alerts:**
  - the page refreshes every 30 seconds while it is open;
  - the bell shows unassigned orders, reported issues, failed orders and "no delivery boy online".

## 3 · Delivery boy dashboard
Delivery boys sign in at `delivery-boy-login.html` and land on `delivery.html`, which shows them their own dashboard. `delivery-boy.html` opens the same dashboard.

- **Online ▾ and Go Offline / Go Online:**
  - the same availability status that Billing and Delivery Management display;
  - signing out sets the status to Offline.
- **KPIs:** Assigned, Out for Delivery, Delivered and Failed / Returned for the chosen day. Today, Yesterday, Last 7 days or All dates.
- **My Deliveries:**
  - tabs and pages of 5 orders;
  - 📍 starts Google Maps navigation to the customer and 📞 calls them;
  - ▶ starts the delivery and ✓ marks it delivered, each with a confirmation;
  - clicking a row opens the full order with WhatsApp, the pharmacy's note and the timeline.
- **Today's Summary:** Delivered, Out, Failed and **Earnings** (completed deliveries × fee).
- **My Delivery Route:**
  - a map of the next stop and the list of stops;
  - "View Map" opens Google Maps directions through every active stop.
- **Quick Actions:**
  - Navigate Next Order;
  - Call Customer;
  - Update Delivery Status;
  - Report Issue: choose the problem and optionally return the order, which marks it Failed / Returned. The pharmacy sees the issue on the order.
- **Sidebar and bottom bar:**
  - Dashboard;
  - My Deliveries;
  - Completed;
  - Earnings: today, 7 days, this month and by day;
  - Profile: change password and sign out;
  - Help & Support: call or WhatsApp the pharmacy, and how deliveries work;
  - Logout.
- **Top search:** order ID, customer or phone (Ctrl+K).
- **New orders:** a message appears when a new order is assigned.

**Distance (km)** from the mock-up is not shown. It needs a paid Google Maps API key with geocoded addresses. The **Time** column shows when each order was assigned, sent out or delivered instead, and the map buttons open Google Maps, which shows the distance.

## Files
- **New:**
  - `database/migrations/0022_delivery_management_v2.sql`, `database/diagnostics/verify_0022.sql`;
  - `assets/js/delivery-rider.js`, `assets/js/delivery-boy.js`, `assets/css/delivery-pos.css`;
  - `tests/e2e/delivery_flow.py`, `tests/live-replica/live-0022.test.mjs`.
- **Changed:**
  - `delivery.html`, `delivery-boy.html`, `delivery-boy-login.html` (styling only);
  - `assets/js/delivery.js`;
  - `assets/js/brand-shell.js`: the phone bottom bar keeps the current page;
  - `tests/e2e/server.mjs`, `tests/e2e/flows2.py`.

## Tests
- `delivery_flow.py`: 41 checks covering the admin, the delivery boy and the mobile layouts, every result read back from the database.
- `live-0022.test.mjs`: 15 checks, including running the migration twice and the role restrictions.
- `flows.py` 40/40, `flows2.py` 40/40, `dashboard_flow.py` 47/47 and `billing_flow.py` 41/41 pass.
- The click-through of every page by every role is clean.
