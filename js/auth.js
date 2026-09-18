import { sb } from './supabaseClient.js';

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  return sb.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return sb.auth.signOut();
}