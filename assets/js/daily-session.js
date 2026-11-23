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
    const nice = new Date(`${today}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
    overlay.innerHTML = `
      <style>
        #alza-opening-overlay{position:fixed;inset:0;z-index:99999;background:rgba(2,24,56,.62);backdrop-filter:blur(6px);display:grid;place-items:center;padding:18px;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif}
        #alza-opening-overlay .op-card{position:relative;width:min(100%,430px);background:#fff;color:#0d1b4b;border-radius:20px;box-shadow:0 30px 80px rgba(2,20,46,.4);overflow:hidden;animation:opIn .25s ease-out}
        @keyframes opIn{from{transform:translateY(14px);opacity:0}}
        #alza-opening-overlay .op-top{background:linear-gradient(120deg,#02224d 0,#0b3a73 70%,#0f4f8a);color:#fff;padding:22px 24px 26px;position:relative}
        #alza-opening-overlay .op-top::after{content:'';position:absolute;right:-50px;top:-50px;width:170px;height:170px;border-radius:50%;background:radial-gradient(circle,rgba(46,229,47,.28),transparent 70%)}
        #alza-opening-overlay .op-logo{height:34px;width:auto;display:block;margin-bottom:16px}
        #alza-opening-overlay .op-ic{width:48px;height:48px;border-radius:14px;background:#12a01b;display:grid;place-items:center;margin-bottom:12px;box-shadow:0 8px 20px rgba(18,160,27,.35)}
        #alza-opening-overlay .op-ic svg{width:26px;height:26px}
        #alza-opening-overlay h2{margin:0 0 4px;font:800 1.35rem Montserrat,Inter,sans-serif}
        #alza-opening-overlay .op-date{display:inline-flex;align-items:center;gap:6px;margin-top:8px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);padding:4px 12px;border-radius:999px;font-size:.84rem;font-weight:600}
        #alza-opening-overlay .op-top p{margin:0;color:#cfdcef;font-size:.9rem;line-height:1.45}
        #alza-opening-overlay form{padding:22px 24px 24px}
        #alza-opening-overlay label{display:block;font-weight:700;font-size:.9rem;margin:0 0 8px;color:#02224d}
        #alza-opening-overlay .op-amt{display:flex;align-items:center;border:2px solid #cfd9e6;border-radius:12px;background:#f7f9fc;transition:border-color .15s,box-shadow .15s}
        #alza-opening-overlay .op-amt:focus-within{border-color:#12a01b;box-shadow:0 0 0 4px rgba(18,160,27,.15);background:#fff}
        #alza-opening-overlay .op-amt span{padding:0 6px 0 16px;font:800 1.5rem Montserrat,Inter,sans-serif;color:#12a01b}
        #alza-opening-overlay .op-amt input{flex:1;min-width:0;border:0;background:transparent;padding:14px 14px 14px 4px;font:700 1.5rem Inter,sans-serif;color:#0d1b4b;outline:0}
        #alza-opening-overlay .op-hint{display:flex;gap:8px;margin:12px 0 0;padding:10px 12px;border-radius:10px;background:#e8f6ea;color:#0b5d12;font-size:.82rem;line-height:1.4}
        #alza-opening-overlay .op-hint svg{width:16px;height:16px;flex:none;margin-top:1px}
        #alza-opening-overlay .error{min-height:1.2em;color:#c92a2a;font-size:.85rem;font-weight:600;margin-top:10px}
        #alza-opening-overlay button{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;margin-top:8px;min-height:50px;border:0;border-radius:12px;background:#12a01b;color:#fff;font:700 1rem Inter,sans-serif;cursor:pointer;box-shadow:0 10px 22px rgba(18,160,27,.28)}
        #alza-opening-overlay button:hover{background:#0c7d15}#alza-opening-overlay button:disabled{opacity:.7;cursor:wait}
        #alza-opening-overlay button svg{width:20px;height:20px}
      </style>
      <div class="op-card" role="dialog" aria-modal="true" aria-labelledby="opTitle">
        <div class="op-top">
          <img class="op-logo" src="assets/images/brand/logo-horizontal.png" alt="Pallikkal Pharmacy" onerror="this.remove()">
          <div class="op-ic"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></div>
          <h2 id="opTitle">Today's Opening Balance</h2>
          <p>Count the cash in the drawer and enter it to start the day.</p>
          <span class="op-date">${nice}</span>
        </div>
        <form novalidate>
          <input id="alza-opening-date" type="hidden" value="${today.split('-').reverse().join('-')}">
          <label for="alza-opening-amount">Cash in drawer</label>
          <div class="op-amt"><span>₹</span><input id="alza-opening-amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required autocomplete="off"></div>
          <p class="op-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><span>Only the first person to sign in today enters this. Everyone else goes straight in. It appears in Finance → Daily Opening Balance.</span></p>
          <div class="error" role="alert"></div>
          <button type="submit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg><span>Save &amp; Continue</span></button>
        </form>
      </div>`;
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
      submit.querySelector('span').textContent = 'Saving…';
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
            submit.querySelector('span').textContent = 'Save & Continue';
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
        submit.querySelector('span').textContent = 'Save & Continue';
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
