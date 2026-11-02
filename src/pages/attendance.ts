import * as operationsApi from '../api/operations';
import { bootstrapPage } from '../layout/shell';
import { dayReport, type DayReport } from '../lib/attendance';
import { groupBy } from '../lib/collections';
import { downloadCsv } from '../lib/csv';
import { badge, byId, emptyRow, safely, startPage } from '../lib/dom';
import { employeeDay, employeeForDate } from '../lib/operations';
import { formatDate, formatHours, formatTime, monthRange, todayIn } from '../lib/time';

interface Row {
  date: string;
  report: DayReport;
  late: boolean;
}

startPage(async () => {
  const { profile, office } = await bootstrapPage('attendance');
  const tz = office.timezone;
  const month = byId<HTMLInputElement>('month');
  let subject = { id: profile.id, name: profile.full_name || profile.email || 'me' };
  let rows: Row[] = [];

  // The snapshot enforces team scope in Postgres for direct API requests too.
  const requested = new URLSearchParams(location.search).get('user');

  function render(): void {
    const worked = rows.reduce((sum, row) => sum + row.report.summary.workMs, 0);
    const present = rows.filter((row) => row.report.summary.firstIn !== null).length;

    byId('sDays').textContent = String(present);
    byId('sHours').textContent = formatHours(worked);
    byId('sAvg').textContent = formatHours(present ? worked / present : 0);
    byId('sLate').textContent = String(rows.filter((row) => row.late).length);

    byId('rows').innerHTML = rows.length
      ? rows
          .map(
            ({ date, report: { summary, status, tone }, late }) => `<tr>
              <td>${formatDate(date)}</td>
              <td class="num">${formatTime(summary.firstIn, tz)} ${late ? badge('Late', 'red') : ''}</td>
              <td class="num">${formatTime(summary.lastOut, tz)}</td>
              <td class="num">${formatHours(summary.breakMs)}</td>
              <td class="num">${formatHours(summary.workMs)}</td>
              <td>${badge(status, tone)}</td>
            </tr>`,
          )
          .join('')
      : emptyRow(6, 'No attendance recorded this month.');
  }

  async function load(): Promise<void> {
    if (!month.value) return;
    const { from, to } = monthRange(month.value);
    const data = await operationsApi.snapshot(from, to);
    const employee = data.employees.find((person) => person.id === (requested || profile.id));
    if (!employee) throw new Error('This employee attendance history is outside your authorized team.');
    subject = { id: employee.id, name: employee.full_name || employee.email || 'Employee' };
    byId('tableTitle').textContent = `Attendance history for ${subject.name}`;
    const events = data.attendance.filter((event) => event.user_id === subject.id);

    rows = [...groupBy(events, (event) => event.work_date)]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, dayEvents]) => {
        const report = dayReport(dayEvents, tz);
        const assigned = employeeForDate(employee, data, date, tz);
        const attendance = employeeDay(assigned, data, date, tz, Date.now(), office.grace_minutes);
        report.summary = attendance.summary;
        return { date, report, late: attendance.late };
      });
    render();
  }

  function exportCsv(): void {
    downloadCsv(`attendance-${subject.name.replace(/\W+/g, '-')}-${month.value}.csv`, [
      ['Date', 'Time-In', 'Time-Out', 'Break', 'Worked', 'Late', 'Status'],
      ...rows.map(({ date, report: { summary, status }, late }) => [
        date,
        formatTime(summary.firstIn, tz),
        formatTime(summary.lastOut, tz),
        formatHours(summary.breakMs),
        formatHours(summary.workMs),
        late ? 'Yes' : 'No',
        status,
      ]),
    ]);
  }

  month.value = todayIn(tz).slice(0, 7);
  month.addEventListener('change', safely(load));
  byId('exportBtn').addEventListener('click', exportCsv);
  await load();
});
