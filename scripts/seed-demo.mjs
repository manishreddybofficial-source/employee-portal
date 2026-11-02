import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { DEMO_MARKER, DEMO_EMPLOYEE_PASSWORD, DEMO_ADMIN_PASSWORD, generateEmployees, dayIn, addDays, zonedInstant, shiftWindow, attendanceFor } from './lib/demo-data.mjs';

const checked = (result, context) => {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
};

async function allUsers(client) {
  const users = [];
  for (let page = 1; ; page++) {
    const data = checked(await client.auth.admin.listUsers({ page, perPage: 500 }), 'List Auth users');
    users.push(...data.users);
    if (data.users.length < 500) return users;
  }
}

async function ensureUser(client, existing, profile, password, resetPasswords) {
  let user = existing.get(profile.email);
  if (user && user.app_metadata?.demo_seed !== DEMO_MARKER) {
    throw new Error(`Refusing to overwrite a non-demo account: ${profile.email}`);
  }
  if (!user) {
    const data = checked(await client.auth.admin.createUser({ email: profile.email, password, email_confirm: true, app_metadata: { demo_seed: DEMO_MARKER }, user_metadata: { full_name: profile.full_name, department: profile.department } }), `Create ${profile.email}`);
    user = data.user;
    if (!user) throw new Error(`Auth did not return ${profile.email}`);
    existing.set(profile.email, user);
  } else if (resetPasswords) {
    checked(await client.auth.admin.updateUserById(user.id, { password, email_confirm: true }), `Reset demo password for ${profile.email}`);
  }
  const row = { id: user.id, ...profile };
  const current = checked(await client.from('profiles').select('*').eq('id', user.id).maybeSingle(), `Read ${profile.employee_id}`);
  if (profile.is_demo && current?.is_demo) return current;
  checked(await client.from('profiles').upsert(row, { onConflict: 'id' }), `Save ${profile.employee_id}`);
  if (profile.is_demo && profile.shift_id) {
    // Only initialize the first assignment. Reruns preserve real transfers.
    const assignments = checked(await client.from('shift_assignments').select('user_id,starts_at,ends_at').eq('user_id', user.id).order('starts_at'), 'Read initial shift assignment');
    if (assignments.length === 1 && assignments[0].ends_at === null) {
      checked(await client.from('shift_assignments').update({ starts_at: `${profile.joining_date}T00:00:00Z` }).eq('user_id', user.id).eq('starts_at', assignments[0].starts_at), 'Backdate initial demo assignment');
    }
  }
  return row;
}

export async function seedAttendance(client, employees, shifts, timeZone, now) {
  const today = dayIn(timeZone, new Date(now));
  const first = addDays(today, -14);
  const existing = new Set();
  // Date-scoped pagination avoids Supabase's 1,000-row response cap.
  for (let offset = 0; ; offset += 500) {
    const rows = checked(await client.from('attendance_events').select('user_id,work_date').in('user_id', employees.map((employee) => employee.id)).gte('work_date', first).lte('work_date', today).order('id').range(offset, offset + 499), 'Read existing attendance');
    rows.forEach((row) => existing.add(`${row.user_id}:${row.work_date}`));
    if (rows.length < 500) break;
  }
  // An authorized "mark absent" correction can intentionally leave zero events.
  // Its immutable audit, including moved original dates, must also prevent reseeding.
  const employeeIds = new Set(employees.map((employee) => employee.id));
  for (let offset = 0; ; offset += 500) {
    const audits = checked(await client.from('audit_logs').select('entity_id,old_values,new_values').eq('entity_type', 'attendance').eq('action', 'attendance.correct').order('id').range(offset, offset + 499), 'Read attendance correction history');
    for (const audit of audits) {
      const [userId, originalDay] = audit.entity_id.split('/');
      if (!employeeIds.has(userId)) continue;
      for (const day of [originalDay, audit.old_values?.work_date, audit.new_values?.work_date]) {
        if (day && day >= first && day <= today) existing.add(`${userId}:${day}`);
      }
    }
    if (audits.length < 500) break;
  }
  let inserted = 0;
  for (let day = first; day <= today; day = addDays(day, 1)) {
    const rows = [];
    for (const employee of employees) {
      // Preserve actual/corrected punches on every rerun, including a partially lived demo day.
      if (existing.has(`${employee.id}:${day}`)) continue;
      const shift = shifts.find((value) => value.id === employee.shift_id);
      if (shift) rows.push(...attendanceFor(employee, day, shift, timeZone, now));
    }
    if (rows.length) checked(await client.from('attendance_events').upsert(rows, { onConflict: 'demo_key', ignoreDuplicates: true }), `Seed attendance ${day}`);
    inserted += rows.length;
  }
  return inserted;
}

