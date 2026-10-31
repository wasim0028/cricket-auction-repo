'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function Nav() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isTeam, setIsTeam] = useState(false);
  useEffect(() => {
    try {
      setIsAdmin(!!localStorage.getItem('token'));
      setIsTeam(!!localStorage.getItem('teamToken'));
    } catch {}
  }, []);

  const logout = () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  return (
    <nav className="nav">
      <Link href="/" className="logo">🏏 Cricket Auction</Link>
      <Link href="/register">Register</Link>
      <Link href="/board">Auction Board</Link>
      <Link href="/live">Live Auction</Link>
      {isAdmin ? (
        <>
          <Link href="/admin">Dashboard</Link>
          <Link href="/admin/teams">Teams</Link>
          <Link href="/admin/live">Live Control</Link>
          <Link href="/admin/auction">Manual Console</Link>
          <a href="#" onClick={(e) => { e.preventDefault(); logout(); }}>Logout</a>
        </>
      ) : (
        <>
          {!isTeam && <Link href="/team/login">Team login</Link>}
          <Link href="/admin/login">Admin</Link>
        </>
      )}
    </nav>
  );
}
