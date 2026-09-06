import { randomUUID } from 'node:crypto';
import process from 'node:process';

// Import before creating a runtime or MCP/HTTP child. Never write test tasks to work/tasks.
process.env.WORKBENCH_TEST_RUN ||= `run-${randomUUID()}`;
