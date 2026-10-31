'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { BOWLING_STYLES, ROLE_LABEL, ROLES, fmtDateTime } from '../../lib/format';

const INITIAL = {
  fullName: '', email: '', phone: '', dateOfBirth: '', state: '', nationality: 'India',
  role: 'BATSMAN', battingStyle: 'RIGHT_HAND', bowlingStyle: BOWLING_STYLES[0], isCapped: 'false',
  matchesPlayed: 0, runs: 0, battingAverage: 0, strikeRate: 0, wickets: 0, economy: 0, achievements: '',
};

// Shrinks the chosen picture in the browser so only a small JPEG (~40-90 KB) is uploaded.
async function toSmallJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That file is not a readable image'));
      i.src = url;
    });
    const scale = Math.min(1, 420 / img.width, 520 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      const out = c.toDataURL('image/jpeg', q);
      if (out.length < 190000) return out;
    }
    throw new Error('Image is too detailed; please pick a smaller photo');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Register() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(INITIAL);
  const [photo, setPhoto] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/public/status').then(setStatus).catch((e) => setError(e.message));
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const bats = form.role !== 'BOWLER';
  const bowls = form.role === 'BOWLER' || form.role === 'ALLROUNDER';

  async function pickPhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    try {
      setPhoto(await toSmallJpeg(f));
    } catch (err) {
      setError(err.message);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/public/register', {
        method: 'POST',
        body: {
          ...form,
          isCapped: form.isCapped === 'true',
          matchesPlayed: Number(form.matchesPlayed) || 0,
          runs: bats ? Number(form.runs) || 0 : 0,
          battingAverage: bats ? Number(form.battingAverage) || 0 : 0,
          strikeRate: bats ? Number(form.strikeRate) || 0 : 0,
          wickets: bowls ? Number(form.wickets) || 0 : 0,
          economy: bowls ? Number(form.economy) || 0 : 0,
          bowlingStyle: bowls ? form.bowlingStyle : '',
          photo: photo || undefined,
        },
      });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="container narrow">
        <div className="card">
          <h2>Registration received ✔</h2>
          <p>Thank you, {form.fullName}. The organisers will review your profile after the registration window closes. Keep an eye on your email ({form.email}).</p>
        </div>
      </div>
    );

  if (status && !status.registrationOpen)
    return (
      <div className="container narrow">
        <div className="card">
          <h2>Registration is closed</h2>
          <p className="muted">The submission window has ended. Follow the auction on the board.</p>
        </div>
      </div>
    );

  return (
    <div className="container narrow">
      <h1>Player registration</h1>
      {status?.registrationDeadline && (
        <p className="muted">Window closes: {fmtDateTime(status.registrationDeadline)}</p>
      )}
      <form className="card" onSubmit={submit}>
        <div className="grid two">
          <div className="field"><label>Full name *</label><input required value={form.fullName} onChange={set('fullName')} /></div>
          <div className="field"><label>Email *</label><input type="email" required value={form.email} onChange={set('email')} /></div>
          <div className="field"><label>Phone *</label><input required value={form.phone} onChange={set('phone')} placeholder="+91 98xxxxxxxx" /></div>
          <div className="field"><label>Date of birth *</label><input type="date" required value={form.dateOfBirth} onChange={set('dateOfBirth')} /></div>
          <div className="field"><label>State / region</label><input value={form.state} onChange={set('state')} /></div>
          <div className="field"><label>Nationality *</label><input required value={form.nationality} onChange={set('nationality')} /></div>
          <div className="field">
            <label>Playing role *</label>
            <select value={form.role} onChange={set('role')}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Category *</label>
            <select value={form.isCapped} onChange={set('isCapped')}>
              <option value="true">Capped (has played at national level)</option>
              <option value="false">Uncapped</option>
            </select>
          </div>
          <div className="field">
            <label>Batting style</label>
            <select value={form.battingStyle} onChange={set('battingStyle')}>
              <option value="RIGHT_HAND">Right-hand</option>
              <option value="LEFT_HAND">Left-hand</option>
            </select>
          </div>
          {bowls && (
            <div className="field">
              <label>Bowling style</label>
              <select value={form.bowlingStyle} onChange={set('bowlingStyle')}>
                {BOWLING_STYLES.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
          )}
        </div>

        <h3 style={{ margin: '8px 0 10px' }}>Career stats <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>(shown to team owners during bidding)</span></h3>
        <div className="grid two">
          <div className="field"><label>Matches played</label><input type="number" min="0" value={form.matchesPlayed} onChange={set('matchesPlayed')} /></div>
          {bats && <>
            <div className="field"><label>Runs scored</label><input type="number" min="0" value={form.runs} onChange={set('runs')} /></div>
            <div className="field"><label>Batting average</label><input type="number" min="0" step="0.01" value={form.battingAverage} onChange={set('battingAverage')} /></div>
            <div className="field"><label>Strike rate</label><input type="number" min="0" step="0.01" value={form.strikeRate} onChange={set('strikeRate')} /></div>
          </>}
          {bowls && <>
            <div className="field"><label>Wickets taken</label><input type="number" min="0" value={form.wickets} onChange={set('wickets')} /></div>
            <div className="field"><label>Economy rate</label><input type="number" min="0" step="0.01" value={form.economy} onChange={set('economy')} /></div>
          </>}
        </div>

        <div className="field">
          <label>Player photo (optional, shown on the auction screen)</label>
          <div className="row">
            <input type="file" accept="image/*" onChange={pickPhoto} style={{ maxWidth: 320 }} />
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="Preview" style={{ height: 84, borderRadius: 8, border: '1px solid var(--line)' }} />
            )}
          </div>
        </div>
        <div className="field"><label>Achievements</label><textarea value={form.achievements} onChange={set('achievements')} maxLength={1000} /></div>
        {error && <div className="msg err">{error}</div>}
        <button className="btn" disabled={busy}>{busy ? 'Submitting…' : 'Submit registration'}</button>
      </form>
    </div>
  );
}
