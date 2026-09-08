"""Full-sequence action evidence; a clean anomaly list is not proof of an attack."""
from __future__ import annotations
import math
from typing import Literal
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, ConfigDict, Field, field_validator
from .motion_constraints import PHASE_LABELS
from .vision_grip import Holder, GripAudit, GRIP_REVIEW_INSTRUCTION, normalize_holder
from .vision_evidence import Verification, FrameObservation, raster, image_part, verification_content

class FramePose(BaseModel):
    model_config = ConfigDict(extra="forbid")
    frame: int = Field(ge=1, le=64)
    grip_height: Literal["low", "shoulder", "overhead", "occluded"]
    holder: Holder = "occluded"
    blade_tip: Literal["front_high", "front_low", "behind_high", "behind_low", "occluded"]
    observation: str = Field(min_length=1, max_length=180)

    _normalize_holder = field_validator("holder",mode="before")(normalize_holder)

    @field_validator('grip_height',mode='before')
    @classmethod
    def grip_alias(cls,value):
        aliases={'below_shoulder':'low','above_head':'overhead','at_shoulder':'shoulder','unknown':'occluded','unclear':'occluded'}
        value=aliases.get(value,value) if isinstance(value,str) else 'occluded'
        return value if value in {'low','shoulder','overhead','occluded'} else 'occluded'

    @field_validator('blade_tip',mode='before')
    @classmethod
    def tip_alias(cls,value):
        value=value.strip().lower().replace('-','_') if isinstance(value,str) else 'occluded'
        return value if value in {'front_high','front_low','behind_high','behind_low','occluded'} else 'occluded'

class StageEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stage: Literal["prepare", "windup", "charge", "strike", "extend", "follow_through", "recover"]
    status: Literal["present", "missing", "uncertain"]
    confidence: float = Field(ge=0, le=1)
    observations: list[FrameObservation] = Field(min_length=1, max_length=64)
    reason: str = Field(min_length=1, max_length=500)

class RecoveryEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_frame: int = Field(ge=1, le=64)
    end_frame: int = Field(ge=1, le=64)
    motion: Literal["retracting", "held_extended", "snapped_to_ready", "occluded"]
    settled: bool
    observation: str = Field(min_length=1, max_length=300)

from .vision_appearance import AppearanceAudit, APPEARANCE_INSTRUCTION

class SequenceVerification(Verification):
    stages: list[StageEvidence] = Field(min_length=1, max_length=7)
    hand_continuity: GripAudit | None = None
    recovery_evidence: RecoveryEvidence | None = None
    appearance_continuity: AppearanceAudit | None = None


def required_stages(action_id):
    return (["prepare", "strike", "extend", "follow_through", "recover"] if action_id=="attack_in_air"
            else ["windup", "charge", "strike", "follow_through", "recover"])


def facing_instruction(facing):
    if facing not in {"left","right"}:
        return "Determine facing from REF; never guess anatomical ownership from screen side. "
    return (f"Character faces SCREEN {facing.upper()}. Front = screen {facing}; "
            f"behind = screen {'left' if facing=='right' else 'right'}. Up = image top, down = image bottom. "
            "These are screen axes, NOT anatomical left/right hands. ")

def draw_label(draw, xy, label):
    draw.text(xy,label,fill="white",font=ImageFont.load_default(size=20))

