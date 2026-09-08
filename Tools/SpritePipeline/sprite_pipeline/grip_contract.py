"""Keep weapon ownership distinct from screen position or grip height."""
from typing import Literal

WeaponHand = Literal["reference", "left", "right", "both"]
HAND_LABELS = {"reference": "沿用原图持刀手", "left": "角色左手持刀", "right": "角色右手持刀", "both": "沿用原图双手握法"}


def owner_for_job(job):
    # An explicit operator correction applies to repair, without rewriting history.
    override = (job.motion_control or {}).get("weapon_hand_override")
    return override if override in HAND_LABELS else job.character.weapon_hand


def grip_rule(owner="reference", reference="original reference"):
    if owner in {"left", "right"}:
        who = f"character's anatomical {owner.upper()} hand (not screen-{owner})"
        free = " Other hand stays empty."
    elif owner == "both":
        who = f"BOTH hands with the same leading/support roles as {reference}"
        free = ""
    else:
        who = f"the SAME physical hand(s) as {reference}"
        free = " Keep the free hand empty."
    return (f"Weapon owner: {who}. Keep the shoulder-elbow-wrist-hilt connection through ALL phases."
            + free + " NO handoff, hand swap or mirroring.")
