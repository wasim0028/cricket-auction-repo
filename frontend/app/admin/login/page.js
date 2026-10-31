'use client';
import { useState } from 'react';
import { api } from '../../../lib/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { token } = await api('/auth/login', { method: 'POST', body: { username, password } });
      localStorage.setItem('token', token);
      window.location.href = '/admin';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <h1>Admin login</h1>
      <form className="card" onSubmit={submit}>
        <div className="field"><label>Username</label><input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required /></div>
        <div className="field"><label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <div className="msg err">{error}</div>}
        <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
