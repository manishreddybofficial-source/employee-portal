import { describe, expect, it } from 'vitest';
import { daysUsed, overlaps, requestedDays } from '../src/lib/leave';
import type { LeaveRequest } from '../src/types/models';

function request(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 1,
    user_id: 'user-1',
    leave_type: 'Casual Leave',
    start_date: '2026-11-02',
    end_date: '2026-11-03',
    days: 2,
    reason: 'Family trip',
    status: 'approved',
    admin_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

describe('requestedDays', () => {
  it('skips weekends', () => expect(requestedDays('2026-10-30', '2026-11-02', false)).toBe(2));
  it('counts a half day as 0.5', () => expect(requestedDays('2026-10-30', '2026-10-30', true)).toBe(0.5));
  it('returns 0 for a weekend-only range', () =>
    expect(requestedDays('2026-10-31', '2026-11-01', false)).toBe(0));
  it('returns 0 for a reversed range', () =>
    expect(requestedDays('2026-11-02', '2026-10-30', false)).toBe(0));
  it('requires separate requests across calendar years', () =>
    expect(requestedDays('2026-12-31', '2027-01-04', false)).toBe(0));
  it('requires half-day leave to use a single date', () =>
    expect(requestedDays('2026-11-02', '2026-11-03', true)).toBe(0));
});

describe('daysUsed', () => {
  it('sums only the matching type, status and year', () => {
    const requests = [
      request(),
      request({ status: 'pending', days: 1 }),
      request({ leave_type: 'Sick Leave' }),
      request({ start_date: '2025-12-01', end_date: '2025-12-02' }),
    ];
    expect(daysUsed(requests, 'Casual Leave', 'approved', 2026)).toBe(2);
  });
});

describe('overlaps', () => {
  it('detects an overlapping active request', () => {
    expect(overlaps([request()], '2026-11-03', '2026-11-05')).toBe(true);
  });

  it('ignores rejected requests', () => {
    expect(overlaps([request({ status: 'rejected' })], '2026-11-03', '2026-11-05')).toBe(false);
  });
});
