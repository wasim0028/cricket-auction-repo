'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';

export default function Home() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/public/status').then(setStatus).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="container">
      <div className="hero">
        <h1>Player Auction 2027</h1>
        <p>Register your cricketing profile. Once the window closes, the auction runs category by category: capped batsmen, bowlers, wicketkeepers and all-rounders, then uncapped players.</p>
        {status?.registrationOpen ? (
          <Link href="/register"><button className="btn">Register as a player</button></Link>
        ) : null}
      </div>

      {error && <div className="msg err">{error}</div>}
      {status && (
        <div className="grid two">
          <div className="card">
            <h3>Registration</h3>
            <p>
              <span className={`badge ${status.registrationOpen ? 'green' : 'red'}`}>
                {status.registrationOpen ? 'OPEN' : 'CLOSED'}
              </span>
            </p>
            {status.registrationDeadline && (
              <p className="muted">Closes: {fmtDateTime(status.registrationDeadline)}</p>
            )}
          </div>
          <div className="card">
            <h3>Auction day</h3>
            <p>{status.auctionDate ? status.auctionDate : 'To be announced'}</p>
            <Link href="/board">View auction board →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
