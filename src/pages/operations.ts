import * as api from '../api/operations';
import * as attendanceApi from '../api/attendance';
import { bootstrapPage, closeNavigation, highlightOperation, type PageContext } from '../layout/shell';
import { escapeHtml as esc, byId, errorMessage, toast } from '../lib/dom';
import { icon, type IconName } from '../lib/icons';
import { downloadCsv } from '../lib/csv';
import { ALLOWED_ACTIONS, EVENT_LABELS } from '../lib/attendance';
import { addDays, formatDate, formatHours, formatTime, formatClockTime, todayIn } from '../lib/time';
import {
  canAccess,
  canManageDeployment,
  canManageIncidents,
  deployment,
  employeeDay,
  employeeForDate,
  localToIso,
  mergeSnapshots,
  toLocalInput,
  ROLE_LABELS,
  REPORT_LABELS,
  reportRows,
  shiftAt,
  shiftWorkDate,
  workforce,
  type OperationsPage,
  type ReportType,
} from '../lib/operations';
import type {
  Employee,
  Incident,
  MutationAction,
  OperationsSnapshot,
  PatrolRecord,
} from '../types/operations';
import type { EventType, Role } from '../types/models';

let context: PageContext;
let data: OperationsSnapshot;
let page: OperationsPage = 'overview';
let selectedShift = '';
let selectedFloor = '';
let search = '';
let statusFilter = '';
let from = '';
let to = '';
let day = '';
let reportType: ReportType = 'daily';
let loading = false;
const root = byId('operationsContent');
const dialog = byId<HTMLDialogElement>('opsDialog');
const tz = () => context.office.timezone;
const grace = () => context.office.grace_minutes;
const metrics = (shiftId?: number, floorId?: number) =>
  workforce(data, tz(), Date.now(), shiftId, floorId, grace());
const floorMetrics = (shiftId?: number) => deployment(data, tz(), Date.now(), shiftId, grace());
const exportRows = (type: ReportType, start: string, end: string) =>
  reportRows(type, data, start, end, tz(), Date.now(), grace());
const today = () => todayIn(tz());
const isAdmin = () => context.profile.role === 'admin';
const personal = () => ['security', 'patrol', 'employee'].includes(context.profile.role);
const manage = () => canManageDeployment(context.profile.role);
const person = (id: string | null) => data.employees.find((p) => p.id === id);
const name = (id: string | null) =>
  person(id)?.full_name ?? data.handoverRecipients?.find((p) => p.id === id)?.full_name ?? 'Unassigned';
