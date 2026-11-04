export { esc, inr } from './supabase-client.js';
export const fmtDate = d => new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(d));
export const $ = (s, r = document) => r.querySelector(s);
