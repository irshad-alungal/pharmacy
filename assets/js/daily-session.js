// ALZA daily sign-in and opening-balance helpers (frontend preview).
const STORAGE_KEY = 'alza_daily_login_v1';
const OPENING_KEY = 'alza_opening_balance_v1';

export function istDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function markDailyLogin(userId) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, date: istDateKey() }));
}

export function clearDailyLogin() {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasDailyLogin(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return !!saved && saved.userId === userId && saved.date === istDateKey();
  } catch { return false; }
}

export async function requireOpeningBalance(userId) {
  const today = istDateKey();
  const key = `${userId}:${today}`;
  try {
    const saved = JSON.parse(localStorage.getItem(OPENING_KEY) || 'null');
    if (saved?.key === key && Number.isFinite(Number(saved.amount))) return saved;
  } catch { /* show the required dialog */ }

  return await new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = 'alza-opening-overlay';
    overlay.innerHTML = `
      <style>
        #alza-opening-overlay{position:fixed;inset:0;z-index:99999;background:#071b18cc;display:grid;place-items:center;padding:18px;font-family:system-ui,sans-serif}
        #alza-opening-overlay .opening-card{width:min(100%,390px);background:#fff;color:#14231f;border-radius:16px;padding:24px;box-shadow:0 20px 70px #0005}
        #alza-opening-overlay h2{margin:0 0 7px;font-size:1.3rem}#alza-opening-overlay p{margin:0 0 18px;color:#60716d;font-size:.92rem}
        #alza-opening-overlay label{display:block;font-weight:650;margin:13px 0 6px}#alza-opening-overlay input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #cbd5d1;border-radius:9px;font:inherit;background:#f7faf9;color:#14231f}
        #alza-opening-overlay button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:9px;background:#0f766e;color:#fff;font-weight:700;font:inherit;cursor:pointer}
        #alza-opening-overlay .error{min-height:1.2em;color:#b91c1c;font-size:.85rem;margin-top:8px}
      </style>
      <form class="opening-card">
        <h2>Opening Balance</h2><p>Enter the cash opening balance for today's shift.</p>
        <label for="alza-opening-date">Date (IST)</label>
        <input id="alza-opening-date" type="text" value="${today.split('-').reverse().join('-')}" readonly aria-readonly="true">
        <label for="alza-opening-amount">Opening balance (₹)</label>
        <input id="alza-opening-amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Enter amount" required>
        <div class="error" role="alert"></div>
        <button type="submit">Submit</button>
      </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const amount = overlay.querySelector('#alza-opening-amount');
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = Number(amount.value);
      const error = overlay.querySelector('.error');
      if (!amount.value.trim() || !Number.isFinite(value) || value < 0) {
        error.textContent = 'Enter a valid opening balance.';
        return;
      }
      const record = { key, userId, date: today, amount: Math.round(value * 100) / 100, savedAt: new Date().toISOString() };
      localStorage.setItem(OPENING_KEY, JSON.stringify(record));
      overlay.remove();
      resolve(record);
    });
    amount.focus();
  });
}
