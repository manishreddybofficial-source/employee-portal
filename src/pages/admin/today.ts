import * as attendanceApi from '../../api/attendance';
import * as profilesApi from '../../api/profiles';
import type { PageContext } from '../../layout/shell';
import { STATE_LABELS, STATE_TONE, dayReport, isActiveSession, isLate } from '../../lib/attendance';
import { groupBy } from '../../lib/collections';
import { badge, byId, emptyRow, escapeHtml, safely } from '../../lib/dom';
import { addDays, formatHours, formatTime, todayIn } from '../../lib/time';
import type { Profile } from '../../types/models';
import type { AdminView } from './types';

function personCells(person: Profile): string {
  return `<td><a href="/attendance?user=${encodeURIComponent(person.id)}">${escapeHtml(person.full_name || person.email)}</a></td>
    <td>${escapeHtml(person.department)}</td>`;
}

export function createTodayView({ office }: PageContext): AdminView {
  const tbody = byId('todayRows');

  async function refresh(): Promise<void> {
    const tz = office.timezone;
    const today = todayIn(tz);
    const yesterday = addDays(today, -1);
    const [people, events] = await Promise.all([profilesApi.list(), attendanceApi.listSince(yesterday)]);
    const eventsByUser = groupBy(events, (event) => event.user_id);
    const counts = { working: 0, onBreak: 0, absent: 0 };

    const rows = people.map((person) => {
      const byDate = groupBy(eventsByUser.get(person.id) ?? [], (event) => event.work_date);
      const previous = byDate.get(yesterday);
      const dayEvents = byDate.get(today) ?? (previous && isActiveSession(previous, tz) ? previous : undefined);

      if (!dayEvents) {
        counts.absent++;
        return `<tr>${personCells(person)}<td>${badge('Not Checked In')}</td><td>--:--</td><td>--:--</td><td>0h 00m</td></tr>`;
      }

      const { summary } = dayReport(dayEvents, tz);
      if (summary.state === 'working') counts.working++;
      if (summary.state === 'break') counts.onBreak++;

      return `<tr>${personCells(person)}
        <td>${badge(STATE_LABELS[summary.state], STATE_TONE[summary.state])}</td>
        <td class="num">${formatTime(summary.firstIn, tz)} ${isLate(summary.firstIn, office) ? badge('Late', 'red') : ''}</td>
        <td class="num">${formatTime(summary.lastOut, tz)}</td>
        <td class="num">${formatHours(summary.workMs)}</td>
      </tr>`;
    });

    tbody.innerHTML = rows.join('') || emptyRow(6, 'No employees yet.');
    byId('aTotal').textContent = String(people.length);
    byId('aIn').textContent = String(counts.working);
    byId('aBreak').textContent = String(counts.onBreak);
    byId('aNone').textContent = String(counts.absent);
  }

  byId('refreshBtn').addEventListener('click', safely(refresh));
  return { refresh };
}
