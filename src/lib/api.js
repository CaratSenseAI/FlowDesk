const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

function getToken() {
  return localStorage.getItem('fd_token');
}

export function clearToken() {
  localStorage.removeItem('fd_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers ?? {}),
  };

  // A fetch that never gets a response throws a bare "Load failed" (Safari) or
  // "Failed to fetch" (Chrome), which then surfaces to the user verbatim and
  // tells them nothing. It means one of three things — server restarting, server
  // crashed mid-request, or no connection — and all three are worth saying.
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error(
      'Could not reach the server. It may be restarting, or you may be offline — ' +
      'wait a few seconds and try again.',
    );
  }

  if (res.status === 401) {
    clearToken();
    window.location.reload();
    return;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  // Fire-and-forget ping to wake the server without auth or error side-effects
  warmup: () => fetch(`${BASE}/api/health`).catch(() => {}),
};
