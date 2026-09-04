---
name: 2d-game-workbench
description: Drive this repository's reusable 2D game production capabilities when a user asks to create, organize, validate, or hand off sprite-animation frames or stitched tile maps.
---

# 2D Game Workbench

You are the main Agent running in an external client. Use the repository capability registry and bridge so your conversation drives the same task contract shown by the visual workbench. The web page is a control and monitoring surface, not another Agent to delegate reasoning to.

## Choose the bridge

- Prefer the `2d-game-workbench` MCP server when the host exposes it. It provides typed discovery, task execution, and status tools over STDIO.
- If MCP is unavailable, use the equivalent `npm run workbench -- ...` CLI commands from the repository root.

## Workflow with MCP

1. Call `workbench_list_capabilities`. Do not infer an unregistered capability.
2. Call `workbench_describe_capability` and shape the request to its declared input schema.
3. Keep user source files in place. Pass repository-relative paths when possible and never overwrite source assets.
4. Call `workbench_prepare_task` when an adapter operation could call an unapproved external service, incur cost, or the user only requested a plan.
5. Call `workbench_run_task` only when execution is authorized.
6. Read the returned task record with `workbench_get_task` and report the exact output paths.

## CLI fallback

1. Run `npm run workbench -- list --json` to discover available capabilities. Do not infer an unregistered capability.
2. Run `npm run workbench -- describe <capability-id> --json` and shape the request to its declared input schema.
3. Keep user source files in place. Pass repository-relative paths when possible and never overwrite source assets.
4. Run `npm run workbench -- prepare <capability-id> --input <json-file>` first when an adapter operation could call an unapproved external service, incur cost, or the user only requested a plan.
5. When execution is authorized, run `npm run workbench -- run <capability-id> --input <json-file>`; local-only operations do not require an external URL.
6. Read the returned task record. Use `npm run workbench -- status <task-id> --json` for follow-up and report the exact output paths.

## Guardrails

- Treat `workbench/manifest.json` as the source of truth shared with the web interface.
- Do not claim that text entered in the web console was processed by an LLM; it is a direct manual task submission path.
- Never invent a successful API response or claim an asset was generated when a task is only prepared or awaiting configuration.
- Read optional service URLs and tokens from environment variables named in the manifest. Never write secrets to the repository, task record, command output, or chat.
- If required input is missing, ask only for those fields. If an operation returns `awaiting_configuration`, preserve the task and explain the exact environment variable; do not treat other local adapter operations as unavailable.
- Keep task records under `work/` and generated or downloaded artifacts under `outputs/`; both are local runtime data and should remain uncommitted.
- A task is complete only when its task record says `completed` and every reported output path exists.

## Capability selection

- Use `sprite-generator` for real SpritePipeline `create`, `create-and-generate`, `generate-existing`, `get`, and `export` operations. Use preset IDs declared by the pipeline; do not infer IDs from free text.
- Use `map-stitcher` `compose` for deterministic local tile placement, seam checks, Pixelwork state, regions, and engine packages. Use `generate-layer` only for the optional external image-generation step.
- When a request spans both, prepare and run separate tasks, then summarize their outputs together.
