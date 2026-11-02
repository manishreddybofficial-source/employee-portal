export const DEMO_MARKER = 'security-demo-v1';
export const DEMO_EMPLOYEE_PASSWORD = 'SecurityDemo!2026';
export const DEMO_ADMIN_PASSWORD = 'AdminSecure!2026';

const maleNames = ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Rohan', 'Ishaan', 'Karan', 'Vikram', 'Rahul', 'Dev', 'Nikhil', 'Sanjay', 'Akash', 'Pranav', 'Varun', 'Manish'];
const femaleNames = ['Ananya', 'Diya', 'Isha', 'Kavya', 'Meera', 'Priya', 'Riya', 'Saanvi', 'Shreya', 'Sneha', 'Tanvi', 'Aditi', 'Nandini', 'Pooja', 'Neha', 'Ritika'];
const surnames = ['Sharma', 'Reddy', 'Patel', 'Rao', 'Singh', 'Nair', 'Iyer', 'Gupta', 'Joshi', 'Das', 'Menon', 'Kapoor', 'Verma', 'Pillai', 'Bhat', 'Chopra', 'Kulkarni', 'Desai', 'Saxena', 'Malhotra'];

/** Deterministic identities: rerunning a seed never invents another set of users. */
export function generateEmployees() {
  let male = 0;
  let female = 0;
  return Array.from({ length: 100 }, (_, index) => {
    const number = index + 1;
    const gender = (index * 37) % 100 < 36 ? 'Female' : 'Male';
    const sequence = gender === 'Female' ? female++ : male++;
    const names = gender === 'Female' ? femaleNames : maleNames;
    let role = 'security';
    let designation = 'Security Officer';
    if (number === 1) [role, designation] = ['director', 'Director'];
    else if (number <= 3) [role, designation] = ['asm', 'Assistant Security Manager'];
    else if (number <= 6) [role, designation] = ['supervisor', 'Shift Supervisor'];
    else if (number <= 12) [role, designation] = ['gsoc', 'GSOC Analyst'];
    else if (number <= 18) [role, designation] = ['controller', 'Controller'];
    else if (number <= 30) [role, designation] = ['patrol', 'Patrolling Officer'];
    return {
      employee_id: `EMP${String(number).padStart(3, '0')}`,
      email: `emp${String(number).padStart(3, '0')}@example.test`,
      full_name: `${names[sequence % names.length]} ${surnames[(Math.floor(sequence / names.length) * 7 + sequence) % surnames.length]}`,
      gender,
      department: role === 'gsoc' || role === 'controller' ? 'Global Security Operations' : number <= 3 ? 'Security Management' : 'Building Security',
      role,
      designation,
      secondary_duty: role === 'security' && number % 13 === 0 ? 'Patrolling Officer' : null,
      floor_id: ((index * 3) % 8) + 1,
      shift_id: (index % 3) + 1,
      employment_status: 'Active',
      contact_number: `DEMO-NOT-DIALABLE-${String(number).padStart(4, '0')}`,
      joining_date: `${2022 + (index % 4)}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 26) + 1).padStart(2, '0')}`,
      avatar_url: null,
      is_demo: true,
    };
  });
}

export function dayIn(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type) => parts.find((value) => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(day, amount) {
  const result = new Date(`${day}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

/** Convert an unambiguous shift wall-clock boundary to UTC, using the building zone. */
export function zonedInstant(day, clock, timeZone) {
  const target = Date.parse(`${day}T${clock.slice(0, 5)}:00Z`);
  let result = target;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let pass = 0; pass < 4; pass++) {
    const parts = formatter.formatToParts(new Date(result));
    const part = (type) => parts.find((value) => value.type === type)?.value;
    const wall = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`);
    const correction = target - wall;
    result += correction;
    if (correction === 0) break;
  }
  return result;
}

export function shiftWindow(day, shift, timeZone) {
  return {
    start: zonedInstant(day, shift.start_time, timeZone),
    end: zonedInstant(shift.end_time <= shift.start_time ? addDays(day, 1) : day, shift.end_time, timeZone),
  };
}

/** A day's demo punches are inserted atomically, never in the future. */
export function attendanceFor(employee, day, shift, timeZone, now = Date.now()) {
  const number = Number(employee.employee_id.slice(3));
  const ordinal = Math.floor(Date.parse(`${day}T12:00Z`) / 86_400_000);
  if ((number + ordinal) % 13 === 0) return [];
  const window = shiftWindow(day, shift, timeZone);
  const start = window.start + (number % 9 === 0 ? 22 : -3) * 60_000;
  if (start > now) return [];
  const events = [];
  const event = (event_type, at) => events.push({ user_id: employee.id, work_date: day, event_type, created_at: new Date(at).toISOString(), auto: false, demo_key: `${DEMO_MARKER}:attendance:${employee.employee_id}:${day}:${event_type}` });
  event('time_in', start);
  const breakStart = start + 3 * 3_600_000 + (number % 5) * 60_000;
  const breakEnd = breakStart + 25 * 60_000;
  if (breakStart <= now) event('break_start', breakStart);
  if (breakEnd <= now) event('break_end', breakEnd);
  if (window.end <= now) event('time_out', window.end);
  return events;
}
