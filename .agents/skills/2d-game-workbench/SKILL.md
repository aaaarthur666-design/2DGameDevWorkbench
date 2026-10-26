---
name: 2d-game-workbench
description: Drive Forge asset production, Image 2.5 backgrounds and transparent props, sprite animations, shared scene/interactable editing, versioned visual observation and Godot exports. Legacy map stitching and expansion remain manual; use forge-game-engineering for game architecture and scripts.
---

# Forge asset production

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
4. Call `workbench_prepare_task` when the user explicitly requests input validation. Discussion and planning do not create records; resolve unapproved external execution before run.
5. Call `workbench_run_task` only when execution is authorized.
6. Read or refresh the returned task with `workbench_get_task`. Keep exact IDs, status and verified output paths as technical evidence; lead the user-facing reply with the outcome, exact artwork link and one useful next step.

## CLI fallback

1. Run `npm run workbench -- list --json` to discover available capabilities. Do not infer an unregistered capability.
2. Run `npm run workbench -- describe <capability-id> --json` and shape the request to its declared input schema.
3. Keep user source files in place. Pass repository-relative paths when possible and never overwrite source assets.
4. Run `npm run workbench -- prepare <capability-id> --input <json-file>` first when the user explicitly requests input validation. Discussion and planning do not create records; resolve unapproved external execution before run.
5. When execution is authorized, run `npm run workbench -- run <capability-id> --input <json-file>`; local-only operations do not require an external URL.
6. Use `npm run workbench -- status <task-id> --json` for follow-up. Keep exact IDs, status and verified output paths as technical evidence; lead the user-facing reply with the outcome, exact artwork link and one useful next step.

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
- A task is complete only when its task record says `completed` and every reported output path exists. Check/save completion is not artwork approval or export; inspect the actual candidate state. `attention_required` needs review or recovery, not blind resubmission.

## Capability selection

Open-motion v4 draws only segment-local transitions; full motion/appearance contracts remain available for review. `target-motion-stage` binds an inspected same-size PNG before generation (`targetImageBase64`, stage, current revision, reviewNote); no model call occurs. Exact target hashes freeze at execution; do not hard-replace output endpoints. `repair-motion-stage` requires the current stage token, internal zero-based inclusive window, mode, defect note and generationAuthorized=true within the existing budget. At 128px an appearance repair edits two frames plus two context images; transition repair uses 4–16 internal even frames. `get-motion-stage` exposes original frames and repairPreviews. Play the whole preview and inspect both seams before `review-motion-repair` with its attempt/token and concrete note. Adoption triggers fresh segment review and still needs stage acceptance. Unknown results never resubmit; rejected/failed attempts and outside bytes remain preserved. Do not change a locked anchor whose later segment has executed. Pixel-change cues and a model pass do not establish force, continuity or final acceptance.

Open-motion v3 requires explicit segment review. On `pendingCheckpoints`, call `get-motion-stage` with the exact candidate and zero-based stage; inspect all returned actual PNGs and motion order, including the final pose and timing. Use `review-motion-stage` with its token, current revision, accept/reject decision and concrete reviewNote. Model pass alone is insufficient; unresolved reports require evaluated acknowledgement. Accepted real frames are frozen and their last PNG conditions the next segment. Resume cannot bypass review; rejection stops later work without deleting frames or automatically rerolling. Budget each candidate for `2 * stage_count + 2` visual calls. Final whole-clip playback and adoption remain separate. Old plans retain their original behavior; never retrofit checks by mutating saved task snapshots.

If actual motion reaches the intended checkpoint before an overshooting tail, explicitly choose `anchorFrame` (zero-based within the returned playable segment) and `acknowledgeTrim=true` with the reason. Review the entire source first. Accepted playback keeps the prefix ending at that real frame; excluded tail bytes remain untouched and mapped. This is an explicit review decision, never an automatic model edit. Omit anchorFrame to keep all frames. Final clip review uses the accepted timeline, not planned indices as hard timing guarantees.

