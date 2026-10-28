"""Occlusion is not loss, uncertainty is not a pass, direct defects stay defects."""
import copy
from unittest.mock import patch

import pytest
from test_open_motion import setup
from test_production_review import production, ExpertRegistry
from sprite_pipeline.collaboration.visibility_review import schema,guard
from sprite_pipeline.collaboration.visual_review import Audit
from sprite_pipeline.collaboration.dispute_review import Resolution
from sprite_pipeline.collaboration.execution import PlanGeneration
from sprite_pipeline.errors import ValidationHarnessError


def finding(**updates):
    return dict(subject='原图中的手持物',frames=[2,3],before_frames=[1],after_frames=[4],
        observation='not_visible',explanation='occlusion',expected_visibility='unknown',finding='uncertain',
        contradiction_frames=[],facts='中间两帧物品与身体重叠，边界看不清楚',
        alternatives='前后物品可辨认，遮挡合理但不能证明隐藏部分形状',**updates)


def opinion(status='fail',item=None,*,resolution=False):
    checks=[dict(dimension=d,confidence=.97,frames=[1,2,3,4],evidence='已根据实际顺序图片与前后可见边界核对') for d in ('equipment','completeness','rhythm')]
    for c in checks:
        if resolution:c.update(classification=status if c['dimension']=='equipment' else 'satisfied',observation='实际图片可辨认的证据',prior_claim_correction='原有推测须以实际图片核对')
        else:c['status']=status if c['dimension']=='equipment' else 'pass'
    return schema(Resolution if resolution else Audit).model_validate(dict(summary='按实际可见证据检查',checks=checks,
        equipment_visibility={'items':[item or finding()],'summary':'区分可见矛盾、投影变化和遮挡'}))


def test_unsupported_loss_and_unsupported_pass_remain_uncertain():
    for state in ('fail','pass'):
        raw=opinion(state);original=raw.model_dump()
        result,trace=guard(raw,4)
        assert result.checks[0].status=='uncertain' and result.checks[0].confidence==0
        assert trace['raw_opinion']==original and raw.model_dump()==original
        assert trace['verified_geometry'] is False


@pytest.mark.parametrize('kind',['visible_shape_break','visible_duplicate','identity_change'])
def test_positive_visible_contradictions_are_not_excused_as_occlusion(kind):
    item=finding();item.update(observation='visible',finding=kind,explanation='none',contradiction_frames=[2],
        facts='一帧中清晰可见分离的第二条轮廓且连接点断开',alternatives='前后视角连续，遮挡和投影都不能解释当前分离的轮廓')
    result,trace=guard(opinion(item=item),4)
    assert result.checks[0].status=='fail' and trace['guard_reason'] is None
    assert guard(opinion('pass',item=item),4)[0].checks[0].status=='uncertain'


def test_supported_absence_requires_expected_visibility_and_no_plausible_explanation():
    item=finding();item.update(finding='unexplained_absence',expected_visibility='supported',explanation='none',contradiction_frames=[2])
    assert guard(opinion(item=item),4)[0].checks[0].status=='fail'
    item['explanation']='foreshortening'
    assert guard(opinion(item=item),4)[0].checks[0].status=='uncertain'


def test_projection_evidence_can_support_consistency_but_never_automatically_adopts():
    item=finding();item.update(observation='partly_visible',finding='consistent',explanation='foreshortening',
        facts='刀尖随转向逐渐缩短，握持点和根部轮廓连续，后续恢复长度')
    result,trace=guard(opinion('pass',item=item),4)
    assert result.checks[0].status=='pass' and not trace['verified_geometry']
    assert guard(opinion('material_defect',item=item,resolution=True),4,resolution=True)[0].checks[0].classification=='insufficient_evidence'


@pytest.mark.parametrize('updates',[{'frames':[2,5]},{'before_frames':[2]},{'after_frames':[3]},{'contradiction_frames':[4]}])
def test_bad_frame_evidence_stops_without_rewriting(updates):
    item=finding();item.update(updates)
    raw=opinion(item=item)
    with pytest.raises(ValidationHarnessError):guard(raw,4)


