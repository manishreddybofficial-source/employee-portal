export interface PublicEnv {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

/** Validate browser configuration before building or opening an API connection. */
export function validateEnv(values: Record<string, unknown>): PublicEnv {
  const url = String(values.VITE_SUPABASE_URL ?? '').trim();
  const key = String(values.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (!url || !key) {
    throw new Error(
      'Configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before starting the portal.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid Supabase project URL.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (
    (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !['', '/'].includes(parsed.pathname)
  ) {
    throw new Error('Use an HTTPS Supabase project origin (HTTP is allowed only for local development).');
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) || key.includes('replace_me')) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key. Never put a secret or service-role key in browser configuration.',
    );
  }
  return { supabaseUrl: parsed.origin, supabasePublishableKey: key };
}
