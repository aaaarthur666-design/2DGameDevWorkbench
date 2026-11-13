"""Admission of registered PixelLab prop outputs in the local workbench."""
import hashlib
import io
import os
import re
import tempfile
from pathlib import Path

from PIL import Image

from .errors import ConflictError, ValidationHarnessError
from .jsonio import atomic_write_json, inside, read_json, sha256_file
from .models import InteractablePreset


def source_artifact(repo, task_id):
    """Resolve only registered task artifacts. The gateway never accepts an uploaded prop."""
    workspace = read_json(repo / 'workbench/manifest.json')['workspace']
    tasks = inside(repo, repo / workspace['taskDirectory'])
    outputs = inside(repo, repo / workspace['outputDirectory'])
    namespace = os.environ.get('WORKBENCH_TEST_RUN')
    if namespace:
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}', namespace):
            raise ValidationHarnessError('无效的测试工作区')
        tasks = inside(repo, repo / 'work/test-runs' / namespace / 'tasks')
        outputs = inside(repo, repo / 'outputs/test-runs' / namespace)
    task = read_json(inside(tasks, tasks / (task_id + '.json')))
    fields = task['input']
    if (task['id'] != task_id or task['capabilityId'] != 'reference-art' or task['status'] != 'completed'
            or fields.get('subject') != 'prop' or fields['operation'] != 'generate'
            or fields.get('size', 128) != 128 or not task.get('adapter', {}).get('referenceJobId')):
        raise ValidationHarnessError('物品动画移送需要已完成的 128 像素 PixelLab 物品原图任务')
    folder = inside(outputs, outputs / task_id)
    png = inside(folder, folder / 'reference.png')
    record = inside(folder, folder / 'result.json')
    if not all(p.relative_to(repo).as_posix() in task['outputs'] for p in (png, record)):
        raise ValidationHarnessError('源任务没有登记原图及结果记录')
    result = read_json(record)
    if (result.get('model') != 'pixflux' or result.get('subject', 'prop') != 'prop'
            or (result.get('width'), result.get('height')) != (128, 128) or png.stat().st_size > 1_000_000):
        raise ValidationHarnessError('源任务的物品原图记录无效')
    data = png.read_bytes()
    if hashlib.sha256(data).hexdigest() != result['sha256']:
        raise ConflictError('物品原图与登记的哈希不一致')
    with Image.open(io.BytesIO(data)) as image:
        alpha = image.convert('RGBA').getchannel('A')
        if image.format != 'PNG' or image.size != (128,128) or not alpha.getbbox() or alpha.getextrema()[0] == 255:
            raise ValidationHarnessError('物品原图必须是有可见内容和透明背景的 128 像素 PNG')
        left, _, right, bottom = alpha.getbbox()
    return fields, data, {'x': (left + right - 1) // 2, 'ground_y': bottom - 1}


def transfer(service, task_id, description):
    repo = service.settings.install_root.parents[1]
    try:
        fields, data, anchor = source_artifact(repo, task_id)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        raise ValidationHarnessError('无法核对源任务及其登记产物，请检查本机工作台任务记录') from exc
    identity = 'reference_' + hashlib.sha256(task_id.encode()).hexdigest()[:24]
    path = service.presets.object_path(identity)
    with service.store.global_lock('reference-preset-' + identity):
        if service.presets.object_exists(identity):
            existing, saved = service.presets.load_object(identity, object_type='interactable')
            if sha256_file(saved.parent / existing.reference_frame) != hashlib.sha256(data).hexdigest() or (
                description and description != existing.identity_description):
                raise ConflictError('同一物品移送标识已绑定其他原图或外观说明')
            return identity
        preset = InteractablePreset(object_id=identity, display_name=fields.get('name') or '生成的交互物',
            identity_description=description or fields['prompt'][:1000], cell_width=128, cell_height=128,
            reference_frame='reference.png', anchor=anchor)
        root = service.presets.objects_dir
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root, prefix='.prop-import-') as tmp:
            package = Path(tmp) / 'preset'
            package.mkdir()
            (package / preset.reference_frame).write_bytes(data)
            atomic_write_json(package / 'object.json', preset.model_dump(mode='json'))
            package.rename(path.parent)
    return identity
