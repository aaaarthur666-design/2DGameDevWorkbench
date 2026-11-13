"""Two offline requests replay slices of one archived lamp clip. Decisions are scripted."""
from dataclasses import replace
from hashlib import sha256
import json

import pytest
from fastapi.testclient import TestClient

from test_interactable_motion import ARCHIVE, PropPlanner, workspace_for
from sprite_pipeline.api_app import create_api
from sprite_pipeline.collaboration.contracts import TaskSpec
from sprite_pipeline.collaboration.execution import PlanGeneration
from sprite_pipeline.errors import ConflictError
from sprite_pipeline.providers.fixture import FixtureProvider

A = 'Grey lamp face'
B = 'Partially illuminated lamp face'
C = 'Fully illuminated green lamp face'


class LampPlanner(PropPlanner):
    def __call__(self, role, work, reference, **kwargs):
        result, receipt = super().__call__(role, work, reference, **kwargs)
        if role == 'coordinator':
            plan = result['plan']
            quality = plan['quality']
            quality.update(event_contract=work.spec.description, appearance_contract='Keep the housing fixed.',
                           ending_contract=C, rhythm_contract='Light the lens in two steps.')
            quality['interactable'].update(initial_state=A, target_state=C, endpoint=C)
            stage = plan['stages'][0]
            stage.update(frame_count=4, name='Begin illumination', goal=B, prompt='Begin lighting the grey lens.')
            stage['checkpoint']['endpoint'] = B
            plan['stages'].append({**stage, 'first_frame': 'previous_end', 'name': 'Finish illumination',
                                   'goal': C, 'prompt': 'Finish lighting the lens and settle at green.',
                                   'checkpoint': {**stage['checkpoint'], 'endpoint': C}})
        return result, receipt


class ArchiveProvider(FixtureProvider):
    diagnostic_only = False  # Exercise production review with the scripted registry.

    def __init__(self):
        super().__init__()
        self.inputs = []
        self.outputs = {}
        self.archive = [p.read_bytes() for p in sorted((ARCHIVE/'lamp/seed-2202').glob('f*.png'))]

    def submit(self, request):
        receipt = super().submit(request)
        frames = [self.archive[:5], self.archive[3:8]][len(self.inputs)]
        self.inputs.append(request.reference_image)
        self.outputs[receipt.provider_job_id] = frames
        return replace(receipt, diagnostic_only=False)

    def wait(self, identity):
        return replace(super().wait(identity), images=self.outputs[identity], diagnostic_only=False)


@pytest.fixture
def chain(tmp_path, monkeypatch):
    service, ws = workspace_for(tmp_path, 'lamp', seed=2202)
    ws.model = LampPlanner('lamp')
    provider = ArchiveProvider()
    monkeypatch.setattr('sprite_pipeline.providers.get_provider', lambda *args: provider)
    spec = TaskSpec(object_type='interactable', object_id='lamp', provider='fixture',
                    description='Light the grey lens in two steps, from partly lit to fully green.')
    work = ws.create(spec, 'offline-lamp-chain', planning_authorized=True)
    plan = ws.plan(work.id)
    assert plan.status == 'ready', plan.message
    work = ws.start(work.id, plan.revision, plan.plan_sha256)
    engine = PlanGeneration(service)
    engine.advance(work.job_id, provider, wait=True)
    return service, work, engine, provider, TestClient(create_api(service=service), base_url='http://testserver/v1/open-motion/'+work.id+'/')


def decide(client, stage, decision, frame=None):
    evidence = client.get(f'candidates/1/stages/{stage}').json()
    body = dict(expected_revision=1, candidate_index=1, stage_index=stage, token=evidence['token'],
                decision=decision, note='Scripted archive decision', acknowledge_warnings=True,
                anchor_frame=frame, acknowledge_trim=True)
    response = client.post('review-stage', json=body)
    assert response.status_code == 200, response.text
    return response.json()['job']['candidates'][0]['state_chain']


