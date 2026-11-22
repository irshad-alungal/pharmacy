// Settings — Pallikkal Pharmacy design.
// Kept from the old page: pharmacy details used on invoices (get_branch_profile / save_branch_profile:
// name, address, city, state, PIN, phone, email, GSTIN, drug licence numbers, invoice prefix, invoice
// footer) and the master lists (categories, manufacturers, storage locations, units with code — add,
// activate / deactivate — and unit conversions — add, remove).
// New (0033): general preferences (date / time format, alerts, daily auto backup, logo on invoice),
// logo and tagline, users & permissions overview, billing rules, notifications, print & invoice options
// with live preview, payment methods (billing screen follows them), WhatsApp settings, backup / restore,
// integrations status, licence and support contact, system information and update check.
import { sb, SUPABASE_URL } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';
import { APP_VERSION, APP_BUILD, DEFAULTS, storeSettings, fmtDateWith, fmtTimeWith } from './app-settings.js';
import { invoiceHTML } from './invoice.js';
import { exportBackup } from './backup.js';

const prof = await mountShell('settings', 'Settings', { layout: 'brand' });
const $ = id => document.getElementById(id);
const role = String(prof?.role || '').toLowerCase();
const isSuper = role === 'super_admin';
if (!['super_admin', 'admin'].includes(role)) { $('view').innerHTML = '<p class="notice">Only Admin and Super Admin can change settings.</p>'; throw new Error('Settings access denied'); }
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

const TZ = 'Asia/Kolkata';
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const count = n => new Intl.NumberFormat('en-IN').format(num(n));
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const size = b => { b = num(b); return b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`; };
const when = v => v ? `${fmtDateWith(v, S.general.date_format)}, ${fmtTimeWith(v, S.general.time_format)}` : '—';
const dmy = v => v ? fmtDateWith(v, S.general.date_format) : '—';
const clone = o => JSON.parse(JSON.stringify(o));
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>', 1.8),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>', 1.8),
  store: svg('<path d="M3 9 4.5 4h15L21 9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 11v9h14v-9"/><path d="M10 20v-5h4v5"/>', 1.8),
  users: svg('<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.3c2.9.3 5 2.6 5 5.7"/>', 1.8),
  card: svg('<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>', 1.8),
  bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 20a2 2 0 0 0 4 0"/>', 1.8),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.8),
  wallet: svg('<path d="M3 7a2 2 0 0 1 2-2h12v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 13.5h2"/>', 1.8),
  wa: svg('<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.9-1.3-2.3-2.3l.8-1-1-2L9 9.5Z"/>', 1.6),
  db: svg('<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>', 1.8),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 1.9),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 2),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  down: svg('<path d="m6 9 6 6 6-6"/>', 2.2),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', 2),
  save: svg('<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>', 1.9),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>', 1.8),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>', 1.8),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 1.9),
  rupee: svg('<path d="M6 4h12M6 8.5h12M9 4c3.5 0 6 1.6 6 4.5S12.5 13 9 13H6l8 7"/>', 1.9),
  alarm: svg('<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2 1.5"/><path d="M5 3 2.5 5.5M19 3l2.5 2.5"/>', 1.8),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>', 1.9),
  doc: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>', 1.8),
  headset: svg('<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20c0 1-1.5 2-4 2h-2"/>', 1.8),
  book: svg('<path d="M2 5c2.5-1 5.5-1 10 1.2C16.5 4 19.5 4 22 5v14c-2.5-1-5.5-1-10 1.2C7.5 18 4.5 18 2 19Z"/><path d="M12 6.2v14"/>', 1.7),
  chat: svg('<path d="M4 5h16v11H9l-5 4Z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>', 2),
  sync: svg('<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>', 1.9),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 2),
  cloud: svg('<path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-1 9Z"/><path d="M12 11v6M9.5 13.5 12 11l2.5 2.5"/>', 1.8),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>', 2),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.2),
  tick: svg('<path d="m5 12 4 4 10-10"/>', 2.4),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>', 1.9),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', 1.9),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>', 1.9),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>', 1.9),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>', 1.9),
  cash: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>', 1.8),
  upi: svg('<path d="m7 4 6 8-6 8"/><path d="m12 4 6 8-6 8"/>', 2),
  credit: svg('<path d="M4 4h12l4 4v12H4Z"/><path d="M8 12h8M8 16h5"/>', 1.8),
  split: svg('<path d="M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M12 13v8"/>', 1.9),
  photo: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>', 1.9)
};

const SECTIONS = [
  ['general', 'General Settings', I.sliders, 'Manage basic system settings and preferences.'],
  ['business', 'Business Information', I.store, 'Pharmacy name, address, GSTIN and drug licences printed on invoices, plus logo and tagline.'],
  ['website', 'Website', I.globe, 'What visitors see on your home page: opening hours, offers, delivery, Ayurvedic store, WhatsApp, map, photos and links.'],
  ['users', 'Users & Permissions', I.users, 'Staff logins, roles and what each role can do.'],
  ['billing', 'Billing & Subscription', I.card, 'Billing rules enforced on every bill, and your licence.'],
  ['notifications', 'Notifications', I.bell, 'Choose which alerts appear in the bell.'],
  ['invoice', 'Print & Invoice', I.print, 'Invoice number prefix, paper size and what is printed on the bill.'],
  ['payments', 'Payment Methods', I.wallet, 'Payment options shown on the billing screen and your UPI ID.'],
  ['whatsapp', 'WhatsApp Integration', I.wa, 'Invoice messages after billing and the message signature.'],
  ['backup', 'Backup & Data', I.db, 'Back up your data, restore settings and lists, and see what is stored.'],
  ['integrations', 'Integrations', I.link, 'Connected services and their status.'],
  ['system', 'System Preferences', I.list, 'Categories, manufacturers, storage locations, units and unit conversions.'],
  ['about', 'About & License', I.info, 'Version, licence details and support contact.']
];
const SAVEABLE = { general: 1, business: 1, website: 1, billing: 1, notifications: 1, invoice: 1, payments: 1, whatsapp: 1, backup: 1, about: 1 };
const RESET_LABEL = { business: 'Undo Changes', website: 'Undo Changes', about: 'Reset Support' };

let S = clone(DEFAULTS), RAW = null, has33 = true, profile = null, info = null, waSet = null, docDays = null, current = 'general', dirty = false, upd = null;

$('view').innerHTML = `
<div class="pos sg">
  <section class="pos-head sg-head">
    <div class="pos-title"><span class="pos-title-ic">${I.gear}</span>
      <div><h1>Settings</h1><p>Configure and manage your pharmacy system, preferences, and business information.</p></div></div>
  </section>
  <div class="sg-mbar">
    <label class="sg-mselect"><span class="sg-mic" id="mIc">${I.gear}</span><span class="sg-mlabel" id="mLbl">General Settings</span><select id="mSec" aria-label="Settings section">${SECTIONS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>${I.down}</label>
    <button type="button" class="pos-btn sg-reset" data-act="reset">${I.reset}<span>Reset to Default</span></button>
    <button type="button" class="pos-btn pos-btn-solid sg-save" data-act="save">${I.save}<span>Save Changes</span></button>
  </div>
  <div id="msg" class="md-msg" role="status"></div>
  <div class="sg-layout">
    <nav class="pos-card sg-nav" aria-label="Settings sections">${SECTIONS.map(([k, l, ic]) => `<button type="button" data-sec="${k}"><span class="sg-nav-ic">${ic}</span><b>${l}</b>${I.chev}</button>`).join('')}</nav>
    <div class="sg-main">
      <section class="pos-card sg-panel">
        <div class="sg-panel-head">
          <span class="sg-panel-ic" id="pIc"></span>
          <div><h2 id="pTitle"></h2><p id="pSub"></p></div>
          <div class="sg-panel-acts">
            <button type="button" class="pos-btn sg-reset" data-act="reset">${I.reset}<span id="resetLbl">Reset to Default</span></button>
            <button type="button" class="pos-btn pos-btn-solid sg-save" data-act="save">${I.save}<span>Save Changes</span></button>
          </div>
        </div>
        <div id="body"></div>
      </section>
      <div id="below"></div>
    </div>
  </div>
</div>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide sl-dlg sg-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;

let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4500); };
const note = (m, bad) => { $('msg').textContent = m; $('msg').className = m ? `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}` : 'md-msg'; };
$('puDlg').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('puDlg')) $('puDlg').close(); });
const dlg = (html, cls = '') => { $('puPanel').innerHTML = html; $('puDlg').className = `pos-dialog dl-dialog md-wide sl-dlg sg-dlg ${cls}`; $('puPanel').onclick = null; if (!$('puDlg').open) $('puDlg').showModal(); };
async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; }
const missing = e => /settings_|function|schema cache|does not exist|Could not find/i.test(e?.message || '');
const need33 = () => { if (!has33) { toast('This needs database migration 0033 (Settings).', true); return true; } return false; };

