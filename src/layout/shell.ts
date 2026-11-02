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

  renderShell(page, profile, office);
  return { profile, office };
}

function renderShell(page: PageId, profile: Profile, office: OfficeDetails): void {
  const links = NAV.filter((item) => !item.adminOnly || profile.role === 'admin')
    .map((item) => {
      const current = item.id === page ? ' class="active" aria-current="page"' : '';
      return `<a href="${item.href}"${current}>${icon(item.icon)}<span>${item.label}</span></a>`;
    })
    .join('');

  const operations: Record<OperationsPage, [string, IconName]> = {
    overview: ['Overview', 'grid'],
    employees: ['Workforce', 'users'],
    attendance: ['Attendance', 'calendar'],
    floors: ['Building deployment', 'building'],
    shifts: ['Shift deployment', 'clock'],
    patrols: ['Patrol operations', 'route'],
    gsoc: ['GSOC & incidents', 'monitor'],
    supervisor: ['Shift handovers', 'send'],
    management: ['Management insights', 'chart'],
    reports: ['Reports & analytics', 'file'],
    settings: ['Configuration', 'settings'],
    audit: ['Audit history', 'shield'],
    profile: ['My profile', 'user-clock'],
  };
  const permitted = allowedPages(profile.role, profile.secondary_duty);
  const groups: [string, OperationsPage[]][] = [
    ['Workspace', ['overview', 'management']],
    ['Security operations', ['employees', 'attendance', 'floors', 'shifts', 'patrols', 'gsoc', 'supervisor']],
    ['Governance', ['reports', 'audit', 'settings']],
    ['My account', ['profile']],
  ];
  const opLinks = groups
    .map(([label, items]) => {
      const visible = items.filter((id) => permitted.includes(id));
      return visible.length
        ? `<div class="nav-group"><div class="nav-label">${label}</div>${visible.map((id) => `<a href="/operations#${id}" data-ops-nav="${id}">${icon(operations[id][1])}<span>${operations[id][0]}</span></a>`).join('')}</div>`
        : '';
    })
    .join('');
  const initials =
    profile.full_name
      .trim()
      .split(/\s+/)
      .map((n) => n[0])
      .slice(0, 2)
      .join('') || 'U';
  byId('sidebar').innerHTML = `
    <a class="brand" href="/operations"><span class="brand-mark">${icon('shield')}</span><span>${escapeHtml(app.portalName)}<small>Security operations</small></span></a>
    <button class="nav-close icon-button" type="button" aria-label="Close navigation">${icon('close')}</button>
    <div class="workspace-label">${icon('building')}<span>Operations workspace<small>${escapeHtml(office.company_name || 'Employee Portal')}</small></span></div>
    <nav class="nav" aria-label="Main">${opLinks}<div class="nav-group"><div class="nav-label">Employee services</div>${links}</div></nav>
    <div class="sidebar-bottom"><span class="avatar">${escapeHtml(initials)}</span><div class="sidebar-person" title="${escapeHtml(profile.full_name)}">${escapeHtml(profile.full_name)}<small>${escapeHtml(ROLE_LABELS[profile.role])}</small></div><button class="logout icon-button" id="logoutBtn" type="button" aria-label="Sign out" title="Sign out">${icon('logout')}</button></div>`;

  const legacy: Partial<Record<PageId, [string, string]>> = {
    dashboard: ['My workspace', 'Your profile, attendance, and daily assignments.'],
    attendance: ['My attendance', 'Review your working hours and attendance history.'],
    leave: ['Leave requests', 'Manage time off, balances, and request status.'],
    office: ['Office information', 'Workplace details, office policies, and contact information.'],
    admin: ['Administration', 'Review attendance, employee access, leave requests, and office settings.'],
  };
  const pageTitle = legacy[page]?.[0] || 'Operations overview';
  const topbar = document.querySelector<HTMLElement>('.topbar');
  if (topbar)
    topbar.innerHTML = `<div class="topbar-title"><button class="menu-toggle icon-button" id="menuToggle" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="Open navigation">${icon('menu')}</button><span class="workspace-breadcrumb">Workspace</span><span class="breadcrumb">/</span><strong id="pageLabel">${pageTitle}</strong></div><div class="topbar-right">${page === 'operations' ? '<span class="connected" id="connectionState" role="status">Connecting</span>' : `<span class="workspace-timezone">${icon('clock')}${escapeHtml(office.timezone)}</span>`}<div class="user"><span class="avatar" id="avatar">${escapeHtml(initials)}</span><div class="user-identity"><span id="userName">${escapeHtml(profile.full_name)}</span><small>${escapeHtml(ROLE_LABELS[profile.role])}</small></div></div></div>`;

  if (page !== 'operations') {
    const content = document.querySelector<HTMLElement>('.content');
    content?.classList.add('legacy-content');
    content?.insertAdjacentHTML(
      'afterbegin',
      `<div class="page-heading"><div><div class="eyebrow">${page === 'admin' ? 'Administration' : 'Employee services'}</div><h1>${pageTitle}</h1><p>${legacy[page]?.[1] || ''}</p></div><a class="btn secondary" href="/operations">${icon('grid')}Operations workspace</a></div>`,
    );
    if (!document.querySelector('.ops-footer'))
      document
        .querySelector('.main')
        ?.insertAdjacentHTML(
          'beforeend',
          `<footer class="ops-footer"><span>${escapeHtml(app.portalName)}<span>Employee & security operations</span></span><span>${escapeHtml(office.timezone)}</span></footer>`,
        );
  }

  document.body.insertAdjacentHTML(
    'beforeend',
    '<button class="nav-backdrop" id="navBackdrop" aria-label="Close navigation" tabindex="-1" type="button"></button><a class="skip-link" href="#mainContent">Skip to main content</a>',
  );
  const main = document.querySelector<HTMLElement>('main');
  if (main && !main.id) main.id = 'mainContent';
  else
    document
      .querySelector<HTMLAnchorElement>('.skip-link')
      ?.setAttribute('href', `#${main?.id || 'operationsContent'}`);
  byId('menuToggle').addEventListener('click', () =>
    setNavigation(!document.body.classList.contains('nav-open')),
  );
  byId('navBackdrop').addEventListener('click', closeNavigation);
  document.querySelector('.nav-close')?.addEventListener('click', closeNavigation);
  document.querySelector('.nav')?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) closeNavigation();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
      closeNavigation();
      byId('menuToggle').focus();
    }
  });
  const mobileNavigation = window.matchMedia('(max-width: 850px)');
  mobileNavigation.addEventListener('change', closeNavigation);
  closeNavigation();

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
  byId('avatar').textContent = initials;

  if (app.desktopOnly) {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="desktop-only" role="alert"><div><h2>Desktop Only</h2><p>Open the portal on a desktop or laptop to continue.</p></div></div>',
    );
  }
}

function setNavigation(open: boolean): void {
  document.body.classList.toggle('nav-open', open);
  document.getElementById('menuToggle')?.setAttribute('aria-expanded', String(open));
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.inert = window.matchMedia('(max-width: 850px)').matches && !open;
}

export function closeNavigation(): void {
  setNavigation(false);
}

export function highlightOperation(page: string): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-ops-nav]').forEach((link) => {
    const active = link.dataset.opsNav === page;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
