import * as z from 'zod/v4';

const profile = z.object({
  provider: z.enum(['tokenhub', 'openai']),
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/),
  max_output_tokens: z.number().int().min(1024).max(32768).optional(),
  timeout_seconds: z.number().int().min(30).max(600).optional(),
  token_parameter: z.enum(['auto', 'max_tokens', 'max_completion_tokens']).optional(),
  reasoning_effort: z.enum(['auto', 'low', 'medium', 'high', 'max']).optional(),
  supports_images: z.literal(true).optional(),
}).strict();

export const motionModelInputs = {
  'motion-models': z.object({}).strict(),
  'set-motion-model': z.object({
    role: z.enum(['appearance', 'motion', 'strategy', 'coordinator', 'reviewer', 'structure']),
    profile: profile.nullable().describe('Complete model profile for this role; null removes its override and uses the default.'),
    expectedConfigurationSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
};

export const motionModelTools = [
  ['workbench_get_motion_models', 'motion-models', 'Read public model profiles by role and configuration_sha256. No keys, task creation or model calls. Existing works keep frozen settings.'],
  ['workbench_set_motion_model', 'set-motion-model', 'Change one model role for future works using the configuration_sha256 returned by get_motion_models. Other roles and existing works remain unchanged. No credentials or generation.'],
];
