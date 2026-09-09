import {
  fetchWorkbenchRuntime,
  runtimeUnavailable,
} from '@/lib/workbench/runtime-proxy';
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const assetId = query.get('assetId') || '';
    const revision = query.get('projectRevision');
    const response = await fetchWorkbenchRuntime(
      `/v1/assets/preview?assetId=${encodeURIComponent(assetId)}${revision ? `&projectRevision=${encodeURIComponent(revision)}` : ''}`,
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type':
          response.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return runtimeUnavailable(error);
  }
}
