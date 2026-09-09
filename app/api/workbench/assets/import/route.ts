import {
  fetchWorkbenchRuntime,
  runtimeUnavailable,
} from '@/lib/workbench/runtime-proxy';
export async function POST(request: Request) {
  try {
    const response = await fetchWorkbenchRuntime('/v1/assets/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(await request.json()),
      signal: AbortSignal.timeout(120000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return runtimeUnavailable(error);
  }
}
