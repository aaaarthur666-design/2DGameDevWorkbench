#!/usr/bin/env node

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
  findCapability,
  listTasks,
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
    if (request.method === 'POST' && url.pathname === '/v1/scene-composer/export') {
      try { sendJson(response, 200, await exportSceneRequest(request, repositoryRoot)); }
      catch (error) { sendJson(response, 400, { error: error.message }); }
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/v1/agent/')) {
      const operation = url.pathname.slice('/v1/agent/'.length);
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
    if (request.method === 'GET' && url.pathname === '/v1/tasks') {
      const manifest = await loadManifest();
      const limit = Number(url.searchParams.get('limit') ?? 30);
      const refresh = url.searchParams.get('refresh') === 'true';
      sendJson(response, 200, {
        tasks: await listTasks(manifest, {
          limit: Number.isInteger(limit) ? limit : 30,
          refresh,
        }),
      });
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
