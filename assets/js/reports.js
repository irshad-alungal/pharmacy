import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';
import { REPORTS } from './report-defs.js';
import { fmt, fmtDate, totalsOf, downloadPdf, downloadXlsx } from './export.js';

await mountShell('reports', 'Reports');
const $ = id => document.getElementById(id);
const todayResult = await sb.rpc('ist_today');
const today = todayResult.data || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const settings = await sb.from('pharmacy_settings').select('name').eq('id', 1).single();
const shop = settings.data?.name || 'ALZA PHARMACY';

const addDays = (iso, amount) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
};
const monthStart = iso => `${iso.slice(0, 8)}01`;
const previousMonthStart = iso => {
  const d = new Date(`${monthStart(iso)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
};
const ranges = {
  today: [today, today],
  week: [addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)), today],
  month: [monthStart(today), today],
  last: [previousMonthStart(today), addDays(monthStart(today), -1)],
  d30: [addDays(today, -29), today],
  year: [`${today.slice(0, 4)}-01-01`, today],
  all: ['', '']
};
const groups = [
  ['Overview', ['period']],
  ['Sales', ['sales', 'medicines', 'customers', 'returns']],
  ['Purchases', ['purchases', 'distributors']],
  ['Inventory', ['stock', 'expiry']],
  ['Finance & tax', ['expenses', 'tax', 'pnl', 'ledger']]
];
const reportOptions = groups.map(([label, ids]) =>
  `<optgroup label="${esc(label)}">${REPORTS.filter(r => ids.includes(r.id)).map(r => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('')}</optgroup>`
).join('');

$('view').innerHTML = `
<section class="reports-page">
  <header class="reports-hero">
    <div>
      <p class="reports-kicker">Business intelligence</p>
      <h2 style="margin:0">Reports centre</h2>
      <p class="reports-subtitle">Review sales, purchases, inventory, customers, tax and financial performance. Choose a report and period, then run or export it.</p>
    </div>
    <span class="reports-count">${REPORTS.length} available reports</span>
  </header>

  <section class="reports-card reports-controls-card">
    <div class="reports-controls">
      <div class="reports-field">
        <label for="rp">Select report</label>
        <select id="rp">${reportOptions}</select>
      </div>
      <div class="reports-field">
        <label for="rangeSummary">Selected period</label>
        <input id="rangeSummary" type="text" readonly value="This month">
      </div>
    </div>

    <div id="rg" class="reports-presets" aria-label="Date range presets">
      <button type="button" data-r="today">Today</button>
      <button type="button" data-r="week">This week</button>
      <button type="button" data-r="month" class="active">This month</button>
      <button type="button" data-r="last">Last month</button>
      <button type="button" data-r="d30">Last 30 days</button>
      <button type="button" data-r="year">This year</button>
      <button type="button" data-r="all">All dates</button>
    </div>

    <div id="dateFields" class="reports-date-grid">
      <div class="reports-field"><label for="df">From date</label><input id="df" type="date"></div>
      <div class="reports-field"><label for="dt">To date</label><input id="dt" type="date"></div>
    </div>

    <div class="reports-options">
      <div id="bw" class="reports-field">
        <label for="bk">Group period report by</label>
        <select id="bk">
          <option value="day">Day — daily</option>
          <option value="week">Week — weekly</option>
          <option value="month">Month — monthly</option>
        </select>
      </div>
      <div id="dw" class="reports-field">
        <label for="dd">Expiry window (days)</label>
        <input id="dd" type="number" min="0" max="3650" value="90">
      </div>
    </div>

    <div id="nt" class="reports-note" hidden></div>
    <div class="reports-actions">
      <button type="button" id="run">Run report</button>
      <button type="button" id="pdf" class="sec" disabled>Download PDF</button>
      <button type="button" id="xls" class="sec" disabled>Download Excel</button>
    </div>
    <p id="msg" class="reports-message" role="status" aria-live="polite"></p>
  </section>

  <section class="reports-card reports-result" id="out" aria-live="polite">
    <div class="reports-empty">
      <strong>Select a report and click Run report.</strong>
      <p class="reports-hint">Your results will appear here. PDF and Excel downloads become available after a report runs.</p>
    </div>
  </section>
</section>`;

const getDef = () => REPORTS.find(r => r.id === $('rp').value);
let current = null;
let activeRange = 'month';

function rangeLabel(from, to) {
  if (!from && !to) return 'All dates';
  return `${from ? fmtDate(from) : 'Beginning'} – ${to ? fmtDate(to) : 'Today'}`;
}
function setRange(key) {
  activeRange = key;
  const [from, to] = ranges[key];
  $('df').value = from;
  $('dt').value = to;
  $('rangeSummary').value = key === 'all' ? 'All dates' : key === 'today' ? 'Today' :
    key === 'week' ? 'This week' : key === 'month' ? 'This month' :
    key === 'last' ? 'Last month' : key === 'd30' ? 'Last 30 days' : 'This year';
  document.querySelectorAll('#rg [data-r]').forEach(b => b.classList.toggle('active', b.dataset.r === key));
}
function syncReport() {
  const d = getDef();
  const hasRange = d.params.includes('range');
  $('rg').hidden = !hasRange;
  $('dateFields').hidden = !hasRange;
  $('bw').hidden = !d.params.includes('bucket');
  $('dw').hidden = !d.params.includes('days');
  $('nt').hidden = !d.note;
  $('nt').textContent = d.note || '';
  $('pdf').disabled = $('xls').disabled = true;
  $('msg').textContent = '';
  $('msg').className = 'reports-message';
  $('out').innerHTML = `<div class="reports-empty"><strong>${esc(d.title)}</strong><p class="reports-hint">Choose the required filters and click Run report.</p></div>`;
  current = null;
}
$('rp').addEventListener('change', syncReport);
$('rg').addEventListener('click', e => {
  const button = e.target.closest('button[data-r]');
  if (button) setRange(button.dataset.r);
});
$('df').addEventListener('change', () => { activeRange = 'custom'; $('rangeSummary').value = 'Custom range'; document.querySelectorAll('#rg [data-r]').forEach(b => b.classList.remove('active')); });
$('dt').addEventListener('change', () => { activeRange = 'custom'; $('rangeSummary').value = 'Custom range'; document.querySelectorAll('#rg [data-r]').forEach(b => b.classList.remove('active')); });
setRange('month');
syncReport();

$('run').addEventListener('click', async () => {
  const d = getDef();
  const from = $('df').value || null;
  const to = $('dt').value || null;
  $('msg').textContent = '';
  $('msg').className = 'reports-message';
  if (d.params.includes('range') && from && to && from > to) {
    $('msg').textContent = 'The From date cannot be after the To date.';
    $('msg').classList.add('error');
    return;
  }
  if (d.params.includes('days') && (!Number.isInteger(+$('dd').value) || +$('dd').value < 0 || +$('dd').value > 3650)) {
    $('msg').textContent = 'Enter an expiry window between 0 and 3650 days.';
    $('msg').classList.add('error');
    return;
  }
  const args = {};
  if (d.params.includes('range')) { args.p_from = from; args.p_to = to; }
  if (d.params.includes('bucket')) args.p_bucket = $('bk').value;
  if (d.params.includes('days')) args.p_days = +$('dd').value;
  $('run').disabled = true;
  $('msg').textContent = 'Running report…';
  $('out').innerHTML = `<div class="reports-empty">Loading report data…</div>`;
  try {
    const { data, error } = await sb.rpc(d.rpc, args);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const period = d.params.includes('range') ? rangeLabel(from, to) :
      d.params.includes('days') ? `Expiring within ${args.p_days} days` : 'Current stock snapshot';
    const bucket = d.params.includes('bucket') ? ` · Grouped by ${args.p_bucket}` : '';
    const generated = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    current = { def: d, rows, meta: { shop, subtitle: period + bucket, generated, stamp: today } };
    $('pdf').disabled = $('xls').disabled = false;
    const totals = totalsOf(d, rows);
    const isNumeric = col => col.t !== 'text' && col.t !== 'date';
    const visible = rows.slice(0, 500);
    const totalRow = rows.length && totals.some(v => v !== null)
      ? `<tfoot><tr>${d.cols.map((col, i) => `<td class="${isNumeric(col) ? 'numeric' : ''}">${i === 0 ? 'TOTAL' : totals[i] !== null ? esc(fmt(col, totals[i])) : ''}</td>`).join('')}</tr></tfoot>` : '';
    $('out').innerHTML = `
      <div class="reports-result-head">
        <div>
          <h3>${esc(d.title)}</h3>
          <p class="reports-result-meta">${esc(period + bucket)} · Generated ${esc(generated)}</p>
        </div>
        <div class="reports-stat"><small>Rows returned</small><strong>${rows.length.toLocaleString('en-IN')}</strong></div>
      </div>
      ${rows.length > 500 ? `<p class="reports-hint">Showing the first 500 rows in the preview. PDF and Excel exports include all ${rows.length.toLocaleString('en-IN')} rows.</p>` : ''}
      <div class="reports-table-wrap">
        <table class="reports-table">
          <thead><tr>${d.cols.map(col => `<th class="${isNumeric(col) ? 'numeric' : ''}">${esc(col.l)}</th>`).join('')}</tr></thead>
          <tbody>${visible.map(row => `<tr>${d.cols.map(col => `<td class="${isNumeric(col) ? 'numeric' : ''}">${esc(fmt(col, row[col.k]))}</td>`).join('')}</tr>`).join('') || `<tr><td class="reports-empty" colspan="${d.cols.length}">No data for the selected filters.</td></tr>`}</tbody>
          ${totalRow}
        </table>
      </div>`;
    $('msg').textContent = rows.length ? 'Report generated successfully.' : 'Report completed. No data matched the selected filters.';
    $('msg').classList.add('success');
  } catch (error) {
    current = null;
    $('pdf').disabled = $('xls').disabled = true;
    $('out').innerHTML = `<div class="reports-empty">Unable to display this report.</div>`;
    $('msg').textContent = friendly(error);
    $('msg').classList.add('error');
  } finally {
    $('run').disabled = false;
  }
});

const exportReport = async exporter => {
  if (!current) return;
  $('msg').textContent = 'Preparing download…';
  $('msg').className = 'reports-message';
  $('pdf').disabled = $('xls').disabled = true;
  try {
    await exporter(current.def, current.rows, current.meta);
    $('msg').textContent = 'Download prepared.';
    $('msg').classList.add('success');
  } catch (error) {
    $('msg').textContent = `Export failed: ${error.message || error}`;
    $('msg').classList.add('error');
  } finally {
    $('pdf').disabled = $('xls').disabled = false;
  }
};
$('pdf').addEventListener('click', () => exportReport(downloadPdf));
$('xls').addEventListener('click', () => exportReport(downloadXlsx));
