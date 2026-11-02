# Employee Portal · Security Operations

The existing Employee Portal extended for an eight-floor security operation. Vite + strict TypeScript, Supabase Auth/Postgres/RLS, and the existing Vercel deployment model are retained. Attendance, breaks, leave requests, office settings, and existing URLs remain available.

The operations workspace adds a shared workforce directory, floor and shift deployment, audited attendance correction, manual patrol rounds, GSOC incidents, supervisor handovers, management analytics, and CSV reports. All operational views read the same database snapshot; no browser-only employee database or simulated live tracking is used.

## Install and configure

Requires Node.js 22.12+ in the 22.x line, 24.x, or another version allowed by `package.json`, npm, and a Supabase project. Docker Desktop is needed only for the optional local backend.

```bash
npm ci
cp .env.example .env.local
```

Set your own browser-visible configuration:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_public_key
```

Builds reject missing configuration, placeholders, and secret/service keys. On Windows with restricted script execution, use `npm.cmd` and `npx.cmd`.

For local Supabase, run `npm run db:start` and `npm run db:status`, then copy the API URL and publishable key into `.env.local`. The first startup applies migrations and basic office settings. `npm run db:reset` destroys and rebuilds the local database; use it only for an intended local reset.

For an existing hosted project, back up its database and apply the additive migrations:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --linked
```

Apply both new migrations in order: `20261102000000_security_operations.sql`, then `20261102010000_operations_workflow_fixes.sql`. They extend existing `profiles` and `attendance_events`, retaining Auth accounts, leave, and office configuration. They create eight editable floors, three eight-hour shifts, assignment history, routes, patrols, incidents, handovers, and immutable audit records. The second migration adds the limited cross-shift supervisor directory, draft handover submission, scoped patrol/team incident reporting, and visibility of older unresolved incidents. Existing installations that already applied the first migration should apply the second; do not edit or replay an applied migration.

## Seed the 100 demo accounts

Run from a trusted shell. The script reads shell variables; it does not automatically load `.env.local`.

```powershell
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
$env:SUPABASE_SERVICE_ROLE_KEY = '<local service_role key from supabase status>'
npm.cmd run seed:demo
```

