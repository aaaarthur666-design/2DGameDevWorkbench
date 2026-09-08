from vision_test_fixtures import observed, uncertain_stages
import base64
import copy
import io
import json
from unittest.mock import patch

import pytest
from PIL import Image
from test_motion_correction import setup, create, FAIL, PASS
from sprite_pipeline.motion_correction import MotionCorrection
from sprite_pipeline.motion_constraints import phase_context
from sprite_pipeline.vision_review import VisionReviewer, MODEL
from sprite_pipeline.vision_evidence import verification_content, raster


def response(payload, name=MODEL):
    from unittest.mock import Mock
    result=Mock(status_code=200)
    result.json.return_value={"status":"completed","id":"test-review","model":name,"usage":{"total_tokens":10},
                              "output":[{"type":"message","content":[{"type":"output_text","text":json.dumps(payload)}]}]}
    return result


def decision(kind="confirmed", confidence=.95, frames=(5,6)):
    return {"issue_index":0,"decision":kind,"confidence":confidence,
            "observations":[{"frame":f,"observation":f"第{f}帧实际观察"} for f in frames],
            "reason":"根据原图与相邻帧复核后的意见","phase":"charge","phase_confidence":.95}


def run_review(setup, verdict):
    service,_,fixture=setup
    paths=fixture.write_sequence(fixture.root/'review-input',shifts=tuple(i%4 for i in range(17)))
    initial=copy.deepcopy(FAIL);initial['issues'][0]['frames']=[5,6]
    with patch.object(VisionReviewer,'key',return_value='dummy-vision-key'),patch('sprite_pipeline.vision_review.httpx.Client') as factory:
        client=factory.return_value.__enter__.return_value
        client.post.side_effect=[response(observed(initial,17)),response({'decisions':[verdict],'stages':uncertain_stages(17)})]
        result=VisionReviewer(service.settings).review(paths,'attack',fixture.reference_path)
        calls=client.post.call_args_list
    return result,calls,fixture


def test_only_verified_evidence_survives_and_cost_is_two_requests(setup):
    result,calls,fixture=run_review(setup,decision())
    assert result['request_count']==len(calls)==2
    assert result['usage']['total_tokens']==20
    assert result['issues'][0]['evidence_status']=='confirmed'
    assert result['issues'][0]['description']=='根据原图与相邻帧复核后的意见'
    assert result['initial_review']['issues'][0]['evidence_status']=='unverified'
    assert result['requests'][1]['response_model']==MODEL
    assert '先前' not in result['summary']
    first=calls[0].kwargs['json']['input'][0]['content']
    assert 'armor/body recoloring' in first[0]['text']
    second=calls[1].kwargs['json']['input'][0]['content']
    board=next(part for part in second if part['type']=='input_image')
    image=Image.open(io.BytesIO(base64.b64decode(board['image_url'].split(',',1)[1])))
    assert image.crop((0,24,256,280)).tobytes()==raster(fixture.reference_path).tobytes()
    assert any('first reviewer may be wrong' in p.get('text','') for p in second)
    assert 'dummy-vision-key' not in json.dumps(result)


@pytest.mark.parametrize('kind,confidence,frames', [('dismissed',.95,(5,6)),('uncertain',.99,(5,6)),('confirmed',.89,(5,6)),('confirmed',.99,(5,)),('confirmed',.99,(5,99))])
def test_unproven_initial_claim_is_not_a_fault_tag(setup,kind,confidence,frames):
    result,calls,_=run_review(setup,decision(kind,confidence,frames))
    assert result['verdict']=='uncertain' and result['issues']==[]
    assert len(calls)==2


def test_verification_timeout_is_saved_without_retry_or_marking_every_frame(setup):
    service,provider,fixture=setup
    initial=copy.deepcopy(FAIL)
    with patch.object(VisionReviewer,'key',return_value='dummy-vision-key'),patch('sprite_pipeline.vision_review.httpx.Client') as factory:
        client=factory.return_value.__enter__.return_value
        client.post.side_effect=[response(observed(initial)),TimeoutError('test timeout')]
        job=service.generate_job(create(setup).job_id)
        assert client.post.call_count==2
        report=job.candidates[0].motion_review['report']
        assert report['issues']==[] and report['verdict']=='uncertain'
        assert all(not f.motion_tags and f.review_status.value=='pending' for f in job.candidates[0].frames)
        assert job.motion_control['reviews']['initial-1']['request_count']==2
        for _ in range(3): service.generate_job(job.job_id)
        assert client.post.call_count==2 and len(provider.requests)==1


def test_legacy_high_confidence_claim_cannot_supply_phase(setup):
    service,_,fixture=setup
    with patch.object(VisionReviewer,'review',return_value=FAIL):
        job=service.generate_job(create(setup).job_id)
    candidate=job.candidates[0]
    report=candidate.motion_review['report']
    for issue in report['issues']:
        issue.pop('evidence_status',None);issue.pop('evidence_confidence',None)
    result=phase_context(job,candidate,6,candidate.motion_review['digest'])
    assert result['phase']=='unknown'


def test_verification_panel_budget_and_full_first_pass_remain_bounded(setup):
    _,_,fixture=setup
    paths=fixture.write_sequence(fixture.root/'long-input',shifts=tuple(i%4 for i in range(64)))
    issues=[{**FAIL['issues'][0],'frames':[i+2]} for i in range(20)]
    issues[-1]['code']='identity_drift'
    content,included=verification_content(paths,fixture.reference_path,issues)
    assert len(included)==8 and 19 in included
    assert len([p for p in content if p['type']=='input_image'])==8


def test_real_reference_is_fourth_repair_slot_not_a_generated_neighbor(setup):
    service,provider,_=setup
    with patch.object(VisionReviewer,'review',side_effect=[FAIL,PASS]):
        job=service.generate_job(create(setup).job_id)
        attempt=MotionCorrection(service).manual(job.job_id,1,6,job.candidates[0].frames[6].sha256,wait=True)
    assert attempt['context']==[5,6,7,-1]
    assert provider.requests[-1].edit_frames[3]==(service.store.job_dir(job.job_id)/'input/reference.png').read_bytes()
    assert 'ORIGINAL identity guide, NOT a motion frame' in provider.requests[-1].prompt
    assert 'faulty neighbors' in provider.requests[-1].prompt
    assert len(provider.requests[-1].prompt)<=1000
