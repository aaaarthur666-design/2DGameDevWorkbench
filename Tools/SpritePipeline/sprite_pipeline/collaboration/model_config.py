"""Protected provider credentials, public role profiles and immutable task snapshots."""
from __future__ import annotations

import os
from typing import Literal
from pydantic import Field, model_validator
from ..credential_store import CredentialStore
from ..errors import ValidationHarnessError
from ..jsonio import atomic_write_json, read_json
from ..vision_review import VisionReviewer, PROVIDERS
from .contracts import Contract

ROLES = ('appearance', 'motion', 'strategy', 'coordinator', 'reviewer')


class ModelProfile(Contract):
    provider: Literal['tokenhub', 'openai'] = 'tokenhub'
    model: str = Field(default='hy-vision-2.0-instruct', pattern=r'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$')
    max_output_tokens: int = Field(default=8000, ge=1024, le=32768)
    timeout_seconds: int = Field(default=180, ge=30, le=600)
    token_parameter: Literal['auto', 'max_tokens', 'max_completion_tokens'] = 'auto'
    reasoning_effort: Literal['auto', 'low', 'medium', 'high', 'max'] = 'auto'
    supports_images: bool = True

    @model_validator(mode='after')
    def supported(self):
        if not self.supports_images:
            raise ValueError('专家与验收必须使用支持图片输入的模型')
        if self.provider == 'tokenhub' and self.model in ('glm-5.2', 'glm-5.3'):
            raise ValueError('此 GLM 型号不支持图片输入；可使用 glm-5.3-flash 或 glm-5.3-flashx')
        if self.provider == 'tokenhub' and self.model in ('glm-5.3-flash', 'glm-5.3-flashx'):
            if self.reasoning_effort == 'medium':
                raise ValueError('此 GLM 模型不支持 medium 推理档位')
            if self.token_parameter not in ('auto', 'max_tokens'):
                raise ValueError('此 GLM 模型要求 max_tokens')
        if self.provider == 'tokenhub' and (self.model.startswith('kimi-k3') or self.model == 'kimi-k2.8-preview'):
            if self.reasoning_effort == 'medium':
                raise ValueError('此 Kimi 模型不支持 medium 推理档位')
            expected = 'max_completion_tokens' if self.model.startswith('kimi-k3') else 'max_tokens'
            if self.token_parameter not in ('auto', expected):
                raise ValueError(f'此 Kimi 模型要求 {expected}')
        return self


class ModelConfiguration(Contract):
    version: Literal[1] = 1
    default: ModelProfile = Field(default_factory=ModelProfile)
    roles: dict[Literal['appearance', 'motion', 'strategy', 'coordinator', 'reviewer'], ModelProfile] = Field(default_factory=dict)
    saved_models: list[ModelProfile] = Field(default_factory=list, max_length=24)


class ModelRegistry:
    def __init__(self, settings):
        self.settings = settings
        self.path = settings.config_dir / 'open_motion_models.json'

    def load(self):
        if self.path.exists():
            return ModelConfiguration.model_validate(read_json(self.path))
        legacy = VisionReviewer(self.settings)
        return ModelConfiguration(default=ModelProfile(provider='tokenhub' if legacy.provider == 'hunyuan' else 'openai', model=legacy.info['model']))

    def save(self, configuration):
        config = ModelConfiguration.model_validate(configuration)
        atomic_write_json(self.path, config.model_dump(mode='json'))
        return config

    def key(self, provider):
        info = PROVIDERS['hunyuan' if provider == 'tokenhub' else 'openai']
        return os.environ.get(info['key_env'], '').strip() or CredentialStore(self.settings.config_dir).get(info['key_name'])

    def save_key(self, provider, value):
        if not value or not value.strip():
            return  # Blank keeps the protected credential; clearing is never implicit.
        value=value.strip()
        self.validate_key(provider,value)
        info = PROVIDERS['hunyuan' if provider == 'tokenhub' else 'openai']
        CredentialStore(self.settings.config_dir).set(info['key_name'], value)

    def validate_key(self, provider, value):
        if not value or not value.strip():return
        value=value.strip()
        info = PROVIDERS['hunyuan' if provider == 'tokenhub' else 'openai']
        if os.environ.get(info['key_env'], '').strip():
            raise ValidationHarnessError('此服务 Key 由启动环境管理，不能在页面覆盖')
        if not 8 <= len(value) <= 4096 or any(not 33 <= ord(c) <= 126 for c in value):
            raise ValidationHarnessError('API Key 格式无效')

    def profile(self, role, snapshot=None):
        config = ModelConfiguration.model_validate(snapshot) if snapshot and 'default' in snapshot else self.load()
        return config.roles.get(role, config.default)

    def describe(self):
        config = self.load()
        ready = {p: bool(self.key(p)) for p in ('tokenhub', 'openai')}
        return {'configuration': config.model_dump(mode='json'),
                'services': [{'id': p, 'label': label, 'endpoint': PROVIDERS[legacy]['endpoint'], 'configured': ready[p],
                              'credential_source': 'environment' if os.environ.get(PROVIDERS[legacy]['key_env'],'').strip() else 'protected_local' if ready[p] else 'missing'}
                             for p, label, legacy in [('tokenhub', '腾讯云 TokenHub', 'hunyuan'), ('openai', 'OpenAI', 'openai')]],
                'effective_roles': {role: {**self.profile(role).model_dump(mode='json'), 'configured': ready[self.profile(role).provider]} for role in ROLES},
                'planning_configured': all(ready[self.profile(role).provider] for role in ROLES),
                'provider': 'hunyuan' if config.default.provider == 'tokenhub' else 'openai', 'model': config.default.model}

    def send(self, role, content, schema, frame_count, *, snapshot=None, on_request=None, on_response=None, schema_name='open_motion_plan'):
        profile = self.profile(role, snapshot)
        key = self.key(profile.provider)
        if not key:
            raise ValidationHarnessError(f'{role} 的 API Key 尚未配置；未发送请求')
        provider = 'hunyuan' if profile.provider == 'tokenhub' else 'openai'
        return VisionReviewer(self.settings)._send(content, schema, provider, key, frame_count, on_request,
            schema_name=schema_name, on_response=on_response, model_options=profile.model_dump(mode='json'))