New quality plans include task-specific key poses with approximate timing, not per-action code or exact pixel guarantees. Provider prompts are compiled and frozen at execution start. Kimi's token limit includes reasoning plus final JSON; output truncation and network timeout remain recorded failures, never silent retries. Use the model configuration snapshot and actual receipts when comparing trials; report additional human feedback separately from an unchanged original prompt.

TokenHub GLM 5.3 Flash (`glm-5.3-flash`) supports the image-based expert/reviewer roles and shares the same protected TokenHub key with Kimi. Do not substitute the text-only `glm-5.3` model. GLM Flash uses `max_tokens` and auto/low/high/max reasoning. Read saved role assignments rather than assuming HY Vision; changing settings never relabels historical reviews or authorizes replaying their paid calls.

- For a new free-form character motion, prefer `sprite-generator` `plan-motion` with `motionSpec` from the discovered manifest. A character preset is needed; an action preset is not. Keep the user's original motion and final pose, candidate count and authorized planning/generation limits. `planningAuthorized=true` requires actual authorization for billed planning. The bounded backend experts may inspect crops and consult one another; no new per-action code is needed. Read [open motion](../../../docs/sprite-generator.md).
- Follow the exact `?work=<openWorkId>` link. Resolve questions before `generate-motion`, which binds revision/hash. Quality contracts cover events, equipment, ending and rhythm without action-specific rules; natural settling differs from exact return-to-reference. In `max_review_calls`, v3 counts segment checks plus two final calls per candidate; v2 keeps its two-call final review. Observe actual frames before auditing; failed/unknown/stale reports are not passes. Human adoption requires a note and evaluated warning acknowledgement. No automatic regeneration or approval. Old v1/v2 plans and frozen model profiles retain their original behavior. Preserve raw frames; omit only verified extra input context with a saved mapping.
- A disabled frontend adoption button explains its unmet condition in the footer: playback confirmation, a review note of at least four characters, warning acknowledgement, or unresolved checks/repairs. Do not bypass that gate to troubleshoot navigation. The embedded frame editor's return link preserves the open work, revision and candidate; save edits before returning and inspect the saved result again.

- Use `reference-art` `generate` with `subject=prop` for a single isolated PixelLab item (128x128 transparent side-view PNG, prompt up to 1800 characters). Poll the same task, inspect the image and use the exact `artTask` editor link. Inventory uses `kind=prop`. The image is not an interactive object or a character preset; never transfer it. For a requested complete object, bind the returned PNG path/data and `generation: {sourceTaskId, sha256}` metadata into the selected existing project's assets, preserve project/definition IDs, set the selected default visual, and save/export through interactable-editor. Do not silently replace state-specific art. Read [item art](../../../docs/prop-art.md).

- Use `reference-art` `generate` for PixelLab character images (64x64 or 128x128 transparent PNG, default 128; prompt and optional name/facing/seed/size). It shares the SpritePipeline protected key. Use `transfer` with the completed source task ID to import a reusable character; this never generates animation. Poll with get/status and never resubmit to recover an ambiguous paid POST.

- Use `sprite-generator` for SpritePipeline `create`, `create-and-generate`, `generate-existing`, `get`, `export`, `check`, `safety`, `review-frame`, `approve`, `reject`, `recover`, and `attach-provider-job`. Use declared preset IDs; do not derive IDs from free text.
- Map original-image generation, stitching and extension are manual frontend workflows. MCP excludes map-stitcher; direct the user to /tools/map-stitcher. Do not bypass this boundary through CLI, HTTP or browser tools.
- Use `interactable-editor` `save-project` for complete editable source and `export-godot` for inspect, toggle, pickup, and sequence objects. Export is local and does not require credentials, SpritePipeline, a Godot installation, or a mandatory validation step.
- Scene composition remains an `editorModules` entry and also supports shared document tools. Use typed commands and saved-version observation; do not fabricate a scene generation capability. It consumes explicitly adopted backgrounds, existing maps and interactables.
- For copyWorms compatibility, use the declared `copyworms` target profile. Export success means files were created, not that the target game passed engine regression tests.
- When a request spans capabilities, run separate tasks as authorized, then summarize their outputs together.

