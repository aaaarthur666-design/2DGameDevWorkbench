import {
  fetchWorkbenchRuntime,
  runtimeUnavailable,
} from '@/lib/workbench/runtime-proxy';

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await context.params;
    const refresh = new URL(request.url).searchParams.get('refresh') === 'true';
    const response = await fetchWorkbenchRuntime(
      `/v1/tasks/${encodeURIComponent(taskId)}?refresh=${refresh}`,
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
