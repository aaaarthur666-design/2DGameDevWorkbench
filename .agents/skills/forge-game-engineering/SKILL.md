---
name: forge-game-engineering
description: Design and implement Godot 4.6 game projects from ready Forge assets using the CopyWorms project's actual contracts. Use for SpritePipeline frame imports and action playback, exported map instantiation, asset organization, and project-specific GDScript reuse.
---

# Forge game engineering

The external Agent writes the game code. Forge remains the production, editing and preview workbench. Follow the requested planning or implementation scope; discussing architecture does not authorize editing a game or generating more art.

## Establish the project contract

Identify the target game directory and the reference CopyWorms checkout separately. Locate `project.godot`, the current architecture report, instructions, scenes, configs and affected scripts. Keep the reference checkout read-only unless it is explicitly the requested edit target. The source URL and verified baseline are in [CopyWorms contracts and reuse](references/copyworms.md); do not hard-code a user's drive path or assume the old report matches newer code. Use `scripts/inspect_source.py ROOT` to inventory the relevant files and current hashes without starting Godot. If only documentation is available, design from that evidence and identify unverified code rather than claiming a tested transplant.

Use the project's working architecture as the starting point: formal bases and config resources, scene/UI Builders, explicit global contracts and level lifecycle. Do not replace it with a generic game framework. Inspect dependencies before choosing what to retain, adapt or omit. Read [CopyWorms contracts and reuse](references/copyworms.md) for architecture and code work.

## Bring in ready assets

Read the production Skill through `agentAssets.skill` in `workbench/manifest.json` when MCP asset discovery is needed. `list_assets` → exact `get_asset` / `get_result` supplies provenance, selected candidate, ordered frames, status and actual files. `get_asset_manifest` describes selections; it does not itself supply textures. Never re-run generation just to obtain old outputs. Read files before claiming readiness and retain source hashes in the handoff.

- **Characters:** read [frames and actions](references/frames.md). Prefer the existing verified SpritePipeline Godot ZIP when available; keep its namespace and selected action. For older exports or explicit resource staging, `stage_assets.py sprite` builds real PNG / AtlasTexture / SpriteFrames resources from explicitly ordered files or regions. It also supplies an optional visual adapter for a new actor. Existing CopyWorms actors keep their controllers and `Sprite` node contract. For partial animation updates, merge clips into a copy of the original SpriteFrames using `assets/sprite_frames_merge.gd`; preserve unselected actions.
- **Maps:** read [map integration](references/maps.md). Identify the export format before importing. `stage_assets.py map` handles current Frame Ronin Godot exports only; legacy Pixelwork and assembled scenes have different dependencies. Use the included `map_mount.gd` as a small Builder helper, preserving exported collision coordinates and runtime behavior.
- **Interactables:** reuse the current workbench exporter/runtime and its declared CopyWorms profile. Preserve definition/instance IDs and the shared runtime. Do not invent another interaction engine.
- **Complete scenes:** select an existing kind=scene asset by exportId and sceneRevision. Download its saved scene-godot.zip and scene-source.zip without regenerating. Preserve scenes/<scene-id> paths and the shared interaction runtime; do not treat it as a Frame Ronin map pack or a complete game. Browser-only drafts are not indexed, and archiving execution history does not remove the selected asset.

The scripts require Python 3.10+ standard library only. Run them with an available interpreter, such as this workbench's SpritePipeline venv. They stage into a **new output directory**, never merge into or overwrite a game. The Agent then inspects the staged result and implements the user's authorized target-project changes. Namespacing and missing dependencies remain explicit. These scripts do not call a provider, create workbench tasks or require API keys.

Map creation, stitching and extension remain manual frontend work. This Skill consumes already exported map files; it does not expose or bypass map production through MCP, CLI, HTTP or browser automation.

## Implement and verify the requested slice

For project creation, establish the requested playable slice and target directory; if missing, inspect available materials while asking only for those consequential choices. For an existing project, preserve the working scene paths, autoload ownership and gameplay timings. Resolve routine resource names and file placement yourself from the actual project. Do not import story, balance constants, unused managers or every CopyWorms module by default.

Produce a short source-to-target map: chosen assets and animation aliases, reused/adapted scripts and dependencies, scene ownership, state/event/config contracts, and unresolved inputs. Scale it to the task; do not manufacture paperwork for a one-clip replacement. Keep authored controller scripts outside generated resource folders so re-export cannot erase them.

Verify with **Godot 4.6.x**: resource import/parse, frame order/speed/loop, action switching without per-frame restart, repeated one-shots, facing/feet alignment, collision placement, and enter/exit/re-entry as applicable. Use an isolated project for helper/fixture tests. Run `npm run test:engineering` for helper changes, setting `GODOT_46_BIN` for actual 4.6.x execution; an absent engine is a reported skip, not a pass. `--headless --editor --import` alone is not playback or gameplay validation. If only another engine version is available, record that limitation rather than silently upgrading the target.

Deliver actual resources/scripts and a concise preview or project link, what ran, and a task-specific manual check. Distinguish code written, assets staged, engine-tested, visually checked and full-game acceptance. No claims of target-engine or WorkBuddy behavioral validation from a static report or from the workbench asset viewer alone.

Map catalog entries contain complete editable projects only. Individual generated, expanded, stitched and imported images are excluded without deleting their files or history. Follow the exact project editor link to resume; download supplies map-source.zip, which is an editor source package, not an engine export. Legacy browser drafts are indexed only after opening and saving in their original browser. Do not bypass the manual-map boundary to migrate or produce maps.

Map project thumbnails are optional, version-bound display attachments rendered locally by the manual editor. They are not separate map assets or engine exports. Missing previews do not imply missing source; legacy projects gain a thumbnail on the next manual open/save. Asset reads never render or generate a thumbnail.

## Recoverable asset recycle bin

Asset listing defaults to `scope=active`; use `scope=trashed` to inspect the recoverable recycle bin. Exact details expose `trashedAt`. The frontend confirms explicit selections before trash/restore; source files, original tool content, task history and existing scene references remain intact. This organizes the catalog and does not free disk space. A source being offline does not mean deletion; restoring a catalog entry does not repair missing files. Do not clean existing assets merely because the user requested implementation of the feature.
