import {
  executeMapStitcher,
  mapStitcherConfigured,
  validateMapStitcherInput,
} from './map-stitcher.mjs';
import {
  executeSpritePipeline,
  spritePipelineConfigured,
  validateSpritePipelineInput,
} from './sprite-pipeline.mjs';

const adapters = {
  'sprite-pipeline': {
    execute: executeSpritePipeline,
    configured: spritePipelineConfigured,
    validate: validateSpritePipelineInput,
  },
  'map-stitcher': {
    execute: executeMapStitcher,
    configured: mapStitcherConfigured,
    validate: validateMapStitcherInput,
  },
};

export function findAdapter(capability) {
  const adapterId = capability.connector?.adapter;
  const adapter = adapters[adapterId];
  if (!adapter) throw new Error(`Unknown local adapter: ${adapterId ?? '(missing)'}`);
  return { adapterId, ...adapter };
}

export function adapterConfigured(capability) {
  if (capability.connector?.type !== 'local-adapter') {
    return Boolean(process.env[capability.connector?.urlEnv]);
  }
  return findAdapter(capability).configured(capability.connector);
}

export function validateAdapterInput(capability, input) {
  if (capability.connector?.type !== 'local-adapter') return [];
  return findAdapter(capability).validate(input);
}

export async function executeAdapter(capability, context) {
  const adapter = findAdapter(capability);
  return adapter.execute({ ...context, capability });
}