// ---- small builders
const sw = (id, on, dis = false) => `<label class="sg-sw"><input type="checkbox" id="${id}"${on ? ' checked' : ''}${dis ? ' disabled' : ''}><span aria-hidden="true"></span></label>`;
const togRow = (id, ic, label, on, hint = '', dis = false) => `<div class="sg-trow"><span class="sg-ric g">${ic}</span><label for="${id}"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</label>${sw(id, on, dis)}</div>`;
const selRow = (id, ic, cls, label, opts, val) => `<div class="sg-srow"><span class="sg-ric ${cls}">${ic}</span><label for="${id}">${label}</label><select id="${id}">${opts.map(([v, l, dis]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}${dis ? ' disabled' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
const field = (id, label, val, attrs = '', span = false, hint = '') => `<div class="pos-field${span ? ' md-span-2' : ''}"><label for="${id}">${label}${hint ? ` <small class="dl-muted">${hint}</small>` : ''}</label><input id="${id}" value="${esc(val ?? '')}" ${attrs}></div>`;
const area = (id, label, val, attrs = '', hint = '') => `<div class="pos-field md-span-2"><label for="${id}">${label}${hint ? ` <small class="dl-muted">${hint}</small>` : ''}</label><textarea id="${id}" rows="2" ${attrs}>${esc(val ?? '')}</textarea></div>`;
const subh = (ic, t, extra = '') => `<h3 class="sg-subh">${ic}<span>${t}</span>${extra}</h3>`;
const v = id => $(id)?.value ?? '';
const c = id => !!$(id)?.checked;

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
async function loadAll() {
  try {
    RAW = await rpc('settings_get'); has33 = true;
    const url = RAW.branding?.logo_path ? sb.storage.from('pharmacy-branding').getPublicUrl(RAW.branding.logo_path)?.data?.publicUrl || '' : '';
    S = storeSettings(RAW, url);
  } catch (e) {
    if (!missing(e)) note(friendly(e), true);
    else { has33 = false; note('Run database migration 0033 (Settings) to save preferences, invoice options, payment methods and backups. Pharmacy details and the master lists below keep working.', true); }
  }
  const [p, si] = await Promise.all([sb.rpc('get_branch_profile'), has33 ? sb.rpc('settings_system_info') : Promise.resolve({ data: null })]);
  if (p.error) note(friendly(p.error), true); else profile = p.data;
  info = si.data || null;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function show(sec, force = false) {
  if (!SECTIONS.some(x => x[0] === sec)) sec = 'general';
  if (!force && dirty && sec !== current && !confirm('You have unsaved changes. Leave this section without saving?')) { $('mSec').value = current; return; }
  current = sec; dirty = false;
  const [, label, ic, sub] = SECTIONS.find(x => x[0] === sec);
  for (const b of document.querySelectorAll('.sg-nav [data-sec]')) b.classList.toggle('on', b.dataset.sec === sec);
  $('mSec').value = sec; $('mIc').innerHTML = ic; $('mLbl').textContent = label;
  $('pIc').innerHTML = ic; $('pTitle').textContent = label; $('pSub').textContent = sub;
  for (const b of document.querySelectorAll('[data-act]')) b.hidden = !SAVEABLE[sec];
  $('resetLbl').textContent = RESET_LABEL[sec] || 'Reset to Default';
  for (const b of document.querySelectorAll('.sg-mbar .sg-reset span')) b.textContent = RESET_LABEL[sec] || 'Reset to Default';
  $('below').innerHTML = '';
  $('body').onclick = $('body').oninput = $('body').onchange = null;
  RENDER[sec]();
  if (location.hash !== `#${sec}`) history.replaceState(null, '', `#${sec}`);
  updateSaveState();
}
$('body').addEventListener('input', e => markDirty(e)); $('body').addEventListener('change', e => markDirty(e));
function markDirty(e) { if (e.target.closest('[data-nodirty]')) return; dirty = true; updateSaveState(); }
function updateSaveState() { for (const b of document.querySelectorAll('[data-act="save"]')) b.classList.toggle('pulse', dirty); }
document.querySelector('.sg-nav').addEventListener('click', e => { const b = e.target.closest('[data-sec]'); if (b) show(b.dataset.sec); });
$('mSec').addEventListener('change', () => show($('mSec').value));
addEventListener('hashchange', () => show(location.hash.slice(1)));
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click', () => (b.dataset.act === 'save' ? save() : reset()));
async function save() {
  const fn = SAVE[current]; if (!fn) return;
  for (const b of document.querySelectorAll('[data-act="save"]')) b.disabled = true;
  try { const msg = await fn(); dirty = false; toast(msg || 'Settings saved.'); note(''); show(current, true); notify(); }
  catch (e) { toast(friendly(e), true); }
  finally { for (const b of document.querySelectorAll('[data-act="save"]')) b.disabled = false; }
}
async function reset() {
  const fn = RESET[current]; if (!fn) return;
  const label = SECTIONS.find(x => x[0] === current)[1];
  if (current !== 'business' && !confirm(`Reset ${label} to the default values?`)) return;
  try { const msg = await fn(); dirty = false; toast(msg || `${label} reset to defaults.`); show(current, true); notify(); }
  catch (e) { toast(friendly(e), true); }
}
const SAVE = {}, RESET = {}, RENDER = {};
const saveSection = async (sec, val) => { RAW = await rpc('settings_save', { p_section: sec, p_value: val }); S = storeSettings(RAW, S.branding.logo_url); };
const resetSection = async sec => { RAW = await rpc('settings_reset', { p_section: sec }); S = storeSettings(RAW, S.branding.logo_url); };

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------
const DATE_OPTS = ['DD MMM YYYY', 'DD/MM/YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map(f => [f, `${f} (${fmtDateWith(today(), f)})`]);
RENDER.general = () => {
  const g = S.general;
  $('body').innerHTML = `
    <div class="sg-box sg-prefs">
      ${subh(I.sliders, 'System Preferences')}
      <div class="sg-prefs-grid">
        <div class="sg-col">
          ${selRow('gLang', I.globe, 'b', 'Default Language', [['en', 'English'], ['ml', 'Malayalam (coming soon)', 1], ['hi', 'Hindi (coming soon)', 1]], g.language)}
          ${selRow('gDate', I.cal, 'g', 'Date Format', DATE_OPTS, g.date_format)}
          ${selRow('gTime', I.clock, 'b', 'Time Format', [['12h', `12-hour (AM/PM) · ${fmtTimeWith(new Date(), '12h')}`], ['24h', `24-hour · ${fmtTimeWith(new Date(), '24h')}`]], g.time_format)}
          ${selRow('gCur', I.rupee, 'a', 'Currency', [['INR', 'Indian Rupee (₹)']], g.currency)}
        </div>
        <div class="sg-col">
          ${togRow('gLow', I.alarm, 'Enable Low Stock Alerts', g.low_stock_alerts, 'Bell alert when a medicine is at or below its reorder level')}
          ${togRow('gExp', I.alarm, 'Enable Expiry Alerts', g.expiry_alerts, `Bell alert for expired stock and batches expiring within ${S.notifications.expiry_days} days`)}
          ${togRow('gBak', I.alarm, 'Auto Backup (Daily)', g.auto_backup, 'Downloads a backup at the first Dashboard visit of the day')}
          ${togRow('gLogo', I.alarm, 'Show Pharmacy Logo on Invoice', g.invoice_logo, S.branding.logo_url ? 'Logo is uploaded' : 'Upload a logo under Business Information')}
        </div>
      </div>
      <p class="sg-hint">Date and time formats are used on printed invoices, PDFs and in Settings.</p>
    </div>
    <div class="sg-box">
      ${subh(I.bolt, 'Quick Configuration')}
      <div class="sg-quick">
        <button type="button" class="g" data-go="business">${I.store}<span>Business Information</span></button>
        <button type="button" class="b" data-go="users">${I.users}<span>Users &amp; Roles</span></button>
        <button type="button" class="p" data-go="invoice">${I.doc}<span>Invoice Settings</span></button>
        <button type="button" class="g" data-go="whatsapp">${I.wa}<span>WhatsApp Setup</span></button>
        <button type="button" class="b" data-go="backup">${I.db}<span>Backup &amp; Restore</span></button>
      </div>
    </div>`;
  $('body').onclick = e => { const g2 = e.target.closest('[data-go]')?.dataset.go; if (g2) show(g2); };
  renderBelow();
};
SAVE.general = async () => { if (need33()) throw new Error('Migration 0033 needed'); await saveSection('general', { ...S.general, language: v('gLang'), date_format: v('gDate'), time_format: v('gTime'), currency: v('gCur'), low_stock_alerts: c('gLow'), expiry_alerts: c('gExp'), auto_backup: c('gBak'), invoice_logo: c('gLogo') }); return 'General settings saved.'; };
RESET.general = async () => { if (need33()) throw new Error('Migration 0033 needed'); await resetSection('general'); };

function versionCmp(a, b) { const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; } return 0; }
function renderBelow() {
  const lic = S.license, lb = info?.last_backup;
  const valid = lic.valid_to ? `${dmy(lic.valid_to)}${lic.valid_to < today() ? ' <span class="md-chip out">Expired</span>' : ''}` : 'No expiry';
  const chip = upd === null ? '<span class="md-chip in sg-upchip" id="upChip">Up to Date</span>' : upd.newer ? '<span class="md-chip low sg-upchip" id="upChip">Update available</span>' : '<span class="md-chip in sg-upchip" id="upChip">Up to Date</span>';
  $('below').innerHTML = `<div class="sg-below">
    <section class="pos-card sg-sys">
      ${subh(I.info, 'System Information')}
      <dl class="sg-dl">
        <div><dt>Software Version</dt><dd>v${esc(APP_VERSION)} ${chip}</dd></div>
        <div><dt>License Type</dt><dd>${esc(lic.type || '—')}</dd></div>
        <div><dt>Valid Up To</dt><dd>${valid}</dd></div>
        <div><dt>Database Size</dt><dd>${info?.database_size ? esc(size(info.database_size)) : '—'}</dd></div>
        <div><dt>Last Backup</dt><dd id="lastBk">${lb ? esc(when(lb.at)) : 'Never'}</dd></div>
      </dl>
      <button type="button" class="pos-btn sg-out-btn" id="bkNow">${I.cloud}<span>Backup Now</span></button>
    </section>
    <section class="pos-card sg-help">
      ${subh(I.headset, 'Support &amp; Help')}
      <button type="button" class="sg-hrow" id="hGuide"><span class="sg-ric b">${I.book}</span><span><b>User Guide</b><small>Learn how to use the system</small></span>${I.ext}</button>
      <button type="button" class="sg-hrow" id="hSupport"><span class="sg-ric a">${I.chat}</span><span><b>Contact Support</b><small>${S.support.phone || S.support.email ? `Get help from ${esc(S.support.name || 'our support team')}` : 'Get help from our support team'}</small></span>${I.ext}</button>
      <div class="sg-hrow sg-hrow-up"><span class="sg-ric g">${I.sync}</span><span><b>Check for Updates</b><small id="upMsg">${upd ? esc(upd.msg) : 'See if a new version is available'}</small></span><button type="button" class="pos-btn sg-out-btn" id="upBtn">${upd?.newer ? 'Reload' : 'Check Now'}</button></div>
    </section></div>`;
  $('bkNow').onclick = () => backupNow(false);
  $('hGuide').onclick = guide;
  $('hSupport').onclick = contactSupport;
  $('upBtn').onclick = () => (upd?.newer ? location.reload() : checkUpdates());
}
async function checkUpdates() {
  $('upMsg').textContent = 'Checking…';
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const newer = versionCmp(j.version, APP_VERSION) > 0;
    upd = { newer, remote: j.version, msg: newer ? `Version ${j.version} is published — reload to use it` : `You are on the latest version (v${APP_VERSION}, ${APP_BUILD})` };
  } catch { upd = { newer: false, msg: 'Could not check right now. Try again when online.' }; }
  renderBelow();
}
async function backupNow(includeLogs) {
  if (need33()) return;
  try {
    const r = await exportBackup(sb, { includeLogs });
    toast(`Backup downloaded: ${r.name} (${size(r.bytes)}, ${count(r.rows)} records). Keep a copy on a pen drive or Google Drive.`);
    info = (await sb.rpc('settings_system_info')).data || info;
    if (current === 'general') renderBelow(); else if (current === 'backup') show('backup', true);
    notify();
  } catch (e) { toast(friendly(e), true); }
}
function contactSupport() {
  const s = S.support;
  if (!s.phone && !s.email && !s.website) { toast('Add a support contact under About & License.'); return show('about'); }
  dlg(`<h3 class="rt-dlg-title">${I.headset} Contact Support</h3><p>${esc(s.name || 'Support team')}</p>
    <div class="sg-contact">
      ${s.phone ? `<a class="pos-btn pos-btn-solid" href="https://wa.me/${esc(s.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '91$1'))}?text=${encodeURIComponent(`Hello, I need help with Pallikkal Pharmacy software (v${APP_VERSION}, ${RAW?.branding?.branch_name || ''}).`)}" target="_blank" rel="noopener">${I.wa}<span>WhatsApp</span></a><a class="pos-btn" href="tel:${esc(s.phone)}">${I.chat}<span>Call ${esc(s.phone)}</span></a>` : ''}
      ${s.email ? `<a class="pos-btn" href="mailto:${esc(s.email)}?subject=${encodeURIComponent('Pallikkal Pharmacy software help')}">${I.ext}<span>${esc(s.email)}</span></a>` : ''}
      ${s.website ? `<a class="pos-btn" href="${esc(s.website)}" target="_blank" rel="noopener">${I.ext}<span>Website</span></a>` : ''}
    </div>`, 'sg-small-dlg');
}
const GUIDE = [
  ['Billing', 'Search or scan a medicine, choose the batch (the earliest expiry is picked first), add the customer, pick the payment method and Generate Bill. The invoice can be printed (thermal or A4), saved as PDF or sent on WhatsApp.'],
  ['Medicines & Inventory', 'Add medicines with HSN, GST and reorder level. Stock comes in through Purchases; Inventory shows batches, expiry and low stock, and lets you count, adjust and transfer stock.'],
  ['Purchases & Distributors', 'Record supplier bills with batches and expiry, pay suppliers and return expired stock. Upload the bill photo or PDF under Documents.'],
  ['Customers, Sales & Returns', 'Customers keep credit limits and dues. Sales lists every bill; Returns gives credit notes and puts stock back.'],
  ['Expenses & Finance', 'Post expenses, see cash book, ledger, profit & loss and GST summaries.'],
  ['Reports', 'Ready reports for sales, purchases, stock, GST and customers — download as CSV or print.'],
  ['Staff', 'Create logins, set roles, mark attendance and leaves.'],
  ['Documents', 'Keep licences, GST, agreements and insurance with expiry reminders.'],
  ['Settings', 'Pharmacy details, invoice layout, payment methods, alerts, backups and master lists live here. Take a backup every day and keep it outside the computer.']
];
function guide() {
  dlg(`<h3 class="rt-dlg-title">${I.book} User Guide</h3><div class="sg-guide">${GUIDE.map(([t, d], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(t)}</summary><p>${esc(d)}</p></details>`).join('')}</div>
    <p class="dl-muted sg-small">Need more help? Use Contact Support.</p>`, 'sg-small-dlg');
}

// ---------------------------------------------------------------------------
// Business information (existing pharmacy details + logo and tagline)
// ---------------------------------------------------------------------------
let newLogo = null, removeLogo = false;
RENDER.business = () => {
  const p = profile || {}, b = RAW?.branding || {};
  newLogo = null; removeLogo = false;
  $('body').innerHTML = `
    <form id="branch-profile" class="md-form" novalidate>
      <div class="sg-box">
        ${subh(I.store, 'Pharmacy details', '<small class="dl-muted">Printed on every invoice</small>')}
        <div class="md-form-grid sg-form">
          ${field('bName', 'Pharmacy name', p.name, 'name="name" required maxlength="120"', true)}
          ${area('bAddr', 'Street address', p.address, 'name="address" maxlength="300"')}
          ${field('bCity', 'City', p.city, 'name="city" maxlength="60"')}
          ${field('bState', 'State', p.state, 'name="state" maxlength="60" list="stateList"')}
          ${field('bPin', 'PIN code', p.pincode, 'name="pincode" inputmode="numeric" maxlength="6"')}
          ${field('bPhone', 'Phone', p.phone, 'name="phone" type="tel" maxlength="30"')}
          ${field('bEmail', 'Email', p.email, 'name="email" type="email" maxlength="120"')}
          ${field('bGst', 'GSTIN', p.gstin, 'name="gstin" maxlength="15" style="text-transform:uppercase"', false, '15 characters')}
          ${area('bDl', 'Drug licence numbers', Array.isArray(p.drug_licence_nos) ? p.drug_licence_nos.join('\n') : '', 'name="drug_licence_nos" rows="3"', 'one per line')}
        </div>
        <datalist id="stateList">${['Kerala', 'Tamil Nadu', 'Karnataka', 'Andhra Pradesh', 'Telangana', 'Maharashtra', 'Goa', 'Delhi', 'Gujarat', 'West Bengal', 'Uttar Pradesh', 'Puducherry', 'Lakshadweep'].map(x => `<option value="${x}"></option>`).join('')}</datalist>
        <p class="pos-form-msg" id="branch-profile-msg" role="status"></p>
      </div>
      <div class="sg-box">
        ${subh(I.photo, 'Logo & tagline', '<small class="dl-muted">Logo appears on invoices when “Show Pharmacy Logo on Invoice” is on</small>')}
        <div class="sg-brand">
          <div class="sg-logo" id="logoPrev">${S.branding.logo_url ? `<img src="${esc(S.branding.logo_url)}" alt="Pharmacy logo">` : I.photo}</div>
          <div class="sg-brand-b">
            <div class="sg-brand-acts"><label class="pos-btn pos-btn-sm sg-file">${I.upload}<span>${b.logo_path ? 'Change logo' : 'Upload logo'}</span><input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" hidden></label>
              ${b.logo_path ? `<button type="button" class="pos-btn pos-btn-sm sg-danger" id="logoDel">${I.trash}<span>Remove</span></button>` : ''}</div>
            <small class="dl-muted">PNG, JPG or WEBP, up to 1 MB. A square or wide logo on a white background prints best.</small>
            ${field('bTag', 'Tagline', b.tagline, 'maxlength="120" placeholder="e.g. Your health, our priority"')}
          </div>
        </div>
        <div class="sg-kv"><div><small>Branch</small><b>${esc(b.branch_name || '—')} <span class="dl-muted">(${esc(b.branch_code || '')})</span></b></div><div><small>Time zone</small><b>${esc(b.timezone || 'Asia/Kolkata')}</b></div><div><small>Invoice prefix</small><b>${esc(p.invoice_prefix || '—')}</b> <button type="button" class="dl-link" data-go="invoice">Change</button></div></div>
      </div>
    </form>`;
  $('body').onclick = e => { const g = e.target.closest('[data-go]')?.dataset.go; if (g) show(g); };
  $('logoFile').onchange = () => {
    const f = $('logoFile').files?.[0]; if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type) || f.size > 1048576) { $('logoFile').value = ''; return toast('Logo must be PNG, JPG or WEBP up to 1 MB.', true); }
    newLogo = f; removeLogo = false; $('logoPrev').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="New logo">`; dirty = true; updateSaveState();
  };
  if ($('logoDel')) $('logoDel').onclick = () => { removeLogo = true; newLogo = null; $('logoPrev').innerHTML = I.photo; dirty = true; updateSaveState(); };
  if (!profile) $('branch-profile-msg').textContent = 'Pharmacy details could not be loaded.';
};
function profilePayload(over = {}) {
  const p = profile || {};
  const row = { name: p.name, address: p.address, city: p.city, state: p.state, pincode: p.pincode, phone: p.phone, email: p.email, gstin: p.gstin,
    drug_licence_nos: Array.isArray(p.drug_licence_nos) ? p.drug_licence_nos : [], invoice_prefix: p.invoice_prefix, invoice_footer: p.invoice_footer, ...over };
  for (const k of Object.keys(row)) if (typeof row[k] === 'string') row[k] = row[k].trim() || null;
  row.gstin = row.gstin?.toUpperCase() ?? null;
  return row;
}
async function saveProfile(row) {
  if (!row.name) throw new Error('Pharmacy name is required.');
  if (!row.invoice_prefix) throw new Error('Invoice prefix is required.');
  if (row.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(row.gstin)) throw new Error('GSTIN looks wrong — it has 15 characters, e.g. 32ABCDE1234F1Z5.');
  if (row.pincode && !/^\d{6}$/.test(row.pincode)) throw new Error('PIN code must be 6 digits.');
  if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) throw new Error('Enter a valid email address.');
  const { error } = await sb.rpc('save_branch_profile', { p_data: row });
  if (error) throw error;
  profile = (await sb.rpc('get_branch_profile')).data || { ...profile, ...row };
}
SAVE.business = async () => {
  $('branch-profile-msg').textContent = 'Saving pharmacy details...';
  try {
    await saveProfile(profilePayload({ name: v('bName'), address: v('bAddr'), city: v('bCity'), state: v('bState'), pincode: v('bPin'), phone: v('bPhone'), email: v('bEmail'), gstin: v('bGst'),
      drug_licence_nos: v('bDl').split('\n').map(x => x.trim()).filter(Boolean) }));
  } catch (e) { $('branch-profile-msg').textContent = friendly(e); throw e; }
  if (has33) {
    let path = RAW?.branding?.logo_path || null;
    if (newLogo) {
      path = `${prof.branch_id}/logo-${Date.now()}.${newLogo.type === 'image/jpeg' ? 'jpg' : newLogo.type.split('/')[1]}`;
      const { error } = await sb.storage.from('pharmacy-branding').upload(path, newLogo, { contentType: newLogo.type, upsert: true });
      if (error) throw error;
    } else if (removeLogo) path = null;
    const old = RAW?.branding?.logo_path;
    if (v('bTag') !== (RAW?.branding?.tagline || '') || newLogo || removeLogo) {
      RAW = await rpc('settings_save_branding', { p_tagline: v('bTag'), p_logo_path: path });
      const url = path ? sb.storage.from('pharmacy-branding').getPublicUrl(path)?.data?.publicUrl || '' : '';
      S = storeSettings(RAW, url);
      if (old && old !== path) sb.storage.from('pharmacy-branding').remove([old]).then(() => {}, () => {});
    }
  }
  return 'Pharmacy details saved successfully.';
};
RESET.business = async () => { profile = (await sb.rpc('get_branch_profile')).data || profile; return 'Changes discarded.'; };

