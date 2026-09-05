import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  adapterConfigured,
  executeAdapter,
  refreshAdapter,
  validateAdapterInput,
} from './adapters/index.mjs';
import { getPublicMapGenerationSettings } from './map-generation-settings.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = path.resolve(moduleDirectory, '..', '..');
export const manifestPath = path.join(repositoryRoot, 'workbench', 'manifest.json');

export async function loadManifest() {
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

export function findCapability(manifest, capabilityId) {
  const capability = manifest.capabilities.find((candidate) => candidate.id === capabilityId);
  if (!capability) {
    throw new Error(`Unknown capability "${capabilityId}". List capabilities before choosing one.`);
  }
  return capability;
}

function valueMatchesType(value, expectedType) {
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'integer') return Number.isInteger(value);
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expectedType === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === expectedType;
}

export function validateInput(capability, input) {
  const schema = capability.inputSchema;
  const errors = [];
  if (!valueMatchesType(input, 'object')) return ['Input must be a JSON object.'];

  for (const requiredName of schema.required ?? []) {
    if (!(requiredName in input)) errors.push(`Missing required field: ${requiredName}`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) {
      if (!(key in schema.properties)) errors.push(`Unknown field: ${key}`);
    }
  }

  for (const [key, value] of Object.entries(input)) {
    const property = schema.properties[key];
    if (!property) continue;
    if (!valueMatchesType(value, property.type)) {
      errors.push(`${key} must be ${property.type}.`);
      continue;
    }
    if (property.enum && !property.enum.includes(value)) {
      errors.push(`${key} must be one of: ${property.enum.join(', ')}.`);
    }
    if (property.type === 'string') {
      if (property.minLength !== undefined && value.length < property.minLength) {
        errors.push(`${key} must contain at least ${property.minLength} characters.`);
      }
      if (property.maxLength !== undefined && value.length > property.maxLength) {
        errors.push(`${key} must contain at most ${property.maxLength} characters.`);
      }
    }
    if (property.type === 'array') {
      if (property.minItems !== undefined && value.length < property.minItems) {
        errors.push(`${key} must contain at least ${property.minItems} items.`);
      }
      if (property.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
        errors.push(`${key} must not contain duplicates.`);
      }
      if (property.items?.type) {
        value.forEach((item, index) => {
          if (!valueMatchesType(item, property.items.type)) {
            errors.push(`${key}[${index}] must be ${property.items.type}.`);
          }
          if (property.items.enum && !property.items.enum.includes(item)) {
            errors.push(`${key}[${index}] must be one of: ${property.items.enum.join(', ')}.`);
          }
        });
      }
    }
    if (property.type === 'integer' || property.type === 'number') {
      if (property.minimum !== undefined && value < property.minimum) {
        errors.push(`${key} must be at least ${property.minimum}.`);
      }
      if (property.maximum !== undefined && value > property.maximum) {
        errors.push(`${key} must be at most ${property.maximum}.`);
      }
    }
  }
  errors.push(...validateAdapterInput(capability, input));
  return errors;
}

