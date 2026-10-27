import { sceneWorkflowInputs } from './scene-workflow-contract.mjs';

export async function forwardSceneWorkflowRequest(operation, raw) {
  const input = sceneWorkflowInputs[operation].parse(raw);
  const base =
    process.env.WORKBENCH_RUNTIME_URL?.trim() ||
    `http://127.0.0.1:${process.env.WORKBENCH_RUNTIME_PORT || 8790}`;
  let response;
  try {
    response = await fetch(
      `${base.replace(/\/+$/, '')}/v1/agent/${operation}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(120000),
      },
    );
  } catch {
    throw Object.assign(
      new Error(
        '场景协作 Bridge 不可用。请启动或复用工作台服务；不会回退到客户端写入或提交模型。',
      ),
      { code: 'SCENE_BRIDGE_UNAVAILABLE', status: 503 },
    );
  }
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(body.error || '场景协作请求失败。'), {
      status: response.status,
      code: body.code,
      currentRevision: body.currentRevision,
    });
  return body;
}
