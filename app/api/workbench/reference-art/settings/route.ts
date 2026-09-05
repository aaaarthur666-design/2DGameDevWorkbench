import {
  fetchWorkbenchRuntime,
  runtimeUnavailable,
} from '@/lib/workbench/runtime-proxy';

async function forward(request?: Request) {
  try {
    const response = await fetchWorkbenchRuntime(
      '/v1/reference-art/settings',
      request
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: await request.text(),
          }
        : undefined,
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return runtimeUnavailable(error);
  }
}
export async function GET() {
  return forward();
}
export async function POST(request: Request) {
  return forward(request);
}
