from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

from .service import SpritePipelineService


class RecoveryWorker:
    """Daemon that resumes durable provider jobs while API/UI is running."""

    def __init__(self, service: SpritePipelineService, *, interval_seconds: float | None = None) -> None:
        self.service = service
        self.interval_seconds = float(interval_seconds or service.settings.poll_interval_seconds)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._planning_thread: threading.Thread | None = None
        self._structure_thread: threading.Thread | None = None
        self._state_lock = threading.Lock()
        self._last_scan: dict[str, Any] | None = None
        self._last_error: dict[str, Any] | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="sprite-pipeline-recovery",
            daemon=True,
        )
        self._thread.start()
        self._planning_thread = threading.Thread(target=self._run_planning, name="sprite-open-motion-planning", daemon=True)
        self._planning_thread.start()
        self._structure_thread = threading.Thread(target=self._run_structures, name="sprite-visual-structure", daemon=True)
        self._structure_thread.start()

    def stop(self, timeout_seconds: float = 5.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=max(0.0, timeout_seconds))

    def _run_planning(self) -> None:
        from .collaboration.workspace import OpenMotionWorkspace
        workspace = OpenMotionWorkspace(self.service)
        while not self._stop.is_set():
            try:
                workspace.recover_planning(stopping=self._stop.is_set)
                if not self._stop.is_set():
                    from .collaboration.adjustments import Adjustments
                    Adjustments(self.service).recover(stopping=self._stop.is_set)
            except Exception:
                # Individual requests retain their safe failure receipts. A
                # broken file must not terminate recovery for existing jobs.
                pass
            if self._stop.wait(self.interval_seconds):
                break

    def _run_structures(self) -> None:
        from .collaboration.structures import VisualStructures
        structures = VisualStructures(self.service)
        while not self._stop.is_set():
            try:
                structures.recover(stopping=self._stop.is_set)
                if not self._stop.is_set():
                    from .collaboration.tracking import TemporalStructures
                    TemporalStructures(self.service).recover(stopping=self._stop.is_set)
            except Exception:
                # Durable request state prevents a paid call from being replayed.
                pass
            if self._stop.wait(self.interval_seconds):
                break

    def snapshot(self) -> dict[str, Any]:
        with self._state_lock:
            return {
                "running": bool(self._thread and self._thread.is_alive()),
                "interval_seconds": self.interval_seconds,
                "last_scan": self._last_scan,
                "last_error": self._last_error,
            }

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                scan = self.service.recover_pending_jobs()
                with self._state_lock:
                    self._last_scan = scan
                    self._last_error = None
            except Exception as exc:
                with self._state_lock:
                    self._last_error = {
                        "at": datetime.now(timezone.utc).isoformat(),
                        "message": str(exc),
                        "type": type(exc).__name__,
                    }
            if self._stop.wait(self.interval_seconds):
                break
