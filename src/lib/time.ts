const DAY_FORMAT = 'en-CA'; // yields YYYY-MM-DD

/** Wall-clock time of a timestamp in the given time zone, e.g. "09:05 AM". */
export function formatTime(timestamp: string | null, timeZone: string): string {
  if (!timestamp) return '--:--';
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone });
}

/** A calendar date (YYYY-MM-DD) for display, e.g. "Fri, Oct 30, 2026". */
export function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Stopwatch format, e.g. "01:05:09". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/** Duration format, e.g. "7h 45m". */
export function formatHours(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Minutes after midnight for a "HH:MM" or "HH:MM:SS" value. */
export function parseClock(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

/** A "HH:MM[:SS]" value for display, e.g. "09:00 AM". */
export function formatClockTime(clock: string): string {
  const minutes = parseClock(clock);
  return new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

/** Today's date (YYYY-MM-DD) in the given time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat(DAY_FORMAT, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(now);
}

/** Minutes after midnight of a timestamp, in the given time zone. */
export function minutesOfDay(timestamp: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** First and last day of a "YYYY-MM" month. */
export function monthRange(yearMonth: string): { from: string; to: string } {
  const [year = 1970, month = 1] = yearMonth.split('-').map(Number);
  return { from: `${yearMonth}-01`, to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}

export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Monday-to-Friday days between two dates, inclusive. */
export function countWorkingDays(from: string, to: string): number {
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (!isWeekend(day)) count++;
  }
  return count;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}