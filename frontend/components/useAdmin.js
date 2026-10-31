'use client';
import { useEffect, useState } from 'react';

// Redirects to login if there is no token; returns true once checked.
export default function useAdmin() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem('token')) {
      window.location.href = '/admin/login';
    } else {
      setReady(true);
    }
  }, []);
  return ready;
}
