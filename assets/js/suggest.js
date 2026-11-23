// Type-ahead suggestions under a text box (not a drop-down select). Used for medicine and distributor
// names in Inventory → Opening stock and Purchases. The person can always type a new value.
//   attachSuggest(root, 'input[data-field="item"]', q => [{ label, sub, value, data }], (input, item) => {...})
// ↑ ↓ move, Enter / Tab pick, Esc close. Works for rows added later (event delegation).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let box = null, cur = null, items = [], active = -1, pickFn = null, seq = 0;
function ensureBox() {
  if (box) return box;
  box = document.createElement('div');
  box.className = 'sg-box'; box.setAttribute('role', 'listbox'); box.hidden = true;
  document.body.appendChild(box);
  box.addEventListener('mousedown', e => { const b = e.target.closest('[data-k]'); if (!b) return; e.preventDefault(); choose(+b.dataset.k); });
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
  if (!document.getElementById('sg-css')) {
    const st = document.createElement('style'); st.id = 'sg-css';
    st.textContent = `.sg-box{position:fixed;z-index:100000;max-height:260px;overflow:auto;background:#fff;border:1px solid #d6dee9;border-radius:10px;box-shadow:0 14px 34px rgba(13,27,75,.16);padding:4px;font:500 .88rem Inter,system-ui,sans-serif}
      .sg-box button{display:block;width:100%;text-align:left;border:0;background:none;padding:7px 10px;border-radius:7px;color:#0d1b4b;cursor:pointer}
      .sg-box button.on,.sg-box button:hover{background:#e8f6ea}.sg-box small{display:block;color:#66748a;font-size:.74rem;font-weight:500}
      .sg-box b{font-weight:700}.sg-box .sg-new{color:#0b7a14;font-weight:600}`;
    document.head.appendChild(st);
  }
  return box;
}
function place() {
  if (!box || box.hidden || !cur) return;
  const r = cur.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) { close(); return; }
  box.style.left = `${Math.max(4, r.left)}px`; box.style.width = `${Math.max(r.width, 260)}px`;
  const below = innerHeight - r.bottom;
  if (below < 200 && r.top > below) { box.style.top = ''; box.style.bottom = `${innerHeight - r.top + 2}px`; }
  else { box.style.bottom = ''; box.style.top = `${r.bottom + 2}px`; }
}
function close() { if (box) box.hidden = true; items = []; active = -1; }
function paint() { box.querySelectorAll('[data-k]').forEach((b, i) => b.classList.toggle('on', i === active)); box.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }
function choose(k) {
  const it = items[k]; if (!it || !cur) return;
  cur.value = it.value ?? it.label;
  pickFn?.(cur, it);
  cur.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  close();
}
const hl = (label, q) => { const i = label.toLowerCase().indexOf(q.toLowerCase()); return i < 0 || !q ? esc(label) : `${esc(label.slice(0, i))}<b>${esc(label.slice(i, i + q.length))}</b>${esc(label.slice(i + q.length))}`; };
export function attachSuggest(root, selector, source, onPick, opts = {}) {
  ensureBox();
  const min = opts.min ?? 1;
  const show = async input => {
    cur = input; pickFn = onPick;
    const q = input.value.trim();
    if (q.length < min) { close(); return; }
    const tok = ++seq;
    let list = [];
    try { list = (await source(q, input)) || []; } catch { list = []; }
    if (cur !== input || tok !== seq) return;
    items = list.slice(0, opts.limit || 8); active = items.length ? 0 : -1;
    if (!items.length) { close(); return; }
    // Inside a modal <dialog> the box must live in the dialog (top layer), or it renders underneath.
    const host = input.closest('dialog[open]') || document.body;
    if (box.parentNode !== host) host.appendChild(box);
    box.innerHTML = items.map((it, k) => `<button type="button" data-k="${k}" role="option">${hl(it.label, q)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('');
    box.hidden = false; place(); paint();
  };
  root.addEventListener('input', e => { if (e.target.matches?.(selector) && e.isTrusted !== false) show(e.target); });
  root.addEventListener('focusin', e => { if (e.target.matches?.(selector) && e.target.value.trim()) show(e.target); });
  root.addEventListener('focusout', e => { if (e.target === cur) setTimeout(() => { if (document.activeElement !== cur) close(); }, 120); });
  root.addEventListener('keydown', e => {
    if (!e.target.matches?.(selector) || !box || box.hidden || e.target !== cur) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0) { if (e.key === 'Enter') e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
}
// Rank names: starts-with first, then contains.
export function matchNames(list, q, getName = x => x.name, limit = 8) {
  const s = q.toLowerCase();
  const a = [], b = [];
  for (const x of list) { const n = String(getName(x) || '').toLowerCase(); if (n.startsWith(s)) a.push(x); else if (n.includes(s)) b.push(x); if (a.length >= limit) break; }
  return [...a, ...b].slice(0, limit);
}
