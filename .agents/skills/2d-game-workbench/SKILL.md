---
name: 2d-game-workbench
description: Create, edit, inspect and deliver Forge artwork, animations, interactables and scenes through the project tools. Use forge-game-engineering for Godot project code and asset integration.
---

# Forge asset production

Complete the user's requested asset workflow using the shared workbench runtime. Choose the relevant topic below; other topics can stay unloaded. [Conversation guidance](../../../workbench/conversation-guide.md) covers ambiguous requests and delegated choices.

## Choose an entry

| Task | Route | Read when needed / MCP guidance topic |
| --- | --- | --- |
| Character image or existing PNG import | reference-art generate / import, then transfer when an animation reference is needed | [Reference art](../../../docs/reference-art.md) · reference-art |
| New or continuing animation | sprite-generator plan-motion and its saved work/checkpoints | [Motion workflow](../../../workbench/guides/motion.md) · motion |
| Change selected animation frames | get-motion-adjustment → create-motion-adjustment → inspect → review-motion-adjustment | [Alternatives](../../../docs/motion-adjustments.md) · adjustments |
| Background, transparent prop or whole-image generation | image-assets; PixelLab props can use reference-art subject=prop | [Image assets](../../../docs/prop-art.md) · image-generation |
| Local or AI changes to an existing saved image | inspect_image_target → resolve_image_region → edit_image_region → inspect → apply_image_candidate | [Image editing](../../../docs/image-editing.md) · image-editing |
| Interactable behavior or shared scene | template / saved document → typed commands → inspect → requested save/export | [Interactables](../../../docs/interactable-editor.md) / [Scenes](../../../docs/scene-composer.md) · interactables / scenes |
| Existing artwork, downloads or handoff | list_assets → exact get_asset/get_result; list_tasks for execution history | [Asset catalog](../../../docs/asset-catalog.md) · assets |
| Scene production with expert planning, new artwork or automatic map creation/extension | create_scene_workflow → inspect candidate/review → adopt within the agreed scope and budgets | [Scene collaboration](../../../docs/scene-collaboration.md) · scene-collaboration |
| Map canvas, region editing or manual stitching | Current editor; use host browser tools when the user requests webpage operation | [Map editor](../../../docs/map-stitcher.md) · maps |
| Delivery to a game | Exact existing export and selected project, then the engineering Skill | [Delivery](../../../docs/godot-delivery.md) · delivery |

The server exposes workbench_get_guidance({topic}) for these documents, including clients without repository file access. Tool names in the table are abbreviated; discover their current names and schema before using an unfamiliar operation.

## Execute the selected workflow

Prefer the project's MCP tools. Reuse discovered schemas during the session; refresh them when the service version or operation changes. If MCP is unavailable, the equivalent repository CLI is available:

| MCP | CLI from the repository root |
| --- | --- |
| list_capabilities / describe_capability | npm run workbench -- list / describe <capability-id> --json |
| run_task / get_task | npm run workbench -- run <capability-id> --input <json-file> / status <task-id> --json |
| get_guidance and other shared operations | npm run workbench -- agent guidance --input <json-file> --json; other operations use their discovered names |

Resolve real character, asset and task identities from context or discovery. Check environment readiness only for services the task needs; start an installed offline service when appropriate. A conflicting service calls for diagnosis rather than repeated startup.

Use the user's existing authorization throughout the agreed workflow. Routine parameters and internal IDs are implementation choices. prepare_task optionally validates and saves a preparation record for authorized work; read-only discussion needs no production record. The selected capability schema determines which operations the MCP/CLI supports. Direct map-stitcher adapter operations remain outside that surface; bounded automatic map creation/extension is available through scene-workflow tools. Read the collaboration guide and freeze the map policy, production providers and quotas before creation. Explicit webpage work and authorized feature development remain available.

## Preserve the work's identity

- Poll the original task/job. For unknown paid submissions, inspect its saved receipt and provider ID before taking another action. Recovery should find the existing request; a new paid attempt needs to fit the agreed scope and budget.
- Shared document and image writes use the canonical Bridge, current revision/hash and stable commandId. Reuse an ID for the same request; re-read conflicts. Direct edits to storage would bypass concurrent users and recovery.
- Bind edits and adoption to the selected source, candidate and allowed range. Keep source history and unrelated changes. Candidate creation and adoption are separate operations; perform both when the user's requested outcome includes adoption.
- The user or delegated main Agent evaluates actual output. Inspect animation sequences at their FPS, not just a GIF first frame. Record observed reasons and assessed warnings; technical hard errors remain blocking. [Visual criteria](../../../workbench/experts/2d-production-expert.md) supplies review guidance.
- Treat task completion, artwork adoption, export and target-engine validation as distinct evidence. Report the result the user requested and the checks actually performed.

## Show and deliver

Use returned exact asset/work/candidate links. Follow the [presentation guide](../../../docs/agent-preview-follow.md) (topic presentation): On the first user message, WorkBuddy checks the environment and opens this session preview; production checks for its visible page; preview_required means no task or provider call was created. Use previewPolicy exceptions only for an explicit user refusal/dismissal or verified host-tool failure. Other clients remain headless unless they present. Reuse the existing page and preserve paused/closed/unsaved state.

Download existing files when delivering assets; a descriptive manifest does not contain textures. For game code or integration continue with [forge-game-engineering](../forge-game-engineering/SKILL.md). For service or configuration failures, read the relevant section of the [operations manual](../../../docs/operations-manual.md).
