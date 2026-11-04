import { requireProfile, esc } from './supabase-client.js';
import { can } from './permissions.js';
import { signOut } from './auth.js';
const PAGES = [['dashboard','Dashboard'],['billing','Billing'],['medicines','Medicines'],['inventory','Inventory'],['purchases','Purchases'],
 ['distributors','Distributors'],['customers','Customers'],['sales','Sales'],['returns','Returns'],['expenses','Expenses'],['finance','Finance'],
 ['reports','Reports'],['whatsapp','WhatsApp'],['staff','Staff'],['documents','Documents'],['settings','Settings'],['audit-logs','Audit logs']];
export async function mountShell(page, title) {
  const prof = await requireProfile(); if (!prof) throw new Error('no session');
  const links = PAGES.filter(([p]) => can(prof.role, p)).map(([p, l]) => `<a href="${p}.html" class="${p===page?'on':''}">${l}</a>`).join('');
  document.title = `ALZA PHARMACY — ${title}`;
  document.body.innerHTML = `<div class="shell"><nav class="side"><h1>ALZA PHARMACY</h1>${links}<a href="#" id="so">Sign out (${esc(prof.staff_id)})</a></nav>
  <main class="main"><h2>${esc(title)}</h2><div id="view"></div></main></div>`;
  document.getElementById('so').onclick = e => { e.preventDefault(); signOut(); };
  if (!can(prof.role, page)) { document.getElementById('view').innerHTML = '<p>You do not have access to this page.</p>'; throw new Error('forbidden'); }
  return prof;
}
