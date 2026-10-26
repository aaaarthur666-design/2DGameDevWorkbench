'use client';
import type { MotionReview, MotionReviewOpinion } from './open-motion-model';

const dimensions: Record<string,string> = {completeness:'动作完整性', equipment:'外观与装备', rhythm:'节奏'};
const phases: Record<string,string> = {appearance:'外观专家独立检查',motion:'运动专家独立检查',dispute:'针对争议复核证据',done:'复核完成'};

function Evidence({opinion}: {opinion?: MotionReviewOpinion}) {
  return <>{opinion?.summary && <p>{opinion.summary}</p>}{opinion?.checks?.map(c=><p key={c.dimension}>
    <b>{dimensions[c.dimension]}</b> · 第 {c.frames.join('、')} 帧：{c.evidence}
  </p>)}</>;
}

export function MotionVisualReview({report}: {report: MotionReview}) {
  const extra=report.expert_review;
  const busy=['pending','running'].includes(report.state);
  const failed=['failed','unknown','stale'].includes(report.state);
  const title=busy?'正在检查实际帧':failed?'检查未完成或证据已过期':
    ({pass:'模型建议通过',fail:'模型报告问题',uncertain:'待实际画面确认'}[report.verdict]||'待实际画面确认');
  const classifications=extra?.resolution?.checks;
  return <div className={`motion-visual-review ${report.verdict==='fail'&&!busy?'motion-error':'motion-notice'}`}>
    <b>视觉验收：{title}</b>
    {extra?.simulated&&<p>模拟专家报告，仅用于隔离流程验收，没有调用真实模型。</p>}
    {report.protocol==='experts_v1'&&<p className="motion-review-progress">
      独立专家与争议复核 · {phases[extra?.phase||''] || (report.state==='diagnostic'?'诊断流程，未调用视觉模型':'基础观察与审核')}
      {' · '}{report.requests?.length ?? extra?.calls_used ?? 0} / {extra?.max_calls ?? 5} 次
    </p>}
    <p>{report.summary || '正在核对实际帧…'}</p>
    {report.protocol==='experts_v1'&&<p>检查的是当前这组图片，不生成或替换帧；是否采用仍由实际播放确认。</p>}
    <details><summary>查看判断依据与具体帧</summary><Evidence opinion={{checks:report.checks}} />
      {classifications?.filter(c=>c.classification==='preference').map(c=><p key={c.dimension}><b>{dimensions[c.dimension]} · 可选优化</b>：属于表现偏好，结合整体播放决定是否调整。</p>)}
    </details>
    {extra&&extra.state!=='diagnostic'&&<details><summary>查看独立专家与争议复核过程</summary>
      <h3>基础检查</h3><Evidence opinion={extra.baseline} />
      {(['appearance','motion'] as const).map(role=><div key={role}><h3>{role==='appearance'?'外观专家':'运动专家'} · 独立意见</h3>
        {extra.experts?.[role]?<Evidence opinion={extra.experts[role]} />:<p>尚无完成的意见。</p>}</div>)}
      {extra.resolution?<><h3>争议复核</h3><p>{extra.resolution.summary}</p>{classifications?.map(c=><p key={c.dimension}>
        <b>{dimensions[c.dimension]}</b>：{c.observation} {c.prior_claim_correction}
      </p>)}</>:<p>{extra.state==='complete'?'意见一致，无需追加争议复核。':'有争议时最多追加一次复核；失败或未知请求不会自动重试。'}</p>}
      {!!extra.requires_human_adjudication?.length&&<p><b>需要实际画面裁决</b>：{extra.requires_human_adjudication.map(c=>dimensions[c.dimension]||c.dimension).join('、')}。复核建议取消原有问题，尚未自动变为通过。</p>}
      {failed&&<p>{extra.summary || '已保存已有意见和请求，未自动重发。'}</p>}
    </details>}
  </div>;
}
