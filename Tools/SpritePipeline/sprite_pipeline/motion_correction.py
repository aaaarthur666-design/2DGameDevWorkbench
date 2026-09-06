"""Durable attack review and two-attempt correction, shared by UI/API/recovery."""
from __future__ import annotations
import hashlib
import uuid
from pathlib import Path
from .errors import ConflictError, ValidationHarnessError
from .models import GenerationRequest, ReviewStatus, CandidateStatus
from .vision_review import VisionReviewer, MotionReview, contract

ACTIVE = {"waiting", "checking", "repairing"}
TERMINAL = {"passed", "needs_repair"}

def default_policy(request, action):
    if (request.provider == "pixellab" and request.action_id in {"attack", "attack_in_air"}
            and not request.attack_segment and not request.motion_repair
            and not action.loop):
        return {"version":1, "state":"waiting", "maximum_extra_generations":2, "attempts":[], "reviews":{}, "message":"生成后自动检查；整个任务最多额外补做两次"}
    return None

def apply_charge_hold(job, report):
    if not job.motion_control or job.action.action_id != "attack":
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
        if (request.character_id != parent.request.character_id or request.action_id != parent.request.action_id
                or request.provider != "pixellab" or request.candidate_count != 1 or request.frame_count != 4
                or request.loop is not False or request.attack_segment is not None
                or request.request_key != "motion-"+a["id"] or request.seed != a.get("seed",0) or request.action_description is not None):
            raise ValidationHarnessError("修补请求与已锁定的记录不一致")
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
            current.motion_control["reviews"][key]={"state":"prepared","request_started":False,"frame_count":count,"digest":digest,
                "provider":self.reviewer.provider,"model":self.reviewer.info["model"]}
            current.touch("motion_review_reserved",review_key=key,frame_count=count)
        def mark_request_started():
            with self.store.locked_job(job_id) as current:
                record=current.motion_control["reviews"][key]
                record.update(state="checking",request_started=True)
                current.touch("motion_review_request_started",review_key=key,frame_count=count)
        try:
            report=self.reviewer.review(paths,action_id,reference,on_request=mark_request_started)
            parsed=MotionReview.model_validate({k:v for k,v in report.items() if k in MotionReview.model_fields})
            if any(i < 1 or i > count for issue in parsed.issues for i in issue.frames):
                raise ValidationHarnessError("视觉检查帧号超出实际动画范围")
            if count==1 and parsed.verdict=="pass":
                raise ValidationHarnessError("单帧不足以确认动作连续性")
            report={**report,"frame_count":count}
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
            retries=[]
            for key,record in job.motion_control["reviews"].items():
                if record["state"]=="complete":
                    continue
                if (record.get("state") in {"prepared","not_sent"} and record.get("request_started") is False) or self._legacy_unsent(job,key,record):
                    retries.append(key)
                else:
                    raise ConflictError("上次视觉请求已发送或结果未知，不能自动重试；请使用逐帧修补")
            if not retries and any(c.motion_review for c in job.candidates):
                raise ConflictError("视觉检查已完成；剩余问题请使用逐帧修补，不会重置两次上限")
            for c in job.candidates:
                self.s._assert_candidate_editable(job,c,operation="resume visual review")
                self.reviewer.validate_inputs(self._paths(job,c),self.store.job_dir(job_id)/"input/reference.png")
            with self.store.locked_job(job_id) as current:
                state=current.motion_control
                previous_message=state.get("message", "")
                for key in retries:
                    state.setdefault("unsent_history",[]).append({"review_key":key,**state["reviews"].pop(key)})
                # Remove only synthetic marks created by this stopped check.
                for c in current.candidates:
                    for f in c.frames:
                        if f.review_status==ReviewStatus.repair_requested and f.review_note==previous_message and f.reviewed_by is None:
                            f.review_status=ReviewStatus.pending
                            f.review_note=""
                state.update(state="waiting",message="继续检查已保存的全部实际帧；补做次数上限保持不变")
                current.touch("motion_review_resumed",unsent_review_keys=retries)
        return self.store.load(job_id)

    def _mark(self, job_id, candidate_index, report, digest, message=""):
        with self.store.locked_job(job_id) as job:
            c=self._candidate(job,candidate_index)
            c.motion_review={"report":report,"digest":digest}
            bad={i-1 for issue in report.get("issues",[]) for i in issue["frames"]}
            if report["verdict"]=="uncertain" and not bad:
                bad={f.index for f in c.frames}
            for f in c.frames:
                if f.index in bad:
                    f.review_status=ReviewStatus.repair_requested
                    f.review_note=message or report["summary"]
            job.touch("motion_review_recorded",candidate_index=candidate_index)

    def _stop(self, job_id, message):
        with self.store.locked_job(job_id) as job:
            job.motion_control.update(state="needs_repair",message=message)
            for c in job.candidates:
                if c.frames and c.status not in {CandidateStatus.approved,CandidateStatus.rejected}:
                    if not c.motion_review or c.motion_review["report"]["verdict"]!="pass":
                        if not any(f.review_status==ReviewStatus.repair_requested for f in c.frames):
                            for f in c.frames:
                                f.review_status=ReviewStatus.repair_requested
                                f.review_note=message
            job.touch("motion_automation_stopped",message=message)

    def _reserve(self, job_id, index, targets, mode, note=""):
        job=self.store.load(job_id); c=self._candidate(job,index)
        paths=self._paths(job,c)
        count=len(paths)
        self.reviewer.validate_inputs(paths,self.store.job_dir(job_id)/"input/reference.png")
        if not targets or any(type(t) is not int or t < 0 or t >= count for t in targets):
            raise ValidationHarnessError("修补目标帧超出实际动画范围")
        self.s._assert_candidate_editable(job,c,operation="motion reservation")
        start=max(0,min(min(targets)-1,max(0,count-4)))
        context=list(range(start,min(start+4,count)))
        context += [context[-1]] * (4-len(context))
        targets=sorted(set(targets)&set(context))
        attempt_id=uuid.uuid4().hex
        folder=self.store.job_dir(job_id)/"motion"/attempt_id
        folder.mkdir(parents=True,exist_ok=False)
        frames=[paths[i].read_bytes() for i in context]
        for i,b in enumerate(frames):
            self.s._atomic_write_bytes(folder/f"input_{i}.png",b)
        # Instructions refer to the four submitted frames while retaining global phase timing.
        prompt=(f"Edit FOUR slots representing actual frames {[i+1 for i in context]} of a {count}-frame animation. Repeated indices are context padding, not extra motion. "
            f"Correct ONLY local frames {[context.index(t)+1 for t in targets]}; preserve all other poses, identity, grip, colors, canvas and transparency. "
            +"Fix: "+note[:500]+" "+contract(job.action.action_id,count))[:1000]
        a={"id":attempt_id,"seed":int(attempt_id[:8],16) % (2**31-1),"mode":mode,"candidate_index":index,"targets":targets,"context":context,
           "frame_count":count,"base_digest":self.digest(paths),"input_hashes":[hashlib.sha256(b).hexdigest() for b in frames],
           "prompt":prompt,"state":"reserved","child_job_id":None}
        with self.store.locked_job(job_id) as current:
            state=current.motion_control
            if mode=="auto" and sum(x["mode"]=="auto" for x in state["attempts"])>=2:
                raise ConflictError("已达到整个任务额外两次生成上限")
            if mode=="manual" and sum(x["mode"]=="manual" and x["candidate_index"]==index and targets[0] in x["targets"] for x in state["attempts"])>=2:
                raise ConflictError("这帧的 AI 修补已达到两次上限，仍可手工修改像素或上传替换")
            state["attempts"].append(a)
            if mode=="auto":
                state.update(state="repairing",message=f"正在补做问题帧（最多额外两次）")
            current.touch("motion_attempt_reserved",attempt_id=attempt_id,mode=mode)
        return a

    def _advance_attempt(self, job_id, attempt_id, wait):
        parent=self.store.load(job_id); a=self._attempt(parent,attempt_id)
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
            before=c.motion_review["report"] if c.motion_review else {"issues":[]}
            # Automatic adoption is deliberately conservative. Manual adoption remains explicit.
            if not manual and (qa.get("hard_failures") or not self.improves(before,a["report"])):
                a["state"]="rejected"
                a["rejection_reason"]="local_qa" if qa.get("hard_failures") else "visual_not_improved"
                job.touch("motion_proposal_rejected",attempt_id=attempt_id)
                return job
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
        return self.store.load(job_id)

    def advance(self,job_id,*,wait=False):
        job=self.store.load(job_id)
        if not active(job):
            return job
        with self.store.operation_lock(job_id,"motion",timeout_seconds=1):
            try:
                # One initial check per candidate and at most two correction checks per JOB.
                for _ in range(1 if not wait else 12):
                    job=self.store.load(job_id)
                    if not active(job): break
                    pending=next((a for a in job.motion_control["attempts"] if a["mode"]=="auto" and a["state"] in {"reserved","proposed"}),None)
                    if pending:
                        if pending["state"]=="reserved":
                            result=self._advance_attempt(job_id,pending["id"],wait)
                            if result is None: break
                        self._adopt(job_id,pending["id"])
                        continue
                    if any(c.status in {CandidateStatus.created,CandidateStatus.provider_pending,CandidateStatus.saving,CandidateStatus.submitting} for c in job.candidates):
                        break
                    candidate=next((c for c in job.candidates if c.frames and c.status not in {CandidateStatus.approved,CandidateStatus.rejected} and not c.motion_review),None)
                    if candidate:
                        paths=self._paths(job,candidate)
                        digest=self.digest(paths)
                        report=self._save_review(job_id,f"initial-{candidate.candidate_index}",paths,job.action.action_id)
                        if report["confidence"]<0.85:
                            report={**report,"verdict":"uncertain"}
                        self._mark(job_id,candidate.candidate_index,report,digest)
                        continue
                    uncertain=any(c.motion_review and c.motion_review["report"]["verdict"]=="uncertain" for c in job.candidates)
                    if uncertain:
                        self._stop(job_id,"视觉检查无法可靠判断，已停止自动补做；请逐帧检查")
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
                    if sum(a["mode"]=="auto" for a in job.motion_control["attempts"])>=2:
                        self._stop(job_id,"已用完额外两次补做；保留较好版本，剩余问题已标记到逐帧修补")
                        break
                    issue=bad.motion_review["report"]["issues"][0]
                    self._reserve(job_id,bad.candidate_index,[i-1 for i in issue["frames"]],"auto",issue["correction"])
            except Exception as exc:
                self._stop(job_id,str(exc))
        return self.store.load(job_id)

    def manual(self,job_id,index,frame_index,base_sha256,note="",*,retry=False,wait=False):
        with self.store.operation_lock(job_id,"motion",timeout_seconds=2):
            job=self.store.load(job_id); c=self._candidate(job,index)
            if active(job):
                raise ConflictError("自动补做仍在进行，请等待结果")
            self.s._assert_candidate_editable(job,c,operation="manual motion repair")
            if job.action.action_id not in {"attack", "attack_in_air"}:
                raise ValidationHarnessError("此 AI 修补用于地面和空中攻击；其他动作请使用像素修补")
            f=self.s._frame(c,frame_index)
            if f.sha256!=base_sha256 or f.review_status!=ReviewStatus.repair_requested:
                raise ConflictError("请先选择当前版本的待修补帧")
            if not self.reviewer.configured:
                raise ValidationHarnessError("请先在设置中保存 视觉检查 API Key")
            if not job.motion_control:
                with self.store.locked_job(job_id) as current:
                    current.motion_control={"version":1,"state":"needs_repair","maximum_extra_generations":2,"attempts":[],"reviews":{},"message":"手动修补"}
            job=self.store.load(job_id)
            previous=[a for a in job.motion_control["attempts"] if a["mode"]=="manual" and a["candidate_index"]==index and frame_index in a["targets"]]
            a=previous[-1] if previous else None
            if a and (a["state"]=="reserved" or not retry):
                if a["state"]=="accepted":
                    return a
            else:
                a=None
            if a is None:
                a=self._reserve(job_id,index,[frame_index],"manual",note or f.review_note or "Repair discontinuity with neighboring poses")
            if a["state"]=="reserved":
                self._advance_attempt(job_id,a["id"],wait)
            return self._attempt(self.store.load(job_id),a["id"])
