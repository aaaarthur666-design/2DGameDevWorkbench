"""Stage ready art as Godot 4.6 resources in a NEW directory; no provider or game edits."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import tempfile
import zipfile

ASSETS = Path(__file__).resolve().parents[1] / "assets"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def quote(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


def number(value, label, minimum=None, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    if minimum is not None and value < minimum:
        raise ValueError(f"{label} must be >= {minimum}")
    if integer and int(value) != value:
        raise ValueError(f"{label} must be an integer")
    return int(value) if integer else value


def resource_root(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*", value):
        raise ValueError("resource-root must be a relative slash-separated ASCII identifier path")
    return value


def png_size(data):
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("Expected a PNG with an IHDR header")
    width, height = struct.unpack(">II", data[16:24])
    if not width or not height or width * height > 64_000_000:
        raise ValueError("Invalid or oversized PNG dimensions")
    return width, height


def publish(output, files, report):
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError(f"Output already exists; select a new staging directory: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        for name, data in files.items():
            target = temporary / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
        (temporary / "handoff.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        if output.exists():
            raise ValueError("Output was created by another process")
        os.rename(temporary, output)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return {**report, "output": str(output.resolve())}


def stage_sprite(spec_path, output, namespace):
    namespace = resource_root(namespace)
    spec_path = Path(spec_path).resolve(strict=True)
    spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))
    if spec.get("version") != 1:
        raise ValueError("Sprite spec requires version 1")
    if spec.get("sourceFacing") not in ("right", "left"):
        raise ValueError("sourceFacing must be right or left")
    offset = spec.get("offset")
    if not isinstance(offset, list) or len(offset) != 2:
        raise ValueError("offset must explicitly supply [x,y] from the target visual contract")
    offset = [number(v, "offset") for v in offset]
    clips = spec.get("animations")
    if not isinstance(clips, list) or not clips:
        raise ValueError("Supply at least one animation")
    files, sources, ext, sub, animations, records = {}, {}, [], [], [], []
    textures, clip_names, events = {}, set(), {}
    for clip in clips:
        name = clip.get("name", "")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", name) or name in clip_names:
            raise ValueError("Animation names must be unique identifiers")
        clip_names.add(name)
        fps = number(clip.get("fps"), "fps", minimum=0.001)
        if not isinstance(clip.get("loop"), bool):
            raise ValueError("Each clip requires an explicit boolean loop")
        provenance = clip.get("source")
        if not isinstance(provenance, dict) or not provenance:
            raise ValueError("Each clip requires source provenance (asset/candidate or local source identity)")
        frames = clip.get("frames")
        if not isinstance(frames, list) or not frames:
            raise ValueError("Each clip requires frames in playback order")
        refs, clip_frames, frame_size = [], [], None
        for frame in frames:
            source = Path(frame["path"])
            source = (spec_path.parent / source).resolve(strict=True) if not source.is_absolute() else source.resolve(strict=True)
            data = source.read_bytes()
            sha = digest(data)
            if frame.get("sha256", "").lower() != sha:
                raise ValueError(f"Missing or changed source SHA-256: {source}")
            width, height = png_size(data)
            sources[str(source)] = sha
            if sha not in textures:
                texture_id = f"tex_{len(textures)}"
                textures[sha] = texture_id
                relative = f"{namespace}/textures/{sha}.png"
                files[relative] = data
                ext.append(f'[ext_resource type="Texture2D" path={quote("res://" + relative)} id={quote(texture_id)}]')
            texture = f'ExtResource({quote(textures[sha])})'
            region = frame.get("region")
            if region is not None:
                if not isinstance(region, list) or len(region) != 4:
                    raise ValueError("region must be [x,y,width,height] in source pixels")
                region = [number(v, "region", minimum=0 if i < 2 else 1, integer=True) for i, v in enumerate(region)]
                x, y, w, h = region
                if x + w > width or y + h > height:
                    raise ValueError("Frame region exceeds source PNG")
                size = (w, h)
                atlas_id = f"atlas_{len(sub)}"
                sub.append(f'[sub_resource type="AtlasTexture" id={quote(atlas_id)}]\natlas = {texture}\nregion = Rect2({x}, {y}, {w}, {h})\nfilter_clip = true')
                texture = f'SubResource({quote(atlas_id)})'
            else:
                size = (width, height)
            if frame_size is not None and frame_size != size:
                raise ValueError("Frame dimensions differ inside one clip; resolve alignment in the asset pipeline")
            frame_size = size
            duration = number(frame.get("duration", 1.0), "relative frame duration", minimum=0.001)
            refs.append('{"duration": %s, "texture": %s}' % (duration, texture))
            clip_frames.append({"source": str(source), "sha256": sha, "region": region, "duration": duration})
        frame_events = clip.get("frameEvents", {})
        if not isinstance(frame_events, dict):
            raise ValueError("frameEvents must map zero-based frame indices to cue names")
        for key, cue in frame_events.items():
            if not re.fullmatch(r"0|[1-9][0-9]*", key) or int(key) >= len(frames) or not isinstance(cue, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", cue):
                raise ValueError("Invalid explicit frame event")
        if frame_events:
            events[name] = frame_events
        animations.append('{"frames": [%s], "loop": %s, "name": &%s, "speed": %s}' % (", ".join(refs), str(clip["loop"]).lower(), quote(name), fps))
        records.append({"name": name, "source": provenance, "fps": fps, "loop": clip["loop"], "size": list(frame_size), "frames": clip_frames, "frameEvents": frame_events})
    initial = spec.get("initialAnimation", clips[0]["name"])
    if initial not in clip_names:
        raise ValueError("initialAnimation is missing from animations")
    frames_path = f"{namespace}/frames.tres"
    files[frames_path] = '[gd_resource type="SpriteFrames" load_steps=%d format=3]\n\n%s\n\n%s\n\n[resource]\nanimations = [%s]\n' % (len(ext) + len(sub) + 1, "\n".join(ext), "\n\n".join(sub), ",\n".join(animations))
    files[f"{namespace}/character_visual.gd"] = (ASSETS / "character_visual.gd").read_bytes()
    files[f"{namespace}/visual.tscn"] = '\n'.join([
        '[gd_scene load_steps=3 format=3]',
        f'[ext_resource type="SpriteFrames" path={quote("res://" + frames_path)} id="frames"]',
        f'[ext_resource type="Script" path={quote("res://" + namespace + "/character_visual.gd")} id="script"]',
        '[node name="Sprite" type="AnimatedSprite2D"]',
        'texture_filter = 1', 'centered = true',
        f'offset = Vector2({offset[0]}, {offset[1]})',
        'sprite_frames = ExtResource("frames")', f'animation = &{quote(initial)}',
        'script = ExtResource("script")',
        f'source_faces_right = {str(spec["sourceFacing"] == "right").lower()}',
        f'frame_events = {quote(events)}', '',
    ])
    report = {"format": "forge-godot-sprite-handoff", "version": 1, "engine": "4.6.x", "resourceRoot": namespace,
              "spriteFrames": "res://" + frames_path, "visualScene": f"res://{namespace}/visual.tscn",
              "sourceFacing": spec["sourceFacing"], "offset": offset, "animations": records,
              "sourceFiles": sources, "engineValidated": False, "modifiesSource": False}
    return publish(output, files, report)


def stage_map(archive, output, namespace):
    namespace = resource_root(namespace)
    archive = Path(archive).resolve(strict=True)
    raw = archive.read_bytes()
    files, seen = {}, set()
    with zipfile.ZipFile(archive) as z:
        if sum(i.file_size for i in z.infolist()) > 1_073_741_824:
            raise ValueError("Map package exceeds 1 GiB expanded size")
        for entry in z.infolist():
            name = entry.filename
            if "\\" in name or ":" in name or name.startswith("/") or any(p in ("..", ".") for p in name.split("/")) or "//" in name:
                raise ValueError("Unsafe map archive path")
            if entry.create_system == 3 and (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Map archive symlinks are unsupported")
            if name.rstrip("/").lower() in seen:
                raise ValueError("Duplicate or case-colliding map archive paths")
            seen.add(name.rstrip("/").lower())
            if not entry.is_dir():
                files[name] = z.read(entry)
    if "map_export.json" not in files:
        raise ValueError("Requires a Frame Ronin Godot export (map_export.json); use the documented Pixelwork/scene-composer workflow for other formats")
    manifest = json.loads(files["map_export.json"])
    if manifest.get("format") != "frame-ronin-engine-package" or manifest.get("version") != 1 or manifest.get("target") != "godot":
        raise ValueError("Unsupported map export format/version/target")
    for required in ("map_scene.tscn", "regions.json", "frame_ronin_regions.gd"):
        if required not in files:
            raise ValueError(f"Missing map resource: {required}")
    regions = json.loads(files["regions.json"])
    if regions.get("format") != "frame-ronin-regions" or regions.get("version") != 1 or regions.get("coordinateSystem") != "pixel-world-y-down":
        raise ValueError("Unsupported region coordinate contract")
    copied, source_hashes = {}, {}
    for name, data in files.items():
        if name == "project.godot":
            continue
        if not name.startswith("assets/") and name not in ("map_export.json", "map_scene.tscn", "regions.json", "frame_ronin_regions.gd", "source_state.zip", "INSTALL.md"):
            raise ValueError(f"Unexpected file in current Frame Ronin package: {name}")
        source_hashes[name] = digest(data)
        if name.endswith((".tscn", ".tres", ".gd", ".json")):
            text = data.decode("utf-8-sig")
            def relocate(match):
                path = match.group(1)
                if path not in files or path == "project.godot":
                    raise ValueError(f"Map has unresolved resource dependency: res://{path}")
                return "res://" + namespace + "/" + path
            text = re.sub(r'res://([^"\s)]+)', relocate, text)
            if name == "frame_ronin_regions.gd":
                # Multiple maps must not register the same global script class.
                text = re.sub(r"(?m)^class_name FrameRoninRegions\s*$", "", text)
            data = text.encode("utf-8")
        if name == "INSTALL.md":
            data = f"Open res://{namespace}/map_scene.tscn. Import this staged directory into your existing Godot 4.6.x project. project.godot was intentionally omitted. Region runtime is loaded by path, without a duplicate global class.\n".encode("utf-8")
        copied[f"{namespace}/{name}"] = data
    report = {"format": "forge-godot-map-handoff", "version": 1, "engine": "4.6.x", "resourceRoot": namespace,
              "scene": f"res://{namespace}/map_scene.tscn", "sourceArchive": str(archive), "sourceSha256": digest(raw),
              "sourceFiles": source_hashes, "canvas": manifest.get("canvas"), "coordinateSystem": regions["coordinateSystem"],
              "engineValidated": False, "modifiesSource": False}
    return publish(output, copied, report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("sprite", "map"):
        command = sub.add_parser(name)
        command.add_argument("input", help="Sprite input JSON or existing Frame Ronin Godot ZIP")
        command.add_argument("--output", required=True, help="NEW staging directory, not the target game root")
        command.add_argument("--resource-root", required=True, help="Resource namespace inside the eventual game")
    args = parser.parse_args()
    try:
        result = (stage_sprite if args.command == "sprite" else stage_map)(args.input, args.output, args.resource_root)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile) as exc:
        parser.exit(1, f"Asset staging failed: {exc}\n")
