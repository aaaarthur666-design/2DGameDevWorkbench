"""PLAN-01: bounded role-local corrections and revision-safe evidence reuse."""
import copy
import json
import uuid
from collections import Counter

import pytest

from test_open_motion import setup, spec
from test_executable_brief import BriefPlanner
from sprite_pipeline.collaboration.model_config import ModelConfiguration
from sprite_pipeline.collaboration.planning import PlanningModel
from sprite_pipeline.errors import ValidationHarnessError


class EvidencePlanner(BriefPlanner):
    def __call__(self, role, work, reference, **kwargs):
        turn, receipt = super().__call__(role, work, reference, **kwargs)
        if role != 'coordinator':
            turn['findings'] = [{'text': f'{role}: 保持原图可见约束与用户动作要求',
                                 'source': 'reference', 'evidence': '原图与原始需求'}]
            if role == 'strategy':
                turn['proposal'] = super().__call__('coordinator', work, reference, **kwargs)[0]['plan']
        return turn, receipt


def create(ws, value=None):
    return ws.create(value or spec(), uuid.uuid4().hex, planning_authorized=True)


def revised(ws, work, value=None):
    return ws.revise(work.id, work.revision, value or work.spec, uuid.uuid4().hex, planning_authorized=True)


def mutate(turn, case):
    if case == 'findings':
        turn['findings'][0]['text'] = 'x' * 301
    elif case == 'question':
        turn['question'] = {'text': '错误的非字符串问题'}
    elif case == 'appearance':
        turn['plan']['quality']['appearance_contract'] = 'x' * 181
    elif case == 'frames':
        turn['plan']['stages'][0]['frame_count'] = 5
    elif case == 'parts':
        turn['plan']['stages'][0]['structure_usage'] = {
            'part_ids': [], 'anchor_ids': [], 'relation_ids': [], 'effect': 'Keep observed ownership.'}
    elif case == 'reason':
        turn['plan']['stages'][0]['checkpoint']['reason'] = 'x' * 181


@pytest.mark.parametrize('case,role,field', [
    ('findings', 'motion', 'findings.0.text'), ('question', 'strategy', 'question'),
    ('appearance', 'coordinator', 'plan.quality.appearance_contract'),
    ('frames', 'coordinator', 'plan.stages.0'),
    ('parts', 'coordinator', 'plan.stages.0.structure_usage.part_ids'),
    ('reason', 'coordinator', 'plan.stages.0.checkpoint.reason'),
])
def test_only_invalid_role_gets_one_correction_and_values_are_not_coerced(setup, case, role, field):
    _, ws, _, provider, _ = setup
    seen = Counter()
    raw = []
    class InvalidOnce(EvidencePlanner):
        def __call__(self, current, work, reference, **kwargs):
            seen[current] += 1
            turn, receipt = super().__call__(current, work, reference, **kwargs)
            if current == role and seen[current] == 1:
                mutate(turn, case)
                raw.append(copy.deepcopy(turn))
            if current == role and seen[current] == 2:
                assert field in kwargs['question']
                assert 'one correction turn' in kwargs['question']
                assert 'Preserve the original user intent' in kwargs['question']
            return turn, {**receipt, 'response_id': f'{current}-{seen[current]}', 'usage': {'total_tokens': 12}}
    ws.model = InvalidOnce()
    work = ws.plan(create(ws).id)
    assert work.status == 'ready', work.message
    assert seen == Counter({'appearance': 1, 'motion': 1, 'strategy': 1, 'coordinator': 1, role: 2})
    assert len(work.planning_calls) == 5 and not provider.requests and not work.job_id
    invalid = next(call for call in work.planning_calls if call['state'] == 'invalid_response')
    correction = next(call for call in work.planning_calls if call.get('correction_of'))
    assert correction['role'] == invalid['role'] == role
    assert correction['correction_of'] == invalid['request_id']
    assert invalid['validation_errors'][0]['field'] == field
    assert invalid['usage']['total_tokens'] == correction['usage']['total_tokens'] == 12
    assert all(not message['question'] for message in work.messages)
    expected, _ = EvidencePlanner()('coordinator', work, ws.reference(work))
    assert work.plan.stages[0].frame_count == expected['plan']['stages'][0]['frame_count']
    assert work.plan.quality.appearance_contract == expected['plan']['quality']['appearance_contract']
    # An invalid proposal never becomes the accepted plan by server-side truncation/rounding.
    assert raw and raw[0] != next(m['response'] for m in work.messages if m['role'] == role)


