// UI-only convenience. Database RLS and server-side checks remain the real security boundary.
// Page access mirrors the live role_permissions and the role checks inside the
// database functions each page calls, so staff never see a page that would only
// show "Not authorised" errors.

const ADMIN_ROLES = ['super_admin', 'admin', 'admin_staff'];

const ALL_PAGES = [
  'dashboard', 'billing', 'delivery', 'medicines', 'inventory', 'purchases',
  'distributors', 'customers', 'sales', 'returns', 'expenses', 'finance',
  'reports', 'whatsapp', 'staff', 'documents', 'settings', 'audit-logs'
];

// Every staff member (any staff role) sees the same nine pages, in this order:
// Billing, Delivery, Medicines, Inventory, Customers, Sales, Returns, Distributors, WhatsApp.
// Money totals are hidden from staff on those pages (see isAdminRole).
const STAFF_PAGES = ['billing', 'delivery', 'medicines', 'inventory', 'customers', 'sales', 'returns', 'distributors', 'whatsapp'];
const ROLE_PAGES = {
  pharmacist: STAFF_PAGES,
  billing_staff: STAFF_PAGES,
  inventory_staff: STAFF_PAGES,
  // Legacy role codes still present in the roles table
  billing: STAFF_PAGES,
  inventory: STAFF_PAGES
};

export const ACCESS = Object.fromEntries(ALL_PAGES.map(page => [
  page,
  [...ADMIN_ROLES, ...Object.entries(ROLE_PAGES).filter(([, pages]) => pages.includes(page)).map(([role]) => role)]
]));

// Dashboard is reserved for the two administrator role codes only.
ACCESS.dashboard = ['super_admin', 'admin'];

export const isAdminRole = role => ADMIN_ROLES.includes(String(role || '').toLowerCase());
export const isStoreRole = role => Object.keys(ROLE_PAGES).includes(String(role || '').toLowerCase());
export const can = (role, page) => (ACCESS[page] || []).includes(String(role || '').toLowerCase());

// Where each role lands after signing in: Billing for admins and staff, Delivery for delivery staff.
export const homePage = role => {
  const r = String(role || '').toLowerCase();
  if (r === 'delivery_person') return 'delivery.html';
  if (can(r, 'billing')) return 'billing.html';
  const first = ALL_PAGES.find(p => can(r, p));
  return first ? `${first}.html` : 'index.html';
};
