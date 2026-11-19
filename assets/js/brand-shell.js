// Pallikkal Pharmacy branded application shell (navy sidebar, top bar,
// mobile header + bottom navigation). Used by pages that opt in with
// mountShell(page, title, { layout: 'brand' }).
import { esc } from './supabase-client.js';

// Lucide-style 24px stroke icons.
const P = {
  dashboard: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2.7l2.6 12.2a1.6 1.6 0 0 0 1.6 1.3h8.7a1.6 1.6 0 0 0 1.5-1.2L21.5 7H6.1"/>',
  pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  bag: '<path d="M6 7h12l1 13H5L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  truck: '<path d="M2 6h11v10H2z"/><path d="M13 9h4.5l3.5 3.5V16h-8"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  scooter: '<circle cx="5.5" cy="17.5" r="2.5"/><circle cx="18.5" cy="17.5" r="2.5"/><path d="M8 17.5h7.5l2-6.5h-4"/><path d="M15 6h3l-1 5"/><path d="M5.5 15 8 10h5"/>',
  finance: '<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/><path d="M4 11.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/>',
  reports: '<path d="M4 20V10"/><path d="M9.3 20V4"/><path d="M14.6 20v-7"/><path d="M20 20V8"/><path d="M2 21h20"/>',
  staff: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4 3.8-6.5 7.5-6.5s6.7 2.5 7.5 6.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2Z"/><path d="M9 8h6M9 12h6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7l12-4 2 4"/><circle cx="16.5" cy="13.5" r="1.2"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5.1A8.5 8.5 0 1 1 21 11.5Z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  more: '<circle cx="7" cy="7" r="2.6"/><circle cx="17" cy="7" r="2.6"/><circle cx="7" cy="17" r="2.6"/><circle cx="17" cy="17" r="2.6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7"/><path d="m17 6 3 3"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4 3.8-6.5 7.5-6.5s6.7 2.5 7.5 6.5"/>'
};
export const icon = (name, cls = '') =>
  `<svg class="pp-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

// Primary order follows the approved dashboard design; the remaining pages
// are listed after it so nothing becomes unreachable.
const NAV = [
  ['dashboard', 'Dashboard', 'dashboard'],
  ['sales', 'Sales', 'cart'],
  ['medicines', 'Medicines', 'pill'],
  ['inventory', 'Inventory', 'box'],
  ['purchases', 'Purchases', 'bag'],
  ['customers', 'Customers', 'users'],
  ['distributors', 'Distributors', 'truck'],
  ['delivery', 'Delivery', 'scooter'],
  ['finance', 'Finance', 'finance'],
  ['reports', 'Reports', 'reports'],
  ['staff', 'Staff', 'staff'],
  ['settings', 'Settings', 'settings'],
  ['billing', 'Billing', 'receipt'],
  ['returns', 'Returns', 'undo'],
  ['expenses', 'Expenses', 'wallet'],
  ['whatsapp', 'WhatsApp', 'chat'],
  ['documents', 'Documents', 'file'],
  ['audit-logs', 'Audit logs', 'shield']
];
const BOTTOM = [['dashboard', 'Dashboard', 'dashboard'], ['sales', 'Sales', 'cart'], ['medicines', 'Medicines', 'pill'], ['inventory', 'Inventory', 'box']];
// Staff without the dashboard get Billing as their first bottom-bar item.
const NAV_BY_PAGE = Object.fromEntries(NAV.map(n => [n[0], n]));
const bottomItems = (canAccess, page) => {
  let items = canAccess('dashboard') ? BOTTOM : [['billing', 'Billing', 'receipt'], ...BOTTOM.slice(1)];
  // Keep the current page reachable in one tap (e.g. Dashboard · Sales · Billing · Delivery).
  if (page && !items.some(([p]) => p === page) && NAV_BY_PAGE[page]) {
    items = [items[0], items[1], page === 'billing' ? items[2] : ['billing', 'Billing', 'receipt'], NAV_BY_PAGE[page]];
  }
  return items.filter(([p], i, arr) => canAccess(p) && arr.findIndex(x => x[0] === p) === i);
};

const ROLE_NAMES = { super_admin: 'Super Admin', admin: 'Admin', pharmacist: 'Pharmacist', billing_staff: 'Billing Staff', inventory_staff: 'Inventory Staff' };
export const roleName = r => ROLE_NAMES[r] || String(r || '').replace(/_/g, ' ');
export const displayName = prof => {
  const n = String(prof.full_name || '').trim();
  return n || roleName(prof.role) || prof.staff_id;
};

export function brandShellMarkup(page, prof, canAccess) {
  const items = NAV.filter(([p]) => canAccess(p));
  const primary = items.slice(0, 12), extra = items.slice(12);
  const link = ([p, l, ic]) => `<a href="${p}.html" class="pp-nav-link${p === page ? ' active' : ''}"${p === page ? ' aria-current="page"' : ''}>${icon(ic)}<span>${esc(l)}</span></a>`;
  const name = displayName(prof);
  const home = canAccess('dashboard') ? 'dashboard.html' : canAccess('billing') ? 'billing.html' : `${items[0]?.[0] || 'dashboard'}.html`;
  return `
  <div class="pp-app">
    <aside class="pp-sidebar" id="ppSidebar" aria-label="Main navigation">
      <div class="pp-brand"><a href="${home}" aria-label="Pallikkal Pharmacy home"><img src="assets/images/brand/logo-horizontal.png" alt="Pallikkal Pharmacy" width="220" height="54"></a>
        <button class="pp-icon-btn pp-close-nav" type="button" id="ppCloseNav" aria-label="Close menu">${icon('close')}</button></div>
      <nav class="pp-nav">${primary.map(link).join('')}
        ${extra.length ? `<div class="pp-nav-sep">More</div>${extra.map(link).join('')}` : ''}</nav>
    </aside>
    <div class="pp-scrim" id="ppScrim" hidden></div>
    <div class="pp-body">
      <header class="pp-topbar">
        <button class="pp-icon-btn pp-burger" type="button" id="ppBurger" aria-label="Open menu">${icon('menu')}</button>
        <a class="pp-mobile-logo" href="${home}"><img src="assets/images/brand/logo-horizontal.png" alt="Pallikkal Pharmacy" width="150" height="37"></a>
        <div class="pp-search-wrap" id="ppSearchSlot"></div>
        <div class="pp-top-actions">
          <div class="pp-pop-anchor">
            <button class="pp-icon-btn pp-bell" type="button" id="ppBell" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">${icon('bell')}<span class="pp-dot" id="ppBellDot" hidden></span></button>
            <div class="pp-popover pp-notify" id="ppNotify" hidden><div class="pp-pop-head">Notifications</div><div id="ppNotifyList"><p class="pp-pop-empty">Checking…</p></div></div>
          </div>
          <span class="pp-divider"></span>
          <div class="pp-pop-anchor">
            <button class="pp-user" type="button" id="ppUser" aria-haspopup="true" aria-expanded="false">
              <span class="pp-avatar">${icon('user')}</span><span class="pp-user-name">${esc(name)}</span>${icon('chevron', 'pp-chev')}
            </button>
            <div class="pp-popover pp-user-menu" id="ppUserMenu" hidden>
              <div class="pp-pop-user"><strong>${esc(name)}</strong><small>${esc(roleName(prof.role))} · ${esc(prof.staff_id || '')}</small></div>
              ${canAccess('settings') ? `<a href="settings.html">${icon('settings')}Settings</a>` : ''}
              <a href="change-password.html">${icon('key')}Change password</a>
              <a href="#" id="so">${icon('logout')}Sign out</a>
            </div>
          </div>
        </div>
      </header>
      <main class="pp-main" id="view"></main>
    </div>
    <nav class="pp-bottom-nav" aria-label="Quick navigation">
      ${bottomItems(canAccess, page).map(([p, l, ic]) => `<a href="${p}.html" class="${p === page ? 'active' : ''}">${icon(ic)}<span>${l}</span></a>`).join('')}
      <button type="button" id="ppMore">${icon('more')}<span>More</span></button>
    </nav>
  </div>`;
}

export function wireBrandShell() {
  const $ = id => document.getElementById(id);
  const side = $('ppSidebar'), scrim = $('ppScrim');
  const openNav = () => { side.classList.add('open'); scrim.hidden = false; };
  const closeNav = () => { side.classList.remove('open'); scrim.hidden = true; };
  $('ppBurger').onclick = openNav;
  $('ppMore').onclick = openNav;
  $('ppCloseNav').onclick = closeNav;
  scrim.onclick = closeNav;

  const pops = [['ppBell', 'ppNotify'], ['ppUser', 'ppUserMenu']];
  const closePops = except => pops.forEach(([b, p]) => { if (p !== except) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); } });
  for (const [b, p] of pops) {
    $(b).onclick = e => {
      e.stopPropagation();
      const open = $(p).hidden;
      closePops(p);
      $(p).hidden = !open;
      $(b).setAttribute('aria-expanded', String(open));
    };
    $(p).onclick = e => e.stopPropagation();
  }
  document.addEventListener('click', () => closePops());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePops(); closeNav(); } });
}

// Fill the notification popover. items: [{ tone, title, detail, href }]
export function setNotifications(items) {
  const list = document.getElementById('ppNotifyList');
  if (!list) return;
  document.getElementById('ppBellDot').hidden = !items.length;
  list.innerHTML = items.length
    ? items.map(n => `<a class="pp-note pp-note-${esc(n.tone || 'info')}" href="${esc(n.href || '#')}"><span class="pp-note-dot"></span><span><strong>${esc(n.title)}</strong><small>${esc(n.detail || '')}</small></span></a>`).join('')
    : '<p class="pp-pop-empty">You’re all caught up.</p>';
}
