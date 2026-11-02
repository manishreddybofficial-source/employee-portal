import * as auth from '../api/auth';
import * as profilesApi from '../api/profiles';
import { app } from '../config/app';
import { readEnv } from '../config/env';
import { byId, errorMessage, toast } from '../lib/dom';

type Mode = 'signin' | 'signup';

async function goHome(userId: string): Promise<void> {
  const profile = await profilesApi.getById(userId);
  if (!profile) throw new Error('Your profile is not available. Contact your portal administrator.');
  location.replace('/operations');
}

async function initialize(): Promise<void> {
  const form = byId<HTMLFormElement>('authForm');
  const submit = byId<HTMLButtonElement>('submitBtn');
  const message = byId('msg');
  const fullName = byId<HTMLInputElement>('fullName');
  const department = byId<HTMLInputElement>('department');
  const email = byId<HTMLInputElement>('email');
  const password = byId<HTMLInputElement>('password');
  byId('portalName').textContent = app.portalName;
  byId('switchRow').hidden = !app.allowSignup;
  let mode: Mode = 'signin';

  function setMode(next: Mode): void {
    mode = next;
    const signup = mode === 'signup';
    document.querySelectorAll<HTMLElement>('.signup-only').forEach((element) => (element.hidden = !signup));
    fullName.required = signup;
    password.autocomplete = signup ? 'new-password' : 'current-password';
    byId('formTitle').textContent = signup ? 'Your workspace awaits.' : 'Good to see you.';
    byId('formDescription').textContent = signup ? 'Create your employee account to get started.' : 'Sign in to access your people and operations.';
    submit.innerHTML = `${signup ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span>`;
    byId('switchText').textContent = signup ? 'Already have an account?' : 'New to the portal?';
    byId('switchBtn').textContent = signup ? 'Sign in' : 'Create an account';
    if (configured) message.textContent = '';
  }

  byId('switchBtn').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
  byId('togglePassword').addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    const toggle = byId('togglePassword');
    toggle.textContent = visible ? 'Hide' : 'Show';
    toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    toggle.setAttribute('aria-pressed', String(visible));
  });
  byId<HTMLSelectElement>('demoRole').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (!value) return;
    setMode('signin');
    email.value = value === 'admin' ? 'admin@example.test' : `emp${value}@example.test`;
    password.value = value === 'admin' ? 'AdminSecure!2026' : 'SecurityDemo!2026';
    email.focus();
  });

  let configured = true;
  try { readEnv(); } catch {
    configured = false;
    message.textContent = 'Setup needed: configure the Supabase URL and publishable key in .env.local, apply the database migrations, and run the demo seed. See README.md for setup.';
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!configured) return;
    message.textContent = '';
    submit.disabled = true;
    submit.textContent = mode === 'signup' ? 'Creating your account…' : 'Signing you in…';
    const run = async (): Promise<void> => {
      if (mode === 'signin') {
        const user = await auth.signIn(email.value.trim(), password.value);
        return goHome(user.id);
      }
      const session = await auth.signUp({ email: email.value.trim(), password: password.value, fullName: fullName.value.trim(), department: department.value.trim() });
      if (session) return goHome(session.user.id);
      toast('Account created. Confirm it from your email, then sign in.');
      setMode('signin');
    };
    run().catch((error: unknown) => { message.textContent = errorMessage(error); }).finally(() => {
      submit.disabled = false;
      submit.innerHTML = `${mode === 'signup' ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span>`;
    });
  });
  if (!configured) { submit.disabled = true; return; }
  try {
    const session = await auth.getSession();
    if (session) await goHome(session.user.id);
  } catch (error) { message.textContent = errorMessage(error); }
}

initialize().catch((error: unknown) => { byId('msg').textContent = errorMessage(error); });
