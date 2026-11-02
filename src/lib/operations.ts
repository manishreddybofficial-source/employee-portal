import { summarize, type DaySummary } from './attendance';
import { addDays, formatHours, minutesOfDay, parseClock, todayIn } from './time';
import type { Role } from '../types/models';
import type { Employee, Floor, OperationsSnapshot, Shift } from '../types/operations';

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: 'Administrator',
  director: 'Director',
  asm: 'Assistant Security Manager',
  supervisor: 'Shift Supervisor',
  gsoc: 'GSOC Analyst',
  controller: 'Controller',
  security: 'Security Staff',
  patrol: 'Patrolling Officer',
  employee: 'Employee',
};

export type OperationsPage =
  | 'overview'
  | 'employees'
  | 'attendance'
  | 'floors'
  | 'shifts'
  | 'patrols'
  | 'gsoc'
  | 'supervisor'
  | 'management'
  | 'reports'
  | 'settings'
  | 'audit'
  | 'profile';
const ALL_PAGES: readonly OperationsPage[] = [
  'overview',
  'employees',
  'attendance',
  'floors',
  'shifts',
  'patrols',
  'gsoc',
  'supervisor',
  'management',
  'reports',
  'settings',
  'audit',
  'profile',
];
const PAGES_BY_ROLE: Readonly<Record<Role, readonly OperationsPage[]>> = {
  admin: ALL_PAGES,
  director: ALL_PAGES.filter((page) => page !== 'settings'),
  asm: ALL_PAGES.filter((page) => page !== 'settings' && page !== 'audit'),
  supervisor: [
    'overview',
    'employees',
    'attendance',
    'floors',
    'shifts',
    'patrols',
    'gsoc',
    'supervisor',
    'reports',
    'profile',
  ],
  gsoc: ['overview', 'floors', 'shifts', 'patrols', 'gsoc', 'attendance', 'profile'],
  controller: ['overview', 'floors', 'shifts', 'gsoc', 'attendance', 'profile'],
  security: ['overview', 'attendance', 'profile'],
  patrol: ['overview', 'attendance', 'patrols', 'profile'],
  employee: ['overview', 'attendance', 'profile'],
};

/** Navigation only: Postgres independently checks every read and mutation. */
export const allowedPages = (role: Role, secondaryDuty?: string | null): readonly OperationsPage[] =>
  secondaryDuty === 'Patrolling Officer' && !PAGES_BY_ROLE[role].includes('patrols')
    ? [...PAGES_BY_ROLE[role], 'patrols']
    : PAGES_BY_ROLE[role];
export const canAccess = (role: Role, page: string, secondaryDuty?: string | null): boolean =>
  allowedPages(role, secondaryDuty).includes(page as OperationsPage);
export const canManageDeployment = (role: Role): boolean => ['admin', 'asm', 'supervisor'].includes(role);
export const canManageIncidents = (role: Role): boolean =>
  ['admin', 'asm', 'supervisor', 'gsoc', 'controller'].includes(role);

/** Retain current operational records when a historical report range is loaded. */
export function mergeSnapshots(history: OperationsSnapshot, current: OperationsSnapshot): OperationsSnapshot {
  const merge = <T extends { id: string | number }>(older: readonly T[], newer: readonly T[]): T[] =>
    Array.from(new Map([...older, ...newer].map((row) => [row.id, row])).values());
  return {
    employees: current.employees,
    floors: current.floors,
    shifts: current.shifts,
    attendance: merge(history.attendance, current.attendance).sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id,
    ),
    assignments: merge(history.assignments ?? [], current.assignments ?? []),
    handoverRecipients: current.handoverRecipients ?? [],
    patrolRoutes: current.patrolRoutes,
    patrols: merge(history.patrols, current.patrols).sort(
      (a, b) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at) || b.id - a.id,
    ),
    incidents: merge(history.incidents, current.incidents).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
    ),
    handovers: merge(history.handovers, current.handovers).sort(
      (a, b) => b.shift_date.localeCompare(a.shift_date) || b.id - a.id,
    ),
    audit: merge(history.audit, current.audit).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
    ),
  };
}

