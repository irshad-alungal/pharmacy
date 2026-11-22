// Shared behaviour for the sign-in pages: show / hide password, Caps Lock hint, busy button,
// status messages, "Forgot password?" help, and a safe return address after login.
import { can } from './permissions.js';

export const $ = id => document.getElementById(id);

export function wirePasswords(root = document) {
  for (const btn of root.querySelectorAll('.au-eye')) {
    const input = btn.parentElement.querySelector('input');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', String(show));
      btn.innerHTML = show ? EYE_OPEN : EYE_OFF;
      input.focus();
    });
  }
  for (const input of root.querySelectorAll('input[type="password"]')) {
    const caps = input.closest('.au-field')?.querySelector('.au-caps');
    if (!caps) continue;
    const check = e => { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); };
    input.addEventListener('keydown', check); input.addEventListener('keyup', check);
    input.addEventListener('blur', () => { caps.hidden = true; });
  }
  for (const input of root.querySelectorAll('.au-input input')) input.addEventListener('input', () => input.closest('.au-input').classList.remove('bad'));
}
export const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
export const EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';

export function say(el, text, kind = 'info') { el.className = `au-msg ${text ? kind : ''}`; el.textContent = text || ''; }
export function busy(btn, on, label) {
  if (!btn.dataset.html) btn.dataset.html = btn.innerHTML;
  btn.disabled = on;
  btn.innerHTML = on ? `<span class="au-spin" aria-hidden="true"></span><span>${label || 'Please wait…'}</span>` : btn.dataset.html;
}
export function markBad(...inputs) { for (const i of inputs) i?.closest('.au-input')?.classList.add('bad'); inputs[0]?.focus(); }

// Return address from ?next= — only a page of this site that the role may open.
export function nextPage(role, fallback) {
  const n = new URLSearchParams(location.search).get('next') || '';
  const m = /^([a-z-]+)\.html(\?[^#]*)?$/.exec(n);
  if (!m || ['admin-login', 'staff-login', 'delivery-boy-login', 'change-password', 'index'].includes(m[1])) return fallback;
  return can(role, m[1]) ? n : fallback;
}

export function dialog(html) {
  let d = document.getElementById('auDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'auDlg'; d.className = 'au-dlg'; document.body.appendChild(d); d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); }); }
  d.innerHTML = html; d.showModal(); return d;
}

// Staff and delivery logins are Staff IDs (no email of their own): an administrator resets them.
export function staffForgot(kind = 'staff') {
  dialog(`<h3>Forgot your password?</h3>
    <p>${kind === 'delivery' ? 'Delivery' : 'Staff'} passwords are reset by the pharmacy administrator.</p>
    <ol><li>Ask your Admin to open <b>Staff</b>, choose your name and tap <b>Reset password</b>.</li>
      <li>Sign in here with the temporary password they give you.</li>
      <li>You will be asked to set your own new password straight away.</li></ol>
    <button type="button" class="au-btn" data-close>OK</button>`);
}
