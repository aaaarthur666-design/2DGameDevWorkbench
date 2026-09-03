'use client';

/* oxlint-disable next/no-html-link-for-pages -- Vinext dev currently bundles next/link with a duplicate React instance; native links keep navigation reliable. */
import { useSyncExternalStore } from 'react';
import { Sparkles, WandSparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { WorkbenchModule } from '@/lib/workbench/modules';
import { ModuleIcon } from './module-icon';

function subscribeToPath(callback: () => void) {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

function readPath() {
  return window.location.pathname;
}

export function WorkbenchNavigation({
  modules,
}: {
  modules: readonly WorkbenchModule[];
}) {
  const pathname = useSyncExternalStore(subscribeToPath, readPath, () => '');

  return (
    <header className="workbench-navigation sticky top-0 z-50 border-b border-white/8 bg-[#090b10]/88 backdrop-blur-xl">
      <div className="mx-auto flex h-[var(--workbench-nav-height)] max-w-[1800px] items-center gap-3 px-3 sm:px-5">
        <a
          href="/"
          aria-label="返回 2D Game Dev Workbench 开始页"
          className="flex shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
        >
          <span className="flex size-8 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-500/14 text-violet-200 shadow-lg shadow-violet-950/20">
            <WandSparkles className="size-4" />
          </span>
          <span className="hidden text-sm font-semibold tracking-[-0.01em] text-white/92 sm:block">
            2D Game Dev Workbench
          </span>
          <span className="text-sm font-semibold text-white/92 sm:hidden">
            2D Workbench
          </span>
        </a>

        <nav
          aria-label="工作台主导航"
          className="ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:ml-4"
        >
          <a
            href="/"
            className={cn(
              'shrink-0 rounded-lg px-3 py-2 text-sm text-white/48 transition hover:bg-white/5 hover:text-white/82 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60',
              pathname === '/' && 'bg-white/[0.055] text-white/92',
            )}
          >
            开始
          </a>
          {modules.map((module) => {
            const active = pathname === module.href;
            return (
              <a
                key={module.id}
                href={module.href}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/48 transition hover:bg-white/5 hover:text-white/82 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60',
                  active && 'bg-white/[0.055] text-white/92',
                )}
              >
                <ModuleIcon
                  icon={module.icon}
                  className={cn(
                    'size-3.5',
                    module.accent === 'cyan'
                      ? 'text-cyan-300'
                      : 'text-violet-300',
                  )}
                />
                {module.shortName}
              </a>
            );
          })}
        </nav>

        <a
          href="/#ai-preview"
          className="hidden h-7 shrink-0 items-center gap-1 rounded-full border border-violet-300/15 bg-violet-400/[0.055] px-2.5 text-[11px] font-normal text-violet-200/75 transition hover:border-violet-300/30 hover:text-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 lg:inline-flex"
        >
          <Sparkles className="size-3" />
          AI 协作 · 即将接入
        </a>
      </div>
    </header>
  );
}
