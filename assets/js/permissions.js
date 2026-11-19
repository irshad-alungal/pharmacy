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

const ROLE_PAGES = {
  // Pharmacist: sales + purchasing + stock (role_permissions: sales.*, purchase.*, inventory.*, medicine.*, customer.*, distributor.manage)
  pharmacist: ['billing', 'delivery', 'medicines', 'inventory', 'purchases', 'distributors', 'customers', 'sales', 'returns', 'documents'],
  // Billing counter staff: sales.create/view, customer.*, medicine.view, inventory.view
  billing_staff: ['billing', 'delivery', 'medicines', 'inventory', 'customers', 'sales', 'returns'],
  // Inventory staff: purchase.*, inventory.*, medicine.*
  inventory_staff: ['medicines', 'inventory', 'purchases', 'distributors', 'documents'],
  // Legacy role codes still present in the roles table
  billing: ['billing', 'delivery', 'medicines', 'inventory', 'customers', 'sales', 'returns'],
  inventory: ['medicines', 'inventory', 'purchases', 'distributors', 'documents']
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

// Where each role lands after signing in.
export const homePage = role => {
  const r = String(role || '').toLowerCase();
  if (r === 'super_admin' || r === 'admin') return 'dashboard.html';
  if (r === 'delivery_person') return 'delivery.html';
  const first = ALL_PAGES.find(p => can(r, p));
  return first ? `${first}.html` : 'index.html';
};
