import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
const db = new PGlite();
try {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
      raw_user_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz,
      created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
  `);
  for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
    console.log(`Applied ${file}`);
  }
  for (const file of ['tests/database.sql', 'tests/security-database.sql']) {
    await db.exec(await readFile(file, 'utf8'));
    console.log(`Passed ${file}`);
  }
  console.log('PostgreSQL migration and authorization checks passed (PGlite).');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