For a hosted project, use its URL and server-side secret/service-role key. Never prefix this key with `VITE_`, commit it, or place it in the browser. The [Supabase Auth Admin API](https://supabase.com/docs/reference/javascript/auth-admin-createuser) performs secure password hashing; no password column is added to public database tables.

| Account                | Email                                               | Initial demonstration password |
| ---------------------- | --------------------------------------------------- | ------------------------------ |
| 100 employees          | `emp001@example.test` through `emp100@example.test` | `SecurityDemo!2026`            |
| Separate administrator | `admin@example.test`                                | `AdminSecure!2026`             |

The 100 fictional employee profiles have reserved `.test` addresses, non-dialable contact labels, initials avatars, and `is_demo = true`. The administrator has `is_demo = false` and is excluded from employee headcount. Distribution: 36 female and 64 male; permissions depend on role, never gender.

| Role                                 | Example login                                                         |
| ------------------------------------ | --------------------------------------------------------------------- |
| Director                             | `emp001@example.test`                                                 |
| Assistant Security Manager           | `emp002@example.test`                                                 |
| Morning / Evening / Night supervisor | `emp004@example.test` / `emp005@example.test` / `emp006@example.test` |
| GSOC analyst                         | `emp007@example.test`                                                 |
| Controller                           | `emp013@example.test`                                                 |
| Patrolling officer                   | `emp019@example.test`                                                 |
| Security officer                     | `emp031@example.test`                                                 |

Seeding is safe to rerun: identities are deterministic, fixtures have unique demo keys, and existing profile assignments, attendance corrections, and operational edits are preserved. Non-demo accounts with a conflicting email cause a failure instead of being overwritten. No existing users are deleted. Initial assignment history is backdated to cover the seeded attendance history.

The seed creates 14 previous days plus elapsed portions of today's attendance, manual patrols/routes, incidents, and handovers. It reads the configured timezone and shift boundaries and never inserts future attendance. Future patrols remain scheduled. Night attendance retains its shift-start work date.

Replace defaults before use beyond demonstration:

```powershell
$env:DEMO_EMPLOYEE_PASSWORD = '<new demonstration password, 12+ characters>'
$env:DEMO_ADMIN_PASSWORD = '<different administrator password, 12+ characters>'
npm.cmd run seed:demo -- --reset-passwords
```

This rotates only generated accounts. For production, provision individual passwords, deactivate or individually reset demo accounts, and remove public demo credentials from the login page. Keep email confirmation enabled for public production signup; the local configuration disables it only for development.

## Administrator account management

```bash
npx supabase functions deploy manage-employee
```

Locally, use `npx supabase functions serve manage-employee`. The function verifies the bearer identity through Auth and reads the current active administrator role from Postgres before using its service client. `verify_jwt = false` supports modern signing keys; explicit verification still runs with `auth.getUser(token)`. See [Supabase function authentication](https://supabase.com/docs/guides/functions/auth). Caller-supplied roles never authorize the request. Password values are excluded from audit records.

Existing verified administrator invitation onboarding remains available from a trusted SQL session:

```sql
insert into public.admin_invitations (email)
values ('owner@your-company.com') on conflict do nothing;
```

## Run

```bash
npm run dev
```

Open Vite's printed Local URL. Sign in after migration and seeding succeed. Displaying demo credentials does not create a backend or accounts automatically.

## Data and permissions

- Pages handle presentation, `src/api` owns Supabase calls, and pure `src/lib` functions calculate reports.
- `security_snapshot(p_from,p_to)` supplies a shared scoped dataset, with a maximum difference of 366 days between endpoints. `security_mutate(p_action,p_payload)` validates and authorizes writes in Postgres. Unresolved incidents remain visible even when created before the reporting range; incident exports still filter by creation date.
- Employees see their own information, supervisors their shift, controllers their permitted locations, and management their configured organizational scope. Only administrators configure the system, edit sensitive employee fields, and correct attendance.
- Timestamps use `timestamptz`; display uses `office_details.timezone`, initially `America/New_York`. Morning: 06:00–14:00; Evening: 14:00–22:00; Night: 22:00–06:00. Configurable shifts must remain eight hours on the local clock and non-overlapping. Actual elapsed hours can differ on daylight-saving transition nights.
- One current recurring shift per employee is retained in assignment history. Active employees must check out before transfer. Historical deployment reports resolve historical assignments.
- Attendance still uses server-time `record_attendance()`. Manual corrections retain breaks, require reasons, and store original/updated values, actor, and time. Application roles cannot update/delete/truncate audit history.
- Removal uses deactivation to preserve historical references. Patrol start/finish is recorded manually; no GPS or fabricated live location feed is presented.
- A secondary `Patrolling Officer` duty grants access to the employee's own patrol assignments. Supervisors can choose an incoming supervisor from a limited name/ID directory without gaining access to that supervisor's employee records. Draft handovers can be submitted and incoming supervisors can acknowledge receipt.

## Verification

```bash
npm run typecheck
npm test
npm run test:seed
npm run db:test:local
npm run db:test
npm run db:test:security
npm run build
```

`db:test:local` applies every migration to an isolated in-memory PostgreSQL instance through PGlite and runs both SQL suites without requiring Docker or changing the linked project. `db:test` and `db:test:security` run the original and security SQL suites against the linked database and roll fixtures back. They exercise database behavior, not password authentication or Edge Function deployment. See [implementation notes](docs/IMPLEMENTATION.md) for integration checks. To test real Auth logins:

```powershell
$env:SUPABASE_URL = '<project API origin>'
$env:SUPABASE_PUBLISHABLE_KEY = '<project publishable key>'
npm.cmd run verify:demo
```

This verifies all 100 employees plus the separate admin and checks their server-returned roles. It backs off on Auth rate limits and can take several minutes. It never prints access tokens. A running, seeded backend is required; generator/unit tests alone do not prove end-to-end login.

Retained commands include `npm run preview`, `npm run lint`, `npm run format`, `npm run db:stop`, and `npm run verify:release -- <url>`.

## Deploy with the existing Vercel stack

1. Apply migrations and deploy `manage-employee` to the same Supabase project.
2. Configure Supabase Auth's Site URL and exact redirect URLs; enable production email confirmation.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel. Service keys belong only in server function secrets and trusted shells.
4. Verify, then deploy:

```bash
npx vercel link --yes --project employee-portal
npx vercel deploy --prod --yes
npm run verify:release -- https://YOUR_DEPLOYMENT_URL
```

Use the existing `employee-portal` Vercel project and Supabase project when updating the live application. The URL returned by the Vercel deployment is authoritative; no new hosting provider or separate browser data store is required.
