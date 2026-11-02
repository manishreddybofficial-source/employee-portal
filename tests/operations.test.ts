import { describe, expect, it } from 'vitest';
import {
  allowedPages,
  canAccess,
  deployment,
  employeeDay,
  employeeForDate,
  localToIso,
  mergeSnapshots,
  reportRows,
  shiftAt,
  shiftBounds,
  shiftWorkDate,
  toLocalInput,
  workforce,
  zonedTimestamp,
} from '../src/lib/operations';
import type { AttendanceEvent, EventType } from '../src/types/models';
import type { Employee, OperationsSnapshot, Shift } from '../src/types/operations';

const tz = 'America/New_York';
const morning: Shift = { id: 1, name: 'Morning', start_time: '06:00:00', end_time: '14:00:00' };
const evening: Shift = { id: 2, name: 'Evening', start_time: '14:00:00', end_time: '22:00:00' };
const night: Shift = { id: 3, name: 'Night', start_time: '22:00:00', end_time: '06:00:00' };
const person: Employee = {
  id: 'employee-1',
  employee_id: 'EMP001',
  full_name: 'Aarav Shah',
  email: 'aarav@example.test',
  department: 'Security Operations',
  role: 'security',
  gender: 'Male',
  designation: 'Security Staff',
  secondary_duty: null,
  floor_id: 1,
  shift_id: 1,
  employment_status: 'Active',
  contact_number: null,
  joining_date: '2026-01-01',
  avatar_url: null,
  is_demo: true,
  created_at: '2026-01-01T00:00:00Z',
};
const data = (employees: Employee[] = [person], attendance: AttendanceEvent[] = []): OperationsSnapshot => ({
  employees,
  attendance,
  floors: [{ id: 1, name: 'Floor 1', location: 'Main Entrance', required_staff: 2 }],
  shifts: [morning, evening, night],
  patrolRoutes: [],
  patrols: [],
  incidents: [],
  handovers: [],
  audit: [],
});
const event = (
  type: EventType,
  at: string,
  workDate = '2026-11-02',
  user = person.id,
  id = 1,
): AttendanceEvent => ({
  id,
  user_id: user,
  work_date: workDate,
  event_type: type,
  created_at: at,
  auto: false,
});

describe('shift and timezone calculations', () => {
  it('retains the night work date after midnight and changes at 06:00', () => {
    expect(shiftWorkDate(night, tz, Date.parse('2026-11-03T10:59:00Z'))).toBe('2026-11-02');
    expect(shiftWorkDate(night, tz, Date.parse('2026-11-03T11:00:00Z'))).toBe('2026-11-03');
    expect(shiftAt([morning, evening, night], tz, Date.parse('2026-11-03T10:59:00Z'))?.id).toBe(3);
    expect(shiftAt([morning, evening, night], tz, Date.parse('2026-11-03T11:00:00Z'))?.id).toBe(1);
  });

  it('converts local inputs using configured timezone instead of browser zone', () => {
    expect(localToIso('2026-11-02T06:00', tz)).toBe('2026-11-02T11:00:00.000Z');
    expect(toLocalInput('2026-11-02T11:15:00Z', tz)).toBe('2026-11-02T06:15');
    expect(zonedTimestamp('2026-07-02', '06:00', tz)).toBe('2026-07-02T10:00:00.000Z');
    expect(() => localToIso('2026-02-31T06:00', tz)).toThrow('valid date');
    expect(() => localToIso('2026-11-02T24:15', tz)).toThrow('valid date');
  });

  it('rejects nonexistent DST local times and respects wall-clock shift end across fallback', () => {
    expect(() => zonedTimestamp('2026-03-08', '02:30', tz)).toThrow('does not exist');
    const bounds = shiftBounds(night, '2026-10-31', tz);
    expect(bounds.end - bounds.start).toBe(9 * 3_600_000);
    expect(new Date(bounds.end).toISOString()).toBe('2026-11-01T11:00:00.000Z');
  });
});

