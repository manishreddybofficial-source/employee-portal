# Implementation and verification notes

## Shared enterprise UI update

The operations, management, GSOC, supervisor, patrol, deployment, reporting, employee, attendance, leave, office, and administration views now share a restrained navy/slate design system. The update standardizes typography, spacing, cards, tables, forms, status labels, action icons, headers, and footers. Navigation is grouped by purpose and filtered by the existing role permissions. The mobile drawer, Escape handling, skip link, and hidden-navigation focus behavior apply to the original employee pages as well as the operations workspace.

UI validation: TypeScript, ESLint, production build, and all 38 existing tests passed. Final visual browser QA was limited because the Windows computer-use tool stopped when it could not confidently determine the active browser URL. No database migration or permission expansion was needed for this styling update.

## Repository audit

The existing repository was Vite + strict TypeScript with multiple HTML entry points, no frontend framework, Supabase Auth/Postgres/RLS, Vitest, and static Vercel deployment. Its employee attendance/breaks, monthly attendance, leave applications/review, employee editing, and office settings remain canonical.

Missing capabilities were security-specific roles, floor/shift assignment, 100 seeded Auth accounts, audited attendance correction, patrol/incident/handover entities, and management deployment/reports. The extension uses Postgres functions and a Supabase Edge Function, preserving the existing architecture.

## Implementation sequence

1. Add the schema migration, server permissions, immutable audit, and overnight attendance rules.
2. Add deterministic Auth seeding and administrator-only account provisioning/reset.
3. Add typed shared operations API and pure deployment/report calculations.
4. Connect operational views, forms, filters, exports, and role navigation.
5. Check type safety, calculations, seeds, migration behavior, and running UI where infrastructure permits.

## Main new and modified files

