import copy,json
from pathlib import Path
from unittest.mock import patch,PropertyMock
import pytest
from test_harness_integration import TemporaryHarness
from test_motion_correction import FakeProvider,PASS,FAIL
from sprite_pipeline.models import GenerationRequest,CandidateStatus
from sprite_pipeline.service import SpritePipelineService
from sprite_pipeline.providers.base import PollResult,PollStatus
from sprite_pipeline.vision_review import VisionReviewer
from sprite_pipeline.motion_correction import MotionCorrection
from sprite_pipeline.errors import ValidationHarnessError,ProviderTemporaryError,ConflictError

class SegmentedProvider(FakeProvider):
    def __init__(self,f):super().__init__(f);self.unknown_stage=None
    def submit(self,request):
        if self.unknown_stage==len(self.requests):
            self.requests.append(request)
            raise ProviderTemporaryError('unknown',details={'submission_unknown':True,'safe_to_retry':False})
        return super().submit(request)
    def poll(self,job_id):
        r=self.requests[int(job_id.split('-')[-1])-1]
        paths=self.fixture.write_sequence(self.fixture.root/('stage-'+job_id),shifts=tuple(i%4 for i in range(r.frame_count)))
        frames=[r.reference_image]+[p.read_bytes() for p in paths]
        if r.last_frame:frames[-1]=r.last_frame
        return PollResult(provider=self.name,provider_job_id=job_id,status=PollStatus.completed,provider_status='completed',images=frames,diagnostic_only=False)

@pytest.fixture
def setup_sequence(tmp_path):
    f=TemporaryHarness(tmp_path)
    for name in ['attack','attack_in_air']:
        data=json.loads((Path(__file__).parents[1]/f'presets/actions/{name}.json').read_text(encoding='utf-8'))
        data['generation_strategy']='two_stage_attack'  # Frozen v3 regression fixture.
        (f.action_dir/f'{name}.json').write_text(json.dumps(data),encoding='utf-8')
    s=SpritePipelineService(tmp_path);p=SegmentedProvider(f)
    with patch('sprite_pipeline.providers.get_provider',return_value=p),patch.object(SpritePipelineService,'_check_submission_quota'),patch.object(VisionReviewer,'configured',new_callable=PropertyMock,return_value=True):
        yield s,p,f


def create(setup,count=1,action='attack',frames=None):
    s,p,f=setup
    return s.create_job(GenerationRequest(character_id=f.character_id,action_id=action,provider='pixellab',candidate_count=count,frame_count=frames))

@pytest.mark.parametrize('action',['attack','attack_in_air'])
def test_default_two_stages_join_real_boundary_then_review_all_candidates(setup_sequence,action):
    s,p,f=setup_sequence
    with patch.object(VisionReviewer,'review',return_value=PASS) as reviewer:
        job=s.generate_job(create(setup_sequence,3,action).job_id)
        for _ in range(3):s.generate_job(job.job_id)
    assert len(p.requests)==6 and reviewer.call_count==3
    assert all(len(c.frames)==17 and c.submission_attempts==2 for c in job.candidates)
    assert job.motion_control['state']=='passed'
    for i,c in enumerate(job.candidates):
        first=p.requests[2*i];last=p.requests[2*i+1]
        assert [first.frame_count,last.frame_count]==[4,12]
        assert 'START THE STRIKE NOW' in last.prompt
        from sprite_pipeline.attack_sequence import FixedAttackGeneration
        saved=FixedAttackGeneration(s).saved_frames(job.job_id,c.candidate_index,0)
        assert last.reference_image==saved[-1]
        original=(s.store.job_dir(job.job_id)/'input/reference.png').read_bytes()
        assert last.last_frame is None  # Do not force a conflicting idle-hand endpoint.
        assert c.attack_sequence['join_duplicate_removed']
        assert [r['submission_attempts'] for r in c.attack_sequence['stages']]==[1,1]
        assert [len(call.args[0]) for call in reviewer.call_args_list]==[17]*3


def test_restart_between_stages_only_submits_remaining_planned_stage(setup_sequence):
    s,p,f=setup_sequence;job=create(setup_sequence)
    with patch.object(VisionReviewer,'review',return_value=PASS) as review:
        j=s.generate_job(job.job_id,wait=False)
        assert len(p.requests)==1 and not j.candidates[0].frames and not review.called
        assert j.candidates[0].attack_sequence['stages'][0]['state']=='complete'
        restarted=SpritePipelineService(s.settings.root)
        j=restarted.generate_job(job.job_id)
        restarted.generate_job(job.job_id)
    assert len(p.requests)==2 and review.call_count==1 and len(j.candidates[0].frames)==17

