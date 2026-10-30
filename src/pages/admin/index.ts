import { bootstrapPage } from '../../layout/shell';
import { safely, startPage } from '../../lib/dom';
import { createEmployeesView } from './employees';
import { createLeaveRequestsView } from './leave-requests';
import { createOfficeSettingsView } from './office-settings';
import { createTodayView } from './today';

function initTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const other of tabs) {
        const active = other === tab;
        other.classList.toggle('active', active);
        other.setAttribute('aria-selected', String(active));
      }
      document
        .querySelectorAll<HTMLElement>('[role="tabpanel"]')
        .forEach((panel) => panel.classList.toggle('active', panel.id === tab.getAttribute('aria-controls')));
    });
  }
}

startPage(async () => {
  const context = await bootstrapPage('admin', { adminOnly: true });
  initTabs();

  const today = createTodayView(context);
  const views = [
    today,
    createLeaveRequestsView(context),
    createEmployeesView(context, { onSaved: today.refresh }),
    createOfficeSettingsView(context, { onSaved: today.refresh }),
  ];

  await Promise.all(views.map((view) => view.refresh()));
  window.setInterval(safely(today.refresh), 60_000);
});