function createTaskId(capabilityId) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${capabilityId}-${timestamp}-${suffix}`;
}

function taskFilePath(manifest, taskId) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(taskId)) throw new Error('Task ID contains unsupported characters.');
  return path.resolve(repositoryRoot, manifest.workspace.taskDirectory, `${taskId}.json`);
}

export async function persistTask(manifest, task) {
  const directory = path.resolve(repositoryRoot, manifest.workspace.taskDirectory);
  await mkdir(directory, { recursive: true });
  const taskPath = taskFilePath(manifest, task.id);
  await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  return projectRelative(taskPath);
}

export function publicCapability(capability) {
  const connector = capability.connector;
  const mapGeneration = Array.isArray(connector.providers)
    ? getPublicMapGenerationSettings(connector)
    : null;
  return {
    id: capability.id,
    name: capability.name,
    description: capability.description,
    connector: {
      type: connector.type,
      adapter: connector.adapter,
      configured: adapterConfigured(capability),
      ...(connector.urlEnv ? { urlEnv: connector.urlEnv } : {}),
      ...(mapGeneration
        ? {
            providers: mapGeneration.providers,
            externalGenerationConfigured: mapGeneration.providers.some((provider) => provider.configured),
            activeGenerationProvider: mapGeneration.active ? mapGeneration.provider : null,
          }
        : {}),
    },
    requiredInputs: capability.inputSchema.required ?? [],
    outputs: capability.outputs,
  };
}

export async function prepareTask(manifest, capability, input, status = 'prepared') {
  const errors = validateInput(capability, input);
  if (errors.length > 0) throw new Error(`Input validation failed:\n- ${errors.join('\n- ')}`);
  const now = new Date().toISOString();
  const task = {
    schemaVersion: 1,
    id: createTaskId(capability.id),
    capabilityId: capability.id,
    status,
    createdAt: now,
    updatedAt: now,
    input,
    outputs: [],
  };
  const taskPath = await persistTask(manifest, task);
  return { task, taskPath };
}

export async function runConnector(manifest, capability, input) {
  if (capability.connector.type === 'local-adapter') {
    return runLocalAdapter(manifest, capability, input);
  }
  return runHttpConnector(manifest, capability, input);
}

async function runLocalAdapter(manifest, capability, input) {
  const { task, taskPath } = await prepareTask(manifest, capability, input, 'running');
  const outputDirectory = path.resolve(repositoryRoot, manifest.workspace.outputDirectory, task.id);
  await mkdir(outputDirectory, { recursive: true });
  try {
    const execution = await executeAdapter(capability, {
      manifest,
      input,
      task,
      repositoryRoot,
      outputDirectory,
    });
    return await applyAdapterExecution(
      manifest,
      task,
      taskPath,
      outputDirectory,
      execution,
    );
  } catch (error) {
    task.status = 'failed';
    task.updatedAt = new Date().toISOString();
    task.error = error instanceof Error ? error.message : String(error);
    await persistTask(manifest, task);
    throw new Error(`Task ${task.id} failed: ${task.error}`);
  }
}

async function runHttpConnector(manifest, capability, input) {
  const url = process.env[capability.connector.urlEnv];
  if (!url) {
    const prepared = await prepareTask(manifest, capability, input, 'awaiting_configuration');
    return { ...prepared, requiredEnvironment: capability.connector.urlEnv };
  }
  const { task, taskPath } = await prepareTask(manifest, capability, input, 'running');
  const token = capability.connector.tokenEnv ? process.env[capability.connector.tokenEnv] : undefined;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ taskId: task.id, capabilityId: capability.id, input }),
    });
    const responseText = await response.text();
    let responseBody;
    try {
      responseBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseBody = { text: responseText };
    }
    if (!response.ok) throw new Error(`Connector returned HTTP ${response.status}: ${response.statusText}`);
    const outputDirectory = path.resolve(repositoryRoot, manifest.workspace.outputDirectory, task.id);
    await mkdir(outputDirectory, { recursive: true });
    const resultPath = path.join(outputDirectory, 'result.json');
    await writeFile(resultPath, `${JSON.stringify(responseBody, null, 2)}\n`, 'utf8');
    task.status = 'completed';
    task.updatedAt = new Date().toISOString();
    task.outputs = [projectRelative(resultPath)];
    await persistTask(manifest, task);
    return { task, taskPath };
  } catch (error) {
    task.status = 'failed';
    task.updatedAt = new Date().toISOString();
    task.error = error instanceof Error ? error.message : String(error);
    await persistTask(manifest, task);
    throw new Error(`Task ${task.id} failed: ${task.error}`);
  }
}

export async function readTask(manifest, taskId) {
  return JSON.parse(await readFile(taskFilePath(manifest, taskId), 'utf8'));
}

export async function refreshTask(manifest, taskId) {
  const task = await readTask(manifest, taskId);
  const taskPath = projectRelative(taskFilePath(manifest, taskId));
  if (task.status !== 'running') return { task, taskPath };

  const capability = findCapability(manifest, task.capabilityId);
  if (capability.connector.type !== 'local-adapter') return { task, taskPath };
  const outputDirectory = path.resolve(
    repositoryRoot,
    manifest.workspace.outputDirectory,
    task.id,
  );
  await mkdir(outputDirectory, { recursive: true });
  try {
    const execution = await refreshAdapter(capability, {
      manifest,
      input: task.input,
      task,
      repositoryRoot,
      outputDirectory,
    });
    if (!execution) return { task, taskPath };
    return await applyAdapterExecution(
      manifest,
      task,
      taskPath,
      outputDirectory,
      execution,
    );
  } catch (error) {
    return {
      task,
      taskPath,
      refreshError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listTasks(manifest, { limit = 50, refresh = false } = {}) {
  const directory = path.resolve(repositoryRoot, manifest.workspace.taskDirectory);
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const tasks = await Promise.all(
    names
      .filter((name) => /^[a-z0-9][a-z0-9_-]*\.json$/i.test(name))
      .map(async (name) => {
        try {
          return JSON.parse(await readFile(path.join(directory, name), 'utf8'));
        } catch {
          return null;
        }
      }),
  );
  const selected = tasks
    .filter(Boolean)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, Math.max(1, Math.min(200, limit)));
  if (!refresh) return selected;
  return Promise.all(
    selected.map(async (task) => {
      if (task.status !== 'running') return task;
      const refreshed = await refreshTask(manifest, task.id);
      return refreshed.refreshError
        ? { ...refreshed.task, refreshError: refreshed.refreshError }
        : refreshed.task;
    }),
  );
}

export function summarizeTask(result) {
  return {
    taskId: result.task.id,
    status: result.task.status,
    taskPath: result.taskPath,
    outputs: result.task.outputs,
    ...(result.task.adapter ? { adapter: result.task.adapter } : {}),
    ...(result.requiredEnvironment || result.task.requiredEnvironment
      ? { requiredEnvironment: result.requiredEnvironment ?? result.task.requiredEnvironment }
      : {}),
    ...(result.refreshError ? { refreshError: result.refreshError } : {}),
  };
}

async function applyAdapterExecution(
  manifest,
  task,
  taskPath,
  outputDirectory,
  execution,
) {
  task.status = execution.status;
  task.updatedAt = new Date().toISOString();
  task.outputs = [];
  if (execution.adapter) task.adapter = execution.adapter;
  if (execution.requiredEnvironment) task.requiredEnvironment = execution.requiredEnvironment;
  else delete task.requiredEnvironment;
  delete task.error;

  if (execution.result !== null && execution.result !== undefined) {
    const resultPath = path.join(outputDirectory, 'result.json');
    await writeFile(resultPath, `${JSON.stringify(execution.result, null, 2)}\n`, 'utf8');
    task.outputs.push(projectRelative(resultPath));
  }
  for (const name of execution.generatedOutputNames ?? []) {
    const outputPath = path.resolve(outputDirectory, name);
    ensureInside(outputDirectory, outputPath, 'Adapter output');
    const info = await stat(outputPath);
    if (!info.isFile()) throw new Error(`Adapter output is not a file: ${name}`);
    task.outputs.push(projectRelative(outputPath));
  }
  task.outputs = [...new Set(task.outputs)];
  if (task.status === 'failed') {
    task.error = execution.error ?? 'Adapter reported a failed task.';
  }
  await persistTask(manifest, task);
  return {
    task,
    taskPath,
    ...(execution.requiredEnvironment
      ? { requiredEnvironment: execution.requiredEnvironment }
      : {}),
  };
}

function projectRelative(filePath) {
  const relative = path.relative(repositoryRoot, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the repository: ${filePath}`);
  }
  return relative.replaceAll('\\', '/');
}

function ensureInside(directory, filePath, label) {
  const relative = path.relative(directory, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside its task output directory.`);
  }
}
