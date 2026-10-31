'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import useLive from '../lib/useLive';
import {
  CATEGORIES, ROLE_LABEL, SQUAD_NEEDS, fmtPrice, flagCode, initials, timeAgo,
} from '../lib/format';

/* ------------------------------ small pieces ------------------------------ */

function Badge({ short, color, size = 34 }) {
  return (
    <span className="lv-badge" style={{ background: color, width: size, height: size, fontSize: size * 0.3 }}>
      {short}
    </span>
  );
}

function decodeTeamToken() {
  try {
    const t = localStorage.getItem('teamToken');
    if (!t) return null;
    const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (p.role !== 'team' || p.exp * 1000 < Date.now()) return null;
    return { teamId: p.teamId, shortName: p.shortName };
  } catch {
    return null;
  }
}

function playerStats(p) {
  const f = (n, d = 2) => (n ? Number(n).toFixed(d) : '-');
  const hand = p.batting_style === 'LEFT_HAND' ? 'Left-hand' : p.batting_style ? 'Right-hand' : '-';
  const base = ['Base price', fmtPrice(p.base_price_lakh)];
  if (p.role === 'BOWLER')
    return [['Matches', p.matches_played], ['Wickets', p.wickets || '-'], ['Economy', f(p.economy)],
      ['Bowling', p.bowling_style || '-'], base, ['Category', p.is_capped ? 'Capped' : 'Uncapped']];
  if (p.role === 'ALLROUNDER')
    return [['Matches', p.matches_played], ['Runs', p.runs || '-'], ['Average', f(p.batting_avg)],
      ['Strike rate', f(p.strike_rate)], ['Wickets', p.wickets || '-'], ['Economy', f(p.economy)]];
  return [['Matches', p.matches_played], ['Runs', p.runs || '-'], ['Average', f(p.batting_avg)],
    ['Strike rate', f(p.strike_rate)], base, ['Batting', hand]];
}

/* -------------------------------- panels --------------------------------- */

function ResultBanner({ r }) {
  const sold = r.result === 'SOLD';
  return (
    <div className="lv-result" style={sold ? { background: `linear-gradient(135deg, ${r.teamColor}, #11142a)` } : undefined}>
      <div className="lv-result-tag">{sold ? 'SOLD' : r.result === 'UNSOLD' ? 'UNSOLD' : 'WITHDRAWN'}</div>
      <h2>{r.playerName}</h2>
      {sold ? (
        <p>to <b>{r.teamName}</b> for <b>{fmtPrice(r.priceLakh)}</b></p>
      ) : (
        <p className="lv-muted">{r.result === 'UNSOLD' ? 'No bids received' : 'Taken off the block'}</p>
      )}
    </div>
  );
}

