# 2D Game Dev Workbench agent guide

## Purpose

This repository is both a visual workbench and an Agent-driven 2D game production project. The web interface and Agent workflows must use `workbench/manifest.json` as their shared capability source.

## Using workbench capabilities

- For sprite-animation or tile-map production requests, use the repository skill at `.agents/skills/2d-game-workbench/SKILL.md`.
- Discover tools with `npm run workbench -- list --json`; inspect a tool with `npm run workbench -- describe <id> --json`.
- Prepare unconfigured or not-yet-authorized external calls with `npm run workbench -- prepare <id> --input <json-file>`.
- Execute an authorized configured connector with `npm run workbench -- run <id> --input <json-file>` and report the returned task ID and exact output paths.
- Never fabricate tool output. A prepared task or an `awaiting_configuration` task is not a completed task.

## Architecture invariants

- Add or change capabilities in `workbench/manifest.json`; do not maintain a second hard-coded module catalog.
- Keep tool-specific algorithms outside the workbench shell. Integrate them through adapters or HTTP connectors.
- Never expose connector tokens to client components, committed files, task records, or logs.
- Keep runtime records in `work/` and generated assets in `outputs/`; both directories are intentionally uncommitted.
- Preserve input assets. New artifacts must use a task-specific output directory.

## Verification

- Run `npm run workbench -- doctor --json` after changing the manifest or connector contract.
- Run `npm run lint` and `npm run build` after changing application code.
- Validate the repository skill with the bundled skill validator after changing its instructions.
