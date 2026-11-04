import { sb } from './supabase-client.js';
export const signIn = (email, password) => sb.auth.signInWithPassword({ email, password });
export const signOut = async () => { await sb.auth.signOut(); location.href = 'index.html'; };
export const resetPassword = email => sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/index.html' });
