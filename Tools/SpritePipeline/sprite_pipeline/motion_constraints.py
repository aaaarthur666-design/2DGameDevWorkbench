"""Phase-specific attack repair constraints; no frame-number phase guessing."""
from typing import Literal
from .errors import ValidationHarnessError
from .grip_contract import owner_for_job, grip_rule, HAND_LABELS

Phase = Literal["prepare", "windup", "charge", "strike", "extend", "follow_through", "recover", "unknown"]
PHASE_LABELS = {"prepare":"起势", "windup":"举刀", "charge":"蓄力", "strike":"出刀", "extend":"伸展", "follow_through":"随挥", "recover":"收势恢复", "unknown":"阶段待确认"}
ISSUE_LABELS = {"early_swing":"提前挥刀", "weapon_flip":"刀刃翻向", "second_windup":"重复蓄力", "extra_strike":"多次挥刀", "body_discontinuity":"身体不连续", "identity_drift":"角色外形漂移", "weapon_deformation":"武器形态变化", "hand_swap":"持刀手变化", "incomplete_action":"攻击阶段缺失", "other":"动作异常", "uncertain":"需要人工判断", "check_unavailable":"检查未完成"}
GROUND = {"prepare", "windup", "charge", "strike", "follow_through", "recover"}
AIR = {"prepare", "strike", "extend", "follow_through", "recover"}
RULES = {
    "prepare": "Keep the ready pose; do not strike or begin recovery.",
    "windup": "Raise the blade BEHIND the shoulder along its existing arc; no forward strike or blade reversal.",
    "charge": "Hold the blade BEHIND the shoulder, storing energy. NO forward slash, blade flip or second windup.",
    "strike": "Continue the ONE forward cutting arc from windup; never return to charging or start a second slash.",
    "extend": "Extend the existing airborne strike; do not initiate another swing or jump.",
    "follow_through": "Continue the same strike's follow-through and decelerate; no reverse slash or renewed windup.",
    "recover": "Return smoothly from follow-through to ready; NO new windup, strike or blade reversal.",
}
RULES_CN = {"prepare":"保持起势，不提前出刀或收势。", "windup":"沿原轨迹将刀举至肩后，不向前挥刀或突然翻转。", "charge":"刀保持在肩后蓄力，不前挥、不翻刀、不重复蓄力。", "strike":"延续唯一一次向前劈砍，不返回蓄力，不发动第二刀。", "extend":"延伸当前空中攻击，不额外挥刀或起跳。", "follow_through":"沿同一次攻击轨迹随挥减速，不反向挥刀或重新蓄力。", "recover":"从随挥平滑回到准备姿势，不发动新的攻击。"}

def phase_context(job, candidate, frame_index, digest, override="auto"):
    allowed = AIR if job.action.action_id == "attack_in_air" else GROUND
    if override != "auto":
        if override not in allowed:
            raise ValidationHarnessError("所选阶段不适用于当前攻击动作")
        phase, source = override, "人工指定"
    else:
        saved = candidate.motion_review or {}
        report = saved.get("report", {})
        relevant = [i for i in report.get("issues", []) if frame_index+1 in i["frames"]]
        reliable = (saved.get("digest") == digest and report.get("confidence",0)>=0.85 and bool(relevant)
                    and all(i.get("evidence_status")=="confirmed" and i.get("evidence_confidence",0)>=0.9
                            and i.get("phase") in allowed and i.get("phase_confidence",0)>=0.85 for i in relevant))
        phases = {i["phase"] for i in relevant} if reliable else set()
        phase = next(iter(phases)) if len(phases)==1 else "unknown"
        source = "视觉检查" if phase != "unknown" else "待人工确认"
    count = len(candidate.frames)
    owner=owner_for_job(job)
    return {"phase":phase, "phase_label":PHASE_LABELS[phase], "phase_source":source,
            "weapon_hand":owner,"grip_constraint_cn":HAND_LABELS[owner]+"，全程连接同一条手臂；不照抄错误邻帧里的换手。",
            "constraint":RULES.get(phase,""), "constraint_cn":RULES_CN.get(phase,"请确认当前帧应处于哪个攻击阶段，再请求 AI 修补。"),
            "previous_frame":frame_index-1 if frame_index>0 else None,
            "next_frame":frame_index+1 if frame_index+1<count else None}

def repair_prompt(action_id, count, target, context, phase, correction="", note="", *, weapon_hand="reference"):
    if phase not in RULES:
        raise ValidationHarnessError("请先确认当前帧的攻击阶段；尚未提交生成请求")
    slot = context.index(target)+1
    def neighbor(index, name):
        if index < 0 or index >= count:
            return f"No {name} at sequence edge; do not invent motion. "
        return f"LOCK {name} frame {index+1} (slot {context.index(index)+1}). "
    hard = (f"Repair ONLY slot {slot}, frame {target+1}/{count}. Slots map to {[i+1 if i>=0 else 'REF' for i in context]}; repeats are padding. "
            f"INTENDED PHASE={phase}. {RULES[phase]} "
            + ("Keep ONE continuous airborne arc; no extra jump. " if action_id=="attack_in_air" else "Keep feet grounded. ")
            + neighbor(target-1,"previous") + neighbor(target+1,"next")
            + grip_rule(weapon_hand,"REF slot 4" if -1 in context else "original reference") + " "
            + "Keep blade path/length, facing, size and transparency continuous; ONE attack. Other slots unchanged. "
            + ("REF slot 4 is the ORIGINAL identity guide, NOT a motion frame. Keep its outfit/body palette and weapon owner; ignore hand swaps or invented clothing in faulty neighbors. " if -1 in context else ""))
    if len(hard)>1000:
        raise ValidationHarnessError("阶段与持刀手约束超出请求限制；尚未提交生成请求")
    budget=1000-len(hard)
    additions=f"Visual fix: {correction[:max(0,budget//2-15)]}. User note: {note[:max(0,budget//2-15)]}."
    return hard+additions[:budget]
