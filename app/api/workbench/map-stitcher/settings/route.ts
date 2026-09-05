import {
  fetchWorkbenchRuntime,
  runtimeUnavailable,
} from '@/lib/workbench/runtime-proxy';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function GET() {
  try {
    const response = await fetchWorkbenchRuntime('/v1/map-stitcher/settings');
    const payload = await response.json().catch(() => null);
    return Response.json(payload ?? { error: '无法读取地图 API 设置。' }, {
      status: response.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return runtimeUnavailable(error);
  }
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: '请求体必须是有效的 JSON。' }, { status: 400 });
  }
  if (!isRecord(input)) {
    return Response.json({ error: '地图 API 设置必须是 JSON 对象。' }, { status: 400 });
  }

  try {
    const response = await fetchWorkbenchRuntime('/v1/map-stitcher/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => null);
    return Response.json(payload ?? { error: '无法保存地图 API 设置。' }, {
      status: response.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return runtimeUnavailable(error);
  }
}
