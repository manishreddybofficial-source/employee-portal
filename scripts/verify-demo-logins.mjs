import { createClient } from '@supabase/supabase-js';
import { DEMO_EMPLOYEE_PASSWORD, DEMO_ADMIN_PASSWORD, generateEmployees } from './lib/demo-data.mjs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to test the seeded Auth accounts.');
  process.exitCode = 1;
} else {
  const credentials = generateEmployees().map((employee) => ({ email: employee.email, password: process.env.DEMO_EMPLOYEE_PASSWORD || DEMO_EMPLOYEE_PASSWORD, role: employee.role }));
  credentials.push({ email: 'admin@example.test', password: process.env.DEMO_ADMIN_PASSWORD || DEMO_ADMIN_PASSWORD, role: 'admin' });
  let passed = 0;
  const failures = [];
  for (const credential of credentials) {
    let success = false;
    for (let attempt = 0; attempt < 16; attempt++) {
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.auth.signInWithPassword({ email: credential.email, password: credential.password });
      if (error?.status === 429 && attempt < 15) {
        console.log(`Auth rate limit reached; waiting 60 seconds (${credential.email}).`);
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        continue;
      }
      if (error || !data.user) failures.push(`${credential.email}: ${error?.message ?? 'No user returned'}`);
      else {
        const profile = await client.from('profiles').select('role').eq('id', data.user.id).single();
        if (profile.error || profile.data.role !== credential.role) failures.push(`${credential.email}: wrong/missing server-side role`);
        else { passed++; success = true; }
        await client.auth.signOut();
      }
      break;
    }
    if (!success && !failures.some((failure) => failure.startsWith(credential.email))) failures.push(`${credential.email}: rate-limit retries exhausted`);
  }
  console.log(`Verified ${passed}/101 demo logins (100 employees and one separate administrator).`);
  failures.forEach((failure) => console.error(failure));
  if (failures.length) process.exitCode = 1;
}
