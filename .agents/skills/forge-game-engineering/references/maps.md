# Existing map packages → game scenes

## Identify the format before moving files

| Existing export | Identification | Import behavior |
| --- | --- | --- |
| CopyWorms Pixelwork map | `.tscn`, `*_runtime.gd`, `*_godot.json`, annotations, image tiles; node metadata `map_stitch_manifest_path` | Preserve generated runtime, manifest/resource_root and textures, then inspect plugin/gate dependencies |
| Current Frame Ronin Godot map | `map_export.json`: `format=frame-ronin-engine-package`, version 1, target godot; `map_scene.tscn`, `regions.json`, `assets/` | Included stager namespaces paths, omits the sample project.godot, prevents duplicate FrameRoninRegions class registration |
| Workbench assembled scene | `scenes/<id>/scene-manifest.json`: `format=workbench-scene-godot`; `scene.tscn`, `addons/workbench_interaction/runtime/v1/` | Preserve paths and shared runtime; import scene under its existing ID; check collisions with already imported kits |
| Flat image / editor source ZIP / other local compose package | No matching runtime contract | It is not automatically a complete playable scene. Inspect actual contents or request the proper Godot export; never fabricate collisions |

Frame Ronin script usage:

```sh
python .agents/skills/forge-game-engineering/scripts/stage_assets.py map existing-godot-map.zip --output outputs/map-handoff-v1 --resource-root LevelModule/Scenes/forest_v1
```

Copy the staged `LevelModule/...` subtree into the authorized target after inspecting conflicts. Use `handoff.json.scene` as the entry. The helper rejects unsupported formats and unresolved resource paths; it never invokes the map editor or generates a map. Source ZIP and editor round-trip state remain unchanged.

## Coordinates, layers and collision

Current `features/map-stitcher/engine-export.ts` exports `frame-ronin-regions` v1 in **pixel-world-y-down** coordinates. Canvas `originX/originY` can be negative. Each Sprite2D is uncentered and placed at that canvas origin. Collision polygon points already contain world offsets and live under an unshifted collision body. Do not subtract the origin again. To move a map, transform the entire scene root so pictures and collision move together.

Preserve exported visibility and z order: surface / overall background at 0, mask 10, object 20, top 100. Choose actor placement from the target scene; do not assume the map's visual layer is the actor layer. Inspect collision layer/mask, authored polygons and foot placement with the actual player. Picture dimensions do not establish walkable areas.

`features/scene-composer/godot-builder.mjs` has a separate assembly contract. It supplies `ActorSlot`, scene-relative ordered z values, preserved instance IDs, transformed object origins and `MapCollisions.position = scene.map.offset`. Add the actor under ActorSlot at relative z=0 (or use its recorded actorZIndex). Share one exported interaction runtime version; compare existing runtime files/hashes before merging. Do not duplicate class_name registrations or overwrite project settings. Source scene ZIP is editor data, not an extra runtime dependency.

## Instantiate through the level Builder

The included `assets/map_mount.gd` is a small adaptation of the reference project's Builder behavior, not a replacement map engine. Place it outside generated map folders and use the actual scene path:

```gdscript
const MapMount = preload("res://LevelModule/MapMount.gd")
var map: Node2D = MapMount.mount(self, "res://LevelModule/Scenes/forest_v1/map_scene.tscn")
```

Call after the parent is in the tree; check the result. Set any root transform before add_child so `_ready` sees the intended placement. Keep map ownership with the level/Builder. On normal level free, the map's own `_exit_tree` handles its runtime cleanup; do not manually delete its textures or leave a global reference to a freed scene. For a delayed transition, validate the new scene before cleaning global state, following the target's existing transition path.

## Legacy Pixelwork deserves separate handling

Verified sources: `LevelModule/Formal/Level_02_SceneBuilder.gd::_attach_dream_visual_layers` and `LevelModule/Scenes/PixelworkMapStitch/Level04_Cyber/Level04_Cyber_runtime.gd` at the CopyWorms baseline.

The generated runtime loads its tile manifest, scans actor groups, streams tiles, manages regions/ghosts and drains pending threaded loads in `_exit_tree`. Its full runtime behavior depends on the NPC Library runtime gate/plugin, including the feature key `pixelwork_map_stitch_runtime_v1`. A naked runtime.gd is not a dependency-complete transplant. Preserve required plugin/runtime terms and settings; do not remove gates or rewrite third-party runtime to make a partial copy appear complete.

When the game reparents a live Pixelwork map, call `request_ready()` **before** `reparent(...)`, as Level_02_SceneBuilder does. The old runtime unloads on exit and needs `_ready` rearmed to rebuild. `MapMount.reparent_streamed_map` supplies that operation with valid-node/parent checks and preserves global transform. New scene instantiation does not need an extra request_ready. Child runtimes with independent lifecycle may need their own contract; do not recurse blindly.

Legacy import acceptance must include actually entering, leaving, re-entering and runtime reparenting, with actor detection, visible tiles, region collision and no leftover loads. A generated static Frame Ronin fixture only validates static map mounting; it does not validate this legacy plugin or a whole level.

[Godot 4.7 PackedScene reference](https://docs.godotengine.org/en/4.7/classes/class_packedscene.html) is for API verification; architecture decisions come from the project sources above.
