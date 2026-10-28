"""Drawing conditions retain mechanics, checked images and frozen old behavior."""
import copy
import hashlib
import json
import uuid
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from test_open_motion import setup, spec
from test_open_motion_checkpoints import CheckpointPlanner, accept
from sprite_pipeline.collaboration.contracts import PlanBinding, digest
from sprite_pipeline.collaboration.execution import PlanGeneration
from sprite_pipeline.collaboration.generation_conditions import compile_conditions, condition_rows
from sprite_pipeline.collaboration.planning import PlanningModel
from sprite_pipeline.collaboration.quality import compiled_prompt
from sprite_pipeline.collaboration.targets import save_target
from sprite_pipeline.errors import ValidationHarnessError
from sprite_pipeline.jsonio import read_json


class ConditionPlanner(CheckpointPlanner):
    def __call__(self, *args, **kwargs):
        response, receipt = super().__call__(*args, **kwargs)
        if response['action'] == 'finalize':
            p = response['plan']; q = p['quality']; q['version'] = 4
            q['appearance_contract'] = 'Same outfit, one soft hat, original grip.'
            q['ending_contract'] = 'Balanced bow, hat held ahead.'
            q['key_poses'] = [{'frame':1,'description':'Hat near head'},
                              {'frame':4,'description':'Hat raised, torso upright'},
                              {'frame':8,'description':'Torso bowed, hat ahead'}]
            for i, s in enumerate(p['stages']):
                s['prompt'] = 'Raise hat, keep torso upright.' if i == 0 else 'Bow once, bring hat ahead.'
                s['checkpoint'].update(endpoint='Hat raised, torso upright.' if i == 0 else 'Balanced bow, hat ahead.',
                                       rhythm='1-3 move; 4 flow onward.' if i == 0 else '1-2 bow; 3-4 ease down.')
                s['motion'] = dict(camera='Fixed side view.', orientation='Body remains side-on.',
                    drive='Arm leads; wrist and hat follow.' if i == 0 else 'Hips fold; torso then arms follow.',
                    support='Feet apart; knees soften.', trajectory='Hand curves up.' if i == 0 else 'Hat curves forward and down.',
                    appearance='Soft hat flexes; stays in the same hand.',
                    entry='Continue actual input pose.', exit='Flow onward.' if i == 0 else 'Settle in a balanced bow.',
                    boundary='pass_through' if i == 0 else 'settle', holds=[],
                    generation_hint='Keep hat touching its original hand.')
        return response, receipt


def work(setup, *, policy=1):
    s, ws, _, p, fixture = setup
    ws.model = ConditionPlanner()
    w = ws.create(spec(), uuid.uuid4().hex, planning_authorized=True)
    w.generation_policy_version = policy; ws.save(w)
    w = ws.plan(w.id)
    assert w.status == 'ready', w.message
    return s, ws, p, fixture, w


@pytest.mark.parametrize('policy',[1,2])
def test_all_mechanics_reach_provider_and_both_real_image_conditions_survive(setup,policy):
    s, ws, provider, fixture, w = work(setup,policy=policy)
    targets = [p.read_bytes() for p in fixture.write_sequence(fixture.root/'checked-targets')][1:3]
    for i, png in enumerate(targets):
        w = save_target(ws,w.id,w.revision,i,png,'已检查同一角色的具体姿势与装备')
    w = ws.start(w.id,w.revision,w.plan_sha256)
    engine = PlanGeneration(s)
    for i in range(2):
        engine.advance(w.job_id,provider,wait=True)
        req = provider.requests[i]
        motion = w.plan.stages[i].motion
        assert req.last_frame == targets[i]
        for field in ['camera','orientation','drive','support','trajectory','appearance','generation_hint']:
            assert getattr(motion,field) in req.prompt
        assert len(req.prompt) <= 1000
        intent = read_json(engine.directory(w.job_id,1,i)/'submit.intent.json')
        trace = intent['drawing_conditions']
        assert trace['target_mode'] == 'image'
        assert trace['last_sha256'] == hashlib.sha256(targets[i]).hexdigest()
        assert trace['prompt_sha256'] == hashlib.sha256(req.prompt.encode()).hexdigest()
        assert trace['rows'] == condition_rows(w.plan,i,policy_version=policy)
        accept(s,w,i)
    assert provider.requests[1].reference_image == engine.saved_frames(w.job_id,1,0)[-1]
    engine.advance(w.job_id,provider,wait=True)
    assert len(s.store.load(w.job_id).candidates[0].frames) == 8
    assert len(provider.requests) == 2
    ws.view(w.id); ws.start(w.id,w.revision,w.plan_sha256)
    assert len(provider.requests) == 2  # Reads/duplicate delivery do not redraw.