@pytest.mark.parametrize('failed_stage',[0,1])
def test_unknown_submit_is_never_repeated_or_advanced(setup_sequence,failed_stage):
    s,p,_=setup_sequence;job=create(setup_sequence);p.unknown_stage=failed_stage
    with pytest.raises(ProviderTemporaryError):s.generate_job(job.job_id)
    for _ in range(3):
        with pytest.raises(ConflictError):s.generate_job(job.job_id)
    assert len(p.requests)==failed_stage+1
    assert s.get_job(job.job_id).candidates[0].status==CandidateStatus.submission_unknown


def test_result_commit_recovery_never_requests_either_stage_again(setup_sequence):
    s,p,_=setup_sequence;job=create(setup_sequence)
    with patch.object(s,'_store_provider_frames',side_effect=OSError('disk busy')):
        with pytest.raises(OSError):s.generate_job(job.job_id)
    assert len(p.requests)==2
    with patch.object(VisionReviewer,'review',return_value=PASS):
        recovered=s.generate_job(job.job_id)
    assert len(p.requests)==2 and len(recovered.candidates[0].frames)==17

@pytest.mark.parametrize('count,expected',[(8,[4,4]),(10,[4,6]),(12,[4,8]),(14,[4,10]),(16,[4,12])])
def test_even_stage_sizes_follow_actual_requested_budget(setup_sequence,count,expected):
    s,p,_=setup_sequence;job=create(setup_sequence,frames=count)
    with patch.object(VisionReviewer,'review',return_value=PASS):j=s.generate_job(job.job_id)
    assert [r.frame_count for r in p.requests]==expected
    assert len(j.candidates[0].frames)==count+1


def test_candidate_check_failure_does_not_skip_next_candidate_or_retry(setup_sequence):
    s,p,_=setup_sequence;job=create(setup_sequence,3);calls=[]
    def review(paths,action,reference,*,on_request,**context):
        on_request();calls.append(len(paths))
        if len(calls)==2:raise ValidationHarnessError('invalid enum')
        return copy.deepcopy(PASS)
    with patch.object(VisionReviewer,'review',side_effect=review):
        j=s.generate_job(job.job_id)
        for _ in range(3):s.generate_job(job.job_id)
    assert calls==[17,17,17] and len(p.requests)==6
    assert j.candidates[0].motion_review['report']['verdict']=='pass'
    assert j.candidates[1].motion_review['report']['check_unavailable']
    assert j.candidates[2].motion_review['report']['verdict']=='pass'
    assert j.motion_control['reviews']['initial-2']['request_count']==1
    assert j.motion_control['state']=='needs_repair'


def test_old_interrupted_batch_resumes_only_unsent_candidates(setup_sequence):
    s,p,_=setup_sequence;job=create(setup_sequence,3)
    with patch.object(VisionReviewer,'review',return_value=PASS):j=s.generate_job(job.job_id)
    with s.store.locked_job(j.job_id) as old:
        old.candidates[1].motion_review=None;old.candidates[2].motion_review=None
        old.motion_control['state']='needs_repair'
        old.motion_control['reviews']['initial-2']={'state':'failed','request_started':True,'request_count':1,'error':'old invalid enum'}
        del old.motion_control['reviews']['initial-3']
    m=MotionCorrection(s);assert [c.candidate_index for c in m.unsent_candidates(s.get_job(j.job_id))]==[3]
    m.resume(j.job_id)
    with patch.object(VisionReviewer,'review',return_value=PASS) as reviewer:
        done=s.generate_job(j.job_id)
    assert reviewer.call_count==1 and len(p.requests)==6
    assert done.candidates[1].motion_review['report']['check_unavailable']
    assert done.candidates[2].motion_review['report']['verdict']=='pass'
    assert done.motion_control['reviews']['initial-2']['request_count']==1


def test_async_worker_reaches_later_candidates_after_first_finishes(setup_sequence):
    s,p,_=setup_sequence;job=create(setup_sequence,3)
    with patch.object(VisionReviewer,'review',return_value=PASS) as review:
        for _ in range(15):j=s.generate_job(job.job_id,wait=False)
    assert len(p.requests)==6 and review.call_count==3
    assert all(len(c.frames)==17 for c in j.candidates)
    assert j.motion_control['state']=='passed'


def test_get_only_recovery_does_not_submit_unstarted_second_stage(setup_sequence):
    s,p,_=setup_sequence;job=create(setup_sequence)
    s.generate_job(job.job_id,wait=False)
    with pytest.raises(ConflictError):
        s.recover_completed_candidate(job.job_id,1)
    assert len(p.requests)==1 and not s.get_job(job.job_id).candidates[0].frames


def test_unknown_pose_literals_do_not_become_invented_positions():
    from sprite_pipeline.vision_sequence import FramePose
    pose=FramePose.model_validate({'frame':1,'grip_height':'unknown_position','blade_tip':'unknown_direction','observation':'被遮挡'})
    assert pose.grip_height==pose.blade_tip=='occluded'
    pose=FramePose.model_validate({'frame':1,'grip_height':'below_shoulder','blade_tip':'front-low','observation':'剑在肩下前方'})
    assert pose.grip_height=='low' and pose.blade_tip=='front_low'
