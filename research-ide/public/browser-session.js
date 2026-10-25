// Storage may be unavailable in private browsing or when storage is disabled.
export function sessionRead(key, fallback = '') {
  try {
    return sessionStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function sessionWrite(key, value) {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Create the shared JSON transport. The key is captured once at startup. */
export function createApiClient(accessKey, request = globalThis.fetch) {
  return async function api(url, options = {}) {
    const response = await request(url, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(accessKey ? { 'x-access-key': accessKey } : {}),
        ...options.headers
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `Request failed (${response.status}).`);
    }
    return body;
  };
}
