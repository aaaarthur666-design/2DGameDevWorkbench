import '../helpers/runtime-workspace.mjs';
import react from '@vitejs/plugin-react';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createTestViteServer } from '../helpers/vite-server.mjs';
import { mapProjectFixture } from '../helpers/map-project.mjs';
import { loadManifest, repositoryRoot, persistTask } from '../../lib/workbench/runtime.mjs';
import { saveMapProjectRequest, saveMapProject, readMapProject } from '../../lib/workbench/map-projects.mjs';
import { createMapProjectPackage } from '../../features/map-stitcher/project-package.mjs';
import { listAssets, getAsset, manageAssets, readAssetPreview, buildAssetArchive, buildAssetImport } from '../../lib/workbench/asset-catalog.mjs';

const manifest = await loadManifest();
const id = `map:${process.env.WORKBENCH_TEST_RUN}`;
const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#62a97e' } }).png().toBuffer();
const { draft } = await mapProjectFixture(png, id);
for (const layer of Object.keys(draft.snapshot.imageLocks)) draft.snapshot.imageLocks[layer] = false;
await saveMapProject(repositoryRoot, manifest, id, 0, await createMapProjectPackage(draft));
const legacyOutput = manifest.workspace.outputDirectory + '/map-history/generated-origin.png';
await mkdir(path.dirname(path.join(repositoryRoot, legacyOutput)), {recursive:true});
await writeFile(path.join(repositoryRoot, legacyOutput),png);
await persistTask(manifest,{schemaVersion:1,id:'map-history',capabilityId:'map-stitcher',input:{operation:'generate-origin',name:'历史地图原图'},status:'completed',outputs:[legacyOutput],createdAt:'2026-01-01',updatedAt:'2026-01-01'});
let writes = 0;
let deniedGeneration = 0;
const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
const server = await createTestViteServer({
  root: repositoryRoot, configFile: false, resolve: { alias: { '@': repositoryRoot } },
  plugins: [react(), { name: 'map-workspace-integration', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      if (p === '/assets' || p === '/tools/map-stitcher') {
        res.writeHead(302, { location: `/tests/map-stitcher/workspace-web.html?${p === '/assets' ? 'catalog=1&' : 'resume=1&'}${url.searchParams}` }); res.end(); return;
      }
      if (p === '/v1/artworks') { json(res, { data: { assets: [], issues: [] } }); return; }
      if (!p.startsWith('/api/workbench/') && p !== '/__workspace-state') return next();
      try {
        if (p === '/__workspace-state') {
          const saved = await readMapProject(repositoryRoot, manifest, id);
          json(res, { record: saved.record, writes, deniedGeneration });
        } else if (p === '/api/workbench/map-stitcher/settings') json(res, { active: false, provider: null, providers: [] });
        else if (p.startsWith('/api/workbench/map-stitcher/projects/')) {
          const projectId = decodeURIComponent(p.split('/').at(-1));
          if (req.method === 'PUT') { const record = await saveMapProjectRequest(req, repositoryRoot, projectId); writes++; json(res, record); }
          else {
            const { record, bytes } = await readMapProject(repositoryRoot, manifest, projectId);
            res.writeHead(200, { 'content-type': 'application/zip', 'x-map-revision': String(record.revision), 'cache-control': 'no-store' }); res.end(bytes);
          }
        } else if (p === '/api/workbench/assets/preview') {
          const { bytes, mime } = await readAssetPreview(manifest, url.searchParams.get('assetId'), url.searchParams.get('projectRevision') ?? undefined);
          res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' }); res.end(bytes);
        } else if (p === '/api/workbench/assets/manage') {
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          json(res, await manageAssets(manifest, JSON.parse(Buffer.concat(chunks).toString())));
        } else if (p === '/api/workbench/assets/import') {
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const result = await buildAssetImport(manifest,JSON.parse(Buffer.concat(chunks).toString()));
          res.writeHead(200,{'content-type':'application/zip'});res.end(result.bytes);
        } else if (p === '/api/workbench/assets/download') {
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const result = await buildAssetArchive(manifest, JSON.parse(Buffer.concat(chunks).toString()));
          res.writeHead(200, { 'content-type': 'application/zip', 'x-asset-count': result.assetCount }); res.end(result.bytes);
        } else if (p === '/api/workbench/assets') {
          const input = Object.fromEntries(url.searchParams);
          for (const field of ['offset', 'limit']) if (input[field]) input[field] = Number(input[field]);
          json(res, url.searchParams.has('assetId') ? await getAsset(manifest, input) : await listAssets(manifest, input));
        } else { deniedGeneration++; json(res, { error: 'This isolated test does not permit production calls.' }, 403); }
      } catch (error) { json(res, { error: error.message }, error.status || 400); }
    });
  } }],
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
process.env.SPRITE_PIPELINE_API_URL = base;
console.log(`Workspace integration: ${base}/tests/map-stitcher/workspace-web.html?map=${encodeURIComponent(id)}&saved=1`);
console.log(`Records: ${manifest.workspace.mapProjectDirectory}`);
process.on('SIGINT', async () => { await server.close(); process.exit(0); });
