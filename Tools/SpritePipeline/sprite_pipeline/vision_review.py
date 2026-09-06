"""Bounded, structured visual review. Never retries a potentially billed request."""
from __future__ import annotations
import base64
import io
import json
import os
from pathlib import Path
from typing import Literal
import httpx
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .credential_store import CredentialStore
from .errors import ValidationHarnessError
from .jsonio import atomic_write_json, read_json

MAX_REVIEW_FRAMES = 64
MODEL = "gpt-5.4-2026-03-05"
HUNYUAN_MODEL = "hy-vision-2.0-instruct"
PROVIDERS = {
    "hunyuan": {"label":"混元 HY Vision 2.0", "model":HUNYUAN_MODEL,
                "endpoint":"https://tokenhub.tencentmaas.com/v1/chat/completions",
                "key_env":"TOKENHUB_API_KEY", "key_name":"motion_hunyuan_api_key"},
    "openai": {"label":"OpenAI GPT-5.4", "model":MODEL,
               "endpoint":"https://api.openai.com/v1/responses",
               "key_env":"OPENAI_API_KEY", "key_name":"motion_vision_api_key"},
}

class MotionIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: Literal["early_swing", "weapon_flip", "second_windup", "extra_strike", "body_discontinuity", "identity_drift", "other"]
    frames: list[int] = Field(min_length=1, max_length=MAX_REVIEW_FRAMES)
    description: str = Field(max_length=500)
    correction: str = Field(max_length=500)

class MotionReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verdict: Literal["pass", "fail", "uncertain"]
    confidence: float = Field(ge=0, le=1)
    summary: str = Field(max_length=800)
    issues: list[MotionIssue] = Field(max_length=MAX_REVIEW_FRAMES)

    @model_validator(mode="after")
    def consistent(self):
        if self.verdict == "pass" and self.issues:
            raise ValueError("passing review cannot contain unresolved issues")
        if self.verdict == "fail" and not self.issues:
            raise ValueError("failing review needs localized evidence")
        return self

def contract(action_id: str, frame_count: int = 16) -> str:
    common = "Exactly ONE attack. Maintain facing, grip, weapon length and blade orientation continuously. No early strike, teleporting blade, repeated windup or second strike. "
    if frame_count != 16:
        phases = ("prepare, ONE swing, extend, follow through, recover along ONE continuous airborne arc; no extra jump or landing reset."
                  if action_id == "attack_in_air" else
                  "raise blade BEHIND shoulder, charge with blade still behind, ONE forward high-to-low strike, follow through, recover. Feet remain grounded; charge holds are allowed.")
        return (common + f"Inspect ALL {frame_count} actual frames in order. Frame 1 is the original pose. Phase order: "
                + phases + " Phase boundaries depend on the visible motion, not fixed frame numbers. Never drop, duplicate or force frames into a 16-frame layout. "
                + ("A single frame cannot prove temporal continuity: verdict must be uncertain." if frame_count == 1 else ""))
    if action_id == "attack_in_air":
        return common + "Frames 1-4 prepare; 5-8 one continuous swing; 9-10 extend; 11-13 follow through; 14-16 recover. The body follows one continuous airborne arc, no extra jump or landing reset."
    return common + "Frame 1 original pose; 2-4 raise weapon BEHIND shoulder; 5-7 charge with blade still behind; 8-10 the ONLY forward strike; 11-13 follow through; 14-16 recover. Charge holds may repeat. Feet remain grounded."

