"""Non-technical Gradio controls for bounded, manually reviewed attack plans."""

from functools import partial
from pathlib import Path
from typing import Any

from .attack_plans import ANCHOR_FRAMES, AttackPlans, BUSY, PHASES
from .processing import build_gif


def build_attack_panel(service: Any, *, character_inputs: list, resolve_character: Any):
    import gradio as gr
    plans = AttackPlans(service)

    def choices():
        return [(f"{p['character_name']} · 已用 {len(p['attempts'])}/{p['max_submissions']} 次 · {p['plan_id'][:6]}", p['plan_id'])
                for p in plans.list_plans()]

    def project(plan_id, segment):
        if not plan_id:
            return ("先确认五张关键姿势并保存方案。", [], [], None, None, "",
                    [[None]*4 for _ in range(4)], False, None, gr.update(interactive=False), None,
                    gr.update(interactive=False), gr.update(interactive=False), gr.update(interactive=False), 0, "握点")
        plan = plans.load(plan_id)
        segment = int(segment)
        attempt = plans.latest(plan, segment)
        rows = [f"**已占用 {len(plan['attempts'])} / {plan['max_submissions']} 次，剩余 {plan['max_submissions']-len(plan['attempts'])} 次。**",
            "每次请求 4 帧；首轮共 20 帧，最多 28 帧。此处为生成量上限，实际扣费以服务商为准。",
            "| 片段 | 已用次数 | 当前情况 |", "|---|---:|---|"]
        for i, phase in enumerate(PHASES):
            latest = plans.latest(plan, i)
            state = "已采用并锁定" if str(i) in plan['accepted'] else "等待生成"
            if latest and str(i) not in plan['accepted']:
                state = "次数已预留，等待提交"
                if latest.get('job_id'):
                    value = service.get_job(latest['job_id']).candidates[0].status.value
                    state = {"created": "已预留，尚未提交", "provider_pending": "生成中，请只刷新结果",
                        "submitting": "提交尚未确认，停止新生成", "submission_unknown": "提交结果未知，停止新生成",
                        "review_ready": "待检查", "check_failed": "检查异常，请查看原始结果",
                        "failed": "失败，保留记录", "saving": "正在保存"}.get(value, value)
            rows.append(f"| {i+1} · {phase} | {sum(a['segment']==i for a in plan['attempts'])}/2 | {state} |")
        if plan['status'] != 'active':
            rows.append("方案已完成。" if plan['status'] == 'complete' else "方案已停止；已有图片和次数记录均保留。")
        anchors = [(str(plans.anchor(plan,i)), f"第 {frame+1} 帧") for i, frame in enumerate(ANCHOR_FRAMES)]
        gallery, preview, first, token = [], None, None, ""
        accepted = plan['accepted'].get(str(segment))
        points = accepted['points'] if accepted else [[None]*4 for _ in range(4)]
        try:
            child_id, paths = plans.frames(plan, segment)
            token = plans.review_token(plan, segment)
            gallery = [(str(path), f"第 {segment*3+i+1} 帧" + (" · 固定姿势" if i in (0,3) else "")) for i,path in enumerate(paths)]
            first = str(paths[0])
            preview = plans.directory(plan_id) / f"preview_{token}.gif"
            if not preview.exists():
                build_gif(paths, preview, fps=8, loop=True)
            preview = str(preview)
        except Exception as exc:
            child_id = attempt.get('job_id') if attempt else None
            if attempt:
                rows.append(str(exc))
        active = plan['status'] == 'active' and not accepted
        preceding = all(str(i) in plan['accepted'] for i in range(segment))
        extras = len(plan['attempts'])-len({a['segment'] for a in plan['attempts']})
        can_retry = (active and preceding and attempt and attempt['attempt'] < 2
                     and extras < plan['max_submissions']-5)
        return ("\n\n".join(rows[:2])+"\n\n"+"\n".join(rows[2:]), anchors, gallery, preview, first, token,
            points, False, plan['output_job_id'], gr.update(interactive=bool(plan['output_job_id'])), child_id,
            gr.update(interactive=bool(active and preceding)), gr.update(interactive=bool(can_retry)),
            gr.update(interactive=bool(active and token)), 0, "握点")

    def create(uploaded, reference_state, name, identity, saved_character, *values):
        keys, limit, confirmed = values[:5], int(values[5]), values[6]
        if not confirmed:
            raise gr.Error("请逐张确认抬刀、蓄力、下劈、随动和恢复姿势，再锁定方案")
        if not all(keys):
            raise gr.Error("请为五个阶段分别提供一张透明 PNG；可以使用手工修正后的旧帧")
        try:
            character_id, _ = resolve_character(uploaded, reference_state, name, identity, saved_character)
            plan = plans.create(character_id, [Path(getattr(k, 'name', k)) for k in keys], max_submissions=limit)
            return gr.update(choices=choices(), value=plan['plan_id']), 0
        except Exception as exc:
            raise gr.Error(str(exc)) from exc

    def act(operation, plan_id, segment, reason, token, points, confirmed):
        try:
            if operation == "submit":
                plans.submit(plan_id, int(segment))
            elif operation == "retry":
                plans.submit(plan_id, int(segment), retry=True, reason=reason or "")
            elif operation == "refresh":
                plans.refresh(plan_id, int(segment))
            elif operation == "accept":
                data = points.tolist() if hasattr(points, 'tolist') else points
                plans.accept(plan_id, int(segment), token=token, points=data, phase_confirmed=confirmed)
            elif operation == "assemble":
                plans.assemble(plan_id)
            elif operation == "stop":
                plans.stop(plan_id)
            return project(plan_id, segment)
        except Exception as exc:
            # Show the persisted ledger even after a failed/unknown paid submission.
            values = list(project(plan_id, segment))
            values[0] = f"**已停止当前操作：{str(exc)}**\n\n" + values[0]
            return tuple(values)

    with gr.Accordion("受约束攻击：确认姿势 → 分段生成 → 有限补做", open=True, elem_id="controlled-attack"):
        gr.Markdown("**攻击建议使用此流程。** 先准备正确的关键姿势，再补中间帧。第 1 帧使用上方角色原图；"
            "其余五张可从旧动画导出并手工修正。此处不会自动花费额度制作关键姿势。"
            "刀在第 4、7 帧都应保持在肩后，第 10 帧已完成唯一下劈，第 13 帧低位随动，第 16 帧恢复。")
        with gr.Row():
            keys = [gr.Image(label=label, type="filepath", image_mode="RGBA", format="png", sources=["upload"], height=180)
                    for label in ("第 4 帧 · 过肩", "第 7 帧 · 蓄力顶点", "第 10 帧 · 下劈结束", "第 13 帧 · 低位随动", "第 16 帧 · 恢复")]
        with gr.Row():
            budget = gr.Radio([( "5 次：只做首轮", 5), ("6 次：最多补做 1 次", 6), ("7 次：最多补做 2 次", 7)], value=7, label="整件作品的生成次数上限（保存后不能增加）")
            confirm_keys = gr.Checkbox(label="我已逐张确认关键姿势，允许按这些姿势生成中间帧", value=False)
        create_button = gr.Button("锁定姿势和次数上限（此步免费）")
        with gr.Row():
            plan_choice = gr.Dropdown(choices(), value=None, label="已保存的攻击方案", filterable=False)
            reload_button = gr.Button("找回已保存方案")
        segment = gr.Radio([(f"{i+1} · {phase}", i) for i,phase in enumerate(PHASES)], value=0, label="当前片段")
        status = gr.Markdown("先确认关键姿势并保存方案。")
        anchors = gr.Gallery(label="已锁定关键姿势", columns=6, height=180, object_fit="contain", allow_preview=True)
        with gr.Row():
            submit_button = gr.Button("生成当前片段 / 继续已有请求", variant="primary", interactive=False)
            refresh_button = gr.Button("只刷新已有结果（不生成）")
        with gr.Row():
            preview = gr.Image(label="当前片段慢放（已替换为固定边界姿势）", type="filepath", interactive=False, height=240)
            gallery = gr.Gallery(label="需检查的四帧", columns=4, height=240, object_fit="contain", allow_preview=True)
        gr.Markdown("**逐帧点出握点和刀尖**，检查朝向是否跳变。选一帧后，先点握点，再点刀尖；"
            "可在表格中校正坐标。坐标检查只是辅助，仍需确认武器确实握在手里，且没有提前挥刀、再次蓄力或边界跳动。")
        with gr.Row():
            with gr.Column():
                frame_choice = gr.Radio([("片段第 1 帧",0),("第 2 帧",1),("第 3 帧",2),("第 4 帧",3)],value=0,label="标注哪一帧")
                point_kind = gr.Radio(["握点", "刀尖"], value="握点", label="下一次点击标记")
                label_image = gr.Image(label="点击武器位置", type="filepath", interactive=False, height=320)
            coordinates = gr.Dataframe(headers=["握点 X", "握点 Y", "刀尖 X", "刀尖 Y"],
                value=[[None]*4 for _ in range(4)], datatype="number", type="array", row_count=(4,"fixed"), column_count=(4,"fixed"), label="四帧武器坐标（按片段顺序）")
        phase_confirmed = gr.Checkbox(value=False, label="已逐帧确认：朝向、握持和边界连续，仅在第 3 段挥刀一次，其余阶段没有误挥或再次蓄力")
        with gr.Row():
            accept_button = gr.Button("检查通过：锁定当前片段", interactive=False)
            edit_button = gr.Button("打开当前片段，检查或手工修补")
        with gr.Accordion("片段有问题时：只补做一次", open=False):
            reason = gr.Textbox(label="发现了什么问题？", placeholder="例如：第二帧的刀突然翻向前方。已有结果会保留。")
            retry_button = gr.Button("使用 1 次剩余额度补做当前片段", interactive=False)
        with gr.Row():
            assemble_button = gr.Button("合成已采用的 5 段（免费，输出 16 帧）")
            open_button = gr.Button("打开完整动画进行检查 / 导出", interactive=False)
        with gr.Accordion("停止本方案", open=False):
            gr.Markdown("停止后保留全部图片与次数记录，不会继续付费生成。")
            stop_button = gr.Button("停止方案并保留结果", variant="stop")
        token = gr.State("")
        output_job = gr.State(None)
        child_job = gr.State(None)
        outputs = [status, anchors, gallery, preview, label_image, token, coordinates, phase_confirmed,
                   output_job, open_button, child_job, submit_button, retry_button, accept_button, frame_choice, point_kind]
        create_button.click(create, inputs=[*character_inputs,*keys,budget,confirm_keys], outputs=[plan_choice,segment], concurrency_limit=1)
        reload_button.click(lambda: gr.update(choices=choices()), outputs=plan_choice, queue=False)
        plan_choice.change(project, inputs=[plan_choice,segment], outputs=outputs, queue=False)
        segment.input(project, inputs=[plan_choice,segment], outputs=outputs, queue=False)
        for button, operation in ((submit_button,"submit"),(refresh_button,"refresh"),(retry_button,"retry"),
                                  (accept_button,"accept"),(assemble_button,"assemble"),(stop_button,"stop")):
            button.click(partial(act,operation), inputs=[plan_choice,segment,reason,token,coordinates,phase_confirmed],
                         outputs=outputs, concurrency_limit=1, concurrency_id="attack_plan_actions", trigger_mode="once")

        def select_frame(plan_id, segment, frame):
            _, paths = plans.frames(plans.load(plan_id), int(segment))
            return str(paths[int(frame)]), "握点"
        frame_choice.input(select_frame, inputs=[plan_choice,segment,frame_choice], outputs=[label_image,point_kind], queue=False)

        def mark_point(data, frame, kind, event: gr.SelectData):
            rows = data.tolist() if hasattr(data,"tolist") else data
            rows = [list(row) for row in rows]
            x, y = event.index
            offset = 0 if kind == "握点" else 2
            rows[int(frame)][offset:offset+2] = [x,y]
            return rows, "刀尖" if kind == "握点" else "握点", False
        label_image.select(mark_point, inputs=[coordinates,frame_choice,point_kind], outputs=[coordinates,point_kind,phase_confirmed], queue=False)
    return open_button, output_job, status, edit_button, child_job
