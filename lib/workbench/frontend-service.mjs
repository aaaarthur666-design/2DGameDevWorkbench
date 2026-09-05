import { spawn } from 'node:child_process';
import {
  open,
  readFile,
  writeFile,
  mkdir,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot } from './runtime.mjs';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function localUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !loopbackHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('自动启动前端仅支持本机 HTTP 根地址。');
  return url;
}

export async function probeFrontendService(url, service) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2000),
      redirect: 'error',
    });
    const payload = await response.json().catch(() => null);
    return response.ok && payload?.ok === true && payload.service === service
      ? { state: 'ready' }
      : { state: 'conflict', message: '地址已响应，但不是预期的工作台服务。' };
  } catch (error) {
    // Only refused connections prove the port is free. Timeouts must not launch duplicates.
    const refused =
      error.cause?.code === 'ECONNREFUSED' ||
      (error.cause?.errors?.length &&
        error.cause.errors.every((e) => e.code === 'ECONNREFUSED'));
    return refused
      ? { state: 'offline' }
      : {
          state: 'unreachable',
          message: '服务探测超时或不可达，请检查现有进程。',
        };
  }
}

export async function getFrontend(manifest) {
  const url = localUrl(manifest.workspace.frontend.url).origin;
  const runtimeUrl = (
    process.env.WORKBENCH_RUNTIME_URL || 'http://127.0.0.1:8790'
  ).replace(/\/+$/, '');
  const [web, runtime] = await Promise.all([
    probeFrontendService(
      `${url}${manifest.workspace.frontend.healthPath}`,
      '2d-game-workbench-web',
    ),
    probeFrontendService(`${runtimeUrl}/health`, '2d-game-workbench-runtime'),
  ]);
  return {
    url,
    ...web,
    ready: web.state === 'ready' && runtime.state === 'ready',
    runtime: { url: runtimeUrl, ...runtime },
    hostAction: {
      host: 'WorkBuddy',
      tool: 'present_files',
      arguments: {
        files: [url],
        cwd: repositoryRoot,
        explanation: '打开 2D 游戏制作工作台',
      },
    },
  };
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

// Fixed launch specifications come from startFrontend, never from tool arguments.
export async function startManagedFrontendProcess(root, name, launch, probe) {
  const directory = path.join(root, 'work/services');
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, `${name}.lock`);
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // A crashed owner must not block subsequent sessions forever.
    try {
      const owner = JSON.parse(await readFile(lockPath, 'utf8'));
      const info = await stat(lockPath);
      if (!alive(owner.pid) && Date.now() - info.mtimeMs > 10_000) {
        await unlink(lockPath);
        return startManagedFrontendProcess(root, name, launch, probe);
      }
    } catch {}
    return { status: 'starting', message: '已有启动请求；请查询环境状态。' };
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    const current = await probe();
    if (current.state === 'ready') return { status: 'reused' };
    if (current.state !== 'offline') return { status: 'blocked', ...current };
    const statePath = path.join(directory, `${name}.json`);
    let previous;
    try {
      previous = JSON.parse(await readFile(statePath, 'utf8'));
    } catch {}
    if (alive(previous?.pid))
      return {
        status: 'starting',
        pid: previous.pid,
        logPath: previous.logPath,
      };
    const logPath = path.join(directory, `${name}.log`);
    const log = await open(logPath, 'a');
    let child;
    try {
      child = spawn(process.execPath, launch.args, {
        cwd: root,
        env: launch.env || process.env,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log.fd, log.fd],
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
      await writeFile(statePath, JSON.stringify({ pid: child.pid, logPath }));
    } finally {
      await log.close();
    }
    return { status: 'starting', pid: child.pid, logPath };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export async function startFrontend(manifest) {
  const frontend = await getFrontend(manifest);
  if (frontend.ready) return { status: 'reused', frontend };
  const target = localUrl(frontend.url);
  const runtimeTarget = localUrl(frontend.runtime.url);
  if (
    !['ready', 'offline'].includes(frontend.state) ||
    !['ready', 'offline'].includes(frontend.runtime.state)
  )
    return {
      status: 'blocked',
      frontend,
      message: '服务地址冲突或暂时不可达，不重复启动。',
    };
  if (frontend.runtime.state === 'offline') {
    const runtime = await startManagedFrontendProcess(
      repositoryRoot,
      `runtime-${runtimeTarget.port || 80}`,
      {
        args: ['scripts/workbench-http.mjs'],
        env: {
          ...process.env,
          WORKBENCH_RUNTIME_HOST: runtimeTarget.hostname,
          WORKBENCH_RUNTIME_PORT: runtimeTarget.port || '80',
        },
      },
      () =>
        probeFrontendService(
          `${runtimeTarget.origin}/health`,
          '2d-game-workbench-runtime',
        ),
    );
    if (runtime.status === 'blocked') return { ...runtime, frontend };
  }
  let web = { status: 'reused' };
  if (frontend.state === 'offline')
    web = await startManagedFrontendProcess(
      repositoryRoot,
      `frontend-${target.port || 80}`,
      {
        args: [
          'node_modules/vinext/dist/cli.js',
          'dev',
          '--hostname',
          target.hostname,
          '--port',
          target.port || '80',
        ],
      },
      () =>
        probeFrontendService(
          `${target.origin}${manifest.workspace.frontend.healthPath}`,
          '2d-game-workbench-web',
        ),
    );
  return {
    ...web,
    status: web.status === 'blocked' ? 'blocked' : 'starting',
    frontend: await getFrontend(manifest),
    message:
      '查询 get_environment，待 frontend.ready 为 true 后由 WorkBuddy 调用 hostAction。本工具只启动本地服务，尚未打开内部浏览器。',
  };
}
