import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image
from unittest.mock import patch

import pytest

from test_harness_integration import TemporaryHarness

from sprite_pipeline.attack_plans import AttackPlans, trajectory_check
from sprite_pipeline.errors import ConflictError, ValidationHarnessError, ProviderTemporaryError
from sprite_pipeline.models import GenerationRequest
from sprite_pipeline.providers.base import Submission, PollResult, PollStatus
from sprite_pipeline.service import SpritePipelineService


class SegmentProvider:
    name = "pixellab"
    diagnostic_only = False

    def __init__(self, fixture):
        self.requests = []
        self.fixture = fixture
        self.unknown = False
        self.count = 4

    def submit(self, request):
        self.requests.append(request)
        if self.unknown:
            raise ProviderTemporaryError("submission unknown", details={"submission_unknown":True,"safe_to_retry":False})
        return Submission(provider=self.name, provider_job_id=f"remote-{len(self.requests):06d}", status="pending", expected_frame_count=4, expected_size=(64,64), request_record={}, raw_response={})

    def poll(self, job_id):
        request = self.requests[int(job_id.split('-')[-1])-1]
        paths = self.fixture.write_sequence(self.fixture.root / 'remote', shifts=(1,2))
        frames = [request.reference_image, *[p.read_bytes() for p in paths], request.last_frame]
        return PollResult(provider=self.name,provider_job_id=job_id,status=PollStatus.completed,
            provider_status="completed",images=frames[:self.count],diagnostic_only=False)


@pytest.fixture
def setup(tmp_path):
    fixture = TemporaryHarness(tmp_path)
    attack = json.loads((Path(__file__).parents[1] / 'presets/actions/attack.json').read_text(encoding='utf-8'))
    (fixture.action_dir/'attack.json').write_text(json.dumps(attack),encoding='utf-8')
    service = SpritePipelineService(tmp_path)
    keys = fixture.write_sequence(tmp_path/'keys',shifts=(3,4,5,2,0))
    plans = AttackPlans(service)
    provider = SegmentProvider(fixture)
    with patch('sprite_pipeline.providers.get_provider',return_value=provider), patch.object(service,'_check_submission_quota'):
        yield service,plans,provider,fixture,keys


def accept(plans,plan_id,segment):
    plans.refresh(plan_id,segment)
    plan = plans.load(plan_id)
    return plans.accept(plan_id,segment,token=plans.review_token(plan,segment),
        points=[[20,30,35,30]]*4,phase_confirmed=True)


def test_five_segments_assemble_exact_16_and_preserve_anchors(setup):
    service,plans,provider,fixture,keys=setup
    plan=plans.create(fixture.character_id,keys)
    for segment in range(5):
        plans.submit(plan['plan_id'],segment)
        accept(plans,plan['plan_id'],segment)
    result=plans.assemble(plan['plan_id'])
    job=service.get_job(result['output_job_id'])
    assert len(job.candidates[0].frames)==16
    for i,frame_index in enumerate((0,3,6,9,12,15)):
        path=service.store.job_dir(job.job_id)/job.candidates[0].frames[frame_index].active_path
        assert Image.open(path).convert("RGBA").tobytes()==Image.open(plans.anchor(plan,i)).convert("RGBA").tobytes()
    assert len(provider.requests)==5
    assert all(r.frame_count==4 and r.last_frame and len(r.prompt)<=500 for r in provider.requests)
    assert plans.assemble(plan['plan_id'])['output_job_id']==job.job_id
    assert len(service.list_jobs())==6


def test_double_click_restart_and_create_are_idempotent(setup):
    service,plans,provider,fixture,keys=setup
    plan=plans.create(fixture.character_id,keys)
    assert plans.create(fixture.character_id,keys)['plan_id']==plan['plan_id']
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _: plans.submit(plan['plan_id'],0), range(2)))
    assert len(provider.requests)==1
    resumed=AttackPlans(service)
    resumed.submit(plan['plan_id'],0)
    assert len(provider.requests)==1 and len(resumed.load(plan['plan_id'])['attempts'])==1
    with pytest.raises(ConflictError):
        resumed.create(fixture.character_id,keys,max_submissions=6)


def test_total_retry_pool_and_per_segment_limit(setup):
    service,plans,provider,fixture,keys=setup
    plan=plans.create(fixture.character_id,keys)
    for segment in range(5):
        plans.submit(plan['plan_id'],segment)
        plans.refresh(plan['plan_id'],segment)
        if segment<2:
            plans.submit(plan['plan_id'],segment,retry=True,reason='weapon flipped')
            with pytest.raises(ConflictError):
                plans.submit(plan['plan_id'],segment,retry=True,reason='again')
        else:
            with pytest.raises(ConflictError):
                plans.submit(plan['plan_id'],segment,retry=True,reason='again')
        accept(plans,plan['plan_id'],segment)
    assert len(provider.requests)==7
    assert len(plans.load(plan['plan_id'])['attempts'])==7