const floorName = (id: number | null) => data.floors.find((f) => f.id === id)?.name ?? 'Unassigned';
const shiftName = (id: number | null) => data.shifts.find((s) => s.id === id)?.name ?? 'Unassigned';
const initials = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join('');
const titles: Record<OperationsPage, string> = {
  overview: 'Security operations',
  employees: 'Workforce directory',
  attendance: 'Attendance management',
  floors: 'Building deployment',
  shifts: 'Shift deployment',
  patrols: 'Patrolling operations',
  gsoc: 'GSOC & incidents',
  supervisor: 'Shift operations',
  management: 'Management insights',
  reports: 'Reports & analytics',
  settings: 'Configuration',
  audit: 'Audit history',
  profile: 'My profile & schedule',
};
function pill(value: string): string {
  const tone = /On duty|Present|Completed|Resolved|Adequate|Active|Acknowledged/.test(value)
    ? 'green'
    : /Critical|Absent|Missed|Escalated|Inactive|Missing/.test(value)
      ? 'red'
      : /break|Pending|High|Shortage|Submitted|Late/.test(value)
        ? 'amber'
        : /Progress|Open|Scheduled|Medium/.test(value)
          ? 'blue'
          : '';
  return `<span class="badge ${tone}"><i class="status-dot"></i>${esc(value)}</span>`;
}
function button(label: string, action: string, id?: string | number, extra = ''): string {
  const actionIcons: Partial<Record<string, IconName>> = {
    'employee-create': 'plus',
    'employee-import': 'file',
    'employee-export': 'download',
    'incident-create': 'plus',
    'patrol-create': 'plus',
    'route-create': 'route',
    'handover-create': 'plus',
    'floor-create': 'plus',
    'report-export': 'download',
    'export-overview': 'download',
    'attendance-export': 'download',
    'audit-export': 'download',
  };
  const prefix = actionIcons[action];
  const content = prefix
    ? `${icon(prefix)}${label.replace(/^\+\s*/, '').replace(/<svg[\s\S]*?<\/svg>/, '')}`
    : label;
  return `<button class="btn ${extra}" type="button" data-action="${action}"${id !== undefined ? ` data-id="${esc(id)}"` : ''}>${content}</button>`;
}
function employeeCell(e: Employee): string {
  return `<div class="person"><span class="person-avatar">${esc(initials(e.full_name))}</span><div><div class="person-name">${esc(e.full_name)}</div><div class="person-id">${esc(e.employee_id ?? 'Employee')}${e.is_demo ? ' · DEMO' : ''}</div></div></div>`;
}
function table(headers: string[], rows: string[], empty = 'No records match your filters.'): string {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td class="empty" colspan="${headers.length}"><div class="empty-state">${icon('file')}<span>${esc(empty)}</span></div></td></tr>`}</tbody></table></div>`;
}
function panel(title: string, subtitle: string, body: string, link?: [string, OperationsPage]): string {
  return `<section class="panel"><div class="panel-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${link ? `<a class="panel-link" href="#${link[1]}">${esc(link[0])}${icon('arrow-right')}</a>` : ''}</div>${body}</section>`;
}
function kpi(
  label: string,
  value: string | number,
  note: string,
  ico: IconName = 'user-clock',
  tone = '',
): string {
  return `<div class="kpi ${tone}"><div class="kpi-top"><span>${esc(label)}</span><span class="kpi-icon">${icon(ico)}</span></div><div class="kpi-number">${esc(value)}</div><div class="kpi-foot">${note}</div></div>`;
}
function heading(description: string, actions = ''): string {
  return `<div class="page-heading"><div><div class="eyebrow">${page === 'management' ? 'Executive workspace' : 'Security command center'}</div><h1>${titles[page]}</h1><p>${esc(description)}</p></div><div class="heading-actions"><span class="date-chip">${icon('calendar')}${esc(formatDate(today()))}</span>${actions}</div></div>`;
}
function selects(): string {
  return `<select class="input" data-filter="shift" aria-label="Filter by shift"><option value="">All shifts</option>${data.shifts.map((s) => `<option value="${s.id}" ${selectedShift === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><select class="input" data-filter="floor" aria-label="Filter by floor"><option value="">All floors</option>${data.floors.map((f) => `<option value="${f.id}" ${selectedFloor === String(f.id) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`;
}
function filteredEmployees(workDate?: string): Employee[] {
  const employees = workDate
    ? data.employees.map((e) => employeeForDate(e, data, workDate, tz()))
    : data.employees;
  return employees.filter(
    (e) =>
      (!selectedShift || e.shift_id === Number(selectedShift)) &&
      (!selectedFloor || e.floor_id === Number(selectedFloor)) &&
      (!search ||
        `${e.full_name} ${e.employee_id} ${e.email} ${e.designation}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!statusFilter || e.employment_status === statusFilter),
  );
}
function currentEmployeeDay(e: Employee) {
  const shift = data.shifts.find((s) => s.id === e.shift_id);
  return employeeDay(
    e,
    data,
    shift ? shiftWorkDate(shift, tz()) : today(),
    tz(),
    Date.now(),
    context.office.grace_minutes,
  );
}
function patrolsInPeriod(): PatrolRecord[] {
  return data.patrols.filter((p) => {
    const date = todayIn(tz(), new Date(p.scheduled_at));
    return date >= from && date <= to;
  });
}
function floorList(shiftId?: number): string {
  return `<div class="floor-list">${floorMetrics(
    shiftId ?? (selectedShift ? Number(selectedShift) : undefined),
  )
    .slice()
    .reverse()
    .map(
      (f) =>
        `<a class="floor-row" href="#floors" data-floor-link="${f.floor.id}"><span class="floor-number">F${f.floor.id}</span><span class="floor-name">${esc(f.floor.name)}<small>${esc(f.floor.location)}</small></span><span class="coverage-bar"><i class="${f.tone}" style="width:${Math.min(100, f.coverage)}%"></i></span><span class="floor-count">${f.onDuty + f.onBreak}/${f.required}</span></a>`,
    )
    .join('')}</div>`;
}
function shiftChart(): string {
  const shiftMetrics = data.shifts.map((s) => ({ shift: s, ...metrics(s.id) }));
  const max = Math.max(1, ...shiftMetrics.map((s) => s.total));
  return `<div class="panel-body"><div class="legend"><span><i></i>Assigned</span><span><i class="present"></i>Present</span></div><div class="shift-chart" role="img" aria-label="Assigned and present employees by shift">${shiftMetrics.map((s) => `<div class="chart-col"><div class="chart-bar" title="${esc(s.shift.name)} assigned: ${s.total}" style="height:${(s.total / max) * 83}%"><span>${s.total}</span></div><div class="chart-bar present" title="${esc(s.shift.name)} present: ${s.present}" style="height:${(s.present / max) * 83}%"><span>${s.present}</span></div><label>${esc(s.shift.name)} shift</label></div>`).join('')}</div><div class="chart-bottom subtext">${esc(shiftAt(data.shifts, tz())?.name ?? 'No active shift')} shift currently in operation</div></div>`;
}
function genderChart(): string {
  const employees = data.employees.filter((e) => e.role !== 'admin' && e.employment_status === 'Active');
  const male = employees.filter((e) => e.gender === 'Male').length,
    female = employees.filter((e) => e.gender === 'Female').length;
  return `<div class="panel-body"><div class="gender-block"><div class="workforce-donut" style="--angle:${employees.length ? (male / employees.length) * 360 : 0}deg"><div class="donut-center"><b>${employees.length}</b><span>Total workforce</span></div></div><div class="gender-legend"><div class="gender-line"><i></i>Male<b>${male} <span class="muted">(${employees.length ? Math.round((male / employees.length) * 100) : 0}%)</span></b></div><div class="gender-line"><i></i>Female<b>${female} <span class="muted">(${employees.length ? Math.round((female / employees.length) * 100) : 0}%)</span></b></div></div></div></div>`;
}
function incidentList(): string {
  const incidents = data.incidents.filter((i) => i.status !== 'Resolved').slice(0, 4);
  return `<div class="incident-list">${incidents.map((i) => `<div class="incident-row"><span class="incident-symbol">${icon('shield')}</span><div class="incident-text"><strong>${esc(i.category)}</strong><p>INC-${i.id} · ${esc(floorName(i.floor_id))} · ${esc(formatTime(i.created_at, tz()))}</p></div>${pill(i.severity)}</div>`).join('') || '<p class="empty">No active incidents in your scope.</p>'}</div><div class="panel-bottom">${data.incidents.filter((i) => i.status === 'Escalated').length} escalated · ${data.incidents.filter((i) => i.status === 'Resolved').length} resolved in selected period</div>`;
}
function renderOverview(): string {
  if (personal()) return renderProfile(true);
  const stats = metrics();
  const activeIncidents = data.incidents.filter((i) => i.status !== 'Resolved').length;
  const periodPatrols = patrolsInPeriod();
  const completed = periodPatrols.filter((p) => p.status === 'Completed').length;
  const active = data.employees.filter((e) => e.employment_status === 'Active' && e.role !== 'admin');
  const demo = active.filter((e) => e.is_demo).length;
  return (
    heading(
      'A unified view of your people, coverage, and security operations.',
      `${button(`${icon('calendar')}Export report`, 'export-overview', undefined, 'secondary')}${canManageIncidents(context.profile.role) ? button('+ Report incident', 'incident-create') : ''}`,
    ) +
    (demo
      ? `<div class="notice"><span><strong><span class="status-dot"></span>Demo workspace</strong> &nbsp; ${demo} fictional employee records · Changes persist in this demo workspace.</span><span>${esc(tz())}</span></div>`
      : '') +
    `<div class="kpi-grid">${kpi('Total workforce', stats.total, 'Across all assigned security functions', 'user-clock')}${kpi('Personnel on duty', stats.onDuty, `${stats.onBreak} on break · ${stats.offDuty} off duty`, 'shield', 'green')}${kpi('Active incidents', activeIncidents, `${data.incidents.filter((i) => i.status === 'Escalated').length} require escalation review`, 'stopwatch', 'amber')}${kpi('Patrol completion', `${periodPatrols.length ? Math.round((completed / periodPatrols.length) * 100) : 0}%`, `${completed} of ${periodPatrols.length} rounds in selected period`, 'calendar')}</div>` +
    `<div class="dashboard-grid">${panel('Shift manpower distribution', 'Assigned personnel and recorded attendance', shiftChart(), ['View shifts', 'shifts'])}${panel('Workforce composition', 'Gender distribution across active personnel', genderChart(), ['View insights', 'management'])}</div>` +
    `<div class="dashboard-grid">${panel('Building security coverage', 'Available personnel / required positions per floor', floorList(), ['View deployment', 'floors'])}${panel('Active security incidents', 'Latest incidents requiring attention', incidentList(), ['Open GSOC', 'gsoc'])}</div>` +
    panel(
      'Personnel on the ground',
      'Current attendance and deployment at a glance',
      table(
        ['Employee', 'Designation', 'Floor', 'Shift', 'Status'],
        active
          .slice(0, 5)
          .map(
            (e) =>
              `<tr><td>${employeeCell(e)}</td><td>${esc(e.designation)}</td><td>${esc(floorName(e.floor_id))}</td><td>${esc(shiftName(e.shift_id))}</td><td>${pill(currentEmployeeDay(e).status)}</td></tr>`,
          ),
      ),
      ['View directory', 'employees'],
    )
  );
}
function renderEmployees(): string {
  const employees = filteredEmployees();
  return (
    heading(
      'Manage profiles, floor assignments, and shift deployment.',
      isAdmin()
        ? `${button('Import CSV', 'employee-import', undefined, 'secondary')}${button('+ Add employee', 'employee-create')}`
        : '',
    ) +
    `<section class="panel"><div class="toolbar"><div class="filters"><input class="input search" type="search" data-filter="search" placeholder="Search name, ID, or designation…" value="${esc(search)}" aria-label="Search employees">${selects()}<select class="input" data-filter="status" aria-label="Employment status"><option value="">All statuses</option>${['Active', 'Inactive'].map((s) => `<option ${statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>${button('Export CSV', 'employee-export', undefined, 'secondary sm')}</div>${table(
      ['Employee', 'Designation', 'Gender', 'Deployment', 'Shift', 'Status', 'Actions'],
      employees.map(
        (e) =>
          `<tr><td>${employeeCell(e)}</td><td>${esc(e.designation)}${e.secondary_duty ? `<div class="subtext">${esc(e.secondary_duty)}</div>` : ''}</td><td>${esc(e.gender)}</td><td>${esc(floorName(e.floor_id))}</td><td>${esc(shiftName(e.shift_id))}</td><td>${pill(e.employment_status)}</td><td><div class="row-actions">${button('Profile', 'employee-view', e.id, 'secondary sm')}${manage() ? button(isAdmin() ? 'Edit' : 'Transfer', 'employee-edit', e.id, 'secondary sm') : ''}</div></td></tr>`,
      ),
    )}<div class="page-count">Showing ${employees.length} of ${data.employees.length} authorized profiles</div></section>`
  );
}
function renderAttendance(): string {
  const employees = filteredEmployees(day).filter((e) => e.role !== 'admin');
  const rows = employees.map((e) => ({
    employee: e,
    day: employeeDay(e, data, day, tz(), Date.now(), context.office.grace_minutes),
  }));
  const totalHours = rows.reduce((sum, r) => sum + r.day.summary.workMs, 0);
  return (
    heading(
      'Review attendance, missed punches, working hours, and corrections.',
      `${button('Export CSV', 'attendance-export', undefined, 'secondary')}${isAdmin() ? button('Audit history', 'go-audit') : ''}`,
    ) +
    `<div class="kpi-grid">${kpi('Recorded attendance', rows.filter((r) => r.day.summary.firstIn).length, 'Personnel with a check-in on this work date', 'calendar', 'green')}${kpi('Late arrivals', rows.filter((r) => r.day.late).length, `Shift start + ${context.office.grace_minutes} minute grace period`, 'clock', 'amber')}${kpi('Absent personnel', rows.filter((r) => r.day.status === 'Absent').length, 'Scheduled with no recorded check-in', 'user-clock', 'red')}${kpi('Working hours', formatHours(totalHours), 'Recorded work excluding breaks', 'stopwatch')}</div>` +
    `<section class="panel"><div class="toolbar"><div class="filters"><input class="input" type="date" data-filter="day" value="${esc(day)}" max="${today()}" aria-label="Attendance work date">${selects()}<input class="input search" type="search" data-filter="search" value="${esc(search)}" placeholder="Search employees…" aria-label="Search attendance"></div><span class="subtext">Times in ${esc(tz())}</span></div>${table(
      ['Employee', 'Shift', 'Check in', 'Check out', 'Worked', 'Status', ...(isAdmin() ? ['Actions'] : [])],
      rows.map(
        ({ employee: e, day: d }) =>
          `<tr><td>${employeeCell(e)}</td><td>${esc(shiftName(e.shift_id))}</td><td>${esc(formatTime(d.summary.firstIn, tz()))}${d.late ? ' ' + pill('Late') : ''}</td><td>${esc(formatTime(d.summary.lastOut, tz()))}</td><td>${esc(formatHours(d.summary.workMs))}</td><td>${pill(d.status)}</td>${isAdmin() ? `<td>${button('Correct punches', 'attendance-correct', e.id, 'secondary sm')}</td>` : ''}</tr>`,
      ),
    )}</section>`
  );
}
function renderFloors(): string {
  const floors = floorMetrics(selectedShift ? Number(selectedShift) : undefined);
  return (
    heading(
      'Eight floors. One clear view of your building’s security coverage.',
      isAdmin() ? button('+ Add floor', 'floor-create') : '',
    ) +
    `<div class="toolbar panel"><div class="filters">${selects()}</div><div class="legend"><span><i class="green"></i>Adequate</span><span><i class="amber"></i>Shortage</span><span><i class="red"></i>Critical</span><span><i class="gray"></i>No deployment</span></div></div>` +
    `<div class="floor-grid">${floors
      .filter((f) => !selectedFloor || f.floor.id === Number(selectedFloor))
      .slice()
      .reverse()
      .map(
        (f) =>
          `<article class="floor-card" data-action="floor-view" data-id="${f.floor.id}" tabindex="0" role="button" aria-label="View ${esc(f.floor.name)} personnel"><div class="floor-card-top"><span class="floor-number">F${f.floor.id}</span>${pill(f.total === 0 ? 'No deployment' : f.coverage >= 100 ? 'Adequate' : f.coverage >= 50 ? 'Shortage' : 'Critical shortage')}</div><h3>${esc(f.floor.name)}</h3><span class="subtext">${esc(f.floor.location)}</span><div class="coverage-bar"><i class="${f.tone}" style="width:${Math.min(100, f.coverage)}%"></i></div><div class="subtext">${f.onDuty + f.onBreak} available now / ${f.required} required · ${f.vacant} vacant positions</div><div class="floor-card-stats"><div><b>${f.total}</b>Assigned</div><div><b>${f.patrolling}</b>Patrolling</div><div><b>${f.controllers}</b>Controllers</div></div><p class="subtext">${f.security} security staff · ${f.supervisors} supervisors</p></article>`,
      )
      .join('')}</div>`
  );
}
function renderShifts(): string {
  return (
    heading('Monitor all three shifts and their floor coverage from the same roster.') +
    `<div class="shift-grid">${data.shifts
      .map((s) => {
        const m = metrics(s.id);
        const staff = data.employees.filter((e) => e.shift_id === s.id && e.employment_status === 'Active');
        return panel(
          s.name + ' shift',
          `${formatClockTime(s.start_time)} – ${formatClockTime(s.end_time)} · ${s.start_time > s.end_time ? 'Overnight · ' : ''}8 hours`,
          `<div class="panel-body"><div class="inline-metrics"><div><b>${m.total}</b>Assigned</div><div><b>${m.present}</b>Present</div><div><b>${m.absent}</b>Absent</div></div><div class="legend"><span>${m.onDuty} on duty</span><span>${m.onBreak} on break</span><span>${m.late} late</span></div><hr class="section-divider"><div class="detail-list">${[
            ['Security staff', staff.filter((e) => e.role === 'security').length],
            [
              'Patrol officers',
              staff.filter((e) => e.role === 'patrol' || e.secondary_duty === 'Patrolling Officer').length,
            ],
            ['Controllers', staff.filter((e) => e.role === 'controller').length],
            ['GSOC analysts', staff.filter((e) => e.role === 'gsoc').length],
            ['Supervisors', staff.filter((e) => e.role === 'supervisor').length],
            ['Off duty', m.offDuty],
          ]
            .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
            .join('')}</div></div>${table(
            ['Floor', 'Assigned', 'Present'],
            floorMetrics(s.id).map(
              (f) => `<tr><td>${esc(f.floor.name)}</td><td>${f.total}</td><td>${f.present}</td></tr>`,
            ),
          )}`,
        );
      })
      .join('')}</div>` +
    panel('Manpower comparison', 'All shifts use the current shared roster', shiftChart())
  );
}
function renderPatrols(): string {
  const patrols = data.patrols.filter((p) => {
    const date = todayIn(tz(), new Date(p.scheduled_at));
    return (
      date >= from &&
      date <= to &&
      (!selectedShift || p.shift_id === Number(selectedShift)) &&
      (!selectedFloor || p.floor_id === Number(selectedFloor))
    );
  });
  return (
    heading(
      'Schedule rounds, record observations, and track verified manual activity.',
      `${context.profile.role !== 'director' ? button('+ Report incident', 'incident-create', undefined, 'secondary') : ''}${manage() ? `${button('Create route', 'route-create', undefined, 'secondary')}${button('+ Schedule patrol', 'patrol-create')}` : ''}`,
    ) +
    `<div class="notice"><span><strong>Manual patrol verification</strong> &nbsp; Officers record start and completion. Times are stamped by the server.</span><span>No GPS tracking</span></div><div class="kpi-grid">${kpi('Scheduled rounds', patrols.length, 'In the selected reporting period', 'calendar')}${kpi('Completed', patrols.filter((p) => p.status === 'Completed').length, 'Rounds completed and recorded', 'shield', 'green')}${kpi('In progress', patrols.filter((p) => p.status === 'In Progress').length, 'Started by the assigned officer', 'clock')}${kpi('Missed patrols', patrols.filter((p) => p.status === 'Missed').length, 'Rounds marked missed by operations', 'stopwatch', 'red')}</div><section class="panel"><div class="toolbar"><div class="filters">${selects()}</div><span class="subtext">${esc(from)} — ${esc(to)}</span></div>${table(
      ['Patrol / route', 'Officer', 'Floor / shift', 'Scheduled', 'Started / completed', 'Status', 'Actions'],
      patrols.map(
        (p) =>
          `<tr><td><strong>PAT-${p.id}</strong><div class="person-id">${esc(data.patrolRoutes.find((r) => r.id === p.route_id)?.name)}</div></td><td>${esc(name(p.officer_id))}<div class="person-id">${esc(person(p.officer_id)?.employee_id)}</div></td><td>${esc(floorName(p.floor_id))}<div class="person-id">${esc(shiftName(p.shift_id))}</div></td><td>${esc(formatDate(todayIn(tz(), new Date(p.scheduled_at))))}<div class="person-id">${esc(formatTime(p.scheduled_at, tz()))}</div></td><td>${esc(formatTime(p.started_at, tz()))} / ${esc(formatTime(p.completed_at, tz()))}</td><td>${pill(p.status)}</td><td>${manage() || p.officer_id === context.profile.id ? button('Record round', 'patrol-update', p.id, 'secondary sm') : button('Details', 'patrol-view', p.id, 'secondary sm')}</td></tr>`,
      ),
    )}</section>`
  );
}
function renderGsoc(): string {
  const incidents = data.incidents.filter(
    (i) =>
      (!selectedFloor || i.floor_id === Number(selectedFloor)) &&
      (!selectedShift ||
        shiftAt(data.shifts, tz(), Date.parse(i.created_at))?.id === Number(selectedShift)) &&
      (!statusFilter || i.status === statusFilter),
  );
  return (
    heading(
      'Coordinate analysts, controllers, incident response, and escalations.',
      context.profile.role !== 'director' ? button('+ Report incident', 'incident-create') : '',
    ) +
    `<div class="kpi-grid">${kpi('GSOC analysts', data.employees.filter((e) => e.role === 'gsoc' && e.employment_status === 'Active').length, `${data.employees.filter((e) => e.role === 'controller' && currentEmployeeDay(e).status === 'On duty').length} controllers on duty`, 'user-clock')}${kpi('Open & pending', data.incidents.filter((i) => ['Open', 'Pending'].includes(i.status)).length, `${shiftAt(data.shifts, tz())?.name ?? 'No active'} shift`, 'stopwatch', 'amber')}${kpi('Escalated', data.incidents.filter((i) => i.status === 'Escalated').length, 'Requires operational review', 'shield', 'red')}${kpi('Resolved', data.incidents.filter((i) => i.status === 'Resolved').length, 'Closed with resolution remarks', 'calendar', 'green')}</div><section class="panel"><div class="toolbar"><div class="filters">${selects()}<select class="input" data-filter="status" aria-label="Incident status"><option value="">All statuses</option>${['Open', 'Pending', 'Escalated', 'Resolved'].map((s) => `<option ${s === statusFilter ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>${table(
      ['Incident', 'Location', 'Reported by', 'Severity', 'Assigned', 'Status', 'Actions'],
      incidents.map(
        (i) =>
          `<tr><td><strong>INC-${i.id} · ${esc(i.category)}</strong><div class="person-id">${esc(formatDate(todayIn(tz(), new Date(i.created_at))))} · ${esc(formatTime(i.created_at, tz()))}</div></td><td>${esc(floorName(i.floor_id))}</td><td>${esc(name(i.reported_by))}</td><td>${pill(i.severity)}</td><td>${esc(name(i.analyst_id))}<div class="person-id">${esc(name(i.controller_id))}</div></td><td>${pill(i.status)}</td><td>${button(canManageIncidents(context.profile.role) ? 'Manage' : 'Details', 'incident-update', i.id, 'secondary sm')}</td></tr>`,
      ),
    )}</section>`
  );
}
function renderSupervisor(): string {
  const shift = data.shifts.find((s) => s.id === person(context.profile.id)?.shift_id);
  const staff = data.employees.filter((e) => !shift || e.shift_id === shift.id);
  const stats = metrics(shift?.id);
  return (
    heading(
      `${shift ? shift.name + ' shift' : 'All shifts'} · Attendance, manpower, and continuity between teams.`,
      manage() ? button('+ Submit handover', 'handover-create') : '',
    ) +
    `<div class="kpi-grid">${kpi('Assigned team', staff.filter((e) => e.role !== 'admin').length, 'Assigned shift team members', 'user-clock')}${kpi('On duty', stats.onDuty, `${stats.onBreak} employees on break`, 'shield', 'green')}${kpi('Absentees', stats.absent, `${stats.late} late arrivals`, 'clock', 'amber')}${kpi('Pending handovers', data.handovers.filter((h) => h.status === 'Submitted').length, 'Awaiting incoming supervisor acknowledgement', 'send')}</div><div class="dashboard-grid">${panel('Floor manpower', 'Deployment for the authorized shift', floorList(shift?.id))}${panel('Incident coordination', 'Open incident handover context', incidentList())}</div>` +
    panel(
      'Shift handover register',
      'Outgoing notes and incoming acknowledgement are recorded',
      table(
        ['Work date', 'Outgoing / incoming', 'Shift', 'Manpower notes', 'Status', 'Actions'],
        data.handovers.map(
          (h) =>
            `<tr><td>${esc(h.shift_date)}</td><td>${esc(name(h.outgoing_id))}<div class="person-id">To ${esc(name(h.incoming_id))}</div></td><td>${esc(shiftName(h.shift_id))}</td><td style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc(h.shortages || 'No shortages reported')}</td><td>${pill(h.status)}</td><td>${button('View handover', 'handover-view', h.id, 'secondary sm')}</td></tr>`,
        ),
      ),
    )
  );
}
function renderManagement(): string {
  const m = metrics();
  const periodPatrols = patrolsInPeriod();
  const completed = periodPatrols.filter((p) => p.status === 'Completed').length;
  return (
    heading(
      'Workforce readiness and operational performance across the organization.',
      button('Download attendance', 'export-overview', undefined, 'secondary'),
    ) +
    `<div class="kpi-grid">${kpi('Total workforce', m.total, `${m.onDuty} on duty · ${m.offDuty} off duty`, 'user-clock')}${kpi('Attendance coverage', `${m.scheduled ? Math.round((m.present / m.scheduled) * 100) : 0}%`, `${m.present} present of ${m.scheduled} scheduled`, 'calendar', 'green')}${kpi('On break / absent', `${m.onBreak} / ${m.absent}`, 'Current shift availability', 'clock', 'amber')}${kpi('Patrol compliance', `${periodPatrols.length ? Math.round((completed / periodPatrols.length) * 100) : 0}%`, `${completed} completed rounds in period`, 'shield')}</div><div class="dashboard-grid">${panel('Shift-wise workforce', 'Manpower distribution and attendance', shiftChart())}${panel('Workforce gender distribution', 'Descriptive reporting · role permissions are independent of gender', genderChart())}</div><div class="dashboard-grid">${panel(
      'Designation-wise deployment',
      'Active employees by primary designation',
      table(
        ['Designation', 'Employees'],
        [...new Set(data.employees.filter((e) => e.role !== 'admin').map((e) => e.designation))].map(
          (d) =>
            `<tr><td>${esc(d)}</td><td>${data.employees.filter((e) => e.designation === d && e.employment_status === 'Active').length}</td></tr>`,
        ),
      ),
    )}${panel(
      'Operational readiness',
      'Key security operations indicators',
      `<div class="panel-body">${[
        ['Active incidents', data.incidents.filter((i) => i.status !== 'Resolved').length],
        ['Pending escalations', data.incidents.filter((i) => i.status === 'Escalated').length],
        ['GSOC manpower', data.employees.filter((e) => e.role === 'gsoc').length],
        ['Submitted handovers', data.handovers.filter((h) => h.status === 'Submitted').length],
        ['Acknowledged handovers', data.handovers.filter((h) => h.status === 'Acknowledged').length],
      ]
        .map(([k, v]) => `<div class="activity-item"><p>${k}</p><time>${v}</time></div>`)
        .join('')}</div>`,
    )}</div>` +
    panel('Building coverage', 'Staffing by floor', floorList())
  );
}
function renderReports(): string {
  const rows = exportRows(reportType, from, to);
  return (
    heading(
      'Date-filtered reports generated from authorized shared records.',
      button('Export CSV', 'report-export'),
    ) +
    `<div class="toolbar panel"><div class="filters"><label class="subtext">From <input class="input" type="date" data-filter="from" value="${esc(from)}" aria-label="Report start date"></label><label class="subtext">To <input class="input" type="date" data-filter="to" value="${esc(to)}" aria-label="Report end date"></label>${button('Apply range', 'range-apply', undefined, 'secondary')}</div><span class="subtext">CSV opens in Excel</span></div><div class="report-layout"><section class="panel report-menu">${Object.entries(
      REPORT_LABELS,
    )
      .map(
        ([key, label]) =>
          `<button type="button" data-report="${key}" class="${reportType === key ? 'active' : ''}" aria-pressed="${reportType === key}">${icon('file')}${esc(label)}</button>`,
      )
      .join(
        '',
      )}</section><section class="panel report-preview"><div class="panel-head"><div><h3>${esc(REPORT_LABELS[reportType])}</h3><p>${rows.length - 1} records · ${esc(from)} to ${esc(to)}</p></div></div>${table(
      (rows[0] ?? []).map(String),
      rows
        .slice(1, 101)
        .map((r) => `<tr>${r.map((cell) => `<td title="${esc(cell)}">${esc(cell)}</td>`).join('')}</tr>`),
      'No records in the selected date range.',
    )}<div class="page-count">Preview limited to 100 rows. Export includes all ${rows.length - 1} records.</div></section></div>`
  );
}
function renderSettings(): string {
  return (
    heading('Editable building floors and coordinated eight-hour shifts.') +
    `<div class="notice"><span><strong>Shift safety</strong> &nbsp; Edit all three shifts together. The server validates eight-hour duration and rejects overlapping coverage.</span></div><div class="dashboard-grid">${panel(
      'Building configuration',
      'Required positions apply to each shift',
      table(
        ['Floor', 'Location', 'Required', ''],
        data.floors.map(
          (f) =>
            `<tr><td>${esc(f.name)}</td><td>${esc(f.location)}</td><td>${f.required_staff}</td><td>${button('Edit', 'floor-edit', f.id, 'secondary sm')}</td></tr>`,
        ),
      ) +
        `<div class="panel-bottom">${button('+ Add floor', 'floor-create', undefined, 'secondary sm')}</div>`,
    )}${panel(
      'Shift configuration',
      'Local time in ' + tz(),
      table(
        ['Shift', 'Starts', 'Ends'],
        data.shifts.map(
          (s) =>
            `<tr><td>${esc(s.name)}</td><td>${esc(s.start_time.slice(0, 5))}</td><td>${esc(s.end_time.slice(0, 5))}</td></tr>`,
        ),
      ) +
        `<div class="panel-bottom">${button('Edit shift timings', 'shift-edit', undefined, 'secondary sm')}</div>`,
    )} </div><a class="btn secondary" href="/admin">Open existing admin settings & leave requests ↗</a>`
  );
}
function renderAudit(): string {
  return (
    heading(
      'Immutable history of privileged changes, including attendance before and after.',
      button('Export audit CSV', 'audit-export', undefined, 'secondary'),
    ) +
    `<div class="notice"><span><strong>Append-only history</strong> &nbsp; Browser users cannot alter or delete these records. Every manual punch correction requires a reason.</span></div>` +
    panel(
      'Privileged activity log',
      'Timestamps use ' + tz(),
      table(
        ['Timestamp', 'Actor', 'Action / entity', 'Reason', 'Original values', 'Updated values'],
        data.audit
          .filter((a) => {
            const date = todayIn(tz(), new Date(a.created_at));
            return date >= from && date <= to;
          })
          .map(
            (a) =>
              `<tr><td>${esc(formatDate(todayIn(tz(), new Date(a.created_at))))}<div class="person-id">${esc(formatTime(a.created_at, tz()))}</div></td><td>${esc(name(a.actor_id))}</td><td>${esc(a.action)}<div class="person-id">${esc(a.entity_id)}</div></td><td>${esc(a.reason)}</td><td><details><summary class="panel-link">View original</summary><pre class="audit-values">${esc(JSON.stringify(a.old_values, null, 2))}</pre></details></td><td><details><summary class="panel-link">View updated</summary><pre class="audit-values">${esc(JSON.stringify(a.new_values, null, 2))}</pre></details></td></tr>`,
          ),
      ),
    )
  );
}
function renderProfile(compact = false): string {
  const e = person(context.profile.id);
  if (!e)
    return (
      heading('Your employee profile.') +
      '<p class="empty">Your profile is unavailable. Contact an administrator.</p>'
    );
  const d = currentEmployeeDay(e);
  const shift = data.shifts.find((s) => s.id === e.shift_id);
  const history = [...new Set(data.attendance.filter((a) => a.user_id === e.id).map((a) => a.work_date))]
    .sort()
    .reverse();
  return (
    (compact
      ? `<div class="page-heading"><div><div class="eyebrow">Your employee workspace</div><h1>Welcome back, ${esc(e.full_name.split(' ')[0])}</h1><p>Your attendance, shift, and deployment in one place.</p></div><span class="date-chip">${esc(formatDate(today()))}</span></div>`
      : heading('Your personal information, attendance, and upcoming assignments.')) +
    `<div class="kpi-grid">${kpi('Attendance status', d.status, `Work date ${d.workDate}`, 'shield', 'green')}${kpi('Check-in time', formatTime(d.summary.firstIn, tz()), tz(), 'login')}${kpi('Working hours', formatHours(d.summary.workMs), 'Excludes break time', 'stopwatch')}${kpi('Check-out time', formatTime(d.summary.lastOut, tz()), `${formatHours(d.summary.breakMs)} total break time`, 'logout')}</div>` +
    `<div class="dashboard-grid">${panel(
      'My employee profile',
      '',
      `<div class="profile-hero"><span class="person-avatar">${esc(initials(e.full_name))}</span><div><h2>${esc(e.full_name)}</h2><p>${esc(e.employee_id)} · ${esc(e.designation)}</p></div>${e.is_demo ? pill('DEMO DATA') : ''}</div><div class="panel-body"><dl class="detail-list">${[
        ['Email', e.email],
        ['Gender', e.gender],
        ['Department', e.department],
        ['Assigned floor', floorName(e.floor_id)],
        ['Assigned shift', shiftName(e.shift_id)],
        [
          'Shift timing',
          shift ? `${formatClockTime(shift.start_time)} – ${formatClockTime(shift.end_time)}` : 'Unassigned',
        ],
        ['Contact', e.contact_number],
        ['Joining date', e.joining_date],
        ['Employment', e.employment_status],
        ['Secondary duty', e.secondary_duty ?? 'None'],
      ]
        .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v ?? '—')}</dd></div>`)
        .join('')}</dl></div>`,
    )}${panel('Attendance actions', 'Attendance recorded in ' + tz(), `<div class="panel-body"><p class="subtext">${esc(floorName(e.floor_id))} · ${esc(shiftName(e.shift_id))} shift</p><div class="actions profile-attendance-actions">${ALLOWED_ACTIONS[d.summary.state].map((action) => button(`${icon(action === 'time_in' ? 'login' : action === 'time_out' ? 'logout' : 'coffee')}${EVENT_LABELS[action]}`, 'punch', action, action === 'time_out' ? 'secondary' : '')).join('')}</div><a class="panel-link" href="/leave-request">Request leave ↗</a><hr class="section-divider"><h3 class="panel-title">Upcoming shift schedule</h3><div class="schedule-list">${[1, 2, 3].map((n) => `<div class="schedule-day">${esc(addDays(today(), n))}<strong>${esc(shift?.name ?? 'Unassigned')}</strong><span>${shift ? esc(shift.start_time.slice(0, 5) + ' – ' + shift.end_time.slice(0, 5)) : ''}</span><span style="display:block">${esc(floorName(e.floor_id))}</span></div>`).join('')}</div><p class="field-note">Recurring assignment; changes are managed by your supervisor.</p></div>`)}</div>` +
    panel(
      'My attendance history',
      'Overnight sessions remain on the shift start date',
      table(
        ['Work date', 'Check in', 'Check out', 'Worked', 'Status'],
        history.map((date) => {
          const r = employeeDay(employeeForDate(e, data, date, tz()), data, date, tz(), Date.now(), grace());
          return `<tr><td>${esc(formatDate(date))}</td><td>${esc(formatTime(r.summary.firstIn, tz()))}</td><td>${esc(formatTime(r.summary.lastOut, tz()))}</td><td>${esc(formatHours(r.summary.workMs))}</td><td>${pill(r.status)}</td></tr>`;
        }),
      ),
    )
  );
}

function render(): void {
  if (!data) return;
  const renderers: Record<OperationsPage, () => string> = {
    overview: renderOverview,
    employees: renderEmployees,
    attendance: renderAttendance,
    floors: renderFloors,
    shifts: renderShifts,
    patrols: renderPatrols,
    gsoc: renderGsoc,
    supervisor: renderSupervisor,
    management: renderManagement,
    reports: renderReports,
    settings: renderSettings,
    audit: renderAudit,
    profile: () => renderProfile(),
  };
  root.innerHTML = renderers[page]();
  byId('pageLabel').textContent = titles[page];
  document.title = `${titles[page]} · Employee Portal`;
  highlightOperation(page);
}
async function reload(): Promise<void> {
  if (loading) return;
  loading = true;
  byId('connectionState').textContent = 'Syncing';
  byId('connectionState').dataset.state = 'loading';
  try {
    const currentFrom = addDays(today(), -1);
    const [history, current] = await Promise.all([
      api.snapshot(from, to),
      from > currentFrom || to < today() ? api.snapshot(currentFrom, today()) : Promise.resolve(null),
    ]);
    data = current ? mergeSnapshots(history, current) : history;
    render();
    byId('connectionState').textContent = 'Up to date';
    byId('connectionState').dataset.state = 'ready';
    byId('footerZone').textContent = `${tz()} · Updated ${formatTime(new Date().toISOString(), tz())}`;
  } catch (error) {
    byId('connectionState').textContent = 'Connection issue';
    byId('connectionState').dataset.state = 'error';
    throw error;
  } finally {
    loading = false;
  }
}
function navigate(): void {
  const next = location.hash.slice(1) || 'overview';
  page = (
    canAccess(context.profile.role, next, person(context.profile.id)?.secondary_duty) ? next : 'overview'
  ) as OperationsPage;
  selectedShift = '';
  selectedFloor = '';
  search = '';
  statusFilter = '';
  render();
  closeNavigation();
}
function field(
  label: string,
  name: string,
  value: unknown = '',
  type = 'text',
  required = true,
  full = false,
): string {
  return `<div class="field ${full ? 'full' : ''}"><label for="f_${name}">${esc(label)}</label><input id="f_${name}" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''}${type === 'password' ? ' minlength="12"' : ''}></div>`;
}
function textField(label: string, name: string, value = '', required = false): string {
  return `<div class="field full"><label for="f_${name}">${esc(label)}</label><textarea id="f_${name}" name="${name}" maxlength="2000" ${required ? 'required' : ''}>${esc(value)}</textarea></div>`;
}
function selectField(
  label: string,
  key: string,
  options: { value: string | number; label: string }[],
  value: unknown = '',
  required = true,
): string {
  return `<div class="field"><label for="f_${key}">${esc(label)}</label><select id="f_${key}" name="${key}" ${required ? 'required' : ''}>${!required ? '<option value="">Unassigned</option>' : ''}${options.map((o) => `<option value="${esc(o.value)}" ${String(value) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
}
const listOptions = (list: { id: number; name: string }[]) =>
  list.map((o) => ({ value: o.id, label: o.name }));
const employeesOptions = (employees: Pick<Employee, 'id' | 'full_name' | 'employee_id' | 'role'>[]) =>
  employees.map((e) => ({ value: e.id, label: `${e.full_name} · ${e.employee_id ?? ROLE_LABELS[e.role]}` }));
function openForm(
  title: string,
  body: string,
  onSave: (values: Record<string, string>) => Promise<void>,
  submitLabel = 'Save changes',
): void {
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialogTitle">${esc(title)}</h2><button class="close-button" type="button" data-close aria-label="Close dialog">×</button></div><div class="dialog-body"><form class="dialog-form" id="modalForm">${body}<div class="form-error" id="modalError" role="alert"></div><div class="dialog-footer"><button class="btn secondary" type="button" data-close>Cancel</button><button class="btn" type="submit">${esc(submitLabel)}</button></div></form></div>`;
  dialog.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => dialog.close()));
  dialog.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    submit.disabled = true;
    byId('modalError').textContent = '';
    onSave(values)
      .then(() => {
        dialog.close();
        toast('Changes saved');
        return reload();
      })
      .catch((error) => {
        byId('modalError').textContent = errorMessage(error);
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
  dialog.showModal();
}
function openDetails(title: string, body: string): void {
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialogTitle">${esc(title)}</h2><button class="close-button" type="button" aria-label="Close dialog">×</button></div><div class="dialog-body">${body}</div>`;
  dialog.querySelector('button')?.addEventListener('click', () => dialog.close());
  dialog.showModal();
}
async function write(action: MutationAction, payload: Record<string, unknown>): Promise<void> {
  await api.mutate(action, payload);
}
function editEmployee(e?: Employee): void {
  if (!isAdmin() && e) {
    openForm(
      `Transfer ${e.full_name}`,
      selectField('Assigned floor', 'floor_id', listOptions(data.floors), e.floor_id) +
        selectField('Assigned shift', 'shift_id', listOptions(data.shifts), e.shift_id) +
        textField('Reason', 'reason', '', true),
      async (v) =>
        write('employee.update', {
          id: e.id,
          floor_id: Number(v.floor_id),
          shift_id: Number(v.shift_id),
          reason: v.reason,
        }),
    );
    return;
  }
  const fields =
    field('Full name', 'full_name', e?.full_name) +
    field('Employee ID', 'employee_id', e?.employee_id) +
    (!e
      ? field('Email address', 'email', '', 'email') +
        field('Initial password (12+ characters)', 'password', '', 'password')
      : '') +
    field('Department', 'department', e?.department ?? 'Security Operations') +
    selectField(
      'Gender',
      'gender',
      ['Male', 'Female'].map((v) => ({ value: v, label: v })),
      e?.gender ?? 'Male',
    ) +
    field('Designation', 'designation', e?.designation ?? 'Security Staff') +
    selectField(
      'Access role',
      'role',
      Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
      e?.role ?? 'security',
    ) +
    selectField('Assigned floor', 'floor_id', listOptions(data.floors), e?.floor_id, false) +
    selectField('Assigned shift', 'shift_id', listOptions(data.shifts), e?.shift_id, false) +
    field('Secondary duty', 'secondary_duty', e?.secondary_duty ?? '', 'text', false) +
    field('Contact number', 'contact_number', e?.contact_number ?? '', 'text', false) +
    field('Joining date', 'joining_date', e?.joining_date ?? today(), 'date') +
    (e
      ? selectField(
          'Employment status',
          'employment_status',
          ['Active', 'Inactive'].map((v) => ({ value: v, label: v })),
          e.employment_status,
        )
      : '') +
    textField('Change reason', 'reason', '', true) +
    (e
      ? `<p class="field-note full">Deactivation retains attendance and audit history. Password changes are handled separately from this profile.</p>`
      : '');
  openForm(
    e ? 'Edit employee' : 'Create employee account',
    fields,
    async (v) => {
      const payload = {
        ...v,
        floor_id: v.floor_id ? Number(v.floor_id) : null,
        shift_id: v.shift_id ? Number(v.shift_id) : null,
      };
      if (e) await write('employee.update', { ...payload, id: e.id });
      else
        await api.createEmployee({
          ...payload,
          email: v.email ?? '',
          password: v.password ?? '',
          full_name: v.full_name ?? '',
          employee_id: v.employee_id ?? '',
          department: v.department ?? '',
          gender: v.gender as 'Male' | 'Female',
          designation: v.designation ?? '',
          role: v.role as Role,
          secondary_duty: v.secondary_duty ?? null,
          contact_number: v.contact_number ?? null,
          joining_date: v.joining_date ?? today(),
          avatar_url: null,
          employment_status: 'Active',
        });
    },
    e ? 'Save employee' : 'Create account',
  );
}
function correctAttendance(e: Employee): void {
  const d = employeeDay(employeeForDate(e, data, day, tz()), data, day, tz(), Date.now(), grace());
  openForm(
    `Correct attendance · ${e.employee_id}`,
    `<div class="notice full"><span>Times use ${esc(tz())}. All original punches are retained in immutable audit history. Existing break segments are preserved and must remain within the corrected login and logout times.</span></div>` +
      field('Work date', 'work_date', day, 'date') +
      field('Login time', 'login_at', toLocalInput(d.summary.firstIn, tz()), 'datetime-local', false) +
      field('Logout time', 'logout_at', toLocalInput(d.summary.lastOut, tz()), 'datetime-local', false) +
      textField('Required reason for correction', 'reason', '', true),
    async (v) =>
      write('attendance.correct', {
        user_id: e.id,
        original_work_date: day,
        work_date: v.work_date,
        login_at: v.login_at ? localToIso(v.login_at, tz()) : null,
        logout_at: v.logout_at ? localToIso(v.logout_at, tz()) : null,
        reason: v.reason,
      }),
    'Apply audited correction',
  );
}
function editFloor(id?: number): void {
  const f = data.floors.find((f) => f.id === id);
  openForm(
    f ? 'Edit building floor' : 'Add building floor',
    field('Floor name', 'name', f?.name) +
      field('Location', 'location', f?.location) +
      field('Required staff per shift', 'required_staff', f?.required_staff ?? 3, 'number'),
    async (v) =>
      write('floor.save', { ...v, required_staff: Number(v.required_staff), ...(id ? { id } : {}) }),
  );
}
function editShifts(): void {
  openForm(
    'Configure all three shifts',
    `<p class="field-note full">Each shift must cover eight hours. The three shifts must cover the day without overlapping.</p>` +
      data.shifts
        .map(
          (s) =>
            `<div class="full"><strong>${esc(s.name)} shift</strong></div>${field('Starts', 'start_' + s.id, s.start_time.slice(0, 5), 'time')}${field('Ends', 'end_' + s.id, s.end_time.slice(0, 5), 'time')}`,
        )
        .join(''),
    async (v) =>
      write('shift.save', {
        shifts: data.shifts.map((s) => ({
          ...s,
          start_time: v['start_' + s.id],
          end_time: v['end_' + s.id],
        })),
      }),
  );
}
function createIncident(): void {
  const self = person(context.profile.id);
  const permittedFloors = ['admin', 'asm', 'gsoc'].includes(context.profile.role)
    ? data.floors
    : data.floors.filter(
        (f) =>
          f.id === self?.floor_id ||
          (context.profile.role === 'supervisor' &&
            data.employees.some(
              (e) => e.shift_id === self?.shift_id && e.floor_id === f.id && e.employment_status === 'Active',
            )) ||
          data.patrols.some(
            (p) => p.officer_id === context.profile.id && p.floor_id === f.id && p.status === 'In Progress',
          ),
      );
  openForm(
    'Report a security incident',
    selectField(
      'Category',
      'category',
      [
        'Access control',
        'Safety hazard',
        'Suspicious activity',
        'Equipment fault',
        'Medical assistance',
        'Other',
      ].map((v) => ({ value: v, label: v })),
    ) +
      selectField('Floor', 'floor_id', listOptions(permittedFloors)) +
      selectField(
        'Severity',
        'severity',
        ['Low', 'Medium', 'High', 'Critical'].map((v) => ({ value: v, label: v })),
        'Low',
      ) +
      textField('Incident description', 'description', '', true),
    async (v) => write('incident.create', { ...v, floor_id: Number(v.floor_id) }),
    'Submit incident',
  );
}
function updateIncident(i: Incident): void {
  if (!canManageIncidents(context.profile.role)) {
    openDetails(
      `INC-${i.id} · ${i.category}`,
      `<p>${esc(i.description)}</p><p>${pill(i.severity)} ${pill(i.status)}</p><p class="subtext">${esc(i.resolution || 'No resolution remarks yet.')}</p>`,
    );
    return;
  }
  openForm(
    `Manage incident INC-${i.id}`,
    `<p class="full subtext">${esc(i.description)}<br>${esc(floorName(i.floor_id))} · Reported by ${esc(name(i.reported_by))}</p>` +
      selectField(
        'Status',
        'status',
        ['Open', 'Pending', 'Escalated', 'Resolved'].map((v) => ({ value: v, label: v })),
        i.status,
      ) +
      selectField(
        'Severity',
        'severity',
        ['Low', 'Medium', 'High', 'Critical'].map((v) => ({ value: v, label: v })),
        i.severity,
      ) +
      selectField(
        'Assigned controller',
        'controller_id',
        employeesOptions(data.employees.filter((e) => e.role === 'controller')),
        i.controller_id,
        false,
      ) +
      selectField(
        'Assigned GSOC analyst',
        'analyst_id',
        employeesOptions(data.employees.filter((e) => e.role === 'gsoc')),
        i.analyst_id,
        false,
      ) +
      textField('Resolution / update remarks', 'resolution', i.resolution),
    async (v) => write('incident.update', { ...v, id: i.id }),
  );
}
function createPatrol(): void {
  openForm(
    'Schedule a patrol round',
    selectField(
      'Patrolling officer',
      'officer_id',
      employeesOptions(
        data.employees.filter((e) => e.role === 'patrol' || e.secondary_duty === 'Patrolling Officer'),
      ),
    ) +
      selectField('Shift', 'shift_id', listOptions(data.shifts)) +
      selectField('Floor', 'floor_id', listOptions(data.floors)) +
      selectField('Patrol route', 'route_id', listOptions(data.patrolRoutes)) +
      field(
        'Scheduled start',
        'scheduled_at',
        `${today()}T${new Date().toLocaleTimeString('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit' })}`,
        'datetime-local',
      ),
    async (v) =>
      write('patrol.create', {
        ...v,
        shift_id: Number(v.shift_id),
        floor_id: Number(v.floor_id),
        route_id: Number(v.route_id),
        scheduled_at: localToIso(v.scheduled_at ?? '', tz()),
      }),
    'Schedule round',
  );
}
function updatePatrol(p: PatrolRecord): void {
  const statuses =
    p.status === 'Scheduled'
      ? ['In Progress', ...(manage() ? ['Missed'] : [])]
      : p.status === 'In Progress'
        ? ['In Progress', 'Completed', 'Incident Reported']
        : [p.status];
  openForm(
    `Record patrol PAT-${p.id}`,
    `<p class="full subtext">${esc(name(p.officer_id))} · ${esc(floorName(p.floor_id))}<br>Started ${esc(formatTime(p.started_at, tz()))} · Completed ${esc(formatTime(p.completed_at, tz()))}</p>` +
      selectField(
        'Patrol status',
        'status',
        statuses.map((v) => ({ value: v, label: v })),
        p.status,
      ) +
      selectField(
        'Linked incident',
        'incident_id',
        data.incidents
          .filter((i) => i.floor_id === p.floor_id)
          .map((i) => ({ value: i.id, label: `INC-${i.id} · ${i.category}` })),
        p.incident_id,
        false,
      ) +
      textField('Patrol observations', 'observations', p.observations),
    async (v) =>
      write('patrol.update', { ...v, id: p.id, incident_id: v.incident_id ? Number(v.incident_id) : null }),
    'Record activity',
  );
}
function createHandover(): void {
  const me = person(context.profile.id);
  openForm(
    'Submit shift handover',
    selectField(
      'Outgoing shift',
      'shift_id',
      listOptions(data.shifts.filter((s) => context.profile.role !== 'supervisor' || s.id === me?.shift_id)),
      me?.shift_id,
    ) +
      selectField(
        'Incoming supervisor',
        'incoming_id',
        employeesOptions(
          (data.handoverRecipients ?? data.employees.filter((e) => e.role === 'supervisor')).filter(
            (e) => e.id !== context.profile.id,
          ),
        ),
      ) +
      field('Shift work date', 'shift_date', today(), 'date') +
      selectField(
        'Status',
        'status',
        ['Draft', 'Submitted'].map((v) => ({ value: v, label: v })),
        'Submitted',
      ) +
      textField('Pending incidents', 'pending_incidents') +
      textField('Manpower shortages', 'shortages') +
      textField('Important observations', 'observations', '', true),
    async (v) => write('handover.create', { ...v, shift_id: Number(v.shift_id) }),
    'Submit handover',
  );
}
function viewHandover(id: number): void {
  const h = data.handovers.find((h) => h.id === id);
  if (!h) return;
  const body = `<p class="full subtext">${esc(name(h.outgoing_id))} → ${esc(name(h.incoming_id))} · ${esc(h.shift_date)}</p><div class="full">${pill(h.status)}</div>${textField('Pending incidents', 'pending_incidents', h.pending_incidents)}${textField('Manpower shortages', 'shortages', h.shortages)}${textField('Observations', 'observations', h.observations)}`;
  if (
    h.status === 'Draft' &&
    (h.outgoing_id === context.profile.id || isAdmin() || context.profile.role === 'asm')
  )
    openForm(
      'Submit draft handover',
      body,
      async (v) =>
        write('handover.update', {
          id: h.id,
          status: 'Submitted',
          pending_incidents: v.pending_incidents,
          shortages: v.shortages,
          observations: v.observations,
        }),
      'Submit handover',
    );
  else if (
    h.status === 'Submitted' &&
    (h.incoming_id === context.profile.id || isAdmin() || context.profile.role === 'asm')
  )
    openForm(
      'Acknowledge handover',
      body,
      async () => write('handover.update', { id: h.id, status: 'Acknowledged' }),
      'Acknowledge receipt',
    );
  else
    openDetails(
      'Shift handover',
      `<p>${esc(name(h.outgoing_id))} → ${esc(name(h.incoming_id))}</p>${pill(h.status)}<h4>Pending incidents</h4><p>${esc(h.pending_incidents || 'None')}</p><h4>Shortages</h4><p>${esc(h.shortages || 'None')}</p><h4>Observations</h4><p>${esc(h.observations || 'None')}</p>`,
    );
}
async function importCsv(): Promise<void> {
  openForm(
    'Import employee updates',
    `<p class="field-note full">Import updates to existing employee accounts by employee_id. Required columns: employee_id. Supported columns: full_name, department, gender, designation, secondary_duty, floor_id, shift_id, employment_status. New accounts are created with Add employee.</p><div class="field full"><label for="importFile">CSV file</label><input type="file" id="importFile" accept=".csv,text/csv" required></div><p class="field-note full">Changes are validated and audited individually. If a row fails, earlier successful rows remain saved; the result lists failures.</p>`,
    async () => {
      const file = byId<HTMLInputElement>('importFile').files?.[0];
      if (!file) throw new Error('Select a CSV file.');
      const lines = parseCsv(await file.text());
      const headers = lines.shift() ?? [];
      if (!headers.includes('employee_id')) throw new Error('CSV requires employee_id header.');
      const allowed = [
        'employee_id',
        'full_name',
        'department',
        'gender',
        'designation',
        'secondary_duty',
        'floor_id',
        'shift_id',
        'employment_status',
      ];
      const errors: string[] = [];
      let count = 0;
      for (let idx = 0; idx < lines.length; idx++) {
        const cells = lines[idx];
        if (!cells?.some(Boolean)) continue;
        const row = Object.fromEntries(headers.map((key, i) => [key.trim(), cells[i] ?? '']));
        const employee = data.employees.find((e) => e.employee_id === row.employee_id);
        if (!employee) {
          errors.push(`Row ${idx + 2}: employee ${row.employee_id} not found`);
          continue;
        }
        const payload: Record<string, unknown> = { id: employee.id, reason: 'CSV employee import' };
        for (const key of allowed) {
          if (key === 'employee_id' || row[key] === undefined) continue;
          payload[key] = ['floor_id', 'shift_id'].includes(key)
            ? row[key]
              ? Number(row[key])
              : null
            : row[key];
        }
        try {
          await write('employee.update', payload);
          count++;
        } catch (e) {
          errors.push(`Row ${idx + 2}: ${errorMessage(e)}`);
        }
      }
      if (errors.length) {
        await reload();
        throw new Error(`${count} rows saved. ${errors.slice(0, 8).join('; ')}`);
      }
      toast(`${count} employees imported`);
    },
    'Import and validate',
  );
}
function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quote = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quote && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quote = !quote;
    } else if (c === ',' && !quote) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quote) {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quote) throw new Error('CSV has an unclosed quoted field.');
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
async function action(action: string, id: string | undefined): Promise<void> {
  const e = id ? person(id) : undefined;
  switch (action) {
    case 'employee-create':
      editEmployee();
      break;
    case 'employee-edit':
      if (e) editEmployee(e);
      break;
    case 'employee-view':
      if (e) {
        openDetails(
          e.full_name,
          `<div class="profile-hero">${employeeCell(e)}</div><dl class="detail-list">${[
            ['Designation', e.designation],
            ['Email', e.email],
            ['Department', e.department],
            ['Gender', e.gender],
            ['Floor', floorName(e.floor_id)],
            ['Shift', shiftName(e.shift_id)],
            ['Employment', e.employment_status],
            ['Joining date', e.joining_date],
            ['Contact', e.contact_number],
          ]
            .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v ?? 'Restricted')}</dd></div>`)
            .join(
              '',
            )}</dl>${isAdmin() ? `<div style="margin-top:22px">${button('Reset password', 'password-reset', e.id, 'secondary')}</div>` : ''}`,
        );
      }
      break;
    case 'password-reset':
      if (e)
        openForm(
          'Reset employee password',
          `<p class="field-note full">Set a unique password for ${esc(e.full_name)}. Existing sessions are revoked by the Auth service where supported.</p>` +
            field('New password (12+ characters)', 'password', '', 'password'),
          async (v) => {
            await api.resetPassword(e.id, v.password ?? '');
          },
          'Reset password',
        );
      break;
    case 'employee-import':
      await importCsv();
      break;
    case 'employee-export':
      downloadCsv('employees.csv', [
        [
          'employee_id',
          'full_name',
          'department',
          'gender',
          'designation',
          'secondary_duty',
          'floor_id',
          'shift_id',
          'employment_status',
        ],
        ...filteredEmployees().map((e) => [
          e.employee_id ?? '',
          e.full_name,
          e.department,
          e.gender,
          e.designation,
          e.secondary_duty ?? '',
          e.floor_id ?? '',
          e.shift_id ?? '',
          e.employment_status,
        ]),
      ]);
      break;
    case 'attendance-correct':
      if (e) correctAttendance(e);
      break;
    case 'attendance-export':
      downloadCsv(`attendance-${day}.csv`, exportRows('daily', day, day));
      break;
    case 'export-overview':
      downloadCsv(`attendance-${today()}.csv`, exportRows('daily', today(), today()));
      break;
    case 'audit-export':
      downloadCsv('audit-history.csv', exportRows('audit', from, to));
      break;
    case 'report-export':
      downloadCsv(`${reportType}-${from}-${to}.csv`, exportRows(reportType, from, to));
      break;
    case 'go-audit':
      location.hash = 'audit';
      break;
    case 'range-apply':
      if (!from || !to || from > to) throw new Error('Choose a valid start and end date.');
      await reload();
      break;
    case 'floor-create':
      editFloor();
      break;
    case 'floor-edit':
      editFloor(Number(id));
      break;
    case 'floor-view': {
      const floor = data.floors.find((f) => f.id === Number(id));
      if (floor)
        openDetails(
          `${floor.name} · ${floor.location}`,
          table(
            ['Employee', 'Designation', 'Shift', 'Status'],
            data.employees
              .filter(
                (e) => e.floor_id === floor.id && (!selectedShift || e.shift_id === Number(selectedShift)),
              )
              .map(
                (e) =>
                  `<tr><td>${employeeCell(e)}</td><td>${esc(e.designation)}</td><td>${esc(shiftName(e.shift_id))}</td><td>${pill(currentEmployeeDay(e).status)}</td></tr>`,
              ),
          ),
        );
      break;
    }
    case 'shift-edit':
      editShifts();
      break;
    case 'incident-create':
      createIncident();
      break;
    case 'incident-update': {
      const i = data.incidents.find((i) => i.id === Number(id));
      if (i) updateIncident(i);
      break;
    }
    case 'patrol-create':
      createPatrol();
      break;
    case 'patrol-update': {
      const p = data.patrols.find((p) => p.id === Number(id));
      if (p) updatePatrol(p);
      break;
    }
    case 'patrol-view': {
      const p = data.patrols.find((p) => p.id === Number(id));
      if (p)
        openDetails(
          `Patrol PAT-${p.id}`,
          `<p>${esc(name(p.officer_id))} · ${esc(floorName(p.floor_id))}</p>${pill(p.status)}<p>${esc(p.observations || 'No observations recorded.')}</p>`,
        );
      break;
    }
    case 'route-create':
      openForm(
        'Create patrol route',
        field('Route name', 'name') + field('Floor IDs (comma separated)', 'floor_ids', '1,2,3'),
        async (v) =>
          write('patrol.route', {
            name: v.name,
            floor_ids: v.floor_ids?.split(',').map((s) => Number(s.trim())),
          }),
        'Create route',
      );
      break;
    case 'handover-create':
      createHandover();
      break;
    case 'handover-view':
      viewHandover(Number(id));
      break;
    case 'punch':
      await attendanceApi.record(id as EventType);
      toast('Attendance recorded');
      await reload();
      break;
  }
}
function handleError(error: unknown): void {
  toast(errorMessage(error), 'error');
}
root.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const report = target.closest<HTMLElement>('[data-report]');
  if (report) {
    reportType = report.dataset.report as ReportType;
    render();
    return;
  }
  const floor = target.closest<HTMLElement>('[data-floor-link]');
  if (floor) {
    event.preventDefault();
    page = 'floors';
    location.hash = 'floors';
    setTimeout(() => {
      selectedFloor = floor.dataset.floorLink ?? '';
      render();
    }, 0);
    return;
  }
  const el = target.closest<HTMLElement>('[data-action]');
  if (el) {
    action(el.dataset.action ?? '', el.dataset.id).catch(handleError);
  }
});
dialog.addEventListener('click', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (el) {
    dialog.close();
    action(el.dataset.action ?? '', el.dataset.id).catch(handleError);
  }
});
root.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.target as HTMLElement).matches('[role="button"][data-action]'))
    (event.target as HTMLElement).click();
});
root.addEventListener('change', (event) => {
  const el = event.target as HTMLInputElement;
  switch (el.dataset.filter) {
    case 'shift':
      selectedShift = el.value;
      render();
      break;
    case 'floor':
      selectedFloor = el.value;
      render();
      break;
    case 'status':
      statusFilter = el.value;
      render();
      break;
    case 'day':
      day = el.value;
      if (day < from || day > to) {
        from = addDays(day, -1);
        to = day;
        reload().catch(handleError);
      } else render();
      break;
    case 'from':
      from = el.value;
      break;
    case 'to':
      to = el.value;
      break;
  }
});
let searchTimer: number | undefined;
root.addEventListener('input', (event) => {
  const el = event.target as HTMLInputElement;
  if (el.dataset.filter !== 'search') return;
  search = el.value;
  const pos = el.selectionStart;
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    render();
    const input = root.querySelector<HTMLInputElement>('[data-filter="search"]');
    input?.focus();
    if (input && pos !== null) input.setSelectionRange(pos, pos);
  }, 180);
});
async function start(): Promise<void> {
  context = await bootstrapPage('operations');
  day = today();
  from = addDays(day, -30);
  to = day;
  byId('footerZone').textContent = `${tz()} · Server-authorized operations`;
  await reload();
  navigate();
  window.addEventListener('hashchange', navigate);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !dialog.open) reload().catch(handleError);
  });
  window.setInterval(() => {
    if (!document.hidden && !dialog.open) reload().catch(handleError);
  }, 60_000);
}
start().catch((error) => {
  root.innerHTML = `<div class="loading-state"><h2>Workspace could not be opened</h2><p>${esc(errorMessage(error))}</p><p>Apply the security operations migration to the existing Supabase project, then reload.</p><a class="btn secondary" href="/employee">Open original employee dashboard</a><button class="btn" style="margin-left:8px" type="button" onclick="location.reload()">Retry connection</button></div>`;
});
