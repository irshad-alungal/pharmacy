// Documents Management — Pallikkal Pharmacy design.
// Kept from the old page: supplier documents (purchase bill / credit note / delivery challan / other) upload
// with distributor and purchase-invoice link (Unassigned is Admin only, invoice must match the distributor),
// PDF / JPG / PNG / WEBP up to 15 MB, archive search, distributor filter, include removed, Open (Admin, signed
// link) and Remove with a reason (file retained).
// New (0032): pharmacy documents — licences, registrations, tax & compliance, agreements, insurance, staff
// documents and others — with reference no., issuing authority, issue / expiry dates, expiry status and
// reminders, folders, own categories, renewals with version history, edit, move, remove / restore, preview,
// download, activity log, CSV / print report and WhatsApp sharing of the expiry list.
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { printHTML } from './invoice.js';
import { setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';

const prof = await mountShell('documents', 'Documents', { layout: 'brand' });
const $ = id => document.getElementById(id);
const role = String(prof?.role || '').toLowerCase();
const admin = ['super_admin', 'admin'].includes(role);
const canUpload = ['super_admin', 'admin', 'pharmacist', 'inventory_staff', 'inventory'].includes(role);
const supplierRole = ['super_admin', 'admin', 'inventory_staff', 'inventory'].includes(role);
const branchId = prof?.branch_id;
if (!branchId) { $('view').innerHTML = '<p class="notice">Your profile has no assigned branch.</p>'; throw new Error('Missing branch'); }
document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');

const TZ = 'Asia/Kolkata';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const count = n => new Intl.NumberFormat('en-IN').format(num(n));
const ds = v => v ? String(v).slice(0, 10) : '';
const dmy = v => v ? new Date(ds(v) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const when = v => v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/, s => s.toUpperCase()) : '—';
const size = b => { b = num(b); return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`; };
const daysTxt = d => d === null || d === undefined ? '' : d < 0 ? `Expired ${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'Expires today' : `${d} day${d === 1 ? '' : 's'}`;
const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const I = {
  docs: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>', 1.8),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>', 1.8),
  check: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="m9 14 2 2 4-4"/>', 1.8),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 1.9),
  expired: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="m10 12 4 4M14 12l-4 4"/>', 1.8),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>', 2),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 2),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>', 1.9),
  folderPlus: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 10v6M9 13h6"/>', 1.9),
  dots: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 2),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 2.2),
  plusC: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', 2),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>', 1.9),
  refresh: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 2),
  renew: svg('<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>', 1.9),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>', 1.9),
  restore: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>', 1.9),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>', 1.9),
  wa: svg('<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3 3Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8c-1-.4-1.9-1.3-2.3-2.3l.8-1-1-2L9 9.5Z"/>', 1.6),
  print: svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>', 1.9),
  tag: svg('<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9Z"/><circle cx="8" cy="8" r="1.6"/>', 1.9),
  bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 20a2 2 0 0 0 4 0"/>', 1.9),
  report: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 17v-3M12 17v-5M15 17v-2"/>', 1.8),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>', 1.9),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', 1.9),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>', 1.9),
  xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
  tick: svg('<path d="m5 12 4 4 10-10"/>', 2.4),
  warn: svg('<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17h.01"/>', 2),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 1.9),
  move: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M10 13h6M13 10l3 3-3 3"/>', 1.9),
  up: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg class="md-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  // category icons
  licenses: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8"/><path d="M14 9h4M14 13h4"/>', 1.8),
  registrations: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><circle cx="12" cy="14" r="2.6"/><path d="m10.6 16.2-.9 3.3 2.3-1 2.3 1-.9-3.3"/>', 1.7),
  tax: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="m9.5 14.5 5-5"/><circle cx="9.8" cy="9.8" r=".9"/><circle cx="14.2" cy="14.2" r=".9"/>', 1.8),
  agreements: svg('<path d="m11 17 2 2a1.4 1.4 0 0 0 2-2"/><path d="m14 14 2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a2 2 0 0 0-2.8 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a3.5 3.5 0 0 1 4.3-.5l.5.3a2 2 0 0 0 1.4.2L21 6"/><path d="m21 3 1 9-1 1"/><path d="M3 3 2 12l6.5 6.5a1.4 1.4 0 0 0 2-2"/><path d="M3 4h8"/>', 1.6),
  insurance: svg('<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>', 1.8),
  staff: svg('<circle cx="9" cy="8" r="3.4"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.3c2.9.3 5 2.6 5 5.7"/>', 1.8),
  others: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>', 1.8),
  supplier: svg('<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>', 1.8)
};
const pdfIc = mime => mime === 'application/pdf'
  ? '<span class="dc-ftype pdf" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" fill="currentColor" opacity=".14"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 2v6h6" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="17.2" text-anchor="middle" font-size="5.6" font-weight="800" fill="currentColor" font-family="Arial">PDF</text></svg></span>'
  : '<span class="dc-ftype img" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/></svg></span>';
const COLORS = { green: 'Green', blue: 'Blue', amber: 'Amber', purple: 'Purple', teal: 'Teal', rose: 'Rose', gray: 'Grey', navy: 'Navy' };
const catIcon = code => I[code] || I.others;
const STATUS = { valid: ['Valid', 'in'], expiring: ['Expiring Soon', 'low'], expired: ['Expired', 'out'], removed: ['Removed', 'off'], archived: ['Old version', 'off'] };
const statusChip = d => { const [l, c] = STATUS[d.status] || [d.status, 'off']; return `<span class="md-chip ${c} dc-st">${l}</span>`; };
const catChip = d => `<span class="dc-cat ${esc(d.color || 'gray')}">${esc(d.category_name || d.category)}</span>`;
const SUP_TYPE = { purchase_bill: 'Purchase bill', credit_note: 'Credit note', delivery_challan: 'Delivery challan', other: 'Other' };
const KPI = (cls, ic, label, id) => `<button type="button" class="dz-kpi ${cls} md-kpi" data-kpi="${id}"><span class="dz-kpi-icon">${ic}</span><span class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></span></button>`;

let has32 = true, ov = null, cats = [], rows = [], total = 0, page = 1, view = 'list', distributors = [], purchases = [];
const per = () => view === 'grid' ? 12 : 8;
const params = new URLSearchParams(location.search);

$('view').innerHTML = `
<div class="pos dl md pur dc">
  <section class="pos-head">
    <div class="pos-title"><span class="pos-title-ic">${I.docs}</span>
      <div><h1>Documents Management</h1><p>Store, organize, and manage important pharmacy documents (licenses, GST, agreements, etc.)</p></div></div>
    <div class="pos-head-actions md-head-actions dc-head-actions">
      ${canUpload ? `<button type="button" class="pos-btn pos-btn-solid" id="uploadBtn">${I.upload}<span>Upload Document</span></button>` : ''}
      ${admin ? `<button type="button" class="pos-btn dc-btn-navy" id="folderBtn">${I.folderPlus}<span>New Folder</span></button>` : ''}
      <div class="dl-pop-anchor"><button type="button" class="pos-btn dc-btn-navy" id="moreBtn" aria-expanded="false">${I.dots}<span>More</span></button>
        <div class="dl-pop md-menu ds-menu dc-menu" id="moreMenu" hidden>
          ${admin ? `<button type="button" data-more="cats">${I.tag}<span>Manage categories</span></button>
          <button type="button" data-more="folders">${I.folder}<span>Manage folders</span></button>
          <button type="button" data-more="reminders">${I.bell}<span>Set expiry reminders</span></button>` : ''}
          <button type="button" data-more="csv">${I.download}<span>Download report (CSV)</span></button>
          <button type="button" data-more="print">${I.print}<span>Print / PDF report</span></button>
          <button type="button" data-more="share">${I.wa}<span>Share expiry list on WhatsApp</span></button>
          <button type="button" data-more="removed">${I.trash}<span id="removedLbl">Show removed documents</span></button>
          <button type="button" data-more="archived">${I.history}<span>Old versions</span></button>
          ${admin ? `<button type="button" data-more="acts">${I.clock}<span>Document activity log</span></button>` : ''}
          <button type="button" data-more="refresh">${I.refresh}<span>Refresh</span></button>
        </div></div>
    </div>
  </section>

  <section class="dz-kpis md-kpis dc-kpis">
    ${KPI('green', I.docs, 'Total Documents', 'kTotal')}
    ${KPI('blue', I.check, 'Valid Documents', 'kValid')}
    ${KPI('amber', I.clock, 'Expiring Soon', 'kExpiring')}
    ${KPI('rose', I.expired, 'Expired Documents', 'kExpired')}
  </section>
  <div id="msg" class="md-msg" role="status"></div>

  <section class="pos-card dc-cats-card">
    <div class="dl-card-head"><h2>Document Categories</h2><button type="button" class="dl-link" id="catsAll">View All Categories ${I.arrow}</button></div>
    <div class="dc-cats" id="cats"></div>
  </section>

  <div class="dc-layout">
    <section class="pos-card dc-list" id="listCard">
      <div class="dl-card-head dc-list-head"><h2>All Documents</h2>
        <div class="dc-tools">
          <label class="dl-select dc-view"><span>View:</span><select id="fView" aria-label="View"><option value="list">List</option><option value="grid">Grid</option></select></label>
          <label class="dl-search dc-q">${I.search}<input id="q" type="search" placeholder="Search documents..." autocomplete="off" aria-label="Search documents"></label>
          <label class="dl-select dc-fcat"><select id="fCat" aria-label="Category"><option value="">All Categories</option></select></label>
          <label class="dl-select dc-fst"><select id="fStatus" aria-label="Status"><option value="">All Status</option><option value="valid">Valid</option><option value="expiring">Expiring Soon</option><option value="expired">Expired</option><option value="attention">Expiring + Expired</option><option value="no_expiry">No expiry date</option><option value="archived">Old versions</option><option value="removed">Removed</option></select></label>
          <label class="dl-select dc-ffold"><select id="fFolder" aria-label="Folder"><option value="">All Folders</option></select></label>
          <label class="dl-select dc-fsort"><select id="fSort" aria-label="Sort"><option value="recent">Newest first</option><option value="expiry">Expiry date</option><option value="name">Name A–Z</option><option value="oldest">Oldest first</option></select></label>
          <label class="dl-select dc-fdist" id="fDistWrap" hidden><select id="fDist" aria-label="Distributor"><option value="">All distributors</option></select></label>
        </div></div>
      <div class="dc-chips" id="chips"></div>
      <div class="dl-table-wrap" id="tableWrap"><table class="dl-table dc-table"><thead><tr>
        <th class="c-no">#</th><th class="c-name"><button type="button" class="dc-sort" data-sort="name">Document Name</button></th><th class="c-cat">Category</th><th class="c-ref">Reference No.</th><th class="c-iss"><button type="button" class="dc-sort" data-sort="oldest">Issue Date</button></th><th class="c-exp"><button type="button" class="dc-sort" data-sort="expiry">Expiry Date</button></th><th class="c-st">Status</th><th class="c-act">Actions</th>
      </tr></thead><tbody id="rows"><tr><td colspan="8" class="dl-empty">Loading documents…</td></tr></tbody></table></div>
      <div class="dc-grid" id="gridWrap" hidden></div>
      <div class="dl-pager md-pager" id="pagerWrap"><span id="pageInfo"></span><div id="pager" class="dc-pager"></div></div>
    </section>
    <div class="dc-side">
      <section class="pos-card dc-exp">
        <div class="dl-card-head"><h2>Expiring Documents</h2><button type="button" class="dl-link" id="expAll">View All ${I.arrow}</button></div>
        <div class="dc-elist" id="exp"><p class="dl-empty">Loading…</p></div>
      </section>
      <section class="pos-card dc-quick">
        <div class="dl-card-head"><h2>Quick Actions</h2></div>
        <div class="dc-qlist" id="quick">
          ${canUpload ? `<button type="button" data-q="upload"><span class="dc-q-ic">${I.upload}</span><b>Upload Document</b>${I.chev}</button>` : ''}
          ${admin ? `<button type="button" data-q="folder"><span class="dc-q-ic">${I.folderPlus}</span><b>Create New Folder</b>${I.chev}</button>
          <button type="button" data-q="cats"><span class="dc-q-ic">${I.tag}</span><b>Manage Categories</b>${I.chev}</button>
          <button type="button" data-q="reminders"><span class="dc-q-ic">${I.bell}</span><b>Set Expiry Reminders</b><em class="dc-q-badge" id="qExp" hidden></em>${I.chev}</button>` : `<button type="button" data-q="attention"><span class="dc-q-ic">${I.bell}</span><b>Expiring &amp; Expired</b><em class="dc-q-badge" id="qExp" hidden></em>${I.chev}</button>`}
          <button type="button" data-q="report"><span class="dc-q-ic">${I.report}</span><b>Download Report</b>${I.chev}</button>
        </div>
      </section>
    </div>
  </div>
</div>
<dialog id="puDlg" class="pos-dialog dl-dialog md-wide sl-dlg dc-dlg"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="puPanel"></div></dialog>
<div class="dl-pop md-menu ds-menu dc-row-menu" id="rowMenu" hidden></div>
<div class="dl-toast" id="toast" role="status" aria-live="polite"></div>`;
mountGlobalSearch({ sb, prof });
document.querySelector('.dc-head-actions').style.setProperty('--dc-btns', document.querySelector('.dc-head-actions').children.length);