def test_zero_extra_budget_never_retries(setup):
    _,plans,provider,fixture,keys=setup
    plan=plans.create(fixture.character_id,keys,max_submissions=5)
    plans.submit(plan['plan_id'],0)
    plans.refresh(plan['plan_id'],0)
    with pytest.raises(ConflictError):
        plans.submit(plan['plan_id'],0,retry=True,reason='bad')
    assert len(provider.requests)==1


def test_unknown_submission_consumes_slot_and_blocks_retry(setup):
    _,plans,provider,fixture,keys=setup
    plan=plans.create(fixture.character_id,keys)
    provider.unknown=True
    with pytest.raises(ProviderTemporaryError):
        plans.submit(plan['plan_id'],0)
    for _ in range(3):
        plans.refresh(plan['plan_id'],0)
        with pytest.raises(ConflictError):
            plans.submit(plan['plan_id'],0)
        with pytest.raises(ConflictError):
            plans.submit(plan['plan_id'],0,retry=True,reason='timeout')
    assert len(provider.requests)==1
    assert len(plans.load(plan['plan_id'])['attempts'])==1


def test_crash_after_reservation_reuses_slot_and_refresh_never_submits(setup):
    service,plans,provider,fixture,keys=setup
    plan=plans.create(fixture.character_id,keys)
    with patch.object(service,'create_job',side_effect=RuntimeError('crash')):
        with pytest.raises(RuntimeError):
            plans.submit(plan['plan_id'],0)
    plans.refresh(plan['plan_id'],0)
    assert not provider.requests
    assert len(plans.load(plan['plan_id'])['attempts'])==1
    plans.submit(plan['plan_id'],0)
    assert len(provider.requests)==1
    assert len(plans.load(plan['plan_id'])['attempts'])==1


def test_forged_binding_and_modified_anchor_fail_before_submission(setup):
    service,plans,provider,fixture,keys=setup
    plan=plans.create(fixture.character_id,keys)
    with pytest.raises(ConflictError):
        service.create_job(GenerationRequest(character_id=fixture.character_id,action_id='attack',frame_count=4,loop=False,
            attack_segment={'plan_id':plan['plan_id'],'segment_index':0,'attempt':1},request_key='forged-request'))
    plans.anchor(plan,1).write_bytes(keys[2].read_bytes())
    with pytest.raises(ValidationHarnessError):
        plans.submit(plan['plan_id'],0)
    assert not provider.requests


def test_phase_confirmation_trajectory_and_stale_review_gate(setup):
    service,plans,provider,fixture,keys=setup
    plan=plans.create(fixture.character_id,keys)
    plans.submit(plan['plan_id'],0)
    plans.refresh(plan['plan_id'],0)
    plan=plans.load(plan['plan_id'])
    token=plans.review_token(plan,0)
    with pytest.raises(ConflictError):
        plans.accept(plan['plan_id'],0,token=token,points=[[20,30,35,30]]*4,phase_confirmed=False)
    with pytest.raises(ValidationHarnessError):
        plans.accept(plan['plan_id'],0,token=token,points=[[20,30,35,30],[20,30,5,30],[20,30,35,30],[20,30,35,30]],phase_confirmed=True)
    with pytest.raises(ConflictError):
        plans.accept(plan['plan_id'],0,token='stale',points=[[20,30,35,30]]*4,phase_confirmed=True)
    plans.submit(plan['plan_id'],0,retry=True,reason='bad direction')
    plans.refresh(plan['plan_id'],0)
    with pytest.raises(ConflictError):
        plans.accept(plan['plan_id'],0,token=token,points=[[20,30,35,30]]*4,phase_confirmed=True)
    assert len(provider.requests)==2


def test_wrong_returned_count_preserves_frames_and_stops(setup):
    service,plans,provider,fixture,keys=setup
    provider.count=3
    plan=plans.create(fixture.character_id,keys)
    plans.submit(plan['plan_id'],0)
    plans.refresh(plan['plan_id'],0)
    plan=plans.load(plan['plan_id'])
    with pytest.raises(ConflictError):
        plans.frames(plan,0)
    job=service.get_job(plan['attempts'][0]['job_id'])
    assert len(job.candidates[0].frames)==3
    assert len(provider.requests)==1


