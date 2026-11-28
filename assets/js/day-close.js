// End of day: "All Bills for Today" (every bill of a day on one 80 mm roll) and the daily closing balance
// (cash counted at closing — one per day, migration 0039). Used on Billing, Sales and Finance.
import { dayBillsHTML, printDoc } from './invoice.js';
import { cachedSettings, fmtDateWith } from './app-settings.js';

const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const R = n => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+n || 0);
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const isAdminRole = r => ['super_admin', 'admin'].includes(String(r || '').toLowerCase());
const nice = err => {
  const m = String(err?.message || err || '');
  if (/invoices_for_day|daily_cash_closing|cash_closing|function .* does not exist|schema cache/i.test(m)) return 'This needs database migration 0039_day_close_print_purchase_no.sql. Ask the admin to run it in Supabase.';
  return m.replace(/^.*?ERROR:\s*/, '');
};
let cssDone = false;
function css() {
  if (cssDone) return; cssDone = true;
  const st = document.createElement('style');
  st.textContent = `.dc-dlg{border:0;border-radius:16px;padding:0;width:min(560px,96vw);box-shadow:0 24px 60px rgba(13,27,75,.25)}
  .dc-dlg::backdrop{background:rgba(13,27,75,.45)}
  .dc-in{padding:18px 20px;font:500 14px/1.45 Inter,system-ui,sans-serif;color:#0d1b4b}
  .dc-in h3{margin:0 0 4px;font-size:1.15rem;display:flex;align-items:center;gap:8px}.dc-in p.dc-sub{margin:0 0 12px;color:#66748a;font-size:.86rem}
  .dc-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px}.dc-row label{display:flex;flex-direction:column;gap:4px;font-size:.8rem;font-weight:600;color:#344054}
  .dc-row input,.dc-row select,.dc-row textarea{min-height:38px;border:1px solid #d0d7e2;border-radius:9px;padding:0 10px;font:inherit}
  .dc-row textarea{padding:8px 10px;min-height:56px;width:100%}
  .dc-btns{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px}
  .dc-btn{min-height:38px;border-radius:9px;border:1px solid #d0d7e2;background:#fff;padding:0 14px;font:600 .9rem Inter,system-ui,sans-serif;color:#0d1b4b;cursor:pointer}
  .dc-btn.solid{background:#12a01b;border-color:#12a01b;color:#fff}.dc-btn:disabled{opacity:.6;cursor:default}
  .dc-pv{max-height:52vh;overflow:auto;background:#f3f5f8;border:1px solid #e3e8ef;border-radius:10px;padding:10px}
  .dc-pv>div{background:#fff;margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,.08)}
  .dc-msg{font-size:.86rem;margin-top:8px}.dc-msg.bad{color:#d92d20}.dc-msg.ok{color:#0b7a14}
  .dc-kv{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}.dc-kv div{background:#f6f8fb;border-radius:10px;padding:8px 10px}
  .dc-kv small{display:block;color:#66748a;font-size:.74rem}.dc-kv b{font-size:1rem}.dc-done{background:#e8f6ea;border:1px solid #b7e2bd;border-radius:10px;padding:10px 12px;margin:8px 0}
  .dc-red{color:#d92d20}.dc-green{color:#0b7a14}`;
  document.head.appendChild(st);
}
function dialog(html) {
  css();
  const d = document.createElement('dialog'); d.className = 'dc-dlg'; d.innerHTML = `<div class="dc-in">${html}</div>`;
  document.body.appendChild(d); d.addEventListener('close', () => d.remove());
  d.addEventListener('click', ev => { if (ev.target.closest('[data-dc-close]')) d.close(); });
  d.showModal(); return d;
}

