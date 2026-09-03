# 2D Game Dev Workbench agent guide

## Purpose

This repository is both a visual workbench and an Agent-driven 2D game production project. The main Agent is the external client that opened this folder, such as Codex or another MCP-capable WorkBuddy-style client. The web app is a visual control and monitoring surface, not the main Agent or an embedded language model. Every entry point must use `workbench/manifest.json` as its shared capability source.

## Using workbench capabilities

- For sprite-animation or tile-map production requests, use the repository skill at `.agents/skills/2d-game-workbench/SKILL.md`.
- Prefer the project MCP server `2d-game-workbench` when the client exposes it. Start with `workbench_list_capabilities`, then `workbench_describe_capability`.
- Use `workbench_prepare_task` for validation or before an unapproved external call. Use `workbench_run_task` only when execution is authorized, and follow up with `workbench_get_task`.
- If the host client cannot load MCP, use the equivalent CLI commands: `npm run workbench -- list|describe|prepare|run|status`.
- Report the returned task ID, state, and exact output paths.
- Never fabricate tool output. A prepared task or an `awaiting_configuration` task is not a completed task.

## Architecture invariants

- Add or change capabilities in `workbench/manifest.json`; do not maintain a second hard-coded module catalog.
- Keep MCP, CLI, and web behavior aligned through `lib/workbench/runtime.mjs` and the manifest.
- Keep tool-specific algorithms outside the workbench shell. Integrate them through adapters or HTTP connectors.
- Never expose connector tokens to client components, committed files, task records, or logs.
- Keep runtime records in `work/` and generated assets in `outputs/`; both directories are intentionally uncommitted.
- Preserve input assets. New artifacts must use a task-specific output directory.

## Verification

- Run `npm run workbench -- doctor --json` after changing the manifest or connector contract.
- Run `npm run test:mcp` after changing the Agent-client bridge or shared runtime.
- Run `npm run lint` and `npm run build` after changing application code.
- Validate the repository skill with the bundled skill validator after changing its instructions.