## Existing-image editing (7A–7D)

For an existing saved image, use the registered workbench_inspect_image_target → workbench_resolve_image_region → workbench_edit_image_region → workbench_apply_image_candidate tools; workbench_get_image_edit reads the same session, candidates and task identities. Discover the exact target and read [local image editing](../../../docs/image-editing.md) before editing. This path supports local operations without a model key or Python service. Inspection/resolution does not create a generation task, and completing a candidate does not adopt it. It does not open legacy map production, stitching or expansion.

All image-* calls, including refresh reads, forward to the canonical Bridge. If it is unavailable, report that failure; do not write session/target files from the client. One Bridge is authoritative for a data directory. Preserve target revision and file hash, expected session revision and explicit candidate parent. Reuse commandId for the identical request; a crash or unknown submission requires inspecting the original session/task, not another submission. Original PNG/JPEG/WebP sha256 and decoded sRGB/RGBA8 straight-alpha rgbaSha256 are different guards. Canvas previews and editable masks are not source pixels.

7B implements the shared local workspace for one saved map image, an interactable's default static image, and independent image-task variants; actual UI adoption acceptance is recorded separately. Map/interactable hosts flush durable saves before opening, suspend cross-editing/navigation, and read the exact adopted server version to update their local save baseline. A conflict preserves the draft; a server adoption followed by a failed UI refresh is not permission to submit another command. Inspect the original session and retry the same request.

The workspace's source view is its frozen session source; candidate view may include unsaved strokes. Save strokes as a server candidate before adoption. Browser pixel drafts are delayed, bounded IndexedDB recovery copies, not shared candidates or cross-browser backups. After adoption, create a new session from the current target to continue editing. Old sessions remain explicit history/restore sources. restore-region samples within the same source-version session; applying candidateVersion=source restores that session's original pixels as a new single-image version, under current target guards and a known binding. Preserve other images, geometry, behavior and unrelated visual parameters; default static-image adoption still clears idle/focus animation selection. Never restore the whole document to undo one image.

7C supports explicitly authorized ai-edit through the same workflow. AI add/subtract brushes change only a hard editable mask, encoded as sorted disjoint mask-runs; local brushes change RGBA. Verify the visible selection, which may initially cover the whole image. Freeze the selected base candidate, region, prompt and reference bytes; only explicit submission calls GPT Image 2.5. Preserve the original commandId after interruption, query its task/session and never resubmit because of refresh, restart or unknown status. Protected sRGB/RGBA8 pixels are restored locally and verified after encoding; preserveAlpha=true copies all Alpha bytes from the selected edit base locally, disables alpha cleanup and verifies the delivered PNG. The UI defaults this option on; API callers must request it explicitly. Continuous editing preserves the selected base Alpha, not necessarily the session-original Alpha. Preserve this option in the frozen command payload and verify alphaPreservation evidence. Inspect silhouette, seams and fit inside the edited region. Saved previews switch directly to verified image bytes on restore. New sessions and candidate selections update imageEdit/imageCandidate in the URL while retaining host document parameters. Use the supplied deep link or present(editId,candidateVersion) for the exact candidate; history with invalid current guards is read-only, not authority to rebind. 7D supports exact static state slots and scene references. A scene-instance target derives a material and rebinds only that instance; other instances sharing its old material remain unchanged. A scene-layer target is writable only after verifying a single-source identity mapping against the embedded Forge or Pixelwork v2 ZIP for every scene map layer, including hidden layers and layers excluded from export. Both the selected scene-layer lock and source image-type lock apply. Missing, damaged or inconsistent source packages remain read-only; a source-editor entry does not repair a missing package. The displayed PNG and embedded ZIP commit together. Derived, multi-tile, feathered or unmapped layers remain read-only with a source-editor entry. Do not silently replace upstream projects or other instances. Do not fall back to a paid operation after local failure. Record model-call counts and UI/engine evidence per dated run; mock, pixel-preservation and UI evidence do not prove fresh model quality or Godot acceptance.

