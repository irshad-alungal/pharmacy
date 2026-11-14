// UI-only convenience. Database RLS and server-side checks remain the real security boundary.

// ALZA has two access groups:
// 1) Admin / Owner: super_admin, admin, admin_staff
// 2) Store Staff: inventory_staff, billing_staff
const ADMIN_ROLES = ['super_admin', 'admin', 'admin_staff'];
const STORE_ROLES = ['inventory_staff', 'billing_staff'];

const ADMIN_PAGES = [
  'dashboard', 'billing', 'delivery', 'medicines', 'inventory', 'purchases',
  'distributors', 'customers', 'sales', 'returns', 'expenses', 'finance',
  'reports', 'whatsapp', 'staff', 'documents', 'settings', 'audit-logs'
];

const STORE_PAGES = [
  'billing', 'delivery', 'medicines', 'inventory', 'purchases',
  'distributors', 'customers', 'sales', 'returns', 'reports'
];

export const ACCESS = Object.fromEntries([
  ...ADMIN_PAGES.map(page => [page, ADMIN_ROLES]),
  ...STORE_PAGES.map(page => [page, [...ADMIN_ROLES, ...STORE_ROLES]])
]);

// Dashboard is reserved for the two administrator role codes only.
ACCESS.dashboard = ['super_admin', 'admin'];

export const isAdminRole = role => ADMIN_ROLES.includes(String(role || '').toLowerCase());
export const isStoreRole = role => STORE_ROLES.includes(String(role || '').toLowerCase());
export const can = (role, page) => (ACCESS[page] || []).includes(String(role || '').toLowerCase());
