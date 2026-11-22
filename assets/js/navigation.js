
import { requireProfile, esc, sb } from './supabase-client.js';
import { can } from './permissions.js';
import { signOut } from './auth.js';
import { hasDailyLogin, clearDailyLogin } from './daily-session.js';
import { brandShellMarkup, wireBrandShell } from './brand-shell.js';

const PAGES = [
  ['dashboard', 'Dashboard'],
  ['billing', 'Billing'],
  ['delivery', 'Delivery'],
  ['medicines', 'Medicines'],
  ['inventory', 'Inventory'],
  ['purchases', 'Purchases'],
  ['distributors', 'Distributors'],
  ['customers', 'Customers'],
  ['sales', 'Sales'],
  ['returns', 'Returns'],
  ['expenses', 'Expenses'],
  ['finance', 'Finance'],
  ['reports', 'Reports'],
  ['whatsapp', 'WhatsApp'],
  ['staff', 'Staff'],
  ['documents', 'Documents'],
  ['settings', 'Settings'],
  ['audit-logs', 'Audit logs']
];

// opts.layout === 'brand' renders the Pallikkal Pharmacy branded shell (used by the dashboard).
export async function mountShell(page, title, opts = {}) {
  const prof = await requireProfile();

  if (!prof) {
    throw new Error('no session');
  }

  // A persisted Supabase auth token must not carry yesterday's login into a
  // new IST day. Require a fresh credential login once per day.
  const dailyUserId = prof.user_id || prof.id;
  if (!hasDailyLogin(dailyUserId)) {
    try { await sb.rpc('end_work_session', { p_reason: 'new_day' }); } catch (_) {}
    clearDailyLogin();
    await sb.auth.signOut();
    const loginPage = ['super_admin', 'admin'].includes(prof.role)
      ? 'admin-login.html' : 'staff-login.html';
    location.replace(`${loginPage}?next=${encodeURIComponent((location.pathname.split('/').pop() || '') + location.search)}`);
    throw new Error('daily login required');
  }

  const links = PAGES
    .filter(([p]) => can(prof.role, p))
    .map(([p, l]) =>
      `<a href="${p}.html" class="${p === page ? 'on' : ''}">${l}</a>`
    )
    .join('');

  document.title = `PALLIKKAL PHARMACY — ${title}`;

  if (opts.layout === 'brand') {
    document.body.classList.add('pp-brand-body');
    document.body.innerHTML = brandShellMarkup(page, prof, p => can(prof.role, p));
    wireBrandShell();
  } else document.body.innerHTML = `
    <div class="shell">
      <nav class="side">
        <h1>PALLIKKAL PHARMACY</h1>
        ${links}
        <a href="#" id="so">Sign out (${esc(prof.staff_id)})</a>
      </nav>
      <main class="main">
        <h2>${esc(title)}</h2>
        <div id="view"></div>
      </main>
    </div>
  `;

  document.getElementById('so').onclick = e => {
    e.preventDefault();
    signOut();
  };

  if (!can(prof.role, page)) {
    document.getElementById('view').innerHTML =
      '<p>You do not have access to this page.</p>';

    throw new Error('forbidden');
  }

  // A persisted Supabase login can outlive the pharmacy work session.
  // Check the work session whenever an app page is opened or refreshed.
  // An inactive work session requires a fresh credential login; it is never
  // silently restarted from a protected application page.
  let workSessionActive = false;
  try {
    const { data: touchResult, error: touchError } = await sb.rpc('touch_work_session');
    workSessionActive = !touchError && touchResult === true;
  } catch (error) {
    console.warn('Could not check the current work session:', error);
  }

  if (!workSessionActive) {
    // Do not silently restart an ended/expired work session. A new work
    // session must be established through the login screen. The opening
    // balance remains saved branch-wide and will not be requested twice.
    clearDailyLogin();
    await sb.auth.signOut();
    const loginPage = ['super_admin', 'admin'].includes(prof.role)
      ? 'admin-login.html' : 'staff-login.html';
    location.replace(`${loginPage}?next=${encodeURIComponent((location.pathname.split('/').pop() || '') + location.search)}`);
    throw new Error('work session unavailable; fresh login required');
  }

  // No inactivity auto-logout. The work session is checked when a protected
  // page is opened; the database daily work_date forces a fresh login on the
  // next IST day. Manual sign-out remains available in the navigation.

  return prof;
}