## Read only what the task needs

- Overall architecture and state boundaries: `docs/architecture.md`.
- Reference images, shared credentials and handoff: `docs/reference-art.md`.
- Sprite operations and asynchronous behavior: `docs/sprite-generator.md`.
- Map composition, external generation, state, and export: `docs/map-stitcher.md`.
- Interactable schema, assets, profiles, and Godot handoff: `docs/interactable-editor.md`.
- Protocol and troubleshooting: `docs/connector-contract.md` and `docs/agent-clients.md`.

- First-stage MCP acceptance and manual prompts: `docs/agent-phase1-acceptance.md`.
- Full human procedures, backup and troubleshooting: `docs/operations-manual.md`.

## Interactable authoring

Use workbench_interactable_template for a complete inspect/toggle/pickup/sequence project without creating a task. Fill in the requested behavior and supplied assets, preserving projectId and definitionId. Run save-project to persist a portable source project without exporting. get_result.viewPath opens this task in the frontend editor; differing local drafts are retained separately. Resume by reading the existing source artifact, editing it and saving again. Use export-godot only for a requested package. A saved logic draft is not an exported asset or generated artwork.

## Present work in WorkBuddy

Use [execution-stage preview following](../../../docs/agent-preview-follow.md): call workbench_present before execution to arm this MCP connection, then run/get_task publish their current step automatically. After reading a different existing artwork or candidate, explicitly present its exact identity. Check requestId with workbench_get_frontend_context; never claim pending as displayed. Pause/busy/save failures keep the current page; do not use host navigation to override them. Repeated polls do not reload the page. Current-page summaries identify browser work but do not expose draft pixels or full map state.

Follow the shared conversation guide's presentation section. Prefer `presentation.summary`, `viewUrl` and `actions`; retain the full structured result for reasoning rather than pasting it into chat. Query a native animation with `get_result(jobId, candidateIndex?)` and a workbench record with `get_result(taskId, candidateIndex?)`; exactly one identifier is required. Neither lookup creates a task or starts generation. Text-only clients can request `detail:true` to read complete artifacts and review evidence; keep those details out of routine user replies.

On the first WorkBuddy conversation preview, select the known artwork with workbench_present and open preview.hostAction.arguments unchanged, including previewSession. Use only a discovered host tool with its real schema. Later reuse the existing preview if supported and editing is safely saved, otherwise provide the exact link. Never reopen after dismissal or on reconnection without the user's request. Tool URLs and `browserOpened:false` are not evidence that a browser opened. Ask only the material unresolved choice through the available host question tool; no answer or cancellation means no selection.

Default reply: concise outcome, actual preview/link, one next step. Expand technical detail when requested or needed. Show animation in its player; a GIF first-frame image is insufficient motion evidence. Saved, review-ready, approved and exported remain distinct states.

## Inventory and handoff

Use `workbench_list_assets` for existing artwork, and list_tasks for execution history. Read [the asset catalog guide](../../../docs/asset-catalog.md) when inventorying or handing off assets. Follow nextOffset with snapshot until the requested scope is covered. Filter structured fields rather than searching an entire natural-language sentence: “latest three-candidate animation, candidate 2” means kind=animation, candidateCount=3, candidateIndex=2, sortBy=createdAt, limit=1.

