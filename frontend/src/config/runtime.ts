const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const getWindowOrigin = (): string | null => {
  if (typeof window === 'undefined') return null;
  return window.location.origin;
};

const isLocalhost = (): boolean => {
  if (typeof window === 'undefined') return true;
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1';
};

const resolveOriginFromApiUrl = (apiUrl: string): string | null => {
  const origin = getWindowOrigin();
  try {
    return new URL(apiUrl, origin || undefined).origin;
  } catch {
    return null;
  }
};

const envApiUrl = import.meta.env.VITE_API_URL?.trim();
const envSocketUrl = import.meta.env.VITE_SOCKET_URL?.trim();

const isGithubPagesHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.endsWith('github.io');
};

export const API_BASE_URL = (() => {
  if (envApiUrl) return trimTrailingSlash(envApiUrl);

  // Local development default.
  if (isLocalhost()) return 'http://localhost:4000/api/v1';

  // Production fallback for reverse-proxy setups.
  const origin = getWindowOrigin();
  return origin ? `${origin}/api/v1` : 'http://localhost:4000/api/v1';
})();

export const SOCKET_BASE_URL = (() => {
  if (envSocketUrl) return trimTrailingSlash(envSocketUrl);

  // If API URL is configured, socket server is usually same origin.
  if (envApiUrl) {
    const apiOrigin = resolveOriginFromApiUrl(envApiUrl);
    if (apiOrigin) return apiOrigin;
  }

  if (isLocalhost()) return 'http://localhost:4000';

  // Production fallback for reverse-proxy setups.
  return getWindowOrigin() || 'http://localhost:4000';
})();

export const getApiConfigError = (): string | null => {
  // GitHub Pages cannot host backend API routes; require explicit backend URL.
  if (!envApiUrl && isGithubPagesHost()) {
    return 'Backend API is not configured for this deployment. Set VITE_API_URL and VITE_SOCKET_URL in GitHub repository secrets.';
  }
  return null;
};
