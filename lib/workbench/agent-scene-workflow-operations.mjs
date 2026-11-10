import { sceneWorkflowInputs as inputs } from './scene-workflow-contract.mjs';
import { sceneWorkflowRequest } from './scene-workflows.mjs';
import { sceneWorkflowPresentation } from './scene-workflow-presentation.mjs';
import { forwardSceneWorkflowRequest } from './scene-workflow-client.mjs';

export { inputs };

export async function request(
  root,
  manifest,
  operation,
  input,
  { documentAuthority },
) {
  const value = await (documentAuthority
    ? sceneWorkflowRequest(root, manifest, operation, input)
    : forwardSceneWorkflowRequest(operation, input));
  return value.work
    ? {
        ...value,
        presentation: sceneWorkflowPresentation(manifest, value.work),
      }
    : value;
}
