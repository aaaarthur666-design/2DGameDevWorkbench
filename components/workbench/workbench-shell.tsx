'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Box,
  Check,
  ChevronDown,
  CircleDot,
  CircleAlert,
  CircleX,
  Command,
  FileImage,
  FolderOpen,
  GitBranch,
  LayoutDashboard,
  MoreHorizontal,
  PanelRight,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  TerminalSquare,
  WandSparkles,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { WorkbenchModule } from '@/lib/workbench/modules';
import { ModuleIcon } from './module-icon';

type WorkbenchShellProps = {
  modules: readonly WorkbenchModule[];
};

type TaskState = 'running' | 'complete' | 'waiting' | 'failed';

type Task = {
  id: string;
  name: string;
  detail: string;
  progress: number;
  state: TaskState;
};

type Message = {
  id: string;
  role: 'workbench' | 'user';
  content: string;
};

type BrowserAgentTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: (input: unknown) => unknown;
};

type AgentAwareDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: BrowserAgentTool,
      options?: { signal?: AbortSignal },
    ) => void | Promise<void>;
  };
};

const promptIdeas: Record<string, string[]> = {
  'sprite-generator': [
    '生成一个 32×32 像素角色的 8 帧待机动画',
    '把角色设定整理成可执行的动作帧清单',
  ],
  'map-stitcher': [
    '将这批 16×16 地图切片拼成 64×64 关卡',
    '检查地图边界并列出需要修补的接缝',
  ],
};

const initialMessages: Message[] = [
  {
    id: 'welcome',
    role: 'workbench',
    content:
      '这是工作台的人工直调控制台。主 Agent 运行在打开本项目的 WorkBuddy、Codex 等客户端中，并通过 MCP 或 CLI 驱动同一套能力与任务记录。',
  },
];

const initialTasks: Task[] = [
  {
    id: 'WB-024',
    name: '骑士待机动作',
    detail: '序列帧生成 · 示例记录',
    progress: 100,
    state: 'complete',
  },
  {
    id: 'WB-025',
    name: '森林入口地图',
    detail: '地图拼接 · 等待配置连接器',
    progress: 0,
    state: 'waiting',
  },
];

const capabilityAssets = [
  { name: 'Skill', detail: '项目级工作流', state: 'ready' },
  { name: 'Expert', detail: '2D 生产专家', state: 'ready' },
  { name: 'Connector', detail: 'HTTP 适配器', state: 'config' },
  { name: 'MCP Server', detail: '5 个客户端工具', state: 'ready' },
  { name: 'WebMCP', detail: '2 个页面工具', state: 'ready' },
  { name: 'Workflow', detail: '5 步预置流程', state: 'ready' },
] as const;

function StatusMark({ state }: { state: TaskState }) {
  if (state === 'complete') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-emerald-400/12 text-emerald-300">
        <Check className="size-3.5" />
      </span>
    );
  }

  if (state === 'waiting') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-amber-400/10 text-amber-300">
        <CircleAlert className="size-3.5" />
      </span>
    );
  }

  if (state === 'failed') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-rose-400/10 text-rose-300">
        <CircleX className="size-3.5" />
      </span>
    );
  }

  return (
    <span className="relative flex size-5 items-center justify-center">
      <span className="absolute size-4 animate-ping rounded-full bg-cyan-400/15" />
      <CircleDot className="relative size-4 text-cyan-300" />
    </span>
  );
}

