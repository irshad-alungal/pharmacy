// Delivery Boy dashboard — Pallikkal Pharmacy design.
// Opened from delivery.html (and delivery-boy.html) for delivery_person accounts.
// Every figure comes from delivery_my_jobs_v2(); every change goes through the
// delivery RPCs, which check that the job is assigned to this account.
import { sb } from './supabase-client.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { hasDailyLogin, clearDailyLogin } from './daily-session.js';
import { icon, wireBrandShell, setNotifications } from './brand-shell.js';

const TZ = 'Asia/Kolkata';
const PAGE = 5;

export async function mountRiderPage(user) {
  // Delivery accounts use the same daily work-session rules as pharmacy staff.
  if (!hasDailyLogin(user.id)) {
    clearDailyLogin();
    await sb.rpc('end_work_session', { p_reason: 'new_day' });
    await sb.auth.signOut();
    location.replace('delivery-boy-login.html');
    return;
  }
  const { data: activeSession, error: activeSessionError } = await sb.rpc('touch_work_session');
  if (activeSessionError || activeSession !== true) {
    clearDailyLogin();
    await sb.auth.signOut();
    location.replace('delivery-boy-login.html');
    return;
  }
  const { data: profile, error: profileError } = await sb.from('profiles').select('full_name,is_active,branch_id,staff_id,phone').eq('id', user.id).single();
  if (profileError || !profile?.is_active || !profile.branch_id) {
    await sb.auth.signOut();
    location.replace('delivery-boy-login.html');
    return;
  }

  // ---------------------------------------------------------------- helpers
  const $ = id => document.getElementById(id);
  const money = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const money0 = v => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const istDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const time = v => v ? new Date(v).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).replace(' am', ' AM').replace(' pm', ' PM') : '';
  const dayLabel = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const when = v => v ? new Date(v).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).replace(' am', ' AM').replace(' pm', ' PM') : '—';
  const ago = v => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : when(v); };
  const phoneDigits = value => { let n = String(value || '').replace(/\D/g, ''); if (n.length === 10) n = `91${n}`; return n; };
  const mapsSearch = addr => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  const mapsDir = (dest, stops = []) => `https://www.google.com/maps/dir/?api=1&travelmode=two-wheeler&destination=${encodeURIComponent(dest)}${stops.length ? `&waypoints=${encodeURIComponent(stops.join('|'))}` : ''}`;
  const first = String(profile.full_name || 'there').trim().split(/\s+/)[0];
  const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  const S = {
    pending: ['Pending', 'pending'], out: ['Out for Delivery', 'out'], done: ['Delivered', 'done'], failed: ['Failed', 'failed']
  };
  const svg = (b, w = 1.9) => `<svg class="pp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
  const I = {
    home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>'),
    bike: svg('<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h5l4.5 7.5"/><path d="M9 9 7.5 6H5M14 9l1.5-3H18"/><path d="m9 9 3.5 7.5"/>'),
    checkC: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
    coins: svg('<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/><path d="M4 11.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4 3.8-6.5 7.5-6.5s6.7 2.5 7.5 6.5"/>'),
    help: svg('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>'),
    logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
    box: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/><path d="m7.5 5.5 9 5"/>', 1.7),
    truck: svg('<path d="M2 6h11v10H2z"/><path d="M13 9h4.5l3.5 3.5V16h-8"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>'),
    x: svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
    list: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>', 2.2),
    cal: svg('<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/>'),
    pin: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" fill="currentColor"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>',
    pinO: svg('<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>'),
    phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>', 2),
    bars: '<svg class="pp-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="4" height="8" rx="1" fill="#16a51f"/><rect x="10" y="8" width="4" height="13" rx="1" fill="#16a51f"/><rect x="17" y="3" width="4" height="18" rx="1" fill="#16a51f"/></svg>',
    rupee: svg('<path d="M6 3h12M6 8h12M14 21 6 13h3a5 5 0 0 0 0-10"/>', 2),
    bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>', 2),
    nav: svg('<path d="m3 11 19-9-9 19-2-8-8-2Z"/>'),
    file: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="M12 12v4M12 18.5v.01"/>'),
    power: svg('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>', 2),
    chev: svg('<path d="m9 6 6 6-6 6"/>', 2.2),
    left: svg('<path d="m15 6-6 6 6 6"/>', 2.2),
    down: svg('<path d="m6 9 6 6 6-6"/>', 2.2),
    tick: svg('<path d="m5 12 5 5 9-10"/>', 2.6),
    xs: svg('<path d="M18 6 6 18M6 6l12 12"/>', 2.4),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 2),
    play: svg('<path d="m7 4 13 8-13 8Z"/>', 2),
    key: svg('<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7"/><path d="m17 6 3 3"/>'),
    refresh: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
    chat: svg('<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5.1A8.5 8.5 0 1 1 21 11.5Z"/>')
  };
  const chip = s => { const [l, c] = S[s] || S.pending; const ic = s === 'out' ? I.truck : s === 'done' ? I.tick : s === 'failed' ? I.xs : I.clock; return `<span class="dl-chip ${c}">${ic}${l}</span>`; };

  // ---------------------------------------------------------------- shell
  const NAV = [['dashboard', 'Dashboard', I.home], ['deliveries', 'My Deliveries', I.bike], ['completed', 'Completed', I.checkC], ['earnings', 'Earnings', I.coins], ['profile', 'Profile', I.user], ['help', 'Help & Support', I.help]];
  document.title = 'PALLIKKAL PHARMACY — Delivery Boy Dashboard';
  document.body.className = 'pp-brand-body';
  document.body.innerHTML = `
  <div class="pp-app dl-rider">
    <aside class="pp-sidebar" id="ppSidebar" aria-label="Delivery navigation">
      <div class="pp-brand"><a href="#dashboard" aria-label="Pallikkal Pharmacy home"><img src="assets/images/brand/logo-horizontal.png" alt="Pallikkal Pharmacy" width="220" height="54"></a>
        <button class="pp-icon-btn pp-close-nav" type="button" id="ppCloseNav" aria-label="Close menu">${icon('close')}</button></div>
      <nav class="pp-nav">${NAV.map(([k, l, ic]) => `<a href="#${k}" class="pp-nav-link" data-nav="${k}">${ic}<span>${l}</span></a>`).join('')}
        <a href="#" class="pp-nav-link" id="logoutNav">${I.logout}<span>Logout</span></a></nav>
    </aside>
    <div class="pp-scrim" id="ppScrim" hidden></div>
    <div class="pp-body">
      <header class="pp-topbar">
        <button class="pp-icon-btn pp-burger" type="button" id="ppBurger" aria-label="Open menu">${icon('menu')}</button>
        <a class="pp-mobile-logo" href="#dashboard"><img src="assets/images/brand/logo-horizontal.png" alt="Pallikkal Pharmacy" width="150" height="37"></a>
        <div class="pp-search-wrap"><div class="pp-search"><label for="riderSearch">${icon('search')}<input id="riderSearch" type="search" placeholder="Search by order ID, customer name or phone..." autocomplete="off"><span class="pp-kbd">Ctrl + K</span></label></div></div>
        <div class="pp-top-actions">
          <div class="pp-pop-anchor">
            <button class="pp-icon-btn pp-bell" type="button" id="ppBell" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">${icon('bell')}<span class="pp-dot" id="ppBellDot" hidden></span></button>
            <div class="pp-popover pp-notify" id="ppNotify" hidden><div class="pp-pop-head">Notifications</div><div id="ppNotifyList"><p class="pp-pop-empty">Checking…</p></div></div>
          </div>
          <span class="pp-divider"></span>
          <div class="pp-pop-anchor">
            <button class="pp-user" type="button" id="ppUser" aria-haspopup="true" aria-expanded="false">
              <span class="pp-avatar dl-me">${esc(initials(profile.full_name))}</span><span class="pp-user-name" id="riderName">${esc(profile.full_name || 'Delivery person')}</span>${icon('chevron', 'pp-chev')}
            </button>
            <div class="pp-popover pp-user-menu" id="ppUserMenu" hidden>
              <div class="pp-pop-user"><strong>${esc(profile.full_name || 'Delivery person')}</strong><small>Delivery Boy · ${esc(profile.staff_id || '')}</small></div>
              <a href="#profile">${I.user}Profile</a>
              <a href="change-password.html">${I.key}Change password</a>
              <a href="#" id="riderLogout">${I.logout}Sign out</a>
            </div>
          </div>
        </div>
      </header>
      <main class="pp-main" id="view"><div class="pos dl" id="riderRoot"><p class="dl-empty">Loading your deliveries…</p></div></main>
    </div>
    <nav class="pp-bottom-nav dl-bottom" aria-label="Quick navigation">
      ${NAV.slice(0, 5).map(([k, l, ic]) => `<a href="#${k}" data-nav="${k}">${ic}<span>${l}</span></a>`).join('')}
      <button type="button" id="ppMore" hidden>More</button>
    </nav>
  </div>
  <dialog id="rdDialog" class="pos-dialog dl-dialog"><button type="button" class="pos-icon-btn dl-x" data-close aria-label="Close">${I.xs}</button><div id="rdBody"></div></dialog>
  <div class="dl-toast" id="riderMessage" role="status" aria-live="polite"></div>`;
  wireBrandShell();

  // ---------------------------------------------------------------- state
  let jobs = [];
  let fee = 0;
  let branch = null;
  let presence = 'offline';
  let view = 'dashboard';
  let tab = 'all';
  let page = 1;
  let dateSel = 'today';
  let query = '';
  let seenIds = null;
  let toastT;
  const toast = (m, bad = false) => {
    const el = $('riderMessage');
    el.textContent = m;
    el.className = `dl-toast show${bad ? ' bad' : ''}`;
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.className = 'dl-toast'; }, bad ? 7000 : 4000);
  };

  const today = () => istDay(new Date());
  const stamp = j => j.status === 'done' ? j.delivered_at : j.status === 'failed' ? j.failed_at : j.status === 'out' ? (j.out_at || j.updated_at) : (j.assigned_at || j.requested_at || j.created_at);
  const active = j => ['pending', 'out'].includes(j.status);
  function inDate(j, sel = dateSel) {
    if (sel === 'all') return true;
    const t = today();
    const days = sel === 'today' ? [t] : sel === 'yesterday' ? [addDays(t, -1)] : Array.from({ length: 7 }, (_, i) => addDays(t, -i));
    const touched = [j.assigned_at, j.out_at, j.delivered_at, j.failed_at].filter(Boolean).map(istDay);
    return touched.some(d => days.includes(d)) || (sel === 'today' && active(j));
  }
  const nextJob = () => jobs.filter(j => j.status === 'out').sort((a, b) => new Date(a.out_at || a.updated_at) - new Date(b.out_at || b.updated_at))[0]
    || jobs.filter(j => j.status === 'pending').sort((a, b) => new Date(a.assigned_at) - new Date(b.assigned_at))[0] || null;
  const earned = list => list.reduce((s, j) => s + Number(j.status === 'done' ? (j.fee_earned ?? 0) : 0), 0);

  // ---------------------------------------------------------------- presence
  const PRES = { available: ['Online', 'on'], purchasing: ['Purchasing', 'busy'], offline: ['Offline', 'off'] };
  function presenceControl() {
    const [label, cls] = PRES[presence] || PRES.offline;
    return `<div class="dl-presence">
      <label class="dl-pres-select ${cls}"><i></i><select id="presSel" aria-label="Your availability">
        <option value="available" ${presence === 'available' ? 'selected' : ''}>Online</option>
        <option value="purchasing" ${presence === 'purchasing' ? 'selected' : ''}>Purchasing</option>
        <option value="offline" ${presence === 'offline' ? 'selected' : ''}>Offline</option></select><b>${label}</b>${I.down}</label>
      <button type="button" class="pos-btn dl-go ${presence === 'offline' ? 'online' : ''}" id="presToggle">${I.power}<span>${presence === 'offline' ? 'Go Online' : 'Go Offline'}</span></button>
    </div>`;
  }
  async function setPresence(next) {
    const { error } = await sb.rpc('delivery_set_presence', { p_status: next });
    if (error) { toast(`Could not update status: ${friendly(error)}`, true); render(); return; }
    presence = next;
    toast(`You are now ${PRES[next][0]}.`);
    render();
  }

  // ---------------------------------------------------------------- views
  const KPI = (cls, ic, label, value) => `<div class="dz-kpi ${cls}"><span class="dz-kpi-icon">${ic}</span><div class="dz-kpi-body"><span class="dz-kpi-label">${label}</span><strong>${value}</strong></div></div>`;
  const DATE_OPTS = [['today', `Today, ${dayLabel(today())}`], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['all', 'All dates']];

  function listRows(list, { paged = true } = {}) {
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    page = Math.min(page, pages);
    const shown = paged ? list.slice((page - 1) * PAGE, page * PAGE) : list;
    const rows = shown.map(j => {
      const c = j.customer || {};
      const nextBtn = j.status === 'pending' ? `<button type="button" class="dl-act blue" data-go="${esc(j.id)}" data-next="out" title="Start delivery (out for delivery)" aria-label="Start delivery">${I.play}</button>`
        : j.status === 'out' ? `<button type="button" class="dl-act green solid" data-go="${esc(j.id)}" data-next="done" title="Mark delivered" aria-label="Mark delivered">${I.tick}</button>` : '';
      return `<tr class="st-${esc(j.status)}" data-job="${esc(j.id)}">
        <td class="c-id"><b>${esc(j.invoice_no)}</b><small>${esc(time(stamp(j)))}</small></td>
        <td class="c-cust"><span class="dl-strong">${esc(c.name || 'Customer')}</span><small class="dl-addr">${I.pinO}${esc(c.address || 'No address recorded')}</small><span class="dl-m-chip">${chip(j.status)}</span></td>
        <td class="c-r c-amt">${money(j.total)}</td>
        <td class="c-ago"><span>${esc(j.status === 'done' ? `Delivered ${time(j.delivered_at)}` : j.status === 'failed' ? `Failed ${time(j.failed_at)}` : j.status === 'out' ? `Out ${ago(j.out_at || j.updated_at)}` : `Assigned ${ago(j.assigned_at)}`)}</span></td>
        <td class="c-st">${chip(j.status)}</td>
        <td class="c-act"><div class="dl-acts">
          ${c.address ? `<a class="dl-act green" href="${esc(mapsDir(c.address))}" target="_blank" rel="noopener" title="Navigate" aria-label="Navigate to ${esc(c.name || 'customer')}">${I.pin}</a>` : `<span class="dl-act disabled" title="No address">${I.pin}</span>`}
          ${c.phone ? `<a class="dl-act green" href="tel:${esc(c.phone)}" title="Call ${esc(c.phone)}" aria-label="Call customer">${I.phone}</a>` : `<span class="dl-act disabled" title="No phone">${I.phone}</span>`}
          ${nextBtn}</div></td>
      </tr>`;
    }).join('');
    const pager = paged && pages > 1 ? `<div id="pager">${`<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>`}${Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - page) <= 1).map((n, i, arr) => `${i && n - arr[i - 1] > 1 ? '<span>…</span>' : ''}<button type="button" data-page="${n}" class="${n === page ? 'on' : ''}">${n}</button>`).join('')}<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page">${I.chev}</button></div>` : '';
    return { rows, pager, from: list.length ? (paged ? (page - 1) * PAGE + 1 : 1) : 0, to: paged ? Math.min(page * PAGE, list.length) : list.length };
  }

  function deliveriesCard(title, base, { showDate = true, tabs = true } = {}) {
    const q = query.toLowerCase();
    const searched = base.filter(j => !q || `${j.invoice_no} ${j.customer?.name || ''} ${j.customer?.phone || ''} ${j.customer?.address || ''}`.toLowerCase().includes(q));
    const counts = k => k === 'all' ? searched.length : searched.filter(j => j.status === k).length;
    const useTab = tabs ? tab : 'all';
    const list = (useTab === 'all' ? searched : searched.filter(j => j.status === useTab))
      .sort((a, b) => (active(b) - active(a)) || (new Date(stamp(b)) - new Date(stamp(a))));
    const { rows, pager, from, to } = listRows(list);
    return `<section class="pos-card dl-orders">
      <div class="dl-card-head"><h2>${I.list}${title} (${searched.length})</h2>
        ${showDate ? `<label class="dl-select">${I.cal}<select id="dateSel" aria-label="Date">${DATE_OPTS.map(([k, l]) => `<option value="${k}" ${k === dateSel ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}</div>
      ${query ? `<p class="dl-filter-note">Showing results for “${esc(query)}” <button type="button" class="pos-text-btn" id="clearQ">Clear search</button></p>` : ''}
      ${tabs ? `<div class="dl-tabs dl-pills" role="tablist" id="tabs">${[['all', 'All'], ['pending', 'Pending'], ['out', 'Out for Delivery'], ['done', 'Delivered'], ['failed', 'Failed']].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}">${l} (${counts(k)})</button>`).join('')}</div>` : ''}
      <div class="dl-table-wrap"><table class="dl-table dl-rider-table"><thead><tr><th>Order ID</th><th>Customer &amp; Address</th><th class="c-r">Amount</th><th>Time</th><th>Status</th><th class="c-c">Action</th></tr></thead>
        <tbody id="riderJobs">${rows || `<tr><td colspan="6" class="dl-empty">${jobs.length ? 'No deliveries match.' : 'No deliveries are assigned to you yet. New orders appear here automatically.'}</td></tr>`}</tbody></table></div>
      <div class="dl-pager"><span>${list.length ? `Showing ${from} – ${to} of ${list.length} orders` : ''}</span>${pager}${view === 'dashboard' && list.length > PAGE ? '<a class="dl-link" href="#deliveries">View All Orders ' + I.chev + '</a>' : ''}</div>
    </section>`;
  }

  function summaryCard(list) {
    const d = list.filter(j => j.status === 'done').length, o = list.filter(j => j.status === 'out').length, f = list.filter(j => j.status === 'failed').length;
    return `<section class="pos-card dl-today">
      <div class="dl-card-head"><h2>${I.bars}${dateSel === 'today' ? 'Today’s' : 'Period'} Summary</h2><a class="dl-link" href="#earnings">View Earnings ${I.chev}</a></div>
      <div class="dl-today-grid">
        <div class="ok">${I.checkC}<strong>${d}</strong><span>Delivered</span></div>
        <div class="blue">${I.truck}<strong>${o}</strong><span>Out for Delivery</span></div>
        <div class="bad">${I.x}<strong>${f}</strong><span>Failed</span></div>
        <div class="purple">${I.rupee}<strong>${money0(earned(list))}</strong><span>Earnings</span></div>
      </div>
    </section>`;
  }

  function routeCard() {
    const stops = jobs.filter(j => active(j) && j.customer?.address);
    const order = [...stops.filter(j => j.status === 'out'), ...stops.filter(j => j.status === 'pending')];
    const next = order[0];
    const all = order.map(j => j.customer.address);
    const link = next ? mapsDir(all[all.length - 1], all.slice(0, -1)) : '';
    return `<section class="pos-card dl-route">
      <div class="dl-card-head"><h2><span class="dl-pin-ic">${I.pin}</span>My Delivery Route</h2>${next ? `<a class="dl-link" href="${esc(link)}" target="_blank" rel="noopener">View Map ${I.chev}</a>` : ''}</div>
      ${next ? `<div class="dl-map"><iframe title="Map of the next delivery address" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${encodeURIComponent(next.customer.address)}&z=15&output=embed"></iframe></div>
        <ol class="dl-stops">${order.slice(0, 4).map((j, i) => `<li><b>${i + 1}</b><span>${esc(j.customer.name || j.invoice_no)} · ${esc(j.customer.address)}</span>${chip(j.status)}</li>`).join('')}${order.length > 4 ? `<li class="more">+${order.length - 4} more stop(s) in Maps</li>` : ''}</ol>`
        : `<div class="dl-map dl-map-empty">${I.pinO}<span>No active deliveries with an address. Your route appears here when orders are assigned.</span></div>`}
    </section>`;
  }

  function quickCard() {
    return `<section class="pos-card dl-quick">
      <h2>${I.bolt}Quick Actions</h2>
      <div class="dl-qa">
        <button type="button" data-qa="nav">${I.nav}<span>Navigate<br>Next Order</span></button>
        <button type="button" data-qa="call">${I.phone}<span>Call<br>Customer</span></button>
        <button type="button" data-qa="status">${I.box}<span>Update<br>Delivery Status</span></button>
        <button type="button" data-qa="issue">${I.file}<span>Report<br>Issue</span></button>
      </div>
    </section>`;
  }

  function header(title, sub, withPresence = true) {
    return `<section class="pos-head dl-rider-head">
      <div class="pos-title"><span class="pos-title-ic">${I.bike}</span><div><h1>${title}</h1><p>${sub}</p></div></div>
      ${withPresence ? presenceControl() : ''}
    </section>`;
  }

  function renderDashboard() {
    const list = jobs.filter(j => inDate(j));
    const c = k => list.filter(j => j.status === k).length;
    return `${header('Delivery Boy Dashboard', `Welcome back, ${esc(first)}! Here’s your delivery overview for ${dateSel === 'today' ? 'today' : 'this period'}.`)}
      <section class="dz-kpis dl-kpis">
        ${KPI('green', I.box, 'Assigned Orders', list.length)}
        ${KPI('blue', I.truck, 'Out for Delivery', c('out'))}
        ${KPI('green', I.checkC, 'Delivered', c('done'))}
        ${KPI('rose', I.x, 'Failed / Returned', c('failed'))}
      </section>
      <div class="dl-grid">
        <div class="dl-main-col">${deliveriesCard('My Deliveries', list)}</div>
        <aside class="dl-side">${summaryCard(list)}${routeCard()}${quickCard()}</aside>
      </div>`;
  }
  function renderDeliveries() {
    return `${header('My Deliveries', 'Every order assigned to you. Tap an order to update it.', true)}
      ${deliveriesCard('My Deliveries', jobs.filter(j => inDate(j)))}`;
  }
  function renderCompleted() {
    const list = jobs.filter(j => ['done', 'failed'].includes(j.status) && inDate(j));
    return `${header('Completed', 'Delivered and failed / returned orders.', false)}
      ${deliveriesCard('Completed Orders', list, { tabs: false })}`;
  }
  function renderEarnings() {
    const done = jobs.filter(j => j.status === 'done' && j.delivered_at);
    const t = today();
    const sumDays = n => earned(done.filter(j => istDay(j.delivered_at) >= addDays(t, -(n - 1))));
    const monthStart = t.slice(0, 8) + '01';
    const month = earned(done.filter(j => istDay(j.delivered_at) >= monthStart));
    const byDay = new Map();
    for (const j of done) { const d = istDay(j.delivered_at); const e = byDay.get(d) || { n: 0, amt: 0, value: 0 }; e.n++; e.amt += Number(j.fee_earned || 0); e.value += Number(j.total || 0); byDay.set(d, e); }
    const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 31);
    return `${header('Earnings', `Completed deliveries × delivery fee. Current fee: ${money0(fee)} per delivery.`, false)}
      <section class="dz-kpis dl-kpis">
        ${KPI('green', I.rupee, 'Today', money0(sumDays(1)))}
        ${KPI('blue', I.rupee, 'Last 7 days', money0(sumDays(7)))}
        ${KPI('purple', I.rupee, 'This month', money0(month))}
        ${KPI('orange', I.checkC, 'Deliveries completed', done.length)}
      </section>
      <section class="pos-card dl-orders"><div class="dl-card-head"><h2>${I.bars}Earnings by day</h2></div>
        <div class="dl-table-wrap"><table class="dl-table dl-earn"><thead><tr><th>Date</th><th class="c-c">Delivered</th><th class="c-r">Order value</th><th class="c-r">Earned</th></tr></thead><tbody>
        ${days.map(([d, e]) => `<tr><td>${esc(dayLabel(d))}</td><td class="c-c">${e.n}</td><td class="c-r">${money(e.value)}</td><td class="c-r"><b>${money(e.amt)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="dl-empty">No completed deliveries yet.</td></tr>'}
        </tbody></table></div>
        ${fee ? '' : '<p class="dl-muted">The pharmacy has not set a delivery fee yet, so earnings show ₹0. Ask your admin to set it on the Delivery page.</p>'}
      </section>`;
  }
  function renderProfile() {
    return `${header('Profile', 'Your delivery account.', true)}
      <section class="pos-card dl-profile">
        <div class="dl-prof-top"><span class="dl-av xl" style="--c:#12a01b">${esc(initials(profile.full_name))}</span><div><h2>${esc(profile.full_name || 'Delivery person')}</h2><p>Delivery Boy · ${esc(branch?.name || '')}</p></div></div>
        <div class="delivery-detail-grid dl-detail-grid">
          <div><small>Delivery ID</small><b>${esc(profile.staff_id || '—')}</b></div>
          <div><small>Phone</small><b>${esc(profile.phone || '—')}</b></div>
          <div><small>Status</small><b>${PRES[presence][0]}</b></div>
          <div><small>Deliveries completed</small><b>${jobs.filter(j => j.status === 'done').length}</b></div>
        </div>
        <div class="dl-contact"><a class="pos-btn" href="change-password.html">${I.key}<span>Change password</span></a><button type="button" class="pos-btn pos-btn-red" id="logoutBtn2">${I.logout}<span>Sign out</span></button></div>
      </section>`;
  }
  function renderHelp() {
    const ph = branch?.phone || '';
    return `${header('Help & Support', 'Contact the pharmacy or read how deliveries work.', false)}
      <section class="pos-card dl-help">
        <h2>${I.help}Contact the pharmacy</h2>
        <p><b>${esc(branch?.name || 'Pallikkal Pharmacy')}</b>${branch?.address ? `<br>${esc([branch.address, branch.city].filter(Boolean).join(', '))}` : ''}</p>
        <div class="dl-contact">${ph ? `<a class="pos-btn pos-btn-solid" href="tel:${esc(ph)}">${I.phone}<span>Call ${esc(ph)}</span></a><a class="pos-btn" target="_blank" rel="noopener" href="https://wa.me/${phoneDigits(ph)}">${I.chat}<span>WhatsApp</span></a>` : '<span class="dl-muted">The pharmacy phone number is not set yet.</span>'}</div>
        <h2>${I.list}How deliveries work</h2>
        <ol class="dl-howto">
          <li>Set yourself <b>Online</b> when you can take orders, <b>Purchasing</b> while you are out buying stock, and <b>Offline</b> when you finish.</li>
          <li>New orders assigned to you appear under My Deliveries as <b>Pending</b>.</li>
          <li>Press <b>▶ Start</b> when you leave the shop — the order becomes <b>Out for Delivery</b>.</li>
          <li>Use the <b>map pin</b> to navigate and the <b>phone</b> to call the customer.</li>
          <li>Press <b>✓</b> when the customer receives it. If you cannot deliver, use <b>Report Issue</b> and choose “Return the order”.</li>
        </ol>
      </section>`;
  }

  const VIEWS = { dashboard: renderDashboard, deliveries: renderDeliveries, completed: renderCompleted, earnings: renderEarnings, profile: renderProfile, help: renderHelp };
  function render() {
    $('riderRoot').innerHTML = (VIEWS[view] || renderDashboard)();
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle(a.closest('.pp-bottom-nav') ? 'active' : 'active', a.dataset.nav === view));
    wireView();
  }
  function wireView() {
    const root = $('riderRoot');
    $('presSel')?.addEventListener('change', e => setPresence(e.target.value));
    $('presToggle')?.addEventListener('click', () => setPresence(presence === 'offline' ? 'available' : 'offline'));
    $('dateSel')?.addEventListener('change', e => { dateSel = e.target.value; page = 1; render(); });
    $('clearQ')?.addEventListener('click', () => { query = ''; $('riderSearch').value = ''; render(); });
    $('logoutBtn2')?.addEventListener('click', logout);
    root.querySelector('#tabs')?.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; page = 1; render(); } });
    root.querySelector('#pager')?.addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page = Number(b.dataset.page); render(); } });
    root.querySelector('#riderJobs')?.addEventListener('click', e => {
      const go = e.target.closest('[data-go]');
      if (go) { e.stopPropagation(); return confirmStatus(go.dataset.go, go.dataset.next); }
      if (e.target.closest('a')) return;
      const tr = e.target.closest('tr[data-job]');
      if (tr) showJob(tr.dataset.job);
    });
    root.querySelector('.dl-qa')?.addEventListener('click', e => {
      const b = e.target.closest('[data-qa]'); if (!b) return;
      const n = nextJob();
      if (b.dataset.qa === 'issue') return showIssue(n?.id);
      if (!n) return toast('You have no pending or out-for-delivery orders right now.', true);
      if (b.dataset.qa === 'nav') { if (!n.customer?.address) return toast(`${n.invoice_no} has no address. Call the customer.`, true); window.open(mapsDir(n.customer.address), '_blank', 'noopener'); }
      else if (b.dataset.qa === 'call') { if (!n.customer?.phone) return toast(`${n.invoice_no} has no phone number.`, true); location.href = `tel:${n.customer.phone}`; }
      else if (b.dataset.qa === 'status') showJob(n.id);
    });
  }

  // ---------------------------------------------------------------- dialogs
  const dlg = html => { $('rdBody').innerHTML = html; if (!$('rdDialog').open) $('rdDialog').showModal(); };
  const closeDlg = () => $('rdDialog').close();
  $('rdDialog').addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === $('rdDialog')) closeDlg(); });

  function showJob(id) {
    const j = jobs.find(x => x.id === id); if (!j) return;
    const c = j.customer || {};
    const steps = [['Assigned', j.assigned_at], ['Out for delivery', j.out_at], ['Delivered', j.delivered_at], [`Failed / returned${j.failure_reason ? ` — ${j.failure_reason}` : ''}`, j.failed_at]].filter(([, t]) => t);
    dlg(`<h3>Order ${esc(j.invoice_no)} ${chip(j.status)}</h3>
      <div class="delivery-detail-grid dl-detail-grid">
        <div><small>Customer</small><b>${esc(c.name || 'Customer')}</b></div>
        <div><small>Amount</small><b>${money(j.total)}</b></div>
        <div class="wide"><small>Address</small><b>${esc(c.address || 'No address recorded')}</b></div>
        <div><small>Phone</small><b>${esc(c.phone || '—')}</b></div>
        <div><small>Bill date</small><b>${esc(when(j.created_at))}</b></div>
        ${j.note ? `<div class="wide dl-note"><small>Note from the pharmacy</small><b>${esc(j.note)}</b></div>` : ''}
        ${j.issue_note ? `<div class="wide dl-issue"><small>Issue you reported ${esc(when(j.issue_at))}</small><b>${esc(j.issue_note)}</b></div>` : ''}
      </div>
      <ol class="dl-timeline">${steps.map(([l, t]) => `<li><b>${esc(l)}</b><small>${esc(when(t))}</small></li>`).join('')}</ol>
      <div class="dl-contact">
        ${c.address ? `<a class="pos-btn pos-btn-sm" href="${esc(mapsDir(c.address))}" target="_blank" rel="noopener">${I.nav}<span>Navigate</span></a><a class="pos-btn pos-btn-sm" href="${esc(mapsSearch(c.address))}" target="_blank" rel="noopener">${I.pinO}<span>Show on map</span></a>` : ''}
        ${c.phone ? `<a class="pos-btn pos-btn-sm" href="tel:${esc(c.phone)}">${I.phone}<span>Call</span></a><a class="pos-btn pos-btn-sm" target="_blank" rel="noopener" href="https://wa.me/${phoneDigits(c.phone)}">${I.chat}<span>WhatsApp</span></a>` : ''}
      </div>
      <p class="pos-form-msg" id="jobMsg" role="alert"></p>
      <div class="pos-dialog-foot dl-foot">
        ${active(j) ? `<button type="button" class="pos-btn pos-btn-red" data-issue="${esc(j.id)}">${I.file}<span>Report issue / return</span></button>` : ''}
        ${j.status === 'pending' ? `<button type="button" class="pos-btn pos-btn-solid" data-set="out" data-id="${esc(j.id)}">${I.play}<span>Start delivery</span></button>` : ''}
        ${j.status === 'out' ? `<button type="button" class="pos-btn pos-btn-solid" data-set="done" data-id="${esc(j.id)}">${I.tick}<span>Mark delivered</span></button>` : ''}
      </div>`);
  }

  async function updateStatus(id, next, note = null, msgEl = null) {
    const { error } = await sb.rpc('delivery_update_status_v2', { p_invoice_id: id, p_status: next, p_note: note });
    let err = error;
    if (err && /delivery_update_status_v2|schema cache|function/i.test(err.message || '') && next !== 'failed') {
      err = (await sb.rpc('delivery_update_status', { p_invoice_id: id, p_status: next })).error;   // before migration 0022
    }
    if (err) { if (msgEl) msgEl.textContent = friendly(err); else toast(`Could not update status: ${friendly(err)}`, true); return false; }
    const j = jobs.find(x => x.id === id);
    toast(`${j?.invoice_no || 'Order'}: ${S[next][0]}.`);
    await load(true);
    return true;
  }
  function confirmStatus(id, next) {
    const j = jobs.find(x => x.id === id); if (!j) return;
    dlg(`<h3>${next === 'out' ? 'Start this delivery?' : 'Mark as delivered?'}</h3>
      <p>${esc(j.invoice_no)} · ${esc(j.customer?.name || '')} · <b>${money(j.total)}</b></p>
      <p class="dl-muted">${next === 'out' ? 'The order changes to Out for Delivery and the pharmacy can see you are on the way.' : 'Confirm that the customer has received the medicines.'}</p>
      <p class="pos-form-msg" id="jobMsg" role="alert"></p>
      <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" data-set="${next}" data-id="${esc(id)}">${next === 'out' ? 'Start delivery' : 'Yes, delivered'}</button></div>`);
  }
  const ISSUES = ['Customer not reachable on phone', 'Wrong or incomplete address', 'Customer refused the order', 'Customer asked to deliver later', 'Payment / collection problem', 'Vehicle or traffic problem'];
  function showIssue(id) {
    const open = jobs.filter(active);
    if (!open.length) return toast('You have no active orders to report an issue for.', true);
    dlg(`<h3>Report an issue</h3>
      <div class="pos-field"><label for="isOrder">Order</label><select id="isOrder">${open.map(j => `<option value="${esc(j.id)}" ${j.id === id ? 'selected' : ''}>${esc(j.invoice_no)} · ${esc(j.customer?.name || '')} · ${S[j.status][0]}</option>`).join('')}</select></div>
      <div class="pos-field"><label for="isType">What happened?</label><select id="isType">${ISSUES.map(x => `<option>${esc(x)}</option>`).join('')}<option value="">Other (describe below)</option></select></div>
      <div class="pos-field"><label for="isNote">Details</label><textarea id="isNote" rows="3" maxlength="400" placeholder="Anything the pharmacy should know"></textarea></div>
      <label class="dl-check"><input type="checkbox" id="isFail"> Return the order — I cannot deliver it (marks it Failed / Returned)</label>
      <p class="pos-form-msg" id="isMsg" role="alert"></p>
      <div class="pos-dialog-foot"><button type="button" class="pos-btn" data-close>Cancel</button><button type="button" class="pos-btn pos-btn-solid" id="isSend">Send report</button></div>`);
    $('isSend').onclick = async () => {
      const text = [$('isType').value, $('isNote').value.trim()].filter(Boolean).join(' — ');
      if (!text) return ($('isMsg').textContent = 'Choose what happened or describe the issue.');
      $('isSend').disabled = true;
      const { error } = await sb.rpc('delivery_report_issue', { p_invoice_id: $('isOrder').value, p_issue: text, p_mark_failed: $('isFail').checked });
      $('isSend').disabled = false;
      if (error) return ($('isMsg').textContent = friendly(error));
      closeDlg();
      toast($('isFail')?.checked ? 'Order returned — the pharmacy has been notified.' : 'Issue reported to the pharmacy.');
      await load(true);
    };
  }
  $('rdBody').addEventListener('click', async e => {
    const set = e.target.closest('[data-set]');
    if (set) {
      set.disabled = true;
      const okay = await updateStatus(set.dataset.id, set.dataset.set, null, $('jobMsg'));
      if (okay) closeDlg(); else set.disabled = false;
      return;
    }
    const is = e.target.closest('[data-issue]');
    if (is) showIssue(is.dataset.issue);
  });

  // ---------------------------------------------------------------- data
  async function load(quiet = false) {
    let { data, error } = await sb.rpc('delivery_my_jobs_v2');
    if (error) {
      const old = await sb.rpc('delivery_my_jobs');   // before migration 0022
      if (old.error) { if (!quiet) toast(`Unable to load deliveries: ${friendly(error)}`, true); return; }
      data = { jobs: old.data || [], fee_per_delivery: 0 };
      const pres = await sb.rpc('delivery_presence_my_status');
      if (!pres.error) data.presence = pres.data;
    }
    jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    fee = Number(data?.fee_per_delivery || 0);
    branch = data?.branch || branch;
    if (data?.presence) presence = data.presence;
    // New assignment alert
    const ids = new Set(jobs.filter(j => j.status === 'pending').map(j => j.id));
    if (seenIds) { const fresh = [...ids].filter(x => !seenIds.has(x)).length; if (fresh) toast(`${fresh} new order(s) assigned to you.`); }
    seenIds = ids;
    const pending = jobs.filter(j => j.status === 'pending');
    const notes = [];
    if (pending.length) notes.push({ tone: 'warn', title: `${pending.length} order(s) waiting to start`, detail: pending.slice(0, 3).map(j => j.invoice_no).join(', '), href: '#deliveries' });
    const notes2 = jobs.filter(j => j.note && active(j));
    if (notes2.length) notes.push({ tone: 'info', title: `${notes2.length} order(s) have a note from the pharmacy`, detail: 'Open the order to read it', href: '#deliveries' });
    if (presence === 'offline') notes.push({ tone: 'info', title: 'You are Offline', detail: 'Go Online to show the pharmacy you can deliver', href: '#dashboard' });
    setNotifications(notes);
    render();
  }

  async function logout(e) {
    e?.preventDefault?.();
    toast('Signing out…');
    await sb.rpc('delivery_set_presence', { p_status: 'offline' });
    await sb.rpc('end_work_session', { p_reason: 'manual' });
    clearDailyLogin();
    await sb.auth.signOut();
    location.replace('delivery-boy-login.html');
  }
  $('riderLogout').addEventListener('click', logout);
  $('logoutNav').addEventListener('click', logout);

  // routing + search
  function route() {
    const h = location.hash.replace('#', '') || 'dashboard';
    view = VIEWS[h] ? h : 'dashboard';
    tab = 'all';
    page = 1;
    document.getElementById('ppSidebar').classList.remove('open');
    $('ppScrim').hidden = true;
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  let qt;
  $('riderSearch').addEventListener('input', e => {
    clearTimeout(qt);
    qt = setTimeout(() => {
      query = e.target.value.trim();
      if (query && !['dashboard', 'deliveries', 'completed'].includes(view)) { location.hash = '#deliveries'; return; }
      if (query) { dateSel = 'all'; tab = 'all'; }
      page = 1;
      render();
    }, 200);
  });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('riderSearch').focus(); } });

  const h = location.hash.replace('#', '');
  view = VIEWS[h] ? h : 'dashboard';
  await load();
  setInterval(() => { if (document.visibilityState === 'visible' && !$('rdDialog').open) load(true); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(true); });
}
