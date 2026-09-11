import '../helpers/runtime-workspace.mjs';
import react from '@vitejs/plugin-react';
import { randomUUID } from 'node:crypto';
import { createTestViteServer } from '../helpers/vite-server.mjs';
import { loadManifest, repositoryRoot } from '../../lib/workbench/runtime.mjs';
import { frontendContext, frontendHeartbeat, queuePresentation } from '../../lib/workbench/preview-follow.mjs';
const manifest = await loadManifest();
const sessionId = randomUUID();
let step = 0;
const server = await createTestViteServer({ root:repositoryRoot, configFile:false, resolve:{alias:{'@':repositoryRoot}}, plugins:[react(), { name:'preview-session-fixture', configureServer(vite) {
 vite.middlewares.use(async(req,res,next)=>{
  const url = new URL(req.url,'http://localhost');
  const send = (value,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  try {
   if(url.pathname === '/api/workbench/frontend') {const chunks=[];for await(const c of req)chunks.push(c);send(await frontendHeartbeat(repositoryRoot,manifest,JSON.parse(Buffer.concat(chunks))));return;}
   if(url.pathname === '/__context') {send(await frontendContext(repositoryRoot,manifest,{sessionId}));return;}
   if(url.pathname === '/__next' && req.method==='POST') {step++;send(await queuePresentation(repositoryRoot,manifest,{viewPath:'/tools/sprite-generator?job=fixture-'+step,title:'步骤 '+step,summary:'本地测试，无生成调用'},{sessionId}));return;}
   if(url.pathname.startsWith('/tools/')) {req.url='/tests/preview-follow/web.html';}
   next();
  } catch(error) {send({error:error.message},400);}
 });
}}],server:{host:'127.0.0.1',port:0}});
await server.listen();
console.log('Preview fixture: http://127.0.0.1:'+server.httpServer.address().port+'/tools/reference-art?previewSession='+sessionId);
process.on('SIGINT',async()=>{await server.close();process.exit(0);});