def test_v2_accepts_explicit_join_comparison_without_relaxing_frame_identity():
    item=finding();item.update(observation='visible',finding='visible_shape_break',contradiction_frames=[1,2])
    raw=opinion(item=item);before=raw.model_dump(mode='json')
    with pytest.raises(ValidationHarnessError):guard(raw,4,version=1)
    result,trace=guard(raw,4,version=2)
    assert result.checks[0].status=='fail' and trace['version']==2
    assert raw.model_dump(mode='json')==before
    item['contradiction_frames']=[1]  # Context alone cannot identify a bad observed frame.
    with pytest.raises(ValidationHarnessError):guard(opinion(item=item),4,version=2)
    item['contradiction_frames']=[2,5]
    with pytest.raises(ValidationHarnessError):guard(opinion(item=item),5,version=2)


def test_v3_shared_context_is_not_mistaken_for_a_disjoint_interval():
    item=finding();item.update(frames=[1,2,3,4],before_frames=[1,2],after_frames=[4],
        observation='visible',finding='visible_shape_break',contradiction_frames=[2,3])
    raw=opinion(item=item);before=raw.model_dump(mode='json')
    with pytest.raises(ValidationHarnessError):guard(raw,4,version=2)
    result,trace=guard(raw,4,version=3)
    assert result.checks[0].status=='fail' and trace['frame_lists_are_evidence_sets_not_intervals']
    assert raw.model_dump(mode='json')==before
    item['after_frames']=[5]
    with pytest.raises(ValidationHarnessError):guard(opinion(item=item),4,version=3)


class VisibilityRegistry(ExpertRegistry):
    def send(self,role,content,result_type,count,**kwargs):
        if 'equipment_visibility' not in result_type.model_fields:
            return super().send(role,content,result_type,count,**kwargs)
        base=Resolution if issubclass(result_type,Resolution) else Audit
        value,receipt=super().send(role,content,base,count,**kwargs)
        item=finding();item.update(frames=[2],before_frames=[1],after_frames=[count])
        raw=value.model_dump(mode='json');raw['equipment_visibility']={'items':[item],'summary':'遮挡不能确认为消失，也不能直接证明外观合格'}
        for field in ('change','preservation'):
            if field in result_type.model_fields:raw[field]={'status':'pass','confidence':.95,'frames':[2],'evidence':'修改前后分别检查目标和保护项'}
        return result_type.model_validate(raw),receipt


def test_formal_review_keeps_baseline_costs_and_human_gate(setup):
    s,ws,p,w,old=production(setup)
    with s.store.locked_job(w.job_id) as job:job.request.open_plan.visibility_review_version=1
    registry=VisibilityRegistry();s.open_motion_review_registry=registry
    engine=PlanGeneration(s);engine.advance(w.job_id,p,wait=True)
    stage=s.store.load(w.job_id).candidates[0].plan_execution.stages[0]
    details=stage.review['expert_review']
    assert stage.state=='awaiting_review' and details['state']=='complete'
    assert len(registry.calls)==5 and len(p.requests)==1
    assert details['visibility_review_version']==1 and len(details['visibility_evidence'])==3
    assert 'VISIBILITY EVIDENCE' not in registry.calls[0][1] and 'VISIBILITY EVIDENCE' not in registry.calls[1][1]
    assert all('VISIBILITY EVIDENCE' in c[1] for c in registry.calls[2:])
    assert stage.review['verdict']=='uncertain'
    engine.advance(w.job_id,p,wait=True)
    assert len(registry.calls)==5 and len(p.requests)==1


def test_changed_policy_stops_inflight_review_without_new_calls(setup):
    s,ws,p,w,_=production(setup)
    with s.store.locked_job(w.job_id) as job:job.request.open_plan.visibility_review_version=1
    def mutate(n):
        if n==3:
            with s.store.locked_job(w.job_id) as job:job.request.open_plan.visibility_review_version=None
    registry=VisibilityRegistry(after_send=mutate);s.open_motion_review_registry=registry
    PlanGeneration(s).advance(w.job_id,p,wait=True)
    report=s.store.load(w.job_id).candidates[0].plan_execution.stages[0].review
    assert report['state']=='failed' and len(registry.calls)==3 and len(p.requests)==1