let toastT;
const toast = (m, bad = false) => { const el = $('toast'); el.textContent = m; el.className = `dl-toast show${bad ? ' bad' : ''}`; clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4500); };
const note = (m, bad) => { $('msg').textContent = m; $('msg').className = m ? `md-msg purchase-flash ${bad ? 'purchase-warning' : 'purchase-notice'}` : 'md-msg'; };
$('puDlg').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('puDlg')) $('puDlg').close(); });
const dlg = (html, cls = '') => { $('puPanel').innerHTML = html; $('puDlg').className = `pos-dialog dl-dialog md-wide sl-dlg dc-dlg ${cls}`; $('puPanel').onclick = null; if (!$('puDlg').open) $('puDlg').showModal(); $('puDlg').scrollTop = 0; };
const missing = e => /documents_|document_|function|schema cache|does not exist|Could not find/i.test(e?.message || '');
async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; }
const bucketOf = d => d.source === 'supplier' ? 'purchase-documents' : 'pharmacy-documents';
const MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const extOf = t => t === 'application/pdf' ? 'pdf' : t === 'image/jpeg' ? 'jpg' : t.split('/')[1];
const baseName = n => String(n || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
function csvDownload(name, data) {
  const q = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + data.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------------------------------------------------------------------
// Popovers / row menu
// ---------------------------------------------------------------------------
function closePops() { $('moreMenu').hidden = true; $('moreBtn').setAttribute('aria-expanded', 'false'); $('rowMenu').hidden = true; }
$('moreBtn').addEventListener('click', e => { e.stopPropagation(); const open = $('moreMenu').hidden; closePops(); $('moreMenu').hidden = !open; $('moreBtn').setAttribute('aria-expanded', String(open)); });
document.addEventListener('click', e => { if (!e.target.closest('.dl-pop') && !e.target.closest('[data-rowmenu]')) closePops(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePops(); });
function rowMenu(anchor, html, onPick) {
  const menu = $('rowMenu'), host = anchor.closest('dialog') || document.body;
  if (menu.parentNode !== host) host.appendChild(menu);
  menu.innerHTML = html; menu.hidden = false;
  const b = anchor.getBoundingClientRect();
  menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, b.bottom + 6))}px`;
  menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, b.right - menu.offsetWidth))}px`;
  menu.onclick = ev => { const a = ev.target.closest('[data-rm]'); if (!a) return; menu.hidden = true; onPick(a.dataset.rm); };
}

// ---------------------------------------------------------------------------
// Supplier lookups (distributors, purchase invoices) — same sources as before
// ---------------------------------------------------------------------------
async function loadSupplierLookups() {
  if (!supplierRole && !canUpload) return;
  const [distRes, purchaseRes] = await Promise.all([
    sb.from('distributors').select('id,name').eq('branch_id', branchId).eq('active', true).order('name'),
    // purchase_list works for every purchase role (direct table reads are admin-only).
    sb.rpc('purchase_list', { p_limit: 200 })
  ]);
  if (distRes.error) console.error('Distributor list:', distRes.error);
  if (purchaseRes.error) console.error('Purchase list:', purchaseRes.error);
  distributors = distRes.data || [];
  const idByName = new Map(distributors.map(d => [d.name, d.id]));
  purchases = (purchaseRes.data || []).map(p => ({ ...p, distributor_id: p.distributor_id || idByName.get(p.distributor) || '' }));
  $('fDist').innerHTML = `<option value="">All distributors</option>${distributors.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}`;
}

// ---------------------------------------------------------------------------
// Load overview + list
// ---------------------------------------------------------------------------
let legacy = [];
async function loadOverview() {
  try { ov = await rpc('documents_overview'); has32 = true; }
  catch (e) {
    if (!missing(e)) { note(friendly(e), true); return; }
    has32 = false;
    note('Run database migration 0032 (Documents Management) to store licences, GST, agreements, insurance and staff documents with expiry reminders. Supplier documents below keep working.', true);
    const { data, error } = await sb.rpc('purchase_document_list', { p_q: null, p_distributor: null, p_from: null, p_to: null, p_include_removed: true, p_limit: 500 });
    if (error) { note(friendly(error), true); legacy = []; } else legacy = (data || []).map(d => ({
      source: 'supplier', id: d.id, name: d.notes || `${SUP_TYPE[d.doc_type] || d.doc_type}${d.distributor ? ` · ${d.distributor}` : ''}`, file_name: d.file_name, mime: d.mime, size_bytes: d.size_bytes,
      category: 'supplier', category_name: 'Supplier Documents', color: 'navy', reference_no: d.supplier_invoice_no, authority: d.distributor, issue_date: d.doc_date || ds(d.created_at),
      expiry_date: null, status: d.status === 'removed' ? 'removed' : 'valid', record_status: d.status, notes: d.notes, created_at: d.created_at, removed_reason: d.removed_reason,
      distributor: d.distributor, supplier_invoice_no: d.supplier_invoice_no, doc_type: d.doc_type, path: d.path, can_open: admin && !!d.path && d.status === 'active', can_edit: false }));
    const act = legacy.filter(d => d.record_status === 'active');
    ov = { total: act.length, valid: act.length, expiring: 0, expired: 0, default_remind_days: 30, total_last_month: null, expiring_list: [], folders: [], can_manage: false,
      can_supplier: supplierRole, can_upload_supplier: supplierRole, categories: supplierRole ? [{ code: 'supplier', name: 'Supplier Documents', color: 'navy', count: act.length, is_system: true, active: true }] : [] };
  }
  cats = ov.categories || [];
}
function filters() {
  return { q: $('q').value.trim() || null, category: $('fCat').value || null, status: $('fStatus').value || null, folder: $('fFolder').value || null, sort: $('fSort').value, dist: $('fDist').value };
}
let showRemoved = false, seq = 0;
async function loadList(p = page) {
  const f = filters(), mine = ++seq;
  page = Math.max(1, p);
  if (!has32) {
    let L = legacy.filter(d => (showRemoved || f.status === 'removed' ? true : d.record_status === 'active') && (f.status !== 'removed' || d.record_status === 'removed')
      && (!f.category || f.category === 'supplier') && (!f.q || [d.name, d.file_name, d.distributor, d.supplier_invoice_no, d.notes].join(' ').toLowerCase().includes(f.q.toLowerCase()))
      && (!f.dist || distributors.find(x => x.id === f.dist)?.name === d.distributor) && (!f.status || ['valid', 'no_expiry', 'removed'].includes(f.status)));
    if (f.sort === 'name') L = L.sort((a, b) => a.name.localeCompare(b.name)); else if (f.sort === 'oldest') L = L.slice().reverse();
    total = L.length; rows = L.slice((page - 1) * per(), page * per()); renderList(); return;
  }
  try {
    const supplierOnly = f.category === 'supplier' && f.dist;
    const r = await rpc('documents_list', { p_q: supplierOnly ? null : f.q, p_category: f.category, p_status: f.status, p_folder: f.folder, p_include_removed: showRemoved, p_sort: f.sort, p_limit: supplierOnly ? 5000 : per(), p_offset: supplierOnly ? 0 : (page - 1) * per() });
    if (mine !== seq) return;
    if (supplierOnly) {
      // distributor filter (kept from the old archive): narrow the supplier documents by distributor
      const dn = distributors.find(x => x.id === f.dist)?.name;
      let L = (r.rows || []).filter(d => d.distributor === dn && (!f.q || [d.name, d.file_name, d.reference_no, d.notes].join(' ').toLowerCase().includes(f.q.toLowerCase())));
      total = L.length; rows = L.slice((page - 1) * per(), page * per());
    } else { total = num(r.total); rows = r.rows || []; }
    if (rows.length === 0 && total > 0 && page > 1) return loadList(Math.ceil(total / per()));
    renderList();
  } catch (e) { $('rows').innerHTML = `<tr><td colspan="8" class="dl-empty">${esc(friendly(e))}</td></tr>`; }
}

