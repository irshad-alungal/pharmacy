
import { requireProfile, esc, sb } from './supabase-client.js';
import { can } from './permissions.js';
import { signOut } from './auth.js';

const PAGES = [
  ['dashboard', 'Dashboard'],
  ['billing', 'Billing'],
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

  const links = PAGES
    .filter(([p]) => can(prof.role, p))
    .map(([p, l]) =>
      `<a href="${p}.html" class="${p === page ? 'on' : ''}">${l}</a>`
    )
    .join('');

  document.title = `ALZA PHARMACY — ${title}`;

  document.body.innerHTML = `
    <div class="shell">
      <nav class="side">
        <h1>ALZA PHARMACY</h1>
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
  // If it has expired, start a new authenticated work session before any
  // protected RPC (including Initial Stock) is called.
  let workSessionActive = false;
  try {
    const { data: touchResult, error: touchError } = await sb.rpc('touch_work_session');
    workSessionActive = !touchError && touchResult === true;
  } catch (error) {
    console.warn('Could not check the current work session:', error);
  }

  if (!workSessionActive) {
    const { data: startResult, error: startError } = await sb.rpc('start_work_session');
    if (startError || startResult !== true) {
      const view = document.getElementById('view');
      if (view) {
        view.innerHTML = `<div class="notice">Your pharmacy work session is not active and could not be restarted. Please sign out and sign in again. ${esc(startError?.message || 'Work session could not be started.')}</div>`;
      }
      console.error('Could not start a work session:', startError);
      throw new Error('work session unavailable');
    }
  }

  // Work-session heartbeat:
  // Refresh only when the user has recently interacted with the page.
  let lastInteraction = Date.now();
  let lastTouch = 0;
  let touching = false;

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
  console.warn('Work session is not active. No automatic logout.');
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
