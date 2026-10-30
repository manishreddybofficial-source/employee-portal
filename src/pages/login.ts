import * as auth from '../api/auth';
import * as profilesApi from '../api/profiles';
import { app } from '../config/app';
import { byId, errorMessage, startPage, toast } from '../lib/dom';

type Mode = 'signin' | 'signup';

async function goHome(userId: string): Promise<void> {
  const profile = await profilesApi.getById(userId);
  location.replace(profile?.role === 'admin' ? '/admin' : '/employee');
}

startPage(async () => {
  const form = byId<HTMLFormElement>('authForm');
  const submit = byId<HTMLButtonElement>('submitBtn');
  const message = byId('msg');
  const fullName = byId<HTMLInputElement>('fullName');
  const department = byId<HTMLInputElement>('department');
  const email = byId<HTMLInputElement>('email');
  const password = byId<HTMLInputElement>('password');
  const logo = byId<HTMLImageElement>('logo');

  byId('portalName').textContent = app.portalName;
  logo.addEventListener('error', () => logo.remove());
  logo.src = app.logoUrl;
  byId('switchRow').hidden = !app.allowSignup;

  const session = await auth.getSession();
  if (session) return goHome(session.user.id);

  let mode: Mode = 'signin';

  function setMode(next: Mode): void {
    mode = next;
    const signup = next === 'signup';
    document.querySelectorAll<HTMLElement>('.signup-only').forEach((el) => (el.hidden = !signup));
    fullName.required = signup;
    password.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    byId('formTitle').textContent = signup ? 'Create account' : 'Sign in';
    submit.textContent = signup ? 'Create account' : 'Sign in';
    byId('switchText').textContent = signup ? 'Already have an account?' : 'New employee?';
    byId('switchBtn').textContent = signup ? 'Sign in' : 'Create an account';
    message.textContent = '';
  }

  byId('switchBtn').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    message.textContent = '';
    submit.disabled = true;

    const run = async (): Promise<void> => {
      if (mode === 'signin') {
        const user = await auth.signIn(email.value.trim(), password.value);
        return goHome(user.id);
      }
      const newSession = await auth.signUp({
        email: email.value.trim(),
        password: password.value,
        fullName: fullName.value.trim(),
        department: department.value.trim(),
      });
      if (newSession) return goHome(newSession.user.id);
      toast('Account created. Confirm it from your email, then sign in.');
      setMode('signin');
    };

    run()
      .catch((error: unknown) => {
        message.textContent = errorMessage(error);
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
});
