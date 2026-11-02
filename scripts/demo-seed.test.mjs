import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEmployees, attendanceFor, shiftWindow, dayIn } from './lib/demo-data.mjs';
import { seedAttendance } from './seed-demo.mjs';

test('100 deterministic fictional identities with separate employee permissions and varied distribution', () => {
  const employees = generateEmployees();
  assert.equal(employees.length, 100);
  assert.deepEqual(employees, generateEmployees());
  assert.equal(new Set(employees.map((employee) => employee.employee_id)).size, 100);
  assert.equal(new Set(employees.map((employee) => employee.email)).size, 100);
  assert.equal(new Set(employees.map((employee) => employee.full_name)).size, 100);
  assert.equal(employees.filter((employee) => employee.gender === 'Female').length, 36);
  assert.equal(employees.filter((employee) => employee.role === 'admin').length, 0);
  assert.equal(employees.filter((employee) => employee.role === 'supervisor').length, 3);
  for (const employee of employees) {
    assert.match(employee.email, /^emp\d{3}@example\.test$/);
    assert.match(employee.contact_number, /^DEMO-NOT-DIALABLE-/);
    assert.equal(employee.is_demo, true);
    assert.ok(employee.floor_id >= 1 && employee.floor_id <= 8);
    assert.ok(employee.shift_id >= 1 && employee.shift_id <= 3);
    assert.ok(!('password' in employee));
  }
});

test('night punches retain the shift start work date across midnight and DST', () => {
  const employee = { ...generateEmployees()[30], id: 'test-user' };
  const shift = { start_time: '22:00:00', end_time: '06:00:00' };
  const window = shiftWindow('2026-11-01', shift, 'America/New_York');
  assert.equal(new Date(window.start).toISOString(), '2026-11-02T03:00:00.000Z');
  assert.equal(new Date(window.end).toISOString(), '2026-11-02T11:00:00.000Z');
  const events = attendanceFor(employee, '2026-11-01', shift, 'America/New_York', window.end + 60_000);
  assert.equal(events.length, 4);
  assert.ok(events.every((event) => event.work_date === '2026-11-01'));
  assert.equal(events.at(-1).event_type, 'time_out');
  assert.equal(dayIn('America/New_York', new Date(events.at(-1).created_at)), '2026-11-02');
});

test('seed never creates future attendance, and planned shifts do not show checked-in staff', () => {
  const shift = { start_time: '06:00:00', end_time: '14:00:00' };
  const now = Date.parse('2026-11-02T13:05:00Z');
  for (const employee of generateEmployees()) {
    const events = attendanceFor({ ...employee, id: employee.employee_id }, '2026-11-02', shift, 'America/New_York', now);
    assert.ok(events.every((event) => Date.parse(event.created_at) <= now));
    assert.deepEqual(attendanceFor(employee, '2026-11-03', shift, 'America/New_York', now), []);
  }
});

test('reruns preserve audited absence/date corrections and do not duplicate seeded history', async () => {
  const punches = [];
  const employee = { ...generateEmployees()[30], id: 'fixture-employee' };
  const audits = [{ entity_id: `${employee.id}/2026-10-31`, old_values: { work_date: '2026-10-31', events: [] }, new_values: { work_date: '2026-11-01', events: [] } }];
  const client = {
    from(table) {
      const query = {
        select() { return this; }, in() { return this; }, gte() { return this; }, lte() { return this; }, eq() { return this; }, order() { return this; },
        range(first, last) { return Promise.resolve({ data: (table === 'audit_logs' ? audits : punches).slice(first, last + 1), error: null }); },
        upsert(rows) {
          for (const row of rows) {
            if (!punches.some((existing) => existing.demo_key === row.demo_key)) punches.push(row);
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return query;
    },
  };
  const shifts = [{ id: employee.shift_id, start_time: '06:00:00', end_time: '14:00:00' }];
  const now = Date.parse('2026-11-02T20:00:00Z');
  await seedAttendance(client, [employee], shifts, 'America/New_York', now);
  assert.ok(punches.length > 0);
  assert.ok(punches.every((row) => !['2026-10-31', '2026-11-01'].includes(row.work_date)));
  const firstCount = punches.length;
  const added = await seedAttendance(client, [employee], shifts, 'America/New_York', now);
  assert.equal(added, 0);
  assert.equal(punches.length, firstCount);
  assert.equal(new Set(punches.map((row) => row.demo_key)).size, firstCount);
});
