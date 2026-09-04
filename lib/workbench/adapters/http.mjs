export class AdapterHttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'AdapterHttpError';
    this.status = status;
    this.body = body;
  }
}

export function endpointUrl(baseUrl, pathname) {
  const normalized = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('Adapter endpoint is empty.');
  return `${normalized}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

export async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal ?? controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text ? { text } : null;
    }
    if (!response.ok) {
      const detail = body?.error?.message ?? body?.error ?? response.statusText;
      throw new AdapterHttpError(
        `Adapter returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        { status: response.status, body },
      );
    }
    if (body && body.ok === false) {
      throw new AdapterHttpError(body.error?.message ?? 'Adapter rejected the request.', {
        status: response.status,
        body,
      });
    }
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Adapter request timed out: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function bearerHeaders(token) {
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}