def test_completed_wire_schema_failure_preserves_receipts_and_targets_feedback(setup, monkeypatch):
    service, ws, _, provider, _ = setup
    model = PlanningModel(service.settings)
    model.registry.save(ModelConfiguration())
    monkeypatch.setattr(model.registry, 'key', lambda _: 'offline-test-key')
    ws.model = model
    work = create(ws)
    roles = ['appearance', 'motion', 'motion', 'strategy', 'coordinator']
    requests = []
    class Response:
        status_code = 200
        def __init__(self, payload): self.payload = payload
        def json(self): return self.payload
    class Client:
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def post(self, *_, **kwargs):
            index = len(requests)
            text = kwargs['json']['messages'][0]['content'][0]['text']
            requests.append(json.loads(text.split('TASK DATA:\n', 1)[1]))
            assert 'question is always a JSON string' in text
            assert 'checkpoint.reason <=180' in text
            assert 'even integer in [4,6,8,10,12,14,16]' in text
            turn, _ = EvidencePlanner()(roles[index], work, ws.reference(work))
            if index == 1: mutate(turn, 'findings')
            return Response({'id': f'offline-wire-{index}', 'model': 'hy-vision-2.0-instruct',
                'usage': {'total_tokens': 20}, 'choices': [{'finish_reason': 'stop',
                'message': {'content': json.dumps(turn, ensure_ascii=False)}}]})
    monkeypatch.setattr('sprite_pipeline.vision_review.httpx.Client', lambda **_: Client())
    result = ws.plan(work.id)
    assert result.status == 'ready', result.message
    assert [call['role'] for call in result.planning_calls] == roles
    bad = result.planning_calls[1]
    assert bad['state'] == 'invalid_response' and bad['response_id'] == 'offline-wire-1'
    assert bad['output_sha256'] and bad['validation_errors'][0]['field'] == 'findings.0.text'
    assert sum(call['usage']['total_tokens'] for call in result.planning_calls) == 100
    assert 'findings.0.text' in requests[2]['question']
    assert all(not request['question'] for request in requests[3:])
    assert all('Schema errors' not in json.dumps(request['peer_messages']) for request in requests[3:])
    assert not provider.requests and not result.job_id


@pytest.mark.parametrize('receipt', [
    {}, {'http_status': 500}, {'response_id': 'known-invalid-without-schema-diagnostics'},
    {'output_sha256': 'a' * 64, 'structured_validation_failed': True, 'finish_reason': 'length'},
    {'output_sha256': 'a' * 64, 'structured_validation_failed': True,
     'requested_model': 'requested', 'response_model': 'different'},
])
def test_ambiguous_incomplete_or_mismatched_requests_are_never_corrected(setup, receipt):
    _, ws, _, provider, _ = setup
    calls = []
    class Failed(EvidencePlanner):
        def __call__(self, *args, **kwargs):
            calls.append(True)
            raise ValidationHarnessError('模拟未知、未完成或非校验失败', details={'model_receipt': receipt})
    ws.model = Failed()
    result = ws.plan(create(ws).id)
    ws.plan(result.id)
    ws.recover_planning()
    assert result.status == 'planning_failed' and len(calls) == 1 and not provider.requests


