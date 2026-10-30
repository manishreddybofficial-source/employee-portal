import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  department: string;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email: string, password: string): Promise<User> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('Sign-in failed. Try again.');
  return data.user;
}

/** Returns the new session, or null when the account must be confirmed by email first. */
export async function signUp(input: SignUpInput): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: location.origin,
      data: { full_name: input.fullName, department: input.department },
    },
  });
  if (error) throw error;
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}
