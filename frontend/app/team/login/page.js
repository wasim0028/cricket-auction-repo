'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

export default function TeamLogin() {
  const [teams, setTeams] = useState([]);
  const [team, setTeam] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/public/board').then((d) => {
      setTeams(d.teams);
      if (d.teams[0]) setTeam(d.teams[0].short_name);
    }).catch((e) => setError(e.message));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { token } = await api('/auth/team-login', { method: 'POST', body: { team, passcode } });
      localStorage.setItem('teamToken', token);
      window.location.href = '/live';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 440 }}>
      <h1>Team login</h1>
      <p className="muted">Franchise owners sign in with the passcode shared by the auction admin.</p>
      <form className="card" onSubmit={submit}>
        <div className="field">
          <label>Team</label>
          <select value={team} onChange={(e) => setTeam(e.target.value)} required>
            {teams.map((t) => <option key={t.id} value={t.short_name}>{t.name} ({t.short_name})</option>)}
          </select>
        </div>
        <div className="field">
          <label>Passcode</label>
          <input value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="off" required style={{ textTransform: 'uppercase', letterSpacing: 2 }} />
        </div>
        {error && <div className="msg err">{error}</div>}
        <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Enter auction room'}</button>
      </form>
    </div>
  );
}
