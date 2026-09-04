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
- optional `godot-package.zip` and `unity-package.zip`

File paths are resolved inside the repository, and every artifact stays inside `outputs/<task-id>/`. The Pixelwork ZIP can be reopened by the FrameRonin mode editor.

## Map adapter: external layer generation

`operation: "generate-layer"` is the same contract used by the map page. The server removes `operation` and forwards exactly these fields to `MAP_STITCHER_API_URL`:

```json
{
  "image": "data:image/png;base64,...",
  "prompt": "保持原图像素风并向右扩展",
  "tile": { "key": "1,0", "x": 1, "y": 0, "w": 1, "h": 1 },
  "layer": "overall",
  "mask_mode": "white"
}
```

The service may return `image`, `data`, or `url`, either at the top level or under `result`. URL results must be HTTP(S), contain no embedded credentials, remain on the configured connector origin, and are downloaded without redirects using size and image-type checks. Every accepted result is decoded and normalized to `outputs/<task-id>/generated-layer.png`; a URL alone is never treated as a completed artifact. The browser page submits this operation through the same runtime task API, so browser, MCP, and CLI runs share one task ledger. If `MAP_STITCHER_API_URL` is absent, only this operation becomes `awaiting_configuration`; local compose remains available.

## Persistence and errors

Every authorized run creates `work/tasks/<task-id>.json`. Standardized adapter output is stored in `outputs/<task-id>/result.json`. Before a generated artifact path is recorded, the runtime verifies that it is a real file inside the task output directory. Non-2xx responses, invalid protocol bodies, timeouts, and local processing errors mark the task failed with a concise error. Transient refresh failures do not overwrite a previously running task. Tokens and connector URLs are never written to task records.
