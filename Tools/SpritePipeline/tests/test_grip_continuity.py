import copy, json
from pathlib import Path
from unittest.mock import patch
import pytest
from test_attack_sequence import setup_sequence, create
from test_motion_correction import setup, PASS
from test_vision_sequence import full_action
from test_vision_evidence import response
from sprite_pipeline.vision_review import VisionReviewer
from sprite_pipeline.vision_grip import GripAudit, assess_grip
from sprite_pipeline.vision_sequence import FramePose, sequence_content
from sprite_pipeline.motion_constraints import repair_prompt, RULES
from sprite_pipeline.errors import ValidationHarnessError


@pytest.mark.parametrize("action",["attack","attack_in_air"])
def test_owner_is_frozen_in_both_generation_stages_and_reference(setup_sequence, action):
    s,p,f=setup_sequence
    preset=s.presets.character_path(f.character_id)
    data=json.loads(preset.read_text(encoding="utf-8"));data['weapon_hand']='left';preset.write_text(json.dumps(data),encoding="utf-8")
    j=create(setup_sequence,action=action)
    # A later preset edit must not change the already reserved arm contract.
    data['weapon_hand']='right';preset.write_text(json.dumps(data),encoding="utf-8")
    with patch.object(VisionReviewer,'review',return_value=PASS) as review:
        done=s.generate_job(j.job_id)
    assert len(p.requests)==2
    assert all("anatomical LEFT hand" in r.prompt and "NO handoff, hand swap or mirroring" in r.prompt for r in p.requests)
    assert all(len(r.prompt)<=1000 for r in p.requests)
    assert "START THE STRIKE NOW" in p.requests[1].prompt
    assert p.requests[1].last_frame is None
    seq=done.candidates[0].attack_sequence
    assert seq['grip_contract']=={'weapon_hand':'left','reference_sha256':j.reference_sha256}
    assert review.call_args.kwargs['weapon_hand']=='left'
    assert review.call_args.kwargs['handoff_frame']==5


@pytest.mark.parametrize('phase',list(RULES))
@pytest.mark.parametrize('target',[0,6,63])
def test_repair_preserves_owner_and_neighbors_even_with_long_corrections(phase,target):
    context=[max(0,target-1),target,min(63,target+1),-1]
    prompt=repair_prompt('attack',64,target,context,phase,'c'*500,'n'*1000,weapon_hand='left')
    assert len(prompt)<=1000
    assert "anatomical LEFT hand" in prompt
    assert "NO handoff, hand swap or mirroring" in prompt
    assert "faulty neighbors" in prompt and "Other slots unchanged" in prompt
    assert RULES[phase] in prompt


def evaluate(setup, initial, check):
    s,_,f=setup;paths=f.write_sequence(f.root/'grip-frames',shifts=tuple(i%4 for i in range(16)))
    with patch.object(VisionReviewer,'key',return_value='dummy-test-key'),patch('sprite_pipeline.vision_review.httpx.Client') as factory:
        client=factory.return_value.__enter__.return_value
        client.post.side_effect=[response(initial),response(check)]
        report=VisionReviewer(s.settings).review(paths,'attack',f.reference_path,weapon_hand='left',handoff_frame=9)
        assert client.post.call_count==2
    return report


def test_clean_initial_verdict_cannot_hide_a_confirmed_hand_swap(setup):
    initial,check=full_action()
    for p in initial['observations'][8:]:p['holder']='other'
    hand=check['hand_continuity'];hand.update(status='changed',reason='第8帧原图持刀臂仍连接刀柄，第9帧以后另一肩肘链连接刀柄')
    for p in hand['observations'][8:]:p['holder']='other'
    report=evaluate(setup,initial,check)
    assert report['review_protocol_version']==6 and report['request_count']==2
    assert report['verdict']=='fail'
    issue=next(i for i in report['issues'] if i['code']=='hand_swap')
    assert issue['frames']==list(range(9,17)) and issue['evidence_status']=='confirmed'
    assert report['initial_review']['verdict']=='pass'


@pytest.mark.parametrize('case',['contradiction','occluded','missing_audit','missing_frame','duplicate_frame','invented_left_label'])
def test_unsupported_hand_claim_never_becomes_fault_or_pass(setup,case):
    initial,check=full_action()
    hand=check['hand_continuity']
    if case=='contradiction':
        hand['status']='changed';hand['observations'][8]['holder']='other'
    if case=='occluded':hand['observations'][8]['holder']='occluded'
    if case=='missing_audit':check.pop('hand_continuity')
    if case=='missing_frame':hand['observations'].pop()
    if case=='duplicate_frame':hand['observations'][-1]['frame']=1
    if case=='invented_left_label':hand['observations'][8]['holder']='left_hand'
    report=evaluate(setup,initial,check)
    assert report['verdict']=='uncertain' and report['issues']==[]