def test_missing_target_is_honest_and_not_synthesized(setup):
    s, ws, p, _, w = work(setup)
    w = ws.start(w.id,1,w.plan_sha256); engine = PlanGeneration(s)
    engine.advance(w.job_id,p,wait=True)
    intent = read_json(engine.directory(w.job_id,1,0)/'submit.intent.json')
    assert p.requests[0].last_frame is None
    assert intent['drawing_conditions']['target_mode'] == 'text_only'
    assert not w.end_targets


def test_field_overflow_stops_without_silent_truncation_or_omission(setup):
    s, ws, p, _, w = work(setup)
    plan = w.plan.model_copy(deep=True)
    plan.stages[0].prompt = 'A changing full-body pose. ' * 30
    with pytest.raises(ValidationHarnessError,match='不截断'):
        compile_conditions(plan,0)
    assert not p.requests and not w.job_id


def test_turn_airborne_flexible_shape_and_explicit_hold_are_not_overridden(setup):
    _, _, _, _, w = work(setup)
    plan = w.plan.model_copy(deep=True); m = plan.stages[0].motion
    m.orientation = 'Turn toward viewer.'
    m.support = 'Airborne; no foot contact.'
    m.appearance = 'Flexible cloth twists around its owner.'
    text = compile_conditions(plan,0)
    assert m.orientation in text and m.support in text and m.appearance in text
    assert 'feet planted' not in text and 'face right' not in text
    m.boundary = 'intentional_hold'
    from sprite_pipeline.collaboration.contracts import PlannedHold
    m.holds = [PlannedHold(start=3,end=4,reason='User requested a pause.')]
    text = compile_conditions(plan,0)
    assert '3-4: User requested a pause.' in text
    assert 'no endpoint hold' not in text


def test_saved_v4_work_and_frozen_prompts_do_not_opt_into_new_policy(setup):
    s, ws, p, _, w = work(setup,policy=None)
    before = copy.deepcopy(w.plan.model_dump(mode='json'))
    old = [compiled_prompt(w.plan,None,i) for i in range(2)]
    assert 'generation_policy_version' not in w.model_dump(mode='json')
    w = ws.start(w.id,1,w.plan_sha256)
    job = s.store.load(w.job_id)
    assert 'generation_policy_version' not in job.request.open_plan.model_dump(mode='json')
    assert job.request.open_plan.compiled_prompts == old
    PlanGeneration(s).advance(w.job_id,p,wait=True)
    assert p.requests[0].prompt == old[0]
    assert w.plan.model_dump(mode='json') == before
    assert digest(before) == w.plan_sha256


def test_changed_frozen_conditions_cannot_be_submitted(setup):
    s, ws, _, _, w = work(setup)
    w = ws.start(w.id,1,w.plan_sha256)
    b = s.store.load(w.job_id).request.open_plan.model_dump(mode='json')
    b['compiled_prompts'][0] = 'Something else entirely'
    with pytest.raises(ValidationError,match='Frozen drawing conditions'):
        PlanBinding.model_validate(b)


def test_new_planning_policy_reaches_all_experts_without_changing_old_transport(setup):
    s, ws, _, _, w = work(setup)
    model = PlanningModel(s.settings); captured = []
    class Registry:
        def send(self,role,content,schema,*args,**kwargs):
            captured.append((role,content,kwargs))
            value = {'action':'propose','summary':'可见部位与运动依据',
                     'findings':[{'text':'按原图保持归属','source':'reference','evidence':'原图可见内容'}]}
            if role=='strategy': value['proposal']=w.plan.model_dump(mode='json')
            if role=='coordinator': value={'action':'finalize','summary':'协调完成','plan':w.plan.model_dump(mode='json')}
            return schema.model_validate(value),{}
    model.registry = Registry()
    for role in ['appearance','motion','strategy','coordinator']:
        model(role,w,ws.reference(w))
        text = captured[-1][1][0]['text']
        assert 'DRAWING CONDITIONS policy 1' in text
        assert 'They will ALL be compiled' not in text
        assert 'fewer frames within' in text
        data = json.loads(text.split('TASK DATA:\n',1)[1])
        assert data['drawing_condition_policy']['motion_fields_sent_directly'] == ['camera','orientation','drive','support','trajectory','appearance']
    model('appearance',w.model_copy(update={'generation_policy_version':None}),ws.reference(w))
    text = captured[-1][1][0]['text']
    assert 'DRAWING CONDITIONS policy 1' not in text and 'They will ALL be compiled' in text


