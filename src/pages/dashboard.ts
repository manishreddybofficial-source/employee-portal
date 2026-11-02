import * as attendanceApi from '../api/attendance';
import * as operationsApi from '../api/operations';
import { bootstrapPage } from '../layout/shell';
import { ALLOWED_ACTIONS, EVENT_LABELS, STATE_LABELS, isOpen, summarize } from '../lib/attendance';
import { badge, byId, emptyRow, escapeHtml, safely, startPage, toast } from '../lib/dom';
import { employeeDay, employeeForDate, shiftBounds, shiftWorkDate } from '../lib/operations';
import { addDays, formatClock, formatClockTime, formatDate, formatTime, todayIn } from '../lib/time';
import type { AttendanceEvent, EventType, Tone } from '../types/models';
import type { Employee, OperationsSnapshot } from '../types/operations';

function logStatus(event: AttendanceEvent, isFirstTimeIn: boolean, late: boolean): [string, Tone] {
  if (isFirstTimeIn) return late ? ['Late', 'red'] : ['On Time', 'green'];
  switch (event.event_type) {
    case 'time_in':
      return ['Checked In', 'green'];
    case 'break_start':
      return ['On Break', 'amber'];
    case 'break_end':
      return ['Back to Work', 'blue'];
    case 'time_out':
      return event.auto ? ['Auto Time-Out', 'amber'] : ['Checked Out', ''];
  }
}

startPage(async () => {
  const { profile, office } = await bootstrapPage('dashboard');
  const tz = office.timezone;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-event]'));
  const ui = {
    card: byId('statusCard'),
    status: byId('status'),
    checkIn: byId('checkIn'),
    work: byId('workDur'),
    breaks: byId('breakDur'),
    hint: byId('actionsSub'),
    log: byId('log'),
  };
  let events: AttendanceEvent[] = [];
  let operations: OperationsSnapshot;
  let employee: Employee;
  let displayDay = todayIn(tz);

  function renderProfile(): void {
    const floor = operations.floors.find((item) => item.id === employee.floor_id);
    const shift = operations.shifts.find((item) => item.id === employee.shift_id);
    byId('welcomeName').textContent = `Welcome, ${employee.full_name.split(' ')[0] || 'colleague'}`;
    byId('employeeIdentity').textContent = [
      employee.employee_id || 'Employee',
      employee.designation,
      employee.gender,
    ].join(' · ');
    byId('employeeInitials').textContent = employee.full_name
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join('');
    byId('employeeDemo').hidden = !employee.is_demo;
    byId('employeeAssignment').innerHTML =
      `<div><span>Assigned floor</span><strong>${escapeHtml(floor?.name || 'Not assigned')}</strong><small>${escapeHtml(floor?.location || 'Contact your supervisor for deployment.')}</small></div>
      <div><span>Assigned shift</span><strong>${escapeHtml(shift?.name || 'Not assigned')}</strong><small>${shift ? `${formatClockTime(shift.start_time)} – ${formatClockTime(shift.end_time)}` : 'No upcoming shift allocated'}</small></div>
      <div><span>Employment status</span><strong>${escapeHtml(employee.employment_status)}</strong><small>${escapeHtml(employee.department)}</small></div>`;
    if (shift) {
      const workDate = shiftWorkDate(shift, tz);
      const bounds = shiftBounds(shift, workDate, tz);
      const nextDate = Date.now() < bounds.start ? workDate : addDays(workDate, 1);
      byId('upcomingShift').textContent =
        `Next shift: ${formatDate(nextDate)}, ${formatClockTime(shift.start_time)} – ${formatClockTime(shift.end_time)} · ${tz}`;
    } else byId('upcomingShift').textContent = 'A supervisor will assign your next shift.';
  }

  function renderTimers(): void {
    const summary = summarize(events);
    ui.status.textContent = STATE_LABELS[summary.state];
    ui.status.className = `value s-${summary.state}`;
    ui.card.dataset.state = summary.state;
    ui.checkIn.textContent = formatTime(summary.firstIn, tz);
    ui.work.textContent = formatClock(summary.workMs);
    ui.breaks.textContent = formatClock(summary.breakMs);
    byId('lastCheckout').textContent =
      `Check-out: ${formatTime(summary.lastOut, tz)} · Work date: ${displayDay}`;
  }

  function renderLog(): void {
    const firstTimeIn = events.findIndex((e) => e.event_type === 'time_in');
    const assigned = employeeForDate(employee, operations, displayDay, tz);
    const late = employeeDay(
      assigned,
      { ...operations, attendance: events },
      displayDay,
      tz,
      Date.now(),
      office.grace_minutes,
    ).late;
    ui.log.innerHTML = events.length
      ? events
          .map((event, index) => {
            const [text, tone] = logStatus(event, index === firstTimeIn, late);
            return `<tr><td>${EVENT_LABELS[event.event_type]}</td><td class="num">${formatTime(event.created_at, tz)}</td><td>${badge(text, tone)}</td></tr>`;
          })
          .join('')
      : emptyRow(3, 'No activity recorded today.');

    const state = summarize(events).state;
    const allowed = ALLOWED_ACTIONS[state];
    buttons.forEach((button) => {
      const action = button.dataset.event as EventType;
      button.disabled = !allowed.includes(action);
      button.hidden =
        action === 'break_end' ? state !== 'break' : action === 'break_start' && state === 'break';
    });
  }

  async function load(): Promise<void> {
    const today = todayIn(tz);
    const [last, snapshot] = await Promise.all([
      attendanceApi.latestForUser(profile.id),
      operationsApi.snapshot(addDays(today, -1), today),
    ]);
    operations = snapshot;
    const current = operations.employees.find((person) => person.id === profile.id);
    if (!current) throw new Error('Your employee profile is unavailable. Contact your administrator.');
    employee = current;
    const shift = operations.shifts.find((item) => item.id === employee.shift_id);
    const lastEvents =
      last && isOpen(last)
        ? snapshot.attendance.some(
            (event) =>
              event.user_id === employee.id &&
              event.work_date === last.work_date &&
              event.event_type === 'time_in',
          )
          ? snapshot.attendance.filter(
              (event) => event.user_id === employee.id && event.work_date === last.work_date,
            )
          : await attendanceApi.listForUser(employee.id, last.work_date)
        : [];
    const stale =
      last !== null &&
      isOpen(last) &&
      employeeDay(employee, { ...operations, attendance: lastEvents }, last.work_date, tz).status ===
        'Missing checkout';
    const day = last && isOpen(last) && !stale ? last.work_date : shift ? shiftWorkDate(shift, tz) : today;
    displayDay = day;

    ui.hint.textContent =
      stale && last
        ? `Your session on ${formatDate(last.work_date)} was never timed out. It closes at the scheduled shift end when you check in.`
        : `Attendance for ${formatDate(day)} · ${tz}. Check-in and check-out use server time.`;

    events =
      last && day === last.work_date && lastEvents.length
        ? lastEvents
        : await attendanceApi.listForUser(profile.id, day);
    renderProfile();
    renderLog();
    renderTimers();
  }

  for (const button of buttons) {
    button.addEventListener(
      'click',
      safely(async () => {
        const action = button.dataset.event as EventType;
        buttons.forEach((b) => (b.disabled = true));
        try {
          await attendanceApi.record(action);
          toast(`${EVENT_LABELS[action]} recorded`);
        } finally {
          await load();
        }
      }),
    );
  }

  document.addEventListener(
    'visibilitychange',
    safely(async () => {
      if (!document.hidden) await load();
    }),
  );

  await load();
  window.setInterval(renderTimers, 1000);
});
