'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  CircleDot,
  CircleAlert,
  CircleX,
  Clock3,
  Command,
  FileImage,
  FolderOpen,
  GitBranch,
  Hand,
  LayoutDashboard,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  TerminalSquare,
  WandSparkles,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { WorkbenchModule } from '@/lib/workbench/modules';
import { ModuleIcon } from './module-icon';

type WorkbenchShellProps = {
  modules: readonly WorkbenchModule[];
};

type TaskState = 'running' | 'complete' | 'waiting' | 'failed';

type Task = {
  id: string;
  capabilityId: string;
  name: string;
  operation: string;
  detail: string;
  state: TaskState;
  status: string;
  input: Record<string, unknown>;
  outputs: string[];
  createdAt?: string;
  updatedAt?: string;
  requiredEnvironment?: string;
};

type StoredTask = {
  id: string;
  capabilityId: string;
  status: string;
  input?: Record<string, unknown>;
  outputs?: string[];
  error?: string;
  refreshError?: string;
  requiredEnvironment?: string;
  createdAt?: string;
  updatedAt?: string;
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

const manualWork: Record<string, string[]> = {
  'sprite-generator': [
    '逐帧审看动作连续性与角色一致性',
    '像素级修补、候选帧取舍与冲突处理',
    '播放确认并决定最终精灵表导出',
  ],
  'map-stitcher': [
    '画布位置、重叠和羽化参数微调',
    '遮挡、碰撞、调节与顶部区域绘制',
    '图层检查以及 Godot / Unity 最终交付确认',
  ],
};

const capabilityAssets = [
  { name: 'MCP', detail: '5 个外部 Agent 工具', state: 'ready' },
  { name: 'CLI', detail: '无 MCP 客户端回退', state: 'ready' },
  { name: 'Adapter', detail: '2 个本地协议适配器', state: 'ready' },
  { name: 'Manifest', detail: '统一能力与输入约束', state: 'ready' },
  { name: 'Task ledger', detail: '任务与产物共享记录', state: 'ready' },
] as const;

function storedTaskView(
  task: StoredTask,
  modules: readonly WorkbenchModule[],
): Task {
  const capabilityModule = modules.find(
    (candidate) => candidate.id === task.capabilityId,
  );
  const operation =
    typeof task.input?.operation === 'string' ? task.input.operation : 'task';
  const state: TaskState =
    task.status === 'completed'
      ? 'complete'
      : task.status === 'failed'
        ? 'failed'
        : task.status === 'running'
          ? 'running'
          : 'waiting';
  const statusLabel: Record<TaskState, string> = {
    complete: '已完成',
    failed: '失败',
    running: '运行中',
    waiting:
      task.status === 'awaiting_configuration'
        ? '等待外部服务配置'
        : '需要处理',
  };
  return {
    id: task.id,
    capabilityId: task.capabilityId,
    name: `${capabilityModule?.shortName ?? task.capabilityId} · ${operation}`,
    operation,
    detail:
      task.error ??
      task.refreshError ??
      `${statusLabel[state]}${task.requiredEnvironment ? ` · ${task.requiredEnvironment}` : ''}`,
    state,
    status: task.status,
    input: task.input ?? {},
    outputs: Array.isArray(task.outputs) ? task.outputs : [],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    requiredEnvironment: task.requiredEnvironment,
  };
}

function taskStateLabel(task: Task) {
  if (task.state === 'complete') return '已完成';
  if (task.state === 'running') return '运行中';
  if (task.state === 'failed') return '失败';
  if (task.status === 'awaiting_configuration') return '等待配置';
  if (task.status === 'prepared') return '已准备';
  return '等待人工处理';
}

function formatTaskTime(value?: string) {
  if (!value) return '时间未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function taskInputPreview(input: Record<string, unknown>) {
  const serialized = JSON.stringify(input, null, 2);
  return serialized.length > 1600
    ? `${serialized.slice(0, 1600)}\n…`
    : serialized;
}

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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [runtimeOnline, setRuntimeOnline] = useState(false);

  const activeModule = useMemo(
    () => modules.find((module) => module.id === activeId) ?? modules[0],
    [activeId, modules],
  );

  const activeTasks = useMemo(
    () => tasks.filter((task) => task.capabilityId === activeId),
    [activeId, tasks],
  );
  const selectedTask = useMemo(
    () =>
      activeTasks.find((task) => task.id === selectedTaskId) ??
      activeTasks[0] ??
      null,
    [activeTasks, selectedTaskId],
  );
  const taskSummary = useMemo(
    () => ({
      running: tasks.filter((task) => task.state === 'running').length,
      attention: tasks.filter(
        (task) => task.state === 'waiting' || task.state === 'failed',
      ).length,
      complete: tasks.filter((task) => task.state === 'complete').length,
    }),
    [tasks],
  );
  const manualItems = activeModule ? (manualWork[activeModule.id] ?? []) : [];
  const recentOutputs = useMemo(
    () =>
      tasks
        .flatMap((task) =>
          task.outputs.map((output) => ({ taskId: task.id, output })),
        )
        .slice(0, 5),
    [tasks],
  );

  const refreshTasks = useCallback(async () => {
    try {
      const response = await fetch(
        '/api/workbench/tasks?limit=30&refresh=true',
        {
          cache: 'no-store',
        },
      );
      setRuntimeOnline(response.ok);
      if (!response.ok) return;
      const payload = (await response.json()) as { tasks?: StoredTask[] };
      if (Array.isArray(payload.tasks)) {
        const nextTasks = payload.tasks.map((task) =>
          storedTaskView(task, modules),
        );
        setTasks(nextTasks);
        setSelectedTaskId((current) =>
          current && nextTasks.some((task) => task.id === current)
            ? current
            : (nextTasks[0]?.id ?? null),
        );
      }
    } catch {
      setRuntimeOnline(false);
    }
  }, [modules]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const sync = async () => {
      if (cancelled) return;
      await refreshTasks().catch(() => undefined);
      if (!cancelled) timer = window.setTimeout(() => void sync(), 3_000);
    };
    void sync();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refreshTasks]);

  const startTask = useCallback(
    async (input: Record<string, unknown>, requestedModuleId = activeId) => {
      const targetModule = modules.find(
        (module) => module.id === requestedModuleId,
      );
      if (!targetModule) throw new Error(`未找到能力：${requestedModuleId}`);

      const operation =
        typeof input.operation === 'string' ? input.operation : 'task';
      const taskId = `pending-${crypto.randomUUID().slice(0, 8)}`;
      const startedAt = new Date().toISOString();
      const nextTask: Task = {
        id: taskId,
        capabilityId: targetModule.id,
        name: `${targetModule.shortName} · ${operation}`,
        operation,
        detail: '正在校验并交给本地适配器',
        state: 'running',
        status: 'running',
        input,
        outputs: [],
        createdAt: startedAt,
        updatedAt: startedAt,
      };

      setActiveId(targetModule.id);
      setSelectedTaskId(taskId);
      setTasks((current) => [nextTask, ...current]);

      try {
        const response = await fetch('/api/workbench/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            capabilityId: targetModule.id,
            input,
          }),
        });
        const result = (await response.json()) as {
          taskId?: string;
          status?: string;
          outputs?: string[];
          requiredEnvironment?: string;
          error?: string;
        };
        const stored: StoredTask = {
          id: result.taskId ?? taskId,
          capabilityId: targetModule.id,
          status: response.ok ? (result.status ?? 'failed') : 'failed',
          input,
          outputs: result.outputs,
          error: result.error,
          requiredEnvironment: result.requiredEnvironment,
          createdAt: startedAt,
          updatedAt: new Date().toISOString(),
        };
        const view = storedTaskView(stored, modules);
        setTasks((current) =>
          current.map((task) => (task.id === taskId ? view : task)),
        );
        setSelectedTaskId(result.taskId ?? taskId);

        window.setTimeout(
          () => void refreshTasks().catch(() => undefined),
          150,
        );

        return {
          taskId: result.taskId ?? taskId,
          capabilityId: targetModule.id,
          status: result.status ?? 'failed',
          outputs: result.outputs ?? [],
        };
      } catch (error) {
        setTasks((current) =>
          current.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  state: 'failed',
                  status: 'failed',
                  detail:
                    error instanceof Error ? error.message : '工作台服务不可用',
                  updatedAt: new Date().toISOString(),
                }
              : task,
          ),
        );
        return {
          taskId,
          capabilityId: targetModule.id,
          status: 'failed',
          outputs: [],
        };
      }
    },
    [activeId, modules, refreshTasks],
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
              input: {
                type: 'object',
                description:
                  '必须符合该能力在 workbench/manifest.json 中声明的 inputSchema。',
              },
            },
            required: ['capabilityId', 'input'],
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
              !values.input ||
              typeof values.input !== 'object' ||
              Array.isArray(values.input)
            ) {
              throw new Error('capabilityId 必须是字符串，input 必须是对象。');
            }
            return startTask(
              values.input as Record<string, unknown>,
              values.capabilityId,
            );
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
                className={cn(
                  'hidden h-5 px-1.5 text-[11px] font-normal sm:inline-flex',
                  runtimeOnline
                    ? 'border-emerald-300/20 bg-emerald-400/7 text-emerald-200'
                    : 'border-amber-300/20 bg-amber-400/7 text-amber-200',
                )}
              >
                {runtimeOnline
                  ? 'Runtime bridge ready'
                  : 'Runtime bridge offline'}
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
                        onClick={() => {
                          setActiveId(module.id);
                          setSelectedTaskId(
                            tasks.find(
                              (task) => task.capabilityId === module.id,
                            )?.id ?? null,
                          );
                        }}
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
                      任务控制台
                    </h1>
                    <Badge
                      variant="outline"
                      className="hidden h-5 border-white/8 bg-white/[0.025] px-1.5 text-[10px] font-normal text-white/38 sm:inline-flex"
                    >
                      {activeModule?.shortName}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-white/35">
                    外部 Agent 驱动 · 页面负责监控与人工接管
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  aria-label="刷新任务"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void refreshTasks()}
                  className="text-white/38 hover:bg-white/5 hover:text-white"
                >
                  <RefreshCw className="size-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (activeModule) window.location.assign(activeModule.href);
                  }}
                  className="hidden border-white/10 bg-white/[0.025] text-white/55 hover:bg-white/5 hover:text-white sm:inline-flex"
                >
                  <FolderOpen className="size-3.5" />
                  打开人工工作区
                  <ArrowUpRight className="size-3.5" />
                </Button>
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-5 lg:p-6">
                <section className="flex flex-col gap-3 rounded-xl border border-cyan-300/12 bg-cyan-400/[0.035] p-3.5 sm:flex-row sm:items-center">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/18 bg-cyan-400/8 text-cyan-200">
                    <TerminalSquare className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white/78">
                      生产指令来自外部 Agent
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-white/38">
                      WorkBuddy、Codex 等客户端通过 MCP 或 CLI
                      写入任务；本页只呈现真实状态、产物和需要人工判断的步骤。
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="w-fit border-cyan-300/18 bg-cyan-400/6 text-[10px] font-normal text-cyan-200/75"
                  >
                    外部 Agent 通道
                  </Badge>
                </section>

                <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                  <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/36">Runtime</span>
                      <span
                        className={cn(
                          'size-2 rounded-full',
                          runtimeOnline ? 'bg-emerald-400' : 'bg-amber-300',
                        )}
                      />
                    </div>
                    <p className="mt-3 text-lg font-semibold text-white/82">
                      {runtimeOnline ? '在线' : '离线'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/27">
                      任务记录桥接
                    </p>
                  </div>
                  <div className="rounded-xl border border-cyan-300/10 bg-cyan-400/[0.025] p-3.5">
                    <div className="flex items-center justify-between text-xs text-white/36">
                      <span>运行中</span>
                      <Activity className="size-3.5 text-cyan-300/65" />
                    </div>
                    <p className="mt-3 text-lg font-semibold tabular-nums text-white/82">
                      {taskSummary.running}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/27">
                      自动同步状态
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-300/10 bg-amber-400/[0.025] p-3.5">
                    <div className="flex items-center justify-between text-xs text-white/36">
                      <span>需要处理</span>
                      <Hand className="size-3.5 text-amber-300/65" />
                    </div>
                    <p className="mt-3 text-lg font-semibold tabular-nums text-white/82">
                      {taskSummary.attention}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/27">
                      配置、审查或修复
                    </p>
                  </div>
                  <div className="rounded-xl border border-emerald-300/10 bg-emerald-400/[0.025] p-3.5">
                    <div className="flex items-center justify-between text-xs text-white/36">
                      <span>已完成</span>
                      <Check className="size-3.5 text-emerald-300/65" />
                    </div>
                    <p className="mt-3 text-lg font-semibold tabular-nums text-white/82">
                      {taskSummary.complete}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/27">
                      产物已落盘
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.08fr)_minmax(330px,0.92fr)]">
                  <section className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.015]">
                    <div className="flex items-center justify-between border-b border-white/7 px-4 py-3.5">
                      <div>
                        <h2 className="text-sm font-medium text-white/76">
                          {activeModule?.shortName}任务流
                        </h2>
                        <p className="mt-0.5 text-[11px] text-white/28">
                          按最近更新时间排序
                        </p>
                      </div>
                      <span className="text-xs tabular-nums text-white/30">
                        {activeTasks.length} 项
                      </span>
                    </div>
                    <div className="space-y-2 p-3">
                      {activeTasks.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/9 px-4 py-8 text-center">
                          <Activity className="mx-auto size-5 text-white/20" />
                          <p className="mt-3 text-sm text-white/52">
                            等待外部 Agent 创建任务
                          </p>
                          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-white/28">
                            新任务会从 MCP 或 CLI
                            自动进入这里，无需在网页重复输入。
                          </p>
                        </div>
                      ) : null}
                      {activeTasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => setSelectedTaskId(task.id)}
                          className={cn(
                            'w-full rounded-xl border p-3.5 text-left transition',
                            selectedTask?.id === task.id
                              ? 'border-violet-300/25 bg-violet-400/[0.055]'
                              : 'border-white/7 bg-black/10 hover:border-white/13 hover:bg-white/[0.025]',
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <StatusMark state={task.state} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-white/72">
                                    {task.name}
                                  </p>
                                  <p className="mt-1 truncate text-xs text-white/30">
                                    {task.detail}
                                  </p>
                                </div>
                                <span className="shrink-0 rounded-md border border-white/7 bg-black/15 px-1.5 py-1 text-[10px] text-white/35">
                                  {taskStateLabel(task)}
                                </span>
                              </div>
                              <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-white/24">
                                <span className="truncate font-mono">
                                  {task.id}
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                  <Clock3 className="size-3" />
                                  {formatTaskTime(
                                    task.updatedAt ?? task.createdAt,
                                  )}
                                </span>
                              </div>
                              {task.state === 'running' ? (
                                <Progress value={null} className="mt-3 gap-1.5">
                                  <ProgressLabel className="text-[10px] font-normal text-cyan-200/55">
                                    适配器处理中
                                  </ProgressLabel>
                                </Progress>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>

                  <div className="space-y-4">
                    <section className="rounded-xl border border-white/8 bg-white/[0.015]">
                      <div className="flex items-center justify-between border-b border-white/7 px-4 py-3.5">
                        <div>
                          <h2 className="text-sm font-medium text-white/76">
                            任务检查器
                          </h2>
                          <p className="mt-0.5 text-[11px] text-white/28">
                            输入、状态与真实产物
                          </p>
                        </div>
                        {selectedTask ? (
                          <StatusMark state={selectedTask.state} />
                        ) : null}
                      </div>
                      {selectedTask ? (
                        <div className="space-y-4 p-4">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg border border-white/7 bg-black/12 p-2.5">
                              <p className="text-[10px] text-white/26">
                                当前状态
                              </p>
                              <p className="mt-1 text-xs font-medium text-white/65">
                                {taskStateLabel(selectedTask)}
                              </p>
                            </div>
                            <div className="rounded-lg border border-white/7 bg-black/12 p-2.5">
                              <p className="text-[10px] text-white/26">
                                输出文件
                              </p>
                              <p className="mt-1 text-xs font-medium tabular-nums text-white/65">
                                {selectedTask.outputs.length}
                              </p>
                            </div>
                          </div>
                          <div>
                            <p className="mb-2 text-[11px] font-medium text-white/38">
                              任务输入
                            </p>
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-white/7 bg-black/20 p-3 font-mono text-[11px] leading-5 text-white/42">
                              {taskInputPreview(selectedTask.input)}
                            </pre>
                          </div>
                          {selectedTask.requiredEnvironment ? (
                            <div className="rounded-lg border border-amber-300/14 bg-amber-400/[0.035] p-3">
                              <p className="text-xs font-medium text-amber-100/72">
                                等待服务配置
                              </p>
                              <p className="mt-1 break-all font-mono text-[11px] text-amber-100/42">
                                {selectedTask.requiredEnvironment}
                              </p>
                            </div>
                          ) : null}
                          {selectedTask.outputs.length > 0 ? (
                            <div>
                              <p className="mb-2 text-[11px] font-medium text-white/38">
                                任务产物
                              </p>
                              <div className="space-y-1.5">
                                {selectedTask.outputs
                                  .slice(0, 5)
                                  .map((output) => (
                                    <a
                                      key={output}
                                      href={`/api/workbench/artifacts?path=${encodeURIComponent(output)}`}
                                      className="flex items-center gap-2 rounded-lg border border-white/7 bg-black/12 px-2.5 py-2 text-xs text-white/48 transition hover:border-white/14 hover:text-white/72"
                                    >
                                      <FileImage className="size-3.5 shrink-0 text-violet-200/55" />
                                      <span className="min-w-0 flex-1 truncate">
                                        {output.split('/').at(-1)}
                                      </span>
                                      <ArrowUpRight className="size-3 shrink-0" />
                                    </a>
                                  ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="px-4 py-10 text-center text-xs text-white/28">
                          选择一项任务后查看详情。
                        </div>
                      )}
                    </section>

                    <section className="rounded-xl border border-amber-300/10 bg-amber-400/[0.02] p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/16 bg-amber-400/7 text-amber-200">
                          <Hand className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h2 className="text-sm font-medium text-white/74">
                            人工处理台
                          </h2>
                          <p className="mt-0.5 text-[11px] leading-5 text-white/30">
                            只保留需要视觉判断和精细交互的操作。
                          </p>
                        </div>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {manualItems.map((item) => (
                          <li
                            key={item}
                            className="flex items-start gap-2 text-xs leading-5 text-white/42"
                          >
                            <span className="mt-2 size-1 rounded-full bg-amber-300/55" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (activeModule)
                            window.location.assign(activeModule.href);
                        }}
                        className="mt-4 w-full border-amber-300/14 bg-amber-400/[0.035] text-amber-100/65 hover:bg-amber-400/[0.075] hover:text-amber-100"
                      >
                        <FolderOpen className="size-3.5" />
                        打开{activeModule?.shortName}工作区
                      </Button>
                    </section>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </section>

          <aside className="hidden min-h-0 flex-col border-l border-white/8 bg-[#0d0f15] xl:flex">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/8 px-4">
              <div>
                <h2 className="text-sm font-medium text-white/78">
                  项目上下文
                </h2>
                <p className="text-[11px] text-white/30">
                  能力、通道与最近产物
                </p>
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
                      Agent 通道
                    </h3>
                    <span className="text-[10px] text-white/24">外部驱动</span>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.018]">
                    <div className="flex items-center gap-3 p-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/14 bg-cyan-400/6 text-cyan-200/65">
                        <TerminalSquare className="size-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-white/60">
                          MCP / CLI
                        </p>
                        <p className="mt-0.5 text-[10px] text-white/27">
                          任务写入统一运行记录
                        </p>
                      </div>
                      <span className="size-1.5 rounded-full bg-emerald-400" />
                    </div>
                    <div className="border-t border-white/7 px-3 py-2.5 text-[10px] leading-4 text-white/28">
                      网页不提供对话或通用任务输入，只承接监控、审查和精细编辑。
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-2.5 px-0.5 text-xs font-medium text-white/48">
                    最近产物
                  </h3>
                  <div className="space-y-2">
                    {recentOutputs.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-white/8 px-3 py-4 text-xs text-white/28">
                        尚无真实产物。
                      </p>
                    ) : null}
                    {recentOutputs.map(({ taskId, output }) => (
                      <a
                        key={`${taskId}:${output}`}
                        href={`/api/workbench/artifacts?path=${encodeURIComponent(output)}`}
                        className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/[0.018] p-3 text-left transition hover:border-white/14 hover:bg-white/[0.03]"
                      >
                        <div className="pixel-thumb flex size-10 items-center justify-center rounded-lg border border-violet-300/12 bg-violet-500/7">
                          <FileImage className="size-4 text-violet-200/65" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-white/62">
                            {output.split('/').at(-1)}
                          </p>
                          <p className="mt-0.5 truncate text-[10px] text-white/25">
                            {taskId}
                          </p>
                        </div>
                        <ChevronDown className="size-3.5 -rotate-90 text-white/25" />
                      </a>
                    ))}
                  </div>
                </section>
              </div>
            </ScrollArea>
          </aside>
        </div>
      </section>
    </main>
  );
}
