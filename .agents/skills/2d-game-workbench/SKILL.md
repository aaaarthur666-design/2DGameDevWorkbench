---
name: 2d-game-workbench
description: Drive this repository's reusable 2D game production capabilities when a user asks to create, organize, validate, or hand off sprite-animation frames or stitched tile maps.
---

# 2D Game Workbench

Use the repository capability registry and runner so Agent-driven work follows the same contract as the visible workbench.

## Workflow

1. Run `npm run workbench -- list --json` to discover available capabilities. Do not infer an unregistered capability.
2. Run `npm run workbench -- describe <capability-id> --json` and shape the request to its declared input schema.
3. Keep user source files in place. Pass repository-relative paths when possible and never overwrite source assets.
4. Run `npm run workbench -- prepare <capability-id> --input <json-file>` first when a connector is not configured, an external call could incur unapproved cost, or the user only requested a plan.
5. When execution is authorized and the connector is available, run `npm run workbench -- run <capability-id> --input <json-file>`.
6. Read the returned task record. Use `npm run workbench -- status <task-id> --json` for follow-up and report the exact output paths.

## Guardrails

- Treat `workbench/manifest.json` as the source of truth shared with the web interface.
- Never invent a successful API response or claim an asset was generated when a task is only prepared or awaiting configuration.
- Read connector URLs and tokens from environment variables named in the manifest. Never write secrets to the repository, task record, command output, or chat.
- If required input is missing, ask only for those fields. If the connector is unavailable, preserve the prepared request and explain the single configuration step needed.
- Keep task records under `work/` and generated or downloaded artifacts under `outputs/`; both are local runtime data and should remain uncommitted.
- A task is complete only when its task record says `completed` and every reported output path exists.

## Capability selection

- Use `sprite-generator` for character action planning, ordered animation frames, sprite-sheet requests, and animation export preparation.
- Use `map-stitcher` for tile placement, seam checks, map composition, and complete level-canvas export preparation.
- When a request spans both, prepare and run separate tasks, then summarize their outputs together.
