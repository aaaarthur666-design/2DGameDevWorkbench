# Adapter contracts

`workbench/manifest.json` is the single capability catalog. MCP, CLI, and the web task API validate the same input schema, then `lib/workbench/runtime.mjs` dispatches to the named local adapter. A local adapter owns protocol translation; upstream tools never receive the old generic `{ taskId, capabilityId, input }` envelope unless a future capability explicitly declares the legacy HTTP connector type.

## SpritePipeline adapter

Manifest input uses JSON-friendly camelCase. For `create` and `create-and-generate`, the adapter sends `POST /v1/jobs` with the Python model's exact snake_case fields:

```json
{
  "schema_version": 1,
  "character_id": "player_cyber",
  "action_id": "idle",
  "provider": "pixellab",
  "candidate_count": 1,
  "frame_count": 8,
  "action_description": "保持轮廓一致的待机动作",
  "loop": true,
  "request_key": "sprite-generator-20260904000000-abcd"
}
```

The local task ID becomes the idempotency key, preventing an ambiguous retry from silently creating a second chargeable job. `create-and-generate` then calls `POST /v1/jobs/{job_id}/generate`; `get`, `generate-existing`, and `export` map to their corresponding `/v1/jobs` endpoints. A running task stores the upstream job ID. Reading it through MCP/CLI or refreshing the web task list polls that existing ID once, then updates the same durable task. The normalized result contains `jobRecord`, `orderedFrames`, `spriteSheet`, `preview`, and `metadata`; reported frame/export paths are copies under `outputs/<task-id>/`, never upstream-private paths.

Set `SPRITE_PIPELINE_API_URL` only when the API is not available at the default `http://127.0.0.1:7860`. The full UI process already mounts the REST API at that address. `SPRITE_PIPELINE_API_TOKEN` is optional for a separately protected deployment.

## Map adapter: local compose

`operation: "compose"` accepts an ordered `images` array containing repository-relative paths or base64 `data:image` URLs. The adapter uses nearest-neighbor resizing and writes real task artifacts:

- `stitched-map.png`
- `seam-report.json`
- `region-annotations.json`
- `pixelwork-state.zip`
- optional `godot-package.zip`

File paths are resolved inside the repository, and every artifact stays inside `outputs/<task-id>/`. The Pixelwork ZIP can be reopened by the FrameRonin mode editor.

## Map adapter: external layer generation

`operation: "generate-layer"` is the same contract used by the map page and is limited to the overall image layer:

```json
{
  "image": "data:image/png;base64,...",
  "prompt": "the single overall-layer prompt",
  "provider": "nano-banana",
  "tile": { "key": "1,0", "x": 1, "y": 0, "w": 1, "h": 1 },
  "layer": "overall",
  "mask_mode": "white"
}
```

The provider definitions live in `workbench/manifest.json`:

- `nano-banana` maps to Google's stable Nano Banana 2 model, `gemini-3.1-flash-image`, through the Generate Content endpoint. The adapter sends the prompt and source PNG as `inline_data`, requests the `IMAGE` response modality, and decodes the returned `inlineData`.
- `gpt-image-2` maps to OpenAI's `gpt-image-2` Images Edits endpoint. The adapter sends a multipart `image[]` plus `model` and `prompt`, then decodes `data[0].b64_json`.

Every accepted result is normalized to `outputs/<task-id>/generated-layer.png`. Browser, MCP, and CLI runs share the same task ledger. Keys come from the Runtime Bridge's process-memory settings or `GEMINI_API_KEY` / `OPENAI_API_KEY`; they are never added to task input, adapter metadata, result files, or logs. If the selected key is absent, only `generate-layer` becomes `awaiting_configuration`; local compose and local derived-layer generation remain available.

## Interactable adapter: direct Godot export

`interactable-editor` accepts `operation: "export-godot"`, `project`, and optional `selectedDefinitionIds`. The authoritative editor defaults and detailed field constraints are in `features/interactable-editor/contract.mjs`; usage and a complete request example are in `docs/interactable-editor.md` and `examples/requests/interactable-export.json`.

The local adapter packages fixed GDScript runtime files, `.tres` definitions, editable `.tscn` object scenes, original image/audio bytes, installation instructions, and round-trip source data. It does not invoke Godot or contact copyWorms or another service. Basic serialization and file-read errors return normal task errors without adding an approval or validation phase.

The browser can upload each asset as raw bytes to `POST /api/workbench/interactable-assets`, proxied to `POST /v1/interactable-assets`. The `Content-Type` declares PNG/JPEG/WebP/WAV/OGG/MP3; each asset is limited to 64 MB. The response contains `source` (workspace-relative), `mime`, and `size`. `GET` on the same endpoint with `?path=...` previews supported local media. Task JSON carries those paths rather than large base64 uploads. CLI/MCP may also supply supported data URLs. All local asset paths must resolve inside this workspace.

Outputs are `interactables.zip`, portable `interactable-project.json`, and the shared runtime's `result.json`. Export is immediately `completed` when these files exist; no engine validation report is generated.

## Persistence and errors

Every authorized run creates `work/tasks/<task-id>.json`. Standardized adapter output is stored in `outputs/<task-id>/result.json`. Before a generated artifact path is recorded, the runtime verifies that it is a real file inside the task output directory. Non-2xx responses, invalid protocol bodies, timeouts, and local processing errors mark the task failed with a concise error. Transient refresh failures do not overwrite a previously running task. API keys are never written to task records.
