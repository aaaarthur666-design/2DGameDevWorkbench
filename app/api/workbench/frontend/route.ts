import { fetchWorkbenchRuntime, runtimeUnavailable } from '@/lib/workbench/runtime-proxy';
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Invalid origin.' }, { status: 403 });
  try {
    const body = await request.text();
    if (body.length > 16_384) return Response.json({ error: 'Page context is too large.' }, { status: 413 });
    const response = await fetchWorkbenchRuntime('/v1/frontend/heartbeat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
      signal: AbortSignal.timeout(5000),
    });
    return new Response(response.body, { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (error) { return runtimeUnavailable(error); }
}
