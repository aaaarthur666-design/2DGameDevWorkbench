import '../helpers/runtime-workspace.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { motionTitle } from '../../lib/workbench/motion-title.mjs';
import { taskPresentation } from '../../lib/workbench/presentation.mjs';
import { loadManifest } from '../../lib/workbench/runtime.mjs';
import { compactMotionResponse } from '../../lib/workbench/result-summary.mjs';

const token = 'c'.repeat(64);
const actionable = compactMotionResponse({ result: {
  repairPreviews:[{attempt:0,token,frames:['repair/frame0.png','repair/frame1.png','repair/frame2.png']}],
  adjustmentContext:{token,locked_frames:[0,3],frame_attempts:[0,0,1,0],frames:[1,2,3,4]},
  adjustment:{id:'e'.repeat(32),revision:3,candidate:2,stage:0,state:'ready',source_token:token,preview_token:'f'.repeat(64)},
  originalFrames:['original/frame0.png'],alternativeFrames:['alternative/frame0.png'],
  work:{plan:{stages:[{name:'抬手',frame_count:4}]},revision:3},
  safety:{stage:'submission_unknown',automatic_resubmission_allowed:false,result_integrity:false,provider_job_id:'original-upstream',error:{code:'integrity_failed',message:'实际帧哈希不符'}},
}, artifacts:[], presentation:{} }, {});
assert.equal(actionable.result.repairPreviews[0].token,token);
assert.equal(actionable.result.repairPreviews[0].frameCount,3);
assert.equal(actionable.result.adjustmentContext.token,token);
assert.deepEqual(actionable.result.adjustmentContext.locked_frames,[0,3]);
assert.equal(actionable.result.adjustment.preview_token,'f'.repeat(64));
assert.equal(actionable.result.framePreviews.original.paths[0],'original/frame0.png');
assert.equal(actionable.result.plan.stages[0].name,'抬手');
assert.equal(actionable.result.safety.automatic_resubmission_allowed,false);
assert.equal(actionable.result.safety.result_integrity,false);
assert.equal(actionable.result.safety.provider_job_id,'original-upstream');
assert.equal(actionable.result.safety.error.code,'integrity_failed');
const job = { job_id:'summary-fixture', status:'review_required', character:{display_name:'红袍法师'},
  action:{display_name:'红袍法师原地举杖施法循环'},
  request:{open_plan:{work_id:'d'.repeat(32),revision:2}},
  candidates:[{candidate_index:1,status:'review_ready',hard_failures:['actual hard failure'],warnings:['actual warning'],
    frames:Array.from({length:64},(_,index)=>({index, evidence:'large diagnostic data '.repeat(150)})),
    plan_execution:{stages:[{state:'awaiting_review',review:{state:'complete',token,verdict:'uncertain'}}]},
  }],
};
let config = { configuration_sha256:'a'.repeat(64), configuration:{roles:{motion:{provider:'tokenhub',model:'existing'}}} };
let patchBody;
const server = createServer(async (req,res) => {
  res.setHeader('content-type','application/json');
  if(req.url==='/v1/jobs/summary-fixture') return res.end(JSON.stringify({data:{job}}));
  if(req.url==='/v1/open-motion/settings') return res.end(JSON.stringify(config));
  if(req.url==='/v1/open-motion/settings/roles/coordinator'&&req.method==='PATCH') {
    let body='';for await(const chunk of req)body+=chunk;
    patchBody=JSON.parse(body);
    config={configuration_sha256:'b'.repeat(64),configuration:{roles:{...config.configuration.roles,coordinator:patchBody.profile}}};
    return res.end(JSON.stringify(config));
  }
  res.statusCode=404;res.end('{}');
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const client = new Client({name:'result-summary-regression',version:'1.0.0'});
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:['scripts/workbench-mcp.mjs'],stderr:'pipe',
    env:{...process.env,SPRITE_PIPELINE_API_URL:`http://127.0.0.1:${server.address().port}`}}));
  const call=async(name,args={})=>{const reply=await client.callTool({name,arguments:args});assert(!reply.isError,JSON.stringify(reply));return reply;};
  const result=await call('workbench_get_result',{jobId:job.job_id});
  assert(JSON.stringify(job).length>170000);
  assert(JSON.stringify(result.structuredContent).length<6000);
  assert(result.content[0].text.length<6000);
  assert.equal(result.structuredContent.result.candidates[0].stages[0].token,token);
  assert.equal(result.structuredContent.result.openWorkId,'d'.repeat(32));
  assert.equal(result.structuredContent.result.work.revision,2);
  assert.equal(JSON.parse(result.content[0].text).result.candidates[0].stages[0].token,token);
  assert.deepEqual(result.structuredContent.result.candidates[0].hardFailures,['actual hard failure']);
  assert.deepEqual(result.structuredContent.result.candidates[0].warnings,['actual warning']);
  assert.equal(result.structuredContent.result.candidates[0].frames,undefined);
  let offset=0,snapshot,serialized='';
  do {
    const reply=await call('workbench_get_result',{jobId:job.job_id,detail:true,offset,limit:8000,...(snapshot?{snapshot}:{})});
    const page=reply.structuredContent.detailPage;
    assert(page.text.length<=8000);
    assert.equal(JSON.parse(reply.content[0].text).detailPage.text,page.text);
    serialized+=page.text;snapshot=page.snapshot;offset=page.nextOffset;
  } while(offset!==null);
  assert.deepEqual(JSON.parse(serialized).result,job);
  job.candidates[0].warnings.push('changed snapshot');
  assert((await client.callTool({name:'workbench_get_result',arguments:{jobId:job.job_id,detail:true,offset:8000,snapshot}})).isError);
  assert((await client.callTool({name:'workbench_get_result',arguments:{jobId:job.job_id,detail:true,offset:1}})).isError);
  const settings=(await call('workbench_get_motion_models')).structuredContent;
  const updated=(await call('workbench_set_motion_model',{role:'coordinator',profile:{provider:'tokenhub',model:'kimi-k3.1-pro'},expectedConfigurationSha256:settings.configuration_sha256})).structuredContent;
  assert.deepEqual(updated.configuration.roles.motion,{provider:'tokenhub',model:'existing'});
  assert.equal(updated.createsTask,false);assert.equal(updated.providerCalled,false);
  assert.equal(patchBody.expected_configuration_sha256,settings.configuration_sha256);
  assert.deepEqual(Object.keys(patchBody).sort(),['expected_configuration_sha256','profile']);
  const invalid=await client.callTool({name:'workbench_run_task',arguments:{capabilityId:'sprite-generator',input:{operation:'revise-motion',openWorkId:'d'.repeat(32),expectedRevision:2,planningAuthorized:true,autoExecute:true,motionSpec:{object_id:'test_hero',description:'抬手后保持姿势'}}}});
  assert(invalid.isError);assert.match(invalid.content[0].text,/revise-motion/);
  assert.equal(motionTitle('红袍法师','红袍法师原地举杖施法循环'),'红袍法师原地举杖施法循环');
  assert.equal(motionTitle('红袍法师','施法循环'),'红袍法师 · 施法循环');
  const presentation=taskPresentation(await loadManifest(),{capabilityId:'sprite-generator',status:'completed',input:{operation:'get'},adapter:{remoteStatus:'review_required'}},{result:job});
  assert.equal(presentation.title,'红袍法师原地举杖施法循环');
  console.log('MCP result summary: bounded text and structured output, actionable stage tokens, lossless snapshot pagination, model-role routing and revision preflight passed.');
} finally {
  await client.close();await new Promise(resolve=>server.close(resolve));
}