// ---------------------------------------------------------------------------
// Website (0035): the public home page (index.html)
// ---------------------------------------------------------------------------
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PHOTOS = [['hero', 'Top banner', 'Wide photo of the pharmacy or shelves'], ['about', 'About us', 'Your team or the counter'], ['store_main', 'Pharmacy store card', 'Front of the shop'],
  ['ayurveda', 'Ayurvedic banner', 'Ayurvedic products'], ['store_ayur', 'Ayurvedic store card', 'Front of the sister store']];
let WS = null, WOFF = [], WIMG = {};
const sitePhoto = path => path ? sb.storage.from('pharmacy-branding').getPublicUrl(path)?.data?.publicUrl || '' : '';
function offerRows() {
  return WOFF.map((o, i) => `<div class="sg-offer" data-off="${i}">
    <div class="pos-field"><label for="woT${i}">Offer title</label><input id="woT${i}" value="${esc(o.title)}" maxlength="80" placeholder="e.g. 20% off on vitamins"></div>
    <div class="pos-field"><label for="woG${i}">Badge</label><input id="woG${i}" value="${esc(o.tag)}" maxlength="20" placeholder="e.g. 20% OFF"></div>
    <div class="pos-field"><label for="woV${i}">Valid till <small class="dl-muted">optional</small></label><input id="woV${i}" type="date" value="${esc(o.valid_till)}"></div>
    <button type="button" class="pos-icon-btn sg-danger" data-deloff="${i}" aria-label="Remove offer ${i + 1}">${I.trash}</button>
    <div class="pos-field sg-offer-t"><label for="woX${i}">Details</label><input id="woX${i}" value="${esc(o.text)}" maxlength="300" placeholder="Shown under the title"></div>
    ${o.valid_till && o.valid_till < today() ? '<span class="md-chip out sg-offer-x">Expired — hidden on the website</span>' : ''}
  </div>`).join('') || '<p class="dl-muted" style="margin:4px 0 10px">No offers. The home page shows “Ask at the counter for today’s offers”.</p>';
}
function readOffers() { WOFF = [...document.querySelectorAll('[data-off]')].map(r => { const i = r.dataset.off; return { title: v(`woT${i}`).trim(), tag: v(`woG${i}`).trim(), valid_till: v(`woV${i}`), text: v(`woX${i}`).trim() }; }); }
RENDER.website = async () => {
  $('body').innerHTML = '<p class="dl-muted">Loading website settings…</p>';
  try { WS = await rpc('website_settings_get'); }
  catch (e) {
    WS = null;
    $('body').innerHTML = `<div class="sg-box"><p class="notice">${missing(e) ? 'Run database migration <b>0035_public_website.sql</b> to edit the home page from here. Until then the home page shows the pharmacy details from Business Information and built-in texts.' : esc(friendly(e))}</p></div>`;
    for (const b of document.querySelectorAll('[data-act]')) b.hidden = true;
    return;
  }
  const w = WS, d = w.delivery || {}, a = w.ayurveda || {}, so = w.socials || {}, im = w.images || {};
  WOFF = (w.offers || []).map(o => ({ title: o.title || '', tag: o.tag || '', valid_till: o.valid_till || '', text: o.text || '' }));
  WIMG = {};
  const hours = DAYS.map((n, i) => { const h = (w.hours || []).find(x => +x.day === i) || { open: '08:00', close: '21:00', closed: false };
    return `<div class="sg-hr"><b>${n}</b><input type="time" id="wo${i}" value="${esc(h.open)}" aria-label="${n} opens"${h.closed ? ' disabled' : ''}><span>to</span><input type="time" id="wc${i}" value="${esc(h.close)}" aria-label="${n} closes"${h.closed ? ' disabled' : ''}>
      <label class="sg-hr-c"><input type="checkbox" id="wx${i}"${h.closed ? ' checked' : ''}> Closed</label></div>`; }).join('');
  $('body').innerHTML = `
    <div class="sg-box">
      ${subh(I.globe, 'Home page', `<a class="dl-link" href="index.html" target="_blank" rel="noopener">View home page ↗</a>`)}
      ${togRow('wPub', I.globe, 'Show the full home page', w.published !== false, 'Off: visitors see only your contact details and “Website is being updated”')}
      <div class="md-form-grid sg-form">
        ${field('wHead', 'Main heading', w.headline, 'maxlength="80" required', true, '3–80 characters')}
        ${area('wHero', 'Text under the heading', w.hero_text, 'maxlength="300"')}
        ${area('wAbout', 'About us text', w.about_text, 'maxlength="800" rows="3"')}
        ${field('wWa', 'WhatsApp number', w.whatsapp, 'type="tel" maxlength="16" placeholder="Same as pharmacy phone when empty"', false, 'orders and prescriptions are sent here')}
        ${field('wMap', 'Map search text', w.map_query, 'maxlength="200" placeholder="e.g. Pallikkal Pharmacy, MG Road, Thrissur"', false, 'empty = pharmacy name and address')}
      </div>
      ${togRow('wStock', I.search || I.globe, '“Is your medicine available?” search', w.stock_check !== false, 'Visitors see only Available / Ask us — never quantities or prices')}
      ${togRow('wLic', I.doc, 'Show drug licence numbers in the footer', w.show_drug_licence !== false)}
    </div>
    <div class="sg-box">
      ${subh(I.clock, 'Opening hours', '<small class="dl-muted">Shown on the home page. The Open / Closed switch on the billing screen overrides “open now”.</small>')}
      <div class="sg-hours">${hours}</div>
      <button type="button" class="pos-btn pos-btn-sm" id="wCopy" style="margin-top:10px">Copy Monday to Tuesday – Saturday</button>
    </div>
    <div class="sg-box">
      ${subh(I.store, 'Home delivery')}
      ${togRow('wDel', I.store, 'Home delivery available', d.enabled !== false)}
      <div class="md-form-grid sg-form sg-form3">
        ${field('wRad', 'Delivery distance (km)', d.radius_km ?? 5, 'type="number" min="0" max="100" step="0.5"')}
        ${field('wMin', 'Minimum order (₹)', d.min_order ?? 0, 'type="number" min="0" max="100000" step="1"')}
        ${field('wNote', 'Delivery note', d.note, 'maxlength="200"')}
      </div>
    </div>
    <div class="sg-box">
      ${subh(I.wallet, 'Offers', `<small class="dl-muted">Up to 12 · expired offers hide automatically</small>`)}
      <div id="wOffers">${offerRows()}</div>
      <button type="button" class="pos-btn pos-btn-sm" id="wAddOff">${I.plus}<span>Add offer</span></button>
    </div>
    <div class="sg-box">
      ${subh(I.store, 'Ayurvedic sister store')}
      ${togRow('wAy', I.store, 'Show the Ayurvedic store section', a.enabled !== false)}
      <div class="md-form-grid sg-form">
        ${field('wAyN', 'Store name', a.name, 'maxlength="80"')}
        ${field('wAyP', 'Phone', a.phone, 'type="tel" maxlength="30"')}
        ${area('wAyT', 'Description', a.text, 'maxlength="300"')}
        ${area('wAyA', 'Address', a.address, 'maxlength="200"')}
        ${field('wAyE', 'Email', a.email, 'type="email" maxlength="120"')}
        ${field('wAyW', 'Website', a.website, 'type="url" maxlength="200" placeholder="https://"')}
        ${field('wAyM', 'Map search text', a.map_query, 'maxlength="200" placeholder="empty = name and address"', true)}
      </div>
    </div>
    <div class="sg-box">
      ${subh(I.link, 'Social links', '<small class="dl-muted">Leave empty to hide · must start with https://</small>')}
      <div class="md-form-grid sg-form sg-form3">
        ${field('wFb', 'Facebook', so.facebook, 'type="url" maxlength="200" placeholder="https://facebook.com/…"')}
        ${field('wIg', 'Instagram', so.instagram, 'type="url" maxlength="200" placeholder="https://instagram.com/…"')}
        ${field('wYt', 'YouTube', so.youtube, 'type="url" maxlength="200" placeholder="https://youtube.com/…"')}
      </div>
    </div>
    <div class="sg-box">
      ${subh(I.photo, 'Photos', '<small class="dl-muted">JPG, PNG or WEBP up to 2 MB · empty = built-in illustration</small>')}
      <div class="sg-photos">${PHOTOS.map(([k, l, h]) => `<div class="sg-ph" data-ph="${k}"><div class="sg-ph-img" id="wpI_${k}">${im[k] ? `<img src="${esc(sitePhoto(im[k]))}" alt="">` : I.photo}</div>
        <b>${l}</b><small class="dl-muted">${h}</small><div class="sg-ph-a"><label class="pos-btn pos-btn-sm sg-file">${I.upload}<span>${im[k] ? 'Change' : 'Upload'}</span><input type="file" id="wpF_${k}" accept="image/png,image/jpeg,image/webp" hidden></label>
        <button type="button" class="pos-btn pos-btn-sm sg-danger" data-phdel="${k}"${im[k] ? '' : ' hidden'}>${I.trash}<span>Remove</span></button></div></div>`).join('')}</div>
    </div>
    <p class="sg-hint">${w.updated_at ? `Last saved ${esc(fmtDateWith(w.updated_at, S.general.date_format))} ${esc(fmtTimeWith(new Date(w.updated_at), S.general.time_format))}.` : 'Not saved yet — the home page is using the defaults shown here.'}</p>`;
  const body = $('body');
  body.onchange = e => {
    const x = e.target.id?.match(/^wx(\d)$/); if (x) { $(`wo${x[1]}`).disabled = $(`wc${x[1]}`).disabled = e.target.checked; }
    const f = e.target.id?.match(/^wpF_(\w+)$/);
    if (f) {
      const file = e.target.files?.[0]; if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2097152) { e.target.value = ''; return toast('Photo must be JPG, PNG or WEBP up to 2 MB.', true); }
      WIMG[f[1]] = file; $(`wpI_${f[1]}`).innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
      body.querySelector(`[data-phdel="${f[1]}"]`).hidden = false;
    }
  };
  body.onclick = e => {
    if (e.target.closest('#wCopy')) { for (let i = 2; i <= 6; i++) { $(`wo${i}`).value = v('wo1'); $(`wc${i}`).value = v('wc1'); $(`wx${i}`).checked = c('wx1'); $(`wo${i}`).disabled = $(`wc${i}`).disabled = c('wx1'); } dirty = true; updateSaveState(); return; }
    if (e.target.closest('#wAddOff')) { readOffers(); if (WOFF.length >= 12) return toast('Up to 12 offers.', true); WOFF.push({ title: '', tag: '', valid_till: '', text: '' }); $('wOffers').innerHTML = offerRows(); $(`woT${WOFF.length - 1}`).focus(); dirty = true; updateSaveState(); return; }
    const del = e.target.closest('[data-deloff]');
    if (del) { readOffers(); WOFF.splice(+del.dataset.deloff, 1); $('wOffers').innerHTML = offerRows(); dirty = true; updateSaveState(); return; }
    const pd = e.target.closest('[data-phdel]');
    if (pd) { const k = pd.dataset.phdel; WIMG[k] = 'remove'; $(`wpF_${k}`).value = ''; $(`wpI_${k}`).innerHTML = I.photo; pd.hidden = true; dirty = true; updateSaveState(); }
  };
};
SAVE.website = async () => {
  if (!WS) throw new Error('Run database migration 0035 (website) first.');
  readOffers();
  const offers = WOFF.filter(o => o.title || o.text || o.tag);
  if (offers.some(o => o.title.length < 2)) throw new Error('Each offer needs a title.');
  if (v('wHead').trim().length < 3) throw new Error('Main heading must be at least 3 characters.');
  const hours = DAYS.map((_, i) => ({ day: i, open: v(`wo${i}`) || '08:00', close: v(`wc${i}`) || '21:00', closed: c(`wx${i}`) }));
  const bad = hours.find(h => !h.closed && h.close <= h.open);
  if (bad) throw new Error(`${DAYS[bad.day]}: closing time must be after opening time.`);
  // photos: upload new ones first; the save checks that every photo exists in this branch's folder
  const images = { ...(WS.images || {}) }, oldPaths = [];
  for (const [k] of PHOTOS) {
    const f = WIMG[k];
    if (f === 'remove') { if (images[k]) oldPaths.push(images[k]); images[k] = ''; }
    else if (f) {
      const path = `${prof.branch_id}/site-${k}-${Date.now()}.${f.type === 'image/jpeg' ? 'jpg' : f.type.split('/')[1]}`;
      const { error } = await sb.storage.from('pharmacy-branding').upload(path, f, { contentType: f.type, upsert: true });
      if (error) throw error;
      if (images[k]) oldPaths.push(images[k]);
      images[k] = path;
    }
  }
  WS = await rpc('website_settings_save', { p: {
    published: c('wPub'), headline: v('wHead').trim(), hero_text: v('wHero').trim(), about_text: v('wAbout').trim(), whatsapp: v('wWa').trim(), map_query: v('wMap').trim(),
    stock_check: c('wStock'), show_drug_licence: c('wLic'), hours,
    delivery: { enabled: c('wDel'), radius_km: +v('wRad') || 0, min_order: +v('wMin') || 0, note: v('wNote').trim() },
    offers,
    ayurveda: { enabled: c('wAy'), name: v('wAyN').trim(), text: v('wAyT').trim(), address: v('wAyA').trim(), phone: v('wAyP').trim(), email: v('wAyE').trim(), website: v('wAyW').trim(), map_query: v('wAyM').trim() },
    socials: { facebook: v('wFb').trim(), instagram: v('wIg').trim(), youtube: v('wYt').trim() },
    images
  } });
  if (oldPaths.length) sb.storage.from('pharmacy-branding').remove(oldPaths).then(() => {}, () => {});
  return 'Website saved. The home page shows the changes now.';
};
RESET.website = async () => 'Changes discarded.';

