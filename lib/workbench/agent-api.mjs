import { spawn } from 'node:child_process';
import { existsSync, openSync, closeSync } from 'node:fs';
import {
  readFile,
  realpath,
  stat,
  mkdir,
  open,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  findCapability,
  listTasks,
  readTask,
  repositoryRoot,
} from './runtime.mjs';
import { requestJson, bearerHeaders, endpointUrl } from './adapters/http.mjs';
import {
  resolveSpritePipelineTarget,
  createSpritePipelineLaunch,
  probeSpritePipeline,
} from './sprite-pipeline-supervisor.mjs';

import { getFrontend, startFrontend } from './frontend-service.mjs';

export const AGENT_API_VERSION = 1;

export async function getConversationGuidance(manifest) {
  const source = manifest.agentAssets.conversationGuide;
  return {
    source,
    text: await readFile(path.join(repositoryRoot, source), 'utf8'),
    capabilityIds: manifest.capabilities.map((capability) => capability.id),
    createsTask: false,
  };
}

async function pipelineRequest(manifest, route) {
  const { connector } = findCapability(manifest, 'sprite-generator');
  return requestJson(
    endpointUrl(process.env[connector.urlEnv] || connector.defaultUrl, route),
    {
      headers: bearerHeaders(process.env[connector.tokenEnv]),
      timeoutMs: 5000,
    },
  );
}

export async function getEnvironment(manifest) {
  const python = path.join(
    repositoryRoot,
    'Tools/SpritePipeline/.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const result = {
    agentApiVersion: AGENT_API_VERSION,
    frontend: await getFrontend(manifest),
    nodeVersion: process.version,
    pythonInstalled: existsSync(python),
    pipeline: { online: false, compatible: false, keyConfigured: false },
    capabilities: manifest.capabilities.map((c) => ({
      id: c.id,
      local: !c.connector.urlEnv,
    })),
    setupCommand: 'npm run sprite-pipeline:setup',
  };
  try {
    const health = await pipelineRequest(manifest, '/health');
    if (health.ok !== true || typeof health.version !== 'string')
      throw new Error('Unexpected service');
    result.pipeline.online = true;
    result.pipeline.version = health.version;
    result.pipeline.keyConfigured = health.pixellab_configured === true;
    const spec = await pipelineRequest(manifest, '/openapi.json');
    const required = [
      '/v1/presets',
      '/v1/jobs/{job_id}/candidates/{candidate_index}/check',
      '/v1/jobs/{job_id}/candidates/{candidate_index}/approve',
      '/v1/jobs/{job_id}/candidates/{candidate_index}/recover',
      '/v1/reference-art/jobs',
    ];
    const missingRoutes = required.filter((route) => !spec.paths?.[route]);
    result.pipeline = {
      online: true,
      version: health.version,
      compatible:
        missingRoutes.length === 0 &&
        health.workbench_api_version === AGENT_API_VERSION,
      missingRoutes,
      keyConfigured: health.pixellab_configured === true,
      message:
        missingRoutes.length ||
        health.workbench_api_version !== AGENT_API_VERSION
          ? '服务接口较旧，请重启 SpritePipeline 加载最新代码。'
          : '服务已就绪；Key 配置状态不代表已验证余额。',
    };
  } catch {
    result.pipeline.message = result.pipeline.online
      ? '服务在线，但接口描述不可用；请重启服务加载最新接口。'
      : '无法访问 SpritePipeline；检查服务地址或启动本地服务。';
  }
  return result;
}

