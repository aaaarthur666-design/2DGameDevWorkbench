# SpritePipeline → frames → SpriteFrames → actor actions

## Identify the exact artwork

Use the workbench manifest/discovery and `get_asset` / `get_result` for the selected candidate. Match job ID, candidate index and source hashes. Only consume actual reviewed/exported delivery when a production replacement is requested. A test import of an unapproved candidate can be useful, but label it as such and keep it isolated. Never choose a different candidate merely because its files are easier to find.

Inspect the real export recipe from `Tools/SpritePipeline/sprite_pipeline/service.py` (`export_candidate`) and `processing/sheet_export.py`. Current recipe fields include:

| Recipe field | Engineering use |
| --- | --- |
| `job_id`, `candidate_index`, `character_id`, `action_id`, `manifest_action_name` | Provenance and explicit action alias |
| `source_frames[]` with index/path/sha256, `frame_order` | Ordered individual PNGs; match metadata, not lexicographic directory scanning |
| `source_region_px[]` | Exact atlas rectangles in playback order |
| `frame_cells`, `cell_width`, `cell_height`, `columns`, `rows` | Cross-check rectangles and dimensions; unused cells are padding |
| `sheet_sha256` | Verify the delivered sheet before slicing |
| `runtime_fps`, `fps`, `scene_fps`, `loop` | Compare intended runtime and target-scene values; record the effective choice |
| `critical_frame_indices` | QA emphasis only; these are **not** automatic damage or gameplay triggers |

Recipe paths can be relative to the service's configured data root. Resolve them using returned artifact paths/current service settings; do not assume the workbench cwd. For the source project's separate SPRITE_ASSET_MANIFEST, the relevant geometry is `frame_order[].source_region_px`; do not confuse that schema with the pipeline recipe's separate arrays. The actual CopyWorms atlas order can skip cells. Frame count alone never implies row-major order.

## Prefer an existing Godot export

Current SpritePipeline exports include a `.godot.zip` beside the PNG. The workbench result exposes `godotPackage`; native export records use `godot_package_path` and download `/v1/jobs/{job_id}/exports/godot`. Inspect its `export.json`, SpriteFrames and texture references, then import its `forge_sprites` tree intact. The pack already contains the selected action's actual frames, mapped animation name, runtime FPS and loop. It includes a visual scene, not a gameplay controller. Preserve other actions through the existing merge helper when adding a clip to an actor. Older exports may lack this optional file; do not claim it exists or trigger a new export just to browse.

## Stage resources

Run from the workbench root, replacing interpreter and output paths as appropriate:

```sh
python .agents/skills/forge-game-engineering/scripts/stage_assets.py sprite work/hero-input.json --output outputs/hero-handoff-v1 --resource-root Assets/Characters/hero_v1
```

The Agent writes the input JSON from verified metadata; users are not expected to enter these fields. Paths below are examples. Supply real SHA-256 values, not the explanatory strings:

```json
{
  "version": 1,
  "sourceFacing": "right",
  "offset": [0, -10],
  "initialAnimation": "attack",
  "animations": [{
    "name": "attack",
    "source": {"assetId": "selected asset id", "jobId": "selected job", "candidateIndex": 2, "actionId": "attack"},
    "fps": 18,
    "loop": false,
    "frames": [
      {"path": "delivery/sheet.png", "sha256": "actual sheet hash", "region": [256, 0, 128, 128]},
      {"path": "delivery/sheet.png", "sha256": "actual sheet hash", "region": [0, 128, 128, 128]}
    ]
  }]
}
```

Those dimensions, fps and offset are illustrative; derive them from the selected art and actual target actor. Each frame may instead point to its individual PNG, without `region`. Preserve array order. Optional `duration` is a positive **relative** duration multiplier (default 1), not milliseconds. `frameEvents` can map an explicit zero-based frame to a visual cue, e.g. `{"1":"swing_sound"}`. Leave it absent without a source or design decision for that cue.

The new output contains PNGs, `frames.tres`, `visual.tscn`, the optional `character_visual.gd`, and `handoff.json` with provenance. The `.tres` contains actual Texture2D or AtlasTexture references. Copy the staged `Assets/...` subtree into the authorized target root after checking path collisions; the resource-root passed to the script must match the final path. It deliberately supplies no `project.godot` and never merges into a game. A new export uses a new directory or a reviewed target-resource replacement, not a blind overwrite.

## Connect to the existing actor

Find the target actor's actual animation node, state-to-clip aliases, resource sharing and scene inheritance. For one action, merge only the selected clip(s) into the existing SpriteFrames and preserve every other action. The included `assets/sprite_frames_merge.gd` exposes `merge_clips(existing, incoming)` without mutating either input. Save the result and update only the intended actor reference; a second visual scene or helper controller is usually unnecessary.

Preserve the controller's gameplay state, hit timing, collision and facing contracts. Playback should restart on an actual new action occurrence, not on every physics update. Validate effective FPS, loop, offsets, foot placement and any logic that references exact frame indices against the new art. Pixel dimensions and action names come from this target, not a universal character template.

For CopyWorms, read [its actor contracts](copyworms.md#actor-animation-contracts) (topic engineering-copyworms) for the verified Sprite node, state aliases, attack timing and Cyber special-action gates.

## Optional adapter for a new actor

`assets/character_visual.gd` implements just the presentation behavior, without new gameplay state or global dependencies. In the owner's existing animation update:

```gdscript
# `resolved_clip` comes from this actor's verified state/alias map.
$Sprite.show_action(resolved_clip)
$Sprite.face_right(facing_right)
# On an explicit new attack occurrence, even if still displaying attack:
$Sprite.show_action(&"attack", true)
```

Do not call the restart line on every update. Missing clips return false without changing playback. Non-loop clips hold the final frame; their visual_finished signal is presentation evidence only. The optional explicit frame_cue signal is for audio/effects by default. If the requested design truly makes a frame authoritative for a hit, adapt the existing gameplay contract deliberately, including interruptions, replay, duplicate-hit guards and pause behavior; never infer hit frames from pixels or QA indices.

For a new standalone visual test, instantiate `visual.tscn`, call `show_action`, inspect both loop and one-shot actions. For a real controller test, exercise input→state→clip, attack interruption/replay, damage count and pause in the target project. Passing the first does not prove the second.

API references for Godot 4.7: [SpriteFrames](https://docs.godotengine.org/en/4.7/classes/class_spriteframes.html), [AnimatedSprite2D](https://docs.godotengine.org/en/4.7/classes/class_animatedsprite2d.html). `animation_finished` is not emitted for looping clips.
