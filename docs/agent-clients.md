# Agent client integration

## Role boundary

The main Agent runs in the client that opened this repository, such as Codex or another WorkBuddy-style client with STDIO MCP support. The browser interface is the workbench's visual control and monitoring surface. It can submit a task directly, but it does not host or imitate the main language model.

All clients, the CLI, and the web interface ultimately use `workbench/manifest.json` and the same connector contract.

## Supported entry points

| Entry point | Intended use | Configuration |
| --- | --- | --- |
| MCP STDIO | Preferred Agent-client integration | `.mcp.json` or `.codex/config.toml` |
| Repository Skill | Workflow guidance and safe capability selection | `.agents/skills/2d-game-workbench/SKILL.md` |
| CLI | Fallback for clients without MCP and for debugging | `npm run workbench -- ...` |
| Web console | Human control, task visibility, and direct submission | `npm run dev` |
| WebMCP | Optional page-aware host integration | Registered by the browser page |

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

| Tool | Effect |
| --- | --- |
| `workbench_list_capabilities` | Lists registered capabilities and connector readiness |
| `workbench_describe_capability` | Returns one capability's schema and workflow contract |
| `workbench_prepare_task` | Validates input and records a task without an external call |
| `workbench_run_task` | Runs an authorized configured connector, or records `awaiting_configuration` |
| `workbench_get_task` | Reads the exact current task record |

The expected Agent flow is discover → describe → prepare or run → inspect status → report exact output paths.

## Shared runtime and safety

MCP and CLI share `lib/workbench/runtime.mjs`; the visual console uses the same manifest and connector fields. Runtime records remain under `work/`, generated assets remain under `outputs/`, and both directories stay uncommitted. Connector credentials are read from environment variables and must never appear in chat, task records, browser state, or committed files.

An `awaiting_configuration` or `prepared` task is not a successful generation. The Agent must not invent outputs or describe a task as complete until its task record is `completed` and every reported path exists.
