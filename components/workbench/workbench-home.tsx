import { ArrowRight, CheckCircle2, Layers3, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { WorkbenchModule } from '@/lib/workbench/modules';
import { AiCommandPreview } from './ai-command-preview';
import { ModuleIcon } from './module-icon';

export function WorkbenchHome({
  modules,
}: {
  modules: readonly WorkbenchModule[];
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8 lg:py-14">
      <section aria-labelledby="home-title" className="mb-8 sm:mb-10">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-violet-300/18 bg-violet-400/[0.055] text-[11px] font-normal text-violet-100/72"
          >
            <Sparkles className="size-3" />
            2D 游戏生产工作台
          </Badge>
          <span className="text-xs text-white/28">2 项制作能力已注册</span>
        </div>
        <div className="max-w-3xl">
          <h1
            id="home-title"
            className="text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-5xl"
          >
            2D Game Dev Workbench
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-white/52 sm:text-lg">
            从角色序列帧到地图拼接，把创作、预览和导出集中在同一个工作流中。
          </p>
        </div>
      </section>

      <AiCommandPreview modules={modules} />

      <section aria-labelledby="tools-title" className="mt-9 sm:mt-11">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/28">
              Tools
            </p>
            <h2 id="tools-title" className="mt-1.5 text-xl font-semibold text-white/90">
              也可以直接打开工具
            </h2>
          </div>
          <p className="text-sm text-white/32">功能入口与 Agent 共用同一份能力清单</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {modules.map((module) => (
            <a
              key={module.id}
              href={module.href}
              aria-label={`${module.name}：进入工具`}
              className={cn(
                'group relative overflow-hidden rounded-3xl border bg-[#10131a]/88 p-5 outline-none transition duration-300 hover:-translate-y-0.5 hover:bg-[#121620] focus-visible:ring-2 sm:p-6',
                module.accent === 'cyan'
                  ? 'border-cyan-300/12 hover:border-cyan-300/28 focus-visible:ring-cyan-300/55'
                  : 'border-violet-300/12 hover:border-violet-300/28 focus-visible:ring-violet-300/55',
              )}
            >
              <div
                className={cn(
                  'absolute -right-16 -top-20 size-44 rounded-full blur-3xl transition-opacity group-hover:opacity-100',
                  module.accent === 'cyan'
                    ? 'bg-cyan-400/8'
                    : 'bg-violet-500/10',
                )}
              />
              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <span
                    className={cn(
                      'flex size-11 items-center justify-center rounded-2xl border',
                      module.accent === 'cyan'
                        ? 'border-cyan-300/20 bg-cyan-400/8 text-cyan-200'
                        : 'border-violet-300/20 bg-violet-400/9 text-violet-200',
                    )}
                  >
                    <ModuleIcon icon={module.icon} className="size-5" />
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'font-normal',
                      module.surface === 'editor'
                        ? 'border-emerald-300/16 bg-emerald-300/[0.055] text-emerald-100/70'
                        : 'border-amber-300/16 bg-amber-300/[0.055] text-amber-100/70',
                    )}
                  >
                    {module.surface === 'editor' ? '可使用' : '功能预览'}
                  </Badge>
                </div>
                <h3 className="mt-5 text-xl font-semibold text-white/90">
                  {module.name}
                </h3>
                <p className="mt-2 min-h-12 text-sm leading-6 text-white/42">
                  {module.description}
                </p>
                <ul className="mt-5 flex flex-wrap gap-2">
                  {module.capabilities.map((capability) => (
                    <li
                      key={capability}
                      className="flex items-center gap-1.5 rounded-lg border border-white/7 bg-black/12 px-2 py-1.5 text-xs text-white/40"
                    >
                      <CheckCircle2 className="size-3 text-white/24" />
                      {capability}
                    </li>
                  ))}
                </ul>
                <div className="mt-6 flex items-center justify-between border-t border-white/7 pt-4 text-sm">
                  <span className="flex items-center gap-2 text-white/32">
                    <Layers3 className="size-3.5" />
                    独立工作区
                  </span>
                  <span
                    className={cn(
                      'flex items-center gap-1.5 font-medium transition group-hover:gap-2.5',
                      module.accent === 'cyan'
                        ? 'text-cyan-200/80'
                        : 'text-violet-200/80',
                    )}
                  >
                    进入工具
                    <ArrowRight className="size-4" />
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
