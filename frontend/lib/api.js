export async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const t = localStorage.getItem(auth === 'team' ? 'teamToken' : 'token');
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    if (res.status === 401 && auth) {
      localStorage.removeItem(auth === 'team' ? 'teamToken' : 'token');
      window.location.href = auth === 'team' ? '/team/login' : '/admin/login';
    }
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function downloadCsv() {
  const res = await fetch('/api/admin/players.csv', {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  });
  if (!res.ok) throw new Error('Could not export players');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'players.csv';
  a.click();
  URL.revokeObjectURL(url);
}
