import { sb } from './supabase-client.js';
import { mountShell } from './navigation.js';
import { esc } from './utils.js';
import { friendly } from './ui.js';

const prof = await mountShell('whatsapp', 'WhatsApp Campaigns');
if (!prof) throw new Error('Unable to load user profile.');
const branchId = prof.branch_id;
const view = document.getElementById('view');
if (!branchId) { view.textContent = 'Your profile has no assigned branch.'; throw new Error('Missing branch'); }
const $ = id => document.getElementById(id);
let customers = [], selected = new Set(), photoFile = null, photoUrl = '', searchText = '';
const fmtDuration = seconds => {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h ? `${h} hr` : '', m ? `${m} min` : '', r || (!h && !m) ? `${r} sec` : ''].filter(Boolean).join(' ');
};
const phoneDigits = v => String(v || '').replace(/\D/g, '');

view.innerHTML = `
<div class="wa-page">
  <div class="wa-row wa-between"><div><h2 style="margin:.1rem 0">Promotional bulk messaging</h2><p class="wa-muted">Prepare an offer message and photo for customers who have agreed to receive WhatsApp promotions.</p></div><button class="wa-btn secondary" id="wa-refresh">Refresh customers</button></div>
  <div class="wa-notice"><strong>How sending works:</strong> WhatsApp opens one chat at a time with your message filled in — review it and press Send in WhatsApp. The app then waits for the interval before the next customer, which keeps your number safe from spam limits. Use <em>{{name}}</em> in the message to personalise it. If a photo is attached, use <em>Copy photo</em> and paste it into the chat.</div>
  <div class="wa-grid">
    <section class="wa-card">
      <div class="wa-row wa-between"><h3>1. Select recipients</h3><span class="wa-count" id="wa-selected-count">0 selected</span></div>
      <input class="wa-search" id="wa-search" placeholder="Search customer name or phone…" autocomplete="off">
      <div class="wa-row" style="margin-top:.7rem"><button class="wa-btn secondary" id="wa-select-all">Select all eligible</button><button class="wa-btn secondary" id="wa-clear">Clear selection</button><span class="wa-count" id="wa-eligible-count">Loading…</span></div>
      <div class="wa-recipient-list" id="wa-recipients"><div class="wa-recipient">Loading customers…</div></div>
      <p class="wa-muted">Only customers with WhatsApp promotional consent and a valid phone number are selectable. Inactive customers are excluded.</p>
    </section>
    <section class="wa-card">
      <h3>2. Compose offer</h3>
      <div class="wa-field"><label for="wa-message">Message</label><textarea id="wa-message" maxlength="1024" placeholder="Write your pharmacy offer…"></textarea><div class="wa-row wa-between"><span class="wa-muted">Keep the offer clear and concise.</span><span class="wa-count" id="wa-char-count">0 / 1024</span></div></div>
      <div class="wa-field"><label>Promotional photo (optional)</label><label class="wa-file-label" for="wa-photo"><span>＋ Choose photo</span><span class="wa-muted">JPG, PNG or WEBP · up to 5 MB</span></label><input id="wa-photo" type="file" accept="image/jpeg,image/png,image/webp" class="wa-hidden"><div class="wa-row"><button class="wa-btn secondary wa-hidden" id="wa-remove-photo" type="button">Remove photo</button><span class="wa-muted" id="wa-photo-name">No photo selected</span></div></div>
      <h3 style="margin-top:1.2rem">3. Sending interval</h3>
      <div class="wa-field"><label for="wa-interval">Delay between messages</label><div class="wa-row"><input id="wa-interval" type="number" min="30" max="3600" step="15" value="120" style="max-width:150px;padding:.65rem;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)"><strong id="wa-interval-label">2 minutes</strong></div><input id="wa-interval-range" type="range" min="30" max="600" step="30" value="120"><span class="wa-muted">30 seconds to 60 minutes. You can enter a custom value in seconds.</span></div>
      <div class="wa-field"><label for="wa-template">Message type</label><select id="wa-template"><option value="offer">Promotional offer</option><option value="announcement">Pharmacy announcement</option><option value="custom">Custom message</option></select></div>
    </section>
  </div>
  <div class="wa-grid">
    <section class="wa-card"><h3>4. Preview</h3><div class="wa-preview"><img id="wa-preview-image" class="wa-hidden" alt="Offer preview"><div id="wa-preview-text" class="wa-preview-text wa-muted">Your message preview will appear here.</div></div><p class="wa-muted">Promotional messages may require an approved WhatsApp marketing template. Final delivery is subject to WhatsApp policies and account limits.</p></section>
    <section class="wa-card"><h3>5. Campaign summary</h3><div class="wa-stats"><div class="wa-stat"><strong id="wa-stat-selected">0</strong><span class="wa-muted">Recipients</span></div><div class="wa-stat"><strong id="wa-stat-interval">2 min</strong><span class="wa-muted">Interval</span></div><div class="wa-stat"><strong id="wa-stat-duration">—</strong><span class="wa-muted">Approx. duration</span></div></div><p class="wa-muted" id="wa-duration-note">Select recipients to estimate campaign duration.</p><div class="wa-row" style="margin-top:1rem"><button class="wa-btn" id="wa-send" disabled>Start sending</button><button class="wa-btn secondary" id="wa-reset">Reset</button></div><p id="wa-status" class="wa-muted" aria-live="polite"></p></section>
  </div>
</div>`;

