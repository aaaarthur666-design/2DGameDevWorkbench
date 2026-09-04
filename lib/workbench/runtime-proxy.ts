const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:8790';

export function workbenchRuntimeUrl(pathname: string) {
  const base = process.env.WORKBENCH_RUNTIME_URL?.trim() || DEFAULT_RUNTIME_URL;
  return `${base.replace(/\/+$/, '')}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

export async function fetchWorkbenchRuntime(pathname: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 370_000);
  try {
    return await fetch(workbenchRuntimeUrl(pathname), {
      ...init,
      cache: 'no-store',
      signal: init?.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function runtimeUnavailable(error: unknown) {
  return Response.json(
    {
      status: 'failed',
      error:
        error instanceof Error && error.name === 'AbortError'
          ? '本地 Workbench Runtime Bridge 请求超时。'
          : '本地 Workbench Runtime Bridge 未启动；请使用 npm run dev 或 npm run workbench:http。',
    },
    { status: 503 },
  );
}
