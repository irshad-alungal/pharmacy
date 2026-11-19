// Audit logs: read-only activity trail (audit_logs) and sign-in history (login_attempts).
// Access: database RLS — audit.view for activity, security.view for sign-ins (super_admin/admin).
import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly, safeQ } from './ui.js';

const prof = await mountShell('audit-logs', 'Audit logs');
const $ = id => document.getElementById(id);
const PAGE = 50;
const when = d => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' });
const istStart = d => new Date(`${d}T00:00:00+05:30`).toISOString();
const istEnd = d => new Date(`${d}T23:59:59.999+05:30`).toISOString();
const label = a => String(a || '').replace(/_/g, ' ');

const ACTION_GROUPS = [
  ['', 'All actions'],
  ['sale_', 'Sales'],
  ['billing_', 'Billing edits & overrides'],
  ['purchase', 'Purchases'],
  ['stock_', 'Stock adjustments'],
  ['physical_count', 'Physical counts'],
  ['batch_', 'Batch status / quarantine'],
  ['opening_stock', 'Opening stock'],
  ['delivery', 'Delivery'],
  ['expense', 'Expenses'],
  ['receipt', 'Receipts & payments'],
  ['medicine', 'Medicines'],
  ['staff', 'Staff']
];

$('view').innerHTML = `
<section class="audit-page">
  <header class="audit-heading"><div><h2>Audit logs</h2><p>Every sale, stock change, override and sign-in recorded for this branch. Entries cannot be edited or deleted.</p></div>
    <button type="button" id="export" class="sec">Export CSV</button></header>
  <div class="audit-tabs" role="tablist">
    <button type="button" class="audit-tab active" data-tab="activity" role="tab">Activity</button>
    <button type="button" class="audit-tab" data-tab="logins" role="tab">Sign-in history</button>
  </div>
  <section class="audit-panel" id="panel">
    <div class="audit-filters">
      <label>Search<input id="q" placeholder="Action, record type, reason or record ID"></label>
      <label id="actionWrap">Action<select id="action">${ACTION_GROUPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label>From<input id="from" type="date"></label>
      <label>To<input id="to" type="date"></label>
      <button type="button" id="clear" class="sec">Clear</button>
    </div>
    <div class="audit-summary"><span id="summary">Loading…</span><span><button type="button" id="prev" class="sec">‹ Newer</button> <button type="button" id="next" class="sec">Older ›</button></span></div>
    <div class="audit-table-wrap"><table class="audit-table"><thead id="head"></thead><tbody id="rows"></tbody></table></div>
    <p class="audit-footnote">Times are India Standard Time. Showing ${PAGE} entries per page, newest first.</p>
  </section>
</section>
<div class="audit-modal" id="modal" hidden><div class="audit-modal-backdrop" data-close></div><div class="audit-modal-card" role="dialog" aria-modal="true" aria-labelledby="mTitle">
  <header><h3 id="mTitle">Entry</h3><button type="button" class="sec" data-close>Close</button></header>
  <pre id="mBody"></pre><footer><button type="button" class="sec" data-close>Close</button></footer></div></div>`;

let tab = 'activity';
let page = 0;
let rows = [];
let total = 0;
const users = new Map();

async function loadUsers(ids) {
  const missing = [...new Set(ids.filter(id => id && !users.has(id)))];
  if (!missing.length) return;
  const { data } = await sb.from('profiles').select('id,full_name,staff_id').in('id', missing);
  for (const p of data || []) users.set(p.id, `${p.full_name} (${p.staff_id})`);
  for (const id of missing) if (!users.has(id)) users.set(id, id.slice(0, 8));
}

function buildQuery(forExport = false) {
  const q = safeQ($('q').value);
  const from = $('from').value, to = $('to').value;
  if (tab === 'activity') {
    let query = sb.from('audit_logs')
      .select('id,at,user_id,action,entity_type,entity_id,reason,before_data,after_data', { count: forExport ? undefined : 'exact' })
      .eq('branch_id', prof.branch_id)
      .order('at', { ascending: false }).order('id', { ascending: false });
    if ($('action').value) query = query.ilike('action', `${$('action').value}%`);
    if (q) query = query.or(`action.ilike.%${q}%,entity_type.ilike.%${q}%,reason.ilike.%${q}%,entity_id.ilike.%${q}%`);
    if (from) query = query.gte('at', istStart(from));
    if (to) query = query.lte('at', istEnd(to));
    return query;
  }
  let query = sb.from('login_attempts')
    .select('id,at,staff_id,portal,success,reason,ip', { count: forExport ? undefined : 'exact' })
    .order('at', { ascending: false });
  if (q) query = query.or(`staff_id.ilike.%${q}%,portal.ilike.%${q}%,reason.ilike.%${q}%`);
  if (from) query = query.gte('at', istStart(from));
  if (to) query = query.lte('at', istEnd(to));
  return query;
}

async function load() {
  $('rows').innerHTML = `<tr><td colspan="6" class="audit-empty">Loading…</td></tr>`;
  const { data, error, count } = await buildQuery().range(page * PAGE, page * PAGE + PAGE - 1);
  if (error) {
    rows = []; total = 0;
    $('rows').innerHTML = `<tr><td colspan="6" class="audit-error">${esc(friendly(error))}</td></tr>`;
    $('summary').textContent = '';
    return;
  }
  rows = data || [];
  total = count ?? rows.length;
  if (tab === 'activity') await loadUsers(rows.map(r => r.user_id));
  render();
}

