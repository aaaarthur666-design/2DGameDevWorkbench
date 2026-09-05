import {
  fetchWorkbenchRuntime,
  runtimeUnavailable,
} from '@/lib/workbench/runtime-proxy';

export async function GET(request: Request) {
  try {
    const response = await fetchWorkbenchRuntime(
      `/v1/interactable-assets?path=${encodeURIComponent(new URL(request.url).searchParams.get('path') ?? '')}`,
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return runtimeUnavailable(error);
  }
}

export async function POST(request: Request) {
  try {
    const response = await fetchWorkbenchRuntime('/v1/interactable-assets', {
      method: 'POST',
      headers: {
        'content-type':
          request.headers.get('content-type') ?? 'application/octet-stream',
      },
      body: request.body,
      duplex: 'half',
    } as RequestInit);
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return runtimeUnavailable(e);
  }
}
