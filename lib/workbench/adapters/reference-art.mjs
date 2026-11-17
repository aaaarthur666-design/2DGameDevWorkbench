import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { bearerHeaders, endpointUrl, requestJson } from './http.mjs';

const ID = /^[a-z0-9][a-z0-9_-]{0,199}$/i;
const PROP_PREFIX = 'A single inanimate 2D pixel-art game prop, side view, isolated on a transparent background, complete silhouette inside the canvas, no characters, no scene, no text. Object description: ';

export function validateReferenceArtInput(input) {
  const errors = [];
  const op = input.operation;
  const local = ['import', 'convert-prop'].includes(op);
  if (local) {
    const fields = ['sourceImagePath', 'sourceImage', ...(op === 'convert-prop' ? ['sourceTaskId'] : [])];
    if (fields.filter(key => typeof input[key] === 'string' && Boolean(input[key].trim())).length !== 1)
      errors.push(`${op} requires exactly one sourceImagePath, sourceImage${op === 'convert-prop' ? ' or sourceTaskId' : ''}.`);
    if (input.seed !== undefined) errors.push(`${op} does not use a generation seed.`);
    if ((input.subject === 'prop' || op === 'convert-prop') && input.facing !== undefined)
      errors.push('物品导入与转换不接受 facing。');
  } else if (input.sourceImagePath !== undefined || input.sourceImage !== undefined)
    errors.push('sourceImagePath/sourceImage are only valid for import or convert-prop.');
  if (op !== 'transfer' && (input.identityDescription !== undefined || input.confirmation !== undefined))
    errors.push('identityDescription/confirmation are only valid for transfer.');
  if (op !== 'convert-prop' && input.recipe !== undefined) errors.push('recipe is only valid for convert-prop.');
  if ((input.subject === 'prop' || op === 'convert-prop') && input.size !== undefined && input.size !== 128)
    errors.push('物品原图尺寸保持 128×128。');
  if (op === 'convert-prop' && input.subject !== undefined && input.subject !== 'prop')
    errors.push('convert-prop only accepts subject=prop.');
  if ((input.subject === 'prop' || op === 'convert-prop') && typeof input.prompt === 'string' && input.prompt.length > 1800)
    errors.push('物品描述最多 1800 字符。');
  if (['generate', 'import', 'convert-prop'].includes(op) && (typeof input.prompt !== 'string' || !input.prompt.trim()))
    errors.push('prompt is required for generate/import/convert-prop.');
  if (op === 'transfer' && (typeof input.sourceTaskId !== 'string' || !ID.test(input.sourceTaskId)))
    errors.push('sourceTaskId is required for transfer.');
  if (!['transfer', 'convert-prop'].includes(op) && input.sourceTaskId !== undefined)
    errors.push('sourceTaskId is only valid for transfer or convert-prop.');
  if (op === 'transfer' && ['prompt', 'facing', 'seed', 'name', 'subject', 'size'].some(key => input[key] !== undefined))
    errors.push('transfer uses the saved source task fields.');
  if (input.confirmation && (typeof input.confirmation.note !== 'string' || input.confirmation.note.trim().length < 4))
    errors.push('确认说明至少 4 字。');
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
  const { capability, input, task } = context;
  if (input.operation === 'transfer') return transferReference(context);
  if (input.operation === 'import') return importReference(context);
  if (input.operation === 'convert-prop') return convertPropReference(context);
  if (input.operation !== 'generate') throw new Error('Unsupported reference-art operation.');
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
  let result;
  try { result = await referenceServiceRequest(capability.connector, '/jobs', {
    method: 'POST',
    body: JSON.stringify({
      prompt: input.subject === 'prop' ? PROP_PREFIX + input.prompt.trim() : input.prompt.trim(),
      facing: input.facing ?? 'right',
      size: input.size ?? 128,
      requestKey: task.id,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    }),
  }); } catch (error) {
    const details = error.body?.error?.details;
    if (details?.submission_created === false && !details.submission_unknown)
      return {status: 'not_submitted', error: error.body.error.message, adapter: {submissionState: 'not_submitted'}, result: {
        submission: {status: 'not_submitted', provider: 'pixellab', message: error.body.error.message, evidence: details}}};
    // The Python gateway derives this ID before any POST, so the original
    // request can be inspected after a lost response without creating another.
    return {status: 'attention_required', adapter: {referenceJobId: 'ref_' + createHash('sha256').update(task.id).digest('hex').slice(0,32), submissionState: 'unknown'},
      error: error.message, result: {submission: {status: 'unknown', provider: 'pixellab', message: error.message}}};
  }
  if (
    typeof result.jobId !== 'string' ||
    !ID.test(result.jobId) ||
    !['running', 'queued', 'not_submitted', 'attention_required'].includes(result.status)
  )
    throw new Error('原图服务未返回有效任务 ID，未自动重试。');
  return referenceProgress(input, result, { referenceJobId: result.jobId, lastPolledAt: Date.now(), ...(input.subject === 'prop' ? { effectivePrompt: PROP_PREFIX + input.prompt.trim() } : {}) });
}

