import '../helpers/runtime-workspace.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadManifest, repositoryRoot } from '../../lib/workbench/runtime.mjs';
import { WorkBuddyPreview } from '../../lib/workbench/workbuddy-preview.mjs';
import { frontendHeartbeat, queuePresentation } from '../../lib/workbench/preview-follow.mjs';
const manifest = await loadManifest();
const ready = async () => ({ ready:true, state:'ready', url:'http://localhost:3000', runtime:{state:'ready'}, hostAction:{host:'WorkBuddy',tool:'present_files',arguments:{files:['http://localhost:3000'],cwd:repositoryRoot}} });
const session = new WorkBuddyPreview(repositoryRoot, () => 'WorkBuddy', ready);
const first = await session.beforeRun(manifest,'/tools/sprite-generator');
assert.equal(first.status,'preview_required');
assert.equal(first.createsTask,false);assert.equal(first.providerCalled,false);
assert.equal(first.preview.hostAction.tool,'present_files');
assert.equal(new URL(first.preview.hostAction.arguments.files[0]).searchParams.get('previewSession'),session.sessionId);
assert.equal(first.preview.browserOpened,false);
const page = {pageId:randomUUID(),viewPath:'/tools/sprite-generator',visible:true,focused:true,following:true,items:[],dirty:false,busy:false};
const beat = p => frontendHeartbeat(repositoryRoot,manifest,p);
await beat(page);
assert.ok(await session.beforeRun(manifest),'a visible unrelated old page must not satisfy the session');
const own = {...page,pageId:randomUUID(),sessionId:session.sessionId};
await beat(own);assert.equal(await session.beforeRun(manifest),null);
const second = new WorkBuddyPreview(repositoryRoot, () => 'WorkBuddy', ready);
assert.ok(await second.beforeRun(manifest),'another MCP conversation needs its own page');
const request = await queuePresentation(repositoryRoot,manifest,{viewPath:'/tools/sprite-generator?job=fixture',title:'Session 1',summary:'Fixture'},{sessionId:session.sessionId});
assert.equal((await beat(page)).request,null,'unbound page cannot claim a WorkBuddy request');
await assert.rejects(beat({...page,ack:{requestId:request.requestId,state:'navigating'}}));
assert.equal((await beat(own)).request.id,request.requestId);
const another = await queuePresentation(repositoryRoot,manifest,{viewPath:'/tools/reference-art',title:'Session 2',summary:'Fixture'},{sessionId:second.sessionId});
assert.equal((await beat(own)).request.id,request.requestId,'other sessions cannot supersede this page');
assert.notEqual(another.requestId,request.requestId);
await beat({...own,following:false});
assert.equal((await session.inspect(manifest)).state,'paused');
assert.equal(await session.beforeRun(manifest),null,'user pause must not force host navigation');
await beat({...own,visible:false,focused:false});
assert.equal((await session.inspect(manifest)).state,'hidden_or_closed');
assert.equal((await session.inspect(manifest)).hostAction,undefined,'no reopening after a seen page is hidden/closed');
// Exercise concurrent polling and atomic step replacement, including Windows file locks.
for (let i = 0; i < 30; i++) {
 await Promise.all([
  queuePresentation(repositoryRoot, manifest, {viewPath:'/tools/sprite-generator?job=stress-'+i,title:'Stress',summary:'Local fixture'}, {sessionId:session.sessionId}),
  beat(own), beat({...own,pageId:randomUUID()}), session.context(manifest),
 ]);
}
const unavailable = new WorkBuddyPreview(repositoryRoot,()=> 'WorkBuddy',async()=>({ready:false,state:'offline',runtime:{state:'offline'}}));
assert.equal((await unavailable.beforeRun(manifest)).preview.nextTool,'workbench_start_frontend');
unavailable.configure('user-dismissed');assert.equal(await unavailable.beforeRun(manifest),null);
assert.equal((await unavailable.inspect(manifest)).state,'disabled');
unavailable.configure('auto');assert.ok(await unavailable.beforeRun(manifest));
const headless = new WorkBuddyPreview(repositoryRoot,()=> 'diagnostic-client',ready);
assert.equal(await headless.beforeRun(manifest),null);

const client = new Client({name:'WorkBuddy',version:'test'});
const transport = new StdioClientTransport({command:process.execPath,args:['scripts/workbench-mcp.mjs'],cwd:repositoryRoot,env:{...process.env,FORGE_MCP_HOST:'workbuddy'},stderr:'pipe'});
try {
 await client.connect(transport);
 const call = async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r;};
 const discovery=(await call('workbench_list_capabilities')).structuredContent;
 assert.ok(discovery.preview.sessionId);assert.ok(discovery.preview.requiresHostAction);
 const template=(await call('workbench_interactable_template',{name:'会话跟随测试'})).structuredContent;
 const input={capabilityId:'interactable-editor',input:{operation:'save-project',project:template.project}};
 const before=await readdir(path.join(repositoryRoot,manifest.workspace.taskDirectory)).catch(()=>[]);
 const blocked=(await call('workbench_run_task',input)).structuredContent;
 assert.equal(blocked.status,'preview_required');assert.equal(blocked.providerCalled,false);assert.equal(blocked.taskId,undefined);
 assert.deepEqual(await readdir(path.join(repositoryRoot,manifest.workspace.taskDirectory)).catch(()=>[]),before);
 const bound={...page,pageId:randomUUID(),sessionId:blocked.preview.sessionId};
 await beat(bound);
 const saved=await call('workbench_run_task',input);
 assert.ok(saved.structuredContent.taskId);
 assert.equal(saved.structuredContent.frontendPresentation.sessionId,bound.sessionId);
 assert.equal(JSON.parse(saved.content[0].text).preview.sessionId,bound.sessionId,'host guidance must survive text-only tool rendering');
 const taskId=saved.structuredContent.taskId;
 const polled=(await call('workbench_get_task',{taskId})).structuredContent;
 assert.equal(polled.frontendPresentation.requestId,saved.structuredContent.frontendPresentation.requestId);
 const result=(await call('workbench_get_result',{taskId})).structuredContent;
 assert.equal(result.frontendPresentation,undefined,'reading results does not navigate');
 const ctx=(await call('workbench_get_frontend_context')).structuredContent;
 assert.ok(ctx.pages.every(p=>p.sessionId===bound.sessionId));
 assert.equal(ctx.presentation.requestId,polled.frontendPresentation.requestId);
 const skipped=(await call('workbench_run_task',{...input,previewPolicy:'user-dismissed'})).structuredContent;
 assert.ok(skipped.taskId);assert.equal(skipped.frontendPresentation,undefined);assert.equal(skipped.preview.state,'disabled');
 console.log('WorkBuddy preview passed: no-submission preflight, host action, session binding, cross-session isolation, auto-follow, text projection, pause/dismissal and headless compatibility. Paid calls=0.');
} finally {await client.close();}
