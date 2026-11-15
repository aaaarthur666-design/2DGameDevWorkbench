import { requestJson, requestBinary } from './http.mjs';
import { mapAspectMatches } from './map-generation-size.mjs';

// TokenHub Hy Image 3.0: sides 512–2048, area <= 1024². Keep the template aspect.
export function planHunyuanMapSize(width, height) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error('混元扩图模板尺寸无效。');
  const candidates = [];
  for (let w = 512; w <= 2048; w += 16) {
    const ideal = (w * height) / width;
    for (const h of new Set([
      Math.floor(ideal / 16) * 16,
      Math.ceil(ideal / 16) * 16,
    ])) {
      if (
        h < 512 ||
        h > 2048 ||
        w * h > 1024 * 1024 ||
        !mapAspectMatches(width, height, w, h)
      )
        continue;
      candidates.push({ width: w, height: h, exact: w * height === h * width });
    }
  }
  candidates.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      b.width * b.height - a.width * a.height,
  );
  const best = candidates[0];
  if (!best)
    throw new Error(
      `模板 ${width}×${height} 无法匹配混元画幅限制（单边 512–2048，总面积不超过 1024²）；请调整地图画幅。尚未调用图片 API。`,
    );
  return {
    width: best.width,
    height: best.height,
    size: `${best.width}x${best.height}`,
  };
}

export async function generateWithHunyuan(provider, prompt, output, source) {
  if (!prompt.trim() || prompt.length > 8192)
    throw new Error(
      '混元完整提示词最多 8192 字符，请缩短提示词后重试。尚未调用图片 API。',
    );
  if (
    source &&
    !['image/png', 'image/jpeg', 'image/jpg'].includes(source.mimeType)
  )
    throw new Error('混元参考图只支持 PNG 或 JPEG。');
  if (source && source.buffer.length > 10 * 1024 * 1024)
    throw new Error(
      '混元参考图不能超过 10 MB；请先缩小或压缩地图模板。尚未调用图片 API。',
    );
  let result;
  try {
    result = await requestJson(provider.endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        prompt,
        size: output.size,
        revise: false,
        ...(source ? { images: [source.buffer.toString('base64')] } : {}),
      }),
      timeoutMs: 300000,
    });
  } catch (error) {
    const reasons = {
      401: '请检查 TokenHub 在线推理 API Key。',
      403: '请检查密钥的模型权限和混元生图服务是否已开通。',
      429: '额度或请求频率受限，请检查 TokenHub 用量后再试。',
    };
    // Never persist echoed credentials, upstream response bodies or signed URLs.
    throw new Error(
      `混元图片请求失败${error.status ? `（HTTP ${error.status}）` : '或超时'}。${reasons[error.status] || '请检查 TokenHub 控制台的调用记录。'}未自动重试。`,
    );
  }
  if (typeof result?.data?.[0]?.url !== 'string')
    throw new Error('混元没有返回可用图片地址；请检查 TokenHub 调用记录。');
  const imageUrl = validateHunyuanImageUrl(result.data[0].url, provider);
  try {
    // The image URL is temporary. Save bytes locally; never send the API key to the CDN.
    const downloaded = await requestBinary(imageUrl, {
      redirect: 'error',
      timeoutMs: 60000,
      maxBytes: 32 * 1024 * 1024,
    });
    return downloaded.buffer;
  } catch {
    throw new Error(
      '混元已返回图片，但下载到本机失败。请先在 TokenHub 调用记录中检查结果，避免重复生成扣费。',
    );
  }
}

export function validateHunyuanImageUrl(value, provider) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('混元返回的图片地址无效。');
  }
  const endpoint = new URL(provider.endpoint);
  const localTest =
    ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) &&
    url.origin === endpoint.origin;
  const trusted =
    url.protocol === 'https:' &&
    (provider.artifactHostSuffixes || []).some((suffix) =>
      url.hostname.endsWith(suffix),
    );
  if (url.username || url.password || (!localTest && !trusted))
    throw new Error('混元返回了不受支持的图片下载地址。');
  return url.toString();
}