function referenceProgress(input, response, adapter) {
  const state = response.submissionState || (response.status === 'queued' ? 'queued' : 'submitted');
  return {status: ['running', 'queued'].includes(response.status) ? 'running' : response.status,
    adapter: {...adapter, submissionState: state, ...(response.queuePosition ? {queuePosition: response.queuePosition} : {})},
    ...(['attention_required', 'not_submitted'].includes(response.status) ? {error: response.message || '请求尚未提交，请核对原请求。'} : {}),
    result: {model: 'pixflux', width: input.size ?? 128, height: input.size ?? 128,
      submission: {status: state, provider: 'pixellab', ...(response.remoteJobId ? {providerJobId: response.remoteJobId} : {}),
        ...(response.queuePosition ? {queuePosition: response.queuePosition} : {}), ...(response.balance ? {balance: response.balance} : {}),
        ...(response.message ? {message: response.message} : {}), ...(response.error ? {evidence: response.error} : {})}}};
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
  if (['running', 'queued', 'not_submitted', 'attention_required'].includes(result.status))
    return referenceProgress(task.input, result, adapter);
  if (result.status === 'failed')
    return {
      status: 'failed',
      adapter,
      error: typeof result.error === 'string' ? result.error : result.message || result.error?.message || '原图生成失败。',
    };
  if (
    result.status !== 'completed' ||
    typeof result.image !== 'string' ||
    result.image.length > 2_000_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(result.image)
  )
    throw new Error('原图服务返回了无效图片。');
  const buffer = Buffer.from(result.image, 'base64');
  await validateImage(buffer, task.input.size ?? 128);
  await writeFile(path.join(outputDirectory, 'reference.png'), buffer);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const orientationReview = task.input.subject === 'prop' ? undefined : result.orientationReview || {
    state: 'unavailable', matches: false, sourceSha256: sha256, expectedView: 'side', expectedFacing: task.input.facing || 'right',
    message: '此原图没有可用的视角检查结论，移送前请人工核对。',
  };
  const checking = orientationReview?.state === 'checking';
  return {
    status: checking ? 'running' : 'completed',
    adapter: {...adapter, submissionState: 'submitted', referenceSha256: sha256, ...(orientationReview ? {orientationReview} : {})},
    generatedOutputNames: ['reference.png'],
    result: {
      model: 'pixflux',
      width: task.input.size ?? 128,
      height: task.input.size ?? 128,
      sha256,
      ...(orientationReview ? {orientationReview} : {}),
      subject: task.input.subject || 'character',
    },
  };
}

