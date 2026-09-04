import manifest from '@/workbench/manifest.json';

type GenerateRequest = {
  operation?: unknown;
  image?: unknown;
  prompt?: unknown;
  tile?: unknown;
  layer?: unknown;
  mask_mode?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function POST(request: Request) {
  let input: GenerateRequest;
  try {
    input = (await request.json()) as GenerateRequest;
  } catch {
    return Response.json({ error: '请求体必须是有效的 JSON。' }, { status: 400 });
  }

  if (
    input.operation !== 'generate-layer' ||
    typeof input.image !== 'string' ||
    !input.image.startsWith('data:image/') ||
    typeof input.prompt !== 'string' ||
    !isRecord(input.tile) ||
    typeof input.layer !== 'string' ||
    typeof input.mask_mode !== 'string'
  ) {
    return Response.json({ error: '地图扩图输入不完整或格式错误。' }, { status: 400 });
  }

  const capability = manifest.capabilities.find(
    (candidate) => candidate.id === 'map-stitcher',
  );
  if (!capability) {
    return Response.json({ error: '地图拼接能力未注册。' }, { status: 500 });
  }

  const generationUrlEnv = capability.connector.generationUrlEnv;
  if (typeof generationUrlEnv !== 'string') {
    return Response.json({ error: '地图能力缺少扩图服务配置项。' }, { status: 500 });
  }
  const connectorUrl = process.env[generationUrlEnv];
  if (!connectorUrl) {
    return Response.json(
      { error: `外部扩图服务尚未配置：${generationUrlEnv}` },
      { status: 503 },
    );
  }

  const generationTokenEnv = capability.connector.generationTokenEnv;
  const token = typeof generationTokenEnv === 'string' ? process.env[generationTokenEnv] : undefined;

  try {
    const connectorResponse = await fetch(connectorUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        image: input.image,
        prompt: input.prompt,
        tile: input.tile,
        layer: input.layer,
        mask_mode: input.mask_mode,
      }),
    });

    const responseText = await connectorResponse.text();
    let payload: unknown = null;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      payload = null;
    }

    if (!connectorResponse.ok) {
      return Response.json(
        { error: `外部扩图服务返回 HTTP ${connectorResponse.status}。` },
        { status: 502 },
      );
    }

    const record = isRecord(payload) ? payload : {};
    const result = isRecord(record.result) ? record.result : record;
    const image = result.image ?? result.data ?? result.url;
    if (typeof image !== 'string' || image.length === 0) {
      return Response.json({ error: '外部扩图服务没有返回图片。' }, { status: 502 });
    }

    return Response.json({ image });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '外部扩图服务调用失败。' },
      { status: 502 },
    );
  }
}
