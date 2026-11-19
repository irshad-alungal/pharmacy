// Delivery Management (admin / staff) — Pallikkal Pharmacy design.
// Delivery-person accounts are routed to the rider dashboard (delivery-rider.js).
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { icon, setNotifications } from './brand-shell.js';
import { searchBox, mountGlobalSearch } from './global-search.js';
import { showInvoice } from './invoice.js';

const { data: { user: currentUser }, error: currentUserError } = await sb.auth.getUser();
let currentRole = null;
if (currentUser && !currentUserError) {
  const { data: roleData, error: roleError } = await sb.rpc('my_role');
  if (!roleError) currentRole = roleData;
}

if (currentRole === 'delivery_person') {
  const { mountRiderPage } = await import('./delivery-rider.js');
  await mountRiderPage(currentUser);
} else {
  await mountManagementPage();
}

async function mountManagementPage() {
  const profile = await mountShell('delivery', 'Delivery Management', { layout: 'brand' });
  if (!profile) throw new Error('Unable to load user profile.');
  const root = document.getElementById('view');
  if (!profile.branch_id) { root.textContent = 'Your profile has no assigned branch.'; throw new Error('Missing branch_id'); }

  const isAdmin = ['super_admin', 'admin'].includes(String(profile.role || '').toLowerCase());
  const $ = id => document.getElementById(id);
  const TZ = 'Asia/Kolkata';
  const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const istDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const dateText = value => value ? new Date(value).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(' am', ' AM').replace(' pm', ' PM') : '—';
  const dayLine = value => value ? new Date(value).toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const timeLine = value => value ? new Date(value).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).replace(' am', ' AM').replace(' pm', ' PM') : '';
  const phoneDigits = value => { let n = String(value || '').replace(/\D/g, ''); if (n.length === 10) n = `91${n}`; if (n.startsWith('0') && n.length === 11) n = `91${n.slice(1)}`; return n; };
  const mapsUrl = addr => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const AV_COLORS = ['#12a01b', '#1e7be6', '#7a4ff0', '#f29a00', '#0e9488', '#e0365a'];
  const avatar = (name, cls = '') => `<span class="dl-av ${cls}" style="--c:${AV_COLORS[[...String(name || 'x')].reduce((s, c) => s + c.charCodeAt(0), 0) % AV_COLORS.length]}" aria-hidden="true">${esc(initials(name))}</span>`;

  const STATUS = {
    pending: { label: 'Pending', cls: 'pending' },
    out: { label: 'Out for Delivery', cls: 'out' },
    done: { label: 'Delivered', cls: 'done' },
    failed: { label: 'Failed', cls: 'failed' },
    none: { label: 'Not requested', cls: 'none' }
  };
  const I = {
    scooter: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="2.5"/><circle cx="18.5" cy="17.5" r="2.5"/><path d="M8 17.5h7.5l2-6.5h-4"/><path d="M15 6h3l-1 5"/><path d="M5.5 15 8 10h5"/></svg>',
    plusCircle: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    user: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4 3.8-6.5 7.5-6.5s6.7 2.5 7.5 6.5"/></svg>',
    login: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/></svg>',
    box: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/></svg>',
    check: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
    x: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
    list: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
    cal: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>',
    filter: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M3 4h18l-7 8.5V19l-4 2v-8.5Z"/></svg>',
    search: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    eye: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    pin: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    doc: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
    pencil: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    truck: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v10H2z"/><path d="M13 9h4.5l3.5 3.5V16h-8"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
    tick: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
    clock: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    xs: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    users: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.8c2 .7 3.2 2.5 3.5 5.2"/></svg>',
    summary: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3M8 14h8M8 17h5"/></svg>',
    phone: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>',
    chev: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    left: '<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
    up: '<svg class="dz-trend-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
    down: '<svg class="dz-trend-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10M17 9v8H9"/></svg>'
  };
  const statusChip = s => {
    const st = STATUS[s] || STATUS.pending;
    const ic = s === 'out' ? I.truck : s === 'done' ? I.tick : s === 'pending' ? I.clock : s === 'failed' ? I.xs : '';
    return `<span class="dl-chip ${st.cls}">${ic}${st.label}</span>`;
  };
  const KPI = (cls, ic, label, id) => `<div class="dz-kpi ${cls}"><span class="dz-kpi-icon">${ic}</span><div class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong id="${id}"><span class="dz-skel"></span></strong><small id="${id}Note"></small></div></div>`;

  let orders = [];
  let deliveryPeople = [];
  let feePerDelivery = 0;
  let tab = 'all';
  let page = 1;
  const PAGE = 8;
  const filters = { person: '', from: '', to: '', includeAll: false };

  document.getElementById('ppSearchSlot').innerHTML = searchBox('ppSearch');
  mountGlobalSearch({ sb, prof: profile });

  root.innerHTML = `
  <div class="pos dl">
    <section class="pos-head">
      <div class="pos-title"><span class="pos-title-ic">${I.scooter}</span>
        <div><h1>Delivery Management</h1><p>Manage delivery orders, assign delivery boys, and track order status in real time.</p></div></div>
      <div class="pos-head-actions dl-head-actions">
        <button type="button" class="pos-btn pos-btn-solid" id="newDelivery">${I.plusCircle}<span>New Delivery</span></button>
        <button type="button" class="pos-btn" id="assignOrders">${I.user}<span>Assign Orders</span></button>
        <a class="pos-btn" href="delivery-boy-login.html">${I.login}<span>Delivery Boy Login</span></a>
      </div>
    </section>

    <section class="dz-kpis dl-kpis" aria-label="Delivery figures">
      ${KPI('purple', I.box, 'Total Deliveries', 'kTotal')}
      ${KPI('green', I.scooter, 'Out for Delivery', 'kOut')}
      ${KPI('green', I.check, 'Delivered', 'kDone')}
      ${KPI('rose', I.x, 'Failed / Returned', 'kFailed')}
    </section>

    <div class="dl-grid">
      <section class="pos-card dl-orders">
        <div class="dl-card-head">
          <h2>${I.list}Delivery Orders</h2>
          <div class="dl-head-tools">
            <label class="dl-select">${I.cal}<select id="period" aria-label="Period">
              <option value="1">Today</option><option value="7" selected>Last 7 Days</option><option value="30">Last 30 Days</option><option value="90">Last 90 Days</option></select></label>
            <div class="dl-pop-anchor">
              <button type="button" class="pos-btn dl-filter-btn" id="filterBtn" aria-expanded="false">${I.filter}<span>Filter</span><b class="dl-filter-dot" id="filterDot" hidden></b></button>
              <div class="dl-pop" id="filterPop" hidden>
                <div class="pos-field"><label for="fPerson">Delivery boy</label><select id="fPerson"><option value="">All delivery boys</option></select></div>
                <div class="dl-pop-row"><div class="pos-field"><label for="fFrom">From</label><input id="fFrom" type="date"></div><div class="pos-field"><label for="fTo">To</label><input id="fTo" type="date"></div></div>
                <label class="dl-check"><input type="checkbox" id="fAll"> Also show bills without a delivery request</label>
                <div class="dl-pop-foot"><button type="button" class="pos-btn pos-btn-sm" id="fReset">Reset</button><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="fApply">Apply</button></div>
              </div>
            </div>
          </div>
        </div>
        <div class="dl-tabs" role="tablist" id="tabs">
          ${[['all', 'All Orders'], ['pending', 'Pending'], ['out', 'Out for Delivery'], ['done', 'Delivered'], ['failed', 'Failed']].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${k === 'all' ? 'on' : ''}">${l} (<span id="t_${k}">0</span>)</button>`).join('')}
        </div>
        <label class="dl-search">${I.search}<input id="dSearch" type="search" placeholder="Search by Order ID, Customer, Phone or Address..." autocomplete="off"></label>
        <div class="dl-table-wrap"><table class="dl-table"><thead><tr><th>Order ID</th><th>Customer</th><th>Order Date</th><th class="c-r">Amount</th><th>Delivery Boy</th><th>Status</th><th class="c-c">Actions</th></tr></thead>
          <tbody id="deliveryRows"><tr><td colspan="7" class="dl-empty">Loading…</td></tr></tbody></table></div>
        <div class="dl-pager"><span id="dCount"></span><div id="pager"></div></div>
        <p id="dMessage" class="dl-msg" role="status" aria-live="polite"></p>
      </section>

      <aside class="dl-side">
        <section class="pos-card">
          <div class="dl-card-head"><h2>${I.users}Delivery Boy Status</h2><button type="button" class="dl-link" id="viewPeople">View All ${I.chev}</button></div>
          <div id="people" class="dl-people"><p class="dl-empty">Loading…</p></div>
        </section>
        <section class="pos-card">
          <div class="dl-card-head"><h2>${I.summary}Delivery Summary</h2></div>
          <div class="dl-sum">
            <div class="dl-donut"><svg viewBox="0 0 220 220" id="donut" aria-hidden="true"></svg><div class="dl-donut-c"><strong id="sumTotal">0</strong><span>Total Orders</span></div></div>
            <div class="dl-legend" id="legend"></div>
          </div>
        </section>
      </aside>
    </div>
  </div>
  <dialog id="dlDialog" class="pos-dialog dl-dialog"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="deliveryModalBody"></div></dialog>`;

  // ------------------------------------------------------------------ helpers
  const isRequested = row => Boolean(row.delivery?.is_requested);
  const statusOf = row => isRequested(row) ? (row.delivery?.status || 'pending') : 'none';
  const refTime = row => row.delivery?.requested_at || row.created_at;
  const periodDays = () => Number($('period').value);
  const today = () => istDay(new Date());
  function inPeriod(row, offset = 0) {
    const days = periodDays();
    const end = addDays(today(), -offset * days);
    const start = addDays(end, -(days - 1));
    const d = istDay(refTime(row));
    return d >= start && d <= end;
  }
  const customerName = row => row.customer?.name || 'Walk-in';
  const addrOf = row => row.customer?.address || '';

  function dialog(html) {
    $('deliveryModalBody').innerHTML = html;
    if (!$('dlDialog').open) $('dlDialog').showModal();
  }
  const closeDialog = () => $('dlDialog').close();
  $('dlDialog').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('dlDialog')) closeDialog(); });

  // ------------------------------------------------------------------ KPIs
  function trendHtml(now, prev, lowerIsBetter = false) {
    const days = periodDays();
    const vs = days === 1 ? 'vs. yesterday' : `vs. previous ${days} days`;
    if (!prev) return now ? `<span class="${lowerIsBetter ? 'dz-down' : 'dz-up'}">New</span> <span>${vs}</span>` : `<span>No activity ${days === 1 ? 'today' : 'in this period'}</span>`;
    const pct = (now - prev) / prev * 100;
    const good = (pct >= 0) !== lowerIsBetter;
    return `<span class="${good ? 'dz-up' : 'dz-down'}">${pct >= 0 ? I.up : I.down}${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span><span>${vs}</span>`;
  }
  function renderKpis(cur, prev) {
    const c = s => cur.filter(r => statusOf(r) === s).length;
    const p = s => prev.filter(r => statusOf(r) === s).length;
    const set = (id, v, n) => { $(id).textContent = v; $(id + 'Note').innerHTML = n; };
    set('kTotal', cur.length, trendHtml(cur.length, prev.length));
    const outNow = orders.filter(r => statusOf(r) === 'out').length;
    set('kOut', c('out'), `<span>${outNow} on the road right now</span>`);
    set('kDone', c('done'), trendHtml(c('done'), p('done')));
    set('kFailed', c('failed'), trendHtml(c('failed'), p('failed'), true));
  }

  // ------------------------------------------------------------------ list
  function baseRows() {
    return orders.filter(row => {
      if (!filters.includeAll && !isRequested(row)) return false;
      if (filters.person && row.delivery_person?.id !== filters.person) return false;
      const d = istDay(refTime(row));
      if (filters.from || filters.to) {
        if (filters.from && d < filters.from) return false;
        if (filters.to && d > filters.to) return false;
        return true;
      }
      return inPeriod(row);
    });
  }
  function render() {
    const query = $('dSearch').value.trim().toLowerCase();
    const base = baseRows().filter(row => {
      if (!query) return true;
      const c = row.customer || {};
      return `${row.invoice_no || ''} ${c.name || ''} ${c.phone || ''} ${c.address || ''} ${row.delivery_person?.full_name || ''}`.toLowerCase().includes(query);
    });
    for (const k of ['all', 'pending', 'out', 'done', 'failed']) $(`t_${k}`).textContent = k === 'all' ? base.length : base.filter(r => statusOf(r) === k).length;
    const rows = tab === 'all' ? base : base.filter(r => statusOf(r) === tab);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    page = Math.min(page, pages);
    const shown = rows.slice((page - 1) * PAGE, page * PAGE);
    $('deliveryRows').innerHTML = shown.map(row => {
      const c = row.customer || {};
      const st = statusOf(row);
      const person = row.delivery_person;
      const actions = [`<button type="button" class="dl-act" data-view="${esc(row.id)}" title="View details" aria-label="View ${esc(row.invoice_no)}">${I.eye}</button>`];
      if (st === 'out' && addrOf(row)) actions.push(`<a class="dl-act green" href="${esc(mapsUrl(addrOf(row)))}" target="_blank" rel="noopener" title="Open address in Maps" aria-label="Open address in Maps">${I.pin}</a>`);
      else if (st === 'done') actions.push(`<button type="button" class="dl-act green" data-invoice="${esc(row.id)}" title="View invoice" aria-label="View invoice">${I.doc}</button>`);
      else if (st === 'pending' || st === 'failed') actions.push(`<button type="button" class="dl-act" data-assign="${esc(row.id)}" title="${person ? 'Reassign' : 'Assign'} delivery boy" aria-label="Assign delivery boy">${I.pencil}</button>`);
      else if (st === 'none') actions.push(`<button type="button" class="dl-act green" data-request="${esc(row.id)}" title="Create delivery for this bill" aria-label="Create delivery">${I.plusCircle}</button>`);
      return `<tr class="st-${st}" data-row="${esc(row.id)}">
        <td class="c-id"><b>${esc(row.invoice_no || '—')}</b></td>
        <td class="c-cust"><span class="dl-strong">${esc(c.name || 'Walk-in')}</span><small>${esc(c.phone || 'No phone')}</small></td>
        <td class="c-date"><span>${esc(dayLine(refTime(row)))},</span> <small>${esc(timeLine(refTime(row)))}</small></td>
        <td class="c-r c-amt">${money(row.total)}</td>
        <td class="c-boy">${person ? `<span class="dl-boy">${avatar(person.full_name)}<span>${esc(person.full_name)}</span></span>` : (st === 'none' ? '<span class="dl-muted">—</span>' : `<button type="button" class="dl-unassigned" data-assign="${esc(row.id)}">Assign</button>`)}</td>
        <td class="c-st">${statusChip(st)}</td>
        <td class="c-act"><div class="dl-acts">${actions.join('')}</div><span class="dl-chev">${I.chev}</span></td>
      </tr>`;
    }).join('') || `<tr><td colspan="7" class="dl-empty">${orders.length ? 'No delivery orders match these filters.' : 'No delivery orders yet. Use “New Delivery” to send a bill out for delivery.'}</td></tr>`;
    $('dCount').textContent = rows.length ? `Showing ${(page - 1) * PAGE + 1} – ${Math.min(page * PAGE, rows.length)} of ${rows.length} orders` : '';
    $('pager').innerHTML = pages > 1 ? `<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, i, arr) => `${i && n - arr[i - 1] > 1 ? '<span>…</span>' : ''}<button type="button" data-page="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button>` : '';

    const cur = orders.filter(r => isRequested(r) && inPeriod(r)), prev = orders.filter(r => isRequested(r) && inPeriod(r, 1));
    renderKpis(cur, prev);
    renderDonut(cur);
    renderPeople();
    $('filterDot').hidden = !(filters.person || filters.from || filters.to || filters.includeAll);
  }

  function renderDonut(rows) {
    const parts = [['done', 'Delivered', '#16b525'], ['out', 'Out for Delivery', '#2d8cf0'], ['pending', 'Pending', '#f5b301'], ['failed', 'Failed / Returned', '#e5484d']]
      .map(([k, l, col]) => ({ k, l, col, n: rows.filter(r => statusOf(r) === k).length }));
    const total = rows.length;
    const C = 2 * Math.PI * 84;
    let off = 0;
    const gap = parts.filter(p => p.n).length > 1 ? 3 : 0;
    $('donut').innerHTML = `<circle cx="110" cy="110" r="84" fill="none" stroke="#eef1f5" stroke-width="28"/>` + parts.map(p => {
      const len = total ? p.n / total * C : 0;
      const s = len > gap ? `<circle cx="110" cy="110" r="84" fill="none" stroke="${p.col}" stroke-width="28" stroke-dasharray="${len - gap} ${C - len + gap}" stroke-dashoffset="${-off}"/>` : '';
      off += len;
      return s;
    }).join('');
    $('sumTotal').textContent = total;
    $('legend').innerHTML = parts.map(p => `<button type="button" data-tab-go="${p.k}"><i style="background:${p.col}"></i><span><b>${p.l}</b><small>${p.n} order${p.n === 1 ? '' : 's'}</small></span><em>${total ? (p.n / total * 100).toFixed(1) : '0.0'}%</em></button>`).join('');
  }

  const PRES = { available: ['Online', 'on'], purchasing: ['Purchasing', 'busy'], offline: ['Offline', 'off'] };
  const presChip = p => { const [l, c] = PRES[p] || PRES.offline; return `<span class="dl-pres ${c}"><i></i>${l}</span>`; };
  function renderPeople() {
    const counts = new Map();
    for (const r of orders) if (isRequested(r) && r.delivery_person && inPeriod(r)) counts.set(r.delivery_person.id, (counts.get(r.delivery_person.id) || 0) + 1);
    $('people').innerHTML = deliveryPeople.length ? deliveryPeople.slice(0, 5).map(p => `<button type="button" class="dl-person" data-person="${esc(p.id)}">${avatar(p.full_name, 'lg')}<span class="dl-person-txt"><b>${esc(p.full_name)}</b><small>${counts.get(p.id) || 0} order${counts.get(p.id) === 1 ? '' : 's'}${p.active_orders ? ` · ${p.active_orders} active` : ''}</small></span>${presChip(p.presence)}</button>`).join('')
      : `<p class="dl-empty">No delivery boys yet.${isAdmin ? ' Use “View All” to create a delivery account.' : ''}</p>`;
    const sel = $('fPerson'), keep = sel.value;
    sel.innerHTML = '<option value="">All delivery boys</option>' + deliveryPeople.map(p => `<option value="${esc(p.id)}">${esc(p.full_name)} · ${esc(p.staff_id)}</option>`).join('');
    sel.value = keep;
  }

  // ------------------------------------------------------------------ data
  let loading = false;
  async function load(quiet = false) {
    if (loading) return;
    loading = true;
    if (!quiet) $('dMessage').textContent = 'Loading delivery orders…';
    const { data, error } = await sb.rpc('delivery_management_list_v2', { p_days: 120 });
    loading = false;
    if (error) {
      // Fall back to the original list if migration 0022 has not been applied yet.
      const old = await sb.rpc('delivery_management_list');
      if (old.error) {
        orders = []; deliveryPeople = [];
        $('deliveryRows').innerHTML = `<tr><td colspan="7" class="dl-empty">${esc(friendly(error))}</td></tr>`;
        $('dMessage').textContent = 'Could not load delivery records.';
        return;
      }
      orders = old.data?.invoices || [];
      deliveryPeople = (old.data?.delivery_people || []).map(p => ({ ...p, presence: 'offline' }));
      $('dMessage').textContent = 'Run migration 0022 to enable failed/returned status, delivery times and earnings.';
    } else {
      orders = Array.isArray(data?.invoices) ? data.invoices : [];
      deliveryPeople = Array.isArray(data?.delivery_people) ? data.delivery_people : [];
      feePerDelivery = Number(data?.settings?.fee_per_delivery || 0);
      $('dMessage').textContent = quiet ? '' : `${orders.filter(isRequested).length} delivery order(s) · ${deliveryPeople.length} delivery boy account(s) · updated ${new Date().toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}`;
    }
    render();
    const unassigned = orders.filter(r => statusOf(r) === 'pending' && !r.delivery_person).length;
    const failed = orders.filter(r => statusOf(r) === 'failed').length;
    const issues = orders.filter(r => r.delivery?.issue_at && ['pending', 'out'].includes(statusOf(r))).length;
    const online = deliveryPeople.filter(p => p.presence === 'available').length;
    const notes = [];
    if (unassigned) notes.push({ tone: 'warn', title: `${unassigned} delivery order(s) not assigned`, detail: 'Use Assign Orders to give them to a delivery boy', href: 'delivery.html' });
    if (issues) notes.push({ tone: 'danger', title: `${issues} delivery issue(s) reported`, detail: 'Open the order to read the note', href: 'delivery.html' });
    if (failed) notes.push({ tone: 'danger', title: `${failed} failed / returned delivery(ies)`, detail: 'Reassign or remove the delivery request', href: 'delivery.html' });
    if (!online && deliveryPeople.length) notes.push({ tone: 'info', title: 'No delivery boy is online', detail: 'All delivery boys are offline or purchasing', href: 'delivery.html' });
    setNotifications(notes);
  }

  // ------------------------------------------------------------------ details / actions
  function timeline(row) {
    const d = row.delivery || {};
    const steps = [
      ['Bill created', row.created_at], ['Delivery requested', d.requested_at], [`Assigned${row.delivery_person ? ` to ${row.delivery_person.full_name}` : ''}`, d.assigned_at],
      ['Out for delivery', d.out_at], ['Delivered', d.delivered_at], [`Failed / returned${d.failure_reason ? ` — ${d.failure_reason}` : ''}`, d.failed_at]
    ].filter(([, t]) => t);
    return `<ol class="dl-timeline">${steps.map(([l, t]) => `<li><b>${esc(l)}</b><small>${esc(dateText(t))}</small></li>`).join('')}</ol>`;
  }
  function showDetails(id) {
    const row = orders.find(item => item.id === id); if (!row) return;
    const c = row.customer || {}; const person = row.delivery_person; const phone = c.phone || ''; const st = statusOf(row); const d = row.delivery || {};
    dialog(`<h3>Order ${esc(row.invoice_no || '')} ${statusChip(st)}</h3>
      <div class="delivery-detail-grid dl-detail-grid">
        <div><small>Customer</small><b>${esc(c.name || 'Walk-in')}</b></div>
        <div><small>Phone</small><b>${esc(phone || '—')}</b></div>
        <div class="wide"><small>Delivery address</small><b>${esc(c.address || 'Not recorded')}</b></div>
        <div><small>Invoice total</small><b>${money(row.total)}</b></div>
        <div><small>Invoice date</small><b>${esc(dateText(row.created_at))}</b></div>
        <div><small>Delivery boy</small><b>${esc(person?.full_name || 'Not assigned')}</b></div>
        <div><small>Delivery boy phone</small><b>${esc(person?.phone || '—')}</b></div>
        ${d.delivery_note ? `<div class="wide"><small>Note for delivery boy</small><b>${esc(d.delivery_note)}</b></div>` : ''}
        ${d.issue_note ? `<div class="wide dl-issue"><small>Issue reported ${esc(dateText(d.issue_at))}</small><b>${esc(d.issue_note)}</b></div>` : ''}
      </div>
      ${isRequested(row) ? timeline(row) : ''}
      <div class="dl-contact">${phone ? `<a class="pos-btn pos-btn-sm" href="tel:${esc(phone)}">${I.phone}<span>Call customer</span></a><a class="pos-btn pos-btn-sm" target="_blank" rel="noopener" href="https://wa.me/${phoneDigits(phone)}"><span>WhatsApp</span></a>` : ''}${c.address ? `<a class="pos-btn pos-btn-sm" target="_blank" rel="noopener" href="${esc(mapsUrl(c.address))}">${I.pin}<span>Open in Maps</span></a>` : ''}<button type="button" class="pos-btn pos-btn-sm" data-invoice="${esc(id)}">${I.doc}<span>View invoice</span></button></div>
      ${isRequested(row) && st !== 'done' ? `<details class="dl-edit"><summary>Edit delivery address, phone or note</summary>
        <div class="pos-field"><label for="edAddr">Delivery address</label><input id="edAddr" maxlength="400" value="${esc(d.delivery_address || c.address || '')}"></div>
        <div class="dl-pop-row"><div class="pos-field"><label for="edPhone">Contact phone</label><input id="edPhone" inputmode="tel" value="${esc(d.delivery_phone || c.phone || '')}"></div>
        <div class="pos-field"><label for="edNote">Note for delivery boy</label><input id="edNote" maxlength="500" value="${esc(d.delivery_note || '')}"></div></div>
        <button type="button" class="pos-btn pos-btn-sm pos-btn-solid" data-save-details="${esc(id)}">Save details</button></details>` : ''}
      <p class="pos-form-msg" id="detailMsg" role="alert"></p>
      <div class="pos-dialog-foot dl-foot">
        <button class="pos-btn ${isRequested(row) ? 'pos-btn-red' : 'pos-btn-solid'}" data-toggle-request="${esc(id)}" type="button">${isRequested(row) ? 'Remove delivery request' : 'Mark delivery requested'}</button>
        ${isRequested(row) && st !== 'done' && st !== 'out' ? `<button class="pos-btn pos-btn-solid" data-assign="${esc(id)}" type="button">${person ? 'Reassign delivery boy' : 'Assign delivery boy'}</button>` : ''}
      </div>`);
  }
  function personOptions(selected) {
    return deliveryPeople.map(p => `<option value="${esc(p.id)}" ${selected === p.id ? 'selected' : ''}>${esc(p.full_name)} · ${esc(p.staff_id)} — ${(PRES[p.presence] || PRES.offline)[0]}${p.active_orders ? ` · ${p.active_orders} active` : ''}</option>`).join('');
  }
  function showAssignment(id) {
    const row = orders.find(item => item.id === id); if (!row) return;
    const existing = row.delivery_person;
    dialog(`<h3>Assign delivery</h3><p class="dl-muted">Order ${esc(row.invoice_no || '—')} · ${esc(customerName(row))} · ${money(row.total)}</p>
      ${statusOf(row) === 'failed' ? `<p class="dl-warn">This delivery failed${row.delivery?.failure_reason ? `: ${esc(row.delivery.failure_reason)}` : ''}. Assigning it again starts a new attempt.</p>` : ''}
      <div class="pos-field"><label for="assignPerson">Delivery boy</label><select id="assignPerson"><option value="">Select delivery boy…</option>${personOptions(existing?.id)}</select></div>
      <p id="assignError" class="pos-form-msg" role="alert"></p>
      <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button class="pos-btn pos-btn-solid" data-save-assignment="${esc(id)}" type="button">Save assignment</button></div>`);
  }

  async function openInvoice(id) {
    const det = await sb.rpc('invoice_detail', { p_invoice: id });
    if (det.error) { alert(friendly(det.error)); return; }
    const { data: b } = await sb.from('branches').select('name,address,city,state,pincode,phone,email,gstin,drug_licence_nos,invoice_footer').eq('id', det.data?.invoice?.branch_id || profile.branch_id).maybeSingle();
    det.data.shop = {
      name: b?.name || 'PALLIKKAL PHARMACY',
      address: [b?.address, b?.city, b?.state, b?.pincode].map(v => String(v || '').trim()).filter(Boolean).join(', '),
      phone: b?.phone || '', email: b?.email || '', gstin: b?.gstin || '',
      drug_licence: Array.isArray(b?.drug_licence_nos) ? b.drug_licence_nos.filter(Boolean).join(' / ') : String(b?.drug_licence_nos || ''),
      footer_note: b?.invoice_footer || ''
    };
    if ($('dlDialog').open) closeDialog();
    showInvoice(det.data);
  }

  // New delivery: pick a recent final bill, confirm address, optionally assign
  function showNewDelivery(preselect = null) {
    const candidates = orders.filter(r => !isRequested(r)).slice(0, 300);
    dialog(`<h3>New delivery</h3><p class="dl-muted">Choose a final bill from the last 120 days, confirm where it goes and who delivers it.</p>
      <div class="pos-field"><label for="ndSearch">Bill</label><input id="ndSearch" placeholder="Search bill number, customer or phone" autocomplete="off"></div>
      <div class="dl-pick" id="ndList"></div>
      <div id="ndForm" hidden>
        <div class="pos-field"><label for="ndAddr">Delivery address *</label><input id="ndAddr" maxlength="400" placeholder="House, street, area, landmark"></div>
        <div class="dl-pop-row"><div class="pos-field"><label for="ndPhone">Contact phone</label><input id="ndPhone" inputmode="tel" placeholder="Customer phone"></div>
        <div class="pos-field"><label for="ndPerson">Delivery boy</label><select id="ndPerson"><option value="">Assign later</option>${personOptions(deliveryPeople.find(p => p.presence === 'available')?.id)}</select></div></div>
        <div class="pos-field"><label for="ndNote">Note for delivery boy</label><input id="ndNote" maxlength="500" placeholder="e.g. collect ₹50 change, call before arriving"></div>
      </div>
      <p class="pos-form-msg" id="ndMsg" role="alert"></p>
      <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="ndSave" disabled>Create delivery</button></div>`);
    let chosen = null;
    const paint = () => {
      const q = $('ndSearch').value.trim().toLowerCase();
      const list = candidates.filter(r => !q || `${r.invoice_no} ${r.customer?.name || ''} ${r.customer?.phone || ''}`.toLowerCase().includes(q)).slice(0, 30);
      $('ndList').innerHTML = list.map(r => `<button type="button" data-pick="${esc(r.id)}" class="${chosen?.id === r.id ? 'on' : ''}"><b>${esc(r.invoice_no)}</b><span>${esc(customerName(r))}${r.customer?.phone ? ` · ${esc(r.customer.phone)}` : ''}</span><em>${money(r.total)}</em><small>${esc(dateText(r.created_at))}</small></button>`).join('')
        || '<p class="dl-empty">No bill without a delivery request matches.</p>';
    };
    const pick = id => {
      chosen = candidates.find(r => r.id === id);
      if (!chosen) return;
      $('ndForm').hidden = false;
      $('ndAddr').value = chosen.customer?.address || '';
      $('ndPhone').value = chosen.customer?.phone || '';
      $('ndSave').disabled = false;
      paint();
      $('ndAddr').focus();
    };
    $('ndSearch').oninput = paint;
    $('ndList').onclick = e => { const b = e.target.closest('[data-pick]'); if (b) pick(b.dataset.pick); };
    $('ndSave').onclick = async () => {
      if (!chosen) return;
      const addr = $('ndAddr').value.trim();
      if (addr.length < 5) return ($('ndMsg').textContent = 'Enter the delivery address.');
      $('ndSave').disabled = true; $('ndSave').textContent = 'Creating…';
      const req = await sb.rpc('delivery_set_request', { p_invoice_id: chosen.id, p_requested: true });
      let err = req.error;
      if (!err) {
        const det = await sb.rpc('delivery_set_details', { p_invoice_id: chosen.id, p_address: addr, p_phone: $('ndPhone').value.trim(), p_note: $('ndNote').value.trim() });
        if (det.error && !/function|schema cache/i.test(det.error.message || '')) err = det.error;
      }
      if (!err && $('ndPerson').value) err = (await sb.rpc('delivery_assign', { p_invoice_id: chosen.id, p_delivery_person_id: $('ndPerson').value })).error;
      if (err) { $('ndMsg').textContent = friendly(err); $('ndSave').disabled = false; $('ndSave').textContent = 'Create delivery'; await load(true); return; }
      closeDialog();
      await load(true);
      $('dMessage').textContent = `Delivery created for ${chosen.invoice_no}${$('ndPerson')?.value ? ' and assigned' : ''}.`;
    };
    paint();
    if (preselect) pick(preselect);
    else $('ndSearch').focus();
  }

  // Assign orders in bulk
  function showBulkAssign() {
    const open = orders.filter(r => isRequested(r) && ['pending', 'failed'].includes(statusOf(r)));
    dialog(`<h3>Assign orders</h3><p class="dl-muted">Select pending or failed orders and the delivery boy who will take them.</p>
      <div class="pos-field"><label for="baPerson">Delivery boy</label><select id="baPerson"><option value="">Select delivery boy…</option>${personOptions(deliveryPeople.find(p => p.presence === 'available')?.id)}</select></div>
      <label class="dl-check dl-all"><input type="checkbox" id="baAll"> Select all unassigned (${open.filter(r => !r.delivery_person).length})</label>
      <div class="dl-pick dl-pick-check" id="baList">${open.map(r => `<label><input type="checkbox" value="${esc(r.id)}" ${r.delivery_person ? '' : 'data-unassigned'}><b>${esc(r.invoice_no)}</b><span>${esc(customerName(r))} · ${esc(r.customer?.address || 'no address')}</span><em>${money(r.total)}</em><small>${r.delivery_person ? `With ${esc(r.delivery_person.full_name)} · ${STATUS[statusOf(r)].label}` : 'Unassigned'}</small></label>`).join('') || '<p class="dl-empty">No pending or failed orders to assign.</p>'}</div>
      <p class="pos-form-msg" id="baMsg" role="alert"></p>
      <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="baSave" ${open.length ? '' : 'disabled'}>Assign selected</button></div>`);
    $('baAll').onchange = e => $('baList').querySelectorAll('input[data-unassigned]').forEach(i => { i.checked = e.target.checked; });
    $('baSave').onclick = async () => {
      const person = $('baPerson').value;
      const ids = [...$('baList').querySelectorAll('input:checked')].map(i => i.value);
      if (!person) return ($('baMsg').textContent = 'Select a delivery boy.');
      if (!ids.length) return ($('baMsg').textContent = 'Select at least one order.');
      $('baSave').disabled = true; $('baSave').textContent = `Assigning ${ids.length}…`;
      const failed = [];
      for (const id of ids) {
        const { error } = await sb.rpc('delivery_assign', { p_invoice_id: id, p_delivery_person_id: person });
        if (error) failed.push(`${orders.find(r => r.id === id)?.invoice_no}: ${friendly(error)}`);
      }
      await load(true);
      if (failed.length) { $('baMsg').textContent = failed.join(' · '); $('baSave').disabled = false; $('baSave').textContent = 'Assign selected'; return; }
      closeDialog();
      $('dMessage').textContent = `${ids.length} order(s) assigned to ${deliveryPeople.find(p => p.id === person)?.full_name || 'the delivery boy'}.`;
    };
  }

  // All delivery boys + create account + fee (admin)
  function showPeople(focusId = null) {
    const todayDone = new Map(deliveryPeople.map(p => [p.id, p.delivered_today || 0]));
    dialog(`<h3>Delivery boys</h3>
      <div class="dl-people dl-people-all">${deliveryPeople.map(p => `<div class="dl-person ${focusId === p.id ? 'focus' : ''}">${avatar(p.full_name, 'lg')}<span class="dl-person-txt"><b>${esc(p.full_name)}</b><small>${esc(p.staff_id)}${p.phone ? ` · ${esc(p.phone)}` : ''}</small><small>${p.active_orders || 0} active · ${todayDone.get(p.id)} delivered today${p.presence_at ? ` · status since ${esc(timeLine(p.presence_at))}` : ''}</small></span>${presChip(p.presence)}${p.phone ? `<a class="dl-act green" href="tel:${esc(p.phone)}" title="Call ${esc(p.full_name)}">${I.phone}</a>` : ''}<button type="button" class="dl-act" data-filter-person="${esc(p.id)}" title="Show ${esc(p.full_name)}'s orders">${I.list}</button></div>`).join('') || '<p class="dl-empty">No delivery boy accounts yet.</p>'}</div>
      ${isAdmin ? `<div class="dl-admin">
        <h4>Delivery fee</h4>
        <div class="dl-fee"><div class="pos-field"><label for="feeIn">Paid per completed delivery (₹)</label><input id="feeIn" type="number" min="0" step="1" value="${feePerDelivery}"></div><button type="button" class="pos-btn pos-btn-sm pos-btn-solid" id="feeSave">Save fee</button></div>
        <small class="dl-muted">Delivery boys see their earnings as completed deliveries × this fee. Each delivery keeps the fee in force when it was completed.</small>
        <p class="pos-form-msg" id="feeMsg"></p>
        <h4>Create delivery boy account</h4>
        <form id="deliveryAccountForm" class="delivery-form-grid dl-form">
          <div class="pos-field"><label for="newDeliveryId">Delivery ID</label><input id="newDeliveryId" required minlength="3" maxlength="32" pattern="[A-Za-z0-9._\\-]{3,32}" title="3–32 letters, numbers, dot, dash or underscore" placeholder="Example: RIDER01" autocomplete="off"></div>
          <div class="pos-field"><label for="newDeliveryName">Full name</label><input id="newDeliveryName" required maxlength="120" placeholder="Delivery boy's name"></div>
          <div class="pos-field"><label for="newDeliveryPhone">Phone number</label><input id="newDeliveryPhone" type="tel" maxlength="30" placeholder="Phone number"></div>
          <div class="pos-field"><label for="newDeliveryPassword">Temporary password</label><input id="newDeliveryPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password" placeholder="Minimum 12 characters"></div>
          <p id="deliveryAccountMessage" class="dl-muted wide" role="status" aria-live="polite">Share the Delivery ID and password securely. They sign in at Delivery Boy Login.</p>
          <div class="wide"><button class="pos-btn pos-btn-solid" id="createDeliveryAccount" type="submit">Create account</button></div>
        </form></div>` : ''}`);
    if (!isAdmin) return;
    $('feeSave').onclick = async () => {
      const v = Number($('feeIn').value);
      if (!(v >= 0)) return ($('feeMsg').textContent = 'Enter a fee of 0 or more.');
      $('feeSave').disabled = true;
      const { data, error } = await sb.rpc('delivery_settings_set', { p_fee_per_delivery: v });
      $('feeSave').disabled = false;
      if (error) return ($('feeMsg').textContent = friendly(error));
      feePerDelivery = Number(data);
      $('feeMsg').textContent = `Saved: ₹${feePerDelivery} per completed delivery.`;
    };
    $('deliveryAccountForm').addEventListener('submit', async event => {
      event.preventDefault(); const message = $('deliveryAccountMessage'); const button = $('createDeliveryAccount');
      const staffId = $('newDeliveryId').value.trim(); const fullName = $('newDeliveryName').value.trim();
      const phone = $('newDeliveryPhone').value.trim(); const password = $('newDeliveryPassword').value;
      if (password.length < 12) { message.textContent = 'Temporary password must contain at least 12 characters.'; return; }
      button.disabled = true; button.textContent = 'Creating…'; message.textContent = 'Creating delivery-person account…';
      try {
        const result = await callAdminStaff({ action: 'create', staff_id: staffId, full_name: fullName, phone, role: 'delivery_person', password });
        message.textContent = `${result.message || 'Delivery-person account created successfully.'} Delivery ID: ${result.staff?.staff_id || staffId}.`;
        $('deliveryAccountForm').reset(); await load(true);
      } catch (error) { message.textContent = `Could not create account: ${error.message}`; }
      finally { button.disabled = false; button.textContent = 'Create account'; }
    });
  }
  async function callAdminStaff(body) {
    const { data, error } = await sb.functions.invoke('admin-staff', { body });
    if (error) {
      let detail = error.message || 'Request failed';
      if (error.context && typeof error.context.json === 'function') { try { const result = await error.context.json(); detail = result.error || detail; } catch {} }
      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  // ------------------------------------------------------------------ events
  $('deliveryRows').addEventListener('click', e => {
    const b = e.target.closest('[data-view],[data-assign],[data-invoice],[data-request]');
    if (b?.dataset.view) return showDetails(b.dataset.view);
    if (b?.dataset.assign) return showAssignment(b.dataset.assign);
    if (b?.dataset.invoice) return openInvoice(b.dataset.invoice);
    if (b?.dataset.request) return showNewDelivery(b.dataset.request);
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-row]');
    if (tr && matchMedia('(max-width: 900px)').matches) showDetails(tr.dataset.row);
  });
  $('deliveryModalBody').addEventListener('click', async e => {
    const toggle = e.target.closest('[data-toggle-request]');
    if (toggle) {
      const id = toggle.dataset.toggleRequest;
      const row = orders.find(item => item.id === id);
      if (!isRequested(row)) { closeDialog(); return showNewDelivery(id); }
      if (!confirm('Remove the delivery request for this bill? Any assignment is cleared.')) return;
      toggle.disabled = true;
      const { error } = await sb.rpc('delivery_set_request', { p_invoice_id: id, p_requested: false });
      if (error) { toggle.disabled = false; $('detailMsg').textContent = friendly(error); return; }
      closeDialog(); await load(true); return;
    }
    const inv = e.target.closest('[data-invoice]'); if (inv) return openInvoice(inv.dataset.invoice);
    const assignButton = e.target.closest('[data-assign]'); if (assignButton) return showAssignment(assignButton.dataset.assign);
    const fp = e.target.closest('[data-filter-person]');
    if (fp) { filters.person = fp.dataset.filterPerson; $('fPerson').value = filters.person; closeDialog(); page = 1; render(); return; }
    const sd = e.target.closest('[data-save-details]');
    if (sd) {
      sd.disabled = true;
      const { error } = await sb.rpc('delivery_set_details', { p_invoice_id: sd.dataset.saveDetails, p_address: $('edAddr').value, p_phone: $('edPhone').value, p_note: $('edNote').value });
      sd.disabled = false;
      if (error) { $('detailMsg').textContent = friendly(error); return; }
      await load(true); showDetails(sd.dataset.saveDetails); $('detailMsg').textContent = 'Delivery details saved.'; $('detailMsg').classList.add('ok'); return;
    }
    const save = e.target.closest('[data-save-assignment]');
    if (save) {
      const personId = $('assignPerson').value;
      if (!personId) { $('assignError').textContent = 'Select an active delivery boy.'; return; }
      save.disabled = true; save.textContent = 'Saving…';
      const { error } = await sb.rpc('delivery_assign', { p_invoice_id: save.dataset.saveAssignment, p_delivery_person_id: personId });
      if (error) { $('assignError').textContent = friendly(error); save.disabled = false; save.textContent = 'Save assignment'; return; }
      closeDialog(); await load(true);
    }
  });
  $('tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; page = 1; document.querySelectorAll('#tabs [data-tab]').forEach(x => x.classList.toggle('on', x === b)); render(); };
  $('legend').onclick = e => { const b = e.target.closest('[data-tab-go]'); if (b) $('tabs').querySelector(`[data-tab="${b.dataset.tabGo}"]`).click(); };
  $('pager').onclick = e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = Number(b.dataset.page); render(); } };
  $('dSearch').addEventListener('input', () => { page = 1; render(); });
  $('period').onchange = () => { filters.from = filters.to = ''; $('fFrom').value = $('fTo').value = ''; page = 1; render(); };
  $('people').onclick = e => { const b = e.target.closest('[data-person]'); if (b) showPeople(b.dataset.person); };
  $('viewPeople').onclick = () => showPeople();
  // Refresh first so orders created on other screens are included.
  $('newDelivery').onclick = async () => { await load(true); showNewDelivery(); };
  $('assignOrders').onclick = async () => { await load(true); showBulkAssign(); };
  const pop = $('filterPop');
  $('filterBtn').onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; $('filterBtn').setAttribute('aria-expanded', String(!pop.hidden)); };
  pop.onclick = e => e.stopPropagation();
  document.addEventListener('click', () => { pop.hidden = true; });
  $('fApply').onclick = () => { filters.person = $('fPerson').value; filters.from = $('fFrom').value; filters.to = $('fTo').value; filters.includeAll = $('fAll').checked; pop.hidden = true; page = 1; render(); };
  $('fReset').onclick = () => { filters.person = filters.from = filters.to = ''; filters.includeAll = false; $('fPerson').value = $('fFrom').value = $('fTo').value = ''; $('fAll').checked = false; pop.hidden = true; page = 1; render(); };

  await load();
  // Near real-time: refresh while the page is visible.
  setInterval(() => { if (document.visibilityState === 'visible' && !$('dlDialog').open) load(true); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(true); });
}
