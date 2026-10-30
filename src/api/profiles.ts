import { allRows, getSupabase, unwrap } from '../lib/supabase';
import type { Profile, Role } from '../types/models';

export interface ProfileUpdate {
  full_name: string;
  department: string;
  role?: Role;
}

export async function getById(id: string): Promise<Profile | null> {
  return unwrap<Profile | null>(await getSupabase().from('profiles').select('*').eq('id', id).maybeSingle());
}

export async function list(): Promise<Profile[]> {
  return allRows<Profile>((first, last) =>
    getSupabase().from('profiles').select('*').order('full_name').order('id').range(first, last),
  );
}

export async function update(id: string, patch: ProfileUpdate): Promise<void> {
  unwrap(await getSupabase().from('profiles').update(patch).eq('id', id));
}
