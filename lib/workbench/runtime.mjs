import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = path.resolve(moduleDirectory, '..', '..');
export const manifestPath = path.join(
  repositoryRoot,
  'workbench',
  'manifest.json',
);

export async function loadManifest() {
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

export function findCapability(manifest, capabilityId) {
  const capability = manifest.capabilities.find(
    (candidate) => candidate.id === capabilityId,
  );

  if (!capability) {
    throw new Error(
      `Unknown capability "${capabilityId}". List capabilities before choosing one.`,
    );
  }

  return capability;
}

function valueMatchesType(value, expectedType) {
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'integer') return Number.isInteger(value);
  if (expectedType === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  return typeof value === expectedType;
}

export function validateInput(capability, input) {
  const schema = capability.inputSchema;
  const errors = [];

  if (!valueMatchesType(input, 'object')) {
    return ['Input must be a JSON object.'];
  }

  for (const requiredName of schema.required ?? []) {
    if (!(requiredName in input)) {
      errors.push(`Missing required field: ${requiredName}`);
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) {
      if (!(key in schema.properties)) {
        errors.push(`Unknown field: ${key}`);
      }
    }
  }

  for (const [key, value] of Object.entries(input)) {
    const property = schema.properties[key];
    if (!property) continue;
    if (!valueMatchesType(value, property.type)) {
      errors.push(`${key} must be ${property.type}.`);
      continue;
    }
    if (
      property.type === 'string' &&
      property.minLength &&
      value.length < property.minLength
    ) {
      errors.push(`${key} must not be empty.`);
    }
    if (
      (property.type === 'integer' || property.type === 'number') &&
      property.minimum !== undefined &&
      value < property.minimum
    ) {
      errors.push(`${key} must be at least ${property.minimum}.`);
    }
    if (
      (property.type === 'integer' || property.type === 'number') &&
      property.maximum !== undefined &&
      value > property.maximum
    ) {
      errors.push(`${key} must be at most ${property.maximum}.`);
    }
  }

  return errors;
}

function createTaskId(capabilityId) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${capabilityId}-${timestamp}-${suffix}`;
}

function taskFilePath(manifest, taskId) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(taskId)) {
    throw new Error('Task ID contains unsupported characters.');
  }

  return path.resolve(
    repositoryRoot,
    manifest.workspace.taskDirectory,
    `${taskId}.json`,
  );
}

async function persistTask(manifest, task) {
  const directory = path.resolve(
    repositoryRoot,
    manifest.workspace.taskDirectory,
  );
  await mkdir(directory, { recursive: true });
  const taskPath = taskFilePath(manifest, task.id);
  await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  return path.relative(repositoryRoot, taskPath).replaceAll('\\', '/');
}

export function publicCapability(capability) {
  return {
    id: capability.id,
    name: capability.name,
    description: capability.description,
    connector: {
      type: capability.connector.type,
      configured: Boolean(process.env[capability.connector.urlEnv]),
      urlEnv: capability.connector.urlEnv,
    },
    requiredInputs: capability.inputSchema.required ?? [],
    outputs: capability.outputs,
  };
}

export async function prepareTask(
  manifest,
  capability,
  input,
  status = 'prepared',
) {
  const errors = validateInput(capability, input);
  if (errors.length > 0) {
    throw new Error(`Input validation failed:\n- ${errors.join('\n- ')}`);
  }

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
  const url = process.env[capability.connector.urlEnv];
  if (!url) {
    const prepared = await prepareTask(
      manifest,
      capability,
      input,
      'awaiting_configuration',
    );
    return {
      ...prepared,
      requiredEnvironment: capability.connector.urlEnv,
    };
  }

  const { task, taskPath } = await prepareTask(
    manifest,
    capability,
    input,
    'running',
  );
  const token = capability.connector.tokenEnv
    ? process.env[capability.connector.tokenEnv]
    : undefined;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        taskId: task.id,
        capabilityId: capability.id,
        input,
      }),
    });

    const responseText = await response.text();
    let responseBody;
    try {
      responseBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseBody = { text: responseText };
    }

    if (!response.ok) {
      throw new Error(
        `Connector returned HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const outputDirectory = path.resolve(
      repositoryRoot,
      manifest.workspace.outputDirectory,
      task.id,
    );
    await mkdir(outputDirectory, { recursive: true });
    const resultPath = path.join(outputDirectory, 'result.json');
    await writeFile(
      resultPath,
      `${JSON.stringify(responseBody, null, 2)}\n`,
      'utf8',
    );

    task.status = 'completed';
    task.updatedAt = new Date().toISOString();
    task.outputs = [
      path.relative(repositoryRoot, resultPath).replaceAll('\\', '/'),
    ];
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

export function summarizeTask(result) {
  return {
    taskId: result.task.id,
    status: result.task.status,
    taskPath: result.taskPath,
    outputs: result.task.outputs,
    ...(result.requiredEnvironment
      ? { requiredEnvironment: result.requiredEnvironment }
      : {}),
  };
}
