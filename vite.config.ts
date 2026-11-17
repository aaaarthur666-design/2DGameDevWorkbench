import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type Plugin } from 'vite';
import hostingConfig from './.openai/hosting.json';
import { syncUiManifest } from './scripts/sync-ui-manifest.mjs';

// Pages import lib/workbench/ui-manifest.json (brand, navigation, routes)
// instead of the full capability manifest; keep it current while building.
function workbenchUiManifest(): Plugin {
  return {
    name: 'workbench-ui-manifest',
    async buildStart() {
      await syncUiManifest();
    },
    configureServer(server) {
      server.watcher.add('workbench/manifest.json');
      server.watcher.on('change', (file) => {
        if (/[\\/]workbench[\\/]manifest\.json$/.test(file)) void syncUiManifest();
      });
    },
  };
}

// vinext's vite-plugin-commonjs and vinext:jsx-in-js only treat paths under
// `node_modules` as pre-bundled dependencies. When WORKBENCH_TEST_RUN moves
// cacheDir into `work/test-runs/<id>/vite-cache`, skip vite-plugin-commonjs
// and gate vinext:jsx-in-js on files under cacheDir just like `node_modules/.vite`.
function isolateViteCacheTransforms(): Plugin {
  return {
    name: 'workbench-isolate-vite-cache',
    configResolved(resolved) {
      const normalizedCacheDir = resolved.cacheDir
        .replaceAll('\\', '/')
        .replace(/\/+$/, '');
      if (!normalizedCacheDir || normalizedCacheDir.includes('/node_modules/')) {
        return;
      }
      const cachePrefix = `${normalizedCacheDir}/`;
      const isCachedDep = (id: string) =>
        id.split(/[?#]/, 1)[0].replaceAll('\\', '/').startsWith(cachePrefix);

      for (const plugin of resolved.plugins) {
        if (plugin.name === 'vite-plugin-commonjs' && plugin.transform) {
          if (typeof plugin.transform === 'function') {
            const orig = plugin.transform;
            plugin.transform = function (code, id, ...rest) {
              if (isCachedDep(id)) return;
              return orig.call(this, code, id, ...rest);
            };
          } else if (typeof plugin.transform.handler === 'function') {
            const orig = plugin.transform.handler;
            plugin.transform.handler = function (code, id, ...rest) {
              if (isCachedDep(id)) return;
              return orig.call(this, code, id, ...rest);
            };
          }
        } else if (
          plugin.name === 'vinext:jsx-in-js' &&
          plugin.transform &&
          typeof plugin.transform === 'object' &&
          typeof plugin.transform.handler === 'function'
        ) {
          const orig = plugin.transform.handler;
          plugin.transform.handler = function (code, id, ...rest) {
            if (
              isCachedDep(id) &&
              !code.includes('use client') &&
              !code.includes('use server')
            ) {
              return;
            }
            return orig.call(this, code, id, ...rest);
          };
        }
      }
    },
  };
}

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  const testRun = process.env.WORKBENCH_TEST_RUN;
  if (testRun && !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(testRun))
    throw new Error('WORKBENCH_TEST_RUN must be a simple isolated build identifier.');
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    ...(testRun ? { cacheDir: `work/test-runs/${testRun}/vite-cache` } : {}),
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      strictPort: true,
      watch: {
        // Runtime image directories are atomically renamed by SpritePipeline.
        // They are data, not frontend source; avoid holding Windows watch handles.
        ignored: [
          '**/work/**',
          '**/outputs/**',
          '**/.venv/**',
          '**/.pytest_cache/**',
        ],
        ...(isCodexSeatbeltSandbox
          ? { useFsEvents: false, usePolling: true }
          : {}),
      },
    },
    plugins: [
      isolateViteCacheTransforms(),
      workbenchUiManifest(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