/** Convert a local wall-clock value using the configured IANA zone, never the browser's zone. */
export function zonedTimestamp(day: string, clock: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}(:\d{2})?$/.test(clock)) {
    throw new Error('Enter a valid date and time.');
  }
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute, second = 0] = clock.split(':').map(Number);
  const target = Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1, hour ?? 0, minute ?? 0, second);
  if (
    !Number.isFinite(target) ||
    new Date(target).toISOString().slice(0, 10) !== day ||
    (hour ?? -1) < 0 ||
    (hour ?? 24) > 23 ||
    (minute ?? -1) < 0 ||
    (minute ?? 60) > 59 ||
    second < 0 ||
    second > 59
  ) {
    throw new Error('Enter a valid date and time.');
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
  let candidate = target;
  for (let pass = 0; pass < 4; pass++) {
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (key: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === key)?.value);
    const actual = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
      value('second'),
    );
    const delta = target - actual;
    if (delta === 0) return new Date(candidate).toISOString();
    candidate += delta;
  }
  throw new Error('This local time does not exist because of daylight saving time. Choose another time.');
}

export function localToIso(value: string, timeZone: string): string {
  const [day, clock] = value.split('T');
  if (!day || !clock) throw new Error('Enter a date and time.');
  return zonedTimestamp(day, clock, timeZone);
}

