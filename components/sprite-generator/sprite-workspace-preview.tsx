import { Download, ImagePlus, Layers3, Play, Sparkles, Upload } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { WorkbenchModule } from '@/lib/workbench/modules';
import { ModuleIcon } from '@/components/workbench/module-icon';

const frames = Array.from({ length: 8 }, (_, index) => index + 1);

export function SpriteWorkspacePreview({
  module,
}: {
  module: WorkbenchModule;
}) {
  return (
    <main className="min-h-[calc(100svh-var(--workbench-nav-height))] bg-[#090b10] px-3 py-3 sm:px-4 sm:py-4">
      <section className="workbench-frame mx-auto flex min-h-[calc(100svh-var(--workbench-nav-height)-1.5rem)] max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-white/9 bg-[#0c0f15]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-400/9 text-violet-200">
              <ModuleIcon icon={module.icon} className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base font-semibold text-white/90">{module.name}</h1>
                <Badge
                  variant="outline"
                  className="border-amber-300/16 bg-amber-300/[0.055] text-[10px] font-normal text-amber-100/70"
                >
                  功能预览
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-white/34">
                组织角色动作、帧序和精灵表导出
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled
              className="border-white/9 bg-white/[0.025] text-white/48"
            >
              <Download /> 导出精灵表
            </Button>
            <Button disabled className="bg-violet-500 text-white">
              <Sparkles /> AI 生成即将接入
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)_250px]">
          <aside className="border-b border-white/8 bg-[#0e1118] p-4 lg:border-b-0 lg:border-r">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-white/28">输入设置</p>

            <div className="mt-4 rounded-2xl border border-dashed border-violet-300/18 bg-violet-400/[0.025] p-5 text-center">
              <span className="mx-auto flex size-10 items-center justify-center rounded-xl border border-violet-300/16 bg-violet-400/[0.06] text-violet-200/70">
                <ImagePlus className="size-4" />
              </span>
              <p className="mt-3 text-sm font-medium text-white/66">角色参考图</p>
              <p className="mt-1 text-xs leading-5 text-white/30">后续可上传角色设定或现有动作帧</p>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="mt-4 border-white/9 bg-white/[0.025]"
              >
                <Upload /> 选择图片
              </Button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-xs text-white/42">动作描述</span>
                <textarea
                  readOnly
                  value="角色面向右侧，制作自然循环的待机动作"
                  aria-label="动作描述预览"
                  className="mt-2 min-h-24 w-full resize-none rounded-xl border border-white/8 bg-black/14 px-3 py-2.5 text-sm leading-6 text-white/54 outline-none"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                  <p className="text-[11px] text-white/28">帧数</p>
                  <p className="mt-1 text-sm text-white/68">8 帧</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                  <p className="text-[11px] text-white/28">单帧尺寸</p>
                  <p className="mt-1 text-sm text-white/68">32 × 32</p>
                </div>
              </div>
            </div>
          </aside>

          <section className="pixel-grid flex min-h-[460px] min-w-0 flex-col bg-[#090c12] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white/68">待机动作 · 帧序预览</p>
                <p className="mt-1 text-xs text-white/28">生成服务接入后，帧会按顺序出现在这里</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="border-white/9 bg-[#11151e] text-white/40"
              >
                <Play /> 播放预览
              </Button>
            </div>

            <div className="my-auto py-8">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {frames.map((frame) => (
                  <div key={frame} className="min-w-0">
                    <div className="sprite-frame-placeholder aspect-square rounded-xl border border-white/9 bg-[#11151e]/92 p-2 shadow-lg shadow-black/15">
                      <div className="grid h-full place-items-center rounded-lg border border-dashed border-violet-300/10 bg-black/10">
                        <span className="text-xs tabular-nums text-white/18">{frame}</span>
                      </div>
                    </div>
                    <p className="mt-2 text-center text-[11px] text-white/24">F{String(frame).padStart(2, '0')}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-300/12 bg-amber-300/[0.035] px-4 py-3 text-xs leading-5 text-amber-50/55">
              当前页面只展示序列帧工作区结构，不会调用模型、创建任务或生成虚假图片。
            </div>
          </section>

          <aside className="border-t border-white/8 bg-[#0e1118] p-4 lg:border-l lg:border-t-0">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-white/28">输出准备</p>
            <div className="mt-4 space-y-2">
              {[
                ['有序帧', '独立 PNG 文件'],
                ['精灵表', '水平排列预览'],
                ['元数据', '帧序与尺寸信息'],
              ].map(([name, detail]) => (
                <div
                  key={name}
                  className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3"
                >
                  <span className="flex size-8 items-center justify-center rounded-lg bg-violet-400/[0.06] text-violet-200/55">
                    <Layers3 className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-sm text-white/60">{name}</p>
                    <p className="mt-0.5 text-[11px] text-white/26">{detail}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-white/8 bg-black/12 p-4">
              <p className="text-xs font-medium text-white/52">当前能力</p>
              <ul className="mt-3 space-y-2">
                {module.capabilities.map((capability) => (
                  <li key={capability} className="flex items-center gap-2 text-xs text-white/36">
                    <span className="size-1.5 rounded-full bg-violet-300/60" />
                    {capability}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