// ---------------------------------------------------------------- All Bills for Today
export async function openAllBills(sb, prof, { date = todayIST() } = {}) {
  const admin = isAdminRole(prof?.role);
  const d = dialog(`<h3>🧾 All Bills for Today</h3><p class="dc-sub">Every bill of the day on one 80 mm thermal roll — print it when closing the shop.</p>
    <div class="dc-row"><label>Day<input type="date" id="abDate" value="${e(date)}" max="${todayIST()}"></label>
      <label>Print<select id="abLayout"><option value="full">Full bills (each bill complete)</option><option value="list">Short list (one line per bill)</option></select></label>
      <label>Paper<select id="abFmt"><option value="thermal">Thermal 80mm</option><option value="a4">A4</option></select></label>
      ${admin ? '<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="abSum" checked style="min-height:0"> Day summary</label>' : ''}</div>
    <div class="dc-msg" id="abMsg">Loading bills…</div>
    <div class="dc-pv" id="abPv"></div>
    <div class="dc-btns"><button type="button" class="dc-btn" data-dc-close>Close</button><button type="button" class="dc-btn solid" id="abPrint" disabled>Print all bills</button></div>`);
  const q = s => d.querySelector(s);
  let bills = [];
  const html = () => dayBillsHTML(bills, { date: q('#abDate').value, layout: q('#abLayout').value, summary: admin && !!q('#abSum')?.checked, fmt: q('#abFmt').value });
  const draw = () => { q('#abPv').innerHTML = html(); };
  const load = async () => {
    q('#abMsg').className = 'dc-msg'; q('#abMsg').textContent = 'Loading bills…'; q('#abPrint').disabled = true; q('#abPv').innerHTML = '';
    const { data, error } = await sb.rpc('invoices_for_day', { p_date: q('#abDate').value, p_include_cancelled: false });
    if (error) { q('#abMsg').className = 'dc-msg bad'; q('#abMsg').textContent = nice(error); bills = []; return; }
    bills = Array.isArray(data) ? data : [];
    q('#abMsg').className = 'dc-msg ok';
    q('#abMsg').textContent = bills.length ? `${bills.length} bill${bills.length === 1 ? '' : 's'} on ${fmtDateWith(q('#abDate').value, cachedSettings().general.date_format)}.` : 'No bills on this day.';
    q('#abPrint').disabled = !bills.length; draw();
  };
  q('#abDate').onchange = load; q('#abLayout').onchange = draw; q('#abFmt').onchange = draw; if (q('#abSum')) q('#abSum').onchange = draw;
  q('#abPrint').onclick = () => printDoc(html(), `All bills ${q('#abDate').value}`, q('#abFmt').value);
  q('#abFmt').value = cachedSettings().invoice.default_format === 'a4' ? 'a4' : 'thermal';
  await load();
  return d;
}

