---
name: 2d-game-workbench
description: Drive this repository's reusable 2D game production capabilities when a user asks to create, organize, preview, export, or hand off sprite-animation frames, stitched tile maps, or independent Godot interactable objects.
---

# 2D Game Workbench

You are the main Agent running in an external client. The user's request controls scope and authorization. Use the repository registry and bridge so conversation-driven work follows the same task contract shown by the visual workbench. The web app provides task visibility and direct editing; it is not another Agent.

## Choose the bridge

- Prefer the `2d-game-workbench` MCP server when the host exposes it. It provides typed discovery, task execution, and status tools over STDIO.
- If MCP is unavailable, use the equivalent `npm run workbench -- ...` CLI commands from the repository root.

## Workflow with MCP

1. Call `workbench_list_capabilities`. Do not infer an unregistered capability or operation.
2. Call `workbench_describe_capability` and shape the request to its declared input schema.
3. Keep user source files in place. Pass repository-relative paths when possible and never overwrite source assets.
4. Call `workbench_prepare_task` when an adapter operation could call an unapproved external service, incur cost, or the user only requested a plan.
5. Call `workbench_run_task` only when execution is authorized.
6. Read or refresh the returned task with `workbench_get_task`. Report its exact ID, status, error or required configuration, and existing output paths.

## CLI fallback

1. Run `npm run workbench -- list --json` to discover available capabilities. Do not infer an unregistered capability.
2. Run `npm run workbench -- describe <capability-id> --json` and shape the request to its declared input schema.
3. Keep user source files in place. Pass repository-relative paths when possible and never overwrite source assets.
4. Run `npm run workbench -- prepare <capability-id> --input <json-file>` first when an adapter operation could call an unapproved external service, incur cost, or the user only requested a plan.
5. When execution is authorized, run `npm run workbench -- run <capability-id> --input <json-file>`; local-only operations do not require an external URL.
6. Use `npm run workbench -- status <task-id> --json` for follow-up. Report its exact ID, status, error or required configuration, and existing output paths.

## Guardrails

- Treat `workbench/manifest.json` as the source of truth shared with the web interface.
- Do not imply that the web app contains a general Agent chat. Browser page tools, when the host exposes them, are controls for the visible editor and do not replace repository MCP.
- Never invent a successful API response or claim an asset was generated when a task is only prepared or awaiting configuration.
- Read optional service URLs and tokens from environment variables named in the manifest. Never write secrets to the repository, task record, command output, or chat.
- If required input is missing, ask only for those fields. If an operation returns `awaiting_configuration`, preserve the task and explain the exact environment variable; do not treat other local adapter operations as unavailable.
- Keep task records under `work/` and generated or downloaded artifacts under `outputs/`; both are local runtime data and should remain uncommitted.
- Poll an asynchronous task with `get` or `status`; do not call `run` again merely to query progress.
- A task is complete only when its task record says `completed` and every reported output path exists.

## Capability selection

- Use `sprite-generator` for SpritePipeline `create`, `create-and-generate`, `generate-existing`, `get`, and `export`. Use declared preset IDs; do not derive IDs from free text.
- Use `map-stitcher` `compose` for deterministic local composition and exports. Use `generate-layer` only for the optional external image-generation step.
- Use `interactable-editor` `export-godot` for inspect, toggle, pickup, and sequence objects. Export is local and does not require credentials, SpritePipeline, a Godot installation, or a mandatory validation step.
- For copyWorms compatibility, use the declared `copyworms` target profile. Export success means files were created, not that the target game passed engine regression tests.
- When a request spans capabilities, run separate tasks as authorized, then summarize their outputs together.

## Read only what the task needs

- Overall architecture and state boundaries: `docs/architecture.md`.
- Sprite operations and asynchronous behavior: `docs/sprite-generator.md`.
- Map composition, external generation, state, and export: `docs/map-stitcher.md`.
- Interactable schema, assets, profiles, and Godot handoff: `docs/interactable-editor.md`.
- Protocol and troubleshooting: `docs/connector-contract.md` and `docs/agent-clients.md`.
