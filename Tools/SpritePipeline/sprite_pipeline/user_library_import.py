"""Bring standalone user assets into the workbench without replacing either copy."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from .jsonio import atomic_write_json, read_json
from .migration import LegacyLayoutMigrator
from .settings import HarnessSettings, _default_data_root


def import_user_library(settings: HarnessSettings) -> dict[str, Any]:
    if settings.portable_mode or os.environ.get("SPRITE_PIPELINE_IMPORT_USER_ASSETS") != "1":
        return {"status": "disabled"}
    source = _default_data_root().resolve()
    if source == settings.data_root.resolve() or not source.is_dir():
        return {"status": "not_required"}
    report_path = settings.config_dir / "user_library_import.json"
    try:
        previous = read_json(report_path)
    except FileNotFoundError:
        previous = {}
    except Exception:
        return {"status": "incomplete", "message": "资产导入记录无法读取；保留现有目录，请检查 user_library_import.json。"}
    if not isinstance(previous, dict) or not isinstance(previous.get("entries", {}), dict):
        return {"status": "incomplete", "message": "资产导入记录格式无效；未更改任何资产。"}
    # Completed entries are a one-time import, not a sync that resurrects deleted work.
    entries = dict(previous.get("entries", {})) if previous.get("source_root") == str(source) else {}
    report: dict[str, Any] = {
        "source_root": str(source), "destination_root": str(settings.data_root),
        "source_left_intact": True, "entries": entries, "conflicts": [], "errors": [],
        "copied_jobs": 0, "copied_characters": 0, "skipped_identical": 0,
        "skipped_destination_newer": 0, "checked_at": datetime.now(timezone.utc).isoformat(),
    }
    copier = LegacyLayoutMigrator(settings)
    for area, folder, destination, record in [
        ("jobs", source / "jobs", settings.jobs_dir, "job.json"),
        ("characters", source / "characters", settings.user_characters_dir, "character.json"),
    ]:
        for item in sorted(folder.glob("*")):
            key = f"{area}/{item.name}"
            if key in entries or not item.is_dir() or not (item / record).is_file():
                continue
            try:
                if area == "jobs":
                    payload = read_json(item / record)
                    if payload.get("request", {}).get("provider") == "fixture":
                        continue
                    if payload.get("status") in {"submitting", "provider_pending", "saving", "submitted", "polling", "generating", "running"}:
                        continue  # Wait for the original writer to finish.
                conflict_count = len(report["conflicts"])
                outcome = copier._copy_directory(item, destination / item.name, area, report)
                entries[key] = {"outcome": outcome}
                if outcome == "copied":
                    report[f"copied_{area}"] += 1
                if len(report["conflicts"]) > conflict_count:
                    entries[key]["recovery"] = report["conflicts"][-1]["destination"]
                # Persist each successful copy so an interrupted restart can resume.
                atomic_write_json(report_path, report)
            except Exception as exc:
                report["errors"].append({"entry": key, "message": str(exc)})
    report["status"] = "incomplete" if report["errors"] else "complete"
    atomic_write_json(report_path, report)
    return report
