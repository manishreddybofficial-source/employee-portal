import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { loadEnv } from 'vite';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:4173');
const config = loadEnv('production', process.cwd(), 'VITE_');
const routes = new Map([
  ['/', 'Login'],
  ['/employee', 'Dashboard'],
  ['/attendance', 'My Attendance'],
  ['/leave-request', 'Apply Leave'],
  ['/office-details', 'Office Details'],
  ['/admin', 'Admin Panel'],
]);
for (const [route, title] of routes) {
  const response = await fetch(new URL(route, origin));
  assert.equal(response.status, 200, `Page failed: ${route}`);
  const html = await response.text();
  assert.ok(html.includes(`<title>${title} - Employee Portal</title>`), `Wrong page: ${route}`);
  assert.ok(/<script[^>]+type="module"/.test(html), `Missing application script: ${route}`);
  if (origin.protocol === 'https:') {
    assert.equal(
      response.headers.get('x-content-type-options'),
      'nosniff',
      `Security header missing: ${route}`,
    );
  }
  console.log(`PASS page ${route}`);
}
for (const name of await readdir('dist/assets')) {
  const source = await readFile(`dist/assets/${name}`, 'utf8');
  assert.ok(
    !/sb_secret_[A-Za-z0-9_-]{20,}|sb_publishable_replace_me/.test(source),
    `Unsafe browser asset: ${name}`,
  );
  for (const token of source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    assert.notEqual(payload.role, 'service_role', `Privileged JWT in browser asset: ${name}`);
  }
  const response = await fetch(new URL(`/assets/${name}`, origin));
  assert.equal(response.status, 200, `Asset unavailable: ${name}`);
  assert.equal(await response.text(), source, `Deployed asset differs from this release: ${name}`);
}
console.log('PASS all production assets match the verified build and contain no secret keys');

assert.ok(
  config.VITE_SUPABASE_URL && config.VITE_SUPABASE_PUBLISHABLE_KEY,
  'Supabase configuration is required',
);
const headers = { apikey: config.VITE_SUPABASE_PUBLISHABLE_KEY };
const settingsResponse = await fetch(`${config.VITE_SUPABASE_URL}/auth/v1/settings`, { headers });
assert.equal(settingsResponse.status, 200, 'Supabase Auth is unavailable or the publishable key is invalid');
const settings = await settingsResponse.json();
assert.equal(settings.disable_signup, false, 'Employee registration is disabled');
assert.equal(
  settings.mailer_autoconfirm,
  false,
  'Email verification must be enabled for invited administrators',
);
for (const table of ['profiles', 'office_details', 'attendance_events', 'leave_requests']) {
  const response = await fetch(`${config.VITE_SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, { headers });
  assert.equal(response.status, 200, `Database table unavailable: ${table}`);
  assert.deepEqual(await response.json(), [], `Anonymous access exposes ${table}`);
}
console.log('PASS Supabase Auth, verified-email registration, and anonymous data isolation');