// ---------------------------------------------------------------------------
// KPIs, categories, expiring
// ---------------------------------------------------------------------------
function renderKpis() {
  if (!ov) return;
  const pct = (a, b) => b ? `${(a / b * 100).toFixed(1)}%` : '0%';
  $('kTotal').textContent = count(ov.total);
  const lm = ov.total_last_month;
  $('kTotalNote').innerHTML = lm === null || lm === undefined ? '<span class="dz-muted">Supplier documents</span>'
    : !lm ? (ov.total ? `<span class="dz-up">${I.up}New</span> vs last month` : '<span class="dz-muted">No documents yet</span>')
      : (() => { const p = (ov.total - lm) / lm * 100; return `<span class="${p >= 0 ? 'dz-up' : 'dz-down'}">${p >= 0 ? I.up : I.down}${p >= 0 ? '+' : ''}${p.toFixed(1)}%</span> vs last month`; })();
  $('kValid').textContent = count(ov.valid); $('kValidNote').innerHTML = `<b>${pct(ov.valid, ov.total)}</b> of total`;
  $('kExpiring').textContent = count(ov.expiring); $('kExpiringNote').textContent = `Within next ${ov.default_remind_days || 30} days`;
  $('kExpiring').closest('.dz-kpi').title = `A document is "expiring soon" inside its reminder window (default ${ov.default_remind_days || 30} days before expiry; each document can have its own).`;
  $('kExpired').textContent = count(ov.expired); $('kExpiredNote').innerHTML = `<b>${pct(ov.expired, ov.total)}</b> of total`;
  const att = num(ov.expiring) + num(ov.expired);
  $('qExp').hidden = !att; $('qExp').textContent = att;
}
document.querySelector('.dc-kpis').addEventListener('click', e => {
  const k = e.target.closest('[data-kpi]')?.dataset.kpi; if (!k) return;
  $('fStatus').value = { kTotal: '', kValid: 'valid', kExpiring: 'expiring', kExpired: 'expired' }[k];
  loadList(1); scrollToList();
});
const scrollToList = () => { if (matchMedia('(max-width: 900px)').matches) $('listCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); };

function renderCats() {
  const vis = cats.filter(c => c.active !== false);
  $('cats').innerHTML = vis.map(c => `<button type="button" class="dc-tile ${esc(c.color)}${$('fCat').value === c.code ? ' on' : ''}" data-cat="${esc(c.code)}" title="${esc(c.name)}: ${c.count} document${c.count === 1 ? '' : 's'}${c.expiring ? `, ${c.expiring} expiring` : ''}${c.expired ? `, ${c.expired} expired` : ''}">
      <span class="dc-tile-ic">${catIcon(c.is_system ? c.code : 'others')}</span><span class="dc-tile-b"><b>${esc(c.name)}</b><small>${count(c.count)}</small></span>
      ${num(c.expired) ? `<i class="dc-dot out" aria-hidden="true"></i>` : num(c.expiring) ? '<i class="dc-dot low" aria-hidden="true"></i>' : ''}</button>`).join('')
    || '<p class="dl-empty">No categories.</p>';
  const cur = $('fCat').value;
  $('fCat').innerHTML = `<option value="">All Categories</option>${cats.filter(c => c.active !== false || c.count).map(c => `<option value="${esc(c.code)}"${c.code === cur ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  const fcur = $('fFolder').value;
  $('fFolder').innerHTML = `<option value="">All Folders</option>${(ov?.folders || []).map(f => `<option value="${esc(f.id)}"${f.id === fcur ? ' selected' : ''}>${esc(f.name)} (${f.count})</option>`).join('')}`;
  $('fFolder').closest('label').hidden = !has32 || !(ov?.folders || []).length;
  $('fDistWrap').hidden = $('fCat').value !== 'supplier';
}
$('cats').addEventListener('click', e => {
  const t = e.target.closest('[data-cat]'); if (!t) return;
  $('fCat').value = $('fCat').value === t.dataset.cat ? '' : t.dataset.cat;
  renderCats(); loadList(1); scrollToList();
});

function renderExpiring() {
  const L = (ov?.expiring_list || []).slice().sort((a, b) => (a.status === 'expiring' ? 0 : 1) - (b.status === 'expiring' ? 0 : 1) || String(a.expiry_date).localeCompare(String(b.expiry_date)));
  const show = L.slice(0, matchMedia('(max-width: 560px)').matches ? 3 : 5);
  $('exp').innerHTML = show.map(d => `<button type="button" class="dc-erow" data-src="${esc(d.source)}" data-id="${esc(d.id)}">
      <span class="dc-e-ic ${d.status === 'expired' ? 'out' : 'low'}">${I.file}</span>
      <span class="dc-e-b"><b>${esc(d.name)}</b><small>${d.status === 'expired' ? 'Expired on' : 'Expires on'} ${esc(dmy(d.expiry_date))}</small></span>
      <span class="md-chip ${d.status === 'expired' ? 'out' : 'low'} dc-days">${esc(d.days_left < 0 ? `${-d.days_left} days ago` : daysTxt(d.days_left))}</span></button>`).join('')
    || `<div class="dc-empty-ok">${I.tick}<span><b>All documents are up to date</b><small>${has32 ? (ov?.next_expiry?.[0] ? `Next expiry: ${esc(ov.next_expiry[0].name)} on ${esc(dmy(ov.next_expiry[0].expiry_date))}` : 'Add expiry dates to get reminders.') : 'Expiry reminders need migration 0032.'}</small></span></div>`;
}
$('exp').addEventListener('click', async e => {
  const b = e.target.closest('[data-id]'); if (!b) return;
  const d = await findDoc(b.dataset.src, b.dataset.id); if (d) openDetails(d);
});
$('expAll').addEventListener('click', () => { if (admin && has32) return reminders(); $('fStatus').value = 'attention'; loadList(1); $('listCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
async function findDoc(src, id) {
  const hit = rows.find(r => r.id === id && r.source === src) || legacy.find(r => r.id === id);
  if (hit) return hit;
  try { const r = await rpc('documents_list', { p_q: null, p_category: null, p_status: null, p_folder: null, p_include_removed: true, p_sort: 'recent', p_limit: 5000, p_offset: 0 }); return (r.rows || []).find(x => x.id === id && x.source === src); }
  catch (e) { toast(friendly(e), true); return null; }
}

// ---------------------------------------------------------------------------
// Document list (table / grid)
// ---------------------------------------------------------------------------
function chips() {
  const f = filters(), out = [];
  if (f.category) out.push(['fCat', cats.find(c => c.code === f.category)?.name || f.category]);
  if (f.status) out.push(['fStatus', $('fStatus').selectedOptions[0].textContent]);
  if (f.folder) out.push(['fFolder', `Folder: ${(ov.folders || []).find(x => x.id === f.folder)?.name || ''}`]);
  if (f.dist && f.category === 'supplier') out.push(['fDist', distributors.find(x => x.id === f.dist)?.name || '']);
  if (f.q) out.push(['q', `“${f.q}”`]);
  if (showRemoved) out.push(['removed', 'Including removed']);
  $('chips').innerHTML = out.length ? out.map(([k, l]) => `<button type="button" class="dc-chip" data-clear="${k}">${esc(l)} ${I.xs}</button>`).join('') + (out.length > 1 ? '<button type="button" class="dc-chip-clear" data-clear="all">Clear all</button>' : '') : '';
}
$('chips').addEventListener('click', e => {
  const k = e.target.closest('[data-clear]')?.dataset.clear; if (!k) return;
  const clr = x => { if (x === 'removed') { showRemoved = false; $('removedLbl').textContent = 'Show removed documents'; } else $(x).value = ''; };
  if (k === 'all') ['fCat', 'fStatus', 'fFolder', 'fDist', 'q', 'removed'].forEach(clr); else clr(k);
  renderCats(); loadList(1);
});
function actBtns(d) {
  return `<div class="dc-acts">
    <button type="button" class="dl-act" data-a="view" title="View ${esc(d.name)}" aria-label="View ${esc(d.name)}">${I.eye}</button>
    <button type="button" class="dl-act dc-dl" data-a="download" title="${d.can_open ? 'Download' : 'Download (Admin only)'}" aria-label="Download ${esc(d.name)}" ${d.can_open ? '' : 'disabled'}>${I.download}</button>
    <button type="button" class="dl-act" data-rowmenu title="More" aria-label="More actions for ${esc(d.name)}">${I.dots}</button></div>`;
}
function expCell(d) {
  if (!d.expiry_date) return '<span class="dl-muted">No expiry</span>';
  return `${esc(dmy(d.expiry_date))}${d.status === 'expiring' || d.status === 'expired' ? `<small class="dc-left ${d.status === 'expired' ? 'out' : 'low'}">${esc(daysTxt(d.days_left))}</small>` : ''}`;
}
function renderList() {
  chips();
  for (const t of document.querySelectorAll('.dc-sort')) t.classList.toggle('on', t.dataset.sort === $('fSort').value);
  const start = (page - 1) * per();
  const empty = total ? '' : (rows.length ? '' : (filters().q || filters().category || filters().status || filters().folder ? 'No documents match these filters.' : (canUpload ? 'No documents yet. Use Upload Document to add your licences, GST certificate and agreements.' : 'No documents yet.')));
  $('rows').innerHTML = rows.map((d, i) => `<tr data-src="${esc(d.source)}" data-id="${esc(d.id)}" class="${d.record_status && d.record_status !== 'active' ? 'dc-off' : ''}">
      <td class="c-no">${start + i + 1}</td>
      <td class="c-name"><span class="dc-who">${pdfIc(d.mime)}<span><b>${esc(d.name)}</b><small class="dc-m-ref">${esc(d.reference_no || d.file_name || '')}</small>${d.version > 1 ? `<small class="dc-ver">v${d.version}</small>` : ''}</span></span></td>
      <td class="c-cat">${catChip(d)}</td>
      <td class="c-ref">${esc(d.reference_no || '—')}</td>
      <td class="c-iss">${esc(dmy(d.issue_date))}</td>
      <td class="c-exp"><span class="dc-m-exp">Exp: </span>${expCell(d)}</td>
      <td class="c-st">${statusChip(d)}</td>
      <td class="c-act">${actBtns(d)}</td></tr>`).join('') || `<tr><td colspan="8" class="dl-empty">${empty}</td></tr>`;
  $('gridWrap').innerHTML = rows.map(d => `<article class="dc-card ${esc(d.color || 'gray')}" data-src="${esc(d.source)}" data-id="${esc(d.id)}">
      <div class="dc-card-top">${pdfIc(d.mime)}${statusChip(d)}</div>
      <b class="dc-card-name">${esc(d.name)}</b><small>${esc(d.reference_no || d.file_name || '')}</small>
      <div class="dc-card-meta">${catChip(d)}<span>${d.expiry_date ? `Exp ${esc(dmy(d.expiry_date))}` : 'No expiry'}</span></div>
      ${actBtns(d)}</article>`).join('') || `<p class="dl-empty">${empty}</p>`;
  $('tableWrap').hidden = view === 'grid'; $('gridWrap').hidden = view !== 'grid';
  const pages = Math.max(1, Math.ceil(total / per()));
  $('pageInfo').textContent = total ? `Showing ${start + 1} to ${Math.min(total, start + rows.length)} of ${count(total)} documents` : '';
  const nums = []; for (let n = 1; n <= pages; n++) if (n === 1 || n === pages || Math.abs(n - page) <= 1) nums.push(n); else if (nums[nums.length - 1] !== '…') nums.push('…');
  $('pager').innerHTML = pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>${nums.map(n => n === '…' ? '<span class="dc-gap">…</span>' : `<button type="button" data-page="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">›</button>` : '';
}
$('pager').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) loadList(+b.dataset.page); });
for (const id of ['fCat', 'fStatus', 'fFolder', 'fSort', 'fDist']) $(id).addEventListener('change', () => { if (id === 'fCat') renderCats(); loadList(1); });
let qT; $('q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => loadList(1), 250); });
document.querySelector('.dc-table thead').addEventListener('click', e => {
  const k = e.target.closest('[data-sort]')?.dataset.sort; if (!k) return;
  $('fSort').value = $('fSort').value === k ? 'recent' : k; loadList(1);
});
$('fView').addEventListener('change', () => { view = $('fView').value; try { localStorage.setItem('pp.docs.view', view); } catch { /* ignore */ } loadList(1); });
for (const host of [$('rows'), $('gridWrap')]) host.addEventListener('click', e => {
  const el = e.target.closest('[data-id]'); if (!el) return;
  const d = rows.find(x => x.id === el.dataset.id && x.source === el.dataset.src); if (!d) return;
  const m = e.target.closest('[data-rowmenu]');
  if (m) { e.stopPropagation(); return rowMenu(m, docMenu(d), k => docAction(d, k)); }
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'download') return download(d);
  openDetails(d);
});

const docMenu = d => [
  `<button type="button" data-rm="view">${I.eye}<span>View details</span></button>`,
  d.can_open ? `<button type="button" data-rm="open">${I.link}<span>Open in new tab</span></button><button type="button" data-rm="download">${I.download}<span>Download</span></button>` : '',
  d.can_edit ? `<button type="button" data-rm="edit">${I.pencil}<span>Edit details</span></button><button type="button" data-rm="renew">${I.renew}<span>Renew / upload new version</span></button>` : '',
  d.can_edit && (ov?.folders || []).length ? `<button type="button" data-rm="move">${I.move}<span>Move to folder</span></button>` : '',
  d.source === 'pharmacy' ? `<button type="button" data-rm="versions">${I.history}<span>Version history</span></button>` : '',
  `<button type="button" data-rm="share">${I.wa}<span>Share details on WhatsApp</span></button>`,
  admin && d.record_status === 'active' ? `<button type="button" data-rm="remove" class="danger">${I.trash}<span>Remove</span></button>` : '',
  admin && d.source === 'pharmacy' && d.record_status === 'removed' ? `<button type="button" data-rm="restore">${I.restore}<span>Restore</span></button>` : ''
].join('');
function docAction(d, k) {
  ({ view: () => openDetails(d), open: () => openFile(d), download: () => download(d), edit: () => docForm(d), renew: () => renewForm(d), move: () => moveForm([d]),
    versions: () => openDetails(d, 'versions'), share: () => shareDoc(d), remove: () => removeDoc(d), restore: () => restoreDoc(d) })[k]?.();
}

// ---------------------------------------------------------------------------
// Open / download (short-lived signed links)
// ---------------------------------------------------------------------------
async function signed(d, opts) {
  if (!d.path) throw new Error(d.source === 'supplier' ? 'Supplier documents can be opened by Admin only.' : 'File not available.');
  const { data, error } = await sb.storage.from(bucketOf(d)).createSignedUrl(d.path, 300, opts);
  if (error) throw error;
  return data.signedUrl;
}
const logAccess = (d, a) => { if (has32) sb.rpc('document_log_access', { p_source: d.source, p_id: d.id, p_action: a }).then(() => {}, () => {}); };
async function openFile(d) {
  try { const url = await signed(d); window.open(url, '_blank', 'noopener'); logAccess(d, 'viewed'); }
  catch (e) { toast(friendly(e), true); }
}
async function download(d) {
  try { const url = await signed(d, { download: d.file_name || true }); const a = document.createElement('a'); a.href = url; a.download = d.file_name || 'document'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); logAccess(d, 'downloaded'); toast(`Downloading ${d.file_name || d.name}…`); }
  catch (e) { toast(friendly(e), true); }
}
function shareDoc(d) {
  const lines = [`*${d.name}*`, `Category: ${d.category_name || d.category}`, d.reference_no ? `Reference No.: ${d.reference_no}` : '', d.authority ? `${d.source === 'supplier' ? 'Distributor' : 'Issued by'}: ${d.authority}` : '',
    d.issue_date ? `${d.source === 'supplier' ? 'Date' : 'Issue date'}: ${dmy(d.issue_date)}` : '', d.expiry_date ? `Expiry date: ${dmy(d.expiry_date)} (${STATUS[d.status]?.[0] || d.status}${d.days_left !== null && d.days_left !== undefined ? `, ${daysTxt(d.days_left)}` : ''})` : '', '— Pallikkal Pharmacy'];
  window.open(`https://wa.me/?text=${encodeURIComponent(lines.filter(Boolean).join('\n'))}`, '_blank', 'noopener');
}

// ---------------------------------------------------------------------------
// Details (preview, versions, activity)
// ---------------------------------------------------------------------------
async function openDetails(d, tab = 'details') {
  const kv = (l, v, wide) => `<div${wide ? ' class="dc-wide"' : ''}><small>${l}</small><strong>${v}</strong></div>`;
  const isSup = d.source === 'supplier';
  dlg(`<div class="dc-det-head">${pdfIc(d.mime)}<div><h3>${esc(d.name)}</h3><p class="dc-det-chips">${catChip(d)}${statusChip(d)}${d.version > 1 ? `<span class="md-chip blue">Version ${d.version}</span>` : ''}${d.folder ? `<span class="md-chip off">${I.folder}${esc(d.folder)}</span>` : ''}</p></div></div>
    <div class="dc-det-acts">
      ${d.can_open ? `<button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-d="open">${I.link}<span>Open</span></button><button type="button" class="pos-btn pos-btn-sm" data-d="download">${I.download}<span>Download</span></button>` : `<span class="dl-muted dc-noopen">${isSup ? 'Supplier documents are opened by Admin only.' : 'File not available.'}</span>`}
      ${d.can_edit ? `<button type="button" class="pos-btn pos-btn-sm" data-d="edit">${I.pencil}<span>Edit</span></button><button type="button" class="pos-btn pos-btn-sm" data-d="renew">${I.renew}<span>Renew</span></button>` : ''}
      ${d.can_edit && (ov?.folders || []).length ? `<button type="button" class="pos-btn pos-btn-sm" data-d="move">${I.move}<span>Move</span></button>` : ''}
      <button type="button" class="pos-btn pos-btn-sm dc-wa" data-d="share">${I.wa}<span>WhatsApp</span></button>
      ${admin && d.record_status === 'active' ? `<button type="button" class="pos-btn pos-btn-sm dc-danger" data-d="remove">${I.trash}<span>Remove</span></button>` : ''}
      ${admin && !isSup && d.record_status === 'removed' ? `<button type="button" class="pos-btn pos-btn-sm" data-d="restore">${I.restore}<span>Restore</span></button>` : ''}
    </div>
    ${!isSup && has32 ? `<div class="st-tabs dc-tabs" role="tablist"><button type="button" data-tab="details" class="${tab === 'details' ? 'on' : ''}">Details</button><button type="button" data-tab="versions" class="${tab === 'versions' ? 'on' : ''}">Versions</button><button type="button" data-tab="activity" class="${tab === 'activity' ? 'on' : ''}">Activity</button></div>` : ''}
    <div id="detBody"></div>`, 'dc-det-dlg');
  const body = async t => {
    for (const b of $('puPanel').querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === t);
    if (t === 'details') {
      $('detBody').innerHTML = `<div class="dc-det-grid"><div class="dc-kv">
          ${isSup ? kv('Distributor', esc(d.distributor || 'Unassigned')) + kv('Purchase invoice', esc(d.supplier_invoice_no || '—')) + kv('Document type', esc(SUP_TYPE[d.doc_type] || d.doc_type || '—')) + kv('Document date', esc(dmy(d.issue_date)))
            : kv('Reference No.', esc(d.reference_no || '—')) + kv('Issued by', esc(d.authority || '—')) + kv('Issue date', esc(dmy(d.issue_date))) + kv('Expiry date', d.expiry_date ? `${esc(dmy(d.expiry_date))}${d.days_left !== null ? ` <span class="dc-left ${d.status === 'expired' ? 'out' : d.status === 'expiring' ? 'low' : 'in'}">${esc(d.days_left < 0 ? `expired ${-d.days_left} days ago` : `${d.days_left} days left`)}</span>` : ''}` : 'No expiry')
              + kv('Reminder', d.expiry_date ? `${d.remind_days || ov?.default_remind_days || 30} days before expiry${d.remind_days ? '' : ' (default)'}` : '—')}
          ${kv('File', `${esc(d.file_name || '')} <span class="dl-muted">· ${esc(size(d.size_bytes))}</span>`)}
          ${kv('Uploaded', `${esc(when(d.created_at))}${d.uploaded_by ? ` · ${esc(d.uploaded_by)}` : ''}`)}
          ${d.notes ? kv('Notes', esc(d.notes), true) : ''}
          ${d.removed_reason ? kv('Removed', esc(d.removed_reason), true) : ''}
        </div><div class="dc-prev" id="prev">${d.can_open ? '<p class="dl-muted">Loading preview…</p>' : `<div class="dc-prev-none">${pdfIc(d.mime)}<small>Preview not available</small></div>`}</div></div>`;
      if (d.can_open) {
        try {
          const url = await signed(d);
          if (!$('prev')) return;
          $('prev').innerHTML = d.mime === 'application/pdf' ? `<iframe src="${esc(url)}" title="Preview of ${esc(d.name)}"></iframe>` : `<img src="${esc(url)}" alt="Preview of ${esc(d.name)}">`;
          logAccess(d, 'viewed');
        } catch (e) { if ($('prev')) $('prev').innerHTML = `<p class="dl-muted">${esc(friendly(e))}</p>`; }
      }
    } else if (t === 'versions') {
      $('detBody').innerHTML = '<p class="dl-muted">Loading versions…</p>';
      try {
        const v = await rpc('document_versions', { p_id: d.id }) || [];
        $('detBody').innerHTML = `<div class="dl-table-wrap st-lv-wrap"><table class="dl-table st-lv dc-vt"><thead><tr><th>Version</th><th>File</th><th>Reference</th><th>Issue</th><th>Expiry</th><th>Status</th><th>Uploaded</th><th></th></tr></thead><tbody>
          ${v.map(x => `<tr><td><b>v${x.version}</b></td><td>${esc(x.file_name)}<small>${esc(size(x.size_bytes))}</small></td><td>${esc(x.reference_no || '—')}</td><td>${esc(dmy(x.issue_date))}</td><td>${esc(dmy(x.expiry_date))}</td>
            <td>${x.status === 'active' ? '<span class="md-chip in">Current</span>' : x.status === 'archived' ? '<span class="md-chip off">Old version</span>' : '<span class="md-chip out">Removed</span>'}</td><td>${esc(when(x.created_at))}<small>${esc(x.uploaded_by || '')}</small></td>
            <td>${x.can_open ? `<button type="button" class="pos-btn pos-btn-sm" data-vopen="${esc(x.id)}">${I.link}<span>Open</span></button>` : ''}</td></tr>`).join('')}</tbody></table></div>
          ${d.can_edit ? `<div class="st-foot st-foot-l"><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-d="renew">${I.renew}<span>Upload new version</span></button></div>` : ''}`;
        $('detBody').onclick = async e => {
          const id = e.target.closest('[data-vopen]')?.dataset.vopen; if (!id) return;
          const { data } = await sb.rpc('documents_list', { p_q: null, p_category: null, p_status: null, p_folder: null, p_include_removed: true, p_sort: 'recent', p_limit: 5000, p_offset: 0 });
          let x = (data?.rows || []).find(r => r.id === id);
          if (!x) { const a = await sb.rpc('documents_list', { p_q: null, p_category: null, p_status: 'archived', p_folder: null, p_include_removed: false, p_sort: 'recent', p_limit: 5000, p_offset: 0 }); x = (a.data?.rows || []).find(r => r.id === id); }
          if (x) openFile(x); else toast('File not found.', true);
        };
      } catch (e) { $('detBody').innerHTML = `<p class="dl-muted">${esc(friendly(e))}</p>`; }
    } else {
      $('detBody').innerHTML = '<p class="dl-muted">Loading activity…</p>';
      try {
        const a = await rpc('document_activity', { p_id: d.id, p_limit: 100 }) || [];
        $('detBody').innerHTML = `<div class="dc-alist">${a.map(actRow).join('') || '<p class="dl-empty">No activity yet.</p>'}</div>`;
      } catch (e) { $('detBody').innerHTML = `<p class="dl-muted">${esc(friendly(e))}</p>`; }
    }
  };
  $('puPanel').onclick = e => {
    const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) return body(t);
    const a = e.target.closest('[data-d]')?.dataset.d; if (!a) return;
    ({ open: () => openFile(d), download: () => download(d), edit: () => docForm(d), renew: () => renewForm(d), move: () => moveForm([d]), share: () => shareDoc(d), remove: () => removeDoc(d), restore: () => restoreDoc(d) })[a]?.();
  };
  body(isSup || !has32 ? 'details' : tab);
}
const ACT_IC = { document_uploaded: ['g', I.upload], document_updated: ['a', I.pencil], document_renewed: ['b', I.renew], document_removed: ['r', I.trash], document_restored: ['g', I.restore],
  document_viewed: ['n', I.eye], document_downloaded: ['n', I.download], document_moved: ['p', I.move] };
const actRow = a => { const [c, ic] = ACT_IC[a.action] || ['n', I.file]; return `<div class="dc-act"><span class="st-act-ic ${c}">${ic}</span><span class="st-act-b"><b>${esc(a.title)}</b><small>${esc(a.detail || '')}${a.by_name ? ` · ${esc(a.by_name)}` : ''}</small></span><time>${esc(when(a.at))}</time></div>`; };

// ---------------------------------------------------------------------------
// Upload (pharmacy documents and supplier documents)
// ---------------------------------------------------------------------------
const catOptions = (cur, withSupplier) => cats.filter(c => c.code !== 'supplier' && (c.active !== false || c.code === cur) && (c.code !== 'staff' || admin))
  .map(c => `<option value="${esc(c.code)}"${c.code === cur ? ' selected' : ''}>${esc(c.name)}</option>`).join('')
  + (withSupplier ? `<option value="supplier"${cur === 'supplier' ? ' selected' : ''}>Supplier Documents (purchase bill, challan…)</option>` : '');
const folderOptions = cur => `<option value="">No folder</option>${(ov?.folders || []).map(f => `<option value="${esc(f.id)}"${f.id === cur ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}`;
function fileBox() {
  return `<label class="dc-drop" id="drop" for="file"><input id="file" type="file" accept=".pdf,image/jpeg,image/png,image/webp" required>
    <span class="dc-drop-ic">${I.upload}</span><b id="dropName">Choose a file or drag it here</b><small id="dropInfo">PDF, JPG, PNG or WEBP · max 15 MB</small></label>`;
}
function wireFile(onPick) {
  const show = f => { $('dropName').textContent = f ? f.name : 'Choose a file or drag it here'; $('dropInfo').textContent = f ? `${size(f.size)} · ${f.type || 'unknown type'}` : 'PDF, JPG, PNG or WEBP · max 15 MB'; $('drop').classList.toggle('has', !!f); onPick?.(f); };
  $('file').onchange = () => show($('file').files?.[0]);
  for (const ev of ['dragenter', 'dragover']) $('drop').addEventListener(ev, e => { e.preventDefault(); $('drop').classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) $('drop').addEventListener(ev, e => { e.preventDefault(); $('drop').classList.remove('over'); });
  $('drop').addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (!f) return; const dt = new DataTransfer(); dt.items.add(f); $('file').files = dt.files; show(f); });
}
const checkFile = f => !f ? 'Choose a file to upload.' : !MIMES.includes(f.type) || f.size > 15 * 1024 * 1024 ? 'Invalid file type or file exceeds 15 MB.' : '';
async function storeFile(bucket, path, file) {
  const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
}
const cleanup = (bucket, path) => sb.storage.from(bucket).remove([path]).then(() => {}, () => {});

function uploadForm(preset = {}) {
  if (!canUpload) return;
  const withSup = !!ov?.can_upload_supplier;
  const startCat = preset.category || (has32 ? ($('fCat').value && $('fCat').value !== 'supplier' ? $('fCat').value : 'licenses') : 'supplier');
  if (!has32 && !withSup) return toast('Uploading pharmacy documents needs migration 0032.', true);
  dlg(`<h3 class="rt-dlg-title">${I.upload} Upload Document</h3>
    <form id="docForm" class="md-form" novalidate>
      ${fileBox()}
      <div class="md-form-grid dc-form">
        <div class="pos-field md-span-2"><label for="dCat">Category</label><select id="dCat">${has32 ? catOptions(startCat, withSup) : '<option value="supplier">Supplier Documents</option>'}</select></div>
        <div class="dc-ph md-span-2" id="phFields">
          <div class="pos-field md-span-2"><label for="dName">Document name</label><input id="dName" maxlength="200" placeholder="e.g. Drug License (Retail)" list="nameList"><datalist id="nameList">${['Drug License (Retail)', 'Drug License (Wholesale)', 'GST Registration Certificate', 'Trade License', 'Pharmacy Council Registration', 'Shop & Establishment Registration', 'FSSAI Registration', 'Fire NOC', 'Shop Rent Agreement', 'Shop Insurance Policy', 'Narcotic Drugs License', 'Pollution Clearance Certificate'].map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist></div>
          <div class="pos-field"><label for="dRef">Reference No.</label><input id="dRef" maxlength="80" placeholder="Licence / certificate number"></div>
          <div class="pos-field"><label for="dAuth">Issued by <small class="dl-muted">(optional)</small></label><input id="dAuth" maxlength="120" placeholder="e.g. Drugs Control Department"></div>
          <div class="pos-field"><label for="dIssue">Issue date</label><input id="dIssue" type="date" max="${today()}"></div>
          <div class="pos-field"><label for="dExp">Expiry date</label><input id="dExp" type="date"><label class="st-check dc-noexp"><input type="checkbox" id="dNoExp"> No expiry</label></div>
          <div class="pos-field"><label for="dRemind">Remind me <small class="dl-muted">(days before expiry)</small></label><input id="dRemind" type="number" min="1" max="365" placeholder="${ov?.default_remind_days || 30} (default)"></div>
          <div class="pos-field"><label for="dFolder">Folder</label><select id="dFolder"${admin ? '' : ''}>${folderOptions(preset.folder_id || $('fFolder').value)}</select></div>
          <div class="pos-field md-span-2"><label for="dNotes">Notes</label><textarea id="dNotes" rows="2" maxlength="1000" placeholder="Anything to remember (renewal office, fees, contact)…"></textarea></div>
        </div>
        <div class="dc-sup md-span-2" id="supFields" hidden>
          <div class="pos-field"><label for="distributor">Distributor</label><select id="distributor"><option value="">Unassigned (admin only)</option>${distributors.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
          <div class="pos-field"><label for="purchase">Purchase invoice <small class="dl-muted">(optional)</small></label><select id="purchase"><option value="">No linked invoice</option>${purchases.map(p => `<option value="${p.id}" data-dist="${p.distributor_id}">${esc(p.supplier_invoice_no)} — ${esc(p.invoice_date)}</option>`).join('')}</select></div>
          <div class="pos-field"><label for="type">Document type</label><select id="type"><option value="purchase_bill">Purchase bill</option><option value="credit_note">Credit note</option><option value="delivery_challan">Delivery challan</option><option value="other">Other</option></select></div>
          <div class="pos-field"><label for="date">Document date</label><input id="date" type="date"></div>
          <div class="pos-field md-span-2"><label for="notes">Notes / reference</label><input id="notes" maxlength="1000" placeholder="Notes / reference"></div>
        </div>
      </div>
      <p class="pos-form-msg" id="uploadMsg" role="status"></p>
      <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="submit" class="pos-btn pos-btn-solid" id="dSave">${I.upload}<span>Upload document</span></button></div>
    </form>`, 'dc-form-dlg');
  const sync = () => { const sup = $('dCat').value === 'supplier'; $('supFields').hidden = !sup; $('phFields').hidden = sup; };
  $('dCat').onchange = sync; sync();
  $('dFolder').closest('.pos-field').hidden = !(ov?.folders || []).length;
  $('dNoExp').onchange = () => { $('dExp').disabled = $('dNoExp').checked; if ($('dNoExp').checked) $('dExp').value = ''; };
  let auto = '';
  wireFile(f => { if (f && (!$('dName').value.trim() || $('dName').value === auto)) $('dName').value = auto = baseName(f.name).slice(0, 200); });
  $('purchase').onchange = () => { const dist = $('purchase').selectedOptions[0]?.dataset.dist; if (dist) $('distributor').value = dist; };
  $('docForm').onsubmit = async e => {
    e.preventDefault();
    const msg = t => { $('uploadMsg').textContent = t; };
    const file = $('file').files?.[0], bad = checkFile(file);
    if (bad) return msg(bad);
    $('dSave').disabled = true;
    try {
      if ($('dCat').value === 'supplier') await saveSupplier(file, msg);
      else await savePharmacy(file, msg);
    } catch (err) { msg(friendly(err)); $('dSave').disabled = false; }
  };
}
async function saveSupplier(file, msg) {
  const distributor = $('distributor').value || null, purchase = $('purchase').value || null;
  if (!distributor && !admin) { $('dSave').disabled = false; return msg('Select a distributor. Unassigned uploads are admin-only.'); }
  if (purchase) {
    const selected = purchases.find(p => p.id === purchase);
    if (!selected || selected.distributor_id !== distributor) { $('dSave').disabled = false; return msg('The selected invoice and distributor do not match.'); }
  }
  const path = `${distributor || 'unassigned'}/${crypto.randomUUID()}.${extOf(file.type)}`;
  msg('Uploading…');
  await storeFile('purchase-documents', path, file);
  const { error: regErr } = await sb.rpc('register_purchase_document', {
    p_path: path, p_name: file.name, p_mime: file.type, p_size: file.size, p_sha256: null, p_distributor: distributor, p_purchase: purchase,
    p_doc_date: $('date').value || null, p_type: $('type').value, p_notes: $('notes').value.trim() || null
  });
  if (regErr) { await cleanup('purchase-documents', path); throw regErr; }
  msg('Document uploaded and registered.');
  toast('Supplier document uploaded and registered.');
  $('puDlg').close(); await refresh();
}
function phPayload() {
  const exp = $('dNoExp').checked ? null : ($('dExp').value || null);
  return { category: $('dCat').value, name: $('dName').value.trim(), reference_no: $('dRef').value.trim(), authority: $('dAuth').value.trim(), issue_date: $('dIssue').value || null,
    expiry_date: exp, remind_days: $('dRemind').value ? +$('dRemind').value : null, folder_id: $('dFolder').value || null, notes: $('dNotes').value.trim() };
}
function phCheck(p) {
  if (!p.name) return 'Enter the document name.';
  if (p.expiry_date && p.issue_date && p.expiry_date < p.issue_date) return 'The expiry date is before the issue date.';
  if (p.remind_days !== null && (p.remind_days < 1 || p.remind_days > 365)) return 'Reminder must be 1 to 365 days before expiry.';
  return '';
}
async function savePharmacy(file, msg) {
  const p = phPayload(), bad = phCheck(p);
  if (bad) { $('dSave').disabled = false; return msg(bad); }
  const path = `${branchId}/${crypto.randomUUID()}.${extOf(file.type)}`;
  msg('Uploading…');
  await storeFile('pharmacy-documents', path, file);
  try { await rpc('document_register', { p: { ...p, path, file_name: file.name, mime: file.type, size_bytes: file.size } }); }
  catch (err) { await cleanup('pharmacy-documents', path); throw err; }
  msg('Document uploaded and registered.');
  toast(`${p.name} uploaded.${p.expiry_date ? ` Reminder ${p.remind_days || ov?.default_remind_days || 30} days before ${dmy(p.expiry_date)}.` : ''}`);
  $('puDlg').close(); await refresh();
}

// ---------------------------------------------------------------------------
// Edit / renew / move / remove / restore
// ---------------------------------------------------------------------------
function docForm(d) {
  dlg(`<h3 class="rt-dlg-title">${I.pencil} Edit document details</h3>
    <form id="editForm" class="md-form" novalidate>
      <div class="md-form-grid dc-form">
        <div class="pos-field md-span-2"><label for="dName">Document name</label><input id="dName" maxlength="200" value="${esc(d.name)}"></div>
        <div class="pos-field"><label for="dCat">Category</label><select id="dCat">${catOptions(d.category, false)}</select></div>
        <div class="pos-field"><label for="dFolder">Folder</label><select id="dFolder">${folderOptions(d.folder_id)}</select></div>
        <div class="pos-field"><label for="dRef">Reference No.</label><input id="dRef" maxlength="80" value="${esc(d.reference_no || '')}"></div>
        <div class="pos-field"><label for="dAuth">Issued by</label><input id="dAuth" maxlength="120" value="${esc(d.authority || '')}"></div>
        <div class="pos-field"><label for="dIssue">Issue date</label><input id="dIssue" type="date" value="${esc(ds(d.issue_date))}"></div>
        <div class="pos-field"><label for="dExp">Expiry date</label><input id="dExp" type="date" value="${esc(ds(d.expiry_date))}"${d.expiry_date ? '' : ' disabled'}><label class="st-check dc-noexp"><input type="checkbox" id="dNoExp"${d.expiry_date ? '' : ' checked'}> No expiry</label></div>
        <div class="pos-field"><label for="dRemind">Remind me <small class="dl-muted">(days before expiry)</small></label><input id="dRemind" type="number" min="1" max="365" value="${d.remind_days || ''}" placeholder="${ov?.default_remind_days || 30} (default)"></div>
        <div class="pos-field md-span-2"><label for="dNotes">Notes</label><textarea id="dNotes" rows="2" maxlength="1000">${esc(d.notes || '')}</textarea></div>
      </div>
      <p class="pos-form-msg" id="eErr"></p>
      <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="submit" class="pos-btn pos-btn-solid" id="eSave">${I.tick}<span>Save changes</span></button></div>
    </form>`, 'dc-form-dlg');
  $('dNoExp').onchange = () => { $('dExp').disabled = $('dNoExp').checked; if ($('dNoExp').checked) $('dExp').value = ''; };
  $('editForm').onsubmit = async e => {
    e.preventDefault();
    const p = phPayload(), bad = phCheck(p); if (bad) return ($('eErr').textContent = bad);
    $('eSave').disabled = true;
    try { await rpc('document_update', { p_id: d.id, p }); $('puDlg').close(); toast('Document details saved.'); await refresh(); }
    catch (err) { $('eErr').textContent = friendly(err); $('eSave').disabled = false; }
  };
}
function renewForm(d) {
  dlg(`<h3 class="rt-dlg-title">${I.renew} Renew — ${esc(d.name)}</h3>
    <p class="dl-muted">Upload the renewed certificate. It becomes the current version; the old file stays in the version history.</p>
    <form id="renewForm" class="md-form" novalidate>
      ${fileBox()}
      <div class="md-form-grid dc-form">
        <div class="pos-field"><label for="rRef">Reference No.</label><input id="rRef" maxlength="80" value="${esc(d.reference_no || '')}"></div>
        <div class="pos-field"><label for="rAuth">Issued by</label><input id="rAuth" maxlength="120" value="${esc(d.authority || '')}"></div>
        <div class="pos-field"><label for="rIssue">New issue date</label><input id="rIssue" type="date" value="${today()}"></div>
        <div class="pos-field"><label for="rExp">New expiry date</label><input id="rExp" type="date"></div>
      </div>
      <p class="pos-form-msg" id="rErr"></p>
      <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="submit" class="pos-btn pos-btn-solid" id="rSave">${I.renew}<span>Save new version</span></button></div>
    </form>`, 'dc-form-dlg');
  wireFile();
  $('renewForm').onsubmit = async e => {
    e.preventDefault();
    const file = $('file').files?.[0], bad = checkFile(file); if (bad) return ($('rErr').textContent = bad);
    const p = { reference_no: $('rRef').value.trim(), authority: $('rAuth').value.trim(), issue_date: $('rIssue').value || null, expiry_date: $('rExp').value || null };
    if (p.expiry_date && p.issue_date && p.expiry_date < p.issue_date) return ($('rErr').textContent = 'The expiry date is before the issue date.');
    $('rSave').disabled = true; $('rErr').textContent = 'Uploading…';
    const path = `${branchId}/${crypto.randomUUID()}.${extOf(file.type)}`;
    try {
      await storeFile('pharmacy-documents', path, file);
      try { await rpc('document_renew', { p_id: d.id, p: { ...p, path, file_name: file.name, mime: file.type, size_bytes: file.size } }); }
      catch (err) { await cleanup('pharmacy-documents', path); throw err; }
      $('puDlg').close(); toast(`${d.name} renewed (version ${num(d.version) + 1}).`); await refresh();
    } catch (err) { $('rErr').textContent = friendly(err); $('rSave').disabled = false; }
  };
}
function moveForm(list) {
  dlg(`<h3 class="rt-dlg-title">${I.move} Move to folder</h3><p>${list.length === 1 ? esc(list[0].name) : `${list.length} documents`}</p>
    <div class="pos-field"><label for="mFolder">Folder</label><select id="mFolder">${folderOptions(list[0].folder_id)}</select></div>
    <p class="pos-form-msg" id="mErr"></p>
    <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="mSave">${I.move}<span>Move</span></button></div>`, 'dc-form-dlg');
  $('mSave').onclick = async () => {
    try { await rpc('document_move', { p_ids: list.map(x => x.id), p_folder: $('mFolder').value || null }); $('puDlg').close(); toast('Moved.'); await refresh(); }
    catch (err) { $('mErr').textContent = friendly(err); }
  };
}
function removeDoc(d) {
  dlg(`<h3 class="rt-dlg-title">${I.trash} Remove document</h3><p><b>${esc(d.name)}</b> will be hidden from the list. The stored file is kept and ${d.source === 'supplier' ? 'the removal is recorded' : 'an Admin can restore it'}.</p>
    <div class="pos-field"><label for="rmReason">Reason for removing this document</label><input id="rmReason" maxlength="300" placeholder="e.g. Uploaded twice, wrong file"></div>
    <p class="pos-form-msg" id="rmErr"></p>
    <div class="st-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid dc-danger-solid" id="rmSave">${I.trash}<span>Remove</span></button></div>`, 'dc-form-dlg');
  $('rmReason').focus();
  $('rmSave').onclick = async () => {
    const reason = $('rmReason').value.trim(); if (!reason) return ($('rmErr').textContent = 'Enter a reason.');
    try {
      if (d.source === 'supplier') { const { error } = await sb.rpc('remove_purchase_document', { p_id: d.id, p_reason: reason }); if (error) throw error; }
      else await rpc('document_remove', { p_id: d.id, p_reason: reason });
      $('puDlg').close(); toast('Document removed from archive. Stored file retained.'); await refresh();
    } catch (err) { $('rmErr').textContent = friendly(err); }
  };
}
async function restoreDoc(d) {
  try { await rpc('document_restore', { p_id: d.id }); if ($('puDlg').open) $('puDlg').close(); toast(`${d.name} restored.`); await refresh(); }
  catch (err) { toast(friendly(err), true); }
}

// ---------------------------------------------------------------------------
// Folders, categories, reminders, activity, report
// ---------------------------------------------------------------------------
function folders(focusNew = true) {
  if (!has32) return toast('Folders need migration 0032.', true);
  const fl = ov?.folders || [];
  dlg(`<h3 class="rt-dlg-title">${I.folderPlus} Folders</h3>
    <form id="fForm" class="dc-inline"><input id="fName" maxlength="80" placeholder="New folder name, e.g. Licences 2025" aria-label="New folder name"><button type="submit" class="pos-btn pos-btn-solid pos-btn-sm">${I.plusC}<span>Create folder</span></button></form>
    <p class="pos-form-msg" id="fErr"></p>
    <div class="dc-flist">${fl.map(f => `<div class="dc-frow" data-fid="${esc(f.id)}"><span class="dc-f-ic">${I.folder}</span><input value="${esc(f.name)}" maxlength="80" aria-label="Folder name"><small>${f.count} document${f.count === 1 ? '' : 's'}</small>
      <button type="button" class="pos-btn pos-btn-sm" data-fopen>${I.eye}<span>Open</span></button><button type="button" class="pos-btn pos-btn-sm" data-fsave>${I.tick}<span>Rename</span></button><button type="button" class="pos-btn pos-btn-sm dc-danger" data-fdel>${I.trash}<span>Delete</span></button></div>`).join('') || '<p class="dl-empty">No folders yet. Folders help you keep e.g. all licences or one year\'s audit papers together.</p>'}</div>
    <p class="dl-muted dc-small">Deleting a folder keeps its documents (they move to “No folder”).</p>`, 'dc-form-dlg');
  if (focusNew) $('fName').focus();
  $('fForm').onsubmit = async e => {
    e.preventDefault();
    try { await rpc('document_folder_save', { p_id: null, p_name: $('fName').value }); toast(`Folder “${$('fName').value.trim()}” created.`); await refresh(); folders(); }
    catch (err) { $('fErr').textContent = friendly(err); }
  };
  $('puPanel').onclick = async e => {
    const row = e.target.closest('[data-fid]'); if (!row) return;
    const id = row.dataset.fid;
    try {
      if (e.target.closest('[data-fopen]')) { $('puDlg').close(); $('fFolder').value = id; return loadList(1); }
      if (e.target.closest('[data-fsave]')) { await rpc('document_folder_save', { p_id: id, p_name: row.querySelector('input').value }); toast('Folder renamed.'); }
      else if (e.target.closest('[data-fdel]')) { if (!confirm('Delete this folder? Its documents are kept.')) return; await rpc('document_folder_delete', { p_id: id }); if ($('fFolder').value === id) $('fFolder').value = ''; toast('Folder deleted.'); }
      else return;
      await refresh(); folders(false);
    } catch (err) { $('fErr').textContent = friendly(err); }
  };
}
async function manageCats() {
  if (!has32) return toast('Categories need migration 0032.', true);
  let list = [];
  try { list = await rpc('document_categories') || []; } catch (e) { return toast(friendly(e), true); }
  const colorSel = (cur, dis) => `<select data-ccol aria-label="Colour"${dis ? ' disabled' : ''}>${Object.entries(COLORS).map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  dlg(`<h3 class="rt-dlg-title">${I.tag} Manage Categories</h3>
    <p class="dl-muted">Rename the built-in categories, add your own, or hide ones you do not use (only when empty). Supplier Documents come from purchase uploads.</p>
    <div class="dl-table-wrap st-lv-wrap"><table class="dl-table st-lv dc-ct"><thead><tr><th>Category</th><th>Colour</th><th>Documents</th><th>Shown</th><th></th></tr></thead><tbody>
      ${list.map(c => `<tr data-code="${esc(c.code)}"><td><span class="dc-ct-name"><span class="dc-tile-ic sm ${esc(c.color)}">${catIcon(c.is_system ? c.code : 'others')}</span><input value="${esc(c.name)}" maxlength="60" aria-label="Category name"${c.code === 'supplier' ? ' disabled' : ''}></span></td>
        <td>${colorSel(c.color, c.code === 'supplier')}</td><td>${count(c.doc_count)}</td>
        <td><input type="checkbox" data-cact${c.active ? ' checked' : ''}${['others', 'supplier'].includes(c.code) ? ' disabled' : ''} aria-label="Shown"></td>
        <td>${c.code === 'supplier' ? '' : `<button type="button" class="pos-btn pos-btn-sm" data-csave>${I.tick}<span>Save</span></button>`}</td></tr>`).join('')}
    </tbody></table></div>
    <h4 class="st-subh">Add a category</h4>
    <form id="cForm" class="dc-inline"><input id="cName" maxlength="60" placeholder="e.g. Fire Safety" aria-label="New category name">${colorSel('teal').replace('data-ccol', 'id="cCol"')}<button type="submit" class="pos-btn pos-btn-solid pos-btn-sm">${I.plusC}<span>Add</span></button></form>
    <p class="pos-form-msg" id="cErr"></p>`, 'dc-wide-dlg');
  $('cForm').onsubmit = async e => {
    e.preventDefault();
    try { await rpc('document_category_save', { p_code: null, p_name: $('cName').value, p_color: $('cCol').value, p_active: true }); toast(`Category “${$('cName').value.trim()}” added.`); await refresh(); manageCats(); }
    catch (err) { $('cErr').textContent = friendly(err); }
  };
  $('puPanel').onclick = async e => {
    if (!e.target.closest('[data-csave]')) return;
    const tr = e.target.closest('tr');
    try {
      await rpc('document_category_save', { p_code: tr.dataset.code, p_name: tr.querySelector('input:not([type])').value, p_color: tr.querySelector('[data-ccol]').value, p_active: tr.querySelector('[data-cact]').checked });
      toast('Category saved.'); await refresh(); manageCats();
    } catch (err) { $('cErr').textContent = friendly(err); }
  };
}
function catsAll() {
  dlg(`<h3 class="rt-dlg-title">${I.tag} All Categories</h3>
    <div class="dc-cats dc-cats-all">${cats.map(c => `<button type="button" class="dc-tile ${esc(c.color)}${c.active === false ? ' dim' : ''}" data-cat="${esc(c.code)}"><span class="dc-tile-ic">${catIcon(c.is_system ? c.code : 'others')}</span>
      <span class="dc-tile-b"><b>${esc(c.name)}</b><small>${count(c.count)} document${c.count === 1 ? '' : 's'}${num(c.expiring) ? ` · <em class="low">${c.expiring} expiring</em>` : ''}${num(c.expired) ? ` · <em class="out">${c.expired} expired</em>` : ''}</small></span></button>`).join('')}</div>
    ${admin && has32 ? `<div class="st-foot"><button type="button" class="pos-btn" id="goCats">${I.tag}<span>Manage categories</span></button></div>` : ''}`, 'dc-wide-dlg');
  $('puPanel').onclick = e => {
    if (e.target.closest('#goCats')) return manageCats();
    const t = e.target.closest('[data-cat]'); if (!t) return;
    $('puDlg').close(); $('fCat').value = t.dataset.cat; renderCats(); loadList(1); scrollToList();
  };
}
async function reminders() {
  if (!has32) return toast('Expiry reminders need migration 0032.', true);
  let L = [];
  try { L = (await rpc('documents_list', { p_q: null, p_category: null, p_status: null, p_folder: null, p_include_removed: false, p_sort: 'expiry', p_limit: 5000, p_offset: 0 })).rows.filter(d => d.expiry_date); }
  catch (e) { return toast(friendly(e), true); }
  const def = ov?.default_remind_days || 30;
  dlg(`<h3 class="rt-dlg-title">${I.bell} Expiry Reminders</h3>
    <p class="dl-muted">Documents turn <b>Expiring Soon</b> this many days before their expiry date. They are shown in the bell, on this page and in the expiring list. Leave a document's box empty to use the default.</p>
    <div class="dc-inline dc-def"><label for="remDef">Default reminder</label><input id="remDef" type="number" min="1" max="365" value="${def}"><span>days before expiry</span>
      <span class="dc-presets">${[15, 30, 60, 90].map(n => `<button type="button" class="pos-btn pos-btn-sm" data-pre="${n}">${n}</button>`).join('')}</span></div>
    <div class="dl-table-wrap st-lv-wrap"><table class="dl-table st-lv dc-rt"><thead><tr><th>Document</th><th>Expiry</th><th>Status</th><th>Remind (days)</th></tr></thead><tbody>
      ${L.map(d => `<tr data-rid="${esc(d.id)}" data-src="${esc(d.source)}"><td><b>${esc(d.name)}</b><small>${esc(d.category_name)}${d.reference_no ? ` · ${esc(d.reference_no)}` : ''}</small></td><td>${esc(dmy(d.expiry_date))}<small>${esc(daysTxt(d.days_left))}</small></td><td>${statusChip(d)}</td>
        <td><input type="number" min="1" max="365" value="${d.remind_days || ''}" placeholder="${def}" data-orig="${d.remind_days || ''}" aria-label="Reminder days for ${esc(d.name)}"${d.can_edit ? '' : ' disabled'}></td></tr>`).join('') || '<tr><td colspan="4" class="dl-empty">No documents with an expiry date.</td></tr>'}
    </tbody></table></div>
    <p class="pos-form-msg" id="remErr"></p>
    <div class="st-foot"><button type="button" class="pos-btn dc-wa" id="remShare">${I.wa}<span>Share expiry list</span></button><button type="button" class="pos-btn" id="remCsv">${I.download}<span>CSV</span></button><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="remSave">${I.tick}<span>Save reminders</span></button></div>`, 'dc-wide-dlg');
  $('puPanel').onclick = e => { const n = e.target.closest('[data-pre]')?.dataset.pre; if (n) $('remDef').value = n; };
  $('remShare').onclick = () => shareExpiry();
  $('remCsv').onclick = () => csvDownload(`document-expiry-${today()}.csv`, [['Document', 'Category', 'Reference No.', 'Expiry date', 'Days left', 'Status', 'Reminder days'], ...L.map(d => [d.name, d.category_name, d.reference_no || '', d.expiry_date, d.days_left, STATUS[d.status]?.[0] || d.status, d.remind_days || `${def} (default)`])]);
  $('remSave').onclick = async () => {
    const dv = +$('remDef').value;
    if (!(dv >= 1 && dv <= 365)) return ($('remErr').textContent = 'Default reminder must be 1 to 365 days.');
    const items = [...$('puPanel').querySelectorAll('tr[data-rid] input')].filter(i => !i.disabled && i.value !== i.dataset.orig).map(i => ({ id: i.closest('tr').dataset.rid, remind_days: i.value ? +i.value : null }));
    if (items.some(x => x.remind_days !== null && !(x.remind_days >= 1 && x.remind_days <= 365))) return ($('remErr').textContent = 'Reminder days must be 1 to 365.');
    try { const n = await rpc('document_reminders_save', { p_default_days: dv, p_items: items }); $('puDlg').close(); toast(`Reminders saved${n ? ` (${n} document${n === 1 ? '' : 's'} changed)` : ''}.`); await refresh(); }
    catch (err) { $('remErr').textContent = friendly(err); }
  };
}
function shareExpiry() {
  const L = ov?.expiring_list || [];
  if (!L.length) return toast('No documents are expiring or expired.');
  const txt = ['*Pallikkal Pharmacy — documents to renew*', `As on ${dmy(today())}`, '', ...L.map((d, i) => `${i + 1}. ${d.name}${d.reference_no ? ` (${d.reference_no})` : ''} — ${d.status === 'expired' ? `EXPIRED ${dmy(d.expiry_date)}` : `expires ${dmy(d.expiry_date)}, ${d.days_left} days left`}`)].join('\n');
  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank', 'noopener');
}
async function activityLog() {
  dlg(`<h3 class="rt-dlg-title">${I.clock} Document activity</h3><div class="dc-alist dc-alist-all" id="actsAll"><p class="dl-muted">Loading…</p></div>`, 'dc-wide-dlg');
  try { const a = await rpc('document_activity', { p_id: null, p_limit: 300 }) || []; $('actsAll').innerHTML = a.map(actRow).join('') || '<p class="dl-empty">No activity yet.</p>'; }
  catch (e) { $('actsAll').innerHTML = `<p class="dl-muted">${esc(friendly(e))}</p>`; }
}
async function reportRows(scope) {
  if (!has32) return legacy.filter(d => d.record_status === 'active');
  const f = filters();
  const args = scope === 'filter' ? { p_q: f.q, p_category: f.category, p_status: f.status, p_folder: f.folder, p_include_removed: showRemoved, p_sort: f.sort }
    : scope === 'attention' ? { p_q: null, p_category: null, p_status: 'attention', p_folder: null, p_include_removed: false, p_sort: 'expiry' }
      : { p_q: null, p_category: null, p_status: null, p_folder: null, p_include_removed: false, p_sort: 'name' };
  return (await rpc('documents_list', { ...args, p_limit: 5000, p_offset: 0 })).rows || [];
}
const REPORT_HEAD = ['#', 'Document', 'Category', 'Reference No.', 'Issued by / Distributor', 'Issue date', 'Expiry date', 'Days left', 'Status', 'Folder', 'File', 'Size', 'Uploaded', 'Notes'];
const reportLine = (d, i) => [i + 1, d.name, d.category_name, d.reference_no || '', d.authority || '', d.issue_date || '', d.expiry_date || '', d.days_left ?? '', STATUS[d.status]?.[0] || d.status, d.folder || '', d.file_name, size(d.size_bytes), ds(d.created_at), d.notes || ''];
async function report(kind, scope = 'all') {
  let L;
  try { L = await reportRows(scope); } catch (e) { return toast(friendly(e), true); }
  if (kind === 'csv') { csvDownload(`documents-${scope}-${today()}.csv`, [REPORT_HEAD, ...L.map(reportLine)]); return toast(`Report downloaded (${L.length} documents).`); }
  const c = { valid: L.filter(d => d.status === 'valid').length, expiring: L.filter(d => d.status === 'expiring').length, expired: L.filter(d => d.status === 'expired').length };
  printHTML(`<style>body{font:10.5px Arial;margin:10px;color:#0b1b33}h2{margin:0;color:#02224d}table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border-bottom:1px solid #ddd;padding:4px;text-align:left;vertical-align:top}th{background:#0f7a16;color:#fff}.ex{color:#c4291f;font-weight:bold}.es{color:#b45309;font-weight:bold}.s{color:#555}</style>
    <h2>Pallikkal Pharmacy — Documents report</h2><p class="s">${esc(dmy(today()))} · ${L.length} documents · Valid ${c.valid} · Expiring soon ${c.expiring} · Expired ${c.expired}${scope === 'attention' ? ' · Expiring and expired only' : scope === 'filter' ? ' · Current filter' : ''}</p>
    <table><thead><tr><th>#</th><th>Document</th><th>Category</th><th>Reference No.</th><th>Issued by</th><th>Issue</th><th>Expiry</th><th>Status</th></tr></thead><tbody>
    ${L.map((d, i) => `<tr><td>${i + 1}</td><td><b>${esc(d.name)}</b>${d.folder ? `<br><span class="s">${esc(d.folder)}</span>` : ''}</td><td>${esc(d.category_name)}</td><td>${esc(d.reference_no || '')}</td><td>${esc(d.authority || '')}</td><td>${esc(dmy(d.issue_date))}</td><td>${d.expiry_date ? esc(dmy(d.expiry_date)) : 'No expiry'}</td><td class="${d.status === 'expired' ? 'ex' : d.status === 'expiring' ? 'es' : ''}">${esc(STATUS[d.status]?.[0] || d.status)}${d.days_left !== null && d.days_left !== undefined && d.status !== 'valid' ? `<br>${esc(daysTxt(d.days_left))}` : ''}</td></tr>`).join('')}</tbody></table>`, 'Documents report', 'a4');
}
function reportDlg() {
  dlg(`<h3 class="rt-dlg-title">${I.report} Download Report</h3>
    <div class="pos-field"><label for="repScope">Documents</label><select id="repScope"><option value="all">All documents</option><option value="filter">Current filter / search</option><option value="attention">Expiring and expired only</option></select></div>
    <div class="dc-rep">
      <button type="button" class="dc-rep-b" data-rep="csv"><span class="dc-q-ic">${I.download}</span><b>Excel / CSV</b><small>Every field, opens in Excel or Google Sheets</small></button>
      <button type="button" class="dc-rep-b" data-rep="print"><span class="dc-q-ic">${I.print}</span><b>Print / Save as PDF</b><small>A4 report for inspection or audit</small></button>
      <button type="button" class="dc-rep-b" data-rep="share"><span class="dc-q-ic dc-wa">${I.wa}</span><b>WhatsApp expiry list</b><small>Documents to renew, as text</small></button>
    </div>`, 'dc-form-dlg');
  $('puPanel').onclick = e => {
    const k = e.target.closest('[data-rep]')?.dataset.rep; if (!k) return;
    if (k === 'share') return shareExpiry();
    report(k, $('repScope').value);
  };
}

// header / quick actions / more
$('uploadBtn')?.addEventListener('click', () => uploadForm());
$('folderBtn')?.addEventListener('click', () => folders());
$('catsAll').addEventListener('click', catsAll);
$('quick').addEventListener('click', e => {
  const k = e.target.closest('[data-q]')?.dataset.q; if (!k) return;
  ({ upload: () => uploadForm(), folder: () => folders(), cats: () => manageCats(), reminders: () => reminders(), report: () => reportDlg(),
    attention: () => { $('fStatus').value = 'attention'; loadList(1); $('listCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); } })[k]?.();
});
$('moreMenu').addEventListener('click', e => {
  const k = e.target.closest('[data-more]')?.dataset.more; if (!k) return;
  closePops();
  if (k === 'removed') { showRemoved = !showRemoved; $('removedLbl').textContent = showRemoved ? 'Hide removed documents' : 'Show removed documents'; return loadList(1); }
  if (k === 'archived') { $('fStatus').value = 'archived'; return loadList(1); }
  ({ cats: () => manageCats(), folders: () => folders(), reminders: () => reminders(), csv: () => report('csv'), print: () => report('print'), share: () => shareExpiry(), acts: () => activityLog(), refresh: () => refresh().then(() => toast('Refreshed.')) })[k]?.();
});

// ---------------------------------------------------------------------------
// Bell, load
// ---------------------------------------------------------------------------
function notify() {
  const items = [];
  if (num(ov?.expired)) items.push({ tone: 'warn', title: `${ov.expired} document${ov.expired === 1 ? '' : 's'} expired`, detail: (ov.expiring_list || []).filter(d => d.status === 'expired').slice(0, 2).map(d => d.name).join(', '), href: 'documents.html?status=expired' });
  if (num(ov?.expiring)) items.push({ tone: 'info', title: `${ov.expiring} document${ov.expiring === 1 ? '' : 's'} expiring soon`, detail: (ov.expiring_list || []).filter(d => d.status === 'expiring').slice(0, 2).map(d => `${d.name} (${d.days_left} days)`).join(', '), href: 'documents.html?status=expiring' });
  setNotifications(items);
}
async function refresh() {
  await loadOverview();
  renderKpis(); renderCats(); renderExpiring();
  await loadList();
  notify();
}
try { view = localStorage.getItem('pp.docs.view') === 'grid' ? 'grid' : 'list'; } catch { /* ignore */ }
$('fView').value = view;
if (['valid', 'expiring', 'expired', 'attention', 'no_expiry', 'archived', 'removed'].includes(params.get('status'))) $('fStatus').value = params.get('status');
await loadSupplierLookups();
await refresh();
if (params.get('category') && cats.some(c => c.code === params.get('category'))) { $('fCat').value = params.get('category'); renderCats(); loadList(1); }
const show = params.get('show');
if (show === 'upload') uploadForm(); else if (show === 'reminders' && admin) reminders(); else if (show === 'folders' && admin) folders(); else if (show === 'categories' && admin) manageCats(); else if (show === 'report') reportDlg();
let rz;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderExpiring, 150); });