Use get_asset for the exact assetId before making a handoff; preserve source relationships and file hashes. One animation candidate is one asset; retries/checks/exports are not extra artworks. Use get_asset_manifest with explicit selected assetIds for a portable inventory. Save returned data only where the user requested; this tool does not copy materials or change a game project. Missing files, pending review, source-only interactables and engine validation remain separate facts.

Coverage only includes persisted server assets. Do not claim browser-only maps, scenes, drafts or external project folders were inspected. Offline/partial coverage is not proof of deletion. Refer users to the existing editor for those drafts; map creation remains manual. Present useful category totals, preview links and unresolved issues without pasting the full file list into ordinary chat.

## Deliver actual export files

Completed scene exports are indexed as kind=scene, with a distinct asset per exportId and the saved sceneId/revision. Shared-document export also records documentId/contentHash. Download provides the original scene-source.zip and scene-godot.zip; import the source ZIP in the scene editor to continue. Reads do not export again or index browser drafts. Archived execution history never hides assets. Asset details retain original creation time and source history; list_tasks supports offset/snapshot pagination over all unarchived records, following nextOffset until null.

Prefer an existing verified export. Current approved SpritePipeline export supplies PNG/sheet, preview, recipe/QA and a Godot ZIP via `godotPackage`; old records may omit the optional ZIP. Read `docs/sprite-generator.md` for the package contract. Do not regenerate, approve or re-export just because the user browsed or downloaded an older asset.

The SpriteFrames pack preserves exact selected frame order/regions, action alias, FPS and loop. Copy its `forge_sprites` tree intact; it supplies a single action and optional visual scene, not a game controller. Updating an existing multi-action character requires a clip merge through the engineering Skill. Asset-library download copies real bytes into ZIP; `get_asset_manifest` is a descriptive handoff and never substitutes for those files. Export success alone is not target-engine validation.

## Diagnose configuration accurately

Check API compatibility and UI readiness separately; `sprite-pipeline:api` does not serve the embedded UI. PixelLab Key is shared and persists in protected SpritePipeline settings; map keys also persist in protected local configuration, with server environment as an alternative. Dedicated settings return configured state, never key values. Startup tools do not install dependencies or restart occupied/incompatible services. Read `docs/operations-manual.md` before maintaining or restarting a service, and retain the user's data directory and in-flight work.

## Export directly to the selected game

Read [Godot delivery](../../../docs/godot-delivery.md) when exporting ready assets to an existing game. The frontend remembers the chosen project and writes an immutable delivery; export_to_game does the same for an exact saved assetId/revision. Only an existing Godot package can be delivered: no generation, implicit approval or replacement candidate. Legacy map stitching and expansion remain manual; shared scene editing uses its declared document tools.

When continuing an authorized game task, list_game_exports then get_game_export finds the package and target without asking the user to locate files. Switch to the engineering Skill for install_game_export and actual code integration. Do not stop at copied resources or ask the user to delete project.godot, repair res paths or mount nodes. Preserve existing controllers, custom changes and other clips. The host Agent is not automatically awakened by a browser export; pending, assets installed, integrated and engine-verified are different outcomes.

## Continue into a game project

When the user wants architecture, Godot scripts or integration of ready assets, read the Skill at `agentAssets.engineering.skill` in the manifest. This is an external Agent workflow grounded in CopyWorms, not a new production operation. Keep the exact asset selections and their readiness evidence. Map production remains manual; the engineering Skill consumes exported scenes/maps. Preserve a planning-only request and the distinction between the read-only reference game and the authorized target project.

## Internal frontend reuse

See [internal imports](../../../docs/internal-imports.md) for asset-library source selection, map/object/scene handoff and editing existing materials. These imports read existing assets without generation; shared scene commands are also available. Static props are appearance only; preserve behavior, project/object identity, source hashes and exact animation candidate/FPS/loop. Changes in an editor require explicit replacement in an existing scene. Older prop metadata can omit subject only when the original task explicitly says prop and content checks pass.

