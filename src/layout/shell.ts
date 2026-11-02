import * as auth from '../api/auth';
import * as officeApi from '../api/office';
import * as profilesApi from '../api/profiles';
import { app } from '../config/app';
import { byId, escapeHtml, safely } from '../lib/dom';
import { icon, renderIcons, type IconName } from '../lib/icons';
import type { OfficeDetails, Profile } from '../types/models';
import { allowedPages, ROLE_LABELS, type OperationsPage } from '../lib/operations';

export type PageId = 'dashboard' | 'attendance' | 'leave' | 'office' | 'admin' | 'operations';

export interface PageContext {
  profile: Profile;
  office: OfficeDetails;
}

interface NavItem {
  id: PageId;
  label: string;
  href: string;
  icon: IconName;
  adminOnly?: boolean;
}

const NAV: readonly NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/employee', icon: 'home' },
  { id: 'attendance', label: 'My Attendance', href: '/attendance', icon: 'calendar' },
  { id: 'leave', label: 'Apply Leave', href: '/leave-request', icon: 'send' },
  { id: 'office', label: 'Office Details', href: '/office-details', icon: 'building' },
  { id: 'admin', label: 'Admin Panel', href: '/admin', icon: 'shield', adminOnly: true },
];

/** Navigates away and never resolves, so the calling page stops running. */
export function redirect(path: string): Promise<never> {
  location.replace(path);
  return new Promise<never>(() => {});
}

/** Guards the page, loads shared data and renders the sidebar and top bar. */
export async function bootstrapPage(
  page: PageId,
  { adminOnly = false }: { adminOnly?: boolean } = {},
): Promise<PageContext> {
  const session = await auth.getSession();
  if (!session) return redirect('/');

  const [profile, office] = await Promise.all([profilesApi.getById(session.user.id), officeApi.get()]);
  if (!profile) {
    await auth.signOut();
    return redirect('/');
  }
  if (adminOnly && profile.role !== 'admin') return redirect('/employee');

  renderShell(page, profile);
  return { profile, office };
}

function renderShell(page: PageId, profile: Profile): void {
  const links = NAV.filter((item) => !item.adminOnly || profile.role === 'admin')
    .map((item) => {
      const current = item.id === page ? ' class="active" aria-current="page"' : '';
      const separator = item.adminOnly ? '<div class="sep"></div>' : '';
      return `${separator}<a href="${item.href}"${current}>${icon(item.icon)}<span>${item.label}</span></a>`;
    })
    .join('');

  const operations: Record<OperationsPage, [string, IconName]> = {
    overview: ['Operations overview', 'home'],
    employees: ['Workforce directory', 'user-clock'],
    attendance: ['Attendance', 'calendar'],
    floors: ['Building deployment', 'building'],
    shifts: ['Shift deployment', 'clock'],
    patrols: ['Patrolling operations', 'shield'],
    gsoc: ['GSOC & incidents', 'stopwatch'],
    supervisor: ['Shift handovers', 'send'],
    management: ['Management insights', 'home'],
    reports: ['Reports & analytics', 'calendar'],
    settings: ['Configuration', 'building'],
    audit: ['Audit history', 'shield'],
    profile: ['My profile', 'user-clock'],
  };
  const opLinks = allowedPages(profile.role, profile.secondary_duty)
    .map(
      (id) =>
        `<a href="/operations#${id}" data-ops-nav="${id}">${icon(operations[id][1])}<span>${operations[id][0]}</span></a>`,
    )
    .join('');
  byId('sidebar').innerHTML = `
    <div class="brand"><span class="brand-mark">${icon('shield')}</span><span>${escapeHtml(app.portalName)}</span></div>
    <div class="brand-sub">Security operations</div>
    <nav class="nav" aria-label="Main"><div class="nav-label">Command center</div>${opLinks}<div class="nav-label">Employee services</div>${links}</nav>
    <div class="sidebar-bottom"><span class="avatar">${escapeHtml(
      profile.full_name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join(''),
    )}</span><div class="sidebar-person">${escapeHtml(profile.full_name)}<small>${escapeHtml(ROLE_LABELS[profile.role])}</small></div><button class="logout" id="logoutBtn" type="button" aria-label="Sign out">${icon('logout')}</button></div>`;

  renderIcons();

  byId('logoutBtn').addEventListener(
    'click',
    safely(async () => {
      await auth.signOut();
      location.replace('/');
    }),
  );

  const name = profile.full_name || profile.email || 'User';
  byId('userName').textContent = name;
  byId('avatar').textContent = name.trim().charAt(0).toUpperCase();

  if (app.desktopOnly) {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="desktop-only" role="alert"><div><h2>Desktop Only</h2><p>Open the portal on a desktop or laptop to continue.</p></div></div>',
    );
  }
}

export function highlightOperation(page: string): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-ops-nav]').forEach((link) => {
    const active = link.dataset.opsNav === page;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
