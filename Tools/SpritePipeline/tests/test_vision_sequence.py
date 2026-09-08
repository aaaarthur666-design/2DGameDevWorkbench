import copy
from unittest.mock import patch
import pytest
from test_motion_correction import setup, create, PASS
from test_vision_evidence import response
from vision_test_fixtures import observed, consistent_grip
from sprite_pipeline.vision_review import VisionReviewer
from sprite_pipeline.vision_sequence import FramePose, SequenceVerification, assess_sequence, sequence_content
from sprite_pipeline.motion_correction import MotionCorrection


def full_action():
    initial=observed(PASS)
    for p in initial['observations'][3:7]:p.update(grip_height='shoulder',blade_tip='behind_high')
    initial['observations'][7]['blade_tip']='front_high'
    frames={'windup':[3,4],'charge':[5,6,7],'strike':[7,8,9],'follow_through':[10,11,12],'recover':[13,16]}
    check={'decisions':[],'stages':[{'stage':s,'status':'present','confidence':.96,
        'observations':[{'frame':f,'observation':'可见举刀、持刀停顿和出刀的对应姿势'} for f in fs],
        'reason':'相应姿势出现在正确顺序中'} for s,fs in frames.items()]}
    check["hand_continuity"]=consistent_grip()
    from vision_test_fixtures import consistent_appearance
    check["appearance_continuity"]=consistent_appearance()
    check["recovery_evidence"]={"start_frame":13,"end_frame":16,"motion":"retracting","settled":True,"observation":"随挥后手臂连续回收，末尾回到准备姿势"}
    return initial,check


def test_clean_first_pass_still_needs_second_call_and_physical_stage_evidence(setup):
    s,_,f=setup;paths=f.write_sequence(f.root/'complete',shifts=tuple(i%4 for i in range(16)))
    initial,check=full_action()
    with patch.object(VisionReviewer,'key',return_value='test-only-key'),patch('sprite_pipeline.vision_review.httpx.Client') as factory:
        client=factory.return_value.__enter__.return_value
        client.post.side_effect=[response(initial),response(check)]
        report=VisionReviewer(s.settings).review(paths,'attack',f.reference_path)
    assert client.post.call_count==2
    assert report['verdict']=='pass' and report['action_completeness']['complete']
    assert len(report['observations'])==16


def test_missing_charge_becomes_real_repair_tags_without_new_generation(setup):
    s,provider,_=setup;initial,check=full_action()
    initial=observed(PASS)  # Old failure mode: confident clean summary, but no raised poses.
    for stage in check['stages']:
        if stage['stage'] in {'windup','charge','strike'}:
            stage.update(status='missing',reason='手与刀始终在腰部前下方，缺少举刀蓄力和从高到低的出刀')
    with patch.object(VisionReviewer,'key',return_value='test-only-key'),patch('sprite_pipeline.vision_review.httpx.Client') as factory:
        client=factory.return_value.__enter__.return_value
        client.post.side_effect=[response(initial),response(check)]
        job=s.generate_job(create(setup).job_id)
        for _ in range(3):s.generate_job(job.job_id)
    assert client.post.call_count==2 and len(provider.requests)==1
    assert job.motion_control['state']=='needs_repair'
    assert job.candidates[0].frames[4].review_status.value=='repair_requested'
    tag=job.candidates[0].frames[4].motion_tags[0]
    assert tag['code']=='incomplete_action' and tag['phase']=='unknown'
    assert job.motion_control['reviews']['initial-1']['request_count']==2


def test_claimed_charge_without_raised_pose_cannot_pass():
    _,check=full_action()
    poses=[FramePose.model_validate(p) for p in observed(PASS)['observations']]
    complete,issues,audit=assess_sequence(SequenceVerification.model_validate(check),poses,'attack',16)
    assert not complete and not issues  # Conflicting evidence does not invent a fault.
    assert next(s for s in audit if s['stage']=='charge')['status']=='uncertain'