async function seedOperations(client, employees, shifts, timeZone, now) {
  const today = dayIn(timeZone, new Date(now));
  const routes = [];
  for (let index = 0; index < 4; index++) {
    const demo_key = `${DEMO_MARKER}:route:${index + 1}`;
    checked(await client.from('patrol_routes').upsert({ name: `DEMO · Zone ${String.fromCharCode(65 + index)} safety sweep`, floor_ids: [index * 2 + 1, index * 2 + 2], demo_key }, { onConflict: 'demo_key', ignoreDuplicates: true }), 'Create demo route');
    routes.push(checked(await client.from('patrol_routes').select('*').eq('demo_key', demo_key).single(), 'Read demo route'));
  }
  const analysts = employees.filter((employee) => employee.role === 'gsoc');
  const controllers = employees.filter((employee) => employee.role === 'controller');
  const officers = employees.filter((employee) => employee.role === 'patrol');
  const incidents = [];
  const categories = ['Access control', 'Fire safety', 'Equipment', 'Suspicious activity', 'Medical assistance', 'Perimeter breach'];
  for (let index = 0; index < 12; index++) {
    const created = Math.min(now - (15 + index * 29) * 60_000, zonedInstant(today, '23:55', timeZone));
    const demo_key = `${DEMO_MARKER}:incident:${today}:${index}`;
    const status = ['Open', 'Pending', 'Resolved', 'Resolved', 'Escalated', 'Resolved'][index % 6];
    checked(await client.from('incidents').upsert({ demo_key, category: categories[index % categories.length], description: `DEMO DATA · ${['Unregistered visitor at reception; identity verification requested.', 'Stairwell door sensor requires inspection.', 'Camera feed interrupted; control room notified.', 'Unattended parcel reported and secured.', 'Employee requested first aid support.', 'Restricted service entrance found unsecured.'][index % 6]}`, reported_by: officers[index % officers.length].id, floor_id: (index % 8) + 1, created_at: new Date(created).toISOString(), severity: ['Low', 'Medium', 'High', 'Critical'][index % 4], controller_id: controllers[index % controllers.length].id, analyst_id: analysts[index % analysts.length].id, status, resolution: status === 'Resolved' ? 'DEMO DATA · Verified by the control room; corrective action recorded.' : '' }, { onConflict: 'demo_key', ignoreDuplicates: true }), 'Create demo incident');
    incidents.push(checked(await client.from('incidents').select('id').eq('demo_key', demo_key).single(), 'Read demo incident'));
  }
  for (let back = 2; back >= 0; back--) {
    const day = addDays(today, -back);
    const rows = [];
    officers.forEach((officer, index) => {
      const shift = shifts.find((value) => value.id === officer.shift_id);
      if (!shift) return;
      const window = shiftWindow(day, shift, timeZone);
      const scheduled = window.start + 90 * 60_000;
      const completed = scheduled + 25 * 60_000;
      let status = scheduled > now ? 'Scheduled' : completed > now ? 'In Progress' : 'Completed';
      if (completed < now && index % 7 === 0) status = 'Missed';
      if (completed < now && index % 11 === 0) status = 'Incident Reported';
      rows.push({ demo_key: `${DEMO_MARKER}:patrol:${officer.employee_id}:${day}`, officer_id: officer.id, shift_id: officer.shift_id, floor_id: officer.floor_id, route_id: routes[Math.floor((officer.floor_id - 1) / 2)].id, scheduled_at: new Date(scheduled).toISOString(), started_at: ['Scheduled', 'Missed'].includes(status) ? null : new Date(scheduled).toISOString(), completed_at: ['Completed', 'Incident Reported'].includes(status) ? new Date(completed).toISOString() : null, status, observations: status === 'Completed' ? 'DEMO DATA · Manual round completed; exits and access points checked.' : status === 'Incident Reported' ? 'DEMO DATA · Observation escalated to GSOC.' : status === 'Missed' ? 'DEMO DATA · Officer reassigned; supervisor review required.' : '', incident_id: status === 'Incident Reported' ? incidents[index % incidents.length].id : null });
    });
    checked(await client.from('patrol_records').upsert(rows, { onConflict: 'demo_key', ignoreDuplicates: true }), 'Create demo patrols');
  }
  const supervisors = employees.filter((employee) => employee.role === 'supervisor');
  for (let index = 0; index < 3; index++) {
    const supervisor = supervisors[index];
    checked(await client.from('handovers').upsert({ demo_key: `${DEMO_MARKER}:handover:${today}:${index}`, outgoing_id: supervisor.id, incoming_id: supervisors[(index + 1) % supervisors.length].id, shift_id: supervisor.shift_id, shift_date: addDays(today, -1), pending_incidents: 'DEMO DATA · Review open GSOC incidents before taking charge.', shortages: index === 1 ? 'DEMO DATA · One relief position awaiting reassignment.' : 'DEMO DATA · No unfilled posts at handover.', observations: 'DEMO DATA · Keys, radio inventory, and access registers checked.', status: index === 2 ? 'Submitted' : 'Acknowledged', created_at: new Date(now - (index + 1) * 8 * 3_600_000).toISOString() }, { onConflict: 'demo_key', ignoreDuplicates: true }), 'Create demo handover');
  }
}

