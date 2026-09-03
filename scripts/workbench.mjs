#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const manifestPath = path.join(repositoryRoot, 'workbench', 'manifest.json');

function parseArguments(values) {
  const positional = [];
  const flags = new Map();

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }

    const name = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      flags.set(name, true);
    } else {
      flags.set(name, next);
      index += 1;
    }
  }

  return { positional, flags };
}

async function loadManifest() {
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

function findCapability(manifest, capabilityId) {
  const capability = manifest.capabilities.find(
    (candidate) => candidate.id === capabilityId,
  );

  if (!capability) {
    throw new Error(
      `Unknown capability "${capabilityId}". Run "npm run workbench -- list" first.`,
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

function validateInput(capability, input) {
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

async function loadInput(flags) {
  const inline = flags.get('input-json');
  const inputFile = flags.get('input');

  if (typeof inline === 'string') return JSON.parse(inline);
  if (typeof inputFile === 'string') {
    const resolvedPath = path.resolve(repositoryRoot, inputFile);
    return JSON.parse(await readFile(resolvedPath, 'utf8'));
  }

  throw new Error('Provide --input <json-file> or --input-json <json>.');
}

function createTaskId(capabilityId) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${capabilityId}-${timestamp}-${suffix}`;
}

async function persistTask(manifest, task) {
  const directory = path.resolve(
    repositoryRoot,
    manifest.workspace.taskDirectory,
  );
  await mkdir(directory, { recursive: true });
  const taskPath = path.join(directory, `${task.id}.json`);
  await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  return path.relative(repositoryRoot, taskPath).replaceAll('\\', '/');
}

function publicCapability(capability) {
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

function print(value, jsonMode) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      process.stdout.write(
        `${item.id.padEnd(20)} ${item.name} ${item.connector.configured ? '[configured]' : '[needs connector]'}\n`,
      );
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function prepareTask(manifest, capability, input, status = 'prepared') {
  const errors = validateInput(capability, input);
  if (errors.length > 0) {
    throw new Error(`Input validation failed:\n- ${errors.join('\n- ')}`);
  }

  const task = {
    schemaVersion: 1,
    id: createTaskId(capability.id),
    capabilityId: capability.id,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    input,
    outputs: [],
  };
  const taskPath = await persistTask(manifest, task);
  return { task, taskPath };
}

async function runConnector(manifest, capability, input) {
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

function usage() {
  return `2D Game Dev Workbench runner

Commands:
  list [--json]
  describe <capability-id> [--json]
  doctor [--json]
  prepare <capability-id> --input <json-file> [--json]
  run <capability-id> --input <json-file> [--json]
  status <task-id> [--json]
`;
}

async function main() {
  const { positional, flags } = parseArguments(process.argv.slice(2));
  const [command, target] = positional;
  const jsonMode = flags.has('json');
  const manifest = await loadManifest();

  if (!command || command === 'help') {
    process.stdout.write(usage());
    return;
  }

  if (command === 'list') {
    print(manifest.capabilities.map(publicCapability), jsonMode);
    return;
  }

  if (command === 'describe') {
    print(findCapability(manifest, target), jsonMode);
    return;
  }

  if (command === 'doctor') {
    const report = {
      manifest: 'ok',
      schemaVersion: manifest.schemaVersion,
      capabilities: manifest.capabilities.map((capability) => ({
        id: capability.id,
        connector: capability.connector.type,
        configured: Boolean(process.env[capability.connector.urlEnv]),
        urlEnv: capability.connector.urlEnv,
      })),
    };
    print(report, jsonMode);
    return;
  }

  if (command === 'status') {
    if (!target) throw new Error('Provide a task ID.');
    const taskPath = path.resolve(
      repositoryRoot,
      manifest.workspace.taskDirectory,
      `${target}.json`,
    );
    print(JSON.parse(await readFile(taskPath, 'utf8')), jsonMode);
    return;
  }

  if (command === 'prepare' || command === 'run') {
    const capability = findCapability(manifest, target);
    const input = await loadInput(flags);
    const result =
      command === 'prepare'
        ? await prepareTask(manifest, capability, input)
        : await runConnector(manifest, capability, input);
    print(
      {
        taskId: result.task.id,
        status: result.task.status,
        taskPath: result.taskPath,
        outputs: result.task.outputs,
        ...(result.requiredEnvironment
          ? { requiredEnvironment: result.requiredEnvironment }
          : {}),
      },
      jsonMode,
    );
    return;
  }

  throw new Error(`Unknown command "${command}".\n\n${usage()}`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
