import { fetchWorkbenchRuntime, runtimeUnavailable } from '@/lib/workbench/runtime-proxy';

async function forward(request?: Request) {
  try {
    const response = await fetchWorkbenchRuntime('/v1/image-assets/settings', request ? {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: await request.text(),
    } : undefined);
    return new Response(response.body, { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (error) { return runtimeUnavailable(error); }
}
export const GET = () => forward();
export const POST = (request: Request) => forward(request);
