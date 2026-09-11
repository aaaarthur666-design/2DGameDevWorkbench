import '../helpers/runtime-workspace.mjs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import {createTestViteServer} from '../helpers/vite-server.mjs';
import {repositoryRoot} from '../../lib/workbench/runtime.mjs';
const root=await mkdtemp(path.join(repositoryRoot,'work','sprite-browser-'));
const game=path.join(root,'游戏项目');await mkdir(game);await writeFile(path.join(game,'project.godot'),'config_version=5\n[application]\nconfig/name="动画导出测试"\nconfig/features=PackedStringArray("4.7")\n');
const freePort=async()=>{const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const pipelinePort=await freePort(),bridgePort=await freePort();
const pipelineUrl='http://127.0.0.1:'+pipelinePort,bridgeUrl='http://127.0.0.1:'+bridgePort;
const children=[];let server;
const start=(command,args,env=process.env)=>{const p=spawn(command,args,{cwd:repositoryRoot,env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(p);p.stderr.on('data',d=>process.stderr.write(d));return p;};
const until=async(fn)=>{for(let i=0;i<100;i++){try{const v=await fn();if(v)return v;}catch{}await new Promise(r=>setTimeout(r,300));}throw Error('Fixture readiness timed out');};
try {
 const pipeline=start(process.env.WORKBENCH_TEST_PYTHON||'python',['-X','utf8','tests/game-export/sprite-web.py','--root',path.join(root,'pipeline'),'--port',String(pipelinePort)]);
 let jobId='';pipeline.stdout.on('data',d=>{const m=d.toString().match(/Fixture job: (\S+)/);if(m)jobId=m[1];});
 await until(async()=>jobId&&(await fetch(pipelineUrl+'/health')).ok);
 const bridge=start(process.execPath,['scripts/workbench-http.mjs'],{...process.env,WORKBENCH_RUNTIME_PORT:String(bridgePort),SPRITE_PIPELINE_API_URL:pipelineUrl});bridge.stdout.resume();
 await until(async()=>(await fetch(bridgeUrl+'/health')).ok);
 server=await createTestViteServer({root:repositoryRoot,configFile:false,css:{postcss:{plugins:[tailwindcss()]}},resolve:{alias:{'@':repositoryRoot}},define:{'process.env.NEXT_PUBLIC_SPRITE_PIPELINE_UI_URL':JSON.stringify(pipelineUrl)},plugins:[react(),{name:'sprite-export-fixture',configureServer(vite){vite.middlewares.use((req,res,next)=>{
  const url=new URL(req.url,'http://localhost');const send=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/api/workbench/sprite-pipeline/health'){send({ok:true,version:'fixture',uiReady:true});return;}
  if(url.pathname==='/api/workbench/sprite-pipeline/jobs'){send({jobs:[]});return;}
  if(url.pathname==='/api/workbench/tasks'){send({tasks:[],nextOffset:null});return;}
  if(url.pathname==='/tools/sprite-generator')req.url='/tests/game-export/sprite-web.html';
  next();
 });}}],server:{host:'127.0.0.1',port:0,proxy:{'/api/workbench/game-export':{target:bridgeUrl,rewrite:p=>p.replace('/api/workbench','/v1')},'/api/workbench/frontend':{target:bridgeUrl,rewrite:()=>'/v1/frontend/heartbeat'}}}});
 await server.listen();
 console.log('Fixture ready: '+JSON.stringify({url:'http://127.0.0.1:'+server.httpServer.address().port+'/tools/sprite-generator?job='+jobId+'&candidate='+(process.env.FORGE_TEST_EXPORTED?4:1),game,root,jobId,pipelineUrl,bridgeUrl}));
 const stop=async()=>{for(const p of children)p.kill();await server.close();process.exit(0);};
 process.on('SIGINT',stop);process.on('message',message=>{if(message==='stop')void stop();});
} catch(error){for(const p of children)p.kill();if(server)await server.close();throw error;}
