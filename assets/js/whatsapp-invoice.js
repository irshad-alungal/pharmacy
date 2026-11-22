// Send a bill's invoice on WhatsApp (free, one tap). Used by Billing (automatically after a bill)
// and by the invoice dialog ("Send on WhatsApp"). The message and its private invoice link come
// from whatsapp_queue_invoice (0030); WhatsApp opens with the text filled in and staff press Send.
let settingsP = null;
const missing = e => /whatsapp_|function|schema cache|does not exist|Could not find/i.test(e?.message || '');
export const waSettings = sb => (settingsP ||= sb.rpc('whatsapp_settings_get').then(r => (r.error ? null : r.data), () => null));
const R = n => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+n || 0);
const waNo = v => { let d = String(v || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; else if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1); return d.length >= 10 ? d : ''; };

export async function prepareInvoice(sb, invoiceId) {
  const { data, error } = await sb.rpc('whatsapp_queue_invoice', { p_invoice: invoiceId, p_base_url: location.href });
  if (error) throw error;
  return data;
}
// Opens WhatsApp in a new tab/app. Returns false when the browser blocked the pop-up.
export function openWhatsApp(sb, msg) {
  const w = window.open(`https://wa.me/${waNo(msg.phone)}?text=${encodeURIComponent(msg.body)}`, '_blank');
  if (!w) return false;
  try { w.opener = null; } catch { /* cross-origin */ }
  if (msg.id && msg.status !== 'sent') sb.rpc('whatsapp_mark', { p_ids: [msg.id], p_status: 'sent', p_note: null }).then(() => {}, () => {});
  return true;
}
// Button handler for the invoice dialog. d = invoice_detail() data (used only when 0030 is not installed).
export async function sendInvoice(sb, invoiceId, d, say = () => {}) {
  try {
    const j = await prepareInvoice(sb, invoiceId);
    if (j.status === 'no_phone') return say('This bill has no customer or patient phone number.');
    say(openWhatsApp(sb, j) ? 'WhatsApp opened — press Send there.' : 'Your browser blocked WhatsApp — allow pop-ups for this site and tap again.');
  } catch (e) {
    if (!missing(e) || !d) return say(e.message || 'Could not prepare the WhatsApp message.');
    const phone = d.customer?.phone || d.invoice?.patient_phone;
    if (!waNo(phone)) return say('This bill has no customer or patient phone number.');
    const body = `Hello ${String(d.customer?.name || d.invoice?.patient_name || '').split(' ')[0] || 'there'}, thank you for choosing ${d.shop?.name || 'our pharmacy'}. Your bill ${d.invoice.invoice_no} for ₹${R(d.invoice.total)} is ready.`;
    say(openWhatsApp(sb, { phone, body }) ? 'WhatsApp opened — press Send there.' : 'Your browser blocked WhatsApp — allow pop-ups for this site.');
  }
}
// Right after a bill: prepare the message; open WhatsApp at once when the setting says so.
// Returns a short note for the billing screen ('' when nothing to do).
export async function afterBill(sb, invoiceId) {
  const s = await waSettings(sb);
  if (!s?.auto_invoice) return '';
  let j;
  try { j = await prepareInvoice(sb, invoiceId); } catch { return ''; }
  if (!j || j.status === 'no_phone') return '';
  if (j.status === 'queued' && s.open_after_bill && openWhatsApp(sb, j)) return ' Invoice opened in WhatsApp — press Send.';
  return ' Invoice ready to send — tap "Send on WhatsApp".';
}
