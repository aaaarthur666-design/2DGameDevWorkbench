import {
  fetchWorkbenchRuntime,
  runtimeUnavailable,
} from '@/lib/workbench/runtime-proxy';
import { sceneWorkflowInputs } from '@/lib/workbench/scene-workflow-contract.mjs';

export async function POST(
  request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  const name = `scene-workflow-${operation}`;
  if (!Object.hasOwn(sceneWorkflowInputs, name))
    return Response.json(
      { error: 'Unknown scene workflow operation.' },
      { status: 404 },
    );
  try {
    const response = await fetchWorkbenchRuntime(`/v1/agent/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: request.body,
      duplex: 'half',
    } as RequestInit);
    return new Response(response.body, {
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
