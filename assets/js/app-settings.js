// Shared pharmacy settings (0033). Pages read a local copy synchronously (invoice printing,
// billing payment buttons, dashboard alerts); loadSettings() refreshes it from the database.
// No imports, so invoice.js can use it on every page.
export const APP_VERSION = '72.1';
export const APP_BUILD = '2026-11-22';
export const DEFAULTS = {
  general: { language: 'en', date_format: 'DD MMM YYYY', time_format: '12h', currency: 'INR', low_stock_alerts: true, expiry_alerts: true, auto_backup: false, invoice_logo: true },
  invoice: { default_format: 'thermal', show_gstin: true, show_drug_licence: true, show_patient: true, terms: '', show_upi: false, signature_line: false },
  payments: { enabled: ['cash', 'card', 'upi', 'wallet', 'credit', 'split'], default_method: 'cash', upi_id: '', upi_name: '' },
  notifications: { expiry_days: 30, deliveries: true, expense_drafts: true, deactivations: true, backup_reminder: true },
  license: { type: 'Professional', valid_to: '', licensed_to: '' },
  support: { name: '', phone: '', email: '', website: '' },
  billing: { max_discount_pct: 30, reservation_minutes: 15, near_expiry_days: 90 },
  branding: { pharmacy_name: '', tagline: '', logo_path: '', logo_url: '' }
};
const KEY = 'pp.settings.v1';
const merge = s => Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, { ...v, ...((s || {})[k] || {}) }]));
export function cachedSettings() {
  try { return merge(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return merge(null); }
}
export function storeSettings(s, logoUrl) {
  const m = merge(s);
  if (logoUrl !== undefined) m.branding.logo_url = logoUrl;
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ }
  return m;
}
// Refresh from the database (settings_get, migration 0033). Falls back to the local copy.
export async function loadSettings(sb) {
  try {
    const { data, error } = await sb.rpc('settings_get');
    if (error || !data) return { ...cachedSettings(), missing: !!error };
    const path = data.branding?.logo_path;
    const url = path ? sb.storage.from('pharmacy-branding').getPublicUrl(path)?.data?.publicUrl || '' : '';
    return { ...storeSettings(data, url), raw: data };
  } catch { return cachedSettings(); }
}

// ---- date / time formatting with the chosen formats (India time)
const TZ = 'Asia/Kolkata';
const parts = d => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return p;
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDateWith(v, fmt) {
  if (!v) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(v + 'T12:00:00+05:30') : new Date(v);
  if (Number.isNaN(+d)) return String(v);
  const p = parts(d);
  return ({ 'DD/MM/YYYY': `${p.day}/${p.month}/${p.year}`, 'DD-MM-YYYY': `${p.day}-${p.month}-${p.year}`, 'MM/DD/YYYY': `${p.month}/${p.day}/${p.year}`,
    'YYYY-MM-DD': `${p.year}-${p.month}-${p.day}` })[fmt] || `${p.day} ${MON[+p.month - 1]} ${p.year}`;
}
export function fmtTimeWith(v, tf) {
  const d = new Date(v); if (Number.isNaN(+d)) return '';
  const p = parts(d), h = +p.hour;
  return tf === '24h' ? `${p.hour}:${p.minute}` : `${String((h % 12) || 12).padStart(2, '0')}:${p.minute} ${h >= 12 ? 'PM' : 'AM'}`;
}
export const fmtDate = v => fmtDateWith(v, cachedSettings().general.date_format);
export const fmtDateTime = v => v ? `${fmtDate(v)}, ${fmtTimeWith(v, cachedSettings().general.time_format)}` : '';
