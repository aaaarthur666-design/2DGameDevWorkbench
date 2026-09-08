"""Evidence panels and a bounded second look at proposed visual findings."""
from __future__ import annotations
import base64
import io
import math
from pathlib import Path
from typing import Literal
from PIL import Image, ImageDraw
from pydantic import BaseModel, ConfigDict, Field
from .motion_constraints import Phase

REVIEW_PROTOCOL_VERSION = 6
MAX_VISUAL_REQUESTS = 2
MAX_VERIFIED_ISSUES = 8
MAX_CONTEXT_FRAMES = 8

class FrameObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    frame: int = Field(ge=1, le=64)
    observation: str = Field(min_length=1, max_length=300)

class IssueDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    issue_index: int = Field(ge=0, le=63)
    decision: Literal["confirmed", "dismissed", "uncertain"]
    confidence: float = Field(ge=0, le=1)
    observations: list[FrameObservation] = Field(min_length=1, max_length=8)
    reason: str = Field(min_length=1, max_length=500)
    phase: Phase
    phase_confidence: float = Field(ge=0, le=1)

class Verification(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decisions: list[IssueDecision] = Field(max_length=MAX_VERIFIED_ISSUES)


def image_part(image):
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return {"type":"input_image", "detail":"high", "image_url":"data:image/png;base64," + base64.b64encode(stream.getvalue()).decode("ascii")}


def raster(path, size=256):
    with Image.open(path) as source:
        image = source.convert("RGBA")
        canvas = Image.new("RGBA", image.size, (70,70,70,255))
        canvas.alpha_composite(image)
        # Preserve aspect ratio and pixel edges; never stretch the sprite.
        image = canvas.convert("RGB")
        image.thumbnail((size,size), Image.Resampling.NEAREST) if max(image.size)>size else None
        scale = min(size/image.width, size/image.height)
        image = image.resize((round(image.width*scale), round(image.height*scale)), Image.Resampling.NEAREST)
        result = Image.new("RGB", (size,size), (70,70,70))
        result.paste(image, ((size-image.width)//2,(size-image.height)//2))
        return result


def verification_content(paths, reference, issues):
    content = [{"type":"input_text", "text":
        "Independently fact-check tentative findings; assume the first reviewer may be wrong. "
        "Each panel labels REF and exact 1-based animation frames in reading order. "
        "REF is NOT a motion frame. Describe visible pixels in EACH cited frame before deciding. "
        "Do not repeat an allegation as evidence. A changed blade direction is normally allowed during a swing; "
        "occlusion, perspective/foreshortening, smear frames, attached costume and trails do not prove a flip or a second attack. "
        "An extra attack requires another complete attack cycle, not two bright marks. "
        "For identity drift compare REF with the body/outfit: separate new clothing, armor color changes and weapon colors from detached effects. "
        "Use uncertain if grip/tip/body cannot be resolved, timing is insufficient or evidence conflicts. "
        "Confirm only clear, localized defects at confidence >=0.9. Dismiss plausible normal motion. "
        "Observations and reasons in Chinese; phase is intended phase, unknown if unsure. "
        "In decisions assess ONLY provided issue indices. The separate stages field must still audit the entire required action."}]
    included = {}
    # Prioritize appearance discrepancies; unexplored findings stay unconfirmed.
    order = sorted(range(len(issues)), key=lambda i: issues[i]['code'] != 'identity_drift')
    for index in order:
        issue = issues[index]
        context = sorted({j for f in issue['frames'] for j in (f-1,f,f+1) if 1<=j<=len(paths)})
        if len(context)>MAX_CONTEXT_FRAMES or len(included)>=MAX_VERIFIED_ISSUES:
            continue
        included[index] = context
        tiles = [('REF (not a frame)',reference)] + [(f'FRAME {i}/{len(paths)}',paths[i-1]) for i in context]
        columns = min(4,len(tiles)); rows = math.ceil(len(tiles)/columns)
        board = Image.new('RGB',(columns*256,rows*280),(25,30,40))
        draw = ImageDraw.Draw(board)
        for position,(label,path) in enumerate(tiles):
            x=(position%columns)*256; y=(position//columns)*280
            draw.text((x+8,y+6),label,fill='white')
            board.paste(raster(path),(x,y+24))
        content.extend([{'type':'input_text','text':f"Tentative issue {index}: {issue['code']}; claimed frames {issue['frames']}; claim: {issue['description']}"},image_part(board)])
    return content, included


def verified_issues(initial, verification, included, paths):
    decisions = {d.issue_index:d for d in verification.decisions}
    if len(decisions)!=len(verification.decisions) or set(decisions)-set(included):
        raise ValueError('unexpected or repeated verification issue index')
    confirmed=[]; audit=[]
    for index,issue in enumerate(initial):
        d=decisions.get(index)
        supported=False
        if d:
            observed={o.frame for o in d.observations}
            if not observed<=set(included[index]):
                raise ValueError('verification observation outside supplied panel')
            supported=(d.decision=='confirmed' and d.confidence>=0.9 and set(issue['frames'])<=observed)
            if issue['code'] in {'weapon_flip','early_swing','second_windup','extra_strike','body_discontinuity'} and len(observed)<2:
                supported=False
            # Byte-identical adjacent drawings cannot show a weapon flip between them.
            if issue['code'] in {'weapon_flip','body_discontinuity','extra_strike'} and len(issue['frames'])>=2:
                pixels=[]
                for frame in issue['frames']:
                    with Image.open(paths[frame-1]) as image: pixels.append(image.convert('RGBA').tobytes())
                if len(set(pixels))==1:
                    supported=False
            audit.append({'issue_index':index,**d.model_dump(), 'accepted':supported})
        else:
            audit.append({'issue_index':index,'decision':'uncertain','accepted':False,'reason':'未在复核预算内取得充分证据'})
        if supported:
            confirmed.append({**issue,'description':d.reason,'phase':d.phase,'phase_confidence':d.phase_confidence,
                              'evidence_status':'confirmed','evidence_confidence':d.confidence})
    return confirmed,audit