async function validateImage(buffer, size = 128) {
  const metadata = await sharp(buffer, {
    limitInputPixels: 128 * 128,
  }).metadata();
  if (
    metadata.format !== 'png' ||
    metadata.width !== size ||
    metadata.height !== size ||
    !metadata.hasAlpha
  )
    throw new Error(`原图必须是带透明背景的 ${size}×${size} PNG。`);
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let visible = false;
  let transparent = false;
  let semiTransparentPixels = 0, visiblePixels = 0;
  const colors = new Set();
  for (let offset = 3; offset < data.length; offset += info.channels) {
    visible ||= data[offset] > 0;
    transparent ||= data[offset] < 255;
    if (data[offset] > 0) { visiblePixels++; colors.add(`${data[offset-3]},${data[offset-2]},${data[offset-1]}`); }
    if (data[offset] > 0 && data[offset] < 255) semiTransparentPixels++;
  }
  if (!visible || !transparent) throw new Error('原图为空或缺少透明背景。');
  return { semiTransparentPixels, semiTransparentRatio: semiTransparentPixels / visiblePixels, colors: colors.size };
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
    !['generate','import','convert-prop'].includes(source.input.operation)
  )
    throw new Error('请选择已经完成的角色原图或物品原图任务。');
  if (source.input.subject === 'prop' || source.input.operation === 'convert-prop') {
    if ((source.input.size ?? 128) !== 128) throw new Error('物品动画移送需要 128 像素物品原图。');
    if (source.input.operation !== 'generate' && (!input.confirmation?.note || input.confirmation.note.trim().length < 4))
      throw new Error('请填写至少 4 字的确认说明，核对视角、初始状态、部件完整和透明背景。');
    const handoff = await referenceServiceRequest(capability.connector, '/transfer-prop', {
      method: 'POST',
      body: JSON.stringify({sourceTaskId: source.id, identityDescription: input.identityDescription?.trim(), ...(input.confirmation ? { confirmation: { note: input.confirmation.note.trim() } } : {})}),
    });
    const expected = 'reference_' + createHash('sha256').update(source.id).digest('hex').slice(0, 24);
    if (handoff.objectId !== expected || handoff.objectType !== 'interactable') throw new Error('物品移送响应无效。');
    // Interactable objects open in the state-graph panel; the data stays a sprite-generator work.
    const panel = [...manifest.capabilities, ...(manifest.editorModules || [])].find(entry => entry.id === 'interactable-motion')
      || manifest.capabilities.find(entry => entry.id === 'sprite-generator');
    return {status: 'completed', adapter: {propObjectId: expected}, result: {objectId: expected, objectType: 'interactable',
      sourceTaskId: source.id, href: panel.ui.route + '?object=' + encodeURIComponent(expected)}};
  }
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
  await validateImage(image, source.input.size ?? 128);
  const saved = JSON.parse(
    await readFile(
      await inside(sourceRoot, path.join(sourceRoot, 'result.json')),
      'utf8',
    ),
  );
  if (saved.sha256 !== createHash('sha256').update(image).digest('hex'))
    throw new Error('原图文件已变化，请使用原始生成产物。');
  if (source.input.operation === 'generate') {
    const review = saved.orientationReview;
    const observation = review?.observation;
    const matched = review?.state === 'checked' && review.matches === true && observation?.view === 'side' &&
      observation.facing === (source.input.facing || 'right') && observation.confidence === 'confident' && review.sourceSha256 === saved.sha256;
    if (!matched && (input.confirmation?.sha256 !== saved.sha256 || !input.confirmation?.note?.trim()))
      throw new Error(`原图视角与朝向需要人工核对：${review?.message || '没有可用的自动检查结论'} 请查看 reference.png 后附 confirmation.note 与此图 sha256，再移送。`);
  }
  const characterId = `reference_${createHash('sha256').update(source.id).digest('hex').slice(0, 24)}`;
  const result = await referenceServiceRequest(
    capability.connector,
    '/import',
    {
      method: 'POST',
      body: JSON.stringify({
        characterId,
        image: image.toString('base64'),
        size: source.input.size ?? 128,
        reuseIdentity: !input.identityDescription?.trim(),
        prompt: input.identityDescription?.trim() || (source.input.prompt.trim().length <= 300 ? source.input.prompt.trim() : 'Preserve the exact identity, outfit, proportions, equipment, silhouette, and colors from the approved reference image.'),
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
      ...(input.confirmation ? {confirmation: input.confirmation} : {}),
      href: `${sprite.ui.route}?character=${encodeURIComponent(characterId)}`,
    },
  };
}

async function importReference({input, repositoryRoot, outputDirectory}) {
  let bytes, sourcePath;
  if (input.sourceImage !== undefined) {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.sourceImage);
    if (!match || match[1].length % 4 || match[1].length > 2_666_668) throw new Error('导入原图必须是 2 MB 以内的 PNG 文件。');
    bytes = Buffer.from(match[1], 'base64');
    if (bytes.toString('base64') !== match[1]) throw new Error('导入原图的 PNG 编码无效。');
  } else {
    sourcePath = await inside(repositoryRoot, path.resolve(repositoryRoot, input.sourceImagePath));
    const info = await stat(sourcePath);
    if (!info.isFile() || info.size > 2_000_000) throw new Error('导入原图必须是 2 MB 以内的 PNG 文件。');
    bytes = await readFile(sourcePath);
  }
  if (bytes.length > 2_000_000) throw new Error('导入原图超过 2 MB。');
  const diagnostics = await validateImage(bytes, input.size ?? 128);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(outputDirectory, 'reference.png'), bytes);
  return {status:'completed', generatedOutputNames:['reference.png'],
    result:{model:null, width:input.size ?? 128, height:input.size ?? 128, sha256, subject:input.subject || 'character',
      provenance:{type:'import', generatedHere:false, providerCalled:false,
        ...(sourcePath ? { sourcePath:path.relative(repositoryRoot,sourcePath).replaceAll('\\','/') } : { sourceType:'browser-image' }), sourceSha256:sha256,
        diagnostics, promptOrigin:'description-added-on-import'}}};
}

