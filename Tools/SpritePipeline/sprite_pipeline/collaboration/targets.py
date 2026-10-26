"""Explicitly reviewed real target images; no fabricated or replaced endpoints."""
import hashlib
import io
from PIL import Image
from .contracts import TargetImage
from ..errors import ConflictError, ValidationHarnessError


def checked_png(data, width, height):
    if not data or len(data) > 1_500_000:
        raise ValidationHarnessError('请使用与角色同尺寸的透明 PNG')
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != 'PNG' or image.size != (width, height) or 'A' not in image.getbands():
                raise ValueError()
            image.load()
            if not image.getchannel('A').getbbox(): raise ValueError()
    except Exception:
        raise ValidationHarnessError('目标姿势须为与角色同尺寸、含可见内容和透明通道的 PNG') from None
    return hashlib.sha256(data).hexdigest()


def save_target(workspace, work_id, revision, stage, data, note):
    with workspace.lock(work_id):
        work = workspace.load(work_id)
        if work.revision != revision or work.status != 'ready' or work.job_id or not work.plan:
            raise ConflictError('只能在当前方案开始制作前设置目标图片；已执行的输入保持冻结')
        if not 0 <= stage < len(work.plan.stages) or len(note.strip()) < 4:
            raise ValidationHarnessError('请选择有效片段并写明实际检查依据')
        targets = [t for t in work.end_targets if t.stage != stage]
        if data is not None:
            sha = checked_png(data, work.character['cell_width'], work.character['cell_height'])
            if work.plan.stages[stage].last_frame == 'original' and sha != work.reference_sha256:
                raise ConflictError('本段已约定回到原始参考图，不能绑定另一个末姿势')
            if sha == work.reference_sha256 and not (work.spec.return_to_reference and stage == len(work.plan.stages)-1):
                raise ConflictError('未约定回到原始图片；请提供本段实际目标姿势')
            target = TargetImage(stage=stage, filename=f'target-{stage}-{sha[:16]}.png', sha256=sha, note=note.strip())
            path = workspace.directory(work_id)/target.filename
            if path.exists() and path.read_bytes() != data: raise ConflictError('已有目标快照不同，禁止覆盖')
            workspace.service._atomic_write_bytes(path, data)
            targets.append(target)
        work.end_targets = sorted(targets, key=lambda t:t.stage)
        workspace.save(work)
        return work


def freeze_targets(workspace, work, job_id):
    for target in work.end_targets:
        data = (workspace.directory(work.id)/target.filename).read_bytes()
        if hashlib.sha256(data).hexdigest() != target.sha256: raise ConflictError('目标图片发生变化，未继续制作')
        path = workspace.store.job_dir(job_id)/'targets'/target.filename
        path.parent.mkdir(parents=True,exist_ok=True)
        if path.exists() and path.read_bytes() != data: raise ConflictError('已冻结的目标图片不同')
        workspace.service._atomic_write_bytes(path,data)


def target_bytes(service, job, stage):
    target = next((t for t in job.request.open_plan.end_targets if t.stage == stage), None)
    if target:
        data = (service.store.job_dir(job.job_id)/'targets'/target.filename).read_bytes()
        if hashlib.sha256(data).hexdigest() != target.sha256: raise ConflictError('末姿势目标图片发生变化，停止提交')
        return data
    return None
