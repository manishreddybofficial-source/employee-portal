import { bootstrapPage } from '../layout/shell';
import { byId, escapeHtml, isSafeUrl, startPage } from '../lib/dom';
import { formatClockTime } from '../lib/time';

function infoItem(label: string, valueHtml: string): string {
  return `<div class="item"><div class="label">${escapeHtml(label)}</div><div class="value">${valueHtml}</div></div>`;
}

startPage(async () => {
  const { office } = await bootstrapPage('office');

  byId('company').textContent = office.company_name;
  byId('address').textContent = office.address || 'Address not added yet.';

  const details: Array<[string, string]> = [
    ['Working hours', `${formatClockTime(office.work_start)} to ${formatClockTime(office.work_end)}`],
    ['Time zone', office.timezone],
    ['Marked late after', `${formatClockTime(office.work_start)} plus ${office.grace_minutes} minutes`],
    ['Break policy', office.break_policy],
    ['Phone', office.phone],
    ['Email', office.email],
  ];

  let html = details
    .filter(([, value]) => value)
    .map(([label, value]) => infoItem(label, escapeHtml(value)))
    .join('');

  if (isSafeUrl(office.map_url)) {
    html += infoItem(
      'Location',
      `<a href="${escapeHtml(office.map_url)}" target="_blank" rel="noopener noreferrer">Open in Maps</a>`,
    );
  }
  byId('info').innerHTML = html;

  if (office.notes) {
    byId('notes').textContent = office.notes;
    byId('notesPanel').hidden = false;
  }
});