function eligible(c) { return c.active !== false && c.consent === true && phoneDigits(c.phone).length >= 10; }
function visibleCustomers() { return customers.filter(c => eligible(c) && `${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(searchText)); }
function renderRecipients() {
  const list = visibleCustomers();
  $('wa-eligible-count').textContent = `${customers.filter(eligible).length} eligible`;
  $('wa-recipients').innerHTML = list.map(c => `<label class="wa-recipient"><input type="checkbox" data-wa-customer="${esc(c.id)}" ${selected.has(c.id) ? 'checked' : ''}><span style="flex:1;min-width:0"><strong>${esc(c.name || 'Unnamed customer')}</strong><small>${esc(c.phone || '')}</small></span><span class="wa-pill">Consent</span></label>`).join('') || '<div class="wa-recipient">No eligible customers match your search.</div>';
  $('wa-selected-count').textContent = `${selected.size} selected`;
  $('wa-stat-selected').textContent = selected.size;
  $('wa-send').disabled = selected.size === 0;
}
async function loadCustomers() {
  $('wa-recipients').innerHTML = '<div class="wa-recipient">Loading customers…</div>';
  const { data, error } = await sb.from('customers').select('id,name,phone,consent,active').eq('branch_id', branchId).order('name');
  if (error) { $('wa-recipients').innerHTML = `<div class="wa-recipient wa-error">${esc(friendly(error))}</div>`; $('wa-status').textContent = 'Could not load branch customers.'; return; }
  customers = data || [];
  const ids = new Set(customers.map(c => c.id));
  selected = new Set([...selected].filter(id => ids.has(id) && eligible(customers.find(c => c.id === id))));
  renderRecipients();
}
function intervalSeconds() { const n = Number($('wa-interval').value); return Number.isFinite(n) ? Math.min(3600, Math.max(30, Math.round(n))) : 120; }
function updatePreview() {
  const msg = $('wa-message').value.trim();
  $('wa-char-count').textContent = `${$('wa-message').value.length} / 1024`;
  $('wa-preview-text').textContent = msg || 'Your message preview will appear here.';
  const seconds = intervalSeconds();
  $('wa-interval-label').textContent = fmtDuration(seconds);
  $('wa-stat-interval').textContent = seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`;
  $('wa-interval-range').value = String(Math.min(600, seconds));
  const duration = selected.size > 1 ? (selected.size - 1) * seconds : 0;
  $('wa-stat-duration').textContent = selected.size ? fmtDuration(duration) : '—';
  $('wa-duration-note').textContent = selected.size ? `Estimated time from first to last scheduled message: ${fmtDuration(duration)}. This is a planning estimate, not a delivery guarantee.` : 'Select recipients to estimate campaign duration.';
  $('wa-send').disabled = selected.size === 0 || !msg;
}
$('wa-recipients').addEventListener('change', e => { const input = e.target.closest('[data-wa-customer]'); if (!input) return; input.checked ? selected.add(input.dataset.waCustomer) : selected.delete(input.dataset.waCustomer); renderRecipients(); updatePreview(); });
$('wa-search').addEventListener('input', e => { searchText = e.target.value.trim().toLowerCase(); renderRecipients(); });
$('wa-select-all').onclick = () => { visibleCustomers().forEach(c => selected.add(c.id)); renderRecipients(); updatePreview(); };
$('wa-clear').onclick = () => { selected.clear(); renderRecipients(); updatePreview(); };
$('wa-refresh').onclick = loadCustomers;
$('wa-message').addEventListener('input', updatePreview);
$('wa-interval').addEventListener('input', updatePreview);
$('wa-interval-range').addEventListener('input', e => { $('wa-interval').value = e.target.value; updatePreview(); });
$('wa-photo').addEventListener('change', () => {
  const file = $('wa-photo').files?.[0];
  if (!file) return;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { $('wa-status').textContent = 'Choose a JPG, PNG or WEBP image up to 5 MB.'; $('wa-photo').value = ''; return; }
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoFile = file; photoUrl = URL.createObjectURL(file);
  $('wa-preview-image').src = photoUrl; $('wa-preview-image').classList.remove('wa-hidden');
  $('wa-photo-name').textContent = file.name; $('wa-remove-photo').classList.remove('wa-hidden'); $('wa-status').textContent = '';
});
$('wa-remove-photo').onclick = () => { if (photoUrl) URL.revokeObjectURL(photoUrl); photoUrl = ''; photoFile = null; $('wa-photo').value = ''; $('wa-preview-image').src = ''; $('wa-preview-image').classList.add('wa-hidden'); $('wa-photo-name').textContent = 'No photo selected'; $('wa-remove-photo').classList.add('wa-hidden'); };
$('wa-reset').onclick = () => { selected.clear(); $('wa-message').value = ''; $('wa-template').value = 'offer'; $('wa-interval').value = '120'; $('wa-photo').value = ''; $('wa-remove-photo').click(); $('wa-status').textContent = 'Campaign form reset.'; renderRecipients(); updatePreview(); };
// ---- Guided sending: one WhatsApp chat at a time, with the interval enforced between chats.
let run = null;
const waNumber = phone => { const d = phoneDigits(phone); return d.length === 10 ? '91' + d : d; };
const personalise = (text, c) => text.replace(/\{\{\s*name\s*\}\}/gi, (c.name || '').split(' ')[0] || 'there').replace(/\{\{\s*phone\s*\}\}/gi, c.phone || '');
function renderRun() {
  if (!run) return;
  const c = run.queue[run.index];
  const done = run.index >= run.queue.length;
  const wait = Math.max(0, Math.ceil((run.nextAt - Date.now()) / 1000));
  $('wa-status').innerHTML = done
    ? `<div class="wa-run"><strong>Campaign finished.</strong> Opened ${run.opened} of ${run.queue.length} chat(s)${run.skipped ? `, skipped ${run.skipped}` : ''}.<div class="wa-row" style="margin-top:.6rem"><button class="wa-btn secondary" type="button" id="wa-run-close">Close</button></div></div>`
    : `<div class="wa-run"><div class="wa-row wa-between"><strong>Sending ${run.index + 1} of ${run.queue.length}</strong><span class="wa-muted">Opened ${run.opened}${run.skipped ? ` · skipped ${run.skipped}` : ''}</span></div>
        <div class="wa-progress"><span style="width:${Math.round(run.index / run.queue.length * 100)}%"></span></div>
        <p style="margin:.6rem 0"><strong>${esc(c.name || 'Customer')}</strong> · ${esc(c.phone || '')}</p>
        <div class="wa-row">
          <button class="wa-btn" type="button" id="wa-run-open" ${wait ? 'disabled' : ''}>${wait ? `Next chat in ${fmtDuration(wait)}` : 'Open WhatsApp chat'}</button>
          ${photoFile ? '<button class="wa-btn secondary" type="button" id="wa-run-photo">Copy photo</button>' : ''}
          <button class="wa-btn secondary" type="button" id="wa-run-skip">Skip</button>
          <button class="wa-btn secondary" type="button" id="wa-run-stop">Stop</button>
        </div></div>`;
}
async function copyPhoto() {
  if (!photoFile) return;
  try {
    const bmp = await createImageBitmap(photoFile);
    const canvas = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    $('wa-run-photo').textContent = 'Photo copied — paste it in the chat';
  } catch {
    const a = Object.assign(document.createElement('a'), { href: photoUrl, download: photoFile.name });
    a.click();
    $('wa-run-photo').textContent = 'Photo downloaded — attach it in the chat';
  }
}
$('wa-status').addEventListener('click', e => {
  if (!run) return;
  const id = e.target.id;
  if (id === 'wa-run-open') {
    const c = run.queue[run.index];
    window.open(`https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent(personalise(run.message, c))}`, '_blank', 'noopener');
    run.opened++; run.index++; run.nextAt = Date.now() + run.interval * 1000;
  } else if (id === 'wa-run-skip') { run.skipped++; run.index++; }
  else if (id === 'wa-run-photo') { copyPhoto(); return; }
  else if (id === 'wa-run-stop') { run.index = run.queue.length; }
  else if (id === 'wa-run-close') { clearInterval(run.timer); run = null; $('wa-status').innerHTML = ''; return; }
  renderRun();
});
$('wa-send').onclick = () => {
  const message = $('wa-message').value.trim();
  if (!selected.size || !message) return;
  if (run) clearInterval(run.timer);
  const queue = customers.filter(c => selected.has(c.id) && eligible(c));
  run = { queue, message, index: 0, opened: 0, skipped: 0, interval: intervalSeconds(), nextAt: 0, timer: null };
  run.timer = setInterval(() => { if (run && run.nextAt > Date.now() - 1000) renderRun(); }, 1000);
  renderRun();
  $('wa-status').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
await loadCustomers();
updatePreview();
