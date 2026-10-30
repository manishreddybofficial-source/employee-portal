import type { Tone } from '../types/models';

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Element #${id} is missing from the page.`);
  return element as T;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const isSafeUrl = (url: string): boolean => /^https:\/\//i.test(url);

export function badge(text: string, tone: Tone = ''): string {
  return `<span class="badge ${tone}">${escapeHtml(text)}</span>`;
}

export function emptyRow(columns: number, message: string): string {
  return `<tr><td colspan="${columns}" class="empty">${escapeHtml(message)}</td></tr>`;
}

let toastTimer: number | undefined;

export function toast(message: string, tone: 'info' | 'error' = 'info'): void {
  let element = document.getElementById('toast');
  if (!element) {
    element = document.createElement('div');
    element.id = 'toast';
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    document.body.append(element);
  }
  const target = element;
  target.textContent = message;
  target.className = `show ${tone}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    target.className = tone;
  }, 3500);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function report(error: unknown): void {
  console.error(error);
  toast(errorMessage(error), 'error');
}

/** Runs a page entry point and shows any failure to the user. */
export function startPage(main: () => Promise<void>): void {
  main().catch(report);
}

/** Wraps an async event handler so errors become a toast, not an unhandled rejection. */
export function safely<E extends Event>(handler: (event: E) => Promise<void>): (event: E) => void {
  return (event) => {
    handler(event).catch(report);
  };
}
