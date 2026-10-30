import * as profilesApi from '../../api/profiles';
import type { PageContext } from '../../layout/shell';
import { byId, emptyRow, escapeHtml, safely, toast } from '../../lib/dom';
import type { Profile, Role } from '../../types/models';
import type { AdminView } from './types';

export function createEmployeesView(
  { profile: currentUser }: PageContext,
  { onSaved }: { onSaved: () => Promise<void> },
): AdminView {
  const tbody = byId('peopleRows');

  function personRow(person: Profile): string {
    const isSelf = person.id === currentUser.id;
    const option = (role: Role, label: string) =>
      `<option value="${role}"${person.role === role ? ' selected' : ''}>${label}</option>`;
    return `<tr data-id="${escapeHtml(person.id)}">
      <td><input class="input" name="full_name" value="${escapeHtml(person.full_name)}" aria-label="Name"></td>
      <td>${escapeHtml(person.email)}</td>
      <td><input class="input" name="department" value="${escapeHtml(person.department)}" aria-label="Department"></td>
      <td><select class="input" name="role" aria-label="Role"${isSelf ? ' disabled' : ''}>
        ${option('employee', 'Employee')}${option('admin', 'Admin')}
      </select></td>
      <td><div class="actions">
        <button class="btn sm" type="button" data-save>Save</button>
        <a class="btn ghost sm" href="/attendance?user=${encodeURIComponent(person.id)}">Attendance</a>
      </div></td>
    </tr>`;
  }

  async function refresh(): Promise<void> {
    const people = await profilesApi.list();
    tbody.innerHTML = people.map(personRow).join('') || emptyRow(5, 'No employees yet.');
  }

  tbody.addEventListener(
    'click',
    safely(async (event: Event) => {
      const row = (event.target as HTMLElement).closest('[data-save]')?.closest<HTMLTableRowElement>('tr');
      const id = row?.dataset.id;
      if (!row || !id) return;

      const field = (name: string) => row.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
      const role = field('role');

      await profilesApi.update(id, {
        full_name: field('full_name')?.value.trim() ?? '',
        department: field('department')?.value.trim() ?? '',
        ...(role && !role.disabled ? { role: role.value as Role } : {}),
      });
      toast('Employee saved');
      await Promise.all([refresh(), onSaved()]);
    }),
  );

  return { refresh };
}
