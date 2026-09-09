---
name: forge-game-engineering
description: Design and implement Godot 4.7 game projects from ready Forge assets using the CopyWorms project's actual contracts. Use for SpritePipeline frame imports and action playback, exported map instantiation, asset organization, and project-specific GDScript reuse.
---

# Forge game engineering

The external Agent writes the game code. Forge remains the production, editing and preview workbench. Follow the requested planning or implementation scope; discussing architecture does not authorize editing a game or generating more art.

## Establish the project contract

Identify the target game directory and the reference CopyWorms checkout separately. Locate `project.godot`, the current architecture report, instructions, scenes, configs and affected scripts. Keep the reference checkout read-only unless it is explicitly the requested edit target. The source URL and verified baseline are in [CopyWorms contracts and reuse](references/copyworms.md); do not hard-code a user's drive path or assume the old report matches newer code. Use `scripts/inspect_source.py ROOT` to inventory the relevant files and current hashes without starting Godot. If only documentation is available, design from that evidence and identify unverified code rather than claiming a tested transplant.

Use the project's working architecture as the starting point: formal bases and config resources, scene/UI Builders, explicit global contracts and level lifecycle. Do not replace it with a generic game framework. Inspect dependencies before choosing what to retain, adapt or omit. Read [CopyWorms contracts and reuse](references/copyworms.md) for architecture and code work.

## Bring in ready assets

When presenting selected Forge assets in WorkBuddy, use workbench_present with the exact asset/task/candidate and check workbench_get_frontend_context. Follow [the preview protocol](../../../docs/agent-preview-follow.md); reuse the existing page and respect paused/unsaved editors. Page identity is not access to map draft contents. Code work in an external Godot project has no Forge task/page automatically; show its actual files or engine result without inventing a workbench production record.

Read the production Skill through `agentAssets.skill` in `workbench/manifest.json` when MCP asset discovery is needed. `list_assets` → exact `get_asset` / `get_result` supplies provenance, selected candidate, ordered frames, status and actual files. `get_asset_manifest` describes selections; it does not itself supply textures. Never re-run generation just to obtain old outputs. Read files before claiming readiness and retain source hashes in the handoff.

- **Characters:** read [frames and actions](references/frames.md). Prefer the existing verified SpritePipeline Godot ZIP when available; keep its namespace and selected action. For older exports or explicit resource staging, `stage_assets.py sprite` builds real PNG / AtlasTexture / SpriteFrames resources from explicitly ordered files or regions. It also supplies an optional visual adapter for a new actor. Existing CopyWorms actors keep their controllers and `Sprite` node contract. For partial animation updates, merge clips into a copy of the original SpriteFrames using `assets/sprite_frames_merge.gd`; preserve unselected actions.
- **Maps:** read [map integration](references/maps.md). Identify the export format before importing. `stage_assets.py map` handles current Frame Ronin Godot exports only; legacy Pixelwork and assembled scenes have different dependencies. Use the included `map_mount.gd` as a small Builder helper, preserving exported collision coordinates and runtime behavior.
- **Item images:** `kind=prop` / `reference-art` with `subject=prop` is a static transparent PNG, not a SpriteFrames clip or interactive scene. Preserve its generation source/hash when binding it to an interactable. Prefer a saved/exported interactable package for game integration; do not regenerate art or invent pickup logic merely because a prop image exists.
- **Interactables:** reuse the current workbench exporter/runtime and its declared CopyWorms profile. Preserve definition/instance IDs and the shared runtime. Do not invent another interaction engine.
- **Complete scenes:** select an existing kind=scene asset by exportId and sceneRevision. Download its saved scene-godot.zip and scene-source.zip without regenerating. Preserve scenes/<scene-id> paths and the shared interaction runtime; do not treat it as a Frame Ronin map pack or a complete game. Browser-only drafts are not indexed, and archiving execution history does not remove the selected asset.