describe('shared attendance and manpower metrics', () => {
  it('uses the original work date for a cross-midnight night session', () => {
    const employee = { ...person, shift_id: 3 };
    const snapshot = data(
      [employee],
      [
        event('time_in', '2026-11-03T03:00:00Z'),
        event('break_start', '2026-11-03T07:00:00Z', '2026-11-02', person.id, 2),
        event('break_end', '2026-11-03T07:30:00Z', '2026-11-02', person.id, 3),
        event('time_out', '2026-11-03T11:00:00Z', '2026-11-02', person.id, 4),
      ],
    );
    const result = employeeDay(employee, snapshot, '2026-11-02', tz, Date.parse('2026-11-03T12:00:00Z'));
    expect(result.summary.workMs).toBe(7.5 * 3_600_000);
    expect(result.summary.breakMs).toBe(0.5 * 3_600_000);
    expect(result.status).toBe('Present');
    expect(result.late).toBe(false);
  });

  it('flags late night arrivals after midnight against the preceding shift start', () => {
    const employee = { ...person, shift_id: 3 };
    const snapshot = data([employee], [event('time_in', '2026-11-03T05:05:00Z')]);
    expect(employeeDay(employee, snapshot, '2026-11-02', tz, Date.parse('2026-11-03T05:30:00Z')).late).toBe(
      true,
    );
  });

  it('counts active breaks separately, ignores future events and scopes by floor and shift', () => {
    const second = { ...person, id: 'employee-2', employee_id: 'EMP002', floor_id: 2 };
    const third = { ...person, id: 'employee-3', employee_id: 'EMP003', shift_id: 2 };
    const snapshot = data(
      [person, second, third],
      [
        event('time_in', '2026-11-02T11:00:00Z'),
        event('break_start', '2026-11-02T12:00:00Z', '2026-11-02', person.id, 2),
        event('time_in', '2026-11-02T14:00:00Z', '2026-11-02', second.id, 3),
      ],
    );
    const now = Date.parse('2026-11-02T12:30:00Z');
    expect(workforce(snapshot, tz, now)).toMatchObject({
      total: 3,
      present: 1,
      onBreak: 1,
      onDuty: 0,
      absent: 1,
      offDuty: 1,
    });
    expect(workforce(snapshot, tz, now, 1, 1)).toMatchObject({ total: 1, onBreak: 1, absent: 0 });
    const floor = deployment(snapshot, tz, now, 1)[0];
    expect(floor).toMatchObject({ required: 2, vacant: 1, coverage: 50, tone: 'amber' });
  });

  it('does not report upcoming shifts as absences', () => {
    const now = Date.parse('2026-11-02T10:00:00Z'); // 05:00, before morning
    expect(employeeDay(person, data(), '2026-11-02', tz, now).status).toBe('Scheduled');
    expect(workforce(data(), tz, now).absent).toBe(0);
    const later = Date.parse('2026-11-02T12:00:00Z');
    const snapshot = data([person], [event('time_in', '2026-11-02T11:10:00Z')]);
    expect(workforce(snapshot, tz, later, undefined, undefined, 15).late).toBe(0);
    expect(workforce(snapshot, tz, later, undefined, undefined, 5).late).toBe(1);
    expect(reportRows('late', snapshot, '2026-11-02', '2026-11-02', tz, later, 5)).toHaveLength(2);
  });

  it('sorts punches before folding and removes events from other people/dates', () => {
    const snapshot = data(
      [person],
      [
        event('time_out', '2026-11-02T19:00:00Z', '2026-11-02', person.id, 2),
        event('time_in', '2026-11-02T11:00:00Z'),
        event('time_in', '2026-11-02T11:00:00Z', '2026-11-02', 'other'),
      ],
    );
    expect(
      employeeDay(person, snapshot, '2026-11-02', tz, Date.parse('2026-11-03T00:00:00Z')).summary.workMs,
    ).toBe(8 * 3_600_000);
  });
});

