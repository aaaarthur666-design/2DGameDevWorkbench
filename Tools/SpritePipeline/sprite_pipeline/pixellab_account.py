"""Durable FIFO shared by PixelLab image and animation submissions.

The slot lasts until the upstream job ends, rather than only during its POST.
Unknown submissions deliberately keep the slot: a timeout is not evidence that
the account is free and must never cause another chargeable request.
"""
from __future__ import annotations

import hashlib
import math
from contextlib import contextmanager
from datetime import datetime, timezone

from .errors import ProviderError, ProviderPermanentError, ProviderTemporaryError
from .jsonio import atomic_write_json, read_json


class PixelLabQueued(ProviderTemporaryError):
    code = "provider_queued"


class PixelLabAccountQueue:
    def __init__(self, store, key, base_url):
        self.store = store
        origin = base_url.rstrip('/').removesuffix('/v2')
        self.identity = hashlib.sha256((origin + '\n' + key).encode()).hexdigest()
        self.path = store.settings.jobs_dir / '.pixellab-accounts' / (self.identity + '.json')

    def _load(self):
        state = read_json(self.path) if self.path.exists() else {'version': 1, 'waiting': [], 'active': None}
        state.setdefault('receipts', {})
        return state

    def _save(self, state):
        state['updated_at'] = datetime.now(timezone.utc).isoformat()
        atomic_write_json(self.path, state)

    @contextmanager
    def locked(self):
        with self.store.global_lock('pixellab-account-' + self.identity, timeout_seconds=90):
            yield

    def reserve(self, request_key, poll):
        """Enqueue once; GET an earlier accepted job before freeing its slot."""
        with self.locked():
            state = self._load()
            # A stopped plan has retained its request intent but no longer
            # authorizes a future POST. It must not hold the FIFO head forever.
            state['waiting'] = [key for key in state['waiting'] if self._still_waiting(key)]
            active = state['active']
            receipt = state['receipts'].get(request_key)
            if receipt and receipt['state'] in {'submitting', 'pending', 'unknown', 'completed', 'failed'}:
                raise ProviderPermanentError('此 PixelLab 请求已有提交记录，禁止重复生成；请查询或恢复原请求。',
                    details={'submission_unknown': True, 'safe_to_retry': False, **receipt})
            if active and active['request_key'] == request_key and active['state'] == 'reserved':
                state['active'] = active = None
            if request_key not in state['waiting'] and (not active or active['request_key'] != request_key):
                state['waiting'].append(request_key)
            if active and active.get('provider_job_id'):
                self._save(state)  # A transient GET failure must not lose the enqueued intent.
                remote = poll(active['provider_job_id'])
                if remote in {'completed', 'failed'}:
                    state['receipts'][active['request_key']] = {**active, 'state': remote}
                    state['active'] = active = None
            if active or not state['waiting'] or state['waiting'][0] != request_key:
                self._save(state)
                raise PixelLabQueued('同一 PixelLab 账户的前一任务尚未结束，已排队，尚未提交生成。', details={
                    'submission_created': False, 'queued': True,
                    'queue_position': state['waiting'].index(request_key) + 1 if request_key in state['waiting'] else 0,
                    'active_state': active.get('state') if active else None,
                })
            state['waiting'].pop(0)
            state['active'] = {'request_key': request_key, 'state': 'reserved'}
            self._save(state)

    def _still_waiting(self, request_key):
        if ':candidate:' not in request_key:
            return True
        job_id = request_key.split(':candidate:', 1)[0]
        try:
            job = self.store.load(job_id)
            return not job.request.open_plan or bool(job.plan_control and job.plan_control.enabled)
        except Exception:
            # Unreadable evidence is not proof that a queued authorization ended.
            return True

    def attach(self, request_key, provider_job_id):
        """Recover the existing slot after an explicit upstream-ID attachment."""
        self._update(request_key, state='pending', provider_job_id=provider_job_id)

    def _update(self, request_key, **fields):
        with self.locked():
            state = self._load()
            if not state['active'] or state['active']['request_key'] != request_key:
                raise ProviderTemporaryError('PixelLab 账户提交记录不匹配；未自动重试。', details={'submission_unknown': True})
            state['active'].update(fields)
            if fields.get('state') in {'submitting', 'pending', 'unknown'}:
                state['receipts'][request_key] = dict(state['active'])
            self._save(state)

    def receipt(self, request_key):
        with self.locked():
            return self._load()['receipts'].get(request_key)

    def release(self, request_key):
        with self.locked():
            state = self._load()
            if state['active'] and state['active']['request_key'] == request_key:
                active = state['active']
                if active.get('provider_job_id'):
                    state['receipts'][request_key] = {**active, 'state': 'completed'}
                elif active['state'] == 'submitting':
                    state['receipts'][request_key] = {**active, 'state': 'not_submitted'}
                state['active'] = None
            state['waiting'] = [key for key in state['waiting'] if key != request_key]
            self._save(state)

    def submit(self, request_key, poll, preflight, submit, job_id):
        self.reserve(request_key, poll)
        try:
            evidence = preflight()
        except Exception as exc:
            self.release(request_key)
            if isinstance(exc, ProviderError):
                exc.details.update(submission_created=False, submission_unknown=False, phase='balance_preflight')
            raise
        self._update(request_key, state='submitting')
        try:
            result = submit()
        except Exception as exc:
            if isinstance(exc, ProviderError) and not exc.details.get('submission_unknown', False):
                self.release(request_key)
                exc.details['submission_created'] = False
            else:
                self._update(request_key, state='unknown')
            raise
        remote = job_id(result)
        self._update(request_key, state='pending', provider_job_id=remote)
        return result, evidence


def remaining_generations(balance):
    subscription = balance.get('subscription') if isinstance(balance, dict) else None
    if not isinstance(subscription, dict):
        return None
    for name in ('generations', 'remaining', 'remaining_generations', 'generations_remaining'):
        value = subscription.get(name)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            return max(0, value)
    return None


def require_balance(balance, required=1):
    remaining = remaining_generations(balance)
    if remaining is not None and remaining < required:
        raise ProviderPermanentError('PixelLab 额度不足，尚未提交生成。', details={
            'code': 'insufficient_quota', 'submission_created': False,
            'balance': balance, 'remaining': remaining, 'required': required,
        })
    return balance


def submission_state(job):
    candidates = job.candidates
    if any(candidate.frames or candidate.provider_job_id or candidate.status.value == 'submission_unknown' for candidate in candidates):
        return None
    if any((candidate.error or {}).get('code') == 'provider_queued' for candidate in candidates):
        return 'queued'
    if any((candidate.error or {}).get('code') == 'insufficient_quota' or
           ((candidate.error or {}).get('details', {}).get('submission_created') is False and
            not (candidate.error or {}).get('details', {}).get('submission_unknown')) for candidate in candidates):
        return 'not_submitted'
    return None