## Image 2.5 Route A and shared documents

For authorized real quality/cost evaluations, predefine the sample and call limit, retain every outcome and never retry to select a better-looking result. New image-assets results expose usageEvidence with whitelisted numeric usage, returned quality and timing; absent usage is unknown, not free. Default auto quality can select different tiers. Separate observed tokens, dated rate estimates and actual billed amounts. Review full and gameplay-scale images plus alpha on contrasting backgrounds. Test masked edits for both semantic identity and non-target pixel changes; the provider's mask guidance alone does not promise exact pixel preservation. Do not reconstruct historical usage that was never captured.

The model's raw response remains unchanged, but new masked edit-image deliveries use deterministic local protection: only mask alpha=0 accepts candidate pixels; alpha=1–255 copies decoded source sRGB/RGBA8 exactly, including hidden RGB, with no resizing. Check processingEvidence and review the edited region/seams separately. For existing candidates use discovered process-image with image and optional paired preserveFrom/mask; it requires no prompt, provider, Key or model call. alphaCleanupThreshold defaults to1 for props and0 for backgrounds; only low positive alpha is zeroed, within the editable region when masked. Clean an entire source as a separate version before masked edits if needed; never change protected pixels for cleanup. Keep rawImage/rawSha256 separate from image/sha256, and adopt the new task/hash, never relabel a derivative with the original hash. Preserve accepted scenes unless adoption is requested.

Discover `image-assets` before generating backgrounds, transparent props or editing existing images. It uses `gpt-image-2.5-sunburst`; input image, reference images and edit mask have separate fields. Preserve existing PixelLab workflows and source files. No Qwen layering is implemented. Poll the same task; an interrupted/uncertain submission must not be retried as a new paid call automatically. Inspect actual image output before claiming visual quality; valid dimensions/alpha are not quality review.

Use `workbench_list_documents` / `workbench_get_document` for saved scene/interactable state. Create a shared document only when authoring is requested. Read its stable IDs/revision, then apply typed commands with `expectedRevision` and `commandId`. Repeating the same request uses the same commandId; changing the request uses a new one. Conflicts require re-reading; never overwrite dirty browser drafts. Historical restore creates a new current version. The Bridge is the single writer; use MCP/CLI document operations instead of editing storage files.

Adopt completed image-assets output with `workbench_adopt_document_image`, exact sourceTaskId and sha256. A background becomes a scene map layer without inferred collision. Prop adoption requires the existing definitionId, preserves identity/behavior/state art and clears default idle/focus animation selection. Scene material imports/replacements pin existing sources; changes are explicit, not automatic upstream synchronization.

After edits, `workbench_observe_document` renders the saved scene revision as actual images with contentHash, worldToImage, object bounds and optional overlays. Inspect the returned images; UI arrival and JSON are not visual evidence. Missing media fails. `workbench_validate_document` and `workbench_simulate_document` check structure and bounded existing interaction events; they do not prove physics or reachability. `workbench_export_document` exports the requested exact scene revision through the existing source/Godot exporter. Report saved, observed, simulated, exported and actual engine-tested evidence separately. Read [scene composition](../../../docs/scene-composer.md) for supported commands and limitations.

Shared scene `links` support typed event-to-instance wiring: set_toggle, set_enabled and set_visible with boolean or source_toggle values. Use set-links/add-link/update-link/remove-links commands after reading stable instance IDs. Reject invalid endpoints/kinds and enabled cycles; disabled links retain configuration. Copying instances does not clone wiring; removing an instance prunes its links. Inspect state-specific visibility AND solidEnabled before claiming a gate opens. Hiding a visual alone does not disable collision. Use simulate expectEvents/expectStates, then observe the same revision and events to inspect the resulting images. events and static time are mutually exclusive; replay time advances through tick. A successful simulation without expectations is not behavior acceptance. See the scene guide for limits and exact engine evidence.

