import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/v4';
import { normalizeProject } from '../../features/interactable-editor/contract.mjs';
import { validateScene } from '../../features/scene-composer/model.mjs';
import { getDocument, saveDocument } from './editor-documents.mjs';
import { readGeneratedImage } from './document-assets.mjs';
import {
  findCapability,
  persistTask,
  refreshTask,
  repositoryRoot,
  runConnector,
  validateInput,
} from './runtime.mjs';
import {
  getPublicMapGenerationSettings,
  resolveMapGenerationProvider,
  validateMapApiKey,
} from './map-generation-settings.mjs';
import {
  inspectImageBytes,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  readImageAssetSource,
  validateImageAssetDimensions,
} from './adapters/image-assets-source.mjs';
import { hash, workflowError } from './scene-workflow-store.mjs';

const prompt = z.string().trim().min(1).max(12000);
const dimension = z.number().int().min(16).max(3840);
const dataImage = z
  .string()
  .max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
const fail = (message, code = 'INVALID_SCENE_GENERATION') => {
  throw workflowError(message, code, 409);
};
const validDimensions = (value) => {
  try {
    validateImageAssetDimensions(value.width, value.height);
    return true;
  } catch {
    return false;
  }
};
const dimensionMessage =
  '图片宽高须为 16 的倍数，总计 655360–8294400 像素，最长边不超过 3840，比例在 1:3–3:1 内。';

import { generationStepSchema } from './scene-workflow-production-contract.mjs';
export { generationStepSchema } from './scene-workflow-production-contract.mjs';

const artworkInput = z
  .object({
    operation: z.enum(['generate-prop', 'generate-background']),
    name: z.string().trim().min(1).max(80),
    prompt,
    width: dimension.default(1024),
    height: dimension.default(1024),
    references: z.array(dataImage).max(8).optional(),
  })
  .strict()
  .refine(validDimensions, dimensionMessage);
const mapInput = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('generate-origin'),
      prompt,
      aspectRatio: z.enum(['1:1', '3:2', '2:3']).default('1:1'),
    })
    .strict(),
  z
    .object({
      operation: z.literal('generate-layer'),
      prompt,
      image: dataImage,
      tile: z
        .object({
          key: z.string().min(1).max(120),
          x: z.number().optional(),
          y: z.number().optional(),
          w: z.number().positive().optional(),
          h: z.number().positive().optional(),
        })
        .strict(),
      layer: z.literal('overall'),
      mask_mode: z.enum(['black', 'white']),
    })
    .strict(),
]);
const jobRequestSchema = z.discriminatedUnion('capability', [
  z
    .object({
      purpose: z.string().min(1).max(240),
      capability: z.literal('image-assets'),
      input: artworkInput,
    })
    .strict(),
  z
    .object({
      purpose: z.string().min(1).max(240),
      capability: z.literal('map-stitcher'),
      input: mapInput,
    })
    .strict(),
]);

function providerConnector(manifest, capabilityId) {
  const capability = findCapability(manifest, capabilityId);
  const connector = capability.connector;
  if (connector.type !== 'local-adapter' || connector.adapter !== capabilityId)
    fail('场景生成只能使用已登记的本地图片适配器。');
  if (!connector.providerSource) return structuredClone(connector);
  const source = findCapability(manifest, connector.providerSource).connector;
  if (!Array.isArray(source.providers)) fail('图片生成提供方登记缺失。');
  return {
    ...connector,
    providerSource: undefined,
    providers: source.providers.filter((item) =>
      connector.providerIds?.includes(item.id),
    ),
  };
}

/** Safe UI metadata. Key values and endpoint credentials are never returned. */
export function getWorkflowGenerationSettings(manifest) {
  const result = {};
  for (const [kind, capability] of [
    ['prop', 'image-assets'],
    ['map', 'map-stitcher'],
  ]) {
    const settings = getPublicMapGenerationSettings(
      providerConnector(manifest, capability),
    );
    result[kind] = {
      provider: settings.provider,
      providers: settings.providers,
    };
  }
  return result;
}