def sequence_content(paths, reference, issues, action_id, *, handoff_frame=None, handoff_frames=None, facing="right"):
    content=[{"type":"input_text", "text":
        "Audit whether the REQUIRED ACTION actually happens, independently of any earlier verdict. "
        "A smooth idle, small low sword wave, or missing windup is NOT a complete charged attack. "
        "Inspect ALL labelled frames in these contact sheets; each page overlaps the previous page by one frame. "
        "REF is the character identity reference, never an animation frame. Do not force phase boundaries from frame numbers. "
        "For EACH required stage provide present/missing/uncertain, exact frame observations and a physical reason in Chinese. "
        "For missing stages cite the observed poses that occur instead; do not pretend the missing pose exists. "
        "Grounded charge requires a visibly raised blade behind/over the shoulder, reached before cutting; one clearly charged pose is sufficient, and a long hold is not required. Merely waiting in a low ready stance is not charging. "
        "Strike needs evidence of blade travel from the raised position forward/down, not a bright mark or a pose label. "
        "Recovery must occur after the strike AND reach the actual sequence end. Its evidence MUST include the last frame. "
        "In recovery_evidence inspect visible arm/blade RETRACTION from follow-through to the final frame, including the penultimate frame. "
        "A held extended sword with tiny color/leg changes is held_extended, not recovery. A last-frame teleport is snapped_to_ready. "
        "Report start_frame/end_frame and whether the final pose settles; on air attacks settling does not mean landing. If clear held_extended or snapped_to_ready replaces retraction, report recover as missing with those visible frames. "
        "Confirm missing stages only with clear visible evidence. "
        "Occluded blades do not prove missing stages; use uncertain when essential poses cannot be seen. "
        "Do not equate perspective changes or two highlights with weapon flipping or two attacks. "
        f"Action={action_id}; required stages={required_stages(action_id)}. Return every required stage exactly once. "
        "For ground attack the required order is windup -> charge -> strike -> follow_through -> recover, exactly one strike. "
        "For air attack it is prepare -> strike -> extend -> follow_through -> recover on a continuous airborne arc; ground-style charge is NOT required."}]
    content.append({"type":"input_text","text":facing_instruction(facing)})
    content.append({"type":"input_text","text":GRIP_REVIEW_INSTRUCTION + "hand_continuity MUST independently audit the weapon owner in EVERY actual frame, even when no hand-swap issue was proposed. Return one observation per frame in order; use uncertain when evidence is occluded or conflicting."})
    content.append({"type":"input_text","text":APPEARANCE_INSTRUCTION})
    for start in range(0,len(paths),7):
        frames=list(range(max(0,start-1),min(len(paths),start+7)))
        tiles=[('REF',reference)]+[(f'FRAME {i+1}/{len(paths)}',paths[i]) for i in frames]
        board=Image.new('RGB',(768,math.ceil(len(tiles)/3)*280),(25,30,40));draw=ImageDraw.Draw(board)
        for pos,(label,path) in enumerate(tiles):
            x=pos%3*256;y=pos//3*280
            draw_label(draw,(x+8,y+2),label);board.paste(raster(path),(x,y+24))
        content.extend([{'type':'input_text','text':f"Ordered page: frames {frames[0]+1}-{frames[-1]+1}, left-to-right then top-to-bottom."},image_part(board)])
    # Close-ups are still part of the SAME second request, never extra calls.
    tail=sorted({max(1,len(paths)-max(2,len(paths)//4)),max(1,len(paths)-1),len(paths)})
    tiles=[("ORIGINAL REF",reference)]+[(f"FRAME {i}/{len(paths)}",paths[i-1]) for i in tail]
    board=Image.new("RGB",(768,math.ceil(len(tiles)/2)*412),(25,30,40));draw=ImageDraw.Draw(board)
    for pos,(label,path) in enumerate(tiles):
        x=pos%2*384;y=pos//2*412
        draw_label(draw,(x+8,y+3),label);board.paste(raster(path,384),(x,y+28))
    content.extend([{"type":"input_text","text":f"TERMINAL RECOVERY: compare REF, frames {tail}. Inspect actual retraction, not just a final color change. Recovery evidence must end at frame {len(paths)}; do not reuse earlier stage numbers."},image_part(board)])
    seams=sorted(set(handoff_frames or ([handoff_frame] if handoff_frame is not None else [])))
    for handoff_frame in seams:
        if not 1 <= handoff_frame <= len(paths): continue
        frames=list(range(max(1,handoff_frame-2),min(len(paths),handoff_frame+3)+1))
        tiles=[("ORIGINAL REF",reference)]+[(f"FRAME {i}/{len(paths)}",paths[i-1]) for i in frames]
        board=Image.new("RGB",(3*384,math.ceil(len(tiles)/3)*408),(25,30,40));draw=ImageDraw.Draw(board)
        for pos,(label,path) in enumerate(tiles):
            x=pos%3*384;y=pos//3*408
            draw_label(draw,(x+8,y+2),label);board.paste(raster(path,384),(x,y+24))
        content.extend([{"type":"input_text","text":f"Segment handoff close-up around frame {handoff_frame}. Track the SAME shoulder-elbow-wrist-hilt owner across this boundary. The original REF anchors hand ownership; do not infer a swap from screen position."},image_part(board)])
    local,included=verification_content(paths,reference,issues)
    content.extend(local)
    return content,included


def assess_sequence(check, poses, action_id, frame_count):
    """Require complete coverage and evidence for a pass; retain localized missing-stage findings."""
    expected=required_stages(action_id)
    stages={s.stage:s for s in check.stages}
    if len(stages)!=len(check.stages) or set(stages)!=set(expected):
        raise ValueError('missing or duplicate required action stage')
    indexed={p.frame:p for p in poses}
    if len(indexed)!=frame_count or set(indexed)!=set(range(1,frame_count+1)):
        raise ValueError('incomplete frame observations')
    findings=[]; audit=[]; complete=frame_count>1; previous_start=0
    for name in expected:
        s=stages[name];frames=sorted({o.frame for o in s.observations})
        if len(frames)!=len(s.observations) or any(f<1 or f>frame_count for f in frames):
            raise ValueError('invalid stage evidence frames')
        status=s.status
        evidence_note=''
        if s.confidence<.9: status='uncertain'
        if status=='present':
            if frames[0]<previous_start: status='uncertain'
            previous_start=frames[0]
            if name in {'strike','recover'} and len(frames)<2: status='uncertain'
            if name=='recover':
                terminal=check.recovery_evidence
                strike_end=max(o.frame for o in stages['strike'].observations)
                if (frame_count not in frames or frames[0]<strike_end or not terminal
                        or terminal.end_frame!=frame_count or terminal.start_frame<strike_end
                        or terminal.start_frame>=terminal.end_frame
                        or terminal.motion!='retracting' or not terminal.settled):
                    status='uncertain'
                    evidence_note='收招证据未覆盖出刀后的实际末尾，或未证实手臂和刀刃回收；不能按已收招通过。'
            if action_id=='attack' and name in {'windup','charge'}:
                raised=[f for f in frames if indexed[f].blade_tip=='behind_high' and indexed[f].grip_height in {'shoulder','overhead'}]
                if not raised:
                    status='uncertain'
            if action_id=='attack' and name=='strike':
                # A strike can start just after the last charged frame. Include
                # that immediate predecessor instead of rejecting valid motion.
                context=sorted(set(frames+[max(1,frames[0]-1)]))
                high=[f for f in context if indexed[f].blade_tip=='behind_high']
                low=[f for f in frames if indexed[f].blade_tip=='front_low']
                if not any(a<b for a in high for b in low):
                    status='uncertain'
                    evidence_note='逐帧刀尖记录没有支持从肩后高位到前下方的完整出刀；阶段文字结论与姿势证据不一致。'
        if status=='missing':
            if name=='recover':
                terminal=check.recovery_evidence
                if (frame_count not in frames or not terminal or terminal.end_frame!=frame_count
                        or not 1<=terminal.start_frame<terminal.end_frame
                        or terminal.motion not in {'held_extended','snapped_to_ready'}):
                    status='uncertain'
                    evidence_note='缺少末帧与回收轨迹的核验，不能确认收招缺失。'
            visible=[f for f in frames if indexed[f].blade_tip!='occluded']
            if len(visible)<2: status='uncertain'
            if action_id=='attack' and name in {'windup','charge'}:
                raised=[f for f,p in indexed.items() if p.blade_tip=='behind_high' and p.grip_height in {'shoulder','overhead'}]
                if raised:
                    status='uncertain'  # Conflicting visible evidence must not become a fault tag.
        if status!='present': complete=False
        audit.append({**s.model_dump(),'status':status,'frames':frames,'evidence_note':evidence_note})
        if status=='missing':
            # An absent stage has no reliable observed phase: human assigns the intended phase before editing.
            findings.append({'code':'incomplete_action','frames':frames,
                'description':f"缺少{PHASE_LABELS[name]}：{s.reason}",
                'correction':f"Restore the missing {name} within the single attack; preserve the original character and adjacent frames.",
                'phase':'unknown','phase_confidence':0,'evidence_status':'confirmed','evidence_confidence':s.confidence})
    return complete,findings,audit
