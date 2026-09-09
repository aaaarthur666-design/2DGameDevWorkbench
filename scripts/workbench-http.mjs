#!/usr/bin/env node
import {
  manageAssets,
  readAssetPreview,
  buildAssetArchive,
  buildAssetImport,
  readAssetGodotPackage,
} from '../lib/workbench/asset-catalog.mjs';

import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import {
  storeInteractableAsset,
  readInteractableAsset,
} from '../lib/workbench/interactable-assets.mjs';

import {
  agentRequest,
  archiveTaskHistory,
  findCapability,
  listTaskPage,
  loadManifest,
  repositoryRoot,
  runConnector,
  refreshTask,
  readTask,
  summarizeTask,
} from '../lib/workbench/runtime.mjs';
import {
  getPublicMapGenerationSettings,
  updateMapGenerationSettings,
} from '../lib/workbench/map-generation-settings.mjs';

import { referenceServiceRequest } from '../lib/workbench/adapters/reference-art.mjs';
import { exportSceneRequest } from '../lib/workbench/scene-export.mjs';
import { frontendHeartbeat } from '../lib/workbench/preview-follow.mjs';

import {randomUUID} from 'node:crypto';
import {selectedGameProject,selectGameProject,deliverGodotPackage,listGameExports,readGamePackageRequest} from '../lib/workbench/game-export.mjs';
import {browseGameProjects} from '../lib/workbench/game-project-browser.mjs';
import {prepareGodotPackage} from '../features/godot-export/package.mjs';
import {requestBinary, endpointUrl, bearerHeaders} from '../lib/workbench/adapters/http.mjs';
const gameExportToken=randomUUID();
const requireGameToken=request=>{if(request.headers['x-forge-game-token']!==gameExportToken)throw new Error('项目导出会话已失效，请关闭导出窗口后重试。');};

import { readMapProject, saveMapProjectRequest } from '../lib/workbench/map-projects.mjs';