// ---------------------------------------------------------------- Close Day (closing balance)
export async function openDayClose(sb, prof, { date = todayIST(), onSaved } = {}) {
  const admin = isAdminRole(prof?.role);
  const d = dialog(`<h3>🔒 Close Day — closing balance</h3><p class="dc-sub">Count the cash in the drawer and enter it. Only one closing balance can be added per day.</p>
    <div class="dc-row"><label>Day<input type="date" id="cbDate" value="${e(date)}" max="${todayIST()}"></label></div>
    <div id="cbBody"><p class="dc-msg">Loading…</p></div>
    <div class="dc-btns"><button type="button" class="dc-btn" id="cbBills">🧾 All Bills for Today</button><button type="button" class="dc-btn" data-dc-close>Close</button></div>`);
  const q = s => d.querySelector(s);
  q('#cbBills').onclick = () => openAllBills(sb, prof, { date: q('#cbDate').value });
  const show = async () => {
    const day = q('#cbDate').value;
    const { data, error } = await sb.rpc('get_daily_cash_closing', { p_closing_date: day });
    if (error) { q('#cbBody').innerHTML = `<p class="dc-msg bad">${e(nice(error))}</p>`; return; }
    const kv = (k, v, cls = '') => `<div><small>${k}</small><b class="${cls}">${v}</b></div>`;
    const sys = admin && data ? `<div class="dc-kv">${kv('Morning opening', data.opening == null ? 'Not entered' : '₹' + R(data.opening))}${kv('Cash in (sales + receipts)', '₹' + R(data.cash_in))}${kv('Cash out (refunds, expenses, suppliers)', '₹' + R(data.cash_out))}${kv('Expected in drawer', data.expected == null ? '—' : '₹' + R(data.expected))}</div>` : '';
    if (data?.id) {
      const diff = data.difference;
      q('#cbBody').innerHTML = `<div class="dc-done">✅ Closing balance recorded: <b>₹${R(data.amount)}</b>${data.created_by ? ` by ${e(data.created_by)}` : ''}${data.note ? `<br><small>${e(data.note)}</small>` : ''}${data.corrected_at ? `<br><small>Corrected: ${e(data.correction_reason || '')}</small>` : ''}</div>
        ${sys}${admin && diff != null ? `<p class="dc-msg ${Math.abs(diff) < 0.005 ? 'ok' : 'bad'}">${Math.abs(diff) < 0.005 ? 'Matches the expected cash.' : diff > 0 ? `Excess ₹${R(diff)}` : `Shortage ₹${R(-diff)}`}</p>` : ''}
        ${admin ? `<div class="dc-row" style="margin-top:8px"><label>Correct amount ₹<input id="cbFix" type="number" min="0" step=".01" value="${e(data.amount)}"></label><label style="flex:1">Reason<input id="cbWhy" maxlength="200" placeholder="Why it is corrected"></label><button type="button" class="dc-btn" id="cbFixGo">Correct</button></div><p class="dc-msg" id="cbMsg"></p>` : ''}`;
      if (admin) q('#cbFixGo').onclick = async () => {
        const { error: er } = await sb.rpc('correct_daily_cash_closing', { p_closing_date: day, p_amount: Number(q('#cbFix').value), p_reason: q('#cbWhy').value.trim() });
        if (er) { q('#cbMsg').className = 'dc-msg bad'; q('#cbMsg').textContent = nice(er); return; }
        onSaved?.(); await show();
      };
      return;
    }
    q('#cbBody').innerHTML = `${sys}<div class="dc-row"><label>Cash counted at closing ₹<input id="cbAmt" type="number" min="0" step=".01" inputmode="decimal" placeholder="0.00" required></label></div>
      <div class="dc-row"><label style="flex:1">Note (optional)<textarea id="cbNote" maxlength="300" placeholder="e.g. ₹2,000 kept in the safe"></textarea></label></div>
      <p class="dc-msg" id="cbMsg"></p><div class="dc-btns" style="margin-top:0"><button type="button" class="dc-btn solid" id="cbSave">Save closing balance</button></div>`;
    q('#cbAmt').focus();
    q('#cbSave').onclick = async () => {
      const raw = q('#cbAmt').value.trim(), amt = Number(raw);
      if (raw === '' || !(amt >= 0)) { q('#cbMsg').className = 'dc-msg bad'; q('#cbMsg').textContent = 'Enter the cash counted at closing (0 or more).'; return; }
      if (!confirm(`Save the closing balance ₹${R(amt)} for ${fmtDateWith(day, cachedSettings().general.date_format)}? It can be added only once.`)) return;
      q('#cbSave').disabled = true;
      const { error: er } = await sb.rpc('record_daily_cash_closing', { p_closing_date: day, p_amount: Math.round(amt * 100) / 100, p_note: q('#cbNote').value.trim() || null });
      q('#cbSave').disabled = false;
      if (er) { q('#cbMsg').className = 'dc-msg bad'; q('#cbMsg').textContent = nice(er); return; }
      onSaved?.(); await show();
    };
  };
  q('#cbDate').onchange = show;
  await show();
  return d;
}
