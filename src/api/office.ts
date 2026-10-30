import { getSupabase, unwrap } from '../lib/supabase';
import type { OfficeDetails, OfficeUpdate } from '../types/models';

export async function get(): Promise<OfficeDetails> {
  return unwrap<OfficeDetails>(await getSupabase().from('office_details').select('*').eq('id', 1).single());
}

export async function update(patch: OfficeUpdate): Promise<void> {
  unwrap(
    await getSupabase()
      .from('office_details')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', 1),
  );
}