class VisionReviewer:
    def __init__(self, settings):
        self.settings = settings

    @property
    def provider(self):
        value=os.environ.get("SPRITE_PIPELINE_VISION_PROVIDER", "").strip()
        path=self.settings.config_dir/"motion_vision.json"
        if not value:
            value=read_json(path).get("provider") if path.exists() else "hunyuan"
        if value not in PROVIDERS:
            raise ValidationHarnessError("视觉检查服务配置无效，请在设置中重新选择")
        return value

    @property
    def info(self):
        return PROVIDERS[self.provider]

    def select(self, provider):
        if provider not in PROVIDERS:
            raise ValidationHarnessError("不支持的视觉检查服务")
        override=os.environ.get("SPRITE_PIPELINE_VISION_PROVIDER", "").strip()
        if override and override != provider:
            raise ValidationHarnessError("视觉检查服务由启动环境管理")
        atomic_write_json(self.settings.config_dir/"motion_vision.json", {"provider":provider})

    def key(self):
        info=self.info
        return os.environ.get(info["key_env"], "").strip() or CredentialStore(self.settings.config_dir).get(info["key_name"])

    def save_key(self, value):
        info=self.info
        if os.environ.get(info["key_env"], "").strip():
            raise ValidationHarnessError("当前视觉 Key 由启动环境管理")
        key=(value or "").strip()
        if key and (not 8 <= len(key) <= 4096 or any(not 33 <= ord(ch) <= 126 for ch in key)):
            raise ValidationHarnessError("视觉检查 Key 格式无效")
        CredentialStore(self.settings.config_dir).set(info["key_name"],key or None)

    @property
    def configured(self):
        return bool(self.key())

    @staticmethod
    def validate_inputs(paths: list[Path], reference: Path) -> None:
        if not 1 <= len(paths) <= MAX_REVIEW_FRAMES:
            raise ValidationHarnessError(f"视觉检查支持 1–{MAX_REVIEW_FRAMES} 帧；实际收到 {len(paths)} 帧，尚未发送请求")
        try:
            for path in [reference, *paths]:
                with Image.open(path) as source:
                    if not 1 <= source.width <= 512 or not 1 <= source.height <= 512:
                        raise ValueError("unsupported image size")
                    source.verify()
        except Exception:
            raise ValidationHarnessError("视觉检查参考图或动画帧无法读取；尚未发送请求") from None

    def review(self, paths: list[Path], action_id: str, reference: Path, *, on_request=None) -> dict:
        self.validate_inputs(paths, reference)
        frame_count = len(paths)
        provider = self.provider
        info = PROVIDERS[provider]
        key = self.key()
        if not key:
            raise ValidationHarnessError("请在设置中保存视觉检查 API Key；自动补做已暂停")
        content = [{"type":"input_text", "text":
            f"Review this ordered {frame_count}-frame pixel-art attack against the contract. "
            "Inspect every adjacent transition, blade tip relative to grip/shoulder, and whole-sequence timing. "
            "Distinguish occlusion from real reversal. Never infer success from the prompt. "
            "If pixels cannot establish continuity, verdict uncertain. Identify only actual faulty frames (1-based). "
            "Give concise Chinese evidence and English edit instructions. No aesthetic nitpicks. " + contract(action_id, frame_count)}]
        for label, path in [("Character reference (not animation frame)", reference), *[(f"Frame {i+1}/{frame_count}", p) for i,p in enumerate(paths)]]:
            with Image.open(path) as original:
                rgba=original.convert("RGBA")
                backdrop=Image.new("RGBA", rgba.size, (70,70,70,255))
                backdrop.alpha_composite(rgba)
                canvas=backdrop.convert("RGB").resize((512,512), Image.Resampling.NEAREST)
                stream=io.BytesIO(); canvas.save(stream, format="PNG")
            content.extend([{"type":"input_text", "text":label}, {"type":"input_image", "detail":"high", "image_url":"data:image/png;base64,"+base64.b64encode(stream.getvalue()).decode("ascii")}])
        schema = MotionReview.model_json_schema()
        schema["$defs"]["MotionIssue"]["properties"]["frames"]["items"].update(minimum=1, maximum=frame_count)
        body = {"model":MODEL, "store":False, "reasoning":{"effort":"high"}, "max_output_tokens":6000,
            "input":[{"role":"user", "content":content}],
            "text":{"format":{"type":"json_schema", "name":"attack_motion_review", "strict":True, "schema":schema}}}
        if provider == "hunyuan":
            chat_content=[]
            for part in content:
                if part["type"]=="input_text":
                    chat_content.append({"type":"text","text":part["text"]})
                else:
                    chat_content.append({"type":"image_url","image_url":{"url":part["image_url"],"detail":"high"}})
            chat_content.append({"type":"text","text":"Return exactly one JSON object matching this schema, without prose or Markdown. " + json.dumps(schema,ensure_ascii=False)})
            body={"model":info["model"],"stream":False,"temperature":0,"max_tokens":6000,
                  "messages":[{"role":"user","content":chat_content}],"response_format":{"type":"json_object"}}
        try:
            with httpx.Client(timeout=180, follow_redirects=False) as client:
                if on_request is not None:
                    on_request()
                response=client.post(info["endpoint"], headers={"Authorization":"Bearer "+key}, json=body)
            if response.status_code != 200:
                raise ValidationHarnessError(f"视觉检查请求失败（HTTP {response.status_code}）；未自动重试")
            data=response.json()
            if provider == "hunyuan":
                choices=data.get("choices",[])
                if len(choices)!=1 or choices[0].get("finish_reason")!="stop":
                    raise ValueError("incomplete visual review")
                message=choices[0].get("message",{})
                if message.get("refusal") or message.get("tool_calls"):
                    raise ValueError("visual review refused")
                output=message.get("content")
            else:
                if data.get("status") != "completed":
                    raise ValueError("incomplete visual review")
                output="".join(part.get("text", "") for item in data.get("output", []) if item.get("type")=="message" for part in item.get("content", []) if part.get("type")=="output_text")
            result=MotionReview.model_validate_json(output)
            if any(i < 1 or i > frame_count for issue in result.issues for i in issue.frames):
                raise ValueError("invalid frame index")
            if frame_count == 1 and result.verdict == "pass":
                raise ValueError("one frame cannot establish continuous motion")
            return {**result.model_dump(), "frame_count":frame_count, "provider":provider, "model":info["model"], "usage":data.get("usage", {}), "response_id":data.get("id")}
        except ValidationHarnessError:
            raise
        except Exception:
            # Never persist provider response bodies or headers containing secrets.
            raise ValidationHarnessError("视觉检查未取得有效结论；已停止自动补做，不会自动重试") from None
