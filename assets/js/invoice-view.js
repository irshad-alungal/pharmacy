// invoice-view.html has two uses:
//  • ?t=<64-hex token> — the customer's private link from WhatsApp (no login). Reads public_invoice(token) (0030):
//    the link expires after 180 days and never shows diagnosis, doctor, address or the full phone number.
//  • anything else (?id=…, ?no=…) — the staff Invoice View with the Dashboard sidebar (invoice-page.js).
const params = new URLSearchParams(location.search);
if (!params.has('t')) {
  await import('./invoice-page.js');
} else {
  const { sb } = await import('./supabase-client.js');
  const { printInvoice, downloadPDF } = await import('./invoice.js');
  const { paperHTML, esc: e, rs } = await import('./invoice-card.js');
  const token = params.get('t') || '';
  const main = document.getElementById('main');
  const top = name => `<header class="iv-pub-top"><img src="assets/images/brand/logo-horizontal.png" alt="Pallikkal Pharmacy" onerror="this.remove()"><b id="shopName">${e(name || '')}</b></header>`;
  const fail = msg => { main.innerHTML = `${top('')}<div class="iv-pub-wrap"><div class="iv-pub-card iv-pub-err"><h1>Invoice not available</h1><p>${e(msg)}</p></div><footer class="iv-pub-foot">Pallikkal Pharmacy</footer></div>`; };

  if (!/^[0-9a-f]{64}$/.test(token)) fail('This invoice link is not complete. Please open the full link from the WhatsApp message.');
  else {
    const { data: d, error } = await sb.rpc('public_invoice', { p_token: token });
    if (error || !d?.invoice) fail(/not valid|expired/i.test(error?.message || '') ? error.message : 'This invoice could not be loaded. Please try again or contact the pharmacy.');
    else {
      d.shop = d.shop || {}; d.items = d.items || []; d.payments = d.payments || []; d.tax_summary = d.tax_summary || [];
      const s = d.shop, i = d.invoice, phone = String(s.phone || '').replace(/\D/g, '');
      const tel = phone ? `+${phone.length === 10 ? '91' + phone : phone}` : '';
      document.title = `Invoice ${i.invoice_no} — ${s.name || 'Pallikkal Pharmacy'}`;
      const dt = new Date(i.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      main.innerHTML = `${top(s.name || 'Pallikkal Pharmacy')}
      <div class="iv-pub-wrap">
        <section class="iv-pub-card">
          <div class="iv-pub-sum"><div><h1>Invoice ${e(i.invoice_no)}</h1><p>${e(dt)}${d.customer?.name ? ` · ${e(d.customer.name)}` : i.patient_name ? ` · ${e(i.patient_name)}` : ''}</p></div><div class="iv-pub-total">${rs(i.total)}</div></div>
          ${i.status !== 'final' ? `<p class="iv-pub-note">This bill was ${e(i.status)}. Please contact the pharmacy for details.</p>` : +d.returned > 0 ? `<p class="iv-pub-note">${rs(d.returned)} of this bill was returned — see your credit note from the pharmacy.</p>` : ''}
          <div class="iv-pub-acts">
            <button type="button" class="primary" id="pdf">⬇ Download PDF</button>
            <select id="fmt" aria-label="Format"><option value="a4">A4 page</option><option value="thermal">Receipt (80 mm)</option></select>
            <button type="button" id="prt">Print</button>
            ${tel ? `<a href="tel:${tel}">Call pharmacy</a><a href="https://wa.me/${tel.slice(1)}?text=${encodeURIComponent(`Hello, about my bill ${i.invoice_no}`)}" target="_blank" rel="noopener">WhatsApp pharmacy</a>` : ''}
          </div>
        </section>
        <section class="iv-pub-paper" id="paper">${paperHTML(d, { publicView: true })}</section>
        <footer class="iv-pub-foot">Thank you for choosing ${e(s.name || 'Pallikkal Pharmacy')}. This page is private to you — please do not share the link.</footer>
      </div>`;
      if (innerWidth < 760) document.getElementById('fmt').value = 'thermal';
      const fmt = () => document.getElementById('fmt').value;
      document.getElementById('prt').onclick = () => printInvoice(d, fmt());
      document.getElementById('pdf').onclick = async ev => {
        const b = ev.currentTarget; b.disabled = true; b.textContent = 'Preparing PDF…';
        try { await downloadPDF(d, fmt()); b.textContent = '⬇ Download PDF'; }
        catch { b.textContent = 'Could not create the PDF — use Print → Save as PDF'; }
        finally { b.disabled = false; }
      };
    }
  }
}
