import {
  fetchWorkbenchRuntime,
  runtimeUnavailable,
} from '@/lib/workbench/runtime-proxy';

async function forward(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const response = await fetchWorkbenchRuntime(
      `/v1/map-stitcher/projects/${encodeURIComponent(id)}`,
      {
        method: request.method,
        ...(request.method === 'PUT'
          ? {
              headers: {
                'content-type': 'application/zip',
                'x-map-revision': request.headers.get('x-map-revision') || '',
              },
              body: request.body,
              duplex: 'half',
            }
          : {}),
      } as RequestInit,
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') || 'application/json',
        'x-map-revision': response.headers.get('x-map-revision') || '',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return runtimeUnavailable(error);
  }
}
export const GET = forward;
export const PUT = forward;
