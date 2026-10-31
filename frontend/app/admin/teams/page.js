'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import useAdmin from '../../../components/useAdmin';
import { fmtPrice } from '../../../lib/format';

const BLANK = { name: '', short_name: '', owner_name: '', color: '#1d6fd6', purse_lakh: 12000, max_squad: 25, max_overseas: 8 };

function Row({ team, onSaved, flash }) {
  const [t, setT] = useState(team);
  const set = (k, num) => (e) => setT({ ...t, [k]: num ? Number(e.target.value) : e.target.value });
  const body = () => ({
    name: t.name, short_name: t.short_name, owner_name: t.owner_name || '', color: t.color,
    purse_lakh: t.purse_lakh, max_squad: t.max_squad, max_overseas: t.max_overseas,
  });
  async function save() {
    try {
      await api(`/admin/teams/${t.id}`, { method: 'PUT', auth: true, body: body() });
      flash('ok', `${t.name} saved`);
      onSaved();
    } catch (e) { flash('err', e.message); }
  }
  async function passcode() {
    if (t.has_passcode && !confirm(`Reset the passcode for ${t.name}? The old one stops working.`)) return;
    try {
      const { passcode: code } = await api(`/admin/teams/${t.id}/passcode`, { method: 'POST', auth: true });
      flash('ok', `Passcode for ${t.short_name}: ${code}  (shown once, share it with the owner)`);
      onSaved();
    } catch (e) { flash('err', e.message); }
  }
  async function remove() {
    if (!confirm(`Delete ${t.name}?`)) return;
    try { await api(`/admin/teams/${t.id}`, { method: 'DELETE', auth: true }); onSaved(); } catch (e) { flash('err', e.message); }
  }
  return (
    <tr>
      <td><input value={t.name} onChange={set('name')} /></td>
      <td><input style={{ width: 70 }} value={t.short_name} onChange={set('short_name')} maxLength={5} /></td>
      <td><input value={t.owner_name || ''} onChange={set('owner_name')} placeholder="Owner / manager" /></td>
      <td><input type="color" value={t.color} onChange={set('color')} style={{ width: 48, padding: 2 }} /></td>
      <td><input type="number" style={{ width: 90 }} value={t.purse_lakh} onChange={set('purse_lakh', true)} /><br /><small className="muted">{fmtPrice(t.purse_lakh)}</small></td>
      <td><input type="number" style={{ width: 60 }} value={t.max_squad} onChange={set('max_squad', true)} /></td>
      <td><input type="number" style={{ width: 60 }} value={t.max_overseas} onChange={set('max_overseas', true)} /></td>
      <td>
        <div className="row">
          <button className="btn small" onClick={save}>Save</button>
          <button className="btn small alt" onClick={passcode}>{t.has_passcode ? 'Reset passcode' : 'Create passcode'}</button>
          <button className="btn small danger" onClick={remove}>Delete</button>
        </div>
        <small className={t.has_passcode ? '' : 'muted'}>{t.has_passcode ? '✔ can log in' : 'no passcode yet'}</small>
      </td>
    </tr>
  );
}

export default function Teams() {
  const ready = useAdmin();
  const [teams, setTeams] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const flash = (type, text) => setMsg({ type, text });
  const load = useCallback(() => api('/admin/teams', { auth: true }).then(setTeams).catch((e) => flash('err', e.message)), []);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  async function add(e) {
    e.preventDefault();
    try {
      await api('/admin/teams', { method: 'POST', auth: true, body: form });
      setForm(BLANK); flash('ok', 'Team added'); load();
    } catch (err) { flash('err', err.message); }
  }
  const set = (k, num) => (e) => setForm({ ...form, [k]: num ? Number(e.target.value) : e.target.value });
  if (!ready) return <div className="container muted">Loading…</div>;

  return (
    <div className="container">
      <h1>Teams &amp; owners</h1>
      <p className="muted">Give each franchise a colour, an owner name and a login passcode. Purses are in lakh (100 lakh = ₹1 Cr).</p>
      {msg.text && <div className={`msg ${msg.type}`} style={{ fontWeight: msg.type === 'ok' ? 600 : 400 }}>{msg.text}</div>}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Team name</th><th>Short</th><th>Owner</th><th>Colour</th><th>Purse (L)</th><th>Squad</th><th>Overseas</th><th>Actions</th></tr></thead>
            <tbody>{teams.map((t) => <Row key={`${t.id}-${t.name}-${t.color}-${t.owner_name}-${t.has_passcode}`} team={t} onSaved={load} flash={flash} />)}</tbody>
          </table>
        </div>
      </div>
      <form className="card" onSubmit={add}>
        <h3>Add a team</h3>
        <div className="grid two">
          <div className="field"><label>Team name</label><input required value={form.name} onChange={set('name')} /></div>
          <div className="field"><label>Short name (2-5 letters)</label><input required maxLength={5} value={form.short_name} onChange={set('short_name')} /></div>
          <div className="field"><label>Owner / manager</label><input value={form.owner_name} onChange={set('owner_name')} /></div>
          <div className="field"><label>Colour</label><input type="color" value={form.color} onChange={set('color')} /></div>
        </div>
        <button className="btn">Add team</button>
      </form>
    </div>
  );
}