function frozenEndpoint(value) {
  const endpoint = new URL(value);
  if (
    endpoint.username ||
    endpoint.password ||
    [...endpoint.searchParams.keys()].some((key) =>
      /key|token|secret|credential|signature|authorization|password/i.test(key),
    )
  )
    fail(
      '图片提供方地址不能内嵌认证信息；请使用现有密钥设置。',
      'SCENE_GENERATION_CONFIGURATION',
    );
  return endpoint.toString();
}

/** Freeze each production line separately; credentials remain in the key store. */
export function freezeWorkflowGeneration(manifest, requested = {}) {
  if (
    !requested ||
    typeof requested !== 'object' ||
    Array.isArray(requested) ||
    Object.keys(requested).some((key) => !['prop', 'map'].includes(key))
  )
    fail('素材生成提供方选择无效。');
  const result = { schemaVersion: 1, prop: null, map: null };
  for (const [kind, capability] of [
    ['prop', 'image-assets'],
    ['map', 'map-stitcher'],
  ]) {
    const connector = providerConnector(manifest, capability);
    const settings = getPublicMapGenerationSettings(connector);
    const selected =
      requested[kind] ?? settings.provider ?? connector.defaultProvider;
    if (!selected) continue;
    const registered = connector.providers?.find(
      (item) => item.id === selected,
    );
    if (!registered)
      fail(`未登记的${kind === 'prop' ? '物件' : '地图'}图片提供方。`);
    const edit = resolveMapGenerationProvider(
      connector,
      selected,
      'generate-layer',
    );
    const generation = resolveMapGenerationProvider(
      connector,
      selected,
      kind === 'prop' ? 'generate-prop' : 'generate-origin',
    );
    if (kind === 'prop' && edit.protocol !== 'openai-images-edits')
      fail('物件素材需要支持透明图片生成的现有图片适配器。');
    result[kind] = {
      capability,
      provider: registered.id,
      name: registered.name,
      model: registered.model,
      protocol: registered.protocol,
      endpoint: frozenEndpoint(edit.endpoint),
      generationEndpoint: frozenEndpoint(generation.endpoint),
      apiKeyEnv: registered.apiKeyEnv,
      ...(registered.credentialAliases
        ? { credentialAliases: [...registered.credentialAliases] }
        : {}),
      ...(registered.artifactHostSuffixes
        ? { artifactHostSuffixes: [...registered.artifactHostSuffixes] }
        : {}),
      configuredAtCreation:
        settings.providers.find((item) => item.id === selected)?.configured ===
        true,
    };
  }
  return result;
}

function frozenCapability(store, work, capabilityId) {
  const kind = capabilityId === 'map-stitcher' ? 'map' : 'prop';
  const profile = work.generationConfiguration?.[kind];
  const registered = providerConnector(store.manifest, capabilityId).providers;
  if (
    !profile ||
    profile.capability !== capabilityId ||
    !registered?.some((item) => item.id === profile.provider)
  )
    fail(
      '此制作步骤没有已冻结的注册图片提供方。',
      'SCENE_GENERATION_CONFIGURATION',
    );
  const provider = {
    id: profile.provider,
    name: profile.name,
    model: profile.model,
    protocol: profile.protocol,
    endpoint: profile.endpoint,
    generationEndpoint: profile.generationEndpoint,
    apiKeyEnv: profile.apiKeyEnv,
    ...(profile.credentialAliases
      ? { credentialAliases: profile.credentialAliases }
      : {}),
    ...(profile.artifactHostSuffixes
      ? { artifactHostSuffixes: profile.artifactHostSuffixes }
      : {}),
  };
  // No endpointEnv/generationEndpointEnv survives: a later settings change may
  // supply a key, but cannot redirect a saved task or change its frozen model.
  const capability = {
    ...findCapability(store.manifest, capabilityId),
    connector: {
      type: 'local-adapter',
      adapter: capabilityId,
      providers: [provider],
      defaultProvider: provider.id,
    },
  };
  return { profile, capability };
}

