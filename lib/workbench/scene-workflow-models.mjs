import { readImageSettings, writeImageSettings } from './image-settings-store.mjs';
import { validateImageApiKey } from './image-generation-settings.mjs';
import { modelSettingsSchema, SCENE_ROLES } from './scene-workflow-contract.mjs';
import { workflowError } from './scene-workflow-store.mjs';
import { visionModelProviders, visionModelEndpoint, visionModelCredential } from './vision-models.mjs';

// Compatibility exports for scene collaboration while image tools use the
// independent vision transport directly.
export { imageExpertSettings, strictModelSchema, sendVisionExpert as sendSceneExpert } from './vision-models.mjs';

export function sceneModelSettings(manifest, input = {}) {
  const saved = readImageSettings();
  const registry = visionModelProviders(manifest);
  const configuration = input.configuration
    ? modelSettingsSchema.parse(input.configuration)
    : saved.sceneExperts
      ? modelSettingsSchema.parse(saved.sceneExperts)
      : null;
  if (input.keys && !configuration)
    throw workflowError('请先填写默认专家模型。');
  for (const [id, value] of Object.entries(input.keys || {})) {
    if (!value?.trim()) continue;
    const provider = registry.find((p) => p.id === id);
    if (!provider) throw workflowError('专家服务无效。');
    if (process.env[provider.keyEnv]?.trim())
      throw workflowError('此服务 Key 由启动环境管理。');
    validateImageApiKey(value.trim());
    saved.keys[`scene-experts:${id}`] = value.trim();
  }
  registry.forEach(visionModelEndpoint);
  if (input.configuration || input.keys) {
    saved.sceneExperts = configuration;
    writeImageSettings(saved);
  }
  const services = registry.map((provider) => ({
    id: provider.id,
    name: provider.name,
    endpoint: visionModelEndpoint(provider),
    configured: Boolean(visionModelCredential(provider, saved)),
  }));
  return {
    configuration,
    services,
    configured: Boolean(
      configuration &&
      Object.keys(SCENE_ROLES).every(
        (role) =>
          services.find(
            (p) =>
              p.id ===
              (configuration.roles[role] || configuration.default).provider,
          )?.configured,
      ),
    ),
  };
}
export function sceneModelSnapshot(manifest) {
  const settings = sceneModelSettings(manifest);
  if (!settings.configured)
    throw workflowError(
      '请在场景协作设置中配置支持图片和结构化输出的专家模型与 Key。尚未调用模型。',
      'SCENE_MODELS_UNCONFIGURED',
      409,
    );
  return {
    configuration: settings.configuration,
    providers: visionModelProviders(manifest).map((p) => ({
      id: p.id,
      endpoint: visionModelEndpoint(p),
    })),
  };
}