export async function previewPropConversion(connector, input) {
  const allowed = ['sourceTaskId', 'sourceImagePath', 'sourceImage', 'recipe'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k)))
    throw new Error('预览只接受源图片与 recipe。');
  return referenceServiceRequest(connector, '/convert-prop/preview', { method: 'POST', body: JSON.stringify(input) });
}

async function convertPropReference({capability, input, outputDirectory}) {
  const fields = Object.fromEntries(['sourceTaskId', 'sourceImagePath', 'sourceImage', 'recipe'].filter(k => input[k] !== undefined).map(k => [k, input[k]]));
  const converted = await referenceServiceRequest(capability.connector, '/convert-prop', {method: 'POST', body: JSON.stringify(fields)});
  if (typeof converted.image !== 'string' || typeof converted.compare !== 'string' || converted.image.length > 2_666_668 || converted.compare.length > 8_000_000)
    throw new Error('转换服务返回无效图片。');
  const png = Buffer.from(converted.image, 'base64');
  const diagnostics = await validateImage(png, 128);
  const sha256 = createHash('sha256').update(png).digest('hex');
  if (sha256 !== converted.report?.sha256 || converted.provenance?.type !== 'convert-prop' || converted.provenance.providerCalled !== false)
    throw new Error('转换服务的来源与输出哈希不一致。');
  for (const [filename, bytes] of [['reference.png', png], ['compare.png', Buffer.from(converted.compare, 'base64')],
    ['recipe.json', JSON.stringify(converted.report.recipe, null, 2) + '\n'], ['report.json', JSON.stringify(converted.report, null, 2) + '\n']])
    await writeFile(path.join(outputDirectory, filename), bytes);
  return {status: 'completed', generatedOutputNames: ['reference.png', 'compare.png', 'recipe.json', 'report.json'],
    result: {subject: 'prop', model: null, width: 128, height: 128, sha256, provenance: converted.provenance, diagnostics}};
}
