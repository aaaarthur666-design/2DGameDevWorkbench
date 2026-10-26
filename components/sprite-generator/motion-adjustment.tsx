'use client';
/* oxlint-disable next/no-img-element -- Displays hash-bound original/alternative PNGs. */
import {useEffect,useRef,useState} from 'react';
import {motionRequest,motionUrl,type MotionWork,type MotionReview} from './open-motion-model';
import {MotionVisualReview} from './motion-visual-review';

type Adjustment={id:string;state:string;message:string;start:number;end:number;source_token:string;preview_token?:string;
  user_request:string;intent_source:string;intent?:{goal:string;preserve:string;method:string;conflict:string};
  proposed_frames?:{sha256:string}[];review?:MotionReview;qa?:{hard_failures:unknown[];warnings:unknown[]};
  planning_calls:unknown[];generation_calls:unknown[];review_calls:unknown[];fps:number};
type Context={token:string;frames:{sha256:string}[];fps:number;locked_frames:number[];appearance_max:number;attempt_limit:number;
  suggestions:{text:string;frames:number[]}[];tasks:Adjustment[];budget:{planning:number;generation:number;review:number}};
type Response={adjustment:Adjustment;work:MotionWork};
const processing=new Set(['queued','planning','submitting','pending','reviewing','adopting']);
const unresolved=new Set([...processing,'ready','unknown']);