def test_legacy_formal_reviews_do_not_request_new_fields(setup):
    s,ws,p,w,registry=production(setup)
    PlanGeneration(s).advance(w.job_id,p,wait=True)
    details=s.store.load(w.job_id).candidates[0].plan_execution.stages[0].review['expert_review']
    assert 'visibility_review_version' not in details
    assert all('VISIBILITY EVIDENCE' not in c[1] for c in registry.calls)


def test_new_adjudication_guard_keeps_exact_prior_model_inputs():
    from sprite_pipeline.collaboration.visibility_review import add_content
    content=[{'type':'input_text','text':'Inspect ordered actual frames.'}]
    assert add_content(content,version=4)==add_content(content,version=3)


def test_independent_visible_defect_cannot_be_silently_cleared_over_a_passing_baseline(setup):
    s,ws,p,w,_=production(setup)
    with s.store.locked_job(w.job_id) as job:job.request.open_plan.visibility_review_version=4
    class Contradicting(VisibilityRegistry):
        def send(self,role,content,result_type,count,**kw):
            result,meta=super().send(role,content,result_type,count,**kw)
            if hasattr(result,'equipment_visibility'):
                item=result.equipment_visibility.items[0]
                item.observation='visible';item.finding='consistent'
                if not isinstance(result,Resolution):
                    next(c for c in result.checks if c.dimension=='equipment').status='fail'
                    item.finding='visible_shape_break';item.contradiction_frames=[2]
            return result,meta
    registry=Contradicting();s.open_motion_review_registry=registry
    PlanGeneration(s).advance(w.job_id,p,wait=True)
    stage=s.store.load(w.job_id).candidates[0].plan_execution.stages[0];report=stage.review
    assert report['state']=='complete' and len(registry.calls)==5 and len(p.requests)==1
    assert next(c for c in report['checks'] if c['dimension']=='equipment')['status']=='uncertain'
    assert any(p['dimension']=='equipment' for p in report['requires_human_adjudication'])
    assert report['expert_review']['visibility_conflict']['state']=='needs_human_adjudication'
    assert next(c for c in report['resolution']['checks'] if c['dimension']=='equipment')['classification']=='satisfied'
    assert stage.state=='awaiting_review'  # Original resolution is retained, not fabricated as a failure.


def test_adjustment_comparison_and_visibility_share_the_existing_five_calls(setup):
    from test_motion_adjustments import stage_work,request,IntentRegistry
    from sprite_pipeline.collaboration.adjustments import Adjustments,AdjustmentIntent,frozen_inputs
    from sprite_pipeline.collaboration.contracts import digest
    s,ws,p,w=stage_work(setup,True);s.adjustment_test_reviews=True
    class Registry(VisibilityRegistry,IntentRegistry):
        def send(self,role,content,result_type,count,**kw):
            if issubclass(result_type,AdjustmentIntent):
                return IntentRegistry.send(self,role,content,result_type,count,**kw)
            return VisibilityRegistry.send(self,role,content,result_type,count,**kw)
    registry=Registry();s.open_motion_review_registry=registry;m=Adjustments(s)
    before=(s.store.job_dir(w.job_id)/'job.json').read_bytes()
    t=m.create(w.id,request(m,w));t['visibility_review_version']=1
    t['frozen_digest']=digest(frozen_inputs(t));m.save(t)
    t=m.advance(w.id,t['id'],p)
    assert t['state']=='ready',t
    assert len(t['planning_calls'])==1 and len(t['generation_calls'])==1 and len(t['review_calls'])==5
    assert t['review']['comparison']['state']=='complete'
    assert len(t['review']['expert_review']['visibility_evidence'])==3
    assert (s.store.job_dir(w.job_id)/'job.json').read_bytes()==before
    assert not t.get('edit_regions')
    assert all(t['proposed_frames'][i]['sha256']==t['source_frames'][i]['sha256'] for i in (0,3))
