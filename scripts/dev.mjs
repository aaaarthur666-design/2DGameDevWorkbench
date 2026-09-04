#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const children = new Set();
let stopping = false;

const runtime = start(process.execPath, ['scripts/workbench-http.mjs']);
const web = start(process.execPath, ['node_modules/vinext/dist/cli.js', 'dev']);

runtime.on('exit', (code) => finish(code ?? 1));
web.on('exit', (code) => finish(code ?? 0));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => finish(0, signal));
}

function start(command, args) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function finish(code, signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
  process.exitCode = code;
}
