
import { sb } from './supabase-client.js';

export const signIn = async (email, password) => {
  const result = await sb.auth.signInWithPassword({ email, password });

  if (result.error) return result;

  const { data: sessionStarted, error: sessionError } = await sb.rpc('start_work_session');

  if (sessionError || sessionStarted !== true) {
    await sb.auth.signOut();
    return { data: result.data, error: sessionError };
  }

  return result;
};

export const signOut = async () => {
  await sb.rpc('end_work_session', { p_reason: 'manual' });
  await sb.auth.signOut();
  location.href = 'index.html';
};

export const resetPassword = email =>
  sb.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname.replace(/[^/]*$/, 'reset-password.html')
  });
