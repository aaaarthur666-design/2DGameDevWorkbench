// Isolated browser fixture: real canvas composition and actual asset-library UI, no production data/services.
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { createTestViteServer } from '../helpers/vite-server.mjs';

const previews = new Map();
const server = await createTestViteServer({
  root: process.cwd(),
  configFile: false,
  resolve: { alias: { '@': process.cwd() } },
  plugins: [
    react(),
    {
      name: 'map-preview-fixtures',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/__map-preview')) return next();
          const url = new URL(req.url, 'http://localhost');
          const id = url.searchParams.get('id');
          if (req.method === 'POST') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            previews.set(id, Buffer.concat(chunks));
            res.end('ok');
          } else if (previews.has(id)) {
            res.setHeader('content-type', 'image/png');
            res.end(previews.get(id));
          } else {
            res.statusCode = 404;
            res.end('missing');
          }
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
console.log(
  `Map preview fixture: http://127.0.0.1:${server.httpServer.address().port}/tests/map-stitcher/preview-web.html`,
);
console.log(
  `Isolated Vite cache: ${path.relative(process.cwd(), server.config.cacheDir)}`,
);
process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