def test_validated_defaults_are_new_only_and_reads_never_upgrade_old_records(setup):
    s, ws, _, _, _ = setup
    from sprite_pipeline.collaboration.contracts import TaskSpec
    raw=spec().model_dump(mode='json'); raw['provider']='pixellab'
    with patch('sprite_pipeline.collaboration.workspace.DEFAULT_GENERATION_POLICY',None),patch('sprite_pipeline.collaboration.workspace.DEFAULT_VISIBILITY_REVIEW',None):
        w=ws.create(TaskSpec.model_validate(raw),uuid.uuid4().hex,planning_authorized=True)
    assert w.generation_policy_version is None and not w.planning_calls
    assert ws.load(w.id).generation_policy_version is None
    assert ws.create(w.spec,w.request_key,planning_authorized=True).generation_policy_version is None
    raw['review_protocol']='experts_v1'
    new=ws.create(TaskSpec.model_validate(raw),uuid.uuid4().hex,planning_authorized=True)
    assert new.generation_policy_version==5 and new.visibility_review_version==4
    assert not new.planning_calls and not new.job_id


def test_policy_2_maximum_field_lengths_six_poses_and_three_holds_fit(setup):
    from sprite_pipeline.collaboration.contracts import PlanProposal
    from sprite_pipeline.collaboration.generation_conditions import TEXT_LIMITS
    _,_,_,_,w=work(setup,policy=2)
    raw=w.plan.model_dump(mode='json');raw['stages']=raw['stages'][:1]
    stage=raw['stages'][0];stage['frame_count']=16
    for kind,target in [('MotionQuality',raw['quality']),('PlanStage',stage),
                         ('PoseCheckpoint',stage['checkpoint']),('MotionConstraints',stage['motion'])]:
        for field,limit in TEXT_LIMITS[kind].items():target[field]='x'*limit
    raw['quality']['key_poses']=[{'frame':n,'description':'x'*26} for n in range(10,16)]
    stage['motion']['boundary']='intentional_hold'
    stage['motion']['holds']=[{'start':n,'end':n+1,'reason':'r'*100} for n in [10,12,14]]
    plan=PlanProposal.model_validate(raw);before=plan.model_dump(mode='json')
    prompt=compile_conditions(plan,0,policy_version=2)
    assert len(prompt)<=1000
    assert all(f'{n}-{n+1}' in prompt for n in [10,12,14])
    assert 'r'*100 not in prompt  # Reasons remain in review, exact ranges reach drawing.
    assert plan.model_dump(mode='json')==before


def test_text_budget_is_in_wire_schema_and_local_validation_without_rewriting(setup):
    from sprite_pipeline.collaboration.contracts import CoordinatorTurn
    from sprite_pipeline.collaboration.generation_conditions import bind_text_budget,TEXT_LIMITS
    _,_,_,_,w=work(setup,policy=2)
    schema=bind_text_budget(CoordinatorTurn);wire=schema.model_json_schema()
    assert wire['$defs']['MotionConstraints']['properties']['drive']['maxLength']==60
    assert CoordinatorTurn.model_json_schema()['$defs']['MotionConstraints']['properties']['drive']['maxLength']==140
    raw={'action':'finalize','summary':'预算化完整方案','plan':w.plan.model_dump(mode='json')}
    raw['plan']['quality']['appearance_contract']='x'*46
    before=copy.deepcopy(raw)
    with pytest.raises(ValidationError,match='45'):
        schema.model_validate(raw)
    assert raw==before
    raw['plan']['questions']=['需要确认关键目标']
    assert schema.model_validate(raw).plan.questions  # Do not block genuine clarification.
