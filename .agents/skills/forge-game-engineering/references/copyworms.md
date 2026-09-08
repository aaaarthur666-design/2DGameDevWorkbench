# CopyWorms contracts and reuse

## Source baseline

Reference repository: https://github.com/flxBurnOut/copyWorms ; inspected commit `bb1581d12c9626e294e403a01db5f3cffb229cd8` (master, checked 2026-09-08). Repository title is HackathonGame / 织梦者. Locate the user's checkout or an authorized reference copy; a file called TECHNICAL_ARCHITECTURE_REPORT.md alone is not a checkout. `scripts/inspect_source.py ROOT` records the actual current commit, files, hashes and direct `res://` references. It is a starting index, not a complete dependency resolver: class_name, autoloads, dynamically constructed paths and scene scripts also need inspection.

Primary evidence in that repository:

| Source | What to inspect |
| --- | --- |
| `TECHNICAL_ARCHITECTURE_REPORT.md`, `project.godot`, `AGENTS.md` | Current module responsibilities, autoload/scene ownership, Godot version, unresolved architectural debt |
| `SPRITE_ASSET_SPECIFICATION.md`, `SPRITE_ASSET_MANIFEST.json` | Frame geometry/order, facing, ground offset, canonical resources, effective playback contracts |
| `PlayerModule/Formal/PlayerBase.gd` | Input/state/physics, attack windup and duration, config, damage ownership |
| `PlayerModule/Formal/Player_Warrior.gd`, `Player_Warrior_Cyber.gd` and scenes | SpriteFrames, state-to-clip mapping, facing, special-action overrides |
| `EnemyModule/Formal/EnemyBase.gd` and concrete scenes | Enemy registration, actor lifecycle, resource/config dependencies |
| `Global/EventBus.gd`, `InputManager.gd`, `SceneTransitionManager.gd`, `GameManager.gd` | Synchronous events, owner cleanup, token locks, transition and global ownership |
| `LevelModule/Formal/Level_02_SceneBuilder.gd` and relevant level Builders | Scene assembly, map reparenting, placement, dependency direction |
| `LevelModule/Scenes/PixelworkMapStitch/` | Generated runtime + manifest + annotations + tiles; not just a background PNG |
| `DataConfig/` | Resource-driven player/enemy/gameplay parameters actually consumed by code |

Prefer actual code/scenes/config for observable behavior and the architecture report for documented contracts. If they differ, report the mismatch and choose a bounded adaptation. Older project Skill text has drift (Godot AI version, config migration, dream state representation); do not copy it as unquestioned authority.

## Architecture that the Skill preserves

Levels assemble player, enemies, UI and maps. Reusable modules do not reach back into concrete level scripts. Formal base classes own common lifecycle; concrete characters implement their variation; Resource configs hold consumed gameplay parameters. Scene/UI Builders assemble the corresponding level instead of accumulating everything in a global manager.

`EventBus.emit` is synchronous. Deferred dispatch is explicit. Subscriptions use owner + method identity and must clean up on owner exit; scene-scoped and persistent listeners differ. Reusing EventBus means retaining payload contracts or explicitly adapting both producers and consumers.

Input locks belong to owner/token pairs. Releasing a UI control must release its own token; ordinary action events and polling share the same gate. Pause and scene transition must leave no stale lock. EnemyBase registers itself in `_ready`; its spawner must not register it a second time. `_exit_tree` releases local ownership; `prepare_for_level_exit` handles explicit transition preparation. Target-scene validation precedes global cleanup.

The reference still contains both MainEntry child-level hosting and SceneTransitionManager whole-tree switching. Choose the route used by the target level; do not silently unify them or copy both into a new game with overlapping ownership. Keep that decision explicit in the source-to-target map.

## Reuse decisions

| Code family | Default decision | Dependencies / validation |
| --- | --- | --- |
| SpriteFrames/AtlasTexture resource layout | Reuse the method; generate selected textures/resources | Explicit frame regions/order, action names, dimensions, fps, loop and visual anchor |
| `Player_Warrior` animation/facing methods | Adapt only the relevant presentation behavior | Keep PlayerBase state/timers and Cyber special-action early returns; never graft another full FSM |
| `EventBus.gd` | Candidate for direct source reuse when the new game needs cross-module events | Inspect entire file, preserve required payloads and owner lifetime; test duplicate subscriptions and owner exit |
| `UILayerContract.gd` | Reuse project-wide layer contract when corresponding UI exists | Coordinate all CanvasLayer consumers; omit irrelevant story overlays only after checking callers |
| PlayerBase / EnemyBase + concrete classes + configs | Reuse as a dependency group when that gameplay is requested | DamageCalculator, GameManager, InputManager, global definitions, scenes, resource classes and assets |
| InputManager / SceneTransitionManager / GameManager | Adapt after target ownership is decided | Autoload registration, existing level entry strategy, input actions, scene cleanup; not standalone utility files |
| Scene/UI Builders | Reuse assembly pattern and needed operations | Their concrete level fields, signals and story nodes are project-specific |
| Pixelwork generated maps | Preserve the complete export and required plugin/runtime | Streaming thread drain, actor groups, region gates, re-entry and exact resource paths |
| Current workbench interaction runtime | Use the exporter and CopyWorms profile already in this repository | Shared runtime version, exported IDs, signal bridge and target EventBus contract |
| Level 03–05 plot, dream transitions, boss tuning, special effects | Do not include by default | Add only for requested gameplay; no arbitrary story dependencies in a new project |

No source package is blindly vendored by this Skill. The included small visual and map helpers are adaptations of the cited methods, not full copies of the game. Before extracting other code, retain its source path/commit/hash, trace its dependencies and check the repository's stated reuse terms. The baseline README describes learning/competition use; do not relabel it as MIT or assume third-party Pixelwork/plugin code has the same terms.

## Architecture and implementation output

A useful engineering handoff records the target root/version, selected art, source-to-target script/resource mapping, scene/Builder ownership, active state-to-animation aliases, damage/input/event/config contracts, the chosen level lifecycle, and the smallest playable check. Preserve existing names and state semantics where possible. Mark a missing animation as a gap or a clearly disclosed temporary fallback; don't pretend it exists because its logical state exists.

For requested implementation, write the adapted GDScript/resources, connect real nodes/signals/configs, then run the relevant engine checks. For a plan-only request, provide the dependency map and implementation choices without creating game files. No automatic broad architecture rewrite is implied.
