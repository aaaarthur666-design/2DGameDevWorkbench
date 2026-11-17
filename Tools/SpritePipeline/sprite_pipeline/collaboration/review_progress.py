"""Persist observable review progress beside the original request ledger."""
from __future__ import annotations


CHECKS = {
    'prepare': '准备实际帧与检查证据',
    'observe': '按顺序观察全部实际帧',
    'audit': '核对动作、外观与节奏合同',
    'expert_appearance': '外观专家独立检查',
    'expert_motion': '运动专家独立检查',
    'dispute': '针对争议复核实际帧',
    'done': '视觉检查已结束',
}


def update_progress(job, report, index, *, stage=None, phase=None):
    """Called under locked_job; reads never resume or repeat a model request."""
    requests = report.get('requests', [])
    state = report.get('state', 'pending')
    if phase is None:
        phase = ('done' if state in {'complete', 'diagnostic'} else
                 requests[-1]['phase'] if requests else 'prepare')
    scope = '整段动画' if stage is None else f'第 {stage+1} 段'
    after = ('读取完整实际帧并记录采用结论' if stage is None else
             '读取本段实际帧，以原 token 确认或拒绝片段')
    next_step = (f'继续查询原任务，检查结束后{after}。' if state in {'pending', 'running'} else
                 f'本次检查未完成，原请求记录已保留；{after}，不自动重发。' if state in {'failed', 'unknown'} else
                 f'{after}；模型意见不代替实际画面确认。')
    progress = {
        'state': state, 'scope': 'candidate' if stage is None else 'stage',
        'candidate_index': index, 'phase': phase,
        'current_check': CHECKS.get(phase, '检查实际帧'),
        'calls_used': len(requests),
        'calls_completed': sum(r.get('state') == 'complete' for r in requests),
        'max_calls': 5 if job.request.open_plan.spec.review_protocol == 'experts_v1' else 2,
        'next_step': next_step,
    }
    if stage is not None:
        progress['stage_index'] = stage
    if state == 'running' and requests and requests[-1].get('state') == 'submitting':
        progress['current_call'] = {'number': len(requests), **{
            key: requests[-1][key] for key in ('request_id', 'phase', 'state', 'started_at', 'response_id')
            if key in requests[-1]}}
    report['progress'] = progress
    if state == 'running' and job.plan_control:
        job.plan_control.message = f'{scope}：{progress["current_check"]}（已完成 {progress["calls_completed"]}，已用 {progress["calls_used"]}/{progress["max_calls"]} 次调用）'