// ---------------------------------------------------------------------------
// Users & permissions
// ---------------------------------------------------------------------------
const ROLE_NAME = { super_admin: 'Super Admin', admin: 'Admin', pharmacist: 'Pharmacist', billing_staff: 'Billing Staff', inventory_staff: 'Inventory Staff', delivery_person: 'Delivery Staff' };
const PERM_LABEL = { 'sales.create': 'Create bills', 'sales.view': 'View sales', 'sales.discount': 'Give discounts', 'sales.return': 'Process returns', 'sales.void': 'Cancel bills', 'sales.gst_edit': 'Change GST on a bill', 'sales.mrp_edit': 'Change MRP on a bill', 'sales.batch_override': 'Choose another batch' };
RENDER.users = async () => {
  $('body').innerHTML = '<p class="dl-muted">Loading staff…</p>';
  let roles = [], staff = [];
  try { [roles, staff] = await Promise.all([rpc('staff_roles_permissions'), rpc('staff_list')]); }
  catch (e) { $('body').innerHTML = `<p class="dl-muted">${esc(missing(e) ? 'Roles and staff details need migration 0031 (Staff). You can still manage logins on the Staff page.' : friendly(e))}</p><div class="sg-btns"><a class="pos-btn pos-btn-solid" href="staff.html">${I.users}<span>Open Staff</span></a></div>`; return; }
  if (current !== 'users') return;
  const active = staff.filter(s => s.is_active), pw = active.filter(s => s.must_change_password).length;
  const perms = [...new Set(roles.flatMap(r => r.permissions || []))].sort();
  $('body').innerHTML = `
    <div class="sg-stats"><div><b>${count(staff.length)}</b><span>Logins</span></div><div><b>${count(active.length)}</b><span>Active</span></div><div><b>${count(staff.length - active.length)}</b><span>Inactive</span></div><div><b>${count(pw)}</b><span>Must change password</span></div></div>
    <div class="sg-btns"><a class="pos-btn pos-btn-solid" href="staff.html?show=add">${I.plus}<span>Add Staff</span></a><a class="pos-btn" href="staff.html?show=roles">${I.shield}<span>Assign Roles</span></a><a class="pos-btn" href="staff.html">${I.users}<span>Manage Staff</span></a><a class="pos-btn" href="change-password.html">${I.key}<span>Change My Password</span></a><a class="pos-btn" href="audit-logs.html">${I.list}<span>Audit Logs</span></a></div>
    <div class="sg-box">${subh(I.users, 'Roles')}
      <div class="sg-roles">${roles.map(r => `<div class="sg-role"><b>${esc(r.name)}</b><span>${count(r.staff)} active</span><small>${(r.permissions || []).length} permission${(r.permissions || []).length === 1 ? '' : 's'}</small></div>`).join('')}</div></div>
    <div class="sg-box">${subh(I.shield, 'What each role can do')}
      <div class="dl-table-wrap st-perm-wrap"><table class="st-perm sg-perm"><thead><tr><th>Permission</th>${roles.map(r => `<th>${esc(r.name)}</th>`).join('')}</tr></thead>
      <tbody>${perms.map(p => `<tr><td>${esc(PERM_LABEL[p] || p)}</td>${roles.map(r => `<td>${(r.permissions || []).includes(p) ? `<span class="st-yes">${I.tick}</span>` : '<span class="st-no">–</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
    <div class="sg-box">${subh(I.list, 'Staff logins')}
      <div class="dl-table-wrap"><table class="dl-table sg-staff"><thead><tr><th>Name</th><th>Staff ID</th><th>Role</th><th>Last login</th><th>Status</th></tr></thead><tbody>
      ${staff.map(s => `<tr><td><b>${esc(s.full_name)}</b>${s.is_self ? ' <span class="md-chip blue">You</span>' : ''}</td><td>${esc(s.staff_id)}</td><td>${esc(ROLE_NAME[s.role] || s.role_name || s.role)}</td><td>${esc(when(s.last_login))}</td><td>${s.is_active ? (s.must_change_password ? '<span class="md-chip low">Password not set</span>' : '<span class="md-chip in">Active</span>') : '<span class="md-chip off">Inactive</span>'}</td></tr>`).join('')}</tbody></table></div></div>`;
};

// ---------------------------------------------------------------------------
// Billing & subscription
// ---------------------------------------------------------------------------
RENDER.billing = () => {
  const b = S.billing, lic = S.license;
  const left = lic.valid_to ? Math.round((new Date(lic.valid_to + 'T00:00:00Z') - new Date(today() + 'T00:00:00Z')) / 86400000) : null;
  $('body').innerHTML = `
    <div class="sg-box">${subh(I.card, 'Billing rules', '<small class="dl-muted">Enforced by the server on every bill of this branch</small>')}
      <div class="md-form-grid sg-form sg-form3">
        ${field('blDisc', 'Maximum discount %', num(b.max_discount_pct), 'type="number" min="0" max="100" step="0.5"', false, '0–100')}
        ${field('blRes', 'Stock reservation (minutes)', num(b.reservation_minutes), 'type="number" min="1" max="240" step="1"', false, 'cart holds stock this long')}
        ${field('blNear', 'Near-expiry warning (days)', num(b.near_expiry_days), 'type="number" min="0" max="730" step="1"', false, 'warn when selling')}
      </div>
      <p class="sg-hint">${b.updated_at ? `Last changed ${esc(when(b.updated_at))}.` : 'Using the default values.'} Staff discount, GST, MRP and batch permissions are set per role (Users &amp; Permissions).</p>
    </div>
    <div class="sg-box">${subh(I.shield, 'Subscription & licence')}
      <div class="sg-plan">
        <div class="sg-plan-main"><small>Plan</small><b>${esc(lic.type || '—')}</b><span>${lic.licensed_to ? `Licensed to ${esc(lic.licensed_to)}` : 'Licence holder not set'}</span></div>
        <div><small>Valid up to</small><b>${lic.valid_to ? esc(dmy(lic.valid_to)) : 'No expiry'}</b><span class="${left !== null && left < 0 ? 'sg-bad' : left !== null && left <= 30 ? 'sg-warn' : ''}">${left === null ? '—' : left < 0 ? `Expired ${-left} days ago` : `${left} days left`}</span></div>
        <div><small>Version</small><b>v${esc(APP_VERSION)}</b><span>Build ${esc(APP_BUILD)}</span></div>
      </div>
      <p class="sg-hint">${isSuper ? 'Change licence details under About &amp; License.' : 'Only Super Admin can change licence details.'} No payment is collected through this software.</p>
    </div>`;
};
SAVE.billing = async () => {
  if (need33()) throw new Error('Migration 0033 needed');
  const d = Number(v('blDisc')), r = Number(v('blRes')), n = Number(v('blNear'));
  if (!(d >= 0 && d <= 100)) throw new Error('Maximum discount must be between 0 and 100%.');
  if (!(r >= 1 && r <= 240) || !Number.isInteger(r)) throw new Error('Reservation must be 1 to 240 whole minutes.');
  if (!(n >= 0 && n <= 730) || !Number.isInteger(n)) throw new Error('Near-expiry warning must be 0 to 730 days.');
  RAW = await rpc('settings_save_billing', { p_max_discount: d, p_reservation: r, p_near_expiry: n }); S = storeSettings(RAW, S.branding.logo_url);
  return 'Billing rules saved.';
};
RESET.billing = async () => { if (need33()) throw new Error('Migration 0033 needed'); await resetSection('billing'); };

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
RENDER.notifications = async () => {
  const n = S.notifications, g = S.general;
  $('body').innerHTML = `
    <div class="sg-box">${subh(I.bell, 'Stock alerts')}
      ${togRow('nLow', I.alarm, 'Low stock alerts', g.low_stock_alerts, 'Medicines at or below their reorder level')}
      ${togRow('nExp', I.alarm, 'Expiry alerts', g.expiry_alerts, 'Expired stock and batches expiring soon')}
      <div class="sg-srow"><span class="sg-ric a">${I.cal}</span><label for="nDays">Alert for batches expiring within</label><select id="nDays">${[15, 30, 45, 60, 90, 120, 180].concat([n.expiry_days]).filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b).map(x => `<option value="${x}"${x === n.expiry_days ? ' selected' : ''}>${x} days</option>`).join('')}</select></div>
    </div>
    <div class="sg-box">${subh(I.bell, 'Other alerts in the bell')}
      ${togRow('nDel', I.alarm, 'Delivery requests not assigned', n.deliveries)}
      ${togRow('nDraft', I.alarm, 'Expense drafts not posted', n.expense_drafts)}
      ${togRow('nDeact', I.alarm, 'Medicine deactivation requests', n.deactivations)}
      ${togRow('nBak', I.alarm, 'Backup reminder', n.backup_reminder, 'When no backup was taken in the last 7 days')}
      <div class="sg-srow" id="docRow" hidden><span class="sg-ric b">${I.doc}</span><label for="nDoc">Document expiry reminder (days before)</label><input id="nDoc" type="number" min="1" max="365"></div>
    </div>
    <p class="sg-hint">Alerts appear in the bell on the Dashboard. Document reminders also show on the Documents page.</p>`;
  try { const o = await rpc('documents_overview'); docDays = o?.default_remind_days ?? null; } catch { docDays = null; }
  if (docDays !== null && $('docRow')) { $('docRow').hidden = false; $('nDoc').value = docDays; }
};
SAVE.notifications = async () => {
  if (need33()) throw new Error('Migration 0033 needed');
  const days = +v('nDoc');
  if (docDays !== null && !(days >= 1 && days <= 365)) throw new Error('Document reminder must be 1 to 365 days.');
  await saveSection('general', { ...S.general, low_stock_alerts: c('nLow'), expiry_alerts: c('nExp') });
  await saveSection('notifications', { ...S.notifications, expiry_days: +v('nDays'), deliveries: c('nDel'), expense_drafts: c('nDraft'), deactivations: c('nDeact'), backup_reminder: c('nBak') });
  if (docDays !== null && days !== docDays) await rpc('document_settings_save', { p_default_days: days });
  return 'Notification settings saved.';
};
RESET.notifications = async () => { if (need33()) throw new Error('Migration 0033 needed'); await resetSection('notifications'); await saveSection('general', { ...S.general, low_stock_alerts: true, expiry_alerts: true }); };

// ---------------------------------------------------------------------------
// Print & invoice
// ---------------------------------------------------------------------------
const SAMPLE = () => ({
  shop: { name: profile?.name || 'PALLIKKAL PHARMACY', address: [profile?.address, profile?.city, profile?.pincode].filter(Boolean).join(', '), phone: profile?.phone, gstin: profile?.gstin,
    drug_licence: (profile?.drug_licence_nos || []).join(', '), footer_note: v('iFooter') },
  invoice: { invoice_no: `${v('iPrefix') || 'INV'}-${today().replace(/-/g, '').slice(2)}-0001`, created_at: new Date().toISOString(), subtotal: 186.6, discount: 0, line_discount: 9.8, tax: 19.99, total: 186.6, patient_name: 'Anu Thomas', doctor_name: 'Dr. Rajan' },
  customer: { name: 'Anu Thomas', phone: '9847012345' },
  items: [{ name: 'Paracetamol 650', strength: 'Tablet', batch_no: 'PCM2411', expiry: '2027-08-31', qty: 10, unit_price: 2.1, discount_pct: 0, tax_rate: 12, line_total: 21, price_includes_tax: true },
    { name: 'Amoxicillin 500', strength: 'Capsule', batch_no: 'AMX5521', expiry: '2027-03-31', qty: 10, unit_price: 9.8, discount_pct: 5, tax_rate: 12, line_total: 93.1, price_includes_tax: true },
    { name: 'Cough Syrup', strength: '100 ml', batch_no: 'CS7781', expiry: '2026-12-31', qty: 1, unit_price: 72.5, discount_pct: 0, tax_rate: 12, line_total: 72.5, price_includes_tax: true }],
  payments: [{ method: 'upi', amount: 186.6 }],
  tax_summary: [{ rate: 12, taxable: 166.61, tax: 19.99 }]
});
RENDER.invoice = () => {
  const iv = S.invoice, p = profile || {};
  $('body').innerHTML = `<div class="sg-inv">
    <div class="sg-inv-form">
      <div class="sg-box">${subh(I.doc, 'Invoice details')}
        <div class="md-form-grid sg-form">
          ${field('iPrefix', 'Invoice number prefix', p.invoice_prefix, 'maxlength="12" required', false, 'e.g. INV')}
          <div class="pos-field"><label for="iFmt">Default paper</label><select id="iFmt"><option value="thermal"${iv.default_format === 'thermal' ? ' selected' : ''}>Thermal 80mm</option><option value="a4"${iv.default_format === 'a4' ? ' selected' : ''}>A4</option></select></div>
          ${area('iFooter', 'Invoice footer', p.invoice_footer, 'maxlength="300" placeholder="e.g. Thank you! Get well soon."')}
          ${area('iTerms', 'Terms printed on the bill', iv.terms, 'maxlength="500" placeholder="e.g. Medicines once sold will be taken back only with a valid reason within 7 days."')}
        </div></div>
      <div class="sg-box">${subh(I.print, 'Show on the invoice')}
        ${togRow('iLogo', I.photo, 'Pharmacy logo', S.general.invoice_logo, S.branding.logo_url ? '' : 'No logo uploaded yet (Business Information)')}
        ${togRow('iGst', I.doc, 'GSTIN', iv.show_gstin)}
        ${togRow('iDl', I.doc, 'Drug licence numbers', iv.show_drug_licence)}
        ${togRow('iPat', I.users, 'Patient and doctor details', iv.show_patient)}
        ${togRow('iUpi', I.upi, 'UPI payment line', iv.show_upi, S.payments.upi_id ? `Pay by UPI: ${esc(S.payments.upi_id)}` : 'Add your UPI ID under Payment Methods')}
        ${togRow('iSign', I.pencil, 'Signature line (A4)', iv.signature_line)}
      </div>
    </div>
    <div class="sg-inv-prev"><div class="sg-prev-head"><b>Live preview</b><select id="iPrevFmt" data-nodirty aria-label="Preview paper"><option value="thermal">Thermal</option><option value="a4">A4</option></select></div><div class="sg-paper" id="iPrev"></div><small class="dl-muted">Sample bill using your saved pharmacy details.</small></div>
  </div>`;
  $('iPrevFmt').value = iv.default_format;
  const draw = () => {
    const T = clone(S);
    Object.assign(T.invoice, { default_format: v('iFmt'), terms: v('iTerms').trim(), show_gstin: c('iGst'), show_drug_licence: c('iDl'), show_patient: c('iPat'), show_upi: c('iUpi'), signature_line: c('iSign') });
    T.general.invoice_logo = c('iLogo');
    $('iPrev').className = `sg-paper ${v('iPrevFmt')}`;
    $('iPrev').innerHTML = invoiceHTML(SAMPLE(), v('iPrevFmt'), T);
  };
  $('body').oninput = $('body').onchange = draw;
  $('iFmt').addEventListener('change', () => { $('iPrevFmt').value = v('iFmt'); draw(); });
  draw();
};
SAVE.invoice = async () => {
  const prefix = v('iPrefix').trim();
  if (!/^[A-Za-z0-9/-]{1,12}$/.test(prefix)) throw new Error('Invoice prefix: 1–12 letters, numbers, - or /.');
  if (c('iUpi') && !S.payments.upi_id) throw new Error('Add your UPI ID under Payment Methods before printing the UPI line.');
  if (prefix !== (profile?.invoice_prefix || '') || v('iFooter').trim() !== (profile?.invoice_footer || '')) await saveProfile(profilePayload({ invoice_prefix: prefix, invoice_footer: v('iFooter') }));
  if (has33) {
    await saveSection('invoice', { ...S.invoice, default_format: v('iFmt'), terms: v('iTerms').trim(), show_gstin: c('iGst'), show_drug_licence: c('iDl'), show_patient: c('iPat'), show_upi: c('iUpi'), signature_line: c('iSign') });
    if (c('iLogo') !== S.general.invoice_logo) await saveSection('general', { ...S.general, invoice_logo: c('iLogo') });
  }
  return has33 ? 'Invoice settings saved.' : 'Invoice prefix and footer saved. Other options need migration 0033.';
};
RESET.invoice = async () => { if (need33()) throw new Error('Migration 0033 needed'); await resetSection('invoice'); };

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------
const METHODS = [['cash', I.cash, 'Cash', 'Notes and coins at the counter', true], ['card', I.card, 'Card', 'Debit / credit card on your machine', true], ['upi', I.upi, 'UPI', 'Google Pay, PhonePe, Paytm…', true],
  ['wallet', I.wallet, 'Wallet', 'Recorded as UPI in the accounts', true], ['credit', I.credit, 'Credit (due)', 'Bill to a customer account within its credit limit', false], ['split', I.split, 'Other / split', 'Pay one bill with two or more methods', false]];
RENDER.payments = () => {
  const P = S.payments, on = new Set(P.enabled);
  $('body').innerHTML = `
    <div class="sg-box">${subh(I.wallet, 'Payment options on the billing screen')}
      <div class="sg-pm">${METHODS.map(([k, ic, l, d, canDef]) => `<div class="sg-pm-row" data-pm="${k}"><span class="sg-ric g">${ic}</span><span class="sg-pm-b"><b>${l}</b><small>${d}</small></span>
        ${canDef ? `<label class="sg-def"><input type="radio" name="pmDef" value="${k}"${P.default_method === k ? ' checked' : ''}> Default</label>` : '<span></span>'}${sw(`pm_${k}`, on.has(k))}</div>`).join('')}</div>
      <p class="sg-hint">The default method is selected when a new bill starts. Switched-off methods are hidden on the billing screen.</p>
    </div>
    <div class="sg-box">${subh(I.upi, 'UPI')}
      <div class="md-form-grid sg-form">
        ${field('pUpi', 'UPI ID', P.upi_id, 'maxlength="120" placeholder="e.g. pallikkal@okaxis" autocomplete="off" spellcheck="false"')}
        ${field('pUpiName', 'Name shown to the payer', P.upi_name, 'maxlength="80" placeholder="Pallikkal Pharmacy"')}
      </div>
      <div class="sg-btns"><button type="button" class="pos-btn pos-btn-sm" id="pTest">${I.link}<span>Copy UPI payment link</span></button></div>
      <p class="sg-hint">Turn on “UPI payment line” under Print &amp; Invoice to print the UPI ID on bills.</p>
    </div>`;
  $('pTest').onclick = async () => {
    const id = v('pUpi').trim(); if (!id) return toast('Enter the UPI ID first.', true);
    const link = `upi://pay?pa=${encodeURIComponent(id)}&pn=${encodeURIComponent(v('pUpiName').trim() || 'Pallikkal Pharmacy')}&cu=INR`;
    try { await navigator.clipboard.writeText(link); toast('UPI link copied. Paste it into WhatsApp to test from a phone.'); } catch { toast(link); }
  };
};
SAVE.payments = async () => {
  if (need33()) throw new Error('Migration 0033 needed');
  const enabled = METHODS.map(m => m[0]).filter(k => c(`pm_${k}`));
  const def = document.querySelector('input[name="pmDef"]:checked')?.value || 'cash';
  if (!enabled.length) throw new Error('Keep at least one payment method.');
  if (!enabled.includes(def)) throw new Error('The default method must be switched on.');
  await saveSection('payments', { enabled, default_method: def, upi_id: v('pUpi').trim(), upi_name: v('pUpiName').trim() });
  return 'Payment methods saved. The billing screen uses them from the next bill.';
};
RESET.payments = async () => { if (need33()) throw new Error('Migration 0033 needed'); await resetSection('payments'); };

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------
RENDER.whatsapp = async () => {
  $('body').innerHTML = '<p class="dl-muted">Loading…</p>';
  try { waSet = await rpc('whatsapp_settings_get'); }
  catch (e) { waSet = null; $('body').innerHTML = `<p class="dl-muted">${esc(missing(e) ? 'WhatsApp settings need migration 0030 (WhatsApp).' : friendly(e))}</p>`; for (const b of document.querySelectorAll('[data-act]')) b.hidden = true; return; }
  if (current !== 'whatsapp') return;
  const w = waSet || {};
  $('body').innerHTML = `
    <div class="sg-box">${subh(I.wa, 'Invoice on WhatsApp', '<span class="md-chip in">Free · one-tap send</span>')}
      ${togRow('wAuto', I.doc, 'Prepare the invoice message after every bill', w.auto_invoice !== false, 'For customers with a phone number')}
      ${togRow('wOpen', I.wa, 'Open WhatsApp straight after the bill', w.open_after_bill !== false, 'Staff only tap Send')}
      ${togRow('wLink', I.link, 'Add the offer photo link to campaign messages', w.attach_link_offers !== false)}
      ${area('wSign', 'Signature at the end of messages', w.signature, 'maxlength="300" placeholder="— Pallikkal Pharmacy, Main Road"')}
    </div>
    <div class="sg-kv"><div><small>Customer invoice link</small><b>${w.base_url ? esc(w.base_url) : 'Learned from the first invoice sent'}</b></div><div><small>Messages, templates and campaigns</small><b><a class="dl-link" href="whatsapp.html">Open WhatsApp page ${I.chev}</a></b></div></div>`;
};
SAVE.whatsapp = async () => { if (!waSet) throw new Error('WhatsApp settings are not available.'); await rpc('whatsapp_settings_save', { p_auto_invoice: c('wAuto'), p_open_after_bill: c('wOpen'), p_attach_link_offers: c('wLink'), p_signature: v('wSign').trim() || null }); return 'WhatsApp settings saved.'; };
RESET.whatsapp = async () => { if (!waSet) throw new Error('WhatsApp settings are not available.'); await rpc('whatsapp_settings_save', { p_auto_invoice: true, p_open_after_bill: true, p_attach_link_offers: true, p_signature: null }); };

// ---------------------------------------------------------------------------
// Backup & data
// ---------------------------------------------------------------------------
let restoreFile = null;
RENDER.backup = async () => {
  const g = S.general, n = S.notifications, lb = info?.last_backup;
  $('body').innerHTML = `
    <div class="sg-bk-top">
      <div class="sg-bk-card"><span class="sg-ric g">${I.cloud}</span><div><b>Backup Now</b><small>${lb ? `Last backup ${esc(when(lb.at))}${lb.by ? ` by ${esc(lb.by)}` : ''}` : 'No backup taken yet'}</small></div>
        <label class="st-check sg-small" data-nodirty><input type="checkbox" id="bkLogs" data-nodirty> Include audit logs</label>
        <button type="button" class="pos-btn pos-btn-solid pos-btn-sm" id="bkGo">${I.download}<span>Download backup</span></button></div>
      <div class="sg-bk-card"><span class="sg-ric b">${I.upload}</span><div><b>Restore</b><small>Settings, pharmacy details and master lists from a backup file</small></div>
        <label class="pos-btn pos-btn-sm sg-file" data-nodirty>${I.upload}<span>Choose backup file</span><input type="file" id="rsFile" accept=".json,application/json" hidden data-nodirty></label></div>
    </div>
    <div class="sg-box">${subh(I.sync, 'Automatic')}
      ${togRow('kAuto', I.alarm, 'Auto Backup (Daily)', g.auto_backup, 'The first Dashboard visit of the day downloads a backup file to that computer')}
      ${togRow('kRem', I.bell, 'Remind me when there is no backup for 7 days', n.backup_reminder)}
    </div>
    <div class="sg-box">${subh(I.db, 'Stored data')}
      <div class="sg-stats">${[['Medicines', 'medicines'], ['Customers', 'customers'], ['Distributors', 'distributors'], ['Bills', 'invoices'], ['Purchases', 'purchases'], ['Active staff', 'staff']].map(([l, k]) => `<div><b>${info?.counts ? count(info.counts[k]) : '—'}</b><span>${l}</span></div>`).join('')}</div>
      <div class="sg-kv"><div><small>Database size</small><b>${info?.database_size ? esc(size(info.database_size)) : '—'}</b></div><div><small>Files stored</small><b>${info?.files ? Object.entries(info.files).map(([b, x]) => `${esc(b)}: ${count(x.count)} (${esc(size(x.bytes))})`).join(' · ') || 'None' : '—'}</b></div><div><small>Audit log entries</small><b>${info?.counts ? count(info.counts.audit_logs) : '—'}</b></div></div>
    </div>
    <div class="sg-box">${subh(I.list, 'Backup history')}<div id="bkHist"><p class="dl-muted">Loading…</p></div></div>
    <p class="sg-hint">A backup is one file with all records of this branch (bills, stock, purchases, customers, accounts, staff details and settings). Uploaded files (documents, photos) are not inside it. Keep backups outside this computer. Restoring adds missing settings and list entries only; bills, stock and accounts are never overwritten from a file.</p>`;
  $('bkGo').onclick = () => backupNow(c('bkLogs'));
  $('rsFile').onchange = restorePick;
  if (!has33) { $('bkHist').innerHTML = '<p class="dl-muted">Needs migration 0033.</p>'; return; }
  try {
    const L = await rpc('settings_backup_list', { p_limit: 20 }) || [];
    if (!$('bkHist')) return;
    $('bkHist').innerHTML = L.length ? `<div class="dl-table-wrap"><table class="dl-table sg-bkt"><thead><tr><th>When</th><th>Type</th><th>Records</th><th>Size</th><th>By</th></tr></thead><tbody>${L.map(b => `<tr><td>${esc(when(b.created_at))}</td><td>${b.kind === 'auto' ? '<span class="md-chip blue">Auto</span>' : b.kind === 'restore' ? '<span class="md-chip pu">Restore</span>' : '<span class="md-chip in">Manual</span>'}${b.include_logs ? ' <small class="dl-muted">+ logs</small>' : ''}</td><td>${b.kind === 'restore' ? '—' : count(b.rows_count)}</td><td>${b.kind === 'restore' ? '—' : esc(size(b.size_bytes))}</td><td>${esc(b.by_name || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="dl-empty">No backups yet. Use Download backup.</p>';
  } catch (e) { $('bkHist').innerHTML = `<p class="dl-muted">${esc(friendly(e))}</p>`; }
};
SAVE.backup = async () => { if (need33()) throw new Error('Migration 0033 needed'); await saveSection('general', { ...S.general, auto_backup: c('kAuto') }); await saveSection('notifications', { ...S.notifications, backup_reminder: c('kRem') }); return 'Backup settings saved.'; };
RESET.backup = async () => { if (need33()) throw new Error('Migration 0033 needed'); await saveSection('general', { ...S.general, auto_backup: false }); await saveSection('notifications', { ...S.notifications, backup_reminder: true }); };
async function restorePick() {
  const f = $('rsFile').files?.[0]; $('rsFile').value = '';
  if (!f) return;
  if (need33()) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch { return toast('This file is not a backup (it is not valid JSON).', true); }
  if (data?.format !== 'pallikkal-pharmacy-backup' || typeof data.tables !== 'object') return toast('This is not a Pallikkal Pharmacy backup file.', true);
  restoreFile = data;
  const t = data.tables, n = k => (t[k] || []).length;
  const parts = [['settings', 'Settings (preferences, invoice, payments, alerts, billing rules)', n('pharmacy_settings') + n('billing_settings')],
    ['branch', 'Pharmacy details (name, address, GSTIN, licences, invoice prefix)', n('branches')],
    ['masters', 'Categories, manufacturers, storage locations, units and conversions', n('categories') + n('manufacturers') + n('storage_locations') + n('units') + n('unit_conversions')],
    ['expense_categories', 'Expense categories', n('expense_categories')]];
  dlg(`<h3 class="rt-dlg-title">${I.upload} Restore from backup</h3>
    <div class="sg-kv"><div><small>File</small><b>${esc(f.name)}</b></div><div><small>Taken</small><b>${esc(when(data.created_at))}</b></div><div><small>Branch</small><b>${esc(data.branch || '—')}${data.branch_id && data.branch_id !== prof.branch_id ? ' <span class="md-chip low">Another branch</span>' : ''}</b></div></div>
    <p>Choose what to bring back. Missing entries are added and settings are replaced; nothing is deleted. Bills, stock, purchases and accounts are not restored from a file.</p>
    <div class="sg-rs">${parts.map(([k, l, cnt]) => `<label class="st-check"><input type="checkbox" data-part="${k}"${cnt ? ' checked' : ' disabled'}> ${l} <small class="dl-muted">(${count(cnt)} in file)</small></label>`).join('')}</div>
    <p class="pos-form-msg" id="rsErr"></p>
    <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="rsGo">${I.upload}<span>Restore</span></button></div>`, 'sg-form-dlg');
  $('rsGo').onclick = async () => {
    const p = [...$('puPanel').querySelectorAll('[data-part]:checked')].map(x => x.dataset.part);
    if (!p.length) return ($('rsErr').textContent = 'Choose at least one item.');
    if (!confirm('Restore the selected items now?')) return;
    $('rsGo').disabled = true;
    try {
      const r = await rpc('settings_restore', { p_data: restoreFile, p_parts: p });
      $('puDlg').close();
      const added = Object.entries(r || {}).map(([k, x]) => `${k.replace(/_/g, ' ')}: ${x}`).join(', ');
      toast(`Restored — ${added}.`);
      await loadAll(); show('backup', true);
    } catch (e) { $('rsErr').textContent = friendly(e); $('rsGo').disabled = false; }
  };
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------
RENDER.integrations = async () => {
  const card = (id, ic, cls, name, desc) => `<div class="sg-int" id="${id}"><span class="sg-ric ${cls}">${ic}</span><div><b>${name}</b><small>${desc}</small></div><span class="md-chip off sg-int-st">Checking…</span></div>`;
  $('body').innerHTML = `<div class="sg-ints">
    ${card('intDb', I.db, 'g', 'Supabase database', esc(new URL(SUPABASE_URL).host))}
    ${card('intStaff', I.users, 'b', 'Staff login service', 'Edge Function admin-staff (create logins, reset passwords)')}
    ${card('intWa', I.wa, 'g', 'WhatsApp', 'Free click-to-chat: invoices and campaigns open in WhatsApp, staff tap Send')}
    ${card('intInv', I.doc, 'p', 'Customer invoice link', 'invoice-view.html — customers open their bill from the WhatsApp message')}
    ${card('intDocs', I.doc, 'a', 'File storage', 'Supplier bills, documents, staff photos and the logo')}
  </div><p class="sg-hint">Paid WhatsApp Business API, SMS or email gateways are not connected. The software works without them.</p>`;
  const set = (id, ok, txt) => { const el = $(id)?.querySelector('.sg-int-st'); if (el) { el.className = `md-chip ${ok === true ? 'in' : ok === false ? 'out' : 'low'} sg-int-st`; el.textContent = txt; } };
  const t0 = performance.now(); const ping = await sb.rpc('settings_get');
  set('intDb', !ping.error || !missing(ping.error), ping.error && !missing(ping.error) ? 'Error' : `Connected · ${Math.round(performance.now() - t0)} ms`);
  sb.functions.invoke('admin-staff', { body: { action: 'list' } }).then(({ data, error }) => set('intStaff', !error && !data?.error, !error && !data?.error ? 'Working' : 'Not deployed')).catch(() => set('intStaff', false, 'Not deployed'));
  sb.rpc('whatsapp_settings_get').then(({ data, error }) => { set('intWa', !error, error ? 'Needs migration 0030' : 'Ready'); set('intInv', !error && !!data?.base_url, error ? 'Needs migration 0030' : data?.base_url ? 'Ready' : 'Not used yet'); });
  set('intDocs', info?.files ? true : null, info?.files ? `${count(Object.values(info.files).reduce((a, x) => a + num(x.count), 0))} files` : 'Unknown');
};

// ---------------------------------------------------------------------------
// System preferences — master lists (kept from the old page) + unit conversions
// ---------------------------------------------------------------------------
const MASTERS = [['categories', 'Categories', false], ['manufacturers', 'Manufacturers', false], ['storage_locations', 'Storage locations (shelf/rack areas)', false], ['units', 'Units', true]];
let units = [];
RENDER.system = () => {
  $('body').innerHTML = `<div class="sg-masters">${MASTERS.map(([t, l, u]) => `
    <section class="sg-box sg-master" data-t="${t}">
      ${subh(I.list, l, '<small class="dl-muted sg-mcount"></small>')}
      <div class="sg-madd" data-nodirty><input class="n" placeholder="Name" aria-label="New ${l} name" data-nodirty>${u ? '<input class="c" placeholder="Code (e.g. strip)" aria-label="Unit code" data-nodirty>' : ''}<button type="button" class="pos-btn pos-btn-solid pos-btn-sm add">${I.plus}<span>Add</span></button></div>
      <input class="sg-mq" type="search" placeholder="Search…" aria-label="Search ${l}" data-nodirty>
      <div class="err pos-form-msg"></div>
      <ul class="list sg-mlist"></ul>
    </section>`).join('')}
    <section class="sg-box sg-master" id="conv">
      ${subh(I.sync, 'Unit conversions')}
      <p class="dl-muted sg-small">Example: 1 Strip = 10 Tablet</p>
      <div class="sg-madd sg-conv" data-nodirty>1 <select id="cf" data-nodirty aria-label="From unit"></select> = <input id="cn" type="number" step="0.0001" min="0.0001" data-nodirty aria-label="Factor"> <select id="ct" data-nodirty aria-label="To unit"></select><button type="button" class="pos-btn pos-btn-solid pos-btn-sm" id="ca">${I.plus}<span>Add</span></button></div>
      <div id="cerr" class="pos-form-msg"></div>
      <ul id="cl" class="sg-mlist"></ul>
    </section></div>`;
  for (const sec of $('body').querySelectorAll('section[data-t]')) {
    sec.onclick = e => masterClick(sec, e);
    sec.querySelector('.sg-mq').oninput = () => paintMaster(sec);
    sec.querySelector('.n').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sec.querySelector('.add').click(); } };
    renderMaster(sec);
  }
  $('ca').onclick = addConv; $('cl').onclick = delConv;
};
const masterRows = new Map();
async function renderMaster(sec) {
  const t = sec.dataset.t;
  const { data, error } = await sb.from(t).select('*').order('name');
  if (error) { sec.querySelector('.err').textContent = friendly(error); return; }
  masterRows.set(t, data || []);
  if (t === 'units') { units = data || []; fillConv(); }
  paintMaster(sec);
}
function paintMaster(sec) {
  const t = sec.dataset.t, q = sec.querySelector('.sg-mq').value.trim().toLowerCase(), rows = masterRows.get(t) || [];
  const shown = rows.filter(r => !q || `${r.name} ${r.code || ''}`.toLowerCase().includes(q));
  sec.querySelector('.sg-mcount').textContent = `${rows.filter(r => r.active).length} active of ${rows.length}`;
  sec.querySelector('.list').innerHTML = shown.map(r => `
    <li class="${r.active ? '' : 'off'}" data-row="${r.id}"><span class="sg-mname">${esc(r.name)}${r.code ? ` <small>(${esc(r.code)})</small>` : ''}</span>
      <button type="button" class="sg-mbtn" data-ren="${r.id}" title="Rename" aria-label="Rename ${esc(r.name)}">${I.pencil}</button>
      <button type="button" class="sec sg-mtog ${r.active ? '' : 'on'}" data-id="${r.id}" data-a="${r.active}">${r.active ? 'Deactivate' : 'Activate'}</button></li>`).join('') || `<li class="sg-mempty">${rows.length ? 'No match.' : 'Nothing added yet.'}</li>`;
}
async function masterClick(sec, e) {
  const b = e.target.closest('button'); if (!b) return;
  const t = sec.dataset.t, err = sec.querySelector('.err');
  err.textContent = '';
  if (b.classList.contains('add')) {
    const name = sec.querySelector('.n').value.trim(), code = sec.querySelector('.c')?.value.trim();
    if (!name || (t === 'units' && !code)) { err.textContent = t === 'units' ? 'Enter the unit name and code.' : 'Enter a name.'; return; }
    if ((masterRows.get(t) || []).some(r => r.name.toLowerCase() === name.toLowerCase())) { err.textContent = `“${name}” is already in the list.`; return; }
    const { error } = await sb.from(t).insert(t === 'units' ? { name, code } : { name });
    if (error) { err.textContent = friendly(error); return; }
    sec.querySelector('.n').value = ''; if (sec.querySelector('.c')) sec.querySelector('.c').value = '';
    toast(`${name} added.`);
  } else if (b.dataset.id) {
    const { error } = await sb.from(t).update({ active: b.dataset.a !== 'true' }).eq('id', b.dataset.id);
    if (error) { err.textContent = friendly(error); return; }
  } else if (b.dataset.ren) {
    const r = (masterRows.get(t) || []).find(x => x.id === b.dataset.ren);
    const name = prompt('New name:', r?.name || ''); if (!name?.trim() || name.trim() === r.name) return;
    const { error } = await sb.from(t).update({ name: name.trim() }).eq('id', b.dataset.ren);
    if (error) { err.textContent = friendly(error); return; }
    toast('Renamed.');
  } else return;
  renderMaster(sec);
}
function fillConv() {
  const o = units.filter(u => u.active).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
  $('cf').innerHTML = o; $('ct').innerHTML = o;
  loadConv();
}
async function loadConv() {
  const { data, error } = await sb.from('unit_conversions').select('*');
  if (error) { $('cerr').textContent = friendly(error); return; }
  const n = id => units.find(u => u.id === id)?.name || '?';
  $('cl').innerHTML = (data || []).map(cv => `<li><span class="sg-mname">1 ${esc(n(cv.from_unit_id))} = ${cv.factor} ${esc(n(cv.to_unit_id))}</span><button type="button" class="sec sg-mtog" data-d="${cv.id}">Remove</button></li>`).join('') || '<li class="sg-mempty">No conversions yet.</li>';
}
async function addConv() {
  $('cerr').textContent = '';
  const factor = Number($('cn').value);
  if (!(factor > 0) || $('cf').value === $('ct').value) { $('cerr').textContent = 'Choose two different units and a factor above 0.'; return; }
  const { error } = await sb.from('unit_conversions').insert({ from_unit_id: $('cf').value, to_unit_id: $('ct').value, factor });
  if (error) $('cerr').textContent = friendly(error); else { $('cn').value = ''; loadConv(); }
}
async function delConv(e) {
  const id = e.target.closest('[data-d]')?.dataset.d; if (!id) return;
  const { error } = await sb.from('unit_conversions').delete().eq('id', id);
  if (error) { $('cerr').textContent = friendly(error); return; }
  loadConv();
}

// ---------------------------------------------------------------------------
// About & license
// ---------------------------------------------------------------------------
RENDER.about = () => {
  const L = S.license, sp = S.support;
  $('body').innerHTML = `
    <div class="sg-about"><img src="assets/images/brand/favicon.png" alt="" class="sg-about-logo"><div><b>Pallikkal Pharmacy Management</b><span>Version v${esc(APP_VERSION)} · build ${esc(APP_BUILD)}</span><span>${esc(RAW?.branding?.pharmacy_name || '')} · ${esc(RAW?.branding?.branch_name || '')}</span></div>
      <button type="button" class="pos-btn pos-btn-sm" id="abUp">${I.sync}<span>Check for updates</span></button></div>
    <div class="sg-box">${subh(I.shield, 'Licence', isSuper ? '' : '<small class="dl-muted">Only Super Admin can change these</small>')}
      <div class="md-form-grid sg-form sg-form3">
        <div class="pos-field"><label for="lType">License type</label><select id="lType"${isSuper ? '' : ' disabled'}>${['Professional', 'Standard', 'Enterprise', 'Trial'].concat(L.type && !['Professional', 'Standard', 'Enterprise', 'Trial'].includes(L.type) ? [L.type] : []).map(x => `<option${x === L.type ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
        ${field('lValid', 'Valid up to', L.valid_to, `type="date"${isSuper ? '' : ' disabled'}`, false, 'empty = no expiry')}
        ${field('lTo', 'Licensed to', L.licensed_to, `maxlength="120"${isSuper ? '' : ' disabled'}`)}
      </div></div>
    <div class="sg-box">${subh(I.headset, 'Support contact', '<small class="dl-muted">Used by Contact Support</small>')}
      <div class="md-form-grid sg-form">
        ${field('sName', 'Name', sp.name, 'maxlength="80" placeholder="e.g. IT Support"')}
        ${field('sPhone', 'Phone / WhatsApp', sp.phone, 'type="tel" maxlength="30"')}
        ${field('sEmail', 'Email', sp.email, 'type="email" maxlength="120"')}
        ${field('sWeb', 'Website', sp.website, 'maxlength="200" placeholder="https://"')}
      </div></div>
    <div class="sg-box">${subh(I.list, 'What’s new')}<ul class="sg-news" id="news">${NEWS.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  $('abUp').onclick = async () => { await checkUpdates(); toast(upd?.msg || ''); };
};
const NEWS = ['Settings redesigned: preferences, invoice layout with live preview, payment methods, alerts, backup & restore.', 'Documents: licences, GST, agreements and insurance with expiry reminders.', 'Staff: attendance, leaves, roles and performance.', 'WhatsApp: invoice after every bill and bulk messages with photos, free.', 'Reports & analytics with saved reports.'];
SAVE.about = async () => {
  if (need33()) throw new Error('Migration 0033 needed');
  if (isSuper) await saveSection('license', { type: v('lType'), valid_to: v('lValid'), licensed_to: v('lTo').trim() });
  await saveSection('support', { name: v('sName').trim(), phone: v('sPhone').trim(), email: v('sEmail').trim(), website: v('sWeb').trim() });
  return 'Saved.';
};
RESET.about = async () => { if (need33()) throw new Error('Migration 0033 needed'); await resetSection('support'); };

// ---------------------------------------------------------------------------
// Search, bell, start
// ---------------------------------------------------------------------------
const KEYWORDS = { general: 'language date time format currency low stock expiry alert backup logo', business: 'pharmacy name address gstin gst drug licence phone email logo tagline', website: 'website home page opening hours timings offers delivery radius minimum order ayurvedic store whatsapp map social facebook instagram youtube photos stock check', users: 'staff roles permissions password login', billing: 'discount reservation near expiry plan subscription licence', notifications: 'alerts bell expiry low stock reminder', invoice: 'print invoice prefix footer paper thermal a4 terms upi signature', payments: 'cash card upi wallet credit split payment', whatsapp: 'whatsapp message signature invoice', backup: 'backup restore data export database', integrations: 'supabase edge function storage', system: 'categories manufacturers storage location units conversion master', about: 'version license support contact update' };
mountGlobalSearch({ sb, prof, placeholder: 'Search settings, features or configuration...', extra: q => {
  const s = q.toLowerCase();
  return SECTIONS.filter(([k, l, , sub]) => `${l} ${sub} ${KEYWORDS[k]}`.toLowerCase().includes(s)).slice(0, 5).map(([k, l, , sub]) => ({ g: 'Settings', t: l, s: sub, h: `settings.html#${k}`, run: () => show(k) }));
} });
function notify() {
  const items = [], lb = info?.last_backup;
  const days = lb ? Math.floor((Date.now() - new Date(lb.at)) / 86400000) : null;
  if (has33 && S.notifications.backup_reminder !== false && (days === null || days >= 7)) items.push({ tone: 'warn', title: days === null ? 'No backup taken yet' : `Last backup was ${days} days ago`, detail: 'Backup & Data → Download backup', href: 'settings.html#backup' });
  if (S.license.valid_to) { const left = Math.round((new Date(S.license.valid_to + 'T00:00:00Z') - new Date(today() + 'T00:00:00Z')) / 86400000); if (left <= 30) items.push({ tone: left < 0 ? 'danger' : 'warn', title: left < 0 ? 'Licence expired' : `Licence expires in ${left} days`, detail: 'About & License', href: 'settings.html#about' }); }
  if (!profile?.gstin) items.push({ tone: 'info', title: 'GSTIN not set', detail: 'Business Information', href: 'settings.html#business' });
  setNotifications(items);
}
await loadAll();
show(location.hash.slice(1) || 'general', true);
notify();
