
import { requireProfile, esc, sb } from './supabase-client.js';
import { can } from './permissions.js';
import { signOut } from './auth.js';
import { hasDailyLogin, clearDailyLogin } from './daily-session.js';

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

export async function mountShell(page, title) {
  const prof = await requireProfile();

  if (!prof) {
    throw new Error('no session');
  }

  // A persisted Supabase auth token must not carry yesterday's login into a
  // new IST day. Require a fresh credential login once per day.
  const dailyUserId = prof.user_id || prof.id;
  if (!hasDailyLogin(dailyUserId)) {
    try { await sb.rpc('end_work_session', { p_reason: 'manual' }); } catch (_) {}
    clearDailyLogin();
    await sb.auth.signOut();
    const loginPage = ['super_admin', 'admin'].includes(prof.role)
      ? 'admin-login.html' : 'staff-login.html';
    location.replace(loginPage);
    throw new Error('daily login required');
  }

  const links = PAGES
    .filter(([p]) => can(prof.role, p))
    .map(([p, l]) =>
      `<a href="${p}.html" class="${p === page ? 'on' : ''}">${l}</a>`
    )
    .join('');

  document.title = `PALLIKKAL PHARMACY — ${title}`;

  document.body.innerHTML = `
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
    location.replace(loginPage);
    throw new Error('work session unavailable; fresh login required');
  }

  // Work-session heartbeat:
  // Refresh only when the user has recently interacted with the page.
  let lastInteraction = Date.now();
  let lastTouch = 0;
  let touching = false;
  let dailyLogoutInProgress = false;

  const forceLogin = async reason => {
    if (dailyLogoutInProgress) return;
    dailyLogoutInProgress = true;
    clearDailyLogin();
    try { await sb.rpc('end_work_session', { p_reason: 'manual' }); } catch (_) {}
    await sb.auth.signOut();
    const loginPage = ['super_admin', 'admin'].includes(prof.role)
      ? 'admin-login.html' : 'staff-login.html';
    location.replace(loginPage);
  };

  const recordActivity = () => {
    lastInteraction = Date.now();
  };

  [
    'pointerdown',
    'keydown',
    'touchstart',
    'click'
  ].forEach(eventName => {
    document.addEventListener(eventName, recordActivity, {
      passive: true
    });
  });

  const heartbeat = async () => {
    if (!hasDailyLogin(dailyUserId)) {
      await forceLogin('new_day');
      return;
    }
    if (document.visibilityState !== 'visible') return;

    const now = Date.now();

    // Do not keep an unattended session alive.
    if (now - lastInteraction > 5 * 60 * 1000) return;

    // Avoid frequent RPC calls.
    if (now - lastTouch < 60 * 1000) return;

    if (touching) return;

    touching = true;
    lastTouch = now;

    try {
      const { data, error } = await sb.rpc('touch_work_session');

console.log('WORK SESSION HEARTBEAT:', {
  data,
  error,
  time: new Date().toISOString()
});

if (error) {
  console.error('Work-session heartbeat failed:', error);
} else if (data === false) {
  console.warn('Work session is not active; requesting a fresh login.');
  await forceLogin('session_expired');
}
    } catch (error) {
      console.error('Work-session heartbeat error:', error);
    } finally {
      touching = false;
    }
  };

  // Start the first heartbeat after 5 seconds.
setTimeout(heartbeat, 5000);

// Repeat every 60 seconds.
setInterval(heartbeat, 60 * 1000);

  return prof;
}
