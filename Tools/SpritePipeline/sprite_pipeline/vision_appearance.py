"""Independent character/weapon audit even when the first pass reports no defects."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from .vision_evidence import FrameObservation
from .attack_timeline import visible_pixels


class AppearanceFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: Literal["identity_drift", "weapon_deformation"]
    confidence: float = Field(ge=0, le=1)
    reference_feature: str = Field(min_length=1, max_length=240)
    observations: list[FrameObservation] = Field(min_length=2, max_length=8)
    reason: str = Field(min_length=1, max_length=400)
    correction: str = Field(min_length=1, max_length=400)


class AppearanceAudit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    checked_frames: list[int] = Field(min_length=1, max_length=64)
    body_status: Literal["consistent", "changed", "uncertain"]
    weapon_status: Literal["consistent", "changed", "uncertain"]
    confidence: float = Field(ge=0, le=1)
    reference_features: str = Field(min_length=1, max_length=400)
    comparisons: list[FrameObservation] = Field(min_length=1, max_length=8)
    findings: list[AppearanceFinding] = Field(max_length=8)


APPEARANCE_INSTRUCTION = (
    "Independently audit ORIGINAL CHARACTER AND WEAPON in appearance_continuity, even if the first pass found NOTHING. "
    "Read the actual original REF: describe torso/limb proportions, helmet, armor panels/colors and solid sword profile in reference_features. "
    "Compare EVERY animation frame against REF, not just its preceding generated frame. Return all checked_frames in order. "
    "Audit body_status and weapon_status separately. A gradually thicker torso, altered helmet/armor, or a sword becoming a short block or fragments "
    "can be defects even when adjacent frames look similar and the final frame matches REF again. "
    "Trace the SOLID blade connected to its hilt separately from its light trail. Natural foreshortening and a transient slash smear are allowed; "
    "a continuous blade-following arc alone is NOT weapon deformation. Do not require a fixed screen length or direction. "
    "In comparisons cite the first, an interior and last frame with concrete visible appearance differences or matches. "
    "New appearance findings are allowed here even when decisions has no issue indices. "
    "A finding needs the specific original reference_feature, at least TWO adjacent labelled frame observations, a physical reason and confidence >=0.9. "
    "Return uncertain when the blade/body is occluded or the difference could be normal pose/perspective. Do not fill in ideal anatomy from the requested action. "
    "Use concise Chinese evidence and English correction instructions."
)


def assess_appearance(check, paths, reference):
    count = len(paths)
    if check is None:
        return False, [], {"status": "uncertain", "reason": "人物外形与武器形状尚未独立核验"}
    audit = check.model_dump()
    if check.checked_frames != list(range(1, count + 1)):
        return False, [], {**audit, "body_status": "uncertain", "weapon_status": "uncertain", "status": "uncertain", "reason": "外形检查未覆盖全部实际帧"}
    compared = [o.frame for o in check.comparisons]
    if len(set(compared)) != len(compared) or any(f < 1 or f > count for f in compared):
        return False, [], {**audit, "body_status": "uncertain", "weapon_status": "uncertain", "status": "uncertain", "reason": "外形对照帧号无效"}
    original = visible_pixels(reference.read_bytes()).tobytes()
    findings, accepted = [], []
    for item in check.findings:
        frames = sorted(o.frame for o in item.observations)
        valid = (len(set(frames)) == len(frames) and all(1 <= f <= count for f in frames)
                 and any(f + 1 in frames for f in frames) and item.confidence >= .9)
        expected_status = check.body_status if item.code == "identity_drift" else check.weapon_status
        valid = valid and expected_status == "changed"
        if valid and all(visible_pixels(paths[f - 1].read_bytes()).tobytes() == original for f in frames):
            valid = False  # Pixel-identical copies cannot support an appearance-change claim.
        accepted.append({**item.model_dump(), "accepted": valid})
        if valid:
            findings.append({"code": item.code, "frames": frames, "description": item.reason,
                             "correction": item.correction, "phase": "unknown", "phase_confidence": 0,
                             "evidence_status": "confirmed", "evidence_confidence": item.confidence})
    enough = (len(compared) >= min(3, count) and 1 in compared and count in compared)
    for field, code in [("body_status", "identity_drift"), ("weapon_status", "weapon_deformation")]:
        if any(f["code"] == code for f in findings):
            audit[field] = "changed"
        elif enough and check.confidence >= .9 and audit[field] == "consistent" and not any(f.code == code for f in check.findings):
            audit[field] = "consistent"
        else:
            audit[field] = "uncertain"
    ok = audit["body_status"] == audit["weapon_status"] == "consistent"
    audit.update(status="changed" if findings else "consistent" if ok else "uncertain", findings=accepted)
    return ok, findings, audit
