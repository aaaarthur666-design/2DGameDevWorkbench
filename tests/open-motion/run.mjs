import '../helpers/runtime-workspace.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { loadManifest, findCapability, validateInput, runConnector, refreshTask } from '../../lib/workbench/runtime.mjs';
import { taskViewPath, taskPresentation } from '../../lib/workbench/presentation.mjs';
import { createTestViteServer } from '../helpers/vite-server.mjs';

const root = path.resolve('work/test-runs', process.env.WORKBENCH_TEST_RUN, 'open-motion');
await mkdir(root, { recursive: true });
const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(r => reservation.close(r));
const python = process.env.SPRITE_TEST_PYTHON || path.resolve('Tools/SpritePipeline/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const child = spawn(python, ['Tools/SpritePipeline/tests/open_motion_server.py', root, String(port), '--checkpoints'], { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
const base = `http://127.0.0.1:${port}`;
const request = async (route, body) => {
  const response = await fetch(base + route, body ? { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) } : {});
  const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
};
const delay = ms => new Promise(r => setTimeout(r, ms));
const previous = process.env.SPRITE_PIPELINE_API_URL;
let vite;
try {
  for (let n=0; n<100; n++) { try { await request('/health'); break; } catch { if (child.exitCode !== null || n===99) throw new Error(log || 'Test API startup failed'); await delay(100); } }
  process.env.SPRITE_PIPELINE_API_URL = base;
  const manifest = await loadManifest(), capability = findCapability(manifest, 'sprite-generator');
  const motionSpec = { character_id:'test_hero', description:'角色低头检查手套，最后保持低头', provider:'fixture', candidate_count:2, budget:{max_planning_calls:8,max_generation_calls:5,max_review_calls:14} };
  const input = { operation:'plan-motion', motionSpec, planningAuthorized:true };
  assert.deepEqual(validateInput(capability,input),[]);
  assert.ok(validateInput(capability,{...input,planningAuthorized:false}).length);
  assert.ok(validateInput(capability,{...input,motionSpec:{...motionSpec,apiKey:'must-not-be-stored'}}).length);
  assert.ok(validateInput(capability,{...input,motionSpec:{...motionSpec,budget:{max_generation_calls:99}}}).length);
  let outcome = await runConnector(manifest,capability,input);
  const taskId = outcome.task.id;
  for (let n=0;n<100 && outcome.task.status==='running';n++) { await delay(100); outcome=await refreshTask(manifest,taskId); }
  assert.equal(outcome.task.status,'attention_required');
  const workId=outcome.task.adapter.openWorkId;
  assert.equal(taskViewPath(manifest,outcome.task),`/tools/sprite-generator?work=${workId}&version=1`);
  const work=await request(`/v1/open-motion/${workId}`);
  assert.equal(work.status,'ready'); assert.equal(work.planning_calls.length,4);
  const presentation = taskPresentation(manifest,outcome.task,{result:{work}});
  assert.equal(presentation.state,'saved'); assert.match(presentation.summary,/方案已保存/);
  assert.ok(validateInput(capability,{operation:'generate-motion',openWorkId:workId}).length);
  assert.ok(validateInput(capability,{operation:'target-motion-stage',openWorkId:workId,expectedRevision:1,stageIndex:0,reviewNote:'已检查目标'}).length);
  const targetPng=await readFile(path.join(root,'target-fixture','frame_002.png'));
  await runConnector(manifest,capability,{operation:'target-motion-stage',openWorkId:workId,expectedRevision:1,stageIndex:0,targetImageBase64:targetPng.toString('base64'),reviewNote:'真实诊断 PNG 用于末图传输检查，不代表美术效果'});
  const withTarget=await request(`/v1/open-motion/${workId}`);assert.equal(withTarget.end_targets.length,1);
  const generated=await runConnector(manifest,capability,{operation:'generate-motion',openWorkId:workId,expectedRevision:1,planSha256:work.plan_sha256});
  assert.ok(generated.task.id);
  for (let candidateIndex=1;candidateIndex<=2;candidateIndex++) for(let stageIndex=0;stageIndex<2;stageIndex++) {
    for(let n=0;n<150;n++) {
      const current=await request(`/v1/open-motion/${workId}`);
      if(current.job.candidates[candidateIndex-1].plan_execution.stages[stageIndex].state==='awaiting_review')break;
      assert.ok(n<149,'checkpoint did not become ready');await delay(100);
    }
    const inspected=await runConnector(manifest,capability,{operation:'get-motion-stage',openWorkId:workId,candidateIndex,stageIndex});
    const evidence=JSON.parse(await readFile(inspected.task.outputs.find(p=>p.endsWith('/result.json')),'utf8'));
    assert.equal(evidence.orderedFrames.length,4);assert.equal(evidence.stage.state,'awaiting_review');
    assert.equal((await readFile(evidence.orderedFrames[0])).subarray(1,4).toString(),'PNG');
    await assert.rejects(()=>request(`/v1/open-motion/${workId}/resume`,{expected_revision:1}));
    if(candidateIndex===1&&stageIndex===0){
      const repairInput={operation:'repair-motion-stage',openWorkId:workId,expectedRevision:1,candidateIndex,stageIndex,stageToken:evidence.stage.token,repairStart:1,repairEnd:2,repairMode:'appearance',reviewNote:'只修中间两帧物品轮廓；其余真实诊断帧保持原样。',generationAuthorized:true};
      assert.deepEqual(validateInput(capability,repairInput),[]);
      assert.ok(validateInput(capability,{...repairInput,generationAuthorized:false}).length);
      await runConnector(manifest,capability,repairInput);
      for(let n=0;n<100;n++){const v=await request(`/v1/open-motion/${workId}`);if(v.job.candidates[0].plan_execution.stages[0].repairs[0]?.state==='awaiting_review')break;assert.ok(n<99);await delay(100);}
      const preview=await runConnector(manifest,capability,{operation:'get-motion-stage',openWorkId:workId,candidateIndex,stageIndex});
      const before=JSON.parse(await readFile(preview.task.outputs.find(p=>p.endsWith('/result.json')),'utf8'));
      assert.equal(before.repairPreviews[0].frames.length,4);
      assert.equal((await readFile(before.repairPreviews[0].frames[1])).subarray(1,4).toString(),'PNG');
      await runConnector(manifest,capability,{operation:'review-motion-repair',openWorkId:workId,expectedRevision:1,candidateIndex,stageIndex,repairAttempt:0,stageToken:before.repairPreviews[0].token,stageDecision:'accept',reviewNote:'已核对全部诊断预览与两侧接缝，仅验证修复链路。'});
      for(let n=0;n<100;n++){const v=await request(`/v1/open-motion/${workId}`);if(v.job.candidates[0].plan_execution.stages[0].state==='awaiting_review')break;assert.ok(n<99);await delay(100);}
      evidence.stage=await request(`/v1/open-motion/${workId}/candidates/1/stages/0`);
    }
    await runConnector(manifest,capability,{operation:'review-motion-stage',openWorkId:workId,expectedRevision:1,candidateIndex,stageIndex,
      stageToken:evidence.stage.token,stageDecision:'accept',reviewNote:'已查看诊断片段与末姿势，仅验收工具流程',acknowledgeWarnings:true,
      ...(candidateIndex===1&&stageIndex===0?{anchorFrame:2,acknowledgeTrim:true}:{})});
  }
  for (let n=0;n<150;n++) { const c=await request(`/v1/open-motion/${workId}`);if(c.job.candidates.every((c,i)=>c.frames.length===(i===0?7:8)))break;await delay(100); }
  const complete=await request(`/v1/open-motion/${workId}`);
  assert.deepEqual(complete.job.candidates.map(c=>c.frames.length),[7,8]);
  assert.ok(complete.job.candidates.every(c=>c.diagnostic_only));
  const attempts=complete.job.candidates.map(c=>c.submission_attempts);
  await request(`/v1/open-motion/${workId}/generate`,{expected_revision:1,plan_sha256:work.plan_sha256});
  assert.deepEqual((await request(`/v1/open-motion/${workId}`)).job.candidates.map(c=>c.submission_attempts),attempts);
  // Real frontend proxy implementation, including refusal of arbitrary paths/origins.
  vite=await createTestViteServer({configFile:false,appType:'custom',logLevel:'error',resolve:{alias:{'@':process.cwd()}},server:{middlewareMode:true}});
  const proxy=await vite.ssrLoadModule('/app/api/workbench/open-motion/route.ts');
  assert.equal((await proxy.GET(new Request('http://localhost/api/workbench/open-motion?path=../secrets'))).status,400);
  assert.equal((await proxy.POST(new Request('http://localhost/api/workbench/open-motion',{method:'POST',headers:{origin:'https://foreign.example'},body:'{}'}))).status,403);
  const proxied=await proxy.GET(new Request(`http://localhost/api/workbench/open-motion?path=open-motion/${workId}`));
  assert.equal(proxied.status,200); assert.equal((await proxied.json()).id,workId);
  const checkpointImage=await proxy.GET(new Request(`http://localhost/api/workbench/open-motion?path=open-motion/${workId}/candidates/1/stages/0/frames/3`));
  assert.equal(checkpointImage.status,200);assert.match(checkpointImage.headers.get('content-type'),/image\/png/);
  console.log('Open motion: nested input rejection, real Python API + shared adapter planning/generation, exact preview, candidate completion, idempotency and bounded frontend proxy passed; paid calls=0.');
} finally {
  if (vite) await vite.close();
  child.kill();
  if (previous === undefined) delete process.env.SPRITE_PIPELINE_API_URL; else process.env.SPRITE_PIPELINE_API_URL=previous;
}
