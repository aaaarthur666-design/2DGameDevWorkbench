import { sceneSplitInputs as inputs } from './scene-split-contract.mjs';
import { sceneSplitRequest } from './scene-splits.mjs';
import { forwardImageEditRequest } from './image-edit-client.mjs';

export { inputs };

export function request(
  root,
  manifest,
  operation,
  input,
  { documentAuthority },
) {
  return documentAuthority
    ? sceneSplitRequest(root, manifest, operation, input)
    : forwardImageEditRequest(operation, input, inputs);
}