| File/group                                                                                          | Purpose                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/migrations/20261102000000_security_operations.sql`                                        | Schema, roles/RLS, read/write RPCs, immutable audit, overnight attendance, assignment history                                        |
| `supabase/migrations/20261102010000_operations_workflow_fixes.sql`                                  | Additive cross-shift handover directory, draft submission, scoped incident reporting, and older unresolved incident visibility       |
| `supabase/functions/manage-employee/index.ts`                                                       | Verified administrator account creation and password reset                                                                           |
| `supabase/config.toml`                                                                              | Local function configuration; token verification is inside the handler                                                               |
| `scripts/seed-demo.mjs`, `scripts/lib/demo-data.mjs`                                                | Safe account seeding and deterministic timezone-aware fixtures                                                                       |
| `scripts/demo-seed.test.mjs`                                                                        | Identity/distribution, overnight/DST, and future-punch checks                                                                        |
| `scripts/verify-demo-logins.mjs`                                                                    | Optional real Auth verification of all 101 accounts                                                                                  |
| `scripts/test-database.mjs`                                                                         | Isolated PGlite migration and SQL authorization checks without a running Supabase service                                            |
| `src/types/operations.ts`, `src/types/models.ts`                                                    | Shared entities and expanded roles                                                                                                   |
| `src/api/operations.ts`, `src/lib/operations.ts`                                                    | Shared API boundary, permissions, calculations, and reports                                                                          |
| `operations.html`, `src/pages/operations.ts`, `src/styles/operations.css`                           | Integrated responsive security workspace, operational forms, filters, report previews and exports                                    |
| `index.html`, `src/pages/login.ts`, `src/styles/login.css`                                          | Login and explicit demonstration access details                                                                                      |
| `src/layout/shell.ts`, `src/config/app.ts`                                                          | Consistent navigation, role and secondary-duty access, responsive application configuration                                          |
| `employee.html`, `src/pages/dashboard.ts`, `src/pages/attendance.ts`                                | Retained employee workflows enriched with profile/assignment data, shift-aware lateness, overnight work dates and assignment history |
| `admin.html`, `attendance.html`, `leave-request.html`, `office-details.html`, `src/styles/main.css` | Retained routes with shared responsive styling and employee profile presentation                                                     |
| `tests/operations.test.ts`, `tests/security-database.sql`                                           | Calculation, historical reporting, workflow and backend permission verification                                                      |
| `vite.config.ts`, `scripts/verify-release.mjs`                                                      | New operations build entry point and release checks for the retained deployment                                                      |
| `.env.example`, `package.json`, `package-lock.json`, `README.md`, this document                     | Installation, dependencies, commands, environment, and deployment instructions                                                       |

Use `git status --short` or `git diff --stat` for the exact final change list. Dependencies, local environment files, and build output are ignored.

## Functional verification

Use the actual package scripts:

```bash
npm ci
npm run typecheck
npm test
npm run test:seed
npm run db:test:local
npm run db:test
npm run db:test:security
npm run build
```

The in-memory database command applies all five repository migrations in order and runs `tests/database.sql` followed by `tests/security-database.sql`. It stubs the small Auth schema surface needed by the SQL tests; it does not run the Supabase Auth HTTP service or Edge Functions. The two linked database commands check the real project's PostgreSQL/RLS behavior and roll their test fixtures back.

Verification on November 2, 2026: TypeScript, ESLint, all 38 Vitest tests, all four seed tests, production build, and isolated PostgreSQL migration/authorization checks passed. The existing Supabase project received both additive migrations and the deployed `manage-employee` function. The security SQL suite passed remotely after the final workflow migration. Initial live provisioning created exactly 100 fictional demo employees and a separate demonstration administrator while preserving the existing administrator, with 5,326 attendance fixture events. Repeating the seed created zero additional attendance events and retained exactly 100 demo employees. All 101 demo accounts (100 employees and the separate administrator) passed actual Supabase password authentication and server-role verification.

The update was deployed to the existing Vercel project at https://employee-portal-six-jet.vercel.app. Release verification passed for all seven HTML routes, matching deployed assets, absence of privileged secrets in browser assets, Supabase Auth availability, verified-email registration, and anonymous isolation of original and new data tables. The original linked database regression suite also passed after the final migration. The login and personal employee workspace were inspected in the browser; database and API checks provide the detailed authorization verification.

Run database tests on a disposable local/linked Supabase environment. Original tests retain registration, attendance sequence, leave validation, anonymous isolation, and admin checks; new security checks exercise added RLS and mutations. Fixture tests roll back. Real password authentication requires `npm run verify:demo` against the seeded Auth service; SQL fixture users do not prove password login.

- Seed twice: exactly 100 demo employees plus separate admin; no duplicate identity or fixture rows.
- Use every example role to check personal, shift, floor, GSOC, and management scope. Attempt direct unauthorized RPC/table access as an ordinary employee.
- Check in/break/out; reject double punches and invalid sequences. Check overnight sessions on both sides of midnight.
- Correct attendance with a reason and inspect immutable before/after audit, actor, and time. Reject future, overlapping, and invalid chronological timestamps.
- Transfer a checked-out employee and compare historical/current assignments and staffing totals. Reject transfer during an active session.
- Edit floor thresholds and shift windows; reject overlaps and durations other than eight hours.
- Schedule/start/finish a manual patrol and link an incident. Check actual stored server times.
- Report, assign, escalate, and resolve incidents with remarks. Reject assignment to invalid roles.
- Submit a handover and acknowledge as incoming supervisor.
- Save a draft handover and submit it later; choose an incoming supervisor on another shift through the limited recipient directory. Confirm this does not expand ordinary team profile access.
- Report an incident on the officer's active patrol floor or a supervisor's staffed team floor, and confirm unrelated locations remain forbidden. Confirm unresolved incidents remain visible outside their creation-date report range.
- Compare filtered reports/CSV to the shared database; check desktop/mobile, keyboard forms, empty/errors, and all retained leave/office/attendance routes.

Before release, run real account verification from a trusted shell with `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` set:

```bash
npm run verify:demo
npm run verify:release -- https://YOUR_DEPLOYMENT_URL
```

`verify:demo` signs into 100 employee accounts and the separate demo administrator, checks the server-returned role, and signs out. Auth rate limits can make this run substantially longer than unit/database tests. It does not print access tokens. Generator tests or SQL fixtures alone are not substitutes for this check.

## Applying an update to the existing deployment

Retain the same Vercel and Supabase projects. Apply the migrations through `npx supabase db push --linked` and deploy `manage-employee` through `npx supabase functions deploy manage-employee` before publishing the frontend. The second workflow migration is intentionally additive because the first security migration may already have been applied. The application consumes the additional recipient-directory data without exposing other supervisors' personal records.

Set the existing Vercel project's two public `VITE_SUPABASE_*` values, build and test, then deploy using `npx vercel deploy --prod --yes`. Read the returned deployment URL and run `verify:release` against that URL. Keep service credentials in trusted shells or server configuration. This extension retains the original hosting stack.

## Operational boundaries

The backend requires a Supabase project, applied migrations, optional demo seeding, and deployed account-management function. No service key is embedded in source. CSV is the spreadsheet export supported by this stack and can be opened in Excel; native `.xlsx` export is not implemented. Employee CSV import updates existing accounts by employee ID; the Add employee form provisions new Auth accounts. Patrol verification uses manual server-stamped start/completion actions; GPS and QR verification are not implemented. Assignment history represents one recurring shift per employee, rather than a multi-week roster engine. Floor staffing requirements and shift timing configuration represent the current configuration; timestamped employee transfers are retained for historical assignment reports.

Database owners/service-role operators remain trusted and can alter schema. Browser administrators cannot erase audit records through application permissions. Infrastructure backups and external audit retention remain deployment responsibilities.
