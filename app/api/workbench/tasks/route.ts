import {
  fetchWorkbenchRuntime,
  runtimeUnavailable,
} from '@/lib/workbench/runtime-proxy';

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const limit = searchParams.get('limit') ?? '30';
  const refresh = searchParams.get('refresh') === 'true' ? 'true' : 'false';
  try {
    const response = await fetchWorkbenchRuntime(
      `/v1/tasks?limit=${encodeURIComponent(limit)}&refresh=${refresh}`,
    );
    return forwardJson(response);
  } catch (error) {
    return runtimeUnavailable(error);
  }
}

export async function POST(request: Request) {
  try {
    const response = await fetchWorkbenchRuntime('/v1/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: await request.text(),
    });
    return forwardJson(response);
  } catch (error) {
    return runtimeUnavailable(error);
  }
}

async function forwardJson(response: Response) {
  return new Response(await response.text(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