export function toLocalInput(timestamp: string | null, timeZone: string): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const day = todayIn(timeZone, date);
  const minute = minutesOfDay(timestamp, timeZone);
  return `${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function shiftBounds(
  shift: Shift,
  workDate: string,
  timeZone: string,
): { start: number; end: number } {
  const overnight = parseClock(shift.end_time) <= parseClock(shift.start_time);
  return {
    start: Date.parse(zonedTimestamp(workDate, shift.start_time, timeZone)),
    end: Date.parse(zonedTimestamp(overnight ? addDays(workDate, 1) : workDate, shift.end_time, timeZone)),
  };
}

/** The night shift retains the preceding work date after midnight. */
export function shiftWorkDate(shift: Shift, timeZone: string, now: number = Date.now()): string {
  const today = todayIn(timeZone, new Date(now));
  return parseClock(shift.end_time) <= parseClock(shift.start_time) &&
    minutesOfDay(new Date(now).toISOString(), timeZone) < parseClock(shift.end_time)
    ? addDays(today, -1)
    : today;
}

export function shiftAt(
  shifts: readonly Shift[],
  timeZone: string,
  now: number = Date.now(),
): Shift | undefined {
  const minute = minutesOfDay(new Date(now).toISOString(), timeZone);
  return shifts.find((shift) => {
    const start = parseClock(shift.start_time);
    const end = parseClock(shift.end_time);
    return end <= start ? minute >= start || minute < end : minute >= start && minute < end;
  });
}

/** Historic reports use the assignment effective at that shift's start. */
export function employeeForDate(
  employee: Employee,
  data: OperationsSnapshot,
  day: string,
  timeZone: string,
): Employee {
  const history = data.assignments?.filter((assignment) => assignment.user_id === employee.id);
  if (!history?.length) return employee;
  const assignment = history.find((item) => {
    const shift = data.shifts.find((value) => value.id === item.shift_id);
    if (!shift) return false;
    const { start } = shiftBounds(shift, day, timeZone);
    return Date.parse(item.starts_at) <= start && (!item.ends_at || Date.parse(item.ends_at) > start);
  });
  return { ...employee, floor_id: assignment?.floor_id ?? null, shift_id: assignment?.shift_id ?? null };
}

export interface EmployeeDay {
  summary: DaySummary;
  events: OperationsSnapshot['attendance'];
  status:
    | 'On duty'
    | 'On break'
    | 'Off duty'
    | 'Scheduled'
    | 'Absent'
    | 'Present'
    | 'Inactive'
    | 'Missing checkout';
  late: boolean;
  scheduled: boolean;
  workDate: string;
}

export function employeeDay(
  employee: Employee,
  data: OperationsSnapshot,
  day: string,
  timeZone: string,
  now = Date.now(),
  graceMinutes = 15,
): EmployeeDay {
  const shift = data.shifts.find((item) => item.id === employee.shift_id);
  const events = data.attendance
    .filter(
      (event) =>
        event.user_id === employee.id && event.work_date === day && Date.parse(event.created_at) <= now,
    )
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
  const bounds = shift ? shiftBounds(shift, day, timeZone) : undefined;
  const currentWorkDate = shift ? shiftWorkDate(shift, timeZone, now) : todayIn(timeZone, new Date(now));
  const firstPunch = events.find((event) => event.event_type === 'time_in');
  const stale =
    events.length > 0 &&
    events.at(-1)?.event_type !== 'time_out' &&
    day < currentWorkDate &&
    !!firstPunch &&
    now - Date.parse(firstPunch.created_at) > 12 * 3_600_000;
  const until =
    stale && bounds ? Math.min(now, Math.max(bounds.end, Date.parse(events.at(-1)?.created_at ?? ''))) : now;
  const summary = summarize(events, until);
  const first = summary.firstIn;
  const late = !!first && !!bounds && Date.parse(first) > bounds.start + graceMinutes * 60_000;
  const active = employee.employment_status === 'Active';
  const scheduled = active && shift !== undefined;
  let status: EmployeeDay['status'];
  if (!active) status = 'Inactive';
  else if (stale) status = 'Missing checkout';
  else if (summary.state === 'working') status = 'On duty';
  else if (summary.state === 'break') status = 'On break';
  else if (first) status = 'Present';
  else if (!bounds) status = 'Off duty';
  else if (now < bounds.start + graceMinutes * 60_000) status = 'Scheduled';
  else status = 'Absent';
  return { summary, events, status, late, scheduled, workDate: day };
}

export interface WorkforceMetrics {
  total: number;
  scheduled: number;
  present: number;
  absent: number;
  onDuty: number;
  onBreak: number;
  offDuty: number;
  late: number;
}

export function workforce(
  data: OperationsSnapshot,
  timeZone: string,
  now = Date.now(),
  shiftId?: number,
  floorId?: number,
  graceMinutes = 15,
): WorkforceMetrics {
  const people = data.employees.filter(
    (person) =>
      person.role !== 'admin' &&
      (shiftId === undefined || person.shift_id === shiftId) &&
      (floorId === undefined || person.floor_id === floorId),
  );
  const result: WorkforceMetrics = {
    total: people.length,
    scheduled: 0,
    present: 0,
    absent: 0,
    onDuty: 0,
    onBreak: 0,
    offDuty: 0,
    late: 0,
  };
  for (const person of people) {
    const shift = data.shifts.find((item) => item.id === person.shift_id);
    const workDate = shift ? shiftWorkDate(shift, timeZone, now) : todayIn(timeZone, new Date(now));
    const day = employeeDay(person, data, workDate, timeZone, now, graceMinutes);
    if (day.scheduled) result.scheduled++;
    if (day.summary.firstIn) result.present++;
    if (day.late) result.late++;
    const bounds = shift ? shiftBounds(shift, workDate, timeZone) : undefined;
    if (day.status === 'On duty') result.onDuty++;
    else if (day.status === 'On break') result.onBreak++;
    else if (day.status === 'Absent' && bounds && now >= bounds.start && now < bounds.end) result.absent++;
    else result.offDuty++;
  }
  return result;
}

function workforceForDate(
  data: OperationsSnapshot,
  day: string,
  timeZone: string,
  now: number,
  shiftId?: number,
  floorId?: number,
  graceMinutes = 15,
): WorkforceMetrics {
  const people = data.employees
    .filter((person) => person.role !== 'admin')
    .map((person) => employeeForDate(person, data, day, timeZone))
    .filter(
      (person) =>
        (shiftId === undefined || person.shift_id === shiftId) &&
        (floorId === undefined || person.floor_id === floorId),
    );
  const result: WorkforceMetrics = {
    total: people.length,
    scheduled: 0,
    present: 0,
    absent: 0,
    onDuty: 0,
    onBreak: 0,
    offDuty: 0,
    late: 0,
  };
  for (const person of people) {
    const attendance = employeeDay(person, data, day, timeZone, now, graceMinutes);
    if (attendance.scheduled) result.scheduled++;
    if (attendance.summary.firstIn) result.present++;
    if (attendance.late) result.late++;
    if (attendance.status === 'Absent') result.absent++;
    else if (attendance.status === 'On duty') result.onDuty++;
    else if (attendance.status === 'On break') result.onBreak++;
    else result.offDuty++;
  }
  return result;
}

export interface FloorDeployment extends WorkforceMetrics {
  floor: Floor;
  required: number;
  vacant: number;
  coverage: number;
  tone: 'green' | 'amber' | 'red' | 'grey';
  security: number;
  patrolling: number;
  controllers: number;
  supervisors: number;
}

export function deployment(
  data: OperationsSnapshot,
  timeZone: string,
  now = Date.now(),
  shiftId?: number,
  graceMinutes = 15,
): FloorDeployment[] {
  const selectedShift = shiftId ?? shiftAt(data.shifts, timeZone, now)?.id;
  return data.floors.map((floor) => {
    const metrics = workforce(data, timeZone, now, selectedShift, floor.id, graceMinutes);
    const people = data.employees.filter(
      (person) =>
        person.floor_id === floor.id &&
        person.shift_id === selectedShift &&
        person.employment_status === 'Active' &&
        person.role !== 'admin',
    );
    const occupied = metrics.onDuty + metrics.onBreak;
    const required = floor.required_staff;
    const coverage = required > 0 ? Math.min(100, Math.round((occupied / required) * 100)) : 100;
    return {
      ...metrics,
      floor,
      required,
      vacant: Math.max(0, required - occupied),
      coverage,
      tone:
        metrics.total === 0
          ? 'grey'
          : occupied >= required
            ? 'green'
            : occupied >= Math.ceil(required / 2)
              ? 'amber'
              : 'red',
      security: people.filter((person) => person.role === 'security' || person.role === 'employee').length,
      patrolling: people.filter(
        (person) => person.role === 'patrol' || person.secondary_duty === 'Patrolling Officer',
      ).length,
      controllers: people.filter((person) => person.role === 'controller').length,
      supervisors: people.filter((person) => person.role === 'supervisor').length,
    };
  });
}

export const REPORT_LABELS = {
  daily: 'Daily attendance',
  monthly: 'Monthly attendance',
  shifts: 'Shift manpower',
  floors: 'Floor deployment',
  designations: 'Designation distribution',
  gender: 'Gender distribution',
  late: 'Late arrivals',
  absences: 'Absenteeism',
  patrols: 'Patrol completion',
  incidents: 'Incident management',
  handovers: 'Shift handover',
  audit: 'Attendance modification audit',
} as const;
export type ReportType = keyof typeof REPORT_LABELS;
export type ReportRows = (string | number)[][];

/** Generates exports from the same authorized snapshot as the tables and charts. */
export function reportRows(
  type: ReportType,
  data: OperationsSnapshot,
  from: string,
  to: string,
  timeZone: string,
  now = Date.now(),
  graceMinutes = 15,
): ReportRows {
  if (from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86_400_000) {
    throw new Error('Choose a report range of up to 366 days.');
  }
  const employees = data.employees.filter((person) => person.role !== 'admin');
  const employeeName = (id: string | null) =>
    data.employees.find((person) => person.id === id)?.full_name ?? id ?? '';
  const floorName = (id: number | null) => data.floors.find((floor) => floor.id === id)?.name ?? '';
  const shiftName = (id: number | null) => data.shifts.find((shift) => shift.id === id)?.name ?? '';
  const inRange = (timestamp: string) => {
    const day = todayIn(timeZone, new Date(timestamp));
    return day >= from && day <= to;
  };
  const display = (timestamp: string | null) =>
    timestamp ? new Date(timestamp).toLocaleString('en-US', { timeZone }) : '';
  if (['daily', 'monthly', 'late', 'absences'].includes(type)) {
    const rows: ReportRows = [
      [
        'Work date',
        'Employee ID',
        'Employee',
        'Designation',
        'Gender',
        'Floor',
        'Shift',
        'Status',
        'Login',
        'Logout',
        'Working hours',
        'Break time',
        'Late',
      ],
    ];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      for (const person of employees) {
        const assigned = employeeForDate(person, data, date, timeZone);
        const day = employeeDay(assigned, data, date, timeZone, now, graceMinutes);
        if (type === 'late' && !day.late) continue;
        if (type === 'absences' && day.status !== 'Absent') continue;
        rows.push([
          date,
          person.employee_id ?? '',
          person.full_name,
          person.designation,
          person.gender,
          floorName(assigned.floor_id),
          shiftName(assigned.shift_id),
          day.status,
          display(day.summary.firstIn),
          display(day.summary.lastOut),
          formatHours(day.summary.workMs),
          formatHours(day.summary.breakMs),
          day.late ? 'Yes' : 'No',
        ]);
      }
    }
    return rows;
  }
  if (type === 'shifts') {
    const rows: ReportRows = [
      ['Work date', 'Shift', 'Start', 'End', 'Assigned', 'Present', 'Absent', 'Late'],
    ];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      data.shifts.forEach((shift) => {
        const metrics = workforceForDate(data, date, timeZone, now, shift.id, undefined, graceMinutes);
        rows.push([
          date,
          shift.name,
          shift.start_time,
          shift.end_time,
          metrics.total,
          metrics.present,
          metrics.absent,
          metrics.late,
        ]);
      });
    }
    return rows;
  }
  if (type === 'floors') {
    const rows: ReportRows = [
      [
        'Work date',
        'Floor',
        'Location',
        'Shift',
        'Assigned',
        'Attended',
        'Absent',
        'Required',
        'Unfilled',
        'Attendance coverage %',
      ],
    ];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      data.shifts.forEach((shift) =>
        data.floors.forEach((floor) => {
          const metrics = workforceForDate(data, date, timeZone, now, shift.id, floor.id, graceMinutes);
          rows.push([
            date,
            floor.name,
            floor.location,
            shift.name,
            metrics.total,
            metrics.present,
            metrics.absent,
            floor.required_staff,
            Math.max(0, floor.required_staff - metrics.present),
            floor.required_staff
              ? Math.min(100, Math.round((metrics.present / floor.required_staff) * 100))
              : 100,
          ]);
        }),
      );
    }
    return rows;
  }
  if (type === 'designations' || type === 'gender') {
    const counts = new Map<string, number>();
    employees.forEach((person) => {
      const key = type === 'gender' ? person.gender : person.designation;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [
      [type === 'gender' ? 'Gender' : 'Designation', 'Employees', 'Percent'],
      ...Array.from(counts, ([key, count]) => [
        key,
        count,
        employees.length ? Math.round((count / employees.length) * 100) : 0,
      ]),
    ];
  }
  if (type === 'patrols')
    return [
      [
        'Patrol ID',
        'Officer',
        'Shift',
        'Floor',
        'Route',
        'Scheduled',
        'Started',
        'Completed',
        'Status',
        'Observations',
        'Incident',
      ],
      ...data.patrols
        .filter((patrol) => inRange(patrol.scheduled_at))
        .map((patrol) => [
          patrol.id,
          employeeName(patrol.officer_id),
          shiftName(patrol.shift_id),
          floorName(patrol.floor_id),
          data.patrolRoutes.find((route) => route.id === patrol.route_id)?.name ?? '',
          display(patrol.scheduled_at),
          display(patrol.started_at),
          display(patrol.completed_at),
          patrol.status,
          patrol.observations,
          patrol.incident_id ?? '',
        ]),
    ];
  if (type === 'incidents')
    return [
      [
        'Incident ID',
        'Category',
        'Description',
        'Reporter',
        'Floor',
        'Created',
        'Severity',
        'Controller',
        'Analyst',
        'Status',
        'Resolution',
      ],
      ...data.incidents
        .filter((incident) => inRange(incident.created_at))
        .map((incident) => [
          incident.id,
          incident.category,
          incident.description,
          employeeName(incident.reported_by),
          floorName(incident.floor_id),
          display(incident.created_at),
          incident.severity,
          employeeName(incident.controller_id),
          employeeName(incident.analyst_id),
          incident.status,
          incident.resolution,
        ]),
    ];
  if (type === 'handovers')
    return [
      [
        'Handover ID',
        'Outgoing',
        'Incoming',
        'Shift',
        'Work date',
        'Pending incidents',
        'Shortages',
        'Observations',
        'Status',
      ],
      ...data.handovers
        .filter((handover) => handover.shift_date >= from && handover.shift_date <= to)
        .map((handover) => [
          handover.id,
          employeeName(handover.outgoing_id),
          employeeName(handover.incoming_id),
          shiftName(handover.shift_id),
          handover.shift_date,
          handover.pending_incidents,
          handover.shortages,
          handover.observations,
          handover.status,
        ]),
    ];
  return [
    [
      'Audit ID',
      'Administrator',
      'Record',
      'Action',
      'Original values',
      'Updated values',
      'Reason',
      'Modified at',
    ],
    ...data.audit
      .filter((audit) => audit.entity_type === 'attendance' && inRange(audit.created_at))
      .map((audit) => [
        audit.id,
        employeeName(audit.actor_id),
        audit.entity_id,
        audit.action,
        JSON.stringify(audit.old_values),
        JSON.stringify(audit.new_values),
        audit.reason,
        display(audit.created_at),
      ]),
  ];
}
