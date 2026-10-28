"""Reserve the scheduled experts before optional paid consultations (policy 5)."""
from ..errors import ValidationHarnessError


def context(work,role):
    unseen=[r for r in ('appearance','motion','strategy','coordinator') if r!=role and not any(m['role']==r for m in work.messages)]
    remaining=max(0,work.spec.budget.max_planning_calls-len(work.planning_calls))
    return {'remaining_after_current':remaining,'roles_not_yet_heard':unseen,
            'rule':'Reserve scheduled strategy and coordinator turns. Put noncritical uncertainty in findings; the coordinator can resolve it from peer observations. Do not repeat a consultation merely to name an invisible anatomical detail. Critical unresolved user choices belong in final plan.questions, never an invented assumption.'}


def defer(work,role,turn,queue):
    if turn.action not in ('consult','inspect_reference'):return False
    if turn.action=='consult' and turn.target==role:raise ValidationHarnessError('专家不能向自己发起重复质询')
    if turn.action=='inspect_reference' and turn.crop:
        left,top,right,bottom=turn.crop
        if not 0<=left<right<=work.character['cell_width'] or not 0<=top<bottom<=work.character['cell_height']:
            raise ValidationHarnessError('专家请求的观察区域超出原图范围')
    extra=2 if turn.action=='consult' else 1
    remaining=work.spec.budget.max_planning_calls-len(work.planning_calls)
    if remaining>=len(queue)+extra:return False
    note={'action':turn.action,'from':role,'target':turn.target,'question':turn.question,
          'crop':turn.crop,'reason':'reserve_remaining_scheduled_experts','resolved':False}
    work.messages[-1]['deferred_request']=note
    for i,(next_role,question,crop) in enumerate(queue):
        if next_role=='coordinator':
            queue[i]=(next_role,question+'\nA peer request was deferred to preserve the scheduled budget. Inspect deferred_request and the unchanged raw expert response. Resolve from existing evidence, keep unknown geometry unknown, or ask the user in plan.questions; do not claim the consultation occurred.',
                      crop or (turn.crop if turn.action=='inspect_reference' else None))
            break
    return True
