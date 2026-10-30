import * as attendanceApi from '../api/attendance';
import { bootstrapPage } from '../layout/shell';
import { ALLOWED_ACTIONS, EVENT_LABELS, STATE_LABELS, isLate, isOpen, isStale, summarize } from '../lib/attendance';
import { badge, byId, emptyRow, safely, startPage, toast } from '../lib/dom';
import { formatClock, formatDate, formatTime, todayIn } from '../lib/time';
import type { AttendanceEvent, EventType, OfficeDetails, Tone } from '../types/models';

function logStatus(event: AttendanceEvent, isFirstTimeIn: boolean, office: OfficeDetails): [string, Tone] {
  if (isFirstTimeIn) return isLate(event.created_at, office) ? ['Late', 'red'] : ['On Time', 'green'];
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
    status: byId('status'),
    checkIn: byId('checkIn'),
    work: byId('workDur'),
    breaks: byId('breakDur'),
    hint: byId('actionsSub'),
    log: byId('log'),
  };
  let events: AttendanceEvent[] = [];

  function renderTimers(): void {
    const summary = summarize(events);
    ui.status.textContent = STATE_LABELS[summary.state];
    ui.status.className = `value s-${summary.state}`;
    ui.checkIn.textContent = formatTime(summary.firstIn, tz);
    ui.work.textContent = formatClock(summary.workMs);
    ui.breaks.textContent = formatClock(summary.breakMs);
  }

  function renderLog(): void {
    const firstTimeIn = events.findIndex((e) => e.event_type === 'time_in');
    ui.log.innerHTML = events.length
      ? events
          .map((event, index) => {
            const [text, tone] = logStatus(event, index === firstTimeIn, office);
            return `<tr><td>${EVENT_LABELS[event.event_type]}</td><td class="num">${formatTime(event.created_at, tz)}</td><td>${badge(text, tone)}</td></tr>`;
          })
          .join('')
      : emptyRow(3, 'No activity recorded today.');

    const allowed = ALLOWED_ACTIONS[summarize(events).state];
    buttons.forEach((button) => (button.disabled = !allowed.includes(button.dataset.event as EventType)));
  }

  async function load(): Promise<void> {
    const last = await attendanceApi.latestForUser(profile.id);
    const stale = last !== null && isStale(last, tz);
    const day = last && isOpen(last) && !stale ? last.work_date : todayIn(tz);

    ui.hint.textContent =
      stale && last
        ? `Your session on ${formatDate(last.work_date)} was never timed out. It closes at office closing time when you time in.`
        : 'Manage your daily attendance here.';

    events = await attendanceApi.listForUser(profile.id, day);
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