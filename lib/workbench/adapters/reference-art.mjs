import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { bearerHeaders, endpointUrl, requestJson } from './http.mjs';

const ID = /^[a-z0-9][a-z0-9_-]{0,199}$/i;

export function validateReferenceArtInput(input) {
  const errors = [];
  if (
    input.operation === 'generate' &&
    (typeof input.prompt !== 'string' || !input.prompt.trim())
  )
    errors.push('prompt is required for generate.');
  if (
    input.operation === 'transfer' &&
    (typeof input.sourceTaskId !== 'string' || !ID.test(input.sourceTaskId))
  )
    errors.push('sourceTaskId is required for transfer.');
  if (input.operation === 'generate' && input.sourceTaskId !== undefined)
    errors.push('sourceTaskId is only valid for transfer.');
  if (
    input.operation === 'transfer' &&
    ['prompt', 'facing', 'seed', 'name'].some((key) => input[key] !== undefined)
  )
    errors.push('transfer uses the saved source task fields.');
  return errors;
}

export async function referenceServiceRequest(connector, route, options = {}) {
  const base = process.env[connector.urlEnv]?.trim() || connector.defaultUrl;
  try {
    return await requestJson(endpointUrl(base, `/v1/reference-art${route}`), {
      ...options,
      headers: bearerHeaders(process.env[connector.tokenEnv]),
      timeoutMs: 75_000,
    });
  } catch (error) {
    if (error.status === 404)
      throw new Error('请重启或更新 SpritePipeline 服务以加载原图接口。');
    if (error.status) throw error;
    throw new Error(
      options.method === 'POST' && route === '/jobs'
        ? '原图提交结果无法确认，未自动重试。请检查 PixelLab 账户任务后再决定是否重新生成。'
        : '无法连接序列帧服务，请使用 npm run dev 启动完整工作台。',
    );
  }
}

export async function executeReferenceArt(context) {
  const { capability, input } = context;
  if (input.operation === 'transfer') return transferReference(context);
  let settings;
  try {
    settings = await referenceServiceRequest(capability.connector, '/settings');
  } catch (error) {
    return {
      status: 'awaiting_configuration',
      requiredEnvironment: 'SPRITE_PIPELINE_API_URL',
      result: { message: error.message },
    };
  }
  if (!settings.configured)
    return {
      status: 'awaiting_configuration',
      requiredEnvironment: 'PIXELLAB_API_KEY',
      result: {
        message: '请在原图或序列帧设置中保存 PixelLab API Key，两个工具共用。',
      },
    };
  const result = await referenceServiceRequest(capability.connector, '/jobs', {
    method: 'POST',
    body: JSON.stringify({
      prompt: input.prompt.trim(),
      facing: input.facing ?? 'right',
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    }),
  });
  if (
    typeof result.jobId !== 'string' ||
    !ID.test(result.jobId) ||
    result.status !== 'running'
  )
    throw new Error('原图服务未返回有效任务 ID，未自动重试。');
  return {
    status: 'running',
    adapter: { referenceJobId: result.jobId, lastPolledAt: Date.now() },
    result: { model: 'pixflux', width: 128, height: 128 },
  };
}

export async function refreshReferenceArt({
  capability,
  task,
  outputDirectory,
}) {
  const jobId = task.adapter?.referenceJobId;
  if (typeof jobId !== 'string' || !ID.test(jobId))
    throw new Error('原图任务缺少 PixelLab 任务 ID。');
  if (Date.now() - (task.adapter.lastPolledAt ?? 0) < 5000) return null;
  const result = await referenceServiceRequest(
    capability.connector,
    `/jobs/${encodeURIComponent(jobId)}`,
  );
  const adapter = { ...task.adapter, lastPolledAt: Date.now() };
  if (result.status === 'running')
    return {
      status: 'running',
      adapter,
      result: { model: 'pixflux', width: 128, height: 128 },
    };
  if (result.status === 'failed')
    return {
      status: 'failed',
      adapter,
      error: result.error || '原图生成失败。',
    };
  if (
    result.status !== 'completed' ||
    typeof result.image !== 'string' ||
    result.image.length > 2_000_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(result.image)
  )
    throw new Error('原图服务返回了无效图片。');
  const buffer = Buffer.from(result.image, 'base64');
  await validateImage(buffer);
  await writeFile(path.join(outputDirectory, 'reference.png'), buffer);
  return {
    status: 'completed',
    adapter,
    generatedOutputNames: ['reference.png'],
    result: {
      model: 'pixflux',
      width: 128,
      height: 128,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    },
  };
}

async function validateImage(buffer) {
  const metadata = await sharp(buffer, {
    limitInputPixels: 128 * 128,
  }).metadata();
  if (
    metadata.format !== 'png' ||
    metadata.width !== 128 ||
    metadata.height !== 128 ||
    !metadata.hasAlpha
  )
    throw new Error('原图必须是带透明背景的 128×128 PNG。');
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let visible = false;
  let transparent = false;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    visible ||= data[offset] > 0;
    transparent ||= data[offset] < 255;
  }
  if (!visible || !transparent) throw new Error('原图为空或缺少透明背景。');
}

async function inside(root, target) {
  const resolvedRoot = await realpath(root);
  const resolved = await realpath(target);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('原图路径超出任务目录。');
  return resolved;
}

async function transferReference({
  capability,
  input,
  manifest,
  repositoryRoot,
}) {
  const taskRoot = path.resolve(
    repositoryRoot,
    manifest.workspace.taskDirectory,
  );
  const recordPath = await inside(
    taskRoot,
    path.join(taskRoot, `${input.sourceTaskId}.json`),
  );
  const source = JSON.parse(await readFile(recordPath, 'utf8'));
  if (
    source.id !== input.sourceTaskId ||
    source.capabilityId !== capability.id ||
    source.status !== 'completed' ||
    source.input.operation !== 'generate'
  )
    throw new Error('请选择已经完成的原图生成任务。');
  const outputRoot = path.resolve(
    repositoryRoot,
    manifest.workspace.outputDirectory,
  );
  const sourceRoot = await inside(outputRoot, path.join(outputRoot, source.id));
  const imagePath = await inside(
    sourceRoot,
    path.join(sourceRoot, 'reference.png'),
  );
  const relative = path
    .relative(repositoryRoot, imagePath)
    .replaceAll('\\', '/');
  if (!source.outputs.includes(relative))
    throw new Error('任务没有登记此原图产物。');
  const image = await readFile(imagePath);
  await validateImage(image);
  const saved = JSON.parse(
    await readFile(
      await inside(sourceRoot, path.join(sourceRoot, 'result.json')),
      'utf8',
    ),
  );
  if (saved.sha256 !== createHash('sha256').update(image).digest('hex'))
    throw new Error('原图文件已变化，请使用原始生成产物。');
  const characterId = `reference_${createHash('sha256').update(source.id).digest('hex').slice(0, 24)}`;
  const result = await referenceServiceRequest(
    capability.connector,
    '/import',
    {
      method: 'POST',
      body: JSON.stringify({
        characterId,
        image: image.toString('base64'),
        prompt: source.input.prompt.trim(),
        facing: source.input.facing ?? 'right',
        name: source.input.name?.trim() || '生成的角色',
      }),
    },
  );
  if (result.characterId !== characterId) throw new Error('角色导入响应无效。');
  const sprite = manifest.capabilities.find(
    (entry) => entry.id === 'sprite-generator',
  );
  return {
    status: 'completed',
    result: {
      characterId,
      sourceTaskId: source.id,
      href: `${sprite.ui.route}?character=${encodeURIComponent(characterId)}`,
    },
  };
}