function PlayerCard({ player, lastResult }) {
  if (!player)
    return (
      <div className="lv-card lv-player lv-player-empty">
        {lastResult ? (
          <ResultBanner r={lastResult} />
        ) : (
          <div>
            <h3>Waiting for the next player</h3>
            <p className="lv-muted">The auctioneer will bring the next player to the block.</p>
          </div>
        )}
      </div>
    );
  return (
    <div className="lv-card lv-player">
      <div className="lv-namebar">
        <b>{player.full_name}</b>
        <span className="lv-flag">{flagCode(player.nationality)}</span>
      </div>
      <div className="lv-pl-body">
        <div>
          <div className="lv-stats">
            {playerStats(player).map(([k, v]) => (
              <div key={k}><small>{k}</small><b>{v}</b></div>
            ))}
          </div>
          <div className="lv-tags">
            <span className="lv-tag gold">{ROLE_LABEL[player.role]}</span>
            <span className="lv-tag">{player.is_capped ? 'Capped' : 'Uncapped'}</span>
            {player.is_overseas && <span className="lv-tag blue">Overseas</span>}
            {player.state && <span className="lv-tag">{player.state}</span>}
          </div>
        </div>
        <div className="lv-photo">
          {player.has_photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/live/photo/${player.id}`} alt={player.full_name} />
          ) : (
            <span>{initials(player.full_name)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function HostCard({ status, remaining, lastResult, children }) {
  let msg = 'Waiting for the next player';
  if (status === 'BIDDING') msg = remaining <= 2000 ? 'Going twice…' : remaining <= 5000 ? 'Going once…' : 'Bidding is open';
  else if (status === 'PAUSED') msg = 'Auction paused';
  else if (lastResult?.result === 'SOLD') msg = `Sold! ${lastResult.playerName} to ${lastResult.team}`;
  else if (lastResult?.result === 'UNSOLD') msg = `${lastResult.playerName} goes unsold`;
  return (
    <div className="lv-card lv-host">
      <div className="lv-host-stage">
        <span className={`lv-onair ${status === 'BIDDING' ? 'on' : ''}`}>● ON AIR</span>
        <svg viewBox="0 0 24 24" width="54" height="54" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
        </svg>
      </div>
      <div className="lv-host-meta">
        <b>Auctioneer</b>
        <small>Host &amp; Auction Moderator</small>
        <p className={`lv-host-msg ${status}`}>{msg}</p>
      </div>
      {children}
    </div>
  );
}

function BidPanel({ snap, remaining, me, mode, nowMs, onBid, busy, toast }) {
  const { state, teams, timerSeconds } = snap;
  const live = state.status !== 'IDLE';
  const leader = teams.find((t) => t.id === state.leadingTeamId);
  const myTeam = me?.type === 'team' ? teams.find((t) => t.id === me.teamId) : null;
  const next = state.nextPriceLakh;

  let reason = '';
  if (mode === 'admin') reason = 'You are running the auction';
  else if (!myTeam) reason = 'Log in as a team to bid';
  else if (!live) reason = 'Waiting for the next player';
  else if (state.status === 'PAUSED') reason = 'Auction is paused';
  else if (remaining <= 0) reason = 'Time is up';
  else if (state.leadingTeamId === myTeam.id) reason = 'You hold the highest bid';
  else if (next > myTeam.remaining_lakh) reason = 'Not enough purse left';
  else if (myTeam.squad_size >= myTeam.max_squad) reason = 'Your squad is full';
  else if (state.player?.is_overseas && myTeam.overseas_count >= myTeam.max_overseas) reason = 'Overseas limit reached';

  const total = (state.history.length ? timerSeconds : timerSeconds * 2) * 1000;
  const pct = live ? Math.min(100, (remaining / total) * 100) : 0;
  const secs = Math.ceil(remaining / 1000);
  const hot = live && state.status === 'BIDDING' && remaining <= 5000;
  const increment = state.leadingTeamId ? next - state.currentPriceLakh : 0;

  return (
    <div className="lv-card lv-bid">
      <div className="lv-price">{live ? fmtPrice(state.currentPriceLakh) : '—'}</div>
      <div className="lv-cap">{state.leadingTeamId ? 'CURRENT BID' : live ? 'OPENING PRICE' : 'NO PLAYER ON THE BLOCK'}</div>

      <div className="lv-leader">
        {leader ? (
          <>
            <Badge short={leader.short_name} color={leader.color} size={30} />
            <span><b>{leader.short_name}</b> raised for {state.currentPriceLakh} L</span>
          </>
        ) : (
          <span className="lv-muted">{live ? 'No bids yet' : 'Bidding opens soon'}</span>
        )}
      </div>

      <div className="lv-next">
        <span className="lv-chip">{live ? (increment ? `+ ₹${increment} L` : `Opens at ${fmtPrice(next)}`) : '—'}</span>
        {live && increment > 0 && <small className="lv-muted">next {fmtPrice(next)}</small>}
      </div>

      <div className={`lv-timer ${hot ? 'hot' : ''}`}>
        <div className="lv-track"><div className="lv-fill" style={{ width: `${pct}%` }} /></div>
        <small>
          {state.status === 'PAUSED' ? 'Paused' : live ? `${secs} Second${secs === 1 ? '' : 's'} Remaining` : 'Timer idle'}
        </small>
      </div>

      <button className="lv-bidbtn" disabled={!!reason || busy} onClick={onBid}>
        {reason ? 'BID' : `BID + ₹${increment || next} L`}
        {!reason && !increment && <small> at base</small>}
      </button>
      <p className="lv-reason">{toast || reason}</p>
    </div>
  );
}

function History({ snap, nowMs }) {
  const { state } = snap;
  return (
    <div className="lv-card lv-hist">
      <h4>Bid History{state.player ? ` For ${state.player.full_name}` : ''}</h4>
      {state.history.length === 0 ? (
        <p className="lv-muted">No bids yet.</p>
      ) : (
        <ul>
          {state.history.map((b) => (
            <li key={b.id}>
              <Badge short={b.team} color={b.team_color} size={30} />
              <span>
                <b>{b.team}</b> - Raised For {b.price_lakh} L
                <small>{timeAgo(b.at, nowMs)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamGrid({ snap, me }) {
  const { teams, state } = snap;
  return (
    <div className="lv-teams">
      {teams.map((t) => {
        const lead = t.id === state.leadingTeamId;
        const mine = me?.type === 'team' && me.teamId === t.id;
        return (
          <div key={t.id} className={`lv-team ${lead ? 'lead' : ''} ${mine ? 'mine' : ''}`} style={{ '--tc': t.color }}>
            <div className="lv-team-av"><span>{initials(t.owner_name || t.name)}</span><Badge short={t.short_name} color={t.color} size={26} /></div>
            <div className="lv-team-info">
              <b>{t.owner_name || t.name}</b>
              <small>{t.owner_name ? `Owner, ${t.short_name}` : t.short_name}</small>
              <em>{fmtPrice(t.remaining_lakh)} · {t.squad_size}/{t.max_squad}</em>
            </div>
            {lead && <span className="lv-lead-tag">LEADING</span>}
          </div>
        );
      })}
    </div>
  );
}

function SquadStats({ snap, me }) {
  const { teams, state } = snap;
  const [all, setAll] = useState(false);
  const order = [...teams].sort((a, b) => {
    const score = (t) => (me?.type === 'team' && me.teamId === t.id ? 0 : t.id === state.leadingTeamId ? 1 : 2);
    return score(a) - score(b);
  });
  const shown = all ? order : order.slice(0, 4);
  return (
    <div className="lv-card lv-squads">
      <div className="lv-squads-head">
        <h4>Team Squad Stats</h4>
        {teams.length > 4 && <button className="lv-link" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${teams.length}`}</button>}
      </div>
      <div className="lv-squads-grid">
        {shown.map((t) => (
          <div key={t.id} className="lv-squad">
            <div className="lv-squad-top">
              <b style={{ color: t.color }}>{t.short_name}</b>
              <span>{t.squad_size}/{t.max_squad}</span>
              <span title="Overseas players">✈ {t.overseas_count}/{t.max_overseas}</span>
              <span className="lv-muted">Need</span>
            </div>
            {SQUAD_NEEDS.map((r) => (
              <div key={r.key} className="lv-squad-row">
                <span>{r.label}</span>
                <b>{t.composition[r.key]}</b>
                <span className={t.composition[r.key] >= r.need ? 'ok' : 'lv-muted'}>{r.need}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- auctioneer bar ----------------------------- */

function Controls({ snap, setToast }) {
  const [setKey, setSetKey] = useState('');
  const [timer, setTimer] = useState(snap.timerSeconds);
  const live = snap.state.status !== 'IDLE';
  const paused = snap.state.status === 'PAUSED';

  async function run(path, body) {
    setToast('');
    try {
      await api(`/admin/live/${path}`, { method: 'POST', auth: true, body: body || {} });
    } catch (e) {
      setToast(e.message);
    }
  }
  const startNext = () => {
    const c = CATEGORIES.find((x) => x.key === setKey);
    run('next', c ? { role: c.role, isCapped: c.isCapped } : {});
  };
  async function saveTimer() {
    setToast('');
    try {
      await api('/admin/settings', { method: 'PUT', auth: true, body: { bidTimerSeconds: Number(timer) } });
      setToast('Timer saved');
    } catch (e) {
      setToast(e.message);
    }
  }

  return (
    <div className="lv-controls">
      <div className="lv-ctl-row">
        <select value={setKey} onChange={(e) => setSetKey(e.target.value)} disabled={live}>
          <option value="">Next in set order</option>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <button className="lv-btn primary" disabled={live} onClick={startNext}>Start next player</button>
      </div>
      <div className="lv-ctl-row">
        {paused ? (
          <button className="lv-btn" onClick={() => run('resume')}>Resume</button>
        ) : (
          <button className="lv-btn" disabled={!live} onClick={() => run('pause')}>Pause</button>
        )}
        <button className="lv-btn" disabled={!live || paused} onClick={() => run('extend', { seconds: 10 })}>+10s</button>
        <button className="lv-btn danger" disabled={!live} onClick={() => run('finalize')}>
          {snap.state.leadingTeamId ? 'Sell now' : 'Mark unsold'}
        </button>
        <button className="lv-btn" disabled={!live} onClick={() => confirm('Take this player off the block without a result?') && run('cancel')}>Cancel</button>
      </div>
      <div className="lv-ctl-row">
        <label>Bid timer (s)</label>
        <input type="number" min="5" max="120" value={timer} onChange={(e) => setTimer(e.target.value)} />
        <button className="lv-btn" onClick={saveTimer}>Save</button>
      </div>
    </div>
  );
}

/* --------------------------------- layout --------------------------------- */

export default function LiveRoom({ mode = 'public' }) {
  const { snap, conn, remaining, nowMs } = useLive();
  const [tab, setTab] = useState('bidding');
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    setMe(mode === 'admin' ? { type: 'admin' } : decodeTeamToken() ? { type: 'team', ...decodeTeamToken() } : null);
  }, [mode]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function bid() {
    if (!snap) return;
    setBusy(true);
    setToast('');
    try {
      await api('/live/bid', { method: 'POST', auth: 'team', body: { expectedPrice: snap.state.nextPriceLakh } });
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusy(false);
    }
  }
  const logoutTeam = () => {
    localStorage.removeItem('teamToken');
    window.location.href = '/live';
  };

  const myTeam = snap && me?.type === 'team' ? snap.teams.find((t) => t.id === me.teamId) : null;

  return (
    <div className="live">
      <div className="lv-frame">
        <header className="lv-top">
          <div className="lv-brand">🏏 <b>AUCTION 2027</b></div>
          <div className="lv-tabs">
            <button className={tab === 'bidding' ? 'on' : ''} onClick={() => setTab('bidding')}>BIDDING</button>
            <button className={tab === 'stage' ? 'on' : ''} onClick={() => setTab('stage')}>LIVE AUCTION</button>
          </div>
          <div className="lv-who">
            <span className={`lv-conn c-${conn}`}>{conn === 'live' ? '● LIVE' : conn === 'polling' ? '● Syncing' : '● Connecting'}</span>
            {mode === 'admin' && <span className="lv-id">Auctioneer</span>}
            {myTeam && (
              <span className="lv-id">
                <Badge short={myTeam.short_name} color={myTeam.color} size={26} /> {myTeam.name}
                <button className="lv-link" onClick={logoutTeam}>Log out</button>
              </span>
            )}
            {mode !== 'admin' && !myTeam && <Link className="lv-link" href="/team/login">Team login</Link>}
          </div>
        </header>

        {!snap ? (
          <div className="lv-loading">Connecting to the auction room…</div>
        ) : tab === 'bidding' ? (
          <div className="lv-body">
            <div className="lv-left">
              <div className="lv-row1">
                <HostCard status={snap.state.status} remaining={remaining} lastResult={snap.state.lastResult}>
                  {mode === 'admin' && <Controls snap={snap} setToast={setToast} />}
                </HostCard>
                <PlayerCard player={snap.state.player} lastResult={snap.state.lastResult} />
              </div>
              <TeamGrid snap={snap} me={me} />
            </div>
            <div className="lv-right">
              <div className="lv-bidrow">
                <BidPanel snap={snap} remaining={remaining} me={me} mode={mode} nowMs={nowMs} onBid={bid} busy={busy} toast={toast} />
                <History snap={snap} nowMs={nowMs} />
              </div>
              <SquadStats snap={snap} me={me} />
            </div>
          </div>
        ) : (
          <div className="lv-body stage">
            <div className="lv-stage-main">
              <PlayerCard player={snap.state.player} lastResult={snap.state.lastResult} />
              <div className="lv-ticker">
                <h4>Recent results</h4>
                <div className="lv-ticker-row">
                  {snap.recent.length === 0 && <span className="lv-muted">Nothing sold yet.</span>}
                  {snap.recent.map((r) => (
                    <div key={r.id} className={`lv-ticker-item ${r.action}`} style={r.team_color ? { borderColor: r.team_color } : undefined}>
                      <b>{r.full_name}</b>
                      <span>{r.action === 'SOLD' ? `${r.team} · ${fmtPrice(r.price_lakh)}` : 'Unsold'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="lv-stage-side">
              <BidPanel snap={snap} remaining={remaining} me={me} mode={mode} nowMs={nowMs} onBid={bid} busy={busy} toast={toast} />
              <History snap={snap} nowMs={nowMs} />
            </div>
          </div>
        )}
      </div>
      {mode === 'admin' && toast && <div className="lv-toast">{toast}</div>}
    </div>
  );
}
