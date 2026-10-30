import { describe, expect, it } from 'vitest';
import { dayReport, isLate, summarize } from '../src/lib/attendance';
import { formatClock } from '../src/lib/time';
import type { AttendanceEvent, EventType } from '../src/types/models';

const HOUR = 3_600_000;
const TZ = 'America/New_York';
let nextId = 1;

function event(type: EventType, createdAt: string, overrides: Partial<AttendanceEvent> = {}): AttendanceEvent {
  return {
    id: nextId++,
    user_id: 'user-1',
    work_date: createdAt.slice(0, 10),
    event_type: type,
    auto: false,
    created_at: createdAt,
    ...overrides,
  };
}

const fullDay = [
  event('time_in', '2026-10-30T13:00:00Z'),
  event('break_start', '2026-10-30T17:00:00Z'),
  event('break_end', '2026-10-30T17:30:00Z'),
  event('time_out', '2026-10-30T21:30:00Z'),
];

describe('summarize', () => {
  it('separates work time from break time', () => {
    expect(summarize(fullDay)).toMatchObject({
      state: 'out',
      workMs: 8 * HOUR,
      breakMs: 0.5 * HOUR,
      firstIn: '2026-10-30T13:00:00Z',
      lastOut: '2026-10-30T21:30:00Z',
    });
  });

  it('counts an open session up to the given time', () => {
    const summary = summarize([event('time_in', '2026-10-30T13:00:00Z')], Date.parse('2026-10-30T15:00:00Z'));
    expect(summary.state).toBe('working');
    expect(summary.workMs).toBe(2 * HOUR);
  });

  it('adds up several sessions in one day', () => {
    const summary = summarize([
      event('time_in', '2026-10-30T13:00:00Z'),
      event('time_out', '2026-10-30T15:00:00Z'),
      event('time_in', '2026-10-30T16:00:00Z'),
      event('time_out', '2026-10-30T17:00:00Z'),
    ]);
    expect(summary.workMs).toBe(3 * HOUR);
  });
});

describe('isLate', () => {
  const office = { timezone: TZ, work_start: '09:00:00', grace_minutes: 15 };

  it('allows arrivals within the grace period', () => {
    expect(isLate('2026-10-30T13:15:00Z', office)).toBe(false); // 09:15 New York time
  });

  it('flags arrivals after the grace period', () => {
    expect(isLate('2026-10-30T13:16:00Z', office)).toBe(true);
  });
});

describe('dayReport', () => {
  it('marks a full day as Present', () => {
    expect(dayReport(fullDay, TZ).status).toBe('Present');
  });

  it('shows an ongoing session as In Progress', () => {
    const report = dayReport([event('time_in', '2026-10-30T13:00:00Z')], TZ, Date.parse('2026-10-30T14:00:00Z'));
    expect(report.status).toBe('In Progress');
  });

  it('flags a session nobody timed out without counting extra hours', () => {
    const report = dayReport([event('time_in', '2026-10-28T13:00:00Z')], TZ, Date.parse('2026-10-30T13:00:00Z'));
    expect(report.status).toBe('Missing Time-Out');
    expect(report.summary.workMs).toBe(0);
  });
});

describe('formatClock', () => {
  it('pads hours, minutes and seconds', () => {
    expect(formatClock(HOUR + 61_000)).toBe('01:01:01');
  });
});
