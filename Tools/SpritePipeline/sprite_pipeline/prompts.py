from __future__ import annotations
from .models import ActionPreset, CharacterPreset

IDENTITY_LOCK = "EVERY frame: match reference outfit, body/armor palette, helmet, proportions and weapon. Keep original clothing and body colors; no added cape."
GENERIC_IDENTITIES = {
    "Preserve the exact identity, outfit, proportions, equipment, silhouette, and colors from the approved reference image.",
}

def character_identity_parts(character: CharacterPreset) -> list[str]:
    """Use the approved appearance in ordinary and segmented generation alike."""
    parts = [IDENTITY_LOCK]
    identity = character.identity_description.strip()
    if identity and identity not in GENERIC_IDENTITIES:
        parts.append(identity)
    return parts


def compose_generation_prompt(character: CharacterPreset, action: ActionPreset) -> str:
    """Keep action and appearance explicit; reject oversized prompts upstream."""
    attack = action.action_id in {"attack", "attack_in_air"}
    parts=(["Action: "+action.action_description.strip()] if attack else []) + character_identity_parts(character)
    if not attack: parts.append("Action: "+action.action_description.strip())
    parts.append(f"Output {action.generation_frame_count} ordered frames; {character.cell_width}x{character.cell_height} canvas.")
    if action.generation_frame_count!=action.frame_count:
        retained=", ".join(str(index+1) for index in action.generation_frame_selection)
        parts.append(f"Keep source frames continuous; retain frames {retained} for {action.frame_count}-frame output.")
    constraints=list(action.locked_constraints)
    required=[f"fixed side-view; face {character.facing}",
              f"root near ({character.anchor.x},{character.anchor.ground_y}); smooth path, no whole-sprite jumps"]
    if character.transparent_background: required.append("keep a fully transparent background")
    if action.loop and action.loop_constraint: required.append(action.loop_constraint)
    seen={item.casefold() for item in constraints}
    constraints.extend(item for item in required if item.casefold() not in seen)
    parts.extend("- "+item.strip() for item in constraints if item.strip())
    return "\n".join(parts).strip()
