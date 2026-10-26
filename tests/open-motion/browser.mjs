// Optional browser acceptance against a running Forge frontend. API/model data
// are isolated in a diagnostic Python service; no paid endpoint is called.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';

const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('work/test-runs', `motion-browser-${randomUUID()}`);
await mkdir(root,{recursive:true});
const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
const python=process.env.SPRITE_TEST_PYTHON || path.resolve('Tools/SpritePipeline/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const server=spawn(python,['Tools/SpritePipeline/tests/open_motion_server.py',root,String(port),'--checkpoints','--expert-reviews'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='';server.stderr.on('data',d=>{log+=d;});
const base=`http://127.0.0.1:${port}`,delay=ms=>new Promise(r=>setTimeout(r,ms));
let browser, page;
try {
  for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break;}catch{} if(server.exitCode!==null||i===99)throw new Error(log);await delay(100);}
  browser=await playwright.chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Do not send follow-context, library or task requests to a user's live bridge.
  await page.route('**/api/workbench/**',route=>route.fulfill({status:503,json:{error:'本隔离验收仅启用角色动作接口'}}));
  await page.route('**/api/workbench/open-motion?**',async route=>{
    const request=route.request(),url=new URL(request.url());
    const target=new URL('/v1/'+(url.searchParams.get('path')||'open-motion'),base);
    for(const key of ['revision','candidate','stage'])if(url.searchParams.has(key))target.searchParams.set(key,url.searchParams.get(key));
    let body=request.postData();
    if(body){const value=JSON.parse(body);if(value.spec)value.spec.provider='fixture';body=JSON.stringify(value);}
    const response=await fetch(target,{method:request.method(),headers:{'content-type':'application/json'},...(body?{body}:{})});
    await route.fulfill({status:response.status,contentType:response.headers.get('content-type'),body:Buffer.from(await response.arrayBuffer())});
  });
  // Settings are readiness-only UI fixture data, never usable credentials.
  await page.route('**/api/workbench/open-motion?path=open-motion%2Fsettings',async route=>{
    const req=route.request();const response=await fetch(base+'/v1/open-motion/settings',{method:req.method(),headers:{'content-type':'application/json'},...(req.postData()?{body:req.postData()}:{})});
    const data=await response.json();await route.fulfill({status:response.status,json:{...data,planning_configured:true,pixellab_configured:true}});
  });
  // Exercise legacy navigation without loading production Gradio with a fixture job.
  await page.route('**/api/workbench/sprite-pipeline/health',route=>route.fulfill({status:503,json:{error:'Isolated navigation fixture'}}));
  await page.route('**/api/workbench/game-export/package',async route=>{
    const {jobId}=route.request().postDataJSON();
    const response=await fetch(`${base}/v1/jobs/${jobId}/exports/godot`);
    await route.fulfill({status:response.status,contentType:'application/zip',body:Buffer.from(await response.arrayBuffer())});
  });
  await page.goto((process.env.FORGE_TEST_WEB_URL||'http://localhost:3000')+'/tools/sprite-generator?character=test_hero');
  await page.getByLabel('已有角色').waitFor();
  await page.getByText('模型设置',{exact:true}).click();
  await page.getByLabel('TokenHub API Key',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('TokenHub API Key',{exact:true}).isVisible(),true);
  assert.equal(await page.getByLabel('TokenHub API Key',{exact:true}).inputValue(),'');
  await page.getByText('新增或编辑可选模型',{exact:true}).click();
  await page.getByLabel('新增模型 ID',{exact:true}).fill('acceptance-custom-vlm');
  await page.getByRole('button',{name:'加入可选模型',exact:true}).click();
  await page.getByLabel('默认规划模型',{exact:true}).selectOption('tokenhub|acceptance-custom-vlm');
  await page.getByLabel('默认规划模型',{exact:true}).selectOption('tokenhub|kimi-k3.1-pro');
  await page.getByLabel('视觉复核模型',{exact:true}).selectOption('tokenhub|glm-5.3-flash');
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await page.getByText('已保存。已有任务继续使用它创建时的模型配置。',{exact:true}).waitFor();
  const savedConfig=await (await fetch(base+'/v1/open-motion/settings')).json();
  assert.equal(savedConfig.configuration.default.model,'kimi-k3.1-pro');
  assert.equal(savedConfig.configuration.roles.reviewer.model,'glm-5.3-flash');
  assert.equal(savedConfig.configuration.roles.reviewer.reasoning_effort,'low');
  assert.equal(savedConfig.configuration.roles.reviewer.max_output_tokens,16384);
  assert.equal(savedConfig.configuration.saved_models[0].model,'acceptance-custom-vlm');
  await page.screenshot({path:path.join(root,'model-settings.png'),fullPage:true});
  await page.getByText('模型设置',{exact:true}).click();
  assert.equal(await page.getByLabel('已有角色').inputValue(),'test_hero');
  await page.getByLabel('已有角色').selectOption('test_hero');
  await page.getByText('候选数量、播放速度与调用上限',{exact:true}).click();
  assert.equal(await page.getByLabel('视觉复核方式',{exact:true}).inputValue(),'experts_v1');
  assert.equal(await page.getByLabel('视觉验收调用上限',{exact:true}).inputValue(),'25');
  await page.getByText('候选数量、播放速度与调用上限',{exact:true}).click();
  await page.getByLabel('角色要做什么',{exact:true}).fill('先摘帽鞠躬，最后保持低头姿势');
  assert.equal((await (await fetch(base+'/v1/open-motion')).json()).works.length,0);
  await page.reload();
  await page.getByLabel('角色要做什么',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('角色要做什么',{exact:true}).inputValue(),'先摘帽鞠躬，最后保持低头姿势');
  await page.getByRole('button',{name:'制定方案',exact:true}).click();
  await page.getByRole('button',{name:'确认方案，开始制作',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('确认方案，开始制作'));return b&&!b.disabled;});
  const workUrl=page.url();assert.ok(workUrl.includes('?work='));
  await page.getByText('用已有图片约束段末姿势（可选）',{exact:true}).click();
  await page.getByLabel('段末目标图片',{exact:true}).setInputFiles(path.join(root,'target-fixture/frame_002.png'));
  await page.getByLabel('目标图检查依据',{exact:true}).fill('已检查诊断图的姿势与物品，仅验收输入冻结流程。');
  await page.getByRole('button',{name:'确认并绑定目标图',exact:true}).click();
  await page.getByAltText('第 1 段目标图片',{exact:true}).waitFor();
  await page.screenshot({path:path.join(root,'plan.png'),fullPage:true});
  await page.getByRole('button',{name:'确认方案，开始制作',exact:true}).click();
  for(let stage=0;stage<2;stage++) {
    await page.getByRole('heading',{name:new RegExp(`确认第 ${stage+1} 段`)}).waitFor({timeout:30000});
    const acceptStage=page.getByRole('button',{name:'确认此段，继续制作',exact:true});
    assert.equal(await acceptStage.isDisabled(),true);
    await page.getByText('查看独立专家与争议复核过程',{exact:true}).click();
    await page.getByRole('heading',{name:'外观专家 · 独立意见',exact:true}).waitFor();
    await page.getByRole('heading',{name:'争议复核',exact:true}).waitFor();
    assert.equal(await page.getByText('需要实际画面裁决',{exact:true}).isVisible(),true);
    await page.screenshot({path:path.join(root,`expert-review-stage-${stage+1}.png`),fullPage:true});
    await page.getByText('查看独立专家与争议复核过程',{exact:true}).click();
    if(stage===0){await page.reload();await page.getByRole('heading',{name:/确认第 1 段/}).waitFor();}
    if(stage===0){
      await page.getByText('调整部分帧',{exact:true}).click();
      await page.getByLabel('修改开始帧',{exact:true}).fill('2');
      await page.getByLabel('修改结束帧',{exact:true}).fill('3');
      await page.getByLabel('修改要求（选填）',{exact:true}).fill('我希望这里抬手幅度更小，即便原版已经可用；仅验收流程。');
      const wid=new URL(workUrl).searchParams.get('work');
      assert.equal((await (await fetch(`${base}/v1/open-motion/${wid}/adjustments?revision=1&candidate=1&stage=0`)).json()).tasks.length,0);
      await page.getByRole('button',{name:'生成一个备选',exact:true}).click();
      await page.getByRole('button',{name:'同步播放完整对比',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'采用新版',exact:true}).isDisabled(),true);
      await page.screenshot({path:path.join(root,'adjustment-preview.png'),fullPage:true});
      await page.setViewportSize({width:720,height:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'repair preview must fit the page');
      await page.setViewportSize({width:1440,height:1000});
      await page.getByRole('button',{name:'同步播放完整对比',exact:true}).click();
      await page.getByLabel('备选对比结论',{exact:true}).fill('已核对完整诊断片段与两侧接缝，窗口外帧不变。');
      await page.getByLabel('已看过实际画面，接受本次视觉与技术提醒',{exact:true}).check();
      await page.getByRole('button',{name:'采用新版',exact:true}).click();
      for(let i=0;i<100;i++){const v=await (await fetch(`${base}/v1/open-motion/${wid}`)).json();const r=v.job.candidates[0].plan_execution.stages[0];if(r.state==='awaiting_review'&&r.active_frames)break;assert.ok(i<99);await delay(100);}
      await page.getByRole('heading',{name:/确认第 1 段/}).waitFor();
    }
    const playSegment=page.getByRole('button',{name:'播放当前完整片段',exact:true});
    await playSegment.click();
    const watchedSegment=page.getByLabel('我已播放此段并检查实际末姿势、装备和节奏');
    if(stage===0){
      await page.getByText('目标姿势提前到达时，选择实际锚点',{exact:true}).click();
      await page.getByLabel('本段结束锚点',{exact:true}).selectOption('2');
      assert.equal(await acceptStage.isDisabled(),true);
      await page.getByLabel('确认采用第 1–3 帧，其余原始帧保留在记录中').check();
    }
    await watchedSegment.check();
    await page.getByLabel('本段检查结论',{exact:true}).fill('已检查诊断片段、末姿势和帧序，仅验收工具流程。');
    await page.getByLabel('已核对模型的未通过或不确定意见，按实际画面确认接受').check();
    await page.screenshot({path:path.join(root,`checkpoint-${stage+1}.png`),fullPage:true});
    await acceptStage.click();
  }
  await page.getByRole('heading',{name:'检查与调整',exact:true}).waitFor({timeout:30000});
  const adopt=page.getByRole('button',{name:'采用此候选，进入导出'});
  assert.equal(await adopt.isDisabled(),true);
  await page.waitForFunction(()=>document.querySelector('#motion-action-status')?.textContent.includes('先播放检查'));
  assert.match(await page.locator('#motion-action-status').innerText(),/先播放检查/);
  await page.getByText('其他调整工具',{exact:true}).click();
  await page.getByRole('link',{name:'打开逐帧编辑工作区',exact:true}).click();
  const returnLink=page.getByRole('link',{name:'返回当前作品',exact:true});
  await returnLink.waitFor();
  const returnUrl=new URL(await returnLink.getAttribute('href'),page.url());
  assert.equal(returnUrl.searchParams.get('work'),new URL(workUrl).searchParams.get('work'));
  assert.equal(returnUrl.searchParams.get('version'),'1');
  assert.equal(returnUrl.searchParams.get('candidate'),'1');
  await page.screenshot({path:path.join(root,'editor-return.png'),fullPage:true});
  await returnLink.click();
  await page.getByRole('heading',{name:'检查与调整',exact:true}).waitFor();
  assert.equal((await (await fetch(base+'/v1/open-motion')).json()).works.length,1);
  await page.getByRole('button',{name:'播放完整动作',exact:true}).click();
  await page.waitForTimeout(1500);
  assert.match(await page.locator('.motion-player').innerText(),/7 \/ 7/);
  await page.getByLabel('我已播放完整动作并检查衔接、外观与结束姿势').check();
  await page.getByLabel('检查结论',{exact:true}).fill('可以');
  assert.equal(await adopt.isDisabled(),true);
  assert.match(await page.locator('#motion-action-status').innerText(),/至少 4 个字/);
  await page.getByLabel('检查结论',{exact:true}).fill('诊断动画已完整播放；确认帧序、透明背景和末帧停留。仅验收流程。');
  const warnings=page.getByLabel(/已核对上述技术提醒并接受|已核对技术与视觉提醒，接受当前结果/); if(await warnings.count()){
    assert.equal(await adopt.isDisabled(),true);
    assert.match(await page.locator('#motion-action-status').innerText(),/核对后勾选|核对技术与视觉报告/);
    await warnings.check();
  }
  assert.equal(await adopt.isEnabled(),true);
  await page.screenshot({path:path.join(root,'review.png'),fullPage:true});
  await page.getByRole('button',{name:'采用此候选，进入导出'}).click();
  await page.getByRole('button',{name:'导出到 Godot 项目',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button',{name:/仅下载 ZIP/}).waitFor();
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.includes('仅下载 ZIP'));return b&&!b.disabled;});
  await page.screenshot({path:path.join(root,'delivery.png'),fullPage:true});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:/仅下载 ZIP/}).click();assert.ok((await download).suggestedFilename().endsWith('.zip'));
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('heading',{name:'导出与使用',exact:true}).waitFor();
  await page.getByRole('button',{name:'导出到 Godot 项目',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.includes('仅下载 ZIP'));return b&&!b.disabled;});
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  // A finished/exported clip can be changed for preference, with no source loss.
  await page.getByRole('button',{name:/检查与调整/}).first().click();
  const wid=new URL(workUrl).searchParams.get('work');
  const original=await (await fetch(`${base}/v1/open-motion/${wid}`)).json();
  for(let attempt=0;attempt<2;attempt++){
    await page.getByRole('button',{name:/检查与调整/}).first().click();
    await page.getByText('调整部分帧',{exact:true}).click();
    await page.getByLabel('修改开始帧',{exact:true}).fill('5');
    await page.getByLabel('修改结束帧',{exact:true}).fill('6');
    await page.getByLabel('修改要求（选填）',{exact:true}).fill('个人偏好：让这两帧的抬手幅度更小，其他帧保持原样。');
    assert.equal(await page.getByRole('button',{name:'进入导出',exact:true}).count(),0,'old adoption action is hidden while adjusting');
    await page.getByRole('button',{name:'生成一个备选',exact:true}).click();
    if(attempt===0){await page.reload();await page.getByRole('heading',{name:'检查与调整',exact:true}).waitFor();}
    await page.getByRole('button',{name:'同步播放完整对比',exact:true}).waitFor();
    await page.getByRole('button',{name:'同步播放完整对比',exact:true}).click();
    await page.getByLabel('备选对比结论',{exact:true}).fill('完整对比了实际帧与接缝，仅验收隔离流程。');
    await page.getByLabel('已看过实际画面，接受本次视觉与技术提醒',{exact:true}).check();
    await page.setViewportSize({width:720,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:attempt?'采用新版':'保留原版',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(root,`complete-alternative-${attempt+1}.png`),fullPage:true});
    await page.getByRole('button',{name:attempt?'采用新版':'保留原版',exact:true}).click();
    if(!attempt){const retained=await(await fetch(`${base}/v1/open-motion/${wid}`)).json();assert.equal(retained.revision,1);assert.equal(retained.job.job_id,original.job.job_id);}
  }
  await page.getByText('版本 2 · 已保存本机',{exact:true}).waitFor();
  const revised=await(await fetch(`${base}/v1/open-motion/${wid}`)).json();
  assert.equal(revised.revision,2);assert.equal(revised.job.candidates[0].status,'approved');
  for(const i of [0,1,2,3,6])assert.equal(revised.job.candidates[0].frames[i].sha256,original.job.candidates[0].frames[i].sha256);
  await page.getByRole('button',{name:/准备与描述/}).first().click();
  await page.getByLabel('角色要做什么',{exact:true}).fill('修改为鞠躬后坐下，结束保持坐姿');
  await page.reload();
  await page.getByRole('heading',{name:'准备与描述',exact:true}).waitFor();
  assert.equal(await page.getByLabel('角色要做什么',{exact:true}).inputValue(),'修改为鞠躬后坐下，结束保持坐姿');
  await page.setViewportSize({width:390,height:844});
  await page.locator('.motion-content').hover();await page.mouse.wheel(0,850);
  assert.ok(await page.locator('.motion-content').evaluate(el=>el.scrollTop)>0);
  await page.screenshot({path:path.join(root,'mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browserAcceptance:'passed',evidence:root,checks:['manual-model-addition','role-model-persistence','no-empty-task','draft-reload','planning','generation','review-blocker-explanation','exact-work-editor-return','actual-frame-playback','review','Godot-dialog','real-ZIP-download','repeat-export','modified-draft-reload','narrow-scroll'],paidCalls:0}));
} catch(error) {
  if(page) {await page.screenshot({path:path.join(root,'failure.png'),fullPage:true});console.log('Failure evidence',root,(await page.locator('body').innerText()).slice(0,2400));}
  throw error;
} finally {if(browser)await browser.close();server.kill();}
