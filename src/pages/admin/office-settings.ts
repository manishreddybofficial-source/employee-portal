import * as officeApi from '../../api/office';
import type { PageContext } from '../../layout/shell';
import { byId, safely, toast } from '../../lib/dom';
import { isValidTimeZone } from '../../lib/time';
import type { OfficeUpdate } from '../../types/models';
import type { AdminView } from './types';

const FIELDS = [
  'company_name',
  'timezone',
  'address',
  'work_start',
  'work_end',
  'grace_minutes',
  'map_url',
  'phone',
  'email',
  'break_policy',
  'notes',
] as const;

type Field = (typeof FIELDS)[number];

export function createOfficeSettingsView(
  { office }: PageContext,
  { onSaved }: { onSaved: () => Promise<void> },
): AdminView {
  const form = byId<HTMLFormElement>('officeForm');
  const input = (field: Field) => byId<HTMLInputElement | HTMLTextAreaElement>(`o_${field}`);

  async function refresh(): Promise<void> {
    Object.assign(office, await officeApi.get());
    for (const field of FIELDS) {
      const value = String(office[field] ?? '');
      input(field).value = field === 'work_start' || field === 'work_end' ? value.slice(0, 5) : value;
    }
  }

  form.addEventListener(
    'submit',
    safely(async (event: SubmitEvent) => {
      event.preventDefault();
      const values = Object.fromEntries(FIELDS.map((field) => [field, input(field).value.trim()])) as Record<
        Field,
        string
      >;
      if (!isValidTimeZone(values.timezone)) {
        throw new Error('Use a time zone like America/New_York or Asia/Kolkata.');
      }

      const patch: OfficeUpdate = { ...values, grace_minutes: Number(values.grace_minutes) || 0 };
      await officeApi.update(patch);
      Object.assign(office, patch);
      toast('Office settings saved');
      await onSaved();
    }),
  );

  return { refresh };
}
