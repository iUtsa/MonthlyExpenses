// Sign-in / create-account screen shown before the app when the server has accounts.
import { api } from './store.js';
import { esc } from './util.js';

export function showAuthScreen({ signup = true } = {}) {
  let mode = 'signin';
  let lastEmail = '';
  const root = document.createElement('div');
  root.className = 'auth-screen';
  document.body.append(root);

  const render = (error = '') => {
    const creating = mode === 'signup';
    root.innerHTML = `
      <form class="auth-card" novalidate>
        <div class="brand" style="padding:0 0 6px"><span class="brand-mark" aria-hidden="true"></span><span>Finance Manager</span></div>
        <h1>${creating ? 'Create your account' : 'Welcome back'}</h1>
        <p class="text-2">${creating ? 'Budgets, receipts, shifts, debts and investments — private to your account.' : 'Sign in to your budget.'}</p>
        ${error ? `<div class="alert bad"><span class="alert-icon">!</span><div>${esc(error)}</div></div>` : ''}
        ${creating ? '<label class="field">Your name<input name="name" autocomplete="name" placeholder="e.g. Arnab"></label>' : ''}
        <label class="field">Email<input name="email" type="email" autocomplete="email" required autofocus value="${esc(lastEmail)}"></label>
        <label class="field">Password<input name="password" type="password" autocomplete="${creating ? 'new-password' : 'current-password'}" required minlength="8" placeholder="${creating ? 'At least 8 characters' : ''}"></label>
        <button class="btn primary" type="submit" style="width:100%;padding:10px">${creating ? 'Create account' : 'Sign in'}</button>
        ${signup || !creating ? `<p class="small text-2" style="text-align:center;margin:4px 0 0">${creating ? 'Already have an account?' : 'New here?'}
          <a href="#" data-switch>${creating ? 'Sign in' : 'Create an account'}</a></p>` : ''}
        ${!creating ? '<p class="small muted" style="text-align:center;margin:0">Forgot your password? Ask the site owner to reset it.</p>' : ''}
      </form>`;
    const form = root.querySelector('form');
    form.querySelector('[data-switch]')?.addEventListener('click', (e) => { e.preventDefault(); mode = creating ? 'signin' : 'signup'; render(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      button.textContent = creating ? 'Creating…' : 'Signing in…';
      try {
        await api(creating ? '/api/auth/signup' : '/api/auth/login', {
          method: 'POST',
          body: { email: form.email.value, password: form.password.value, name: form.name?.value || '' },
        });
        location.reload();
      } catch (err) {
        lastEmail = form.email.value;
        render(err.message);
      }
    });
    (lastEmail ? form.password : form.querySelector('[autofocus]'))?.focus();
  };
  if (!signup) mode = 'signin';
  render();
}
