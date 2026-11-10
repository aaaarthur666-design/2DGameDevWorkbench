import { assetKindEnabled } from './asset-type-registry.mjs';

// Only the selected operation family loads its optional implementation.
export const agentOperationFamilies = Object.freeze(
  [
    {
      prefix: 'scene-split-',
      kind: 'scene',
      load: () => import('./agent-scene-split-operations.mjs'),
    },
    {
      prefix: 'scene-workflow-',
      kind: 'scene',
      load: () => import('./agent-scene-workflow-operations.mjs'),
    },
  ].map(Object.freeze),
);

export async function optionalAgentOperation(manifest, operation) {
  const family = agentOperationFamilies.find((entry) =>
    operation.startsWith(entry.prefix),
  );
  if (!family || !assetKindEnabled(manifest, family.kind)) return null;
  const implementation = await family.load();
  return Object.hasOwn(implementation.inputs, operation)
    ? implementation.request
    : null;
}
