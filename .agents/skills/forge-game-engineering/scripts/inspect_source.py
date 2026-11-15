"""Read-only inventory of a CopyWorms checkout; never starts/imports the game."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

FILES = [
    "project.godot", "AGENTS.md", "TECHNICAL_ARCHITECTURE_REPORT.md",
    "SPRITE_ASSET_SPECIFICATION.md", "SPRITE_ASSET_MANIFEST.json",
    "PlayerModule/Formal/PlayerBase.gd", "PlayerModule/Formal/Player_Warrior.gd",
    "PlayerModule/Formal/Player_Warrior_Cyber.gd", "PlayerModule/Formal/Player_Warrior_Cyber.tscn",
    "EnemyModule/Formal/EnemyBase.gd", "Global/EventBus.gd", "Global/InputManager.gd",
    "Global/GameManager.gd", "Global/SceneTransitionManager.gd", "Global/UILayerContract.gd",
    "LevelModule/Formal/Level_02_SceneBuilder.gd",
    "LevelModule/Scenes/PixelworkMapStitch/Level04_Cyber/Level04_Cyber_runtime.gd",
]

def inspect(root):
    root = Path(root).resolve(strict=True)
    if not (root / "project.godot").is_file():
        raise ValueError("Reference directory has no project.godot")
    result = {"root": str(root), "files": [], "missing": [], "mutatesSource": False}
    try:
        result["commit"] = subprocess.check_output(["git", "--no-optional-locks", "-C", str(root), "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        result["commit"] = None
    for name in FILES:
        p = root / name
        if not p.is_file():
            result["missing"].append(name)
            continue
        data = p.read_bytes()
        result["files"].append({"path": name, "sha256": hashlib.sha256(data).hexdigest(), "resourceReferences": sorted(set(re.findall(r'res://[^"\s)]+', data.decode("utf-8-sig"))))})
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    args = parser.parse_args()
    print(json.dumps(inspect(args.root), ensure_ascii=False, indent=2))