function appendGeneratedMaterial(scene, input, image) {
  if (scene.materials.some((material) => material.id === input.materialId))
    fail('生成素材必须使用新的 materialId。');
  const assetId = image ? `image_${hash(image.taskId).slice(0, 32)}` : '';
  const project = normalizeProject({
    schemaVersion: 1,
    projectId: input.materialId,
    name: input.name,
    assets: image
      ? [
          {
            id: assetId,
            name: `${input.name}.png`,
            mime: 'image/png',
            source: `data:image/png;base64,${image.bytes.toString('base64')}`,
            generation: { sourceTaskId: image.taskId, sha256: image.sha256 },
          },
        ]
      : [],
    objects: [
      {
        definitionId: input.definitionId,
        displayName: input.name,
        visual: {
          assetId,
          width: input.visualWidth,
          height: input.visualHeight,
        },
      },
    ],
  });
  const next = structuredClone(scene);
  next.materials.push({ id: input.materialId, name: input.name, project });
  return validateScene(next);
}

/** The dry run contains structural metadata only, never placeholder image art. */
export function validateGenerationStep(scene, rawInput, context = {}) {
  const input = generationStepSchema.parse(rawInput);
  if (
    context.work &&
    (!context.work.generationConfiguration?.prop ||
      (context.work.spec.budget.generationCalls ?? 0) < 1)
  )
    fail(
      '新素材生成没有已冻结的提供方或授权额度。',
      'SCENE_GENERATION_CONFIGURATION',
    );
  return appendGeneratedMaterial(scene, input, null);
}

