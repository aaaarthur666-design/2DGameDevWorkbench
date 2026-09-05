'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Server,
  TerminalSquare,
  Wifi,
  WifiOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { WorkbenchModule } from '@/lib/workbench/modules';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import { publishEditorSession, removeEditorSession } from '@/lib/workbench/editor-session';

type PipelineStatus = 'checking' | 'ready' | 'offline';

const defaultPipelineUrl = 'http://127.0.0.1:7860';

function normalizedPipelineUrl() {
  const configured = process.env.NEXT_PUBLIC_SPRITE_PIPELINE_UI_URL?.trim();
  const value = configured || defaultPipelineUrl;

  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return defaultPipelineUrl;
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return defaultPipelineUrl;
  }
}

export function SpritePipelineWorkspace({
  module,
}: {
  module: WorkbenchModule;
}) {
  const [status, setStatus] = useState<PipelineStatus>('checking');
  const [pipelineVersion, setPipelineVersion] = useState<string | null>(null);
  const pipelineUrl = normalizedPipelineUrl();
  const iframe = useRef<HTMLIFrameElement>(null);
  const { spriteItems } = useWorkbench();
  const [entryJob, setEntryJob] = useState('');
  const [entryCharacter, setEntryCharacter] = useState('');
  const [activeJob, setActiveJob] = useState('');
  const [parentOrigin, setParentOrigin] = useState('');
  const embedded = new URL(pipelineUrl);
  if (entryJob) embedded.searchParams.set('workbench_job', entryJob);
  else if (entryCharacter) embedded.searchParams.set('workbench_character', entryCharacter);
  if (parentOrigin) embedded.searchParams.set('workbench_origin', parentOrigin);
  const embeddedUrl = embedded.toString();
  useEffect(() => {
    const job = new URLSearchParams(location.search).get('job') || '';
    // oxlint-disable-next-line react/react-compiler -- Hydrate the browser-only deep link after server rendering.
    setEntryJob(job); setActiveJob(job); setParentOrigin(location.origin);
    setEntryCharacter(new URLSearchParams(location.search).get('character') || '');
    const receive = (event: MessageEvent) => {
      if (event.origin !== new URL(pipelineUrl).origin || event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === 'workbench:sprite-job' && typeof event.data.jobId === 'string' && event.data.jobId.length <= 200) setActiveJob(event.data.jobId);
    };
    window.addEventListener('message', receive);
    return () => { window.removeEventListener('message', receive); removeEditorSession('sprite-generator'); };
  }, [pipelineUrl]);
  const activeItem = spriteItems.find(item => item.id === `sprite:${activeJob}`);
  useEffect(() => {
    publishEditorSession({ capabilityId: 'sprite-generator', items: activeItem ? [activeItem] : [], dirty: false, busy: false, save: async () => {} });
  }, [activeItem]);

  const checkConnection = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);

    try {
      const response = await fetch('/api/workbench/sprite-pipeline/health', {
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        version?: string;
      } | null;
      if (!response.ok || payload?.ok !== true || typeof payload.version !== 'string') {
        throw new Error('Invalid SpritePipeline health response');
      }
      setPipelineVersion(payload.version);
      setStatus('ready');
    } catch {
      setPipelineVersion(null);
      setStatus('offline');
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- This effect synchronizes the UI with an external sidecar service.
    void checkConnection();
  }, [checkConnection]);

  return (
    <main className="flex h-full min-h-0 flex-col bg-[#090b10]">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-white/8 bg-[#0d1017] px-3 py-2 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-500/12 text-violet-200">
            <Server className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white/88">
              {module.name}
            </p>
            <p className="truncate text-xs text-white/36">
              NativeFramesGeneration 本地工作区
            </p>
          </div>
        </div>

        <div
          aria-live="polite"
          className="flex items-center gap-1.5 text-xs text-white/48"
        >
          {status === 'checking' ? (
            <LoaderCircle className="size-3.5 animate-spin text-violet-300" />
          ) : status === 'ready' ? (
            <Wifi className="size-3.5 text-emerald-300" />
          ) : (
            <WifiOff className="size-3.5 text-amber-300" />
          )}
          {status === 'checking'
            ? '正在连接'
            : status === 'ready'
              ? `本地管线已连接${pipelineVersion ? ` · v${pipelineVersion}` : ''}`
              : '本地管线未启动'}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus('checking');
              void checkConnection();
            }}
            className="text-white/48 hover:bg-white/6 hover:text-white/82"
          >
            <RefreshCw className="size-3.5" />
            重试
          </Button>
          <a
            href={embeddedUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.025] px-2.5 text-[0.8rem] font-medium text-white/56 transition hover:bg-white/6 hover:text-white/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
          >
            <ExternalLink className="size-3.5" />
            单独打开
          </a>
        </div>
      </header>

      {status === 'ready' ? (
        <iframe
          ref={iframe}
          key={embeddedUrl}
          src={embeddedUrl}
          title="NativeFramesGeneration 序列帧生成工作区"
          className="min-h-0 w-full flex-1 border-0 bg-[#11101a]"
          onLoad={() => setStatus('ready')}
        />
      ) : (
        <section className="grid min-h-0 flex-1 place-items-center overflow-auto px-4 py-8">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#10131a] p-5 shadow-2xl shadow-black/25 sm:p-7">
            <div className="flex items-start gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-amber-300/18 bg-amber-300/[0.055] text-amber-200">
                <TerminalSquare className="size-5" />
              </span>
              <div>
                <h1 className="text-lg font-semibold text-white/90">
                  本地序列帧管线未就绪
                </h1>
                <p className="mt-1.5 text-sm leading-6 text-white/46">
                  完整的生成、播放检查、逐帧修补和 Sprite Sheet
                  导出界面由本项目内置的 Python
                  管线提供。正常情况下它会随 Workbench 自动启动；首次使用只需安装一次依赖。
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3 rounded-2xl border border-white/8 bg-black/20 p-4 font-mono text-sm">
              <div>
                <p className="mb-1 text-xs font-sans text-white/34">首次安装</p>
                <code className="select-all text-violet-200/90">
                  npm run sprite-pipeline:setup
                </code>
              </div>
              <div className="border-t border-white/7 pt-3">
                <p className="mb-1 text-xs font-sans text-white/34">仅单独调试管线时</p>
                <code className="select-all text-cyan-200/90">
                  npm run sprite-pipeline
                </code>
              </div>
            </div>

            <p className="mt-4 text-xs leading-5 text-white/32">
              服务默认只监听本机 {pipelineUrl}。PixelLab Key 由管线使用当前
              Windows 用户的安全存储管理，不会进入网页项目或 Git。
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