export function MotionAdjustment({work,candidate,stage,readOnly,onSaved,onPendingChange,onOpenChange}:{work:MotionWork;candidate:number;stage?:number;
  readOnly:boolean;onSaved:(w:MotionWork)=>void;onPendingChange?:(pending:boolean)=>void;onOpenChange?:(open:boolean)=>void}) {
  const [open,setOpen]=useState(false),[context,setContext]=useState<Context|null>(null),[task,setTask]=useState<Adjustment|null>(null);
  const [start,setStart]=useState<number|null>(null),[end,setEnd]=useState<number|null>(null),[user,setUser]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[frame,setFrame]=useState(0),[playing,setPlaying]=useState(false);
  const [loaded,setLoaded]=useState(''),[played,setPlayed]=useState(false),[note,setNote]=useState(''),[ack,setAck]=useState(false);
  const drag=useRef<number|null>(null),request=useRef<{key:string;body:string}|null>(null);
  const route=`open-motion/${work.id}/adjustments`;
  const draftKey=`forge-adjustment:${work.id}:${work.revision}:${candidate}:${stage??'clip'}`;
  const pending=Boolean(task&&unresolved.has(task.state)),running=Boolean(task&&processing.has(task.state));
  const ready=task?.state==='ready';
  useEffect(()=>{onPendingChange?.(pending);},[pending,onPendingChange]);
  useEffect(()=>{onOpenChange?.(open);return()=>onOpenChange?.(false);},[open,onOpenChange]);
  useEffect(()=>{
    if(readOnly)return;
    const abort=new AbortController();
    void motionRequest<Context>(route,undefined,{revision:String(work.revision),candidate:String(candidate),...(stage===undefined?{}:{stage:String(stage)})},abort.signal).then(c=>{
      setContext(c);const current=c.tasks.find(t=>unresolved.has(t.state))||c.tasks.at(-1)||null;setTask(current);
      if(current&&(unresolved.has(current.state)||['failed','needs_input'].includes(current.state)))setOpen(true);
    }).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return()=>abort.abort();
  },[route,work.revision,work.job?.revision,candidate,stage,readOnly]);
  useEffect(()=>{
    let live=true;
    void Promise.resolve().then(()=>{try {const saved=JSON.parse(localStorage.getItem(draftKey)||'null');if(saved&&live){setStart(saved.start);setEnd(saved.end);setUser(saved.user||'');}}
      catch { /* A corrupt UI draft is never submitted. */ }});
    return()=>{live=false;};
  },[draftKey]);
  function editSelection(a:number,b:number){setStart(Math.min(a,b));setEnd(Math.max(a,b));request.current=null;}
  useEffect(()=>{if(start!==null||user) localStorage.setItem(draftKey,JSON.stringify({start,end,user}));},[draftKey,start,end,user]);
  useEffect(()=>{
    if(!task||!processing.has(task.state))return;
    const abort=new AbortController();
    const timer=setTimeout(()=>{void motionRequest<Response>(`${route}/${task.id}`,undefined,undefined,abort.signal).then(r=>{
      setTask(r.adjustment);setContext(c=>c?{...c,tasks:c.tasks.map(t=>t.id===r.adjustment.id?r.adjustment:t)}:c);
      if(!processing.has(r.adjustment.state))onSaved(r.work);
    }).catch(e=>{if(!abort.signal.aborted)setError(e.message);});},1500);
    return()=>{clearTimeout(timer);abort.abort();};
  },[task,route,onSaved]);
  useEffect(()=>{
    const stop=()=>{drag.current=null;};window.addEventListener('pointerup',stop);return()=>window.removeEventListener('pointerup',stop);
  },[]);
  const evidence=task?.preview_token;
  const previewCount=task?.proposed_frames?.length||0;
  useEffect(()=>{
    if(!evidence||!previewCount||!task?.id)return;
    let live=true;
    void Promise.all(Array.from({length:previewCount},(_,i)=>i).flatMap(i=>['source','proposed'].map(kind=>new Promise<void>((resolve,reject)=>{
      const img=new Image();img.onload=()=>resolve();img.onerror=()=>reject(new Error('对比图片未完整加载，请稍后重试'));
      img.src=motionUrl(`${route}/${task.id}/${kind}/${i}`,{v:evidence});
    })))).then(()=>{if(live){setLoaded(evidence);setPlaying(false);setPlayed(false);setFrame(0);setAck(false);setNote('');}}).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[evidence,task?.id,previewCount,route]);
  useEffect(()=>{
    if(!playing||!task?.proposed_frames)return;
    const timer=setTimeout(()=>{if(frame===task.proposed_frames!.length-1){setPlaying(false);setPlayed(true);}else setFrame(f=>f+1);},1000/task.fps);
    return()=>clearTimeout(timer);
  },[playing,frame,task]);
  if(readOnly)return null;
  const count=context?.frames.length||0,length=start!==null&&end!==null?end-start+1:0;
  const locked=context?.locked_frames.some(f=>start!==null&&end!==null&&f>=start&&f<=end);
  const valid=Boolean(context&&length>=2&&length%2===0&&start!==null&&start>=0&&end!==null&&end<count&&!locked&&
    (length<=context.appearance_max||(length>=4&&length<=16)));
  const suggestion=context?.suggestions.filter(s=>s.frames.some(f=>start!==null&&end!==null&&f-1>=start&&f-1<=end)).map(s=>s.text).join('；')||'';
  const warning=Boolean(task&&(task.review?.verdict!=='pass'||task.qa?.warnings?.length));
  const blocked=Boolean(task?.qa?.hard_failures?.length);
  async function submit(){
    if(!context||!valid)return;setBusy(true);setError('');
    const body={expected_revision:work.revision,candidate_index:candidate,stage_index:stage??null,token:context.token,start,end,user_request:user,
      authorized:true,max_planning_calls:1,max_generation_calls:1,max_review_calls:context.budget.review};
    const identity=JSON.stringify(body);if(request.current?.body!==identity)request.current={key:crypto.randomUUID(),body:identity};
    try {const r=await motionRequest<Response>(route,{...body,request_key:request.current.key});setTask(r.adjustment);
      setContext(c=>c?{...c,tasks:[...c.tasks.filter(t=>t.id!==r.adjustment.id),r.adjustment]}:c);onSaved(r.work);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function decide(decision:'accept'|'reject'){
    if(!task)return;setBusy(true);setError('');
    try{const r=await motionRequest<Response>(`${route}/${task.id}/decision`,{token:task.preview_token||task.source_token,decision,note,acknowledge_warnings:ack});
      setTask(r.adjustment);setContext(c=>c?{...c,tasks:c.tasks.map(t=>t.id===r.adjustment.id?r.adjustment:t)}:c);
      onSaved(r.work);localStorage.removeItem(draftKey);setOpen(false);setStart(null);setEnd(null);setUser('');}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const original=(i:number)=>motionUrl(stage===undefined?`jobs/${work.job?.job_id}/candidates/${candidate}/frames/${i}/image`:
    `open-motion/${work.id}/candidates/${candidate}/stages/${stage}/frames/${i}`,{revision:String(work.revision),v:context?.token||''});
  return <details className="motion-adjustment" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>调整部分帧{pending?' · 有备选待处理':''}</summary>
    {open&&<div className="motion-adjustment-body">
      <p className="motion-muted">选择允许替换的连续帧，其余帧保持原样。个人偏好也可以作为修改目标。</p>
      {error&&<p role="alert" className="motion-danger">{error}</p>}
      {task&&pending?<>
        <output>{task.message}</output>
        <p>本次替换第 {task.start+1}–{task.end+1} 帧 · {task.user_request||task.intent?.goal||'按所选范围的专家建议'}</p>
        {ready&&task.proposed_frames&&<>
          <div className="motion-adjustment-compare">{(['source','proposed'] as const).map(kind=><figure key={kind}>
            <figcaption>{kind==='source'?'原版':'备选'}</figcaption><div className="motion-canvas"><img alt={`${kind==='source'?'原版':'备选'}第 ${frame+1} 帧`} src={motionUrl(`${route}/${task.id}/${kind}/${frame}`,{v:task.preview_token||''})} /></div>
          </figure>)}</div>
          <div className="motion-card-title"><button disabled={loaded!==task.preview_token} onClick={()=>{setFrame(0);setPlayed(false);setPlaying(true);}}>同步播放完整对比</button><span>{frame+1} / {task.proposed_frames.length} · {task.fps} FPS</span></div>
          <input aria-label="备选对比逐帧" type="range" min={0} max={task.proposed_frames.length-1} value={frame} onChange={e=>{setPlaying(false);setFrame(Number(e.target.value));}} />
          {task.review&&<details><summary>备选检查：{task.review.state==='failed'?'检查未完成，请结合画面判断':task.review.verdict==='pass'?'建议通过':task.review.verdict==='fail'?'发现问题，展开查看':'需要实际画面确认'}</summary><MotionVisualReview report={task.review}/></details>}
          {blocked&&<p className="motion-danger">备选存在技术阻断，请保留原版。</p>}
          <label>对比结论<textarea aria-label="备选对比结论" value={note} onChange={e=>setNote(e.target.value)} maxLength={2000} placeholder="实际播放后，简要说明为什么选择这个版本" /></label>
          {warning&&<label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>已看过实际画面，接受本次视觉与技术提醒</label>}
          <div className="motion-card-title"><button className="motion-primary" disabled={busy||!played||note.trim().length<4||blocked||(warning&&!ack)} onClick={()=>void decide('accept')}>采用新版</button><button disabled={busy} onClick={()=>void decide('reject')}>保留原版</button></div>
          {!played&&<p className="motion-muted">先播放完整对比，再决定是否采用。</p>}
        </>}
        {task.state==='unknown'&&<><p>结果未知不会自动重新生成，已发生的请求仍保留。</p><button disabled={busy} onClick={()=>void decide('reject')}>保留原版</button></>}
        <details><summary>本次调用与处理详情</summary><p>需求理解 {task.planning_calls.length} 次 · 绘图 {task.generation_calls.length} 次 · 复核 {task.review_calls.length} 次</p><p>{task.intent?.preserve}</p></details>
      </>:<>
        {task&&['failed','needs_input','rejected'].includes(task.state)&&<p className="motion-notice">{task.message}</p>}
        {task&&['failed','needs_input'].includes(task.state)&&<button disabled={busy} onClick={()=>void decide('reject')}>保留原版</button>}
        {context?<>
          <div className="motion-frame-selection" aria-label="选择允许修改的帧">{context.frames.map((_,i)=><button type="button" key={i}
            aria-label={`选择第 ${i+1} 帧`} aria-pressed={start!==null&&end!==null&&i>=start&&i<=end} disabled={busy||context.locked_frames.includes(i)}
            onPointerDown={e=>{if(e.button!==0)return;drag.current=i;editSelection(i,i);}}
            onPointerEnter={()=>{if(drag.current!==null)editSelection(drag.current,i);}}
            onClick={e=>{if(e.detail===0)editSelection(start===null?i:start,i);}}>
            <img src={original(i)} alt="" draggable={false}/><span>{i+1}{context.locked_frames.includes(i)?' · 保留':''}</span>
          </button>)}</div>
          <div className="motion-adjustment-range"><label>开始帧<input aria-label="修改开始帧" type="number" min={1} max={count} value={start===null?'':start+1} onChange={e=>{setStart(e.target.value?Number(e.target.value)-1:null);request.current=null;}}/></label>
          <label>结束帧<input aria-label="修改结束帧" type="number" min={1} max={count} value={end===null?'':end+1} onChange={e=>{setEnd(e.target.value?Number(e.target.value)-1:null);request.current=null;}}/></label>
          <span>{valid?`仅替换第 ${start!+1}–${end!+1} 帧`:'拖动选择一段连续帧，或输入起止帧'}</span></div>
          {length>0&&!valid&&<p className="motion-danger">{locked?'范围包含首末帧或分段锚点，请缩小选择；不会自动改动后段。':`当前支持 2–${context.appearance_max} 个偶数帧的编辑，或 4–16 个偶数帧的过渡生成。请调整范围。`}</p>}
          <p><b>专家建议：</b>{suggestion?`${suggestion.slice(0,110)}${suggestion.length>110?'…':''}`:'所选范围暂无明确建议，可以填写想尝试的变化。'}</p>
          {suggestion.length>110&&<details><summary>查看完整建议</summary><p>{suggestion}</p></details>}
          <label>修改要求（选填）<textarea aria-label="修改要求（选填）" value={user} maxLength={1800} onChange={e=>{setUser(e.target.value);request.current=null;}} placeholder="例如：我希望这里抬手幅度小一点。留空时按上述建议；填写后以你的要求为准。"/></label>
          <p className="motion-muted">本次最多 1 次需求理解、1 次绘图、{context.budget.review} 次复核，按实际调用计费。生成备选后再决定是否采用；不会自动再次尝试。</p>
          <button className="motion-primary" disabled={busy||running||!valid||(!user.trim()&&!suggestion)||context.tasks.length>=context.attempt_limit} onClick={()=>void submit()}>生成一个备选</button>
          {context.tasks.length>=context.attempt_limit&&<p>此范围的试做上限已用完，原版与记录保留。</p>}
          {!!context.tasks.length&&<details><summary>已保存的修改记录 · {context.tasks.length}</summary>{context.tasks.map(t=><p key={t.id}>第 {t.start+1}–{t.end+1} 帧 · {t.message} · 绘图 {t.generation_calls.length} 次，复核 {t.review_calls.length} 次</p>)}</details>}
        </>:<p>正在读取可调整范围…</p>}
      </>}
    </div>}
  </details>;
}