def test_twice_invalid_stops_then_revise_reuses_only_completed_specialists(setup):
    _, ws, _, provider, _ = setup
    failing = True
    class FailingStrategy(EvidencePlanner):
        def __call__(self, role, *args, **kwargs):
            turn, receipt = super().__call__(role, *args, **kwargs)
            if failing and role == 'strategy': mutate(turn, 'question')
            return turn, receipt
    ws.model = FailingStrategy()
    failed = ws.plan(create(ws).id)
    assert failed.status == 'planning_failed' and '一次结构化修正' in failed.message
    assert [c['role'] for c in failed.planning_calls] == ['appearance', 'motion', 'strategy', 'strategy']
    before = copy.deepcopy(failed.messages)
    ws.plan(failed.id)
    ws.recover_planning()
    assert ws.load(failed.id).planning_calls == failed.planning_calls
    failing = False
    new = revised(ws, failed)
    assert new.planning_calls == []
    assert [m['role'] for m in new.messages] == ['appearance', 'motion']
    assert [m['response'] for m in new.messages] == [m['response'] for m in before]
    assert all(m['reused_from']['revision'] == 1 for m in new.messages)
    assert ws.load(new.id, 1).planning_calls == failed.planning_calls
    done = ws.plan(new.id)
    assert done.status == 'ready', done.message
    assert [c['role'] for c in done.planning_calls] == ['strategy', 'coordinator']
    assert not provider.requests


def test_correction_never_exceeds_authorized_cap_and_revision_keeps_three_proposals(setup):
    _, ws, _, provider, _ = setup
    broken = True
    class LastRoleFailure(EvidencePlanner):
        def __call__(self, role, *args, **kwargs):
            turn, receipt = super().__call__(role, *args, **kwargs)
            if broken and role == 'coordinator': mutate(turn, 'reason')
            return turn, receipt
    ws.model = LastRoleFailure()
    failed = ws.plan(create(ws, spec(budget={'max_planning_calls': 4})).id)
    assert failed.status == 'planning_failed' and len(failed.planning_calls) == 4
    broken = False
    done = ws.plan(revised(ws, failed).id)
    assert done.status == 'ready', done.message
    assert [c['role'] for c in done.planning_calls] == ['coordinator']
    again = ws.plan(revised(ws, done).id)
    assert [c['role'] for c in again.planning_calls] == ['coordinator']
    assert all(m['reused_from']['revision'] == 1 for m in again.messages[:3])
    assert not provider.requests


@pytest.mark.parametrize('change,expected', [
    ('budget', ['strategy', 'coordinator']), ('coordinator_model', ['coordinator']),
    ('motion_model', ['motion', 'strategy', 'coordinator']),
    ('description', ['appearance', 'motion', 'strategy', 'coordinator']),
    ('reference', ['appearance', 'motion', 'strategy', 'coordinator']),
])
def test_reuse_invalidates_changed_role_dependencies(setup, change, expected):
    _, ws, _, provider, fixture = setup
    planner = EvidencePlanner()
    planner.configuration = ModelConfiguration().model_dump(mode='json')
    ws.model = planner
    original = ws.plan(create(ws).id)
    value = original.spec
    if change == 'budget':
        value = spec(budget={'max_generation_calls': 3})
    elif change.endswith('_model'):
        role = change.removesuffix('_model')
        planner.configuration = copy.deepcopy(planner.configuration)
        planner.configuration['roles'][role] = {**planner.configuration['default'], 'model': 'changed-model'}
    elif change == 'description':
        value = spec('角色摘帽后坐下，结束时保持坐姿')
    elif change == 'reference':
        fixture.write_frame(fixture.reference_path, shift_x=1)
    new = ws.plan(revised(ws, original, value).id)
    assert new.status == 'ready', new.message
    assert [c['role'] for c in new.planning_calls] == expected
    assert not provider.requests


def test_local_plan_rejection_gets_only_one_coordinator_correction(setup):
    _, ws, _, provider, _ = setup
    class ChangingInvalidPlan(EvidencePlanner):
        count = 0
        def __call__(self, role, *args, **kwargs):
            turn, receipt = super().__call__(role, *args, **kwargs)
            if role == 'coordinator':
                self.count += 1
                turn['plan']['summary'] += str(self.count)
            return turn, receipt
    ws.model = ChangingInvalidPlan()
    work = ws.plan(create(ws, spec(budget={'max_generation_calls': 1})).id)
    assert work.status == 'planning_failed' and '一次修正' in work.message
    assert [c['role'] for c in work.planning_calls] == ['appearance', 'motion', 'strategy', 'coordinator', 'coordinator']
    assert not provider.requests