Project selection uses the in-page folder browser or an explicit typed path. Browsing is read-only and cancellable; it must not start an OS dialog or lock the export window. Selecting a folder alone does not create a delivery or authorize generation.

Current Forge export and engine verification baseline: Godot 4.7.x. Use GODOT_47_BIN for engine tests. Read the actual executable version before running; historical 4.6.x reports and previously exported assets remain provenance, not current validation.

For coarse pixel characters, choose size=64 at generation, inspect actual gameplay-scale appearance, then transfer the original bytes. transfer may include identityDescription (up to 300 characters) with appearance only; do not copy standing-pose instructions into motion generation. Long source prompts use the reference-image identity lock by default. Full original prompts stay in source tasks.

Map assets include complete saved projects (mapType=project) and durable image/history assets (mapType=image); kind=map without mapType returns both. Preserve legacy asset IDs and exact source files. Resume a project through its exact editorPath; map-source.zip is editable source and can be imported into the map editor or scene composer, not used as a prop image or claimed as an existing Godot export. Project thumbnails remain display attachments. Browser-only legacy drafts require a manual open/save before server indexing; never bypass the manual-map boundary.

Map project thumbnails are optional, version-bound display attachments rendered locally by the manual editor. They are not separate map assets or engine exports. Missing previews do not imply missing source; legacy projects gain a thumbnail on the next manual open/save. Asset reads never render or generate a thumbnail.

## Recoverable asset recycle bin

Asset listing defaults to `scope=active`; use `scope=trashed` to inspect the recoverable recycle bin. Exact details expose `trashedAt`. The frontend confirms explicit selections before trash/restore; source files, original tool content, task history and existing scene references remain intact. This organizes the catalog and does not free disk space. A source being offline does not mean deletion; restoring a catalog entry does not repair missing files. Do not clean existing assets merely because the user requested implementation of the feature.

## WorkBuddy session preview

WorkBuddy MCP 0.11: use the returned preview.hostAction (including its previewSession URL) with the discovered host-native present_files schema. A visible page from this MCP session is required before the first run_task; preview_required means createsTask=false and providerCalled=false, so open/confirm the preview before resubmitting the same request. Once connected, run_task automatically arms following. Existing-task and candidate selections can still use workbench_present. Paused/blocked pages are never forced. When the user declined or closed the preview in this conversation, or the host tool was verified unavailable, pass the matching previewPolicy (user-declined/user-dismissed/host-unavailable) and report the reason; never silently bypass the gate. Explicitly requested reopening can use previewPolicy=auto. Other MCP clients stay headless unless explicitly presenting. The server cannot open WorkBuddy UI itself; page acknowledgement, not a returned URL, proves arrival.

## Sprite delivery from the native export step

In the embedded sprite workspace, a successful PNG + Godot export opens the shared game-project delivery dialog; the saved-export button can reopen it. The bridge carries the exact job and candidate, and mismatched saved packages are rejected. Copy the animation-specific WorkBuddy handoff after delivery: merge only this clip into the existing SpriteFrames/controller and preserve other actions, facing, scale, offsets and gameplay timing. Export/clipboard success is not Agent execution or engine acceptance. Standalone SpritePipeline retains ZIP downloads.

An approved/exported animation returns to export without another approval or generation. Library export and review return recover the exact candidate’s saved PNG/Godot files. Legacy PNG-only exports suggest a new filename for a complete package, preserving the old bundle; normal QA gates still govern rebuilding. Do not treat missing historical vision evidence as proof the user edited a frame.

Local reference import: reference-art operation=import copies a repository-contained 64/128 transparent PNG (sourceImagePath) and records import provenance; prompt is a description added at import, not evidence of an API generation. It needs no model or PixelLab service. Imported characters appear in reference history and may be transferred through the normal hash-checked flow; transfer still needs the local SpritePipeline service.
