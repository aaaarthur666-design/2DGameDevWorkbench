---
name: forge-game-engineering
description: Integrate ready Forge assets and implement Godot game code in the selected target project. Use for animation imports, scene mounting, interaction wiring and project-specific architecture; consult CopyWorms contracts when that profile or reference is involved.
---

# Forge game engineering

Use the actual target project's code and instructions to complete the requested integration or playable slice. Keep planning requests at the design stage; when implementation is authorized, resolve routine resource names, paths and wiring and continue through relevant validation.

## Route the task

| Work | Read |
| --- | --- |
| One animation or a character's visual resources | [Frames and actions](references/frames.md) · topic engineering-frames |
| Exported map or complete scene | [Map packages and lifecycle](references/maps.md) · topic engineering-maps |
| A Forge delivery selected for an existing game | [Delivery](../../../docs/godot-delivery.md), also available as MCP guidance topic delivery |
| CopyWorms target/profile, or explicitly requested source reuse | [CopyWorms contracts](references/copyworms.md) · topic engineering-copyworms |
| Producing or adjusting art | [Asset production Skill](../2d-game-workbench/SKILL.md), then return with the chosen result |

Read only the relevant paths; MCP-only readers can use workbench_get_guidance({topic}) for the listed topics. A generic Godot project does not need CopyWorms controllers, Builders or global managers. For a new project, choose structure suited to the requested slice; for an existing one, begin with its current scene and ownership model.

## Establish the target and inputs

Locate project.godot, target instructions, affected scenes/scripts/resources and the actual engine version. Separate a reference checkout from the write target. scripts/inspect_source.py ROOT provides a bounded read-only inventory; it is optional when the needed files are already clear.

For an existing Forge delivery, query list_game_exports / get_game_export, match the exact selected package and target, then use install_game_export with its current hashes. For a directly supplied ZIP, inspect and integrate that package without manufacturing a production task. Production replacements consume the selected adopted/exported asset; isolated tests of other candidates retain their test status.

Preserve actual frame order, regions, FPS, loop and source identity from the package. Intermediate checkpoints, context images and repair previews are not complete delivered clips. Artwork review does not determine gameplay hit frames or authorize unrelated timing changes.

## Implement the requested slice

- **Animation:** merge only selected actions into the existing SpriteFrames resource and retain other clips. Use assets/sprite_frames_merge.gd when suitable. Keep the real controller's aliases, state/timing, facing, visual anchor and collision behavior; derive any necessary visual scale from the new artwork and target actor.
- **Maps/scenes:** identify the export format, mount at the target's actual level entry point, and preserve coordinate, collision and lifecycle contracts. Existing generated runtime ownership and stable instance IDs determine how the scene connects.
- **Interactables:** use the exported generic or copyworms profile and one shared interaction runtime. Connect its actual signals to the target's existing systems as the requested gameplay requires.
- **New game code:** choose the minimum architecture that supports the agreed playable slice. Reuse source modules only when their behavior and dependencies fit.

For manual staging, scripts/stage_assets.py accepts explicit sprite input or supported map ZIPs and writes a new output directory. It preserves the source package; the Agent performs the authorized target edits afterward. Helpers use Python 3.10+ standard library. A current verified export often needs no restaging.

Keep custom integration code outside replaceable generated-resource directories. Inspect file/resource sharing and installation conflicts before updating a target. Existing user changes need a deliberate merge, not deletion to make an installer pass.

## Validate and finish

Use the target project's actual Godot executable and report its version. Forge's export/helper regression baseline is 4.7.x; differing target versions need relevant compatibility checks rather than an implicit upgrade.

Check what the change affects: resource loading and playback for a clip, repeated actions and switching for controller changes, collision and enter/exit/re-entry for map lifecycle changes. A headless import checks parsing, while visual playback or gameplay claims require corresponding evidence. Missing engine or media leaves those checks explicitly unverified while other work can still complete.

Helper changes use npm run test:engineering; GODOT_47_BIN selects its 4.7.x engine regression. Routine asset integration need not run the entire workbench suite.

For a tracked delivery, complete_game_export records actual modified files and separate engine evidence. Otherwise provide the real target files and observed result. Explain source-to-target decisions only to the degree the task needs; a one-clip replacement does not require an architecture report.
