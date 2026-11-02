import { getSupabase, unwrap } from '../lib/supabase';
import type { Employee, MutationAction, OperationsSnapshot } from '../types/operations';

/** Roles and row scopes are checked in Postgres, including direct API calls. */
export async function snapshot(from: string, to: string = from): Promise<OperationsSnapshot> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error('Select a valid date range.');
  }
  return unwrap<OperationsSnapshot>(await getSupabase().rpc('security_snapshot', { p_from: from, p_to: to }));
}

export async function mutate(action: MutationAction, payload: Record<string, unknown>): Promise<unknown> {
  return unwrap(await getSupabase().rpc('security_mutate', { p_action: action, p_payload: payload }));
}

export type CreateEmployeeInput = Omit<Employee, 'id' | 'created_at' | 'is_demo'> & {
  email: string;
  password: string;
};
interface ManagedEmployeeResult {
  id: string;
  email: string;
}

async function manageEmployee(body: Record<string, unknown>): Promise<ManagedEmployeeResult> {
  const result = await getSupabase().functions.invoke('manage-employee', { body });
  if (result.error) {
    const response = result.error.context;
    if (response instanceof Response) {
      const payload: unknown = await response.json().catch(() => null);
      if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
        throw new Error(payload.error);
      }
    }
    throw result.error;
  }
  return result.data as ManagedEmployeeResult;
}

/** Requires the caller's verified administrator JWT; the service credential stays in the Edge Function. */
export async function createEmployee(input: CreateEmployeeInput): Promise<ManagedEmployeeResult> {
  return manageEmployee({ action: 'create', ...input });
}

export async function resetPassword(id: string, password: string): Promise<ManagedEmployeeResult> {
  return manageEmployee({ action: 'reset-password', id, password });
}
