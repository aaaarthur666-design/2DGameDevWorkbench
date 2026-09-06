import process from 'node:process';

const apiKeyOverrides = new Map();
let activeProviderOverride;
let preferredProviderOverride;

export function getPublicMapGenerationSettings(connector) {
  const providers = readProviders(connector);
  const environmentProvider = readEnvironmentProvider(connector, providers);
  const environmentProviderConfig = providers.find((provider) => provider.id === environmentProvider);
  const configuredEnvironmentProvider = environmentProviderConfig && resolveProviderApiKey(environmentProviderConfig)
    ? environmentProvider
    : null;
  const activeProvider = activeProviderOverride === undefined
    ? configuredEnvironmentProvider
    : activeProviderOverride;
  const preferredProvider = activeProvider ?? preferredProviderOverride ?? environmentProvider ?? providers[0]?.id ?? null;

  return {
    active: Boolean(activeProvider),
    provider: preferredProvider,
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      host: new URL(resolveProviderEndpoint(provider)).origin,
      model: provider.model,
      ...(provider.setupUrl ? { setupUrl: provider.setupUrl } : {}),
      ...(provider.usageNote ? { usageNote: provider.usageNote } : {}),
      configured: Boolean(resolveProviderApiKey(provider)),
    })),
  };
}

export function updateMapGenerationSettings(connector, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('API settings must be a JSON object.');
  }
  if (Object.keys(input).some((key) => !['provider', 'active', 'apiKey'].includes(key))) {
    throw new Error('API settings contain an unsupported field.');
  }
  const providers = readProviders(connector);
  const provider = providers.find((candidate) => candidate.id === input.provider);
  if (!provider) throw new Error('API provider is invalid.');

  if (input.apiKey !== undefined) {
    if (typeof input.apiKey !== 'string') throw new Error('API Key must be a string.');
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new Error('API Key cannot be empty.');
    validateMapApiKey(apiKey);
    apiKeyOverrides.set(provider.id, apiKey);
  }
  if (input.active !== undefined && typeof input.active !== 'boolean') {
    throw new Error('active must be a boolean.');
  }
  if (input.active === true && !resolveProviderApiKey(provider)) {
    throw new Error(`Configure ${provider.name} API Key before activating it.`);
  }
  preferredProviderOverride = provider.id;
  if (input.active === true) activeProviderOverride = provider.id;
  if (input.active === false) activeProviderOverride = null;

  return getPublicMapGenerationSettings(connector);
}

export function resolveMapGenerationProvider(connector, requestedProvider, operation = 'generate-layer') {
  const providers = readProviders(connector);
  const publicSettings = getPublicMapGenerationSettings(connector);
  const providerId = requestedProvider ?? (publicSettings.active ? publicSettings.provider : null);
  if (!providerId) return null;
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error('API provider is invalid.');
  return {
    ...provider,
    endpoint: resolveProviderEndpoint(provider, operation),
    apiKey: resolveProviderApiKey(provider),
  };
}

function readProviders(connector) {
  if (!Array.isArray(connector?.providers) || connector.providers.length === 0) {
    throw new Error('Map generation providers are missing from the workbench manifest.');
  }
  return connector.providers.map((provider) => {
    if (
      !provider ||
      typeof provider.id !== 'string' ||
      typeof provider.name !== 'string' ||
      typeof provider.model !== 'string' ||
      typeof provider.protocol !== 'string' ||
      typeof provider.endpoint !== 'string' ||
      typeof provider.apiKeyEnv !== 'string'
    ) {
      throw new Error('Map generation provider metadata is invalid.');
    }
    return provider;
  });
}

function readEnvironmentProvider(connector, providers) {
  if (typeof connector?.providerEnv !== 'string') return null;
  const value = process.env[connector.providerEnv]?.trim();
  const provider = providers.find((candidate) => candidate.id === value);
  return provider?.id ?? null;
}

function resolveProviderApiKey(provider) {
  return apiKeyOverrides.get(provider.id) ?? process.env[provider.apiKeyEnv]?.trim() ?? '';
}

function resolveProviderEndpoint(provider, operation = 'generate-layer') {
  const override = typeof provider.endpointEnv === 'string'
    ? process.env[provider.endpointEnv]?.trim()
    : '';
  let value = override || provider.endpoint;
  if (operation === 'generate-origin' && provider.protocol === 'openai-images-edits') {
    const generationOverride = process.env[provider.generationEndpointEnv]?.trim();
    if (generationOverride) value = generationOverride;
    else if (override) {
      const target = new URL(override);
      if (!target.pathname.endsWith('/edits')) throw new Error('自定义图片地址需要配置 MAP_STITCHER_OPENAI_GENERATION_API_URL，或使用以 /edits 结尾的地址。');
      target.pathname = target.pathname.replace(/\/edits$/, '/generations');
      value = target.toString();
    } else value = provider.generationEndpoint;
  }
  const endpoint = new URL(value);
  if (endpoint.username || endpoint.password) {
    throw new Error(`${provider.name} endpoint must not contain credentials.`);
  }
  if (endpoint.protocol !== 'https:' && !isLoopbackHttp(endpoint)) {
    throw new Error(`${provider.name} endpoint must use HTTPS.`);
  }
  return endpoint.toString();
}

function isLoopbackHttp(endpoint) {
  return endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname);
}

export function validateMapApiKey(apiKey) {
  if (apiKey.length > 4096) throw new Error('API Key is too long.');
  if (!/^[\x21-\x7e]+$/.test(apiKey)) {
    throw new Error('图片 API 密钥格式无效：请仅粘贴密钥，不要包含中文说明、空格或换行。请在生成设置中重新填写。');
  }
}
