import { esc } from './supabase-client.js';
export const nul = v => (v === '' || v === undefined ? null : v);
export const friendly = e => e?.code === '23505' ? 'That value already exists (duplicate).' : (e?.message || 'Error');
export const opts = (rows, sel) => '<option value="">—</option>' + rows.map(r => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
export const safeQ = s => s.replace(/[%,()*\\]/g, '').trim();
