import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readEnv } from '../config/env';

let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const env = readEnv();
    client = createClient(env.supabaseUrl, env.supabasePublishableKey);
  }
  return client;
}

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

/** Returns the data of a Supabase response, or throws its error. */
export function unwrap<T>(result: QueryResult): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

/** Supabase caps a response at 1,000 rows; fetch complete reports in stable pages. */
export async function allRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<QueryResult>,
): Promise<T[]> {
  const size = 500;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const page = unwrap<T[]>(await fetchPage(from, from + size - 1));
    rows.push(...page);
    if (page.length < size) return rows;
  }
}