const inside = (base, target) => {
  const relative = path.relative(base, target);
  return (
    !!relative &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  );
};
async function confinedRead(root, base, filename, maximum) {
  const actualRoot = await realpath(root);
  const actualBase = await realpath(base);
  const actual = await realpath(filename);
  if (!inside(actualRoot, actualBase) || !inside(actualBase, actual))
    fail('生成产物路径超出任务输出目录。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
  const info = await stat(actual);
  if (!info.isFile() || info.size > maximum)
    fail('生成产物过大或不是普通文件。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
  return readFile(actual);
}
const relativePath = (root, filename) =>
  path.relative(root, filename).split(path.sep).join('/');

async function readProductionUnchecked(store, manifest, task, job) {
  const outputs = path.resolve(store.root, manifest.workspace.outputDirectory);
  const directory = path.join(outputs, task.id);
  if (!inside(await realpath(outputs), await realpath(directory)))
    fail('原图片任务输出目录越界。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
  const readOutput = async (name, maximum = MAX_TOTAL_IMAGE_BYTES) => {
    const filename = path.join(directory, name);
    if (!task.outputs?.includes(relativePath(store.root, filename)))
      fail('原图片任务缺少登记产物。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
    return confinedRead(store.root, directory, filename, maximum);
  };
  const result = JSON.parse(await readOutput('result.json', 1024 * 1024));
  let bytes, info, imageName, kind;
  if (task.capabilityId === 'image-assets') {
    const image = await readGeneratedImage(
      store.root,
      manifest,
      task.id,
      result.sha256,
    );
    bytes = image.bytes;
    info = await inspectImageBytes(bytes, {
      pngOnly: true,
      transparency: image.kind === 'prop',
    });
    imageName = 'image.png';
    kind = image.kind;
    if (
      kind !==
      (task.input.operation === 'generate-prop' ? 'prop' : 'background')
    )
      fail('原图片素材类型已变化。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
  } else {
    imageName =
      task.input.operation === 'generate-origin'
        ? 'generated-origin.png'
        : 'generated-layer.png';
    const resultKey =
      task.input.operation === 'generate-origin'
        ? 'generatedOrigin'
        : 'generatedLayer';
    if (result[resultKey] !== imageName)
      fail('原地图生成产物登记已变化。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
    bytes = await readOutput(imageName, MAX_IMAGE_BYTES);
    info = await inspectImageBytes(bytes, { pngOnly: true });
    kind = 'background';
    if (
      task.input.operation === 'generate-origin' &&
      (result.width !== info.width || result.height !== info.height)
    )
      fail('原地图图片尺寸证据不符。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
  }
  if (!info.hasVisiblePixels)
    fail('生成图片没有可见像素。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
  const artifacts = [];
  for (const artifactPath of task.outputs ?? []) {
    const filename = path.resolve(store.root, artifactPath);
    if (!inside(directory, filename))
      fail('原图片任务包含越界产物。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
    const content = await confinedRead(
      store.root,
      directory,
      filename,
      MAX_TOTAL_IMAGE_BYTES,
    );
    artifacts.push({
      artifactPath,
      sha256: hash(content),
      bytes: content.length,
    });
  }
  const usageArtifact = artifacts.find((item) =>
    item.artifactPath.endsWith('/provider-usage.json'),
  );
  const evidence = {
    schemaVersion: 1,
    requestId: job.requestId,
    requestHash: job.requestHash,
    profileHash: job.profileHash,
    taskId: task.id,
    capability: task.capabilityId,
    operation: task.input.operation,
    provider: task.adapter?.provider,
    model: task.adapter?.model,
    image: {
      artifactPath: relativePath(store.root, path.join(directory, imageName)),
      sha256: info.sha256,
      width: info.width,
      height: info.height,
      kind,
    },
    artifacts,
    ...(usageArtifact
      ? {
          usage: JSON.parse(
            await readOutput('provider-usage.json', 1024 * 1024),
          ),
          usageArtifact,
        }
      : {}),
  };
  return {
    image: {
      taskId: task.id,
      bytes,
      kind,
      width: info.width,
      height: info.height,
      sha256: info.sha256,
      artifactPath: evidence.image.artifactPath,
      path: evidence.image.artifactPath,
      generation: { sourceTaskId: task.id, sha256: info.sha256 },
    },
    evidence,
  };
}

async function readProduction(store, manifest, task, job) {
  try {
    return await readProductionUnchecked(store, manifest, task, job);
  } catch (error) {
    if (error?.code === 'SCENE_GENERATION_EVIDENCE_CHANGED') throw error;
    fail(
      '原生成图片或来源记录无法核验，请检查保留的任务产物。',
      'SCENE_GENERATION_EVIDENCE_CHANGED',
    );
  }
}

async function recoverPreparedTask(store, manifest, job) {
  const base = path.resolve(store.root, manifest.workspace.taskDirectory);
  const candidates = [];
  for (const name of await readdir(base).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })) {
    if (!/^[A-Za-z0-9_-]+\.json$/.test(name)) continue;
    const task = JSON.parse(
      await confinedRead(
        store.root,
        base,
        path.join(base, name),
        128 * 1024 * 1024,
      ),
    );
    const marker = task.sceneWorkflowGeneration;
    if (marker?.requestId === job.requestId) {
      if (
        marker.requestHash !== job.requestHash ||
        marker.profileHash !== job.profileHash
      )
        fail('原图片任务的请求身份不符。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
      candidates.push(task);
    }
  }
  if (candidates.length > 1)
    fail(
      '原生成请求对应多个任务，需要检查已有记录。',
      'SCENE_GENERATION_OUTCOME_UNKNOWN',
    );
  return candidates[0] ?? null;
}

/** Recheck immutable production evidence at review/adoption without submitting. */
export async function verifyWorkflowGenerationEvidence(store, work) {
  const manifest = store.candidateManifest(work);
  const calls = [],
    pending = [];
  const seen = new Set();
  for (const call of work.generationCalls ?? []) {
    if (
      !/^wfgen-[a-f0-9]{48}$/.test(call.requestId) ||
      seen.has(call.requestId)
    )
      fail('生成调用身份无效或重复。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
    seen.add(call.requestId);
    const requestFile = path.join(
      store.directory(work.id),
      `generation-request-${call.requestId}.json`,
    );
    const saved = await store.read(requestFile);
    const { profile, capability } = frozenCapability(
      store,
      work,
      call.capability,
    );
    const profileHash = hash(profile);
    if (
      saved.requestId !== call.requestId ||
      saved.requestHash !== call.requestHash ||
      saved.profileHash !== profileHash ||
      call.profileHash !== profileHash ||
      hash(saved.profile) !== profileHash ||
      hash({ ...saved.request, profileHash }) !== saved.requestHash ||
      saved.request.capability !== call.capability ||
      saved.request.input.provider !== profile.provider ||
      call.provider !== profile.provider ||
      call.model !== profile.model
    )
      fail(
        '生成请求、模型快照或额度证据不符。',
        'SCENE_GENERATION_EVIDENCE_CHANGED',
      );
    if (call.status !== 'completed') {
      pending.push({
        requestId: call.requestId,
        taskId: call.taskId,
        status: call.status,
        submitted: Boolean(call.submitted),
        submissionState: call.submissionState,
        unresolved: !['failed', 'awaiting_configuration'].includes(call.status),
      });
      continue;
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(call.taskId))
      fail('原生成任务身份无效。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
    const taskBase = path.resolve(store.root, manifest.workspace.taskDirectory);
    const task = JSON.parse(
      await confinedRead(
        store.root,
        taskBase,
        path.join(taskBase, `${call.taskId}.json`),
        128 * 1024 * 1024,
      ),
    );
    const marker = task.sceneWorkflowGeneration;
    if (
      task.id !== call.taskId ||
      task.status !== 'completed' ||
      task.capabilityId !== capability.id ||
      task.adapter?.provider !== profile.provider ||
      task.adapter?.model !== profile.model ||
      marker?.workId !== work.id ||
      marker?.requestId !== call.requestId ||
      marker?.requestHash !== call.requestHash ||
      marker?.profileHash !== profileHash ||
      hash(task.input) !== hash(saved.request.input)
    )
      fail(
        '原生成任务、参数或提供方证据不符。',
        'SCENE_GENERATION_EVIDENCE_CHANGED',
      );
    const production = await readProduction(store, manifest, task, call);
    const immutable = await store.read(
      path.join(
        store.directory(work.id),
        `generation-evidence-${call.requestId}.json`,
      ),
    );
    if (
      !call.evidenceHash ||
      hash(immutable) !== call.evidenceHash ||
      hash(production.evidence) !== call.evidenceHash ||
      production.image.sha256 !== call.sha256
    )
      fail('原生成图片或来源证据已变化。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
    calls.push({
      requestId: call.requestId,
      taskId: call.taskId,
      evidenceHash: call.evidenceHash,
      capability: call.capability,
      provider: call.provider,
      model: call.model,
      image: production.evidence.image,
    });
  }
  return { passed: true, calls, pending };
}

async function verifyRequestImages(request, root) {
  let total = 0;
  const sources = [
    request.input.image,
    ...(request.input.references ?? []),
  ].filter(Boolean);
  for (const source of sources) {
    const image = await readImageAssetSource(source, root);
    total += image.bytes;
    if (total > MAX_TOTAL_IMAGE_BYTES) fail('生成参考图片总计超过 80 MiB。');
  }
}

/**
 * Shared paid-job boundary for props and native map origin/outpainting.
 * A saved intent never allocates another task, even after a lost hook response.
 */
export async function runWorkflowImageJob(
  store,
  work,
  receipt,
  rawRequest,
  persist,
) {
  if (path.resolve(store.root) !== repositoryRoot)
    fail('生成适配器需要当前工作台根目录；测试请使用隔离 manifest。');
  const request = jobRequestSchema.parse(rawRequest);
  const { profile, capability } = frozenCapability(
    store,
    work,
    request.capability,
  );
  const input = { ...request.input, provider: profile.provider };
  const manifest = {
    ...store.candidateManifest(work),
    capabilities: store.manifest.capabilities.map((item) =>
      item.id === capability.id ? capability : item,
    ),
  };
  const errors = validateInput(capability, input);
  if (errors.length) fail(errors.join(' '));
  await verifyRequestImages(request, store.root);
  const profileHash = hash(profile);
  const requestHash = hash({ ...request, input, profileHash });
  const identity = receipt.commandId ?? receipt.id ?? receipt.stepId;
  if (!identity) fail('图片生成需要稳定步骤身份。');
  const requestId = `wfgen-${hash({ workId: work.id, identity, purpose: request.purpose }).slice(0, 48)}`;
  let job = receipt.generationJob;
  let dispatch = false;
  work.generationCalls ??= [];
  if (job) {
    if (
      job.requestId !== requestId ||
      job.requestHash !== requestHash ||
      job.profileHash !== profileHash
    )
      fail(
        '同一生成步骤的请求意图发生变化；不会重发。',
        'SCENE_GENERATION_INTENT_CHANGED',
      );
  } else {
    if (work.generationCalls.some((item) => item.requestId === requestId))
      fail(
        '已有生成意图缺少对应步骤回执；不会重新提交。',
        'SCENE_GENERATION_OUTCOME_UNKNOWN',
      );
    if (work.generationCalls.length >= (work.spec.budget.generationCalls ?? 0))
      fail(
        '新素材与地图生成调用超过已授权总额度。',
        'SCENE_GENERATION_BUDGET_EXHAUSTED',
      );
    const liveProvider = resolveMapGenerationProvider(
      capability.connector,
      profile.provider,
      request.input.operation,
    );
    if (!liveProvider?.apiKey)
      fail(
        '此制作步骤的已冻结图片提供方尚未配置密钥。',
        'SCENE_GENERATION_CONFIGURATION',
      );
    try {
      validateMapApiKey(liveProvider.apiKey);
    } catch {
      fail(
        '图片提供方密钥格式无效，请在设置中检查。',
        'SCENE_GENERATION_CONFIGURATION',
      );
    }
    await store.freeze(work.id, `generation-request-${requestId}`, {
      schemaVersion: 1,
      requestId,
      requestHash,
      profileHash,
      request: { ...request, input },
      profile,
    });
    job = receipt.generationJob = {
      requestId,
      requestHash,
      profileHash,
      status: 'recorded',
      submissionState: 'dispatching',
      submitted: false,
    };
    work.generationCalls.push({
      ...job,
      stepId: receipt.id ?? receipt.stepId ?? identity,
      purpose: request.purpose,
      capability: capability.id,
      provider: profile.provider,
      model: profile.model,
    });
    await persist();
    dispatch = true;
  }
  const call = work.generationCalls.find(
    (item) => item.requestId === requestId,
  );
  if (
    !call ||
    call.requestHash !== requestHash ||
    call.profileHash !== profileHash
  )
    fail('生成额度记录与原请求不符。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
  const update = async (values) => {
    Object.assign(job, values);
    Object.assign(call, values);
    await persist();
  };
  if (dispatch) {
    try {
      const result = await runConnector(manifest, capability, input, {
        onPrepared: async ({ task }) => {
          task.sceneWorkflowGeneration = {
            workId: work.id,
            requestId,
            requestHash,
            profileHash,
          };
          // Correlation lives in the original task first. If receipt persistence
          // fails, recovery finds this allocation and never resubmits it.
          await persistTask(manifest, task);
          await update({
            taskId: task.id,
            status: 'prepared',
            submissionState: 'prepared',
          });
        },
      });
      await update({
        taskId: result.task.id,
        status: result.task.status,
        submissionState: 'observing',
        submitted: !['awaiting_configuration', 'prepared'].includes(
          result.task.status,
        ),
      });
    } catch {
      if (!job.taskId) {
        await update({ status: 'outcome_unknown', submissionState: 'unknown' });
        throw workflowError(
          '生成提交未能保存任务身份；原意图已保留，不会重发。',
          'SCENE_GENERATION_OUTCOME_UNKNOWN',
          409,
        );
      }
      // The task owns the terminal state and retained upstream diagnostics.
      // Observe its original identity even when the caller response was lost.
    }
  }
  if (!job.taskId) {
    const recovered = await recoverPreparedTask(store, manifest, job);
    if (!recovered) {
      await update({ status: 'outcome_unknown', submissionState: 'unknown' });
      fail(
        '原生成请求未保存任务身份，提交结果未知；不会重发。',
        'SCENE_GENERATION_OUTCOME_UNKNOWN',
      );
    }
    await update({
      taskId: recovered.id,
      status: recovered.status,
      submissionState: 'observing',
    });
  }
  let task;
  for (;;) {
    task = (await refreshTask(manifest, job.taskId)).task;
    const marker = task.sceneWorkflowGeneration;
    if (
      task.id !== job.taskId ||
      task.capabilityId !== capability.id ||
      marker?.workId !== work.id ||
      marker?.requestId !== requestId ||
      marker?.requestHash !== requestHash ||
      marker?.profileHash !== profileHash ||
      hash(task.input) !== hash(input)
    )
      fail('原生成任务身份或参数已变化。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
    await update({ status: task.status });
    if (task.status === 'completed') break;
    if (task.status !== 'running' || !task.adapter?.backgroundExecution) {
      const status =
        task.status === 'running' ? 'outcome_unknown' : task.status;
      await update({
        status,
        submissionState: status === 'outcome_unknown' ? 'unknown' : 'observed',
      });
      fail(
        '原生成任务未完成或提交结果未知，请检查原任务产物；不会重发。',
        status === 'outcome_unknown' || status === 'attention_required'
          ? 'SCENE_GENERATION_OUTCOME_UNKNOWN'
          : 'SCENE_GENERATION_ATTENTION',
      );
    }
    if (await store.pauseRequested(work.id)) return { paused: true };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (
    task.adapter?.provider !== profile.provider ||
    task.adapter?.model !== profile.model
  )
    fail('原生成任务的提供方或模型不符。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
  const production = await readProduction(store, manifest, task, job);
  if (job.evidenceHash && job.evidenceHash !== hash(production.evidence))
    fail('原生成图片或来源证据已变化。', 'SCENE_GENERATION_EVIDENCE_CHANGED');
  await store.freeze(
    work.id,
    `generation-evidence-${requestId}`,
    production.evidence,
  );
  receipt.generationEvidence = production.evidence;
  await update({
    status: 'completed',
    submissionState: 'observed',
    submitted: true,
    sha256: production.image.sha256,
    evidenceHash: hash(production.evidence),
  });
  return { task, ...production };
}

/** Save new artwork into the isolated candidate using the original document CAS. */
export async function executeGenerationStep(
  store,
  work,
  receipt,
  step,
  persist,
) {
  const input = generationStepSchema.parse(JSON.parse(step.input));
  const manifest = store.candidateManifest(work);
  if (!receipt.beforeRevision) {
    const { document } = await getDocument(store.root, manifest, {
      documentId: work.spec.documentId,
    });
    receipt.beforeRevision = document.revision;
    receipt.beforeHash = document.contentHash;
    receipt.commandId = `scene:${work.id}:${work.plans.length}:${step.id}`;
    await persist();
  }
  const { document: before } = await getDocument(store.root, manifest, {
    documentId: work.spec.documentId,
    revision: receipt.beforeRevision,
  });
  if (receipt.beforeHash !== before.contentHash)
    fail(
      '生成步骤的原候选版本证据已变化。',
      'SCENE_GENERATION_EVIDENCE_CHANGED',
    );
  validateGenerationStep(before.content, input, { work });
  const production = await runWorkflowImageJob(
    store,
    work,
    receipt,
    {
      purpose: `object:${step.id}`,
      capability: 'image-assets',
      input: {
        operation: 'generate-prop',
        name: input.name,
        prompt: input.prompt,
        width: input.width,
        height: input.height,
      },
    },
    persist,
  );
  if (production.paused) return production;
  const content = appendGeneratedMaterial(
    before.content,
    input,
    production.image,
  );
  const result = await saveDocument(
    store.root,
    manifest,
    {
      documentId: before.id,
      expectedRevision: before.revision,
      commandId: receipt.commandId,
      content,
    },
    { respectLocks: true },
  );
  return { document: result.document, generationEvidence: production.evidence };
}
