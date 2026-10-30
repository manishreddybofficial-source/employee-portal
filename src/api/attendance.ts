import { allRows, getSupabase, unwrap } from '../lib/supabase';
import type { AttendanceEvent, EventType } from '../types/models';

export async function latestForUser(userId: string): Promise<AttendanceEvent | null> {
  return unwrap<AttendanceEvent | null>(
    await getSupabase()
      .from('attendance_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
}

/** One user's events between two work dates (inclusive), oldest first. */
export async function listForUser(
  userId: string,
  from: string,
  to: string = from,
): Promise<AttendanceEvent[]> {
  return allRows<AttendanceEvent>((first, last) =>
    getSupabase()
      .from('attendance_events')
      .select('*')
      .eq('user_id', userId)
      .gte('work_date', from)
      .lte('work_date', to)
      .order('created_at')
      .order('id')
      .range(first, last),
  );
}

/** Everyone's events from a work date onwards. Row-level security limits this to admins. */
export async function listSince(fromDate: string): Promise<AttendanceEvent[]> {
  return allRows<AttendanceEvent>((first, last) =>
    getSupabase()
      .from('attendance_events')
      .select('*')
      .gte('work_date', fromDate)
      .order('created_at')
      .order('id')
      .range(first, last),
  );
}

/** Records a punch. The database stamps the time and validates the sequence. */
export async function record(action: EventType): Promise<void> {
  unwrap(await getSupabase().rpc('record_attendance', { p_event: action }));
}