export async function seedDemo(env = process.env, args = process.argv.slice(2)) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the trusted shell. Never use VITE_ for a service key.');
  const origin = new URL(env.SUPABASE_URL);
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Use HTTPS for remote Supabase.');
  const employeePassword = env.DEMO_EMPLOYEE_PASSWORD || DEMO_EMPLOYEE_PASSWORD;
  const adminPassword = env.DEMO_ADMIN_PASSWORD || DEMO_ADMIN_PASSWORD;
  if (employeePassword.length < 12 || adminPassword.length < 12 || employeePassword === adminPassword) throw new Error('Use distinct employee/admin passwords of at least 12 characters.');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const office = checked(await client.from('office_details').select('timezone').eq('id', 1).single(), 'Read office timezone');
  const shifts = checked(await client.from('shifts').select('*').order('id'), 'Read shifts (apply migrations first)');
  if (shifts.length < 3) throw new Error('Apply the security operations migration before seeding.');
  const existing = new Map((await allUsers(client)).map((user) => [user.email?.toLowerCase(), user]));
  const employees = [];
  for (const profile of generateEmployees()) employees.push(await ensureUser(client, existing, profile, employeePassword, args.includes('--reset-passwords')));
  await ensureUser(client, existing, { email: 'admin@example.test', employee_id: 'ADMIN-DEMO', full_name: 'Demo Administrator', department: 'System Administration', role: 'admin', designation: 'Administrator', gender: 'Female', secondary_duty: null, floor_id: null, shift_id: null, employment_status: 'Active', contact_number: 'DEMO-NOT-DIALABLE-ADMIN', joining_date: '2022-01-01', avatar_url: null, is_demo: false }, adminPassword, args.includes('--reset-passwords'));
  const now = Date.now();
  const punches = await seedAttendance(client, employees, shifts, office.timezone, now);
  await seedOperations(client, employees, shifts, office.timezone, now);
  const result = await client.from('profiles').select('id', { count: 'exact', head: true }).eq('is_demo', true);
  checked(result, 'Count demo employees');
  if (result.count !== 100) throw new Error(`Expected exactly 100 demo employees; found ${result.count}. No users were deleted.`);
  console.log(`Seed complete: 100 DEMO employees, separate administrator, ${punches} new attendance punches. Existing attendance and operational edits were preserved.`);
  console.log(`Employees: emp001@example.test through emp100@example.test\nCommon employee password: ${employeePassword}\nAdministrator: admin@example.test\nAdministrator password: ${adminPassword}`);
  if (!args.includes('--reset-passwords')) console.log('Existing demo passwords were preserved. Use --reset-passwords with DEMO_EMPLOYEE_PASSWORD and DEMO_ADMIN_PASSWORD to rotate only generated accounts.');
  return { employees: 100, punches };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedDemo().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
