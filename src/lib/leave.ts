import type { LeaveRequest, LeaveStatus, Tone } from '../types/models';
import { countWorkingDays } from './time';

export const LEAVE_STATUS_TONE: Readonly<Record<LeaveStatus, Tone>> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
};

export function requestedDays(from: string, to: string, halfDay: boolean): number {
  if (!from || !to || from > to || from.slice(0, 4) !== to.slice(0, 4)) return 0;
  if (halfDay && from !== to) return 0;
  const workingDays = countWorkingDays(from, to);
  return halfDay ? (workingDays ? 0.5 : 0) : workingDays;
}

export function daysUsed(
  requests: readonly LeaveRequest[],
  leaveType: string,
  status: LeaveStatus,
  year: number,
): number {
  return requests
    .filter(
      (request) =>
        request.leave_type === leaveType &&
        request.status === status &&
        Number(request.start_date.slice(0, 4)) === year,
    )
    .reduce((total, request) => total + request.days, 0);
}

export function overlaps(requests: readonly LeaveRequest[], from: string, to: string): boolean {
  if (!from || !to || from > to) return false;
  return requests.some(
    (request) => request.status !== 'rejected' && request.start_date <= to && request.end_date >= from,
  );
}