const host = process.env.WORKBENCH_RUNTIME_HOST || '127.0.0.1';
const port = readPort(process.env.WORKBENCH_RUNTIME_PORT, 8790);
const maxRequestBytes = 50 * 1024 * 1024;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? `${host}:${port}`}`,
    );
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, {
        ok: true,
        version: 1,
        service: '2d-game-workbench-runtime',
      });
      return;
    }
    if(url.pathname.startsWith('/v1/game-export/')) {
      try {
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('游戏项目交付仅可通过本机回环服务使用。');
        const manifest=await loadManifest();
        const action=url.pathname.slice('/v1/game-export/'.length);
        if(request.method==='GET' && action==='settings') {sendJson(response,200,{token:gameExportToken,project:await selectedGameProject(repositoryRoot,manifest),...(await listGameExports(repositoryRoot,manifest,{pendingOnly:false,limit:10}))});return;}
        if(request.method!=='POST')throw new Error('Unsupported method.');
        requireGameToken(request);
        if(action==='browse') {sendJson(response,200,await browseGameProjects(repositoryRoot,await readJsonBody(request)));return;}
        if(action==='pick') throw new Error('路径选择已改为页面内浏览，请关闭并重新打开导出窗口。');
        if(action==='select') {
          const selected=(await readJsonBody(request)).projectPath;
          sendJson(response,200,{project:selected?await selectGameProject(repositoryRoot,manifest,selected):null,cancelled:!selected});return;
        }
        if(action==='deliver') {
          const bytes=await readGamePackageRequest(request);
          const projectPath=decodeURIComponent(request.headers['x-forge-project']||'');
          const title=decodeURIComponent(request.headers['x-forge-title']||'Godot');
          sendJson(response,200,await deliverGodotPackage(repositoryRoot,manifest,{bytes,title,projectPath}));return;
        }
        if(action==='package') {
          const input=await readJsonBody(request);let pack;
          if(input.jobId) {
            if(typeof input.jobId!=='string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(input.jobId))throw new Error('Invalid jobId.');
            const {connector}=findCapability(manifest,'sprite-generator');
            const url=endpointUrl(process.env[connector.urlEnv]||connector.defaultUrl,'/v1/jobs/'+encodeURIComponent(input.jobId)+'/exports/godot');
            const result=await requestBinary(url,{headers:bearerHeaders(process.env[connector.tokenEnv]),maxBytes:256*1024*1024,timeoutMs:30000});pack={bytes:result.buffer};
          } else pack=await readAssetGodotPackage(manifest,input);
          const prepared=await prepareGodotPackage(pack.bytes);
          response.writeHead(200,{'content-type':'application/zip','cache-control':'no-store','content-length':prepared.bytes.length});response.end(prepared.bytes);return;
        }
        throw new Error('Unknown game export action.');
      } catch(error) {sendJson(response,400,{error:error.message});}
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/assets/import') {
      try {
        const result = await buildAssetImport(await loadManifest(), await readJsonBody(request));
        response.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': result.bytes.length });
        response.end(result.bytes);
      } catch (error) { sendJson(response, 400, { error: error.message }); }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/assets/manage') {
      try { sendJson(response, 200, await manageAssets(await loadManifest(), await readJsonBody(request))); }
      catch (error) { sendJson(response, 400, { error: error.message }); }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/assets/download') {
      try {
        const archive = await buildAssetArchive(
          await loadManifest(),
          await readJsonBody(request),
        );
        response.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${archive.filename}"`,
          'Content-Length': archive.bytes.length,
          'X-Asset-Count': archive.assetCount,
          'X-Asset-File-Count': archive.fileCount,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(archive.bytes);
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/assets/preview') {
      const assetId = url.searchParams.get('assetId');
      if (!assetId || assetId.length > 500) throw new Error('Invalid assetId.');
      const preview = await readAssetPreview(await loadManifest(), assetId, url.searchParams.get('projectRevision') ?? undefined);
      response.writeHead(200, {
        'Content-Type': preview.mime,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(preview.bytes);
      return;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/v1/scene-composer/export'
    ) {
      try {
        sendJson(
          response,
          200,
          await exportSceneRequest(request, repositoryRoot),
        );
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/frontend/heartbeat') {
      try {
        sendJson(response, 200, await frontendHeartbeat(repositoryRoot, await loadManifest(), await readJsonBody(request)));
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }
    if (url.pathname.startsWith('/v1/map-stitcher/projects/') && ['GET', 'PUT'].includes(request.method)) {
      try {
        const id = decodeURIComponent(url.pathname.slice('/v1/map-stitcher/projects/'.length));
        if (request.method === 'PUT') sendJson(response, 200, await saveMapProjectRequest(request, repositoryRoot, id));
        else {
          const { bytes, record } = await readMapProject(repositoryRoot, await loadManifest(), id);
          response.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store',
            'X-Map-Revision': String(record.revision), 'X-Content-Type-Options': 'nosniff' });
          response.end(bytes);
        }
      } catch (error) { sendJson(response, error.status || 400, { error: error.message }); }
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/v1/agent/')) {
      const operation = url.pathname.slice('/v1/agent/'.length);
      if(['export-to-game','install-game-export','complete-game-export'].includes(operation))requireGameToken(request);
      try {
        sendJson(
          response,
          200,
          await agentRequest(
            await loadManifest(),
            operation,
            await readJsonBody(request),
          ),
        );
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/v1/interactable-assets'
    ) {
      try {
        const asset = await readInteractableAsset(
          url.searchParams.get('path'),
          repositoryRoot,
        );
        response.writeHead(200, {
          'content-type': asset.mime,
          'content-length': asset.bytes.length,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        response.end(asset.bytes);
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/v1/interactable-assets'
    ) {
      try {
        sendJson(
          response,
          200,
          await storeInteractableAsset(request, repositoryRoot),
        );
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (
      url.pathname === '/v1/reference-art/settings' &&
      ['GET', 'POST'].includes(request.method)
    ) {
      const manifest = await loadManifest();
      const capability = findCapability(manifest, 'reference-art');
      try {
        let options = {};
        if (request.method === 'POST') {
          const body = await readJsonBody(request);
          if (
            !isRecord(body) ||
            Object.keys(body).some((key) => key !== 'apiKey') ||
            typeof body.apiKey !== 'string' ||
            body.apiKey.length < 8 ||
            body.apiKey.length > 4096
          ) {
            sendJson(response, 400, {
              error: '请输入有效的 PixelLab API Key。',
            });
            return;
          }
          options = {
            method: 'POST',
            body: JSON.stringify({ apiKey: body.apiKey }),
          };
        }
        const settings = await referenceServiceRequest(
          capability.connector,
          '/settings',
          options,
        );
        sendJson(response, 200, {
          configured: settings.configured === true,
          model: 'pixflux',
          size: 128,
        });
      } catch (error) {
        sendJson(response, 503, { error: error.message });
      }
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/v1/tasks/')) {
      const manifest = await loadManifest();
      const id = decodeURIComponent(url.pathname.slice('/v1/tasks/'.length));
      const result =
        url.searchParams.get('refresh') === 'true'
          ? await refreshTask(manifest, id)
          : { task: await readTask(manifest, id) };
      sendJson(response, 200, {
        task: result.task,
        ...(result.refreshError ? { refreshError: result.refreshError } : {}),
      });
      return;
    }
    if (request.method === 'DELETE' && url.pathname === '/v1/history') {
      try {
        sendJson(response, 200, await archiveTaskHistory(await loadManifest(), { checkOnly: url.searchParams.get('check') === 'true' }));
      } catch (error) { sendJson(response, 409, { error: error.message }); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/tasks') {
      const manifest = await loadManifest();
      const limit = Number(url.searchParams.get('limit') ?? 30);
      const refresh = url.searchParams.get('refresh') === 'true';
      sendJson(response, 200, await listTaskPage(manifest, {
        limit,
        offset: Number(url.searchParams.get('offset') ?? 0),
        query: url.searchParams.get('query') ?? '',
        capabilityId: url.searchParams.get('capabilityId') || undefined,
        status: url.searchParams.get('status') || undefined,
        snapshot: url.searchParams.get('snapshot') || undefined,
        refresh,
      }));
      return;
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/v1/map-stitcher/settings'
    ) {
      const manifest = await loadManifest();
      const capability = findCapability(manifest, 'map-stitcher');
      sendJson(
        response,
        200,
        getPublicMapGenerationSettings(capability.connector),
      );
      return;
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/v1/map-stitcher/settings'
    ) {
      const body = await readJsonBody(request);
      const manifest = await loadManifest();
      const capability = findCapability(manifest, 'map-stitcher');
      try {
        sendJson(
          response,
          200,
          updateMapGenerationSettings(capability.connector, body),
        );
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/tasks') {
      const body = await readJsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(response, 400, {
          status: 'failed',
          error: 'Request body must be an object.',
        });
        return;
      }
      if (typeof body.capabilityId !== 'string' || !isRecord(body.input)) {
        sendJson(response, 400, {
          status: 'failed',
          error: 'capabilityId must be a string and input must be an object.',
        });
        return;
      }
      const manifest = await loadManifest();
      const capability = findCapability(manifest, body.capabilityId);
      const result = summarizeTask(
        await runConnector(manifest, capability, body.input),
      );
      const status =
        result.status === 'running' ||
        result.status === 'awaiting_configuration'
          ? 202
          : 200;
      sendJson(response, status, result);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/artifacts') {
      await sendArtifact(response, url.searchParams.get('path'));
      return;
    }
    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const validation =
      message.startsWith('Input validation failed:') ||
      message.startsWith('Unknown capability');
    sendJson(response, validation ? 400 : 500, {
      status: 'failed',
      error: message,
    });
  }
});

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});
server.on('error', (error) => {
  process.stderr.write(`Workbench runtime bridge failed: ${error.message}\n`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  process.stdout.write(
    `Workbench runtime bridge ready at http://${host}:${port}\n`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxRequestBytes) throw new Error('Request body exceeds 50 MB.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

async function sendArtifact(response, requestedPath) {
  if (
    !requestedPath ||
    !requestedPath.replaceAll('\\', '/').startsWith('outputs/')
  ) {
    sendJson(response, 400, { error: 'Only outputs/ artifacts can be read.' });
    return;
  }
  const outputRoot = await realpath(path.join(repositoryRoot, 'outputs'));
  const resolved = await realpath(path.resolve(repositoryRoot, requestedPath));
  const relative = path.relative(outputRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    sendJson(response, 403, { error: 'Artifact path is outside outputs/.' });
    return;
  }
  const info = await stat(resolved);
  if (!info.isFile()) {
    sendJson(response, 404, { error: 'Artifact is not a file.' });
    return;
  }
  response.writeHead(200, {
    'content-type': contentType(resolved),
    'content-length': info.size,
    'content-disposition': `attachment; filename="${path.basename(resolved).replaceAll('"', '')}"`,
    'cache-control': 'no-store',
  });
  createReadStream(resolved).pipe(response);
}

function sendJson(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function contentType(filePath) {
  return (
    {
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.zip': 'application/zip',
      '.psd': 'image/vnd.adobe.photoshop',
      '.txt': 'text/plain; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
    }[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  );
}

function readPort(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error(
      'WORKBENCH_RUNTIME_PORT must be an integer between 1024 and 65535.',
    );
  }
  return parsed;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
