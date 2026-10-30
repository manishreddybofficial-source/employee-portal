import { allRows, getSupabase, unwrap } from '../lib/supabase';
import type { LeaveRequest, LeaveStatus } from '../types/models';

const WITH_EMPLOYEE = '*, employee:profiles!leave_requests_user_id_fkey(full_name, email)';

export interface NewLeaveRequest {
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
}

export async function listForUser(userId: string): Promise<LeaveRequest[]> {
  return allRows<LeaveRequest>((first, last) =>
    getSupabase()
      .from('leave_requests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(first, last),
  );
}

export async function listAll(status?: LeaveStatus): Promise<LeaveRequest[]> {
  return allRows<LeaveRequest>((first, last) => {
    let query = getSupabase()
      .from('leave_requests')
      .select(WITH_EMPLOYEE)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (status) query = query.eq('status', status);
    return query.range(first, last);
  });
}

export async function pendingCount(): Promise<number> {
  const { count, error } = await getSupabase()
    .from('leave_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function create(request: NewLeaveRequest): Promise<void> {
  unwrap(await getSupabase().from('leave_requests').insert(request));
}

export async function cancel(id: number): Promise<void> {
  unwrap(
    await getSupabase()
      .from('leave_requests')
      .delete()
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .single(),
  );
}

export async function review(
  id: number,
  status: Exclude<LeaveStatus, 'pending'>,
  reviewerId: string,
  note: string | null,
): Promise<void> {
  unwrap(
    await getSupabase()
      .from('leave_requests')
      .update({ status, admin_note: note, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .single(),
  );
}
