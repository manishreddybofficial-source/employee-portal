import * as leaveApi from '../../api/leave';
import type { PageContext } from '../../layout/shell';
import { badge, byId, capitalize, emptyRow, escapeHtml, safely, toast } from '../../lib/dom';
import { LEAVE_STATUS_TONE } from '../../lib/leave';
import { formatDate } from '../../lib/time';
import type { LeaveRequest } from '../../types/models';
import type { AdminView } from './types';

function requestRow(request: LeaveRequest): string {
  const note = request.admin_note ? `<div class="hint">Note: ${escapeHtml(request.admin_note)}</div>` : '';
  const actions =
    request.status === 'pending'
      ? `<div class="actions">
          <button class="btn green sm" type="button" data-id="${request.id}" data-review="approved">Approve</button>
          <button class="btn red sm" type="button" data-id="${request.id}" data-review="rejected">Reject</button>
        </div>`
      : '';
  return `<tr>
    <td>${escapeHtml(request.employee?.full_name || request.employee?.email)}</td>
    <td>${escapeHtml(request.leave_type)}</td>
    <td>${formatDate(request.start_date)}</td>
    <td>${formatDate(request.end_date)}</td>
    <td class="num">${request.days}</td>
    <td class="wrap">${escapeHtml(request.reason)}${note}</td>
    <td>${badge(capitalize(request.status), LEAVE_STATUS_TONE[request.status])}</td>
    <td>${actions}</td>
  </tr>`;
}

export function createLeaveRequestsView({ profile: reviewer }: PageContext): AdminView {
  const tbody = byId('leaveRows');
  const filter = byId<HTMLSelectElement>('leaveFilter');
  const counter = byId('pendingCount');

  async function refresh(): Promise<void> {
    const [requests, pending] = await Promise.all([
      leaveApi.listAll(filter.value === 'pending' ? 'pending' : undefined),
      leaveApi.pendingCount(),
    ]);
    tbody.innerHTML = requests.map(requestRow).join('') || emptyRow(8, 'No leave requests to review.');
    counter.textContent = pending ? String(pending) : '';
    counter.hidden = pending === 0;
  }

  tbody.addEventListener(
    'click',
    safely(async (event: Event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-review]');
      const decision = button?.dataset.review;
      const id = Number(button?.dataset.id);
      if (!id || (decision !== 'approved' && decision !== 'rejected')) return;

      const note = decision === 'rejected' ? prompt('Reason for rejecting (optional):') : '';
      if (note === null) return;

      await leaveApi.review(id, decision, reviewer.id, note.trim() || null);
      toast(decision === 'approved' ? 'Leave approved' : 'Leave rejected');
      await refresh();
    }),
  );

  filter.addEventListener('change', safely(refresh));
  return { refresh };
}
