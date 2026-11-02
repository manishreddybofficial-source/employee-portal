const SHAPES = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
  chart: '<path d="M4 3v17h17M8 15v-4m5 4V7m5 8v-6"/>',
  route:
    '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h9a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h9"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M6 11h3l2-4 3 7 2-3h2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 12h8m-8 4h6"/>',
  settings:
    '<path d="m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h6l1-3 3-2v-3l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 5 3 3 5-5"/>',
  send: '<path d="m22 2-7 20-4-9L2 9Zm0 0L11 13"/>',
  building:
    '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1m-5 6v-3h4v3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6"/>',
  logout: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m7-12 4 4-4 4m-9-4h13"/>',
  login: '<path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M8 8l4 4-4 4M3 12h9"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="m7 4 14 8-14 8Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  stopwatch: '<circle cx="12" cy="14" r="8"/><path d="M12 10v4l3 2M9 2h6m-3 0v4m6 1 2-2"/>',
  coffee:
    '<path d="M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Zm12 1h2a3 3 0 0 1 0 6h-2M7 2v3m4-3v3m4-3v3M2 22h17"/>',
  'user-clock':
    '<circle cx="9" cy="6" r="3"/><path d="M2 20v-3a7 7 0 0 1 10-6"/><circle cx="17" cy="17" r="5"/><path d="M17 14v3l2 1"/>',
} as const;

export type IconName = keyof typeof SHAPES;

export function icon(name: IconName): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SHAPES[name]}</svg>`;
}

export function renderIcons(): void {
  document.querySelectorAll<HTMLElement>('[data-icon]').forEach((element) => {
    const name = element.dataset.icon;
    if (name && Object.hasOwn(SHAPES, name)) element.innerHTML = icon(name as IconName);
  });
}