def test_accepted_bytes_are_immutable_and_stop_blocks_created_task(setup):
    service,plans,provider,fixture,keys=setup
    plan=plans.create(fixture.character_id,keys)
    plans.submit(plan['plan_id'],0)
    plan=accept(plans,plan['plan_id'],0)
    accepted=plan['accepted']['0']
    first=(plans.directory(plan['plan_id'])/accepted['directory']/'frame_1.png').read_bytes()
    child=service.get_job(accepted['job_id'])
    (service.store.job_dir(child.job_id)/child.candidates[0].frames[1].active_path).write_bytes(keys[2].read_bytes())
    assert (plans.directory(plan['plan_id'])/accepted['directory']/'frame_1.png').read_bytes()==first
    with pytest.raises(ConflictError):
        plans.submit(plan['plan_id'],0,retry=True,reason='again')
    plans.stop(plan['plan_id'])
    with pytest.raises(ConflictError):
        plans.submit(plan['plan_id'],1)
    assert len(provider.requests)==1


def test_trajectory_distinguishes_fast_strike_from_windup():
    points=[[20,30,35,30],[20,30,5,30],[20,30,5,30],[20,30,5,30]]
    assert trajectory_check(points,0,64)
    assert trajectory_check(points,2,64)==[]
    with pytest.raises(ValidationHarnessError):
        trajectory_check([[20,30,float('nan'),30]]*4,0,64)

def test_pixellab_sends_end_pose_and_redacts_both_images(setup):
    import base64
    from sprite_pipeline.providers.base import ProviderRequest
    from sprite_pipeline.providers.pixellab import PixelLabProvider
    from test_harness_integration import FakePixelLabClient, FakeResponse
    _,_,_,fixture,keys=setup
    client=FakePixelLabClient(FakeResponse({'background_job_id':'end-pose-test','status':'processing'}),FakeResponse({}))
    provider=PixelLabProvider(api_key='offline-token',base_url='https://unit.invalid',http_client=client,max_get_retries=0)
    request=ProviderRequest(reference_image=fixture.reference_path.read_bytes(),last_frame=keys[0].read_bytes(),prompt='One short controlled transition.',frame_count=4)
    submission=provider.submit(request)
    payload=client.post_calls[0][1]
    assert payload['first_frame']['base64'] and payload['last_frame']['base64']
    assert 'base64' not in submission.request_record['last_frame']
    assert 'base64' not in submission.request_record['first_frame']
    assert submission.request_record['last_frame']['sha256']


def test_api_uses_same_budget_and_requires_current_review(setup):
    import base64
    from fastapi.testclient import TestClient
    from sprite_pipeline.api_app import create_api
    service,plans,provider,fixture,keys=setup
    client=TestClient(create_api(service=service))
    body={'character_id':fixture.character_id,'keyframes_base64':[base64.b64encode(p.read_bytes()).decode() for p in keys],
        'max_submissions':5,'keyframes_confirmed':True}
    response=client.post('/attack-plans',json=body)
    assert response.status_code==200, response.text
    plan=response.json();path=f"/attack-plans/{plan['plan_id']}/segments/0"
    assert client.post(path+'/generate',json={}).status_code==200
    assert client.post(path+'/refresh').status_code==200
    review=client.get(path+'/review').json()
    assert len(review['frames_base64'])==4
    assert client.post(path+'/generate',json={'retry':True,'reason':'bad'}).status_code==409
    assert client.post(path+'/accept',json={'token':review['token'],'points':[[20,30,35,30]]*4}).status_code==409
    assert client.post(path+'/accept',json={'token':review['token'],'points':[[20,30,35,30]]*4,'phase_confirmed':True}).status_code==200
    assert len(provider.requests)==1


def test_hold_policy_only_allows_charge_interval(setup):
    _,plans,_,fixture,keys=setup
    from types import SimpleNamespace
    plan=plans.create(fixture.character_id,keys)
    def report():
        return {'hard_failures':[{'code':'consecutive_duplicate_frames','frame_indices':[0,1,2]}],
            'warnings':[], 'frames':[{'index':i,'hard_failures':['consecutive_duplicate_frames'],'warnings':[]} for i in range(3)],
            'summary':{'hard_failure_count':1,'warning_count':0}}
    job=SimpleNamespace(request=SimpleNamespace(attack_segment=SimpleNamespace(plan_id=plan['plan_id'],segment_index=1),request_key=None))
    hold=report();plans.apply_hold_policy(job,hold)
    assert not hold['hard_failures'] and hold['warnings'][0]['code']=='intentional_charge_hold'
    job.request.attack_segment.segment_index=2
    strike=report();plans.apply_hold_policy(job,strike)
    assert strike['hard_failures']
