# Agent client integration

## Role boundary

The main Agent runs in the client that opened this repository, such as Codex or another WorkBuddy-style client with STDIO MCP support. The browser interface is a visual task monitor and a surface for review or fine-grained operations that should remain under human control. It does not host or imitate the main language model, and the home page does not provide a chat or generic task-submission composer.

All clients, the CLI, and the web interface ultimately use `workbench/manifest.json` and the same adapter contracts.

## Supported entry points

| Entry point      | Intended use                                             | Configuration                               |
| ---------------- | -------------------------------------------------------- | ------------------------------------------- |
| MCP STDIO        | Preferred Agent-client integration                       | `.mcp.json` or `.codex/config.toml`         |
| Repository Skill | Workflow guidance and safe capability selection          | `.agents/skills/2d-game-workbench/SKILL.md` |
| CLI              | Fallback for clients without MCP and for debugging       | `npm run workbench -- ...`                  |
| Web console      | Task visibility, artifact review, and human-only editing | `npm run dev`                               |
| WebMCP           | Optional page-aware host integration                     | Registered by the browser page              |

`npm run dev` starts the Worker-compatible web process, the loopback Node Runtime Bridge, and the local SpritePipeline when the default loopback endpoint is in use. It reuses an already healthy pipeline and leaves explicitly configured remote endpoints unmanaged. The web API proxies through the runtime bridge instead of importing Node filesystem or native image modules into the Worker runtime. A hosted page cannot read a developer machine's local tasks unless an explicitly secured remote bridge is configured.

## MCP server

Run the server from the repository root:

```bash
npm run workbench:mcp
```

Clients that understand `.mcp.json` can load the checked-in configuration. Codex can load the project-scoped `.codex/config.toml` after the folder is trusted. For a client that needs manual setup, configure a STDIO server with:

- command: `node`
- arguments: `scripts/workbench-mcp.mjs`
- working directory: this repository root

The server exposes one read-only manifest resource, `workbench://manifest`, and five tools:

| Tool                            | Effect                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `workbench_list_capabilities`   | Lists registered capabilities, local adapters, and optional external-service readiness                                     |
| `workbench_describe_capability` | Returns one capability's schema and workflow contract                                                                      |
| `workbench_prepare_task`        | Validates input and records a task without running its adapter or making an external call                                  |
| `workbench_run_task`            | Runs an authorized manifest-selected adapter; external-only steps can record `awaiting_configuration`                      |
| `workbench_get_task`            | Reads a task and, while it is running, polls its existing upstream job once and persists the refreshed state and artifacts |

The expected Agent flow is discover → describe → prepare or run → inspect status → report exact output paths. Calling `workbench_get_task` is idempotent: it never submits a second generation, and a transient upstream polling error leaves the durable task in its previous state with a separate refresh error.

## Shared runtime and safety

MCP, CLI, and the web task API share `lib/workbench/runtime.mjs`; the visual console polls the same persisted task records. Runtime records remain under `work/`, generated assets remain under `outputs/`, and both directories stay uncommitted. Adapter credentials are read from environment variables and must never appear in chat, task records, browser state, or committed files.

The SpritePipeline adapter maps structured capability input to the real `/v1/jobs` API and copies selected frame/export files into that task's own output directory. The map adapter performs deterministic local compose itself and translates `generate-layer` into either the Google Gemini Generate Content protocol for Nano Banana 2 or the OpenAI Images Edits protocol for GPT Image 2; returned base64 data is normalized to a local PNG before completion. The map editor additionally exposes page-scoped tools for summary, view, import, generation, region creation, and export; these mutate the same visible editor state as the buttons. Browser-triggered map generation also enters the same runtime task ledger used by MCP and CLI.

An `awaiting_configuration` or `prepared` task is not a successful generation. The Agent must not invent outputs or describe a task as complete until its task record is `completed` and every reported path exists.

## Independent interactables

Discover `interactable-editor`, then run `export-godot` with an `InteractableProject` and optional `selectedDefinitionIds`. See `docs/interactable-editor.md` and `examples/requests/interactable-export.json`. The web editor at `/tools/interactable-editor` uploads media to the local Runtime Bridge and submits the same task contract as CLI and MCP.

This adapter writes `interactables.zip`, portable `interactable-project.json`, and `result.json` under `outputs/<task-id>/`. A completed task means export succeeded. No Godot process, external connector, mandatory preview, or validation report is part of export. `npm run dev:interactable` starts its web and local runtime services without starting SpritePipeline.