function preview(r) {
  const d = r.after_data || r.before_data;
  if (!d) return '';
  const s = JSON.stringify(d);
  return s.length > 140 ? s.slice(0, 140) + '…' : s;
}

function render() {
  const start = total ? page * PAGE + 1 : 0;
  $('summary').textContent = total ? `Showing ${start}–${page * PAGE + rows.length} of ${total.toLocaleString('en-IN')}` : 'No entries match these filters.';
  $('prev').disabled = page === 0;
  $('next').disabled = (page + 1) * PAGE >= total;
  if (tab === 'activity') {
    $('head').innerHTML = '<tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Details</th><th></th></tr>';
    $('rows').innerHTML = rows.map((r, i) => `<tr>
      <td>${esc(when(r.at))}</td><td>${esc(users.get(r.user_id) || '—')}</td>
      <td><span class="audit-action">${esc(label(r.action))}</span>${r.reason ? `<small>${esc(r.reason)}</small>` : ''}</td>
      <td>${esc(label(r.entity_type))}${r.entity_id ? `<small>${esc(String(r.entity_id).slice(0, 36))}</small>` : ''}</td>
      <td class="audit-detail-preview">${esc(preview(r))}</td>
      <td class="audit-view"><button type="button" class="sec" data-i="${i}">View</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="audit-empty">No activity recorded for these filters.</td></tr>';
  } else {
    $('head').innerHTML = '<tr><th>When</th><th>Staff ID</th><th>Portal</th><th>Result</th><th>Reason</th><th>IP</th></tr>';
    $('rows').innerHTML = rows.map(r => `<tr><td>${esc(when(r.at))}</td><td>${esc(r.staff_id || '—')}</td><td>${esc(r.portal || '—')}</td>
      <td><span class="audit-action" style="${r.success ? '' : 'background:#fee2e2;color:#991b1b'}">${r.success ? 'Success' : 'Failed'}</span></td>
      <td>${esc(r.reason || '')}</td><td>${esc(r.ip || '')}</td></tr>`).join('')
      || '<tr><td colspan="6" class="audit-empty">No sign-in attempts for these filters.</td></tr>';
  }
}

$('rows').onclick = e => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  const r = rows[+b.dataset.i];
  $('mTitle').textContent = `${label(r.action)} · ${when(r.at)}`;
  $('mBody').textContent = JSON.stringify({
    user: users.get(r.user_id) || r.user_id, action: r.action, record_type: r.entity_type, record_id: r.entity_id,
    reason: r.reason, before: r.before_data, after: r.after_data
  }, null, 2);
  $('modal').hidden = false;
};
$('modal').onclick = e => { if (e.target.closest('[data-close]')) $('modal').hidden = true; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('modal').hidden = true; });

let timer;
const reload = () => { clearTimeout(timer); timer = setTimeout(() => { page = 0; load(); }, 300); };
['q', 'from', 'to'].forEach(id => $(id).addEventListener('input', reload));
$('action').onchange = reload;
$('clear').onclick = () => { ['q', 'from', 'to'].forEach(id => { $(id).value = ''; }); $('action').value = ''; page = 0; load(); };
$('prev').onclick = () => { if (page > 0) { page--; load(); } };
$('next').onclick = () => { page++; load(); };
document.querySelector('.audit-tabs').onclick = e => {
  const b = e.target.closest('[data-tab]');
  if (!b || b.dataset.tab === tab) return;
  tab = b.dataset.tab;
  document.querySelectorAll('.audit-tab').forEach(x => x.classList.toggle('active', x === b));
  $('actionWrap').hidden = tab !== 'activity';
  page = 0;
  load();
};

// CSV export of everything matching the current filters (up to 5,000 rows).
$('export').onclick = async () => {
  $('export').disabled = true;
  const { data, error } = await buildQuery(true).range(0, 4999);
  $('export').disabled = false;
  if (error) return alert(friendly(error));
  if (tab === 'activity') await loadUsers((data || []).map(r => r.user_id));
  const cols = tab === 'activity'
    ? [['When (IST)', r => when(r.at)], ['User', r => users.get(r.user_id) || r.user_id || ''], ['Action', r => r.action], ['Record type', r => r.entity_type],
       ['Record ID', r => r.entity_id || ''], ['Reason', r => r.reason || ''], ['Before', r => r.before_data ? JSON.stringify(r.before_data) : ''], ['After', r => r.after_data ? JSON.stringify(r.after_data) : '']]
    : [['When (IST)', r => when(r.at)], ['Staff ID', r => r.staff_id || ''], ['Portal', r => r.portal || ''], ['Success', r => r.success ? 'yes' : 'no'], ['Reason', r => r.reason || ''], ['IP', r => r.ip || '']];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.map(c => cell(c[0])).join(','), ...(data || []).map(r => cols.map(c => cell(c[1](r))).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${tab === 'activity' ? 'audit-log' : 'sign-in-history'}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

await load();