describe('navigation and reports', () => {
  it('keeps staff navigation personal and grants operational routes by role', () => {
    expect(allowedPages('security')).toEqual(['overview', 'attendance', 'profile']);
    expect(canAccess('security', 'settings')).toBe(false);
    expect(canAccess('gsoc', 'gsoc')).toBe(true);
    expect(canAccess('supervisor', 'management')).toBe(false);
    expect(canAccess('admin', 'settings')).toBe(true);
    expect(canAccess('director', 'management')).toBe(true);
    expect(canAccess('security', 'patrols', 'Patrolling Officer')).toBe(true);
    expect(canAccess('security', 'patrols')).toBe(false);
  });

  it('retains present-day punches when loading a historic report without duplicate records', () => {
    const history = data([person], [event('time_in', '2026-10-01T10:00:00Z', '2026-10-01', person.id, 1)]);
    const current = data(
      [{ ...person, floor_id: 2 }],
      [event('time_in', '2026-11-02T11:00:00Z', '2026-11-02', person.id, 2)],
    );
    const merged = mergeSnapshots(history, current);
    expect(workforce(merged, tz, Date.parse('2026-11-02T12:00:00Z')).onDuty).toBe(1);
    expect(reportRows('daily', merged, '2026-10-01', '2026-10-01', tz).length).toBe(2);
    expect(mergeSnapshots(merged, current).attendance).toHaveLength(2);
    expect(merged.employees[0]?.floor_id).toBe(2);
  });

  it('filters attendance exports by work date and derives gender totals from profiles', () => {
    const snapshot = data(
      [person, { ...person, id: 'female', employee_id: 'EMP002', gender: 'Female' }],
      [
        event('time_in', '2026-11-02T11:00:00Z'),
        event('time_out', '2026-11-02T19:00:00Z', '2026-11-02', person.id, 2),
      ],
    );
    const rows = reportRows(
      'daily',
      snapshot,
      '2026-11-02',
      '2026-11-02',
      tz,
      Date.parse('2026-11-03T12:00:00Z'),
    );
    expect(rows).toHaveLength(3);
    expect(rows[1]?.[10]).toBe('8h 00m');
    const absences = reportRows(
      'absences',
      snapshot,
      '2026-11-02',
      '2026-11-02',
      tz,
      Date.parse('2026-11-03T12:00:00Z'),
    );
    expect(absences).toHaveLength(2);
    expect(absences[1]?.[1]).toBe('EMP002');
    expect(reportRows('gender', snapshot, '2026-11-02', '2026-11-02', tz)).toEqual([
      ['Gender', 'Employees', 'Percent'],
      ['Male', 1, 50],
      ['Female', 1, 50],
    ]);
  });

  it('filters incident exports in the configured local timezone', () => {
    const snapshot = data();
    snapshot.incidents = [
      {
        id: 1,
        category: 'Access',
        description: 'Demo',
        reported_by: person.id,
        floor_id: 1,
        created_at: '2026-11-03T02:00:00Z',
        severity: 'Low',
        controller_id: null,
        analyst_id: null,
        status: 'Open',
        resolution: '',
      },
    ];
    expect(reportRows('incidents', snapshot, '2026-11-02', '2026-11-02', tz)).toHaveLength(2);
    expect(reportRows('incidents', snapshot, '2026-11-03', '2026-11-03', tz)).toHaveLength(1);
    expect(() => reportRows('daily', snapshot, '2026-11-03', '2026-11-02', tz)).toThrow('report range');
  });

  it('uses assignment history for floor and shift reports across a transfer', () => {
    const employee = { ...person, floor_id: 2, shift_id: 2 };
    const snapshot = data(
      [employee],
      [
        event('time_in', '2026-11-02T11:00:00Z'),
        event('time_out', '2026-11-02T19:00:00Z', '2026-11-02', person.id, 2),
      ],
    );
    snapshot.floors.push({ id: 2, name: 'Floor 2', location: 'Office Floor 2', required_staff: 2 });
    snapshot.assignments = [
      {
        id: 1,
        user_id: person.id,
        floor_id: 1,
        shift_id: 1,
        starts_at: '2026-01-01T00:00:00Z',
        ends_at: '2026-11-02T21:00:00Z',
        assigned_by: null,
      },
      {
        id: 2,
        user_id: person.id,
        floor_id: 2,
        shift_id: 2,
        starts_at: '2026-11-02T21:00:00Z',
        ends_at: null,
        assigned_by: null,
      },
    ];
    expect(employeeForDate(employee, snapshot, '2026-11-02', tz)).toMatchObject({ floor_id: 1, shift_id: 1 });
    expect(employeeForDate(employee, snapshot, '2026-11-03', tz)).toMatchObject({ floor_id: 2, shift_id: 2 });
    const now = Date.parse('2026-11-04T12:00:00Z');
    const shifts = reportRows('shifts', snapshot, '2026-11-02', '2026-11-03', tz, now);
    expect(shifts).toHaveLength(7);
    expect(shifts.find((row) => row[0] === '2026-11-02' && row[1] === 'Morning')?.slice(4, 7)).toEqual([
      1, 1, 0,
    ]);
    expect(shifts.find((row) => row[0] === '2026-11-03' && row[1] === 'Evening')?.slice(4, 7)).toEqual([
      1, 0, 1,
    ]);
    const daily = reportRows('daily', snapshot, '2026-11-02', '2026-11-02', tz, now);
    expect(daily[1]?.slice(5, 8)).toEqual(['Floor 1', 'Morning', 'Present']);
  });
});
