// Global top-bar search (medicines, invoices, customers) used by the branded pages.
import { icon } from './brand-shell.js';
import { esc } from './utils.js';

const TZ = 'Asia/Kolkata';
const rupees2 = v => '₹' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
const when = d => new Date(d).toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(' am', ' AM').replace(' pm', ' PM');

export const searchBox = id => `<div class="pp-search" data-search>
  <label for="${id}">${icon('search')}<input id="${id}" type="search" placeholder="Search medicines, invoices, customers..." autocomplete="off" aria-label="Search medicines, invoices and customers"><span class="pp-kbd">Ctrl + K</span></label>
  <div class="pp-search-results" hidden></div></div>`;

// extra(q) may return page-specific results [{ g, t, s, h, run }] shown first (e.g. Settings sections).
export function mountGlobalSearch({ sb, prof, extra, placeholder }) {
  const safe = p => Promise.resolve(p).then(({ data, error }) => (error ? null : data)).catch(() => null);
  const clean = s => String(s || '').replace(/[%,()*\\]/g, ' ').trim();
  function wireSearch(box) {
    const input = box.querySelector('input'), out = box.querySelector('.pp-search-results');
    let timer, seq = 0, items = [], active = -1;
    const close = () => { out.hidden = true; active = -1; };
    const paint = () => out.querySelectorAll('.pp-sr-item').forEach((a, i) => a.classList.toggle('active', i === active));
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = clean(input.value);
      if (q.length < 2) { close(); return; }
      timer = setTimeout(async () => {
        const my = ++seq;
        out.hidden = false;
        out.innerHTML = '<div class="pp-sr-empty">Searching…</div>';
        const [m, i, c] = await Promise.all([
          safe(sb.from('medicines').select('id,name,strength,barcode').eq('branch_id', prof.branch_id).eq('active', true).or(`name.ilike.%${q}%,barcode.eq.${q}`).limit(5)),
          safe(sb.from('sales_invoices').select('id,invoice_no,total,created_at').eq('branch_id', prof.branch_id).ilike('invoice_no', `%${q}%`).order('created_at', { ascending: false }).limit(5)),
          safe(sb.from('customers').select('id,name,phone').eq('branch_id', prof.branch_id).or(`name.ilike.%${q}%,phone.ilike.%${q}%`).limit(5))
        ]);
        if (my !== seq) return;
        items = [
          ...((extra && extra(q)) || []),
          ...(m || []).map(x => ({ g: 'Medicines', t: `${x.name}${x.strength ? ' ' + x.strength : ''}`, s: x.barcode || '', h: `medicines.html?q=${encodeURIComponent(x.name)}` })),
          ...(i || []).map(x => ({ g: 'Invoices', t: x.invoice_no, s: `${rupees2(x.total)} · ${when(x.created_at)}`, h: `invoice-view.html?id=${encodeURIComponent(x.id)}` })),
          ...(c || []).map(x => ({ g: 'Customers', t: x.name, s: x.phone || '', h: `customers.html?q=${encodeURIComponent(x.phone || x.name)}` }))
        ];
        let last = '';
        out.innerHTML = items.length ? items.map((x, k) => `${x.g !== last ? `<div class="pp-sr-group">${(last = x.g)}</div>` : ''}<a class="pp-sr-item" href="${x.h}" data-k="${k}"><span>${esc(x.t)}</span><small>${esc(x.s)}</small></a>`).join('')
          : `<div class="pp-sr-empty">No medicines, invoices or customers match “${esc(q)}”.</div>`;
        active = items.length ? 0 : -1;
        paint();
      }, 220);
    });
    input.addEventListener('keydown', e => {
      if (out.hidden || !items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); if (items[active].run) { items[active].run(); close(); input.blur(); } else location.href = items[active].h; }
      else if (e.key === 'Escape') close();
    });
    document.addEventListener('click', e => { if (!box.contains(e.target)) close(); });
  }
  document.querySelectorAll('[data-search]:not([data-wired])').forEach(b => {
    b.dataset.wired = '1';
    if (placeholder) { const i = b.querySelector('input'); i.placeholder = placeholder; i.setAttribute('aria-label', placeholder); }
    wireSearch(b);
    // page results that run an action instead of navigating
    b.querySelector('.pp-search-results').addEventListener('click', e => {
      const a = e.target.closest('.pp-sr-item'); if (!a || !extra) return;
      const it = (extra(clean(b.querySelector('input').value)) || [])[+a.dataset.k];
      if (it?.run && a.getAttribute('href') === it.h) { e.preventDefault(); it.run(); b.querySelector('.pp-search-results').hidden = true; }
    });
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const visible = [...document.querySelectorAll('[data-search] input')].find(i => i.offsetParent);
      visible?.focus();
    }
  });
}
