import {
  fetchWorkbenchRuntime,
  runtimeUnavailable,
} from '@/lib/workbench/runtime-proxy';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: '请求体必须是有效的 JSON。' }, { status: 400 });
  }
  if (!isRecord(input)) {
    return Response.json({ error: '地图生图输入必须是 JSON 对象。' }, { status: 400 });
  }

  try {
    const response = await fetchWorkbenchRuntime('/v1/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilityId: 'map-stitcher', input }),
    });
    const payload = (await response.json().catch(() => null)) as {
      taskId?: string;
      status?: string;
      outputs?: string[];
      requiredEnvironment?: string;
      error?: string;
    } | null;
    if (!response.ok || !payload) {
      return Response.json(
        {
          error: payload?.error ?? `地图生图任务失败（HTTP ${response.status}）。`,
          taskId: payload?.taskId,
        },
        { status: response.status },
      );
    }
    if (payload.status === 'awaiting_configuration') {
      return Response.json(
        {
          error: payload.requiredEnvironment
            ? `图片生成服务尚未配置：${payload.requiredEnvironment}`
            : '图片生成服务尚未配置。',
          taskId: payload.taskId,
        },
        { status: 503 },
      );
    }

    const output = payload.outputs?.find((value) =>
      value.endsWith(input.operation === 'generate-origin' ? '/generated-origin.png' : '/generated-layer.png'),
    );
    if (payload.status !== 'completed' || !output) {
      return Response.json(
        {
          error: payload.error ?? '地图生图任务没有生成可用图片。',
          taskId: payload.taskId,
        },
        { status: 502 },
      );
    }
    return Response.json({
      image: `/api/workbench/artifacts?path=${encodeURIComponent(output)}`,
      output,
      taskId: payload.taskId,
      status: payload.status,
    });
  } catch (error) {
    return runtimeUnavailable(error);
  }
}
