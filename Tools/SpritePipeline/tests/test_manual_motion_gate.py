import copy
from unittest.mock import patch
import pytest
from test_motion_correction import setup, create, PASS, FAIL
from sprite_pipeline.motion_correction import MotionCorrection
from sprite_pipeline.motion_constraints import repair_prompt, RULES, phase_context
from sprite_pipeline.vision_review import VisionReviewer
from sprite_pipeline.errors import ConflictError, ValidationHarnessError
from sprite_pipeline.models import ReviewStatus


def test_unknown_phase_needs_human_choice_before_reservation(setup):
    s,p,_=setup
    failure=copy.deepcopy(FAIL)
    failure['issues'][0].update(phase='unknown',phase_confidence=0)
    with patch.object(VisionReviewer,'review',return_value=failure):
        job=s.generate_job(create(setup).job_id)
        control=MotionCorrection(s); frame=job.candidates[0].frames[6]
        with pytest.raises(ValidationHarnessError,match='确认.*阶段'):
            control.manual(job.job_id,1,6,frame.sha256)
        assert s.get_job(job.job_id).motion_control['attempts']==[]
        assert len(p.requests)==1
        attempt=control.manual(job.job_id,1,6,frame.sha256,phase='charge',wait=True)
    assert len(p.requests)==2
    assert attempt['constraints']['phase_source']=='人工指定'
    assert attempt['constraints']['previous_frame']==5
    assert attempt['constraints']['next_frame']==7


def test_stale_phase_cannot_guide_a_new_generation(setup):
    s,p,f=setup
    with patch.object(VisionReviewer,'review',return_value=FAIL):
        job=s.generate_job(create(setup).job_id)
    control=MotionCorrection(s)
    neighbor=job.candidates[0].frames[5]
    path=f.root/'neighbor-change.png'; f.write_frame(path,shift_x=2)
    s.review_frame(job.job_id,1,{"frame_index":5,"status":"repair_requested","issue_type":"pose_error","note":"人工调整邻帧"})
    s.replace_frame(job.job_id,1,5,path,base_sha256=neighbor.sha256)
    current=s.get_job(job.job_id)
    with pytest.raises(ValidationHarnessError,match='确认.*阶段'):
        control.manual(job.job_id,1,6,current.candidates[0].frames[6].sha256)
    assert len(p.requests)==1 and current.motion_control['attempts']==[]


@pytest.mark.parametrize('confidence',[0,0.4,0.84])
def test_uncertain_phase_not_guessed_from_sixteen_frame_position(setup,confidence):
    s,p,_=setup
    failure=copy.deepcopy(FAIL);failure['issues'][0]['phase_confidence']=confidence
    with patch.object(VisionReviewer,'review',return_value=failure):
        job=s.generate_job(create(setup).job_id)
    with pytest.raises(ValidationHarnessError,match='确认.*阶段'):
        MotionCorrection(s).manual(job.job_id,1,6,job.candidates[0].frames[6].sha256)
    assert len(p.requests)==1


def test_air_phase_constraint_cannot_use_ground_charge(setup):
    s,p,_=setup
    with patch.object(VisionReviewer,'review',return_value=FAIL):
        job=s.generate_job(create(setup,'attack_in_air').job_id)
    with pytest.raises(ValidationHarnessError,match='阶段不适用'):
        MotionCorrection(s).manual(job.job_id,1,6,job.candidates[0].frames[6].sha256,phase='charge')
    assert len(p.requests)==1


@pytest.mark.parametrize('phase',list(RULES))
def test_hard_phase_and_neighbor_constraints_survive_long_notes(phase):
    prompt=repair_prompt('attack_in_air',17,6,[5,6,7,8],phase,'c'*500,'n'*2000)
    assert len(prompt)<=1000
    assert RULES[phase] in prompt
    assert f'INTENDED PHASE={phase}' in prompt
    assert 'LOCK previous frame 6 (slot 1)' in prompt
    assert 'LOCK next frame 8 (slot 3)' in prompt
    assert 'continuous airborne arc' in prompt
    assert 'Repair ONLY slot 2, frame 7/17' in prompt


def test_old_automatic_queue_is_paused_without_submission(setup):
    s,p,_=setup
    with patch.object(VisionReviewer,'review',return_value=FAIL) as reviewer:
        job=s.generate_job(create(setup).job_id)
        with s.store.locked_job(job.job_id) as saved:
            saved.motion_control.update(version=1,state='repairing',maximum_extra_generations=2)
            saved.motion_control['attempts']=[{'id':'legacy','mode':'auto','state':'reserved','candidate_index':1,'targets':[6],'child_job_id':None}]
        result=s.generate_job(job.job_id)
    assert len(p.requests)==1 and reviewer.call_count==1
    assert result.motion_control['attempts'][0]['state']=='paused'
    assert result.motion_control['maximum_extra_generations']==0
    with pytest.raises(ConflictError,match='自动补做已停用'):
        MotionCorrection(s)._reserve(job.job_id,1,[6],'auto')
    with pytest.raises(ConflictError,match='自动补做已停用'):
        MotionCorrection(s)._advance_attempt(job.job_id,'legacy',True)


def test_quota_estimate_has_no_automatic_extra_generations(setup):
    s,_,f=setup
    estimate=s.estimate_pixellab_generation_units(f.character_id,'attack',candidate_count=2)
    assert estimate['maximum_extra_generations']==0
    assert estimate['maximum_visual_reviews']==4
    assert estimate['maximum_generation_units']==estimate['generation_units_per_candidate']*2


def test_repair_api_requires_valid_phase_before_charging(setup):
    from fastapi.testclient import TestClient
    from sprite_pipeline.api_app import create_api
    s,p,_=setup
    failure=copy.deepcopy(FAIL);failure['issues'][0].update(phase='unknown',phase_confidence=0)
    with patch.object(VisionReviewer,'review',return_value=failure):
        job=s.generate_job(create(setup).job_id)
        client=TestClient(create_api(service=s))
        route=f'/jobs/{job.job_id}/candidates/1/frames/6/ai-repair'
        body={'base_sha256':job.candidates[0].frames[6].sha256,'wait':True}
        assert client.post(route,json=body).status_code==422
        assert len(p.requests)==1
        response=client.post(route,json={**body,'phase':'charge'})
    assert response.status_code==200,response.text
    assert response.json()['constraints']['phase']=='charge'
    assert len(p.requests)==2


def test_uncertain_result_has_warning_tags_without_new_generation(setup):
    s,p,_=setup
    with patch.object(VisionReviewer,'review',return_value={**PASS,'verdict':'uncertain'}):
        job=s.generate_job(create(setup).job_id)
    assert all(f.motion_tags[0]['code']=='uncertain' for f in job.candidates[0].frames)
    assert len(p.requests)==1


def test_manual_low_confidence_review_remains_a_warning_after_adoption(setup):
    s,p,_=setup
    with patch.object(VisionReviewer,'review',side_effect=[FAIL,{**PASS,'confidence':0.4}]):
        job=s.generate_job(create(setup).job_id)
        control=MotionCorrection(s)
        attempt=control.manual(job.job_id,1,6,job.candidates[0].frames[6].sha256,wait=True)
        assert attempt['report']['verdict']=='uncertain'
        adopted=control.adopt(job.job_id,attempt['id'],manual=True)
    assert adopted.motion_control['state']=='needs_repair'
    assert adopted.candidates[0].frames[6].motion_tags[0]['code']=='uncertain'
    assert len(p.requests)==2
