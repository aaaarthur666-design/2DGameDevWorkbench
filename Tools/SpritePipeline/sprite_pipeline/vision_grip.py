"""A second, mandatory weapon-owner audit within the existing two-call budget."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

Holder = Literal["reference", "other", "both", "occluded"]
ReferenceGrip = Literal["one_handed", "two_handed", "occluded"]

GRIP_REVIEW_INSTRUCTION = (
    "Track the weapon owner through the shoulder -> elbow -> wrist -> hilt connection, including the free arm. "
    "The anatomical hand is NOT screen-left/right; crossed arms, a raised blade or perspective do not prove a hand swap. "
    "reference_grip describes the ORIGINAL REF: one_handed, two_handed, or occluded. "
    "In each frame holder=reference means the same single physical arm that holds the weapon in REF; "
    "holder=other means the originally free arm now holds it; both means both hands visibly grip the hilt. "
    "Use occluded when the arm-to-hilt connection cannot be resolved. Never guess a hand from blade position. "
    "Describe the actual arm-to-hilt evidence, not merely a hand label. "
)


def normalize_holder(value):
    value=value.strip().lower() if isinstance(value,str) else "occluded"
    aliases={"same_hand":"reference","original_hand":"reference","other_hand":"other","unknown":"occluded","unclear":"occluded"}
    value=aliases.get(value,value)
    return value if value in {"reference","other","both","occluded"} else "occluded"


class GripObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    frame: int = Field(ge=1, le=64)
    holder: Holder
    confidence: float = Field(ge=0, le=1)
    observation: str = Field(min_length=1, max_length=180)

    _normalize_holder = field_validator("holder",mode="before")(normalize_holder)


class GripAudit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["consistent", "changed", "uncertain"]
    reference_grip: ReferenceGrip
    confidence: float = Field(ge=0, le=1)
    observations: list[GripObservation] = Field(min_length=1, max_length=64)
    reason: str = Field(min_length=1, max_length=400)


def assess_grip(audit, initial, reference_grip, count):
    """A claimed hand swap needs independently matching physical-arm observations."""
    fallback = {"status": "uncertain", "reason": "持刀手连接尚未取得完整、相互一致的画面证据。"}
    if audit is None:
        return False, [], fallback
    saved = audit.model_dump()
    observations = {o.frame: o for o in audit.observations}
    expected_frames = set(range(1, count + 1))
    if len(observations) != len(audit.observations) or set(observations) != expected_frames:
        return False, [], {**saved, **fallback}
    poses = {p.frame: p for p in initial}
    if set(poses) != expected_frames or len(poses) != len(initial):
        return False, [], {**saved, **fallback}
    if (reference_grip == "occluded" or audit.reference_grip != reference_grip
            or audit.confidence < .9):
        return False, [], {**saved, **fallback}
    expected = "both" if reference_grip == "two_handed" else "reference"
    agreed = {f: o.holder for f, o in observations.items()
              if o.confidence >= .9 and o.holder != "occluded" and poses[f].holder == o.holder}
    wrong = [f for f, holder in agreed.items() if holder != expected]
    anchors = [f for f, holder in agreed.items() if holder == expected]
    # REF and an earlier visible animation pose anchor the original owner's identity.
    if audit.status == "changed" and wrong and any(a < min(wrong) for a in anchors):
        issue = {"code": "hand_swap", "frames": sorted(wrong),
                 "description": "持刀手发生变化：" + audit.reason,
                 "correction": "Restore the ORIGINAL weapon-owning arm through shoulder, elbow, wrist and hilt; keep the other arm's original role. Do not copy swapped hands from faulty neighbors.",
                 "phase": "unknown", "phase_confidence": 0,
                 "evidence_status": "confirmed", "evidence_confidence": min(audit.confidence, *(observations[f].confidence for f in wrong))}
        return False, [issue], {**saved, "accepted_frames": sorted(wrong)}
    if audit.status == "consistent" and len(agreed) == count and not wrong and count > 1:
        return True, [], saved
    return False, [], {**saved, **fallback}
