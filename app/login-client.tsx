'use client';

import { FormEvent, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { TOUR_PENDING_KEY } from './tour';

// Authentication card. It is mounted inside the "Access" section of the
// presentation page rather than full screen: signing in is a step of the site,
// not its front door.
export default function LoginClient() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
      const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
      const response = await fetch('/api/auth/' + mode, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not sign in.');
      // A brand-new operator gets the guided tour on the console that follows.
      // The flag survives the reload; the console clears it as it starts.
      if (mode === 'register') {
        try { window.localStorage.setItem(TOUR_PENDING_KEY, '1'); } catch { /* storage unavailable */ }
      }
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-card glass-panel">
      <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Create account</button>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>Email address</span>
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} placeholder="officer@fire.service" />
        </label>
        <label>
          <span>Password</span>
          <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'register' ? 12 : 1} maxLength={128} placeholder="12 characters minimum" />
          {mode === 'register' && <small className="field-help">12 characters minimum. A new account opens the console on a five-step tour.</small>}
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="login-submit" type="submit" disabled={busy}>
          <LockKeyhole size={15} aria-hidden="true" />
          {busy ? 'Checking…' : mode === 'login' ? 'Open the console' : 'Create the account'}
        </button>
      </form>
    </div>
  );
}
