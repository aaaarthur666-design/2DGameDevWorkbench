import { upgradeLegacyOverallPrompt } from './frame-ronin-types';

export const ADDITIONAL_PROMPT_LIMIT = 2000;
export interface GenerationRequest {
  readonly provider: string;
  readonly prompt: string;
}
export interface GenerationSettings {
  active: boolean;
  provider: string | null;
  providers: Array<{ id: string; configured: boolean }>;
}

/** Preserve authored whitespace in drafts; trim only when composing a request. */
export function readAdditionalPrompt(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > ADDITIONAL_PROMPT_LIMIT)
    throw new Error(
      `额外提示词必须是最多 ${ADDITIONAL_PROMPT_LIMIT} 字的文本。`,
    );
  return value;
}

export function composeGenerationPrompt(base: string, extra: unknown = '') {
  const prompt = upgradeLegacyOverallPrompt(base);
  const addition = readAdditionalPrompt(extra).trim();
  return addition
    ? `${prompt.trim()}\n\nAdditional requirements for this tile (subject to the reference style, view, seam continuity and pixel-preservation constraints above):\n${addition}`
    : prompt;
}

export function generationUnavailableReason(
  settings: GenerationSettings,
  provider = settings.provider,
): string | null {
  if (!settings.active) return '图片 API 未启用，请先打开 API 设置。';
  if (
    !provider ||
    !settings.providers.some((p) => p.id === provider && p.configured)
  )
    return '图片 API 尚未配置，请先设置服务商和密钥。';
  return null;
}

export function captureGenerationRequest(
  settings: GenerationSettings,
  base: string,
  extra: unknown = '',
): GenerationRequest {
  const reason = generationUnavailableReason(settings);
  if (reason) throw new Error(reason);
  if (!base.trim()) throw new Error('请填写整体层基础提示词。');
  return Object.freeze({
    provider: settings.provider!,
    prompt: composeGenerationPrompt(base, extra),
  });
}

/** Old queues have no request snapshot: require a deliberate fresh enqueue. */
export function readGenerationRequest(
  value: unknown,
): GenerationRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const request = value as Record<string, unknown>;
  if (
    typeof request.provider !== 'string' ||
    !request.provider.trim() ||
    typeof request.prompt !== 'string' ||
    !request.prompt.trim()
  )
    return undefined;
  return Object.freeze({ provider: request.provider, prompt: request.prompt });
}
