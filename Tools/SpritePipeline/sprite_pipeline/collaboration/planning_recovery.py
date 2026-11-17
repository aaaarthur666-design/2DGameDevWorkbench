"""One explicit schema correction and conservative specialist evidence reuse."""
from __future__ import annotations

from copy import deepcopy


SPECIALISTS = ('appearance', 'motion', 'strategy')


def validation_details(errors):
    """Keep actionable schema paths, never the invalid output or its field values."""
    return {
        'structured_validation_failed': True,
        'validation_error_count': len(errors),
        'validation_errors': [
            {'field': '.'.join(str(part) for part in item['loc']),
             'type': item['type'], 'message': item['msg'][:400]}
            for item in errors[:24]
        ],
    }


def correction_receipt(exc):
    """Only a completed, identified schema failure permits a correction call.

    HTTP failures, unfinished output, model mismatches and ambiguous requests
    retain the existing no-retry behavior, even if they have a usage receipt.
    """
    receipt = exc.details.get('model_receipt', {})
    if not receipt.get('structured_validation_failed') or not receipt.get('output_sha256'):
        return None
    if receipt.get('response_model') not in (None, receipt.get('requested_model')):
        return None
    if receipt.get('finish_reason') not in (None, 'stop'):
        return None
    return receipt


def correction_question(role, details, original_question=''):
    import json
    return (
        f'Local schema validation rejected ONLY your {role} response. This is your one correction turn. '
        'Return the same role-specific JSON object with the listed fields corrected. '
        'Preserve the original user intent, evidence, event count/direction, ending, structure IDs and budgets. '
        'Rewrite overlong text concisely without dropping constraints; choose feasible even stage frame counts. '
        'Do not truncate fields, invent facts or IDs, change the task, or repeat other specialists. '
        'If the requirements cannot fit, report the unresolved conflict through your allowed consultation '
        'or final plan.questions instead of silently weakening the motion.\n'
        + ('Original turn request: ' + original_question + '\n' if original_question else '')
        + 'Schema errors (diagnostics only): ' + json.dumps(details, ensure_ascii=False)
    )


def _profile(configuration, role):
    if 'default' not in configuration:
        return configuration
    return configuration.get('roles', {}).get(role, configuration['default'])


def _inputs(work, role):
    spec = work.spec.model_dump(mode='json')
    if role in ('appearance', 'motion'):
        # These independent observations interpret the reference and intent;
        # drawing/review quotas, seeds and candidate count do not change either.
        spec = {key: value for key, value in spec.items()
                if key not in {'budget', 'candidate_count', 'seed', 'provider', 'review_protocol'}}
    dependencies = SPECIALISTS if role == 'strategy' else (role,)
    return {
        'spec': spec, 'reference_sha256': work.reference_sha256,
        'character': work.character, 'visual_structure': work.visual_structure,
        'planning_format_version': work.planning_format_version,
        'generation_policy_version': work.generation_policy_version,
        'models': {key: _profile(work.planning_config, key) for key in dependencies},
    }


def reusable_messages(previous, revised):
    """Reuse qualified proposals, with their original revision/call provenance.

    A coordinator always evaluates the new revision. Changed user meaning,
    reference, checked structure or specialist model invalidates its evidence.
    Strategy additionally depends on all specialist models and the full spec.
    """
    selected = {}
    for role in SPECIALISTS:
        if _inputs(previous, role) != _inputs(revised, role):
            continue
        messages = [message for message in previous.messages if message.get('role') == role]
        if not messages:
            continue
        message = messages[-1]
        if message.get('response', {}).get('action') != 'propose':
            continue  # An outstanding inspection/consultation is not a completed role.
        origin = message.get('reused_from')
        if origin:
            # A later call in this revision supersedes reused evidence, including
            # an invalid or ambiguous response that was not added to messages.
            if any(call.get('role') == role for call in previous.planning_calls):
                continue
        else:
            index = message.get('call', 0) - 1
            if not 0 <= index < len(previous.planning_calls):
                continue
            call = previous.planning_calls[index]
            if call.get('role') != role or call.get('state') != 'completed':
                continue
            if any(call.get('role') == role for call in previous.planning_calls[index + 1:]):
                continue
            origin = {'revision': previous.revision, 'call': index + 1,
                      'request_id': call['request_id']}
        if role == 'strategy' and not {'appearance', 'motion'} <= selected.keys():
            continue
        selected[role] = {**deepcopy(message), 'reused_from': deepcopy(origin)}
    return list(selected.values())
