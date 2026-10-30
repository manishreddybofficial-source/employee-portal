import * as auth from '../api/auth';
import * as officeApi from '../api/office';
import * as profilesApi from '../api/profiles';
import { app } from '../config/app';
import { byId, escapeHtml, safely } from '../lib/dom';
import { icon, renderIcons, type IconName } from '../lib/icons';
import type { OfficeDetails, Profile } from '../types/models';

export type PageId = 'dashboard' | 'attendance' | 'leave' | 'office' | 'admin';

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

  byId('sidebar').innerHTML = `
    <div class="brand"><img id="brandLogo" src="${escapeHtml(app.logoUrl)}" alt=""><span>${escapeHtml(app.portalName)}</span></div>
    <nav class="nav" aria-label="Main">${links}</nav>
    <button class="logout" id="logoutBtn" type="button">${icon('logout')}<span>Logout</span></button>`;

  renderIcons();

  const logo = byId<HTMLImageElement>('brandLogo');
  logo.addEventListener('error', () => logo.remove());

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
