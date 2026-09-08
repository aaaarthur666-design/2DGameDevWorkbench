"""Durable attack review and human-requested correction, shared by UI/API/recovery."""
from __future__ import annotations
import hashlib
import uuid
from pathlib import Path
from .errors import ConflictError, ValidationHarnessError
from .models import GenerationRequest, ReviewStatus, CandidateStatus
from .vision_review import VisionReviewer, MotionReview
from .motion_constraints import phase_context, repair_prompt, ISSUE_LABELS, RULES

ACTIVE = {"waiting", "checking", "repairing"}
TERMINAL = {"passed", "needs_repair"}

def default_policy(request, action):
    if (request.provider == "pixellab" and request.action_id in {"attack", "attack_in_air"}
            and not request.attack_segment and not request.motion_repair
            and not action.loop):
        return {"version":2, "state":"waiting", "maximum_extra_generations":0, "maximum_manual_generations_per_frame":2, "attempts":[], "reviews":{}, "message":"生成后自动检查并标记问题；由人在逐帧修补中决定是否重新生成"}
    return None

def apply_charge_hold(job, report):
    if not job.motion_control or job.action.action_id != "attack":
        return
    # Brief-charge plans do not reserve the old fixed frame 5-7 hold window.
    if any((c.attack_sequence or {}).get("version",0)>=3 for c in job.candidates):
        return
    count = len(report.get("frames", []))
    charge_indices = {i for i in range(count) if 4 <= i * 16 // count <= 6}
    for issue in list(report.get("hard_failures", [])):
        indices=issue.get("frame_indices", [])
        if issue.get("code")=="consecutive_duplicate_frames" and indices and set(indices)<=charge_indices:
            report["hard_failures"].remove(issue)
            report["warnings"].append({**issue,"code":"intentional_charge_hold","message":"蓄力停顿由视觉检查确认是否合理"})
            for f in report.get("frames",[]):
                if f.get("index") in indices:
                    f["hard_failures"]=[v for v in f["hard_failures"] if v!="consecutive_duplicate_frames"]
                    f["warnings"].append("intentional_charge_hold")
    report["summary"]["hard_failure_count"]=len(report["hard_failures"])
    report["summary"]["warning_count"]=len(report["warnings"])

def active(job):
    return bool(job.motion_control and job.motion_control.get("state") in ACTIVE)

class MotionCorrection:
    def __init__(self, service):
        self.s=service
        self.store=service.store
        self.reviewer=VisionReviewer(service.settings)

    def _candidate(self, job, index):
        return self.s._candidate(job,index)

    def _paths(self, job, candidate):
        self.s._assert_qa_current(job.job_id,job,candidate)
        return [self.store.resolve_job_path(job.job_id,f.active_path) for f in candidate.frames]

    @staticmethod
    def digest(paths):
        return hashlib.sha256(b"".join(hashlib.sha256(p.read_bytes()).digest() for p in paths)).hexdigest()

    def _attempt(self, job, attempt_id):
        for a in (job.motion_control or {}).get("attempts",[]):
            if a["id"]==attempt_id:
                return a
        raise ValidationHarnessError("修补记录不存在")

    def generation_inputs(self, request):
        binding=request.motion_repair
        parent=self.store.load(binding.parent_job_id)
        a=self._attempt(parent,binding.attempt_id)
        if a["mode"] != "manual":
            raise ConflictError("自动补做已停用；请在逐帧修补中人工发起")
        if (request.character_id != parent.request.character_id or request.action_id != parent.request.action_id
                or request.provider != "pixellab" or request.candidate_count != 1 or request.frame_count != 4
                or request.loop is not False or request.attack_segment is not None
                or request.request_key != "motion-"+a["id"] or request.seed != a.get("seed",0) or request.action_description is not None):
            raise ValidationHarnessError("修补请求与已锁定的记录不一致")
        if (a.get("constraints") or {}).get("phase") not in RULES:
            raise ValidationHarnessError("旧修补请求没有阶段约束；请确认阶段后重新发起修补")
        folder=self.store.job_dir(parent.job_id)/"motion"/a["id"]
        frames=tuple((folder/f"input_{i}.png").read_bytes() for i in range(4))
        if [hashlib.sha256(b).hexdigest() for b in frames] != a["input_hashes"]:
            raise ConflictError("修补参考帧已改变")
        return frames, a["prompt"]

    def _save_review(self, job_id, key, paths, action_id):
        reference=self.store.job_dir(job_id)/"input/reference.png"
        # Validate local inputs before reserving a potentially billable request.
        self.reviewer.validate_inputs(paths,reference)
        count=len(paths)
        digest=self.digest(paths)
        job=self.store.load(job_id)
        existing=job.motion_control["reviews"].get(key)
        if existing:
            if existing["state"] != "complete":
                raise ConflictError("上次视觉检查未完成；请查看停止原因，不会自动重复计费")
            if existing.get("digest",digest)!=digest or existing.get("frame_count",count)!=count:
                raise ConflictError("视觉检查对应的是旧帧版本，不能复用结论")
            return existing["report"]
        if not self.reviewer.configured:
            raise ValidationHarnessError("请在设置中保存视觉检查 API Key；本次结果可进入逐帧修补")
        with self.store.locked_job(job_id) as current:
            current.motion_control["reviews"][key]={"state":"prepared","request_started":False,"request_count":0,"maximum_requests":2,"frame_count":count,"digest":digest,
                "provider":self.reviewer.provider,"model":self.reviewer.info["model"]}
            current.touch("motion_review_reserved",review_key=key,frame_count=count)
        def mark_request_started():
            with self.store.locked_job(job_id) as current:
                record=current.motion_control["reviews"][key]
                from .vision_evidence import MAX_VISUAL_REQUESTS
                if record.get("request_count",0)>=MAX_VISUAL_REQUESTS:
                    raise ConflictError("视觉检查已达两次调用上限；不会继续请求")
                record.update(state="checking",request_started=True,request_count=record.get("request_count",0)+1)
                current.touch("motion_review_request_started",review_key=key,frame_count=count)
        try:
            from .grip_contract import owner_for_job
            context={"facing":job.character.facing}
            owner=owner_for_job(job)
            if owner!="reference":context["weapon_hand"]=owner
            index=(int(key.removeprefix("initial-")) if key.startswith("initial-") else
                   next((a["candidate_index"] for a in job.motion_control["attempts"] if key.endswith(a["id"])),None))
            candidate=next((c for c in job.candidates if c.candidate_index==index),None)
            sequence=(candidate.attack_sequence or {}) if candidate else {}
            if sequence.get("actual_frame_count")==count and sequence.get("handoff_frame"):
                context["handoff_frame"]=sequence["handoff_frame"]
                if sequence.get("handoff_frames"):context["handoff_frames"]=sequence["handoff_frames"]
            report=self.reviewer.review(paths,action_id,reference,on_request=mark_request_started,**context)
            parsed=MotionReview.model_validate({k:v for k,v in report.items() if k in MotionReview.model_fields})
            if any(i < 1 or i > count for issue in parsed.issues for i in issue.frames):
                raise ValidationHarnessError("视觉检查帧号超出实际动画范围")
            if count==1 and parsed.verdict=="pass":
                raise ValidationHarnessError("单帧不足以确认动作连续性")
            report={**report,"frame_count":count}
            if report["confidence"]<0.85:
                report={**report,"verdict":"uncertain"}
        except Exception as exc:
            with self.store.locked_job(job_id) as current:
                record=current.motion_control["reviews"][key]
                record.update(state="failed" if record["request_started"] else "not_sent",error=str(exc))
                current.touch("motion_review_failed",review_key=key,request_started=record["request_started"])
            raise
        with self.store.locked_job(job_id) as current:
            current.motion_control["reviews"][key].update(state="complete",report=report)
            current.touch("motion_review_completed",review_key=key,frame_count=count)
        return report

    @staticmethod
    def _legacy_unsent(job, key, record):
        # Old versions reserved before the local !=16 check. Only that exact,
        # evidenced failure is safe to resume; unknown network outcomes are not.
        if record.get("request_started") is not None or record.get("state")!="checking":
            return False
        if not key.startswith("initial-") or (job.motion_control or {}).get("attempts"):
            return False
        try:
            index=int(key.removeprefix("initial-"))
            c=next(c for c in job.candidates if c.candidate_index==index)
        except (ValueError, StopIteration):
            return False
        stopped=[e for e in job.events if e.get("event")=="motion_automation_stopped"]
        return (bool(stopped) and stopped[-1].get("message")=="视觉检查需要完整的 16 帧动作"
                and len(c.frames)!=16 and c.motion_review is None)

    def unsent_candidates(self, job):
        result=[]
        for c in job.candidates:
            if not c.frames or c.status in {CandidateStatus.approved,CandidateStatus.rejected}:
                continue
            key=f"initial-{c.candidate_index}"
            record=job.motion_control["reviews"].get(key)
            if record is None and not c.motion_review:
                result.append(c)
            elif record and ((record.get("state") in {"prepared","not_sent"} and record.get("request_started") is False)
                             or self._legacy_unsent(job,key,record)):
                result.append(c)
        return result

    def resume(self,job_id):
        """Explicitly resume unsent checks; never reset generation or request budgets."""
        with self.store.operation_lock(job_id,"motion",timeout_seconds=2):
            job=self.store.load(job_id)
            if not job.motion_control:
                raise ConflictError("此任务没有自动攻击检查记录")
            if active(job) or job.motion_control["state"]=="passed":
                return job
            if not self.reviewer.configured:
                raise ValidationHarnessError("请先在设置中配置视觉检查 API Key")
            unsent=self.unsent_candidates(job)
            retries=[]
            for key,record in job.motion_control["reviews"].items():
                if record["state"]=="complete":
                    continue
                if (record.get("state") in {"prepared","not_sent"} and record.get("request_started") is False) or self._legacy_unsent(job,key,record):
                    retries.append(key)
                elif not unsent:
                    raise ConflictError("上次视觉请求已发送或结果未知，不能自动重试；请使用逐帧修补")
            if not unsent and not retries and any(c.motion_review for c in job.candidates):
                raise ConflictError("视觉检查已完成；剩余问题请使用逐帧修补，不会重置两次上限")
            for c in unsent:
                self.s._assert_candidate_editable(job,c,operation="resume visual review")
                self.reviewer.validate_inputs(self._paths(job,c),self.store.job_dir(job_id)/"input/reference.png")
            with self.store.locked_job(job_id) as current:
                state=current.motion_control
                previous_message=state.get("message", "")
                for key in retries:
                    state.setdefault("unsent_history",[]).append({"review_key":key,**state["reviews"].pop(key)})
                for c in current.candidates:
                    if c.candidate_index in {item.candidate_index for item in unsent}:
                        c.motion_review=None
                # Remove only synthetic marks created by this stopped check.
                for c in current.candidates:
                    for f in c.frames:
                        if f.review_status==ReviewStatus.repair_requested and f.review_note==previous_message and f.reviewed_by is None:
                            f.review_status=ReviewStatus.pending
                            f.review_note=""
                state.update(state="waiting",version=2,maximum_extra_generations=0,maximum_manual_generations_per_frame=2,message="继续检查全部实际帧并标记问题；不会自动重新生成")
                current.touch("motion_review_resumed",unsent_review_keys=retries)
        return self.store.load(job_id)

    def _mark(self, job_id, candidate_index, report, digest, message=""):
        with self.store.locked_job(job_id) as job:
            c=self._candidate(job,candidate_index)
            c.motion_review={"report":report,"digest":digest}
            for f in c.frames:
                if f.motion_tags and f.reviewed_by is None and f.review_note.startswith("视觉提醒："):
                    f.review_status=ReviewStatus.pending
                    f.review_note=""
                issues=[i for i in report.get("issues",[]) if f.index+1 in i["frames"]]
                if report["verdict"]=="uncertain" and not report.get("issues") and report.get("review_protocol_version",0)<2:
                    issues=[{"code":"uncertain","description":report["summary"],"correction":"","phase":"unknown","phase_confidence":0}]
                f.motion_tags=[{"code":i["code"],"label":ISSUE_LABELS[i["code"]],"description":i["description"],
                    "correction":i.get("correction",""),"phase":i.get("phase","unknown"),"phase_confidence":i.get("phase_confidence",0),
                    "evidence_status":i.get("evidence_status","unverified"),"evidence_confidence":i.get("evidence_confidence",0),
                    "frame_sha256":f.sha256,"review_digest":digest} for i in issues]
                if issues:
                    f.review_status=ReviewStatus.repair_requested
                    if f.reviewed_by is None:
                        f.review_note="视觉提醒："+"；".join(i["description"] for i in issues)
            job.touch("motion_review_recorded",candidate_index=candidate_index)

    def _stop(self, job_id, message):
        with self.store.locked_job(job_id) as job:
            job.motion_control.update(state="needs_repair",message=message)
            for c in job.candidates:
                if c.frames and c.status not in {CandidateStatus.approved,CandidateStatus.rejected}:
                    if not c.motion_review or (c.motion_review["report"].get("review_protocol_version",0)<2 and c.motion_review["report"]["verdict"]!="pass"):
                        if not any(f.review_status==ReviewStatus.repair_requested for f in c.frames):
                            for f in c.frames:
                                f.review_status=ReviewStatus.repair_requested
                                f.review_note=message
            job.touch("motion_automation_stopped",message=message)

    def _reserve(self, job_id, index, targets, mode, note="", phase="auto"):
        if mode != "manual":
            raise ConflictError("自动补做已停用；必须由人在逐帧修补中发起")
        job=self.store.load(job_id); c=self._candidate(job,index)
        paths=self._paths(job,c)
        count=len(paths)
        self.reviewer.validate_inputs(paths,self.store.job_dir(job_id)/"input/reference.png")
        if not targets or any(type(t) is not int or t < 0 or t >= count for t in targets):
            raise ValidationHarnessError("修补目标帧超出实际动画范围")
        self.s._assert_candidate_editable(job,c,operation="motion reservation")
        if len(set(targets))!=1:
            raise ValidationHarnessError("请一次选择一个问题帧进行修补")
        if sum(x["mode"]=="manual" and x["candidate_index"]==index and targets[0] in x["targets"] for x in job.motion_control["attempts"])>=2:
            raise ConflictError("这帧的 AI 修补已达到两次上限，仍可手工修改像素或上传替换")
        guidance=phase_context(job,c,targets[0],self.digest(paths),phase)
        if guidance["phase"]=="unknown":
            raise ValidationHarnessError("请先确认当前帧的攻击阶段；尚未提交生成请求")
        target=targets[0]
        context=list(range(max(0,target-1),min(count,target+2)))
        context += [context[-1]] * (3-len(context))
        context.append(-1)  # Fourth slot is the immutable character reference.
        reference=self.store.job_dir(job_id)/"input/reference.png"
        targets=sorted(set(targets)&set(context))
        report=(c.motion_review or {}).get("report",{}) if (c.motion_review or {}).get("digest")==self.digest(paths) else {}
        correction="; ".join(i["correction"] for i in report.get("issues",[]) if targets[0]+1 in i["frames"] and i.get("evidence_status")=="confirmed")
        prompt=repair_prompt(job.action.action_id,count,targets[0],context,guidance["phase"],correction,note,weapon_hand=guidance["weapon_hand"])
        attempt_id=uuid.uuid4().hex
        folder=self.store.job_dir(job_id)/"motion"/attempt_id
        folder.mkdir(parents=True,exist_ok=False)
        frames=[(reference if i==-1 else paths[i]).read_bytes() for i in context]
        for i,b in enumerate(frames):
            self.s._atomic_write_bytes(folder/f"input_{i}.png",b)
        a={"id":attempt_id,"seed":int(attempt_id[:8],16) % (2**31-1),"mode":mode,"candidate_index":index,"targets":targets,"context":context,
           "constraints":guidance,"frame_count":count,"base_digest":self.digest(paths),"input_hashes":[hashlib.sha256(b).hexdigest() for b in frames],
           "prompt":prompt,"state":"reserved","child_job_id":None}
        with self.store.locked_job(job_id) as current:
            state=current.motion_control
            if mode=="manual" and sum(x["mode"]=="manual" and x["candidate_index"]==index and targets[0] in x["targets"] for x in state["attempts"])>=2:
                raise ConflictError("这帧的 AI 修补已达到两次上限，仍可手工修改像素或上传替换")
            state["attempts"].append(a)
            current.touch("motion_attempt_reserved",attempt_id=attempt_id,mode=mode)
        return a

    def _advance_attempt(self, job_id, attempt_id, wait):
        parent=self.store.load(job_id); a=self._attempt(parent,attempt_id)
        if a["mode"] != "manual":
            raise ConflictError("自动补做已停用；请在逐帧修补中人工发起")
        if not a["child_job_id"]:
            child=self.s.create_job(GenerationRequest(character_id=parent.request.character_id,action_id=parent.request.action_id,
                provider="pixellab",frame_count=4,loop=False,candidate_count=1,seed=a.get("seed",0),request_key="motion-"+a["id"],
                motion_repair={"parent_job_id":job_id,"attempt_id":a["id"]}))
            with self.store.locked_job(job_id) as current:
                self._attempt(current,attempt_id)["child_job_id"]=child.job_id
                current.touch("motion_child_created",child_job_id=child.job_id)
            a=self._attempt(self.store.load(job_id),attempt_id)
        child=self.s.generate_job(a["child_job_id"],wait=wait)
        c=child.candidates[0]
        if c.status in {CandidateStatus.failed,CandidateStatus.submission_unknown,CandidateStatus.submitting}:
            raise ConflictError("补做失败或提交结果未知；已停止自动补做，原结果保留")
        if not c.frames:
            return None
        if len(c.frames)!=4:
            raise ValidationHarnessError("补做返回帧数不符；保留原结果")
        self.s._assert_qa_current(child.job_id,child,c)
        parent=self.store.load(job_id); pc=self._candidate(parent,a["candidate_index"])
        paths=self._paths(parent,pc)
        if self.digest(paths)!=a["base_digest"]:
            raise ConflictError("动画在补做期间已修改；补做结果不会覆盖新版本")
        proposed=list(paths)
        folder=self.store.job_dir(job_id)/"motion"/a["id"]
        for target in a["targets"]:
            data=self.store.resolve_job_path(child.job_id,c.frames[a["context"].index(target)].active_path).read_bytes()
            path=folder/f"proposed_{target}.png"
            self.s._atomic_write_bytes(path,data); proposed[target]=path
        report=self._save_review(job_id,"proposal-"+a["id"],proposed,parent.action.action_id)
        with self.store.locked_job(job_id) as current:
            target=self._attempt(current,attempt_id)
            target.update(state="proposed",report=report,proposal_digest=self.digest(proposed))
            current.touch("motion_proposal_ready",attempt_id=attempt_id)
        return proposed,report

    @staticmethod
    def improves(before,after):
        if after["confidence"]<0.85 or after["verdict"]=="uncertain":
            return False
        if after["verdict"]=="pass":
            return True
        def problems(report):
            return {(issue["code"],i) for issue in report["issues"] for i in issue["frames"]}
        return problems(after)<problems(before)

    def adopt(self,job_id,attempt_id,*,manual=False):
        with self.store.operation_lock(job_id,"motion",timeout_seconds=2):
            return self._adopt(job_id,attempt_id,manual=manual)

    def _adopt(self,job_id,attempt_id,*,manual=False):
        from .processing import run_qa
        if not manual:
            raise ConflictError("修补结果必须由人确认采用")
        with self.store.locked_job(job_id) as job:
            a=self._attempt(job,attempt_id)
            if a["state"]=="accepted":
                return job
            if a["state"]!="proposed" or (a["mode"]=="manual")!=manual:
                raise ConflictError("没有可采用的修补结果")
            c=self._candidate(job,a["candidate_index"])
            self.s._assert_candidate_editable(job,c,operation="motion adoption")
            paths=self._paths(job,c)
            if self.digest(paths)!=a["base_digest"]:
                raise ConflictError("动画已修改；请保留当前版本")
            proposal=list(paths)
            for t in a["targets"]:
                proposal[t]=self.store.job_dir(job_id)/"motion"/a["id"]/f"proposed_{t}.png"
            if self.digest(proposal)!=a["proposal_digest"]:
                raise ConflictError("修补预览已改变")
            palette=list((self.store.job_dir(job_id)/"input").glob("palette.*"))
            qa=run_qa(proposal,len(proposal),job.character.cell_width,job.character.cell_height,
                reference_path=self.store.job_dir(job_id)/"input/reference.png",palette_path=palette[0] if palette else None,
                safe_margin=job.character.safe_margin,grounded=job.action.grounded,anchor_ground_y=job.character.anchor.ground_y,
                loop=job.action.loop,thresholds=self.s._qa_thresholds(job))
            apply_charge_hold(job,qa)
            a["qa_hard_failures"]=qa.get("hard_failures",[])
            for t in a["targets"]:
                f=c.frames[t]
                f.active_path=proposal[t].relative_to(self.store.job_dir(job_id)).as_posix()
                f.sha256=hashlib.sha256(proposal[t].read_bytes()).hexdigest()
                f.review_status=ReviewStatus.pending
                f.reviewed_at=None; f.reviewed_by=None; f.review_note=""
            c.status=CandidateStatus.received
            c.motion_review={"report":a["report"],"digest":a["proposal_digest"]}
            c.qa_issue_baseline=self.s._successful_qa_baseline(c)
            c.qa_input_sha256=None; c.qa_completed_at=None
            a["state"]="accepted"
            job.touch("motion_proposal_accepted",attempt_id=attempt_id,automatic=not manual)
        self.s.check_candidate(job_id,a["candidate_index"])
        self._mark(job_id,a["candidate_index"],a["report"],a["proposal_digest"])
        with self.store.locked_job(job_id) as current:
            passed=all(c.motion_review and c.motion_review["report"]["verdict"]=="pass"
                       and c.motion_review["digest"]==self.digest(self._paths(current,c)) for c in current.candidates)
            current.motion_control.update(state="passed" if passed else "needs_repair",
                message="视觉复检已通过；请播放并人工确认" if passed else "已采用修补帧；剩余提醒由人继续处理，不会自动重新生成")
        return self.store.load(job_id)

    def advance(self,job_id,*,wait=False):
        job=self.store.load(job_id)
        if not active(job):
            return job
        with self.store.operation_lock(job_id,"motion",timeout_seconds=1):
            try:
                # Old queued automatic attempts are never submitted or adopted.
                with self.store.locked_job(job_id) as current:
                    current.motion_control.update(version=2,maximum_extra_generations=0,maximum_manual_generations_per_frame=2)
                    for attempt in current.motion_control["attempts"]:
                        if attempt["mode"]=="auto" and attempt["state"] in {"reserved","proposed"}:
                            attempt.update(state="paused",reason="改为人工决定修补；未继续自动提交或采用")
                for _ in range(1 if not wait else 12):
                    job=self.store.load(job_id)
                    if not active(job): break
                    if any(c.status in {CandidateStatus.created,CandidateStatus.provider_pending,CandidateStatus.saving,CandidateStatus.submitting} for c in job.candidates):
                        break
                    candidate=next((c for c in job.candidates if c.frames and c.status not in {CandidateStatus.approved,CandidateStatus.rejected} and not c.motion_review),None)
                    if candidate:
                        paths=self._paths(job,candidate)
                        digest=self.digest(paths)
                        try:
                            report=self._save_review(job_id,f"initial-{candidate.candidate_index}",paths,job.action.action_id)
                            if report["confidence"]<0.85:
                                report={**report,"verdict":"uncertain"}
                        except Exception as exc:
                            # A failed check consumes only this candidate's reservation.
                            # Persist an unavailable result so refresh never resends it.
                            current=self.store.load(job_id)
                            record=current.motion_control["reviews"].get(f"initial-{candidate.candidate_index}",{})
                            report={"verdict":"uncertain","confidence":0,"issues":[],
                                "summary":f"候选 {candidate.candidate_index} 视觉检查未完成：{exc}",
                                "review_protocol_version":4,"check_unavailable":True,
                                "frame_count":len(paths),"request_count":record.get("request_count",0),
                                "provider":record.get("provider"),"model":record.get("model"),
                                "error":str(exc)}
                        self._mark(job_id,candidate.candidate_index,report,digest)
                        continue
                    uncertain=any(c.motion_review and c.motion_review["report"]["verdict"]=="uncertain" for c in job.candidates)
                    if uncertain:
                        self._stop(job_id,"视觉检查无法可靠判断，已添加提醒；请逐帧确认，不会自动重新生成")
                        break
                    bad=next((c for c in job.candidates if c.motion_review and c.motion_review["report"]["verdict"]=="fail"),None)
                    if any(c.status in {CandidateStatus.failed,CandidateStatus.submission_unknown} or not c.frames for c in job.candidates):
                        self._stop(job_id,"生成未完成，请检查任务记录；未继续补做")
                        break
                    if not bad:
                        with self.store.locked_job(job_id) as current:
                            current.motion_control.update(state="passed",message="视觉检查已通过；请播放确认后导出")
                            current.touch("motion_check_passed")
                        break
                    self._stop(job_id,"所有候选视觉检查结束；已定位问题帧，请在逐帧修补中决定保留、手工修改或重新生成")
                    break
            except Exception as exc:
                self._stop(job_id,str(exc))
        return self.store.load(job_id)

    def manual(self,job_id,index,frame_index,base_sha256,note="",*,phase="auto",retry=False,wait=False):
        with self.store.operation_lock(job_id,"motion",timeout_seconds=2):
            job=self.store.load(job_id); c=self._candidate(job,index)
            if active(job):
                raise ConflictError("视觉检查仍在进行，请等待结果")
            self.s._assert_candidate_editable(job,c,operation="manual motion repair")
            if job.action.action_id not in {"attack", "attack_in_air"}:
                raise ValidationHarnessError("此 AI 修补用于地面和空中攻击；其他动作请使用像素修补")
            f=self.s._frame(c,frame_index)
            if not base_sha256:
                raise ConflictError("当前帧尚未加载完成；请稍候或点击“刷新当前结果”后重试")
            if f.sha256!=base_sha256:
                raise ConflictError("当前帧已有新版本；请点击“刷新当前结果”后再生成修补预览")
            # Clicking Generate is the explicit repair request. A visual tag or
            # a prior review mark is not required to propose an editable frame.
            # The frame itself stays unchanged until the user adopts a preview.
            if not self.reviewer.configured:
                raise ValidationHarnessError("请先在设置中保存 视觉检查 API Key")
            if not job.motion_control:
                with self.store.locked_job(job_id) as current:
                    current.motion_control={"version":2,"state":"needs_repair","maximum_extra_generations":0,"maximum_manual_generations_per_frame":2,"attempts":[],"reviews":{},"message":"手动修补"}
            job=self.store.load(job_id)
            previous=[a for a in job.motion_control["attempts"] if a["mode"]=="manual" and a["candidate_index"]==index and frame_index in a["targets"]]
            a=previous[-1] if previous else None
            if a and retry and not a.get("constraints"):
                a=None
            if a and (a["state"]=="reserved" or not retry):
                if a["state"]=="accepted":
                    return a
            else:
                a=None
            if a is None:
                a=self._reserve(job_id,index,[frame_index],"manual",note or f.review_note or "Repair discontinuity with neighboring poses",phase=phase)
            if a["state"]=="reserved":
                self._advance_attempt(job_id,a["id"],wait)
            return self._attempt(self.store.load(job_id),a["id"])
