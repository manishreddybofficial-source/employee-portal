import * as leaveApi from '../api/leave';
import { leaveAllowance } from '../config/app';
import { bootstrapPage } from '../layout/shell';
import { badge, byId, capitalize, emptyRow, escapeHtml, safely, startPage, toast } from '../lib/dom';
import { LEAVE_STATUS_TONE, daysUsed, overlaps, requestedDays } from '../lib/leave';
import { formatDate, todayIn } from '../lib/time';
import type { LeaveRequest } from '../types/models';

function requestRow(request: LeaveRequest): string {
  const note = request.admin_note ? `<div class="hint">Note: ${escapeHtml(request.admin_note)}</div>` : '';
  const action =
    request.status === 'pending'
      ? `<button class="btn ghost sm" type="button" data-cancel="${request.id}">Cancel</button>`
      : '';
  return `<tr>
    <td>${escapeHtml(request.leave_type)}</td>
    <td>${formatDate(request.start_date)}</td>
    <td>${formatDate(request.end_date)}</td>
    <td class="num">${request.days}</td>
    <td class="wrap">${escapeHtml(request.reason)}${note}</td>
    <td>${badge(capitalize(request.status), LEAVE_STATUS_TONE[request.status])}</td>
    <td>${action}</td>
  </tr>`;
}

startPage(async () => {
  const { profile, office } = await bootstrapPage('leave');
  const form = byId<HTMLFormElement>('leaveForm');
  const typeSelect = byId<HTMLSelectElement>('type');
  const duration = byId<HTMLSelectElement>('duration');
  const from = byId<HTMLInputElement>('from');
  const to = byId<HTMLInputElement>('to');
  const reason = byId<HTMLTextAreaElement>('reason');
  const submit = byId<HTMLButtonElement>('submitBtn');
  const hint = byId('daysHint');
  const selectedYear = (): number => Number((from.value || todayIn(office.timezone)).slice(0, 4));
  let requests: LeaveRequest[] = [];

  typeSelect.innerHTML = Object.keys(leaveAllowance)
    .map((type) => `<option>${escapeHtml(type)}</option>`)
    .join('');

  const selectedDays = (): number => requestedDays(from.value, to.value, duration.value === 'half');

  function syncDates(): void {
    const halfDay = duration.value === 'half';
    if (from.value && (halfDay || !to.value || to.value < from.value)) to.value = from.value;
    to.disabled = halfDay;
    const days = selectedDays();
    hint.textContent = days ? `${days} working day${days === 1 ? '' : 's'}` : '';
    render();
  }

  function render(): void {
    const year = selectedYear();
    byId('balances').innerHTML = Object.entries(leaveAllowance)
      .map(([type, allowance]) => {
        const used = daysUsed(requests, type, 'approved', year);
        const pending = daysUsed(requests, type, 'pending', year);
        const value = allowance === null ? used : allowance - used;
        const note = `${allowance === null ? 'days taken' : `of ${allowance} left`}${pending ? `, ${pending} pending` : ''}`;
        return `<div class="stat"><div class="label">${escapeHtml(type)}</div><div class="value num">${value}</div><div class="hint">${note}</div></div>`;
      })
      .join('');

    byId('rows').innerHTML = requests.length
      ? requests.map(requestRow).join('')
      : emptyRow(7, "You haven't requested any leave yet.");
  }

  async function load(): Promise<void> {
    requests = await leaveApi.listForUser(profile.id);
    render();
  }

  from.addEventListener('change', syncDates);
  to.addEventListener('change', syncDates);
  duration.addEventListener('change', syncDates);

  form.addEventListener(
    'submit',
    safely(async (event: SubmitEvent) => {
      event.preventDefault();
      const leaveType = typeSelect.value;
      const days = selectedDays();
      const allowance = leaveAllowance[leaveType] ?? null;
      const year = selectedYear();
      const alreadyBooked =
        daysUsed(requests, leaveType, 'approved', year) + daysUsed(requests, leaveType, 'pending', year);

      if (from.value.slice(0, 4) !== to.value.slice(0, 4))
        throw new Error('Submit a separate request for each calendar year.');
      if (!days) throw new Error('Pick dates that include at least one working day.');
      if (!reason.value.trim()) throw new Error('Enter a reason for the leave request.');
      if (allowance !== null && alreadyBooked + days > allowance) {
        throw new Error(`Not enough ${leaveType} left for ${days} day(s).`);
      }
      if (overlaps(requests, from.value, to.value)) throw new Error('You already have leave on these dates.');

      submit.disabled = true;
      try {
        await leaveApi.create({
          user_id: profile.id,
          leave_type: leaveType,
          start_date: from.value,
          end_date: to.value,
          days,
          reason: reason.value.trim(),
        });
        toast('Leave request submitted');
        form.reset();
        syncDates();
        await load();
      } finally {
        submit.disabled = false;
      }
    }),
  );

  byId('rows').addEventListener(
    'click',
    safely(async (event: Event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cancel]');
      if (!button || !confirm('Cancel this leave request?')) return;
      await leaveApi.cancel(Number(button.dataset.cancel));
      toast('Leave request cancelled');
      await load();
    }),
  );

  syncDates();
  await load();
});
