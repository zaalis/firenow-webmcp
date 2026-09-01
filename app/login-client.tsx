'use client';

import { FormEvent, useState } from 'react';
import { LockKeyhole } from 'lucide-react';

// Carte d'authentification. Elle est montee dans la section « Accès » de la
// page de presentation, pas en plein ecran : la connexion est une etape du
// site, pas la porte d'entree.
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
      if (!response.ok) throw new Error(result.error || 'Connexion impossible.');
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-card glass-panel">
      <div className="auth-tabs" role="tablist" aria-label="Connexion ou création de compte">
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Connexion</button>
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Créer un compte</button>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>Adresse email</span>
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} placeholder="officier@sdis.fr" />
        </label>
        <label>
          <span>Mot de passe</span>
          <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'register' ? 12 : 1} maxLength={128} placeholder="12 caractères minimum" />
          {mode === 'register' && <small className="field-help">12 caractères minimum.</small>}
        </label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="login-submit" type="submit" disabled={busy}>
          <LockKeyhole size={15} aria-hidden="true" />
          {busy ? 'Vérification…' : mode === 'login' ? 'Ouvrir la console' : 'Créer le compte'}
        </button>
      </form>
    </div>
  );
}