export async function startServices(manifest) {
  // Only the known local pipeline may be started. No commands or paths come from callers.
  const target = resolveSpritePipelineTarget();
  if (target.mode !== 'managed' || !target.baseUrl.startsWith('http:'))
    return {
      status: 'external',
      message: '已配置外部服务，本机不会代为启动。',
      environment: await getEnvironment(manifest),
    };
  const current = await probeSpritePipeline(target, {
    token: process.env.SPRITE_PIPELINE_API_TOKEN,
  });
  if (current.state === 'ready')
    return { status: 'reused', environment: await getEnvironment(manifest) };
  if (current.state !== 'offline')
    return { status: 'blocked', message: current.reason };
  const directory = path.join(repositoryRoot, 'work/services');
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, `sprite-${target.port}.lock`);
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return {
      status: 'starting',
      message: '另一启动请求正在进行；请查询环境状态。',
      lockPath,
    };
  }
  try {
    const statePath = path.join(directory, `sprite-${target.port}.json`);
    let previous;
    try {
      previous = JSON.parse(await readFile(statePath, 'utf8'));
    } catch {}
    if (
      Number.isInteger(previous?.pid) &&
      previous.pid > 0 &&
      previous.url === target.baseUrl
    ) {
      let alive = false;
      try {
        process.kill(previous.pid, 0);
        alive = true;
      } catch {}
      if (alive)
        return {
          status: 'starting',
          pid: previous.pid,
          logPath: previous.logPath,
          message: '已有本机服务进程正在启动或需要检查日志，不重复创建进程。',
        };
    }
    const launch = createSpritePipelineLaunch(repositoryRoot, target);
    const logPath = path.join(directory, `sprite-${target.port}.log`);
    const log = openSync(logPath, 'a');
    let child;
    try {
      child = spawn(launch.command, launch.args, {
        cwd: repositoryRoot,
        env: launch.env,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log, log],
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    } finally {
      closeSync(log);
    }
    child.unref();
    await writeFile(
      path.join(directory, `sprite-${target.port}.json`),
      JSON.stringify({ pid: child.pid, url: target.baseUrl, logPath }),
    );
    return {
      status: 'starting',
      pid: child.pid,
      logPath,
      message:
        '已启动本机服务，请用环境检查等待就绪。服务会在 MCP 会话关闭后继续运行。',
    };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export async function listPresets(manifest, { query = '' } = {}) {
  const result = await pipelineRequest(manifest, '/v1/presets');
  const matches = (row) =>
    `${row.id} ${row.name}`.toLowerCase().includes(query.toLowerCase());
  return {
    characters: (result.data?.characters ?? []).filter(matches),
    actions: (result.data?.actions ?? []).filter(matches),
  };
}

export async function searchTasks(
  manifest,
  { query = '', capabilityId, status, limit = 50 } = {},
) {
  if (capabilityId) findCapability(manifest, capabilityId);
  const tasks = (await listTasks(manifest, { limit: 200 })).filter(
    (task) =>
      (!capabilityId || task.capabilityId === capabilityId) &&
      (!status || task.status === status) &&
      JSON.stringify({ id: task.id, input: task.input })
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  let nativeJobs = [];
  let nativeError;
  if (!capabilityId || capabilityId === 'sprite-generator') {
    try {
      const result = await pipelineRequest(manifest, '/v1/jobs');
      nativeJobs = (result.data?.jobs ?? [])
        .filter(
          (job) =>
            (!status || job.status === status) &&
            JSON.stringify(job).toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, limit);
    } catch {
      nativeError = '序列帧服务不可用，已返回本地工作台记录。';
    }
  }
  return {
    tasks: tasks.slice(0, limit),
    nativeJobs,
    searchedRecentTasks: 200,
    ...(nativeError ? { nativeError } : {}),
  };
}

async function resolveArtifact(manifest, taskId, artifactPath) {
  const task = await readTask(manifest, taskId);
  if (!task.outputs.includes(artifactPath))
    throw new Error('文件未登记为该任务产物。');
  const allowed = await realpath(
    path.resolve(repositoryRoot, manifest.workspace.outputDirectory, taskId),
  );
  const outputRoot = await realpath(
    path.resolve(repositoryRoot, manifest.workspace.outputDirectory),
  );
  const taskRelative = path.relative(outputRoot, allowed);
  if (
    !taskRelative ||
    taskRelative.startsWith('..') ||
    path.isAbsolute(taskRelative)
  )
    throw new Error('任务目录越过产物根目录。');
  const resolved = await realpath(path.resolve(repositoryRoot, artifactPath));
  const relative = path.relative(allowed, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('产物越过任务目录边界。');
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error('产物不是文件。');
  return { resolved, info };
}

export async function getTaskResult(manifest, { taskId }) {
  const task = await readTask(manifest, taskId);
  const artifacts = [];
  for (const artifactPath of task.outputs) {
    try {
      const { resolved, info } = await resolveArtifact(
        manifest,
        taskId,
        artifactPath,
      );
      artifacts.push({
        path: artifactPath,
        absolutePath: resolved,
        bytes: info.size,
        kind: /\.(png|gif|webp|jpg)$/i.test(artifactPath) ? 'image' : 'file',
      });
    } catch {
      artifacts.push({ path: artifactPath, missing: true });
    }
  }
  const resultPath = task.outputs.find((p) => p.endsWith('/result.json'));
  let result = null;
  if (resultPath) {
    const { resolved, info } = await resolveArtifact(
      manifest,
      taskId,
      resultPath,
    );
    if (info.size > 8 * 1024 * 1024)
      throw new Error('结果记录过大，请读取任务摘要。');
    result = JSON.parse(await readFile(resolved, 'utf8'));
  }
  const capability = findCapability(manifest, task.capabilityId);
  return {
    taskId,
    status: task.status,
    operation: task.input.operation,
    result,
    artifacts,
    outputsVerified: artifacts.every((item) => !item.missing),
    ...(task.error ? { error: task.error } : {}),
    viewPath: capability.ui?.route ?? null,
  };
}

export async function readArtifact(manifest, { taskId, artifactPath }) {
  const { resolved, info } = await resolveArtifact(
    manifest,
    taskId,
    artifactPath,
  );
  if (info.size > 40 * 1024 * 1024)
    throw new Error('产物超过预览大小限制，请使用返回的文件路径。');
  const buffer = await readFile(resolved);
  const ext = path.extname(resolved).toLowerCase();
  if (['.png', '.webp', '.jpg', '.jpeg', '.gif'].includes(ext)) {
    // Preview only. Original export bytes remain unchanged.
    const preview = await sharp(buffer, { limitInputPixels: 64_000_000 })
      .resize({
        width: 1024,
        height: 1024,
        fit: 'inside',
        withoutEnlargement: true,
        kernel: 'nearest',
      })
      .png()
      .toBuffer();
    return {
      taskId,
      artifactPath,
      absolutePath: resolved,
      mimeType: 'image/png',
      previewNote:
        ext === '.gif'
          ? 'GIF 首帧预览；审核动作需读取 orderedFrames 中的逐帧 PNG。'
          : '预览可能缩小；原文件保持不变。',
      imageBase64: preview.toString('base64'),
    };
  }
  if (ext === '.json' && buffer.length <= 8 * 1024 * 1024)
    return { taskId, artifactPath, value: JSON.parse(buffer.toString('utf8')) };
  return {
    taskId,
    artifactPath,
    absolutePath: resolved,
    bytes: info.size,
    message: '交付文件，请使用此路径下载或打开。',
  };
}

// The same handlers are consumed by MCP, CLI and the HTTP bridge.
export async function agentRequest(manifest, operation, input = {}) {
  const handlers = {
    guidance: getConversationGuidance,
    environment: getEnvironment,
    start: startServices,
    frontend: startFrontend,
    presets: listPresets,
    tasks: searchTasks,
    result: getTaskResult,
    artifact: readArtifact,
  };
  if (!Object.hasOwn(handlers, operation))
    throw new Error('Unknown agent operation.');
  const allowed = {
    guidance: [],
    environment: [],
    start: [],
    frontend: [],
    presets: ['query'],
    tasks: ['query', 'capabilityId', 'status', 'limit'],
    result: ['taskId'],
    artifact: ['taskId', 'artifactPath'],
  }[operation];
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    throw new Error('Invalid agent operation input.');
  for (const [key, value] of Object.entries(input)) {
    if (
      key === 'limit'
        ? !Number.isInteger(value) || value < 1 || value > 200
        : typeof value !== 'string' || value.length > 2000
    )
      throw new Error(`Invalid ${key}.`);
  }
  if (['result', 'artifact'].includes(operation) && !input.taskId)
    throw new Error('taskId is required.');
  if (operation === 'artifact' && !input.artifactPath)
    throw new Error('artifactPath is required.');
  return handlers[operation](manifest, input);
}
