'use client';

import { useMemo, useState, type SyntheticEvent } from 'react';
import { ArrowUp, Bot, Check, ChevronDown, Plus, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { WorkbenchModule } from '@/lib/workbench/modules';
import { ModuleIcon } from './module-icon';

const examples: Record<string, string[]> = {
  'sprite-generator': [
    '制作一个 32×32 像素角色的 8 帧待机动画',
    '把角色跑步动作整理成循环序列帧',
  ],
  'map-stitcher': [
    '把森林地图切片拼成一张完整关卡',
    '检查地图边缘接缝并准备引擎导出',
  ],
};

export function AiCommandPreview({
  modules,
}: {
  modules: readonly WorkbenchModule[];
}) {
  const [activeId, setActiveId] = useState(modules[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [notice, setNotice] = useState(false);
  const activeModule = useMemo(
    () => modules.find((module) => module.id === activeId) ?? modules[0],
    [activeId, modules],
  );

  function submitPreview(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) return;
    setNotice(true);
  }

  return (
    <section
      id="ai-preview"
      aria-labelledby="ai-preview-title"
      className="panel-highlight overflow-hidden rounded-3xl border border-white/10 bg-[#10131b]/92"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="agent-avatar flex size-9 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-500/12 text-violet-200">
            <Bot className="size-4" />
          </span>
          <div>
            <h2 id="ai-preview-title" className="text-sm font-semibold text-white/90">
              AI 协作入口
            </h2>
            <p className="mt-0.5 text-xs text-white/38">
              未来可直接描述目标，由 AI 选择并操作工具
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className="border-amber-300/18 bg-amber-300/[0.055] text-[11px] font-normal text-amber-100/75"
        >
          界面预览
        </Badge>
      </div>

      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_250px]">
        <form onSubmit={submitPreview} className="min-w-0">
          <div className="composer-glow rounded-2xl border border-white/11 bg-[#0b0e15] p-2 shadow-xl shadow-black/25">
            <Textarea
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setNotice(false);
              }}
              placeholder="描述你想制作的角色动作或地图……"
              aria-label="AI 协作指令预览"
              className="min-h-[92px] resize-none border-0 bg-transparent px-2.5 py-2.5 text-base leading-6 text-white/86 shadow-none placeholder:text-white/25 focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
            />
            <div className="flex items-center justify-between gap-2 px-1 pt-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled
                  aria-label="添加项目文件，即将开放"
                  className="text-white/34"
                >
                  <Plus />
                </Button>
                <div className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-white/48">
                  <ModuleIcon
                    icon={activeModule?.icon ?? 'frames'}
                    className="size-3.5 shrink-0"
                  />
                  <span className="truncate">{activeModule?.shortName}</span>
                  <ChevronDown className="size-3 text-white/28" />
                </div>
              </div>
              <Button
                type="submit"
                size="icon"
                disabled={!prompt.trim()}
                aria-label="预览发送效果"
                className="rounded-xl bg-violet-500 text-white shadow-lg shadow-violet-950/40 hover:bg-violet-400"
              >
                <ArrowUp />
              </Button>
            </div>
          </div>
          <div className="mt-2.5 min-h-5 px-1 text-xs">
            {notice ? (
              <output className="flex items-center gap-1.5 text-amber-100/70">
                <Check className="size-3.5" />
                AI 尚未接入；这次操作没有调用模型或修改项目。
              </output>
            ) : (
              <p className="text-white/30">
                当前仅展示交互，不会执行任务或产生生成结果。
              </p>
            )}
          </div>
        </form>

        <div className="border-white/8 lg:border-l lg:pl-5">
          <p className="mb-2.5 text-xs font-medium text-white/40">选择操作方向</p>
          <div className="space-y-2">
            {modules.map((module) => (
              <button
                key={module.id}
                type="button"
                onClick={() => {
                  setActiveId(module.id);
                  setNotice(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition',
                  module.id === activeModule?.id
                    ? 'border-violet-300/20 bg-violet-400/[0.07] text-white/82'
                    : 'border-white/7 bg-white/[0.018] text-white/46 hover:border-white/13 hover:text-white/72',
                )}
              >
                <ModuleIcon
                  icon={module.icon}
                  className={cn(
                    'size-4',
                    module.accent === 'cyan'
                      ? 'text-cyan-300'
                      : 'text-violet-300',
                  )}
                />
                <span className="flex-1">{module.shortName}</span>
                {module.id === activeModule?.id ? (
                  <span className="size-1.5 rounded-full bg-violet-300" />
                ) : null}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {(examples[activeModule?.id ?? ''] ?? []).map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setPrompt(example);
                  setNotice(false);
                }}
                className="group flex w-full gap-2 rounded-lg px-1 py-1 text-left text-xs leading-5 text-white/32 transition hover:text-white/62"
              >
                <Sparkles className="mt-1 size-3 shrink-0 text-violet-300/55 group-hover:text-violet-200" />
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