def test_archive_chain_from_selected_pixels_to_next_request(chain):
    service, work, engine, provider, client = chain
    source = (ARCHIVE/'lamp/A.png').read_bytes()
    assert provider.inputs == [source]
    stages = 'candidates/1/stages/'
    view = client.get(stages+'0').json()
    assert view['transition'] == {'from_state': A, 'to_state': B}
    assert view['review']['state'] == 'complete'
    assert client.get(stages+'0/state-image').status_code == 409
    states = decide(client, 0, 'accept_state', 2)
    assert [s['name'] for s in states] == [A, B]
    assert states[0]['sha256'] == sha256(source).hexdigest()
    assert states[1]['transition_status'] == 'awaiting_review'
    assert states[1]['frame'] == 2 and states[1]['raw_index'] == 3
    endpoint = provider.archive[3]  # f04, before the excluded f05.
    assert states[1]['sha256'] == sha256(endpoint).hexdigest() != sha256(provider.archive[4]).hexdigest()
    assert client.get(stages+'0/state-image').content == client.get('progress-image').content == endpoint
    assert client.post('resume', json={'expected_revision': 1}).status_code == 409
    engine.advance(work.job_id, provider, wait=True)
    assert provider.inputs == [source]
    states = decide(client, 0, 'accept', 2)
    assert client.get('progress-image').content == endpoint
    assert states[1]['transition_status'] == 'accepted'
    engine.advance(work.job_id, provider, wait=True)
    assert provider.inputs == [source, endpoint]
    intent = json.loads((engine.directory(work.job_id, 1, 1)/'submit.intent.json').read_text())
    assert intent['first_sha256'] == states[1]['sha256']
    second = client.get(stages+'1').json()
    assert second['input_sha256'] == states[1]['sha256'] and second['context_removed']
    assert second['transition'] == {'from_state': B, 'to_state': C}
    assert second['review']['state'] == 'complete'
    states = decide(client, 1, 'accept')  # Full transition acceptance also registers C.
    assert [s['name'] for s in states] == [A, B, C]
    assert states[2]['frame'] == 3 and states[2]['raw_index'] == 4
    assert client.get(stages+'1').json()['state_image'] == states[2]
    assert client.get(stages+'1/state-image').content == provider.archive[7]
    assert sha256(provider.archive[7]).hexdigest() == states[2]['sha256']
    job = engine.advance(work.job_id, provider, wait=True)
    execution = job.candidates[0].plan_execution
    assert execution.quality_review['state'] == 'complete'
    assert [(row['from_state'], row['to_state'], row['input_sha256'], row['anchor_sha256'])
            for row in execution.timeline] == [(s['name'], t['name'], s['sha256'], t['sha256'])
                                               for s, t in zip(states, states[1:])]
    assert execution.timeline[0]['excluded_tail_count'] == 1
    assert execution.actual_frame_count == 9 and execution.timeline[1]['hold_frames'] == 2
    assert engine.saved_frames(work.job_id, 1, 0) == provider.archive[:5]
    assert len(provider.inputs) == 2
    for stage, (start, end) in enumerate([(A, B), (B, C)]):
        folder = service.store.job_dir(job.job_id)/'review-evidence/c1'
        manifest = json.loads(next(folder.glob(f's{stage}-*/evidence.json')).read_text())
        prop = manifest['context']['interactable']
        assert (prop['initial_state'], prop['target_state']) == (start, end)


@pytest.mark.parametrize('pin', [False, True])
def test_reject_stops_chain_and_preserves_only_confirmed_state(chain, pin):
    service, work, engine, provider, client = chain
    if pin:
        decide(client, 0, 'accept_state', 2)
    states = decide(client, 0, 'reject')
    assert [state['name'] for state in states] == ([A, B] if pin else [A])
    if pin:
        assert states[1]['transition_status'] == 'rejected'
        assert client.get('candidates/1/stages/0/state-image').content == provider.archive[3]
    assert client.post('resume', json={'expected_revision': 1}).status_code == 409
    service.recover_pending_jobs()
    job = engine.advance(work.job_id, provider, wait=True)
    assert len(provider.inputs) == 1
    first, second = job.candidates[0].plan_execution.stages
    assert first.state == 'rejected' and first.accepted is None
    assert second.state == 'created' and second.submission_attempts == 0
    assert not job.plan_control.enabled and not job.candidates[0].frames


@pytest.mark.parametrize('damage', ['changed_pin', 'missing_snapshot'])
def test_integrity_failure_stops_before_second_submission(chain, damage):
    service, work, engine, provider, client = chain
    pinned = decide(client, 0, 'accept_state', 2)[1]
    accepted = decide(client, 0, 'accept', 2)[1]
    if damage == 'changed_pin':
        service.store.resolve_job_path(work.job_id, pinned['path']).write_bytes(provider.archive[4])
    else:
        service.store.resolve_job_path(work.job_id, accepted['path']).unlink()
    assert client.get('candidates/1/stages/0/state-image').status_code == 409
    with pytest.raises(ConflictError, match='快照'):
        engine.advance(work.job_id, provider, wait=True)
    job = engine.advance(work.job_id, provider, wait=True)
    assert not job.plan_control.enabled and len(provider.inputs) == 1
    assert job.candidates[0].plan_execution.stages[1].submission_attempts == 0


def test_reject_second_transition_keeps_b_and_does_not_publish_c(chain):
    _, work, engine, provider, client = chain
    states = decide(client, 0, 'accept', 2)
    engine.advance(work.job_id, provider, wait=True)
    assert decide(client, 1, 'reject') == states
    assert client.get('candidates/1/stages/0/state-image').content == provider.archive[3]
    assert client.get('candidates/1/stages/1/state-image').status_code == 409
    job = engine.advance(work.job_id, provider, wait=True)
    assert not job.candidates[0].frames and len(provider.inputs) == 2