The scripts require Python 3.10+ standard library only. Run them with an available interpreter, such as this workbench's SpritePipeline venv. They stage into a **new output directory**, never merge into or overwrite a game. The Agent then inspects the staged result and implements the user's authorized target-project changes. Namespacing and missing dependencies remain explicit. These scripts do not call a provider, create workbench tasks or require API keys.

Map creation, stitching and extension remain manual frontend work. This Skill consumes already exported map files; it does not expose or bypass map production through MCP, CLI, HTTP or browser automation.

## Complete an export delivered to a game

For the user's export-to-project workflow, read [Godot delivery](../../../docs/godot-delivery.md). Query pending deliveries, inspect the exact selected package and target, then use install_game_export for verified placement. The target project's actual instructions, Builder and controller code decide mounting, animation merge and signal wiring. Complete those edits with host file tools instead of giving the user extraction, res-path or node-mounting chores. Routine choices do not need repeated confirmation once integration is authorized. Never infer authorization to rewrite gameplay or integrate another game's pending package.

Keep original inboxes/backups, preserve custom file conflicts and other clips, and use only the existing shared interaction runtime. New maps are already namespaced; stage_assets.py remains useful for legacy/manual staging. After implementing and verifying the slice, record actual files and distinct engine evidence through complete_game_export. The webpage cannot wake a stopped Agent, and file installation is not gameplay completion.

## Implement and verify the requested slice

For project creation, establish the requested playable slice and target directory; if missing, inspect available materials while asking only for those consequential choices. For an existing project, preserve the working scene paths, autoload ownership and gameplay timings. Resolve routine resource names and file placement yourself from the actual project. Do not import story, balance constants, unused managers or every CopyWorms module by default.

Produce a short source-to-target map: chosen assets and animation aliases, reused/adapted scripts and dependencies, scene ownership, state/event/config contracts, and unresolved inputs. Scale it to the task; do not manufacture paperwork for a one-clip replacement. Keep authored controller scripts outside generated resource folders so re-export cannot erase them.

Verify with **Godot 4.7.x**: resource import/parse, frame order/speed/loop, action switching without per-frame restart, repeated one-shots, facing/feet alignment, collision placement, and enter/exit/re-entry as applicable. Use an isolated project for helper/fixture tests. Run `npm run test:engineering` for helper changes, setting `GODOT_47_BIN` for actual 4.7.x execution; an absent engine is a reported skip, not a pass. `--headless --editor --import` alone is not playback or gameplay validation. If only another engine version is available, record that limitation rather than silently upgrading the target.

Deliver actual resources/scripts and a concise preview or project link, what ran, and a task-specific manual check. Distinguish code written, assets staged, engine-tested, visually checked and full-game acceptance. No claims of target-engine or WorkBuddy behavioral validation from a static report or from the workbench asset viewer alone.

## Internal frontend reuse

See [internal imports](../../../docs/internal-imports.md) for asset-library source selection, map/object/scene handoff and editing existing materials. These frontend imports read existing assets without production tasks or generation; map editing and scene placement remain manual. Static props are appearance only; preserve behavior, project/object identity, source hashes and exact animation candidate/FPS/loop. Changes in an editor require explicit replacement in an existing scene. Older prop metadata can omit subject only when the original task explicitly says prop and content checks pass.

Project selection uses the in-page folder browser or an explicit typed path. Browsing is read-only and cancellable; it must not start an OS dialog or lock the export window. Selecting a folder alone does not create a delivery or authorize generation.

Engine selection: the current baseline is Godot 4.7.x. Verify the actual executable with --version and use its resolved path; a PATH alias or cached editor path may select a different installation. Historical CopyWorms 4.6.x evidence remains source history and must be revalidated on 4.7.x.

For a requested character art replacement, inspect the target SpriteFrames at execution time and preserve its actual aliases, FPS, loop and controller behavior; old handoff notes may be stale. Native 64px art may need a larger visual-only scale to retain the previous world height. Derive scale and foot offset from actual alpha bounds and export anchor; leave collision and input logic unchanged. Record any animation metadata override in the target handoff.
