import { describe, expect, it } from 'vitest';
import { validateEnv } from '../src/config/validate-env';

const config = {
  VITE_SUPABASE_URL: 'https://example.supabase.co/',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_browser_key',
};

describe('browser configuration', () => {
  it('normalizes a valid project origin', () => {
    expect(validateEnv(config).supabaseUrl).toBe('https://example.supabase.co');
  });
  it('rejects missing configuration', () => expect(() => validateEnv({})).toThrow('Configure'));
  it('rejects privileged keys', () => {
    expect(() => validateEnv({ ...config, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private' })).toThrow(
      'publishable key',
    );
  });
  it('rejects insecure remote origins and URLs containing credentials', () => {
    for (const url of [
      'http://example.supabase.co',
      'https://user:pass@example.supabase.co',
      'https://example.supabase.co/path',
    ]) {
      expect(() => validateEnv({ ...config, VITE_SUPABASE_URL: url })).toThrow('origin');
    }
  });
  it('supports the local Supabase stack', () => {
    expect(validateEnv({ ...config, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }).supabaseUrl).toBe(
      'http://127.0.0.1:54321',
    );
  });
});