def test_visible_charge_cannot_be_labelled_missing():
    initial,check=full_action()
    check['stages'][1].update(status='missing')
    complete,issues,audit=assess_sequence(SequenceVerification.model_validate(check),[FramePose.model_validate(p) for p in initial['observations']],'attack',16)
    assert not complete and not issues
    assert audit[1]['status']=='uncertain'


@pytest.mark.parametrize('defect',['omitted_stage','duplicate_stage','out_of_range','duplicate_frame','out_of_order'])
def test_incomplete_or_invalid_evidence_never_passes(defect):
    initial,check=full_action()
    if defect=='omitted_stage':check['stages'].pop()
    if defect=='duplicate_stage':check['stages'][-1]=copy.deepcopy(check['stages'][0])
    if defect=='out_of_range':check['stages'][0]['observations'][0]['frame']=17
    if defect=='duplicate_frame':initial['observations'][0]['frame']=2
    if defect=='out_of_order':check['stages'][-1]['observations'][0]['frame']=1
    try:
        complete,_,_=assess_sequence(SequenceVerification.model_validate(check),[FramePose.model_validate(p) for p in initial['observations']],'attack',16)
    except ValueError:return
    assert not complete


def test_airborne_action_does_not_require_ground_charge():
    poses=[FramePose.model_validate(p) for p in observed(PASS)['observations']]
    check={'decisions':[],'stages':[{'stage':s,'status':'present','confidence':.96,'observations':[{'frame':i*3+1,'observation':'连续空中动作'},{'frame':i*3+2,'observation':'延续同一飞行轨迹'}],'reason':'空中攻击证据'} for i,s in enumerate(['prepare','strike','extend','follow_through','recover'])]}
    check['stages'][-1]['observations'][-1]['frame']=16
    check['recovery_evidence']={'start_frame':13,'end_frame':16,'motion':'retracting','settled':True,'observation':'空中顺势回收，同一飞行轨迹'}
    complete,issues,audit=assess_sequence(SequenceVerification.model_validate(check),poses,'attack_in_air',16)
    assert complete and not issues and all(s['stage']!='charge' for s in audit)


@pytest.mark.parametrize('count',[1,17,64])
def test_full_second_audit_includes_every_actual_frame_with_boundary_overlap(setup,count):
    _,_,f=setup;paths=f.write_sequence(f.root/'panels',shifts=tuple(i%4 for i in range(count)))
    content,included=sequence_content(paths,f.reference_path,[],'attack')
    pages=[p['text'] for p in content if p['type']=='input_text' and p['text'].startswith('Ordered page:')]
    ranges=[tuple(map(int,t.split('frames ')[1].split(',')[0].split('-'))) for t in pages]
    assert {i for a,b in ranges for i in range(a,b+1)}==set(range(1,count+1))
    assert all(ranges[i][0]==ranges[i-1][1] for i in range(1,len(ranges)))
    assert not included


def test_missing_phase_claim_is_only_decided_by_full_sequence(setup):
    s,_,f=setup;paths=f.write_sequence(f.root/'local-missing',shifts=tuple(i%4 for i in range(16)))
    initial,check=full_action()
    initial.update(verdict='fail',issues=[{'code':'incomplete_action','frames':[5,6],
        'description':'初检猜测缺少蓄力','correction':'Add charge','phase':'charge','phase_confidence':.99}])
    with patch.object(VisionReviewer,'key',return_value='test-only-key'),patch('sprite_pipeline.vision_review.httpx.Client') as factory:
        client=factory.return_value.__enter__.return_value;client.post.side_effect=[response(initial),response(check)]
        report=VisionReviewer(s.settings).review(paths,'attack',f.reference_path)
    assert report['verdict']=='pass' and not report['issues']
    assert report['initial_review']['issues'] and not report['local_hypotheses']
    assert client.post.call_count==2
