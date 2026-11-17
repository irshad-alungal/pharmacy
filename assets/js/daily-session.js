// PALLIKKAL PHARMACY daily sign-in and cash opening helpers.
import { sb } from './supabase-client.js';
const STORAGE_KEY = 'alza_daily_login_v1';
const OPENING_KEY = 'alza_opening_balance_v2';

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

  // The opening is branch-wide, not per device or per staff member.
  // Check Supabase first so every staff login sees the same saved amount.
  const { data: existing, error: lookupError } = await sb.rpc('get_daily_cash_opening', {
    p_opening_date: today
  });
  if (lookupError) {
    throw new Error(lookupError.message || 'Could not verify today’s opening cash balance.');
  }
  if (existing) {
    const record = {
      key, userId, date: today, amount: Number(existing.amount),
      serverId: existing.id, savedAt: new Date().toISOString()
    };
    localStorage.setItem(OPENING_KEY, JSON.stringify(record));
    return record;
  }

  // Supabase is the source of truth. Never trust a browser-only cached
  // submission when the branch-wide database record is missing.
  localStorage.removeItem(OPENING_KEY);

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
      const submit = form.querySelector('button[type=submit]');
      submit.disabled = true;
      submit.textContent = 'Saving…';
      error.textContent = '';
      sb.rpc('record_daily_cash_opening', {
        p_opening_date: today,
        p_amount: Math.round(value * 100) / 100
      }).then(async ({ data, error: saveError }) => {
        let savedId = data;
        let savedAmount = Math.round(value * 100) / 100;
        if (saveError) {
          // Another staff/admin may have submitted the branch opening at the
          // same time. If the database now has today's record, accept it.
          const { data: concurrentRecord, error: recheckError } = await sb.rpc('get_daily_cash_opening', {
            p_opening_date: today
          });
          if (recheckError || !concurrentRecord) {
            error.textContent = saveError.message || 'Could not save opening balance. Please try again.';
            submit.disabled = false;
            submit.textContent = 'Submit';
            return;
          }
          savedId = concurrentRecord.id;
          savedAmount = Number(concurrentRecord.amount);
        }
        const record = {
          key, userId, date: today,
          amount: savedAmount,
          serverId: savedId,
          savedAt: new Date().toISOString()
        };
        localStorage.setItem(OPENING_KEY, JSON.stringify(record));
        overlay.remove();
        resolve(record);
      }).catch(saveError => {
        error.textContent = saveError?.message || 'Could not save opening balance. Please try again.';
        submit.disabled = false;
        submit.textContent = 'Submit';
      });
    });
    amount.focus();
  });
}

// Complete the mandatory once-per-day login flow. The opening is branch-wide,
// so the first authorised staff/admin login records it; later logins that day
// reuse the database record and do not prompt again.
export async function completeDailyLogin(userId) {
  const opening = await requireOpeningBalance(userId);
  markDailyLogin(userId);
  return opening;
}
