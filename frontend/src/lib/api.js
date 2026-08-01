/**
 * Single source of truth for API access.
 *
 * The base URL was previously duplicated across four components, and two of the
 * copies had drifted (one treated 127.0.0.1 as local, one did not).
 */

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

function resolveBaseUrl() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (LOCAL_HOSTS.includes(window.location.hostname)) return 'http://localhost:3000';
  return 'https://telegrambot-1ufk.onrender.com';
}

export const API_URL = resolveBaseUrl();

export const TOKEN_KEY = 'techstore_token';
export const SESSION_KEY = 'techstore_ai_session';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

/** Fetch wrapper that parses JSON safely and surfaces the server's error message. */
export async function apiFetch(path, { auth = false, headers = {}, ...options } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: auth ? authHeaders(headers) : headers,
  });

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(body?.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}
