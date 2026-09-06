---
name: 2d-game-workbench
description: Drive this repository's reusable 2D game production capabilities when a user asks to create, organize, preview, export, or hand off pixel character reference art, sprite-animation frames, stitched tile maps, or independent Godot interactable objects.
---

# 2D Game Workbench

You are the main Agent running in an external client. The user's request controls scope and authorization. Use the repository registry and bridge so conversation-driven work follows the same task contract shown by the visual workbench. The web app provides task visibility and direct editing; it is not another Agent.

## Choose the bridge

- Prefer the `2d-game-workbench` MCP server when the host exposes it. It provides typed discovery, task execution, and status tools over STDIO.
- If MCP is unavailable, use the equivalent `npm run workbench -- ...` CLI commands from the repository root.

## Understand vague requests

Use the `conversationGuidance` returned by `workbench_list_capabilities`, or read [the shared conversation guide](../../../workbench/conversation-guide.md), when a creator describes a goal without tool parameters. It covers character art/motion, manual map editing boundaries, and interactable behavior. Inspect available context and assets first. Ask only about unresolved choices affecting the result; prefer WorkBuddy's currently available `AskUserQuestion` after reading its schema, with concise chat as fallback. Never invent tool availability, switch mode solely for a question, treat a cancelled question as an answer, or create placeholder tasks while clarifying. Do not ask again for choices already supplied. Preserve the user's plan-only versus execution scope.

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

## Conversation-only production

- After list/describe, use `workbench_get_environment` to distinguish installation, service reachability, interface compatibility, and saved key state. If the local service is offline and installed, `workbench_start_services` starts it without generation; query environment until ready. Never repeatedly start an incompatible or occupied service.
- Use `workbench_list_presets` to discover real character/action IDs and defaults. Use `workbench_list_tasks` to find earlier work, including native jobs from the web page. Workbench task IDs and native job IDs are different identifiers.
- Read `workbench_get_result` to get structured characterId, candidates, orderedFrames and delivery paths. Use `workbench_read_artifact` for actual image inspection; GIF preview contains only its first frame, so review ordered frame PNGs for motion.
- For a character brief with authorized generation, chain reference-art generate → get → get_result → transfer → get_result → sprite create-and-generate using the returned characterId. Reuse user-authorized scope; ask only about missing creative choices or additional cost, not internal IDs or routine tool parameters.
- For sprite review, use safety/check and inspect actual frames before approve. Record the visual reasoning in reviewNote, resolve rejected/repair-requested frames, and acknowledge only warnings actually evaluated. Export only after the underlying gate accepts review. Do not claim image quality based only on file existence.
- Recovery uses recover for a known PixelLab job or attach-provider-job for an independently known providerJobId. Never use create/generate as a polling or ambiguous-request recovery shortcut. Failed submissions can still contain a recoverable remoteJobId.
- Diagnostic fixture output proves orchestration only; never label it as AI-generated production art. Use normal production providers for real user assets.

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

- Use `reference-art` `generate` for PixelLab character images (128x128 transparent PNG, prompt and optional name/facing/seed). It shares the SpritePipeline protected key. Use `transfer` with the completed source task ID to import a reusable character; this never generates animation. Poll with get/status and never resubmit to recover an ambiguous paid POST.

- Use `sprite-generator` for SpritePipeline `create`, `create-and-generate`, `generate-existing`, `get`, `export`, `check`, `safety`, `review-frame`, `approve`, `reject`, `recover`, and `attach-provider-job`. Use declared preset IDs; do not derive IDs from free text.
- Map stitching and extension are manual frontend workflows. MCP excludes map-stitcher; direct the user to /tools/map-stitcher. Do not bypass this boundary through CLI, HTTP or browser tools.
- Use `interactable-editor` `export-godot` for inspect, toggle, pickup, and sequence objects. Export is local and does not require credentials, SpritePipeline, a Godot installation, or a mandatory validation step.
- For copyWorms compatibility, use the declared `copyworms` target profile. Export success means files were created, not that the target game passed engine regression tests.
- When a request spans capabilities, run separate tasks as authorized, then summarize their outputs together.

## Read only what the task needs

- Overall architecture and state boundaries: `docs/architecture.md`.
- Reference images, shared credentials and handoff: `docs/reference-art.md`.
- Sprite operations and asynchronous behavior: `docs/sprite-generator.md`.
- Map composition, external generation, state, and export: `docs/map-stitcher.md`.
- Interactable schema, assets, profiles, and Godot handoff: `docs/interactable-editor.md`.
- Protocol and troubleshooting: `docs/connector-contract.md` and `docs/agent-clients.md`.

- First-stage MCP acceptance and manual prompts: `docs/agent-phase1-acceptance.md`.

## Interactable authoring

Use workbench_interactable_template for a complete inspect/toggle/pickup/sequence project without creating a task. Fill in the requested behavior and supplied assets, preserving projectId and definitionId. Run save-project to persist a portable source project without exporting. get_result.viewPath opens this task in the frontend editor; differing local drafts are retained separately. Resume by reading the existing source artifact, editing it and saving again. Use export-godot only for a requested package. A saved logic draft is not an exported asset or generated artwork.
