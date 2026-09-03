import manifest from '@/workbench/manifest.json';
import { validateCapabilityInput } from '@/lib/workbench/validate-input';

type TaskRequest = {
  capabilityId?: unknown;
  input?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function POST(request: Request) {
  let payload: TaskRequest;
  try {
    payload = (await request.json()) as TaskRequest;
  } catch {
    return Response.json(
      { error: '请求体必须是有效的 JSON。' },
      { status: 400 },
    );
  }

  if (typeof payload.capabilityId !== 'string' || !isRecord(payload.input)) {
    return Response.json(
      { error: 'capabilityId 必须是字符串，input 必须是对象。' },
      { status: 400 },
    );
  }

  const capability = manifest.capabilities.find(
    (candidate) => candidate.id === payload.capabilityId,
  );
  if (!capability) {
    return Response.json({ error: '未找到指定能力。' }, { status: 404 });
  }

  const validationErrors = validateCapabilityInput(
    capability.inputSchema,
    payload.input,
  );
  if (validationErrors.length > 0) {
    return Response.json(
      { error: '能力输入校验失败。', details: validationErrors },
      { status: 400 },
    );
  }

  const taskId = `${capability.id}-${crypto.randomUUID().slice(0, 8)}`;
  const connectorUrl = process.env[capability.connector.urlEnv];
  if (!connectorUrl) {
    return Response.json(
      {
        taskId,
        capabilityId: capability.id,
        status: 'awaiting_configuration',
        requiredEnvironment: capability.connector.urlEnv,
      },
      { status: 202 },
    );
  }

  const token = process.env[capability.connector.tokenEnv];

  try {
    const connectorResponse = await fetch(connectorUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        taskId,
        capabilityId: capability.id,
        input: payload.input,
      }),
    });

    const responseText = await connectorResponse.text();
    let result: unknown = null;
    try {
      result = responseText ? JSON.parse(responseText) : null;
    } catch {
      result = { text: responseText };
    }

    if (!connectorResponse.ok) {
      return Response.json(
        {
          taskId,
          capabilityId: capability.id,
          status: 'failed',
          error: `连接器返回 HTTP ${connectorResponse.status}。`,
        },
        { status: 502 },
      );
    }

    return Response.json({
      taskId,
      capabilityId: capability.id,
      status: 'completed',
      result,
    });
  } catch (error) {
    return Response.json(
      {
        taskId,
        capabilityId: capability.id,
        status: 'failed',
        error: error instanceof Error ? error.message : '连接器调用失败。',
      },
      { status: 502 },
    );
  }
}
