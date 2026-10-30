import { app } from '../config/app';
import type { AttendanceEvent, EventType, OfficeDetails, Tone, WorkState } from '../types/models';
import { minutesOfDay, parseClock, todayIn } from './time';

const HOUR_MS = 3_600_000;

export const EVENT_LABELS: Readonly<Record<EventType, string>> = {
  time_in: 'Time-In',
  break_start: 'Break Start',
  break_end: 'Break End',
  time_out: 'Time-Out',
};

export const STATE_LABELS: Readonly<Record<WorkState, string>> = {
  working: 'Checked In',
  break: 'On Break',
  out: 'Checked Out',
};

export const STATE_TONE: Readonly<Record<WorkState, Tone>> = { working: 'green', break: 'amber', out: '' };

/** Actions available in each state. Mirrors the checks in record_attendance(). */
export const ALLOWED_ACTIONS: Readonly<Record<WorkState, readonly EventType[]>> = {
  out: ['time_in'],
  working: ['break_start', 'time_out'],
  break: ['break_end', 'time_out'],
};

export interface DaySummary {
  state: WorkState;
  firstIn: string | null;
  lastOut: string | null;
  workMs: number;
  breakMs: number;
}

export interface DayReport {
  summary: DaySummary;
  status: string;
  tone: Tone;
}

/** Folds a day's events (oldest first) into totals. Open segments run until `until`. */
export function summarize(events: readonly AttendanceEvent[], until: number = Date.now()): DaySummary {
  const summary: DaySummary = { state: 'out', firstIn: null, lastOut: null, workMs: 0, breakMs: 0 };
  let segmentStart = 0;

  for (const event of events) {
    const at = Date.parse(event.created_at);
    switch (event.event_type) {
      case 'time_in':
        summary.state = 'working';
        summary.firstIn ??= event.created_at;
        summary.lastOut = null;
        segmentStart = at;
        break;
      case 'break_start':
        if (summary.state === 'working') {
          summary.workMs += at - segmentStart;
          summary.state = 'break';
          segmentStart = at;
        }
        break;
      case 'break_end':
        if (summary.state === 'break') {
          summary.breakMs += at - segmentStart;
          summary.state = 'working';
          segmentStart = at;
        }
        break;
      case 'time_out':
        if (summary.state === 'working') summary.workMs += at - segmentStart;
        if (summary.state === 'break') summary.breakMs += at - segmentStart;
        summary.state = 'out';
        summary.lastOut = event.created_at;
        break;
    }
  }

  if (summary.state === 'working') summary.workMs += until - segmentStart;
  if (summary.state === 'break') summary.breakMs += until - segmentStart;
  return summary;
}

export const isOpen = (event: AttendanceEvent): boolean => event.event_type !== 'time_out';

/** An open session from an earlier day that nobody closed. */
export function isStale(last: AttendanceEvent, timeZone: string, now: number = Date.now()): boolean {
  return (
    isOpen(last) &&
    last.work_date < todayIn(timeZone, new Date(now)) &&
    now - Date.parse(last.created_at) > app.staleSessionHours * HOUR_MS
  );
}

export function isActiveSession(events: readonly AttendanceEvent[], timeZone: string, now = Date.now()): boolean {
  const last = events.at(-1);
  return last !== undefined && isOpen(last) && !isStale(last, timeZone, now);
}

export function isLate(
  timestamp: string | null,
  office: Pick<OfficeDetails, 'timezone' | 'work_start' | 'grace_minutes'>,
): boolean {
  if (!timestamp) return false;
  return minutesOfDay(timestamp, office.timezone) > parseClock(office.work_start) + office.grace_minutes;
}

/** Totals plus a status badge for one work day. */
export function dayReport(events: readonly AttendanceEvent[], timeZone: string, now = Date.now()): DayReport {
  const last = events.at(-1);
  if (!last) return { summary: summarize([], now), status: 'Absent', tone: '' };

  const stale = isStale(last, timeZone, now);
  const summary = summarize(events, stale ? Date.parse(last.created_at) : now);

  if (isOpen(last)) {
    return stale
      ? { summary, status: 'Missing Time-Out', tone: 'red' }
      : { summary, status: 'In Progress', tone: 'blue' };
  }
  if (events.some((event) => event.auto)) return { summary, status: 'Auto Time-Out', tone: 'amber' };

  const hours = summary.workMs / HOUR_MS;
  if (hours >= app.fullDayHours) return { summary, status: 'Present', tone: 'green' };
  if (hours >= app.halfDayHours) return { summary, status: 'Half Day', tone: 'amber' };
  return { summary, status: 'Short Day', tone: 'red' };
}