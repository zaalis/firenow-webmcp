'use client';

import { FormEvent, useState } from 'react';
import { Flame, LockKeyhole, ShieldCheck } from 'lucide-react';

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
    <main className="login-shell">
      <div className="login-map" aria-hidden="true"><div className="login-fire" /><div className="login-front" /></div>
      <section className="login-card glass-panel">
        <div className="login-brand"><span className="brand-mark"><Flame size={18} /></span><div><strong>FireOps</strong><small>Centre de commandement</small></div><span className="beta-chip">BÊTA</span></div>
        <div className="login-intro"><span>ACCÈS OPÉRATIONNEL</span><h1>{mode === 'login' ? 'Reprendre la situation' : 'Créer un accès FireOps'}</h1><p>Simulateur d’aide à la décision et d’entraînement pour les feux de forêt.</p></div>
        <div className="auth-tabs" role="tablist">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Connexion</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Créer un compte</button>
        </div>
        <form onSubmit={submit}>
          <label><span>Adresse email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} placeholder="officier@sdmis.fr" /></label>
          <label><span>Mot de passe</span><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'register' ? 12 : 1} maxLength={128} placeholder="12 caractères minimum" /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="login-submit" type="submit" disabled={busy}><LockKeyhole size={15} />{busy ? 'Vérification…' : mode === 'login' ? 'Se connecter' : 'Créer le compte sécurisé'}</button>
        </form>
        <div className="login-security"><ShieldCheck size={16} /><p><strong>Session opaque, côté serveur</strong><span>Argon2id 64 Mo · cookie HttpOnly · protection CSRF · aucun JWT localStorage</span></p></div>
      </section>
      <footer className="login-footer"><span>OUTIL D’ENTRAÎNEMENT · NE REMPLACE PAS LE COS</span><span>Landiras 2022 · modèle non calibré</span></footer>
    </main>
  );
}