def test_screen_position_changes_with_same_arm_are_not_hand_swaps(setup):
    initial,check=full_action()
    for p in initial['observations']:p['observation']='刀随同一手臂绕过肩膀，虽穿过画面左右侧但没有交给另一臂'
    report=evaluate(setup,initial,check)
    assert report['verdict']=='pass' and report['hand_continuity']['status']=='consistent'


@pytest.mark.parametrize('count,handoff',[(8,5),(18,10),(64,32)])
def test_handoff_audit_uses_actual_boundary_within_existing_second_request(setup,count,handoff):
    _,_,f=setup;paths=f.write_sequence(f.root/'handoff-panels',shifts=tuple(i%4 for i in range(count)))
    content,_=sequence_content(paths,f.reference_path,[],'attack',handoff_frame=handoff)
    text=' '.join(c.get('text','') for c in content)
    assert f'Segment handoff close-up around frame {handoff}' in text
    assert 'EVERY actual frame' in text and 'shoulder -> elbow -> wrist -> hilt' in text


def test_invalid_phase_evidence_does_not_suppress_a_confirmed_hand_swap(setup):
    initial,check=full_action()
    for p in initial['observations'][8:]:p['holder']='other'
    check['hand_continuity']['status']='changed'
    for p in check['hand_continuity']['observations'][8:]:p['holder']='other'
    check['stages'][-1]['observations'][0]['frame']=60
    report=evaluate(setup,initial,check)
    assert report['verdict']=='fail' and report['issues'][0]['code']=='hand_swap'
    assert not report['action_completeness']['complete'] and report['action_evidence_error']


def test_existing_version_one_job_keeps_its_original_reserved_endpoint(setup_sequence):
    s,p,_=setup_sequence;j=create(setup_sequence)
    with s.store.locked_job(j.job_id) as old:
        old.candidates[0].attack_sequence['version']=1
        old.candidates[0].attack_sequence.pop('grip_contract')
    with patch.object(VisionReviewer,'review',return_value=PASS):s.generate_job(j.job_id)
    assert p.requests[1].last_frame==(s.store.job_dir(j.job_id)/'input/reference.png').read_bytes()
    assert len(p.requests)==2


def test_confirmed_swap_marks_repair_frames_and_does_not_generate_again(setup):
    from test_motion_correction import create as create_single
    s,provider,_=setup;initial,check=full_action()
    for pose in initial['observations'][8:]:pose['holder']='other'
    check['hand_continuity']['status']='changed'
    for pose in check['hand_continuity']['observations'][8:]:pose['holder']='other'
    with patch.object(VisionReviewer,'key',return_value='dummy-test-key'),patch('sprite_pipeline.vision_review.httpx.Client') as factory:
        client=factory.return_value.__enter__.return_value
        client.post.side_effect=[response(initial),response(check)]
        job=s.generate_job(create_single(setup).job_id)
        for _ in range(3):s.generate_job(job.job_id)
    assert client.post.call_count==2 and len(provider.requests)==1
    assert job.motion_control['state']=='needs_repair'
    assert all(frame.review_status.value=='repair_requested' and frame.motion_tags[0]['code']=='hand_swap'
               for frame in job.candidates[0].frames[8:])
    assert all(not frame.motion_tags for frame in job.candidates[0].frames[:8])


@pytest.mark.parametrize("action", ["attack", "attack_in_air"])
def test_segments_retain_original_identity_when_charged_frame_has_drift(setup_sequence, action):
    s, p, f = setup_sequence
    preset = s.presets.character_path(f.character_id)
    data = json.loads(preset.read_text(encoding="utf-8"))
    identity = "Blue-black armour, cyan highlights, helmet and sword from the approved reference."
    data["identity_description"] = identity
    preset.write_text(json.dumps(data), encoding="utf-8")
    job = create(setup_sequence, action=action)
    # A generated handoff image or later preset edit must not replace the original identity.
    data["identity_description"] = "Red cape and gold armour."
    preset.write_text(json.dumps(data), encoding="utf-8")
    with patch.object(VisionReviewer, "review", return_value=PASS):
        s.generate_job(job.job_id)
    assert len(p.requests) == 2
    from sprite_pipeline.prompts import IDENTITY_LOCK
    for request in p.requests:
        assert identity in request.prompt and IDENTITY_LOCK in request.prompt
        assert "Red cape" not in request.prompt
        assert "NO handoff, hand swap or mirroring" in request.prompt
        assert len(request.prompt) <= 1000
    assert p.requests[1].prompt.startswith("START THE STRIKE NOW")
