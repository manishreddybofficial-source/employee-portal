import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const roles = ['employee', 'admin', 'director', 'asm', 'supervisor', 'gsoc', 'controller', 'security', 'patrol'];
const optionalId = (value: unknown): number | null => {
  if (value === null || value === '' || value === undefined) return null;
  if (!Number.isInteger(Number(value)) || Number(value) < 1) throw new Error('Floor and shift IDs must be positive integers.');
  return Number(value);
};

// Supabase authenticates the bearer JWT against Auth before any service-role use.
// No role/user ID supplied in the request is accepted as the caller's identity.
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return json({ error: 'Sign in to continue.' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Employee account service is not configured.' }, 503);
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: identityError } = await client.auth.getUser(token);
  if (identityError || !identity.user) return json({ error: 'Your session is invalid or expired.' }, 401);
  const { data: actor, error: actorError } = await client.from('profiles').select('id,role,employment_status').eq('id', identity.user.id).single();
  if (actorError || !actor || actor.role !== 'admin' || actor.employment_status !== 'Active') return json({ error: 'Administrator access is required.' }, 403);
  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 16_384) return json({ error: 'Request is too large.' }, 413);
    input = JSON.parse(raw);
    if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error();
  } catch {
    return json({ error: 'Provide a valid JSON object.' }, 400);
  }
  const audit = async (action: string, entityId: string, values: Record<string, unknown>) => {
    const { error } = await client.from('audit_logs').insert({ actor_id: actor.id, entity_type: 'employee', entity_id: entityId, action, old_values: null, new_values: values, reason: 'Administrator account management' });
    if (error) throw new Error('The account audit could not be recorded. Try again.');
  };
  try {
    const password = typeof input.password === 'string' ? input.password : '';
    if (password.length < 12 || password.length > 128) return json({ error: 'Use a password between 12 and 128 characters.' }, 400);
    if (input.action === 'reset-password') {
      const id = String(input.id ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'A valid employee account ID is required.' }, 400);
      const { data: employee, error } = await client.from('profiles').select('id,email').eq('id', id).single();
      if (error || !employee) return json({ error: 'Employee not found.' }, 404);
      await audit('employee.password_reset_requested', id, { email: employee.email });
      const reset = await client.auth.admin.updateUserById(id, { password });
      if (reset.error) throw new Error(reset.error.message);
      await audit('employee.password_reset', id, { email: employee.email });
      return json({ id, email: employee.email });
    }
    if (input.action !== 'create') return json({ error: 'Unknown account action.' }, 400);
    const email = String(input.email ?? '').trim().toLowerCase();
    const name = String(input.full_name ?? '').trim();
    const employeeId = String(input.employee_id ?? '').trim();
    const role = String(input.role ?? 'security');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'Enter a valid employee email.' }, 400);
    if (name.length < 2 || name.length > 100 || !employeeId || employeeId.length > 40) return json({ error: 'Enter a full name and a unique employee ID (maximum 40 characters).' }, 400);
    if (!roles.includes(role)) return json({ error: 'Unknown employee role.' }, 400);
    if (!['Male', 'Female'].includes(String(input.gender))) return json({ error: 'Choose a supported gender label.' }, 400);
    const floorId = optionalId(input.floor_id);
    const shiftId = optionalId(input.shift_id);
    const [floor, shift, duplicate] = await Promise.all([
      floorId === null ? Promise.resolve({ data: true, error: null }) : client.from('floors').select('id').eq('id', floorId).maybeSingle(),
      shiftId === null ? Promise.resolve({ data: true, error: null }) : client.from('shifts').select('id').eq('id', shiftId).maybeSingle(),
      client.from('profiles').select('id').eq('employee_id', employeeId).maybeSingle(),
    ]);
    if (floor.error || shift.error || duplicate.error) throw new Error('Employee validation failed. Try again.');
    if (!floor.data || !shift.data) return json({ error: 'Select an existing floor and shift.' }, 400);
    if (duplicate.data) return json({ error: 'That employee ID is already in use.' }, 409);
    const employmentStatus = String(input.employment_status ?? 'Active');
    if (!['Active', 'Inactive'].includes(employmentStatus)) return json({ error: 'Unknown employment status.' }, 400);
    const joiningDate = String(input.joining_date ?? new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate) || !Number.isFinite(Date.parse(`${joiningDate}T00:00:00Z`))) return json({ error: 'Enter a valid joining date.' }, 400);
    await audit('employee.create_requested', email, { employee_id: employeeId, email, role });
    const created = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name, department: String(input.department ?? '') } });
    if (created.error || !created.data.user) return json({ error: created.error?.message ?? 'Account creation failed.' }, 400);
    const id = created.data.user.id;
    const patch = {
      id, full_name: name, email, employee_id: employeeId,
      department: String(input.department ?? '').slice(0, 100),
      role, gender: String(input.gender), designation: String(input.designation ?? 'Security Officer').slice(0, 100),
      secondary_duty: input.secondary_duty ? String(input.secondary_duty).slice(0, 100) : null,
      floor_id: floorId, shift_id: shiftId, employment_status: employmentStatus,
      contact_number: String(input.contact_number ?? '').slice(0, 100), joining_date: joiningDate,
      avatar_url: null, is_demo: false,
    };
    const saved = await client.from('profiles').update(patch).eq('id', id);
    if (saved.error) {
      // Compensate only for the account created by this exact request.
      await client.auth.admin.deleteUser(id);
      await audit('employee.create_failed', id, { email, employee_id: employeeId });
      return json({ error: 'Employee details could not be saved. No employee was created; check the supplied fields.' }, 400);
    }
    await audit('employee.create', id, { email, employee_id: employeeId, role });
    return json({ id, email }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Account service failed.' }, 400);
  }
});
