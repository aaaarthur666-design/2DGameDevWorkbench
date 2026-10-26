"""Window isolation, budget and recovery guarantees; no live provider calls."""
import pytest
from test_open_motion import setup,ready,spec
from test_open_motion_checkpoints import CheckpointPlanner,accept
from sprite_pipeline.collaboration.contracts import digest
from sprite_pipeline.collaboration.execution import PlanGeneration
from sprite_pipeline.collaboration.checkpoints import Checkpoints,review_call_count
from sprite_pipeline.collaboration.repairs import LocalRepairs,generation_calls,edit_window_limit,repair_request
from sprite_pipeline.errors import ConflictError,ValidationHarnessError,ProviderTemporaryError


def repair_work(setup):
    s,ws,_,p,fixture=setup;ws.model=CheckpointPlanner()
    w=ready(ws,spec(budget={'max_generation_calls':4,'max_review_calls':10}))
    w.plan.stages[0].frame_count=8;w.plan_sha256=digest(w.plan.model_dump(mode='json'));ws.save(w)
    w=ws.start(w.id,1,w.plan_sha256)
    original=p.poll
    def poll(remote):
        result=original(remote);request=p.requests[int(remote.split('-')[-1])-1]
        if result.images:result.images=[result.images[(i+(1 if request.edit_frames else 0))%4] for i in range(request.frame_count)]
        return result
    p.poll=poll
    PlanGeneration(s).advance(w.job_id,p,wait=True)
    return s,ws,p,w


def create(s,p,w,**kw):
    token=Checkpoints(s).view(w.job_id,1,0)['token']
    args=dict(token=token,start=2,end=5,note='保持动作姿势，仅修正同一物品的轮廓和握持',mode='appearance',request_key='repair-test-0001',authorized=True,provider=p)
    args.update(kw)
    return LocalRepairs(s).create(w.job_id,1,0,**args)


def test_repair_preserves_outside_bytes_sources_and_requires_fresh_full_review(setup):
    s,ws,p,w=repair_work(setup);engine=PlanGeneration(s);gates=Checkpoints(s);repairs=LocalRepairs(s)
    original=gates.view(w.job_id,1,0);raw=engine.saved_frames(w.job_id,1,0)
    a=create(s,p,w)
    assert len(p.requests)==2 and p.requests[-1].edit_frames and len(p.requests[-1].edit_frames)==6
    create(s,p,w);assert len(p.requests)==2  # Response recovery is idempotent.
    engine.advance(w.job_id,p,wait=True)
    v=gates.view(w.job_id,1,0);a=v['repairs'][0]
    assert a['state']=='awaiting_review' and v['token']==original['token']
    assert [a['proposed_frames'][i] for i in [0,1,6,7]]==[original['frames'][i] for i in [0,1,6,7]]
    with pytest.raises(ConflictError):accept(s,w,0)
    with pytest.raises(ConflictError):repairs.decide(w.job_id,1,0,0,'0'*64,'不能使用旧结论','accept')
    repairs.decide(w.job_id,1,0,0,a['token'],'已核对完整片段及修复窗口两侧接缝','accept')
    assert s.store.load(w.job_id).candidates[0].plan_execution.stages[0].state=='complete'
    engine.advance(w.job_id,p,wait=True)
    updated=gates.view(w.job_id,1,0);assert updated['token']!=original['token']
    assert engine.saved_frames(w.job_id,1,0)==raw and len(p.requests)==2
    assert s.store.load(w.job_id).candidates[0].plan_execution.stages[0].review_history
    accept(s,w,0);engine.advance(w.job_id,p,wait=True);accept(s,w,1)
    job=engine.advance(w.job_id,p,wait=True)
    assert len(job.candidates[0].frames)==12
    assert any('repair_attempt' in item for item in job.candidates[0].plan_execution.frame_mapping)
    assert generation_calls(job)==3


def test_repair_checks_bounds_budget_and_authorization_before_submission(setup):
    s,ws,p,w=repair_work(setup)
    for changes in [{'authorized':False},{'start':0},{'end':7},{'end':4}]:
        with pytest.raises(ValidationHarnessError):create(s,p,w,**changes)
    assert len(p.requests)==1
    with s.store.locked_job(w.job_id) as j:
        j.candidates[0].plan_execution.stages[0].review['requests']=[{}, {}, {}, {}, {}, {}, {}]
    with pytest.raises(ValidationHarnessError,match='视觉预算'):create(s,p,w)
    assert len(p.requests)==1


def test_unknown_repair_never_resubmits_and_can_explicitly_keep_original(setup):
    s,ws,p,w=repair_work(setup);p.unknown=True
    with pytest.raises(ProviderTemporaryError):create(s,p,w)
    create(s,p,w);assert len(p.requests)==2
    for _ in range(2):PlanGeneration(s).advance(w.job_id,p,wait=True)
    with pytest.raises(ConflictError):create(s,p,w,request_key='different-request')
    v=Checkpoints(s).view(w.job_id,1,0)
    LocalRepairs(s).decide(w.job_id,1,0,0,v['token'],'保留未知请求记录，本次保留原片段不继续修复','reject')
    accept(s,w,0);assert len(p.requests)==2


def test_size_specific_edit_limits_reserve_context_slots():
    assert edit_window_limit(64,64)==14
    assert edit_window_limit(80,64)==6
    assert edit_window_limit(128,128)==2
    assert edit_window_limit(256,128)==2