export function WorkbenchShell({ modules }: WorkbenchShellProps) {
  const [activeId, setActiveId] = useState(modules[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const taskSequence = useRef(26);

  const activeModule = useMemo(
    () => modules.find((module) => module.id === activeId) ?? modules[0],
    [activeId, modules],
  );

  const ideas = activeModule ? (promptIdeas[activeModule.id] ?? []) : [];

  const startTask = useCallback(
    async (instruction: string, requestedModuleId = activeId) => {
      const targetModule = modules.find(
        (module) => module.id === requestedModuleId,
      );
      if (!targetModule) {
        throw new Error(`未找到能力：${requestedModuleId}`);
      }

      const trimmed = instruction.trim();
      if (!trimmed) throw new Error('任务指令不能为空。');

      const taskId = `WB-${String(taskSequence.current).padStart(3, '0')}`;
      taskSequence.current += 1;
      const nextTask: Task = {
        id: taskId,
        name: trimmed.length > 18 ? `${trimmed.slice(0, 18)}…` : trimmed,
        detail: `${targetModule.shortName} · 已交给适配器`,
        progress: 12,
        state: 'running',
      };

      setActiveId(targetModule.id);
      setMessages((current) => [
        ...current,
        { id: `${taskId}-user`, role: 'user', content: trimmed },
        {
          id: `${taskId}-agent`,
          role: 'workbench',
          content: `控制台已选择「${targetModule.name}」，并将输入交给统一适配器校验；任务 ${taskId} 已加入右侧队列。`,
        },
      ]);
      setTasks((current) => [nextTask, ...current]);

      try {
        const response = await fetch('/api/workbench/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            capabilityId: targetModule.id,
            input: { prompt: trimmed },
          }),
        });
        const result = (await response.json()) as {
          status?: string;
          requiredEnvironment?: string;
          error?: string;
        };

        const nextState: TaskState =
          result.status === 'completed'
            ? 'complete'
            : result.status === 'awaiting_configuration'
              ? 'waiting'
              : 'failed';
        setTasks((current) =>
          current.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  progress: nextState === 'complete' ? 100 : task.progress,
                  state: nextState,
                  detail:
                    nextState === 'complete'
                      ? `${targetModule.shortName} · 已完成`
                      : nextState === 'waiting'
                        ? `${targetModule.shortName} · 等待配置连接器`
                        : `${targetModule.shortName} · 调用失败`,
                }
              : task,
          ),
        );

        if (nextState === 'waiting') {
          setMessages((current) => [
            ...current,
            {
              id: `${taskId}-configuration`,
              role: 'workbench',
              content: `任务已按能力协议准备完成。配置 ${result.requiredEnvironment ?? '对应的 API 地址'} 后即可执行，当前没有伪造生成结果。`,
            },
          ]);
        } else if (nextState === 'failed') {
          setMessages((current) => [
            ...current,
            {
              id: `${taskId}-error`,
              role: 'workbench',
              content:
                result.error ?? '连接器调用失败，请检查 API 配置后重试。',
            },
          ]);
        }

        return {
          taskId,
          capabilityId: targetModule.id,
          status: result.status ?? 'failed',
        };
      } catch {
        setTasks((current) =>
          current.map((task) =>
            task.id === taskId
              ? { ...task, state: 'failed', detail: '工作台服务不可用' }
              : task,
          ),
        );
        return {
          taskId,
          capabilityId: targetModule.id,
          status: 'failed',
        };
      }
    },
    [activeId, modules],
  );

  useEffect(() => {
    const context = (document as AgentAwareDocument).modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const registrationOptions = { signal: lifecycle.signal };
    const registrations = [
      context.registerTool(
        {
          name: 'list_workbench_capabilities',
          title: '列出 2D 工作台能力',
          description:
            '读取当前页面可用的 2D 游戏生产能力及其用途，不改变页面状态。',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: false,
          },
          execute: () => ({
            capabilities: modules.map((module) => ({
              id: module.id,
              name: module.name,
              description: module.description,
              features: module.capabilities,
            })),
          }),
        },
        registrationOptions,
      ),
      context.registerTool(
        {
          name: 'start_workbench_task',
          title: '启动 2D 工作台任务',
          description:
            '使用指定能力启动一个可见的工作台任务，并把它加入页面任务队列。',
          inputSchema: {
            type: 'object',
            properties: {
              capabilityId: {
                type: 'string',
                enum: modules.map((module) => module.id),
              },
              instruction: { type: 'string', minLength: 1 },
            },
            required: ['capabilityId', 'instruction'],
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: false,
            untrustedContentHint: false,
          },
          execute: (input) => {
            if (!input || typeof input !== 'object' || Array.isArray(input)) {
              throw new Error('输入必须是对象。');
            }
            const values = input as Record<string, unknown>;
            if (
              typeof values.capabilityId !== 'string' ||
              typeof values.instruction !== 'string'
            ) {
              throw new Error('capabilityId 和 instruction 必须是字符串。');
            }
            return startTask(values.instruction, values.capabilityId);
          },
        },
        registrationOptions,
      ),
    ];

    for (const registration of registrations) {
      void Promise.resolve(registration).catch(() => undefined);
    }

    return () => lifecycle.abort();
  }, [modules, startTask]);

  function runPrompt() {
    const trimmed = prompt.trim();
    if (!trimmed || !activeModule) return;
    void startTask(trimmed, activeModule.id);
    setPrompt('');
  }

  return (
    <main className="h-svh overflow-hidden p-2.5 sm:p-3">
      <section className="workbench-frame mx-auto grid h-full max-w-[1800px] grid-rows-[52px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-white/10 bg-[#0b0d12]/96 shadow-2xl shadow-black/40">
        <header className="flex items-center justify-between border-b border-white/8 px-3.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="size-2.5 rounded-full bg-[#ff675c]" />
              <span className="size-2.5 rounded-full bg-[#f6bf4f]" />
              <span className="size-2.5 rounded-full bg-[#32c96b]" />
            </div>
            <div className="hidden h-5 w-px bg-white/10 sm:block" />
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-violet-300/20 bg-violet-500/14 text-violet-200">
                <WandSparkles className="size-4" />
              </div>
              <span className="truncate text-sm font-semibold tracking-[-0.01em] text-white/92">
                2D Game Dev Workbench
              </span>
              <Badge
                variant="outline"
                className="hidden h-5 border-emerald-300/20 bg-emerald-400/7 px-1.5 text-[11px] font-normal text-emerald-200 sm:inline-flex"
              >
                Client bridge ready
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-white/45">
            <div className="hidden items-center gap-1.5 rounded-md border border-white/8 bg-white/[0.025] px-2 py-1.5 md:flex">
              <GitBranch className="size-3.5" />
              <span>main</span>
            </div>
            <Button
              aria-label="打开命令面板"
              variant="ghost"
              size="icon-sm"
              className="text-white/45 hover:bg-white/5 hover:text-white"
            >
              <Command />
            </Button>
            <Button
              aria-label="更多选项"
              variant="ghost"
              size="icon-sm"
              className="text-white/45 hover:bg-white/5 hover:text-white"
            >
              <MoreHorizontal />
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(520px,1fr)_310px]">
          <aside className="hidden min-h-0 flex-col border-r border-white/8 bg-[#0d0f15] lg:flex">
            <div className="p-3">
              <button className="flex h-9 w-full items-center gap-2 rounded-lg border border-white/8 bg-white/[0.025] px-2.5 text-left text-sm text-white/45 transition hover:border-white/15 hover:text-white/70">
                <Search className="size-3.5" />
                <span className="flex-1">搜索能力</span>
                <kbd className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-white/35">
                  ⌘K
                </kbd>
              </button>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-2">
              <nav aria-label="工作台导航" className="space-y-5 pb-5">
                <div>
                  <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-white/28">
                    Workspace
                  </p>
                  <button className="nav-item w-full bg-white/[0.045] text-white/88">
                    <LayoutDashboard className="size-4 text-white/55" />
                    <span>任务控制台</span>
                  </button>
                  <button className="nav-item w-full text-white/48">
                    <FolderOpen className="size-4" />
                    <span>项目资产</span>
                    <span className="ml-auto text-[11px] text-white/25">
                      12
                    </span>
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between px-2 pb-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/28">
                      Capabilities
                    </p>
                    <Plus className="size-3.5 text-white/25" />
                  </div>
                  <div className="space-y-0.5">
                    {modules.map((module) => (
                      <button
                        key={module.id}
                        type="button"
                        onClick={() => setActiveId(module.id)}
                        className={cn(
                          'nav-item group w-full text-white/48',
                          module.id === activeId &&
                            'bg-white/[0.055] text-white/92 before:absolute before:left-0 before:h-5 before:w-0.5 before:rounded-full before:bg-violet-400',
                        )}
                      >
                        <ModuleIcon
                          icon={module.icon}
                          className={cn(
                            'size-4 transition-colors',
                            module.id === activeId
                              ? module.accent === 'violet'
                                ? 'text-violet-300'
                                : 'text-cyan-300'
                              : 'text-white/38 group-hover:text-white/65',
                          )}
                        />
                        <span className="truncate">{module.shortName}</span>
                        <span
                          className={cn(
                            'ml-auto size-1.5 rounded-full',
                            module.accent === 'violet'
                              ? 'bg-violet-400'
                              : 'bg-cyan-400',
                          )}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-white/28">
                    Runtime
                  </p>
                  <button className="nav-item w-full text-white/48">
                    <TerminalSquare className="size-4" />
                    <span>运行记录</span>
                  </button>
                  <button className="nav-item w-full text-white/48">
                    <Box className="size-4" />
                    <span>API 连接器</span>
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-300/65">
                      <span className="size-1.5 rounded-full bg-emerald-400" />2
                    </span>
                  </button>
                </div>
              </nav>
            </ScrollArea>

            <div className="border-t border-white/8 p-2">
              <button className="nav-item w-full text-white/45">
                <Settings2 className="size-4" />
                <span>工作台设置</span>
              </button>
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col bg-[#0a0c11]">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/8 px-4 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                {activeModule ? (
                  <div
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg border',
                      activeModule.accent === 'violet'
                        ? 'border-violet-300/20 bg-violet-500/12 text-violet-200'
                        : 'border-cyan-300/20 bg-cyan-500/10 text-cyan-200',
                    )}
                  >
                    <ModuleIcon icon={activeModule.icon} className="size-4" />
                  </div>
                ) : null}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-sm font-semibold text-white/92">
                      {activeModule?.name ?? '任务控制台'}
                    </h1>
                    <ChevronDown className="size-3.5 text-white/28" />
                  </div>
                  <p className="truncate text-xs text-white/35">
                    外部主 Agent · MCP / CLI 已就绪
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (prompt.trim()) runPrompt();
                    else setPrompt(ideas[0] ?? '');
                  }}
                  className="hidden border-white/10 bg-white/[0.025] text-white/55 hover:bg-white/5 hover:text-white md:inline-flex"
                >
                  <Play className="size-3.5" />
                  直接运行
                </Button>
                <Button
                  aria-label="切换上下文面板"
                  variant="ghost"
                  size="icon-sm"
                  className="text-white/38 hover:bg-white/5 hover:text-white xl:hidden"
                >
                  <PanelRight />
                </Button>
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-7 sm:px-8 sm:py-9">
                <div className="mb-8 flex items-center gap-3 text-xs text-white/28">
                  <span className="h-px flex-1 bg-white/7" />
                  <span>今天 · 当前项目</span>
                  <span className="h-px flex-1 bg-white/7" />
                </div>

                <section className="mb-7 flex flex-col gap-3 rounded-xl border border-cyan-300/12 bg-cyan-400/[0.035] p-3.5 sm:flex-row sm:items-center">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/18 bg-cyan-400/8 text-cyan-200">
                    <TerminalSquare className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white/78">
                      主 Agent 在外部客户端运行
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-white/38">
                      WorkBuddy、Codex 等客户端从项目对话通过 MCP 或 CLI
                      调用；本页负责人工直调与任务监控。
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="w-fit border-cyan-300/18 bg-cyan-400/6 text-[10px] font-normal text-cyan-200/75"
                  >
                    MCP STDIO
                  </Badge>
                </section>

                <div className="space-y-7">
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={cn(
                        'flex gap-3.5',
                        message.role === 'user' && 'justify-end',
                      )}
                    >
                      {message.role === 'workbench' ? (
                        <div className="agent-avatar mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-500/12 text-violet-200">
                          <TerminalSquare className="size-4" />
                        </div>
                      ) : null}
                      <div
                        className={cn(
                          'max-w-[82%] text-[15px] leading-6',
                          message.role === 'workbench'
                            ? 'text-white/72'
                            : 'rounded-2xl rounded-tr-md border border-white/9 bg-white/[0.045] px-4 py-2.5 text-white/82',
                        )}
                      >
                        {message.content}
                      </div>
                    </article>
                  ))}
                </div>

                {messages.length === 1 ? (
                  <div className="mt-8 pl-0 sm:pl-11">
                    <p className="mb-2.5 text-xs font-medium text-white/34">
                      可以从这里开始
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {ideas.map((idea) => (
                        <button
                          key={idea}
                          type="button"
                          onClick={() => setPrompt(idea)}
                          className="group rounded-xl border border-white/8 bg-white/[0.018] p-3 text-left text-sm leading-5 text-white/52 transition hover:border-violet-300/25 hover:bg-violet-400/[0.045] hover:text-white/78"
                        >
                          <Sparkles className="mb-2 size-3.5 text-violet-300/65 transition group-hover:text-violet-200" />
                          {idea}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex-1" />
              </div>
            </ScrollArea>

            <div className="shrink-0 px-3 pb-3 sm:px-5 sm:pb-5">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  runPrompt();
                }}
                className="composer-glow mx-auto max-w-3xl rounded-2xl border border-white/11 bg-[#11141c] p-2 shadow-xl shadow-black/30"
              >
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      runPrompt();
                    }
                  }}
                  placeholder={`直接向${activeModule?.shortName ?? '工作台'}提交任务…`}
                  aria-label="直接提交工作台任务"
                  className="min-h-[66px] resize-none border-0 bg-transparent px-2.5 py-2 text-[15px] leading-6 text-white/85 shadow-none placeholder:text-white/25 focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
                />
                <div className="flex items-center justify-between gap-2 px-1 pt-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="添加项目文件"
                      className="text-white/38 hover:bg-white/6 hover:text-white"
                    >
                      <Plus />
                    </Button>
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-white/38 transition hover:bg-white/5 hover:text-white/62"
                    >
                      <ModuleIcon
                        icon={activeModule?.icon ?? 'frames'}
                        className="size-3.5 shrink-0"
                      />
                      <span className="truncate">
                        {activeModule?.shortName}
                      </span>
                      <ChevronDown className="size-3" />
                    </button>
                  </div>
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!prompt.trim()}
                    aria-label="发送并运行"
                    className="rounded-xl bg-violet-500 text-white shadow-lg shadow-violet-950/40 hover:bg-violet-400"
                  >
                    <ArrowUp />
                  </Button>
                </div>
              </form>
              <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-white/22">
                人工直调会校验输入；主 Agent 请在外部客户端的项目对话中使用
              </p>
            </div>
          </section>

          <aside className="hidden min-h-0 flex-col border-l border-white/8 bg-[#0d0f15] xl:flex">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/8 px-4">
              <div>
                <h2 className="text-sm font-medium text-white/78">
                  运行上下文
                </h2>
                <p className="text-[11px] text-white/30">项目状态与任务产物</p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="上下文面板选项"
                className="text-white/35 hover:bg-white/5 hover:text-white"
              >
                <MoreHorizontal />
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-5 p-3.5">
                <section>
                  <div className="mb-2.5 flex items-center justify-between px-0.5">
                    <h3 className="text-xs font-medium text-white/48">
                      当前能力
                    </h3>
                    <Badge
                      variant="outline"
                      className="h-5 border-white/8 bg-white/[0.025] text-[10px] font-normal text-white/38"
                    >
                      可替换适配器
                    </Badge>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/[0.022] p-3.5">
                    <div className="mb-3 flex items-start gap-3">
                      <div
                        className={cn(
                          'flex size-9 items-center justify-center rounded-xl border',
                          activeModule?.accent === 'cyan'
                            ? 'border-cyan-300/20 bg-cyan-400/8 text-cyan-200'
                            : 'border-violet-300/20 bg-violet-400/9 text-violet-200',
                        )}
                      >
                        <ModuleIcon
                          icon={activeModule?.icon ?? 'frames'}
                          className="size-4"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white/82">
                          {activeModule?.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-emerald-300/60">
                          ● manifest 已载入
                        </p>
                      </div>
                    </div>
                    <p className="text-xs leading-5 text-white/40">
                      {activeModule?.description}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {activeModule?.capabilities.map((capability) => (
                        <span
                          key={capability}
                          className="rounded-md border border-white/7 bg-black/15 px-1.5 py-1 text-[10px] text-white/36"
                        >
                          {capability}
                        </span>
                      ))}
                    </div>
                  </div>
                </section>

                <section>
                  <div className="mb-2.5 flex items-center justify-between px-0.5">
                    <h3 className="text-xs font-medium text-white/48">
                      能力资产
                    </h3>
                    <span className="text-[10px] text-white/24">
                      共享给 Agent 客户端
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.018]">
                    {capabilityAssets.map((asset, index) => (
                      <div
                        key={asset.name}
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-2.5',
                          index > 0 && 'border-t border-white/7',
                        )}
                      >
                        <span
                          className={cn(
                            'size-1.5 rounded-full',
                            asset.state === 'ready'
                              ? 'bg-emerald-400'
                              : 'bg-amber-300',
                          )}
                        />
                        <span className="w-[72px] text-[11px] font-medium text-white/56">
                          {asset.name}
                        </span>
                        <span className="truncate text-[10px] text-white/28">
                          {asset.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="mb-2.5 flex items-center justify-between px-0.5">
                    <h3 className="text-xs font-medium text-white/48">
                      任务队列
                    </h3>
                    <span className="text-[11px] tabular-nums text-white/26">
                      {tasks.length} 项
                    </span>
                  </div>
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-xl border border-white/8 bg-white/[0.018] p-3"
                      >
                        <div className="flex items-start gap-2.5">
                          <StatusMark state={task.state} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs font-medium text-white/68">
                                {task.name}
                              </p>
                              <span className="text-[10px] tabular-nums text-white/22">
                                {task.id}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[10px] text-white/28">
                              {task.detail}
                            </p>
                          </div>
                        </div>
                        {task.state === 'running' ? (
                          <Progress
                            value={task.progress}
                            className="mt-3 gap-1.5"
                          >
                            <ProgressLabel className="text-[10px] font-normal text-white/30">
                              处理中
                            </ProgressLabel>
                            <ProgressValue className="text-[10px] text-white/26" />
                          </Progress>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2.5 px-0.5 text-xs font-medium text-white/48">
                    最近产物
                  </h3>
                  <button className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/[0.018] p-3 text-left transition hover:border-white/14 hover:bg-white/[0.03]">
                    <div className="pixel-thumb flex size-10 items-center justify-center rounded-lg border border-violet-300/12 bg-violet-500/7">
                      <FileImage className="size-4 text-violet-200/65" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-white/62">
                        示例 · knight_idle_sheet.png
                      </p>
                      <p className="mt-0.5 text-[10px] text-white/25">
                        256 × 32 · 18 KB
                      </p>
                    </div>
                    <ChevronDown className="size-3.5 -rotate-90 text-white/25" />
                  </button>
                </section>
              </div>
            </ScrollArea>
          </aside>
        </div>
      </section>
    </main>
  );
}
