'use client';
/* oxlint-disable next/no-html-link-for-pages -- Native navigation is saved and guarded by WorkbenchProvider. */
import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Box,
  ChevronRight,
  CircleHelp,
  Cpu,
  ExternalLink,
  Layers3,
  LoaderCircle,
  Save,
  Settings2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useWorkbench } from './workbench-provider';
import { workStateLabels, type WorkItem } from '@/lib/workbench/work-items';
import { ModuleIcon } from './module-icon';

const GUIDE_KEY = 'workbench.onboarding.v1';
type Guide = { step: number; line: string; dismissed: boolean };
const initialGuide: Guide = { step: 0, line: 'player', dismissed: false };
function loadGuide(): Guide {
  try {
    const value = JSON.parse(localStorage.getItem(GUIDE_KEY) || 'null');
    return value &&
      Number.isInteger(value.step) &&
      value.step >= 0 &&
      value.step <= 2 &&
      typeof value.line === 'string'
      ? value
      : initialGuide;
  } catch {
    return initialGuide;
  }
}
function saveGuide(guide: Guide) {
  try {
    localStorage.setItem(GUIDE_KEY, JSON.stringify(guide));
  } catch {
    /* Optional device preference. */
  }
}
function reopenGuide(open: (value: boolean) => void) {
  window.dispatchEvent(new Event('workbench:restart-guide'));
  open(true);
}

export function WorkbenchChrome({ children }: { children: ReactNode }) {
  const wb = useWorkbench();
  const capabilityModule = wb.modules.find((m) => wb.pathname === m.href);
  const line = wb.lines.find((l) => l.id === capabilityModule?.productionLine);
  const session = wb.sessions.find(
    (s) => s.capabilityId === capabilityModule?.id,
  );
  const active = session?.items[0];
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!session) return;
    setSaving(true);
    try {
      await session.save();
      wb.setNavigationError('');
    } catch (error) {
      wb.setNavigationError(
        error instanceof Error ? error.message : '保存失败，请下载源文件。',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="wb-app">
      <header className="wb-header">
        <a className="wb-brand" href="/" aria-label="返回开始页">
          <span className="wb-brandmark">2D</span>
          <span>
            <strong>2D Game Dev Workbench</strong>
            <small>游戏资产生产工作台</small>
          </span>
        </a>
        <nav className="wb-nav" aria-label="工作台导航">
          <a href="/" aria-current={wb.pathname === '/' ? 'page' : undefined}>
            开始
          </a>
          {wb.lines.map((l) => (
            <a
              key={l.id}
              href={l.href}
              data-accent={l.accent}
              aria-current={
                line?.id === l.id || wb.pathname === l.href ? 'page' : undefined
              }
            >
              {l.name}
            </a>
          ))}
        </nav>
        <div className="wb-header-actions">
          <button
            className="wb-button wb-ghost"
            aria-label="新手引导"
            onClick={() => reopenGuide(wb.setGuideOpen)}
          >
            <CircleHelp size={16} />
            <span>新手引导</span>
          </button>
          <a
            className="wb-button wb-ghost"
            href="/advanced"
            aria-label="设置与任务详情"
          >
            <Settings2 size={17} />
            <span>高级工具</span>
          </a>
        </div>
      </header>
      {capabilityModule && (
        <section
          className="wb-tool-context"
          data-accent={capabilityModule.accent}
          aria-label="当前作品与制作记录"
        >
          <div className="wb-context-title">
            <div className="wb-breadcrumb">
              <a href="/">开始</a>
              <ChevronRight size={12} />
              <a href={line?.href || '/'}>{line?.name}</a>
              <ChevronRight size={12} />
              <span>{capabilityModule.entryTitle}</span>
            </div>
            {active && (
              <div className="wb-current-work">
                <span className="wb-muted">当前任务</span>
                <strong title={active.title}>{active.title}</strong>
                <span className="wb-state" data-state={active.state}>
                  <i />
                  {active.detail}
                </span>
              </div>
            )}
          </div>
          <div className="wb-context-actions">
            {session &&
              (capabilityModule.id === 'sprite-generator' ? (
                <span className="wb-muted">任务与素材自动保存在本机</span>
              ) : (
                <>
                  <span className="wb-muted">
                    {session.dirty
                      ? '正在保存修改…'
                      : active?.savedAt
                        ? '本机草稿已保存'
                        : '准备素材'}
                  </span>
                  <button
                    className="wb-button"
                    disabled={saving || !session.items.length}
                    onClick={() => void save()}
                  >
                    {saving ? (
                      <LoaderCircle size={14} className="wb-spin" />
                    ) : (
                      <Save size={14} />
                    )}
                    保存草稿
                  </button>
                </>
              ))}
            <button
              className="wb-button"
              onClick={() => wb.setQueueOpen(true)}
              aria-haspopup="dialog"
            >
              <Layers3 size={15} />
              制作记录
            </button>
            {capabilityModule.productionLine === 'scene' && (
              <a className="wb-button wb-ghost" href="/scene">
                场景流程
                <ArrowRight size={14} />
              </a>
            )}
          </div>
        </section>
      )}
      {(wb.navigationError || wb.storageError) && (
        <div className="wb-alert" role="alert">
          {wb.navigationError || wb.storageError}
          <button
            className="wb-button wb-ghost"
            onClick={() => wb.setNavigationError('')}
          >
            知道了
          </button>
        </div>
      )}
      <div
        className="wb-route"
        data-tool={Boolean(capabilityModule) || wb.pathname.includes('/tools/')}
      >
        {children}
      </div>
      <ProductionStatus />
      <Onboarding />
    </div>
  );
}

export function WorkItemRow({ item }: { item: WorkItem }) {
  const wb = useWorkbench();
  const capabilityModule = wb.modules.find((m) => m.id === item.capabilityId);
  return (
    <article className="wb-work-row">
      <span className="wb-work-icon" data-accent={capabilityModule?.accent}>
        {capabilityModule ? (
          <ModuleIcon icon={capabilityModule.icon} className="size-5" />
        ) : (
          <Box size={20} />
        )}
      </span>
      <div className="wb-work-copy">
        <strong>{item.title}</strong>
        <span>
          {capabilityModule?.entryTitle} · {item.detail}
        </span>
        <small>
          {item.savedAt
            ? `草稿保存于 ${formatTime(item.savedAt)}`
            : `更新于 ${formatTime(item.updatedAt)}`}
        </small>
      </div>
      <span className="wb-state" data-state={item.state}>
        <i />
        {workStateLabels[item.state]}
      </span>
      <a className="wb-button" href={item.href}>
        {item.state === 'attention'
          ? '查看并处理'
          : item.state === 'running'
            ? '查看进度'
            : item.state === 'completed'
              ? '查看作品'
              : '继续制作'}
        <ArrowRight size={14} />
      </a>
      {Boolean(item.outputs?.length) && (
        <details className="wb-output-list">
          <summary>产物 · {item.outputs?.length}</summary>
          {item.outputs?.map((output) => (
            <a
              key={output}
              href={`/api/workbench/artifacts?path=${encodeURIComponent(output)}`}
              target="_blank"
              rel="noreferrer"
            >
              {output}
              <ExternalLink size={12} />
            </a>
          ))}
        </details>
      )}
    </article>
  );
}

function ProductionStatus() {
  const wb = useWorkbench();
  const [history, setHistory] = useState(false);
  const active = wb.items.filter((item) => item.state !== 'completed');
  const shown = history
    ? wb.items.filter((item) => item.state === 'completed')
    : active;
  const offline =
    wb.runtimeOnline === false ||
    (wb.spriteOnline === false &&
      wb.items.some((i) => i.capabilityId === 'sprite-generator'));
  return (
    <>
      <footer className="wb-status" aria-label="制作状态栏">
        <button
          className="wb-status-heading"
          onClick={() => wb.setQueueOpen(true)}
          aria-expanded={wb.queueOpen}
        >
          <Layers3 size={16} />
          制作中 <span>{active.length}</span>
        </button>
        <div className="wb-status-items">
          {active.length ? (
            active.slice(0, 2).map((item) => (
              <a href={item.href} key={item.id} className="wb-status-item">
                <span className="wb-state" data-state={item.state}>
                  <i />
                </span>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </a>
            ))
          ) : (
            <span className="wb-muted">
              {wb.refreshing && wb.runtimeOnline === null
                ? '正在读取制作记录…'
                : '选择序列帧或场景，开始第一件作品。'}
            </span>
          )}
        </div>
        {offline && (
          <a className="wb-status-offline" href="/advanced">
            状态连接中断
          </a>
        )}
        <button
          className="wb-button wb-ghost"
          onClick={() => wb.setQueueOpen(true)}
          aria-label="展开制作记录"
        >
          展开{wb.items.length > 0 && ` · ${wb.items.length}`}
        </button>
      </footer>
      <Dialog open={wb.queueOpen} onOpenChange={wb.setQueueOpen}>
        <DialogContent className="wb-dialog wb-records-dialog">
          <DialogHeader>
            <DialogTitle>你的制作记录</DialogTitle>
            <DialogDescription>
              返回具体作品，继续编辑、处理问题或查看产物。
            </DialogDescription>
          </DialogHeader>
          <div className="wb-record-tabs">
            <button
              className="wb-button"
              aria-pressed={!history}
              onClick={() => setHistory(false)}
            >
              制作中 · {active.length}
            </button>
            <button
              className="wb-button"
              aria-pressed={history}
              onClick={() => setHistory(true)}
            >
              已完成 · {wb.items.length - active.length}
            </button>
            <button
              className="wb-button wb-ghost"
              onClick={() => void wb.refresh()}
              disabled={wb.refreshing}
            >
              {wb.refreshing ? '刷新中…' : '刷新'}
            </button>
          </div>
          {offline && (
            <output className="wb-notice">
              部分服务暂时无法连接，服务任务显示的是上次读取的状态。本机草稿仍可打开。
            </output>
          )}
          <div className="wb-records">
            {shown.map((item) => (
              <WorkItemRow key={item.id} item={item} />
            ))}
            {!shown.length && (
              <div className="wb-empty">
                <Layers3 size={28} />
                <p>
                  {history
                    ? '完成并导出的作品会出现在这里。'
                    : '还没有正在制作的作品。'}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Onboarding() {
  const wb = useWorkbench();
  const { setGuideOpen } = wb;
  const [guide, setGuide] = useState<Guide>(initialGuide);
  useEffect(() => {
    const stored = loadGuide();
    // oxlint-disable-next-line react/react-compiler -- Hydrate the device-local guide preference after SSR.
    setGuide(stored);
    if (location.pathname === '/' && !stored.dismissed) setGuideOpen(true);
    const restart = () => {
      setGuide(initialGuide);
      saveGuide(initialGuide);
    };
    window.addEventListener('workbench:restart-guide', restart);
    return () => window.removeEventListener('workbench:restart-guide', restart);
  }, [setGuideOpen]);
  const update = (next: Guide) => {
    setGuide(next);
    saveGuide(next);
  };
  const close = () => {
    update({ ...guide, dismissed: true });
    wb.setGuideOpen(false);
  };
  const line = wb.lines.find((l) => l.id === guide.line) || wb.lines[0];
  const modules = wb.modules.filter((m) => m.productionLine === line.id);
  return (
    <Dialog
      open={wb.guideOpen}
      onOpenChange={(open) => {
        if (!open) close();
        else wb.setGuideOpen(true);
      }}
    >
      <DialogContent className="wb-dialog wb-guide-dialog">
        <DialogHeader>
          <div className="wb-eyebrow">
            FIRST PRODUCTION / {guide.step + 1} OF 3
          </div>
          <DialogTitle>
            {
              [
                '先做一件小作品',
                line.id === 'player'
                  ? '先完成一个待机动作'
                  : '先完成一张地图或一个物件',
                '下次，从状态栏继续',
              ][guide.step]
            }
          </DialogTitle>
          <DialogDescription>
            {
              [
                '选一个方向，之后随时可以切换。',
                '准备素材，然后使用工具原有的流程制作。',
                '本机草稿保存成功后，就能从制作记录恢复。',
              ][guide.step]
            }
          </DialogDescription>
        </DialogHeader>
        <div
          className="wb-guide-progress"
          aria-label={`新手引导第 ${guide.step + 1} 步，共 3 步`}
        >
          {[0, 1, 2].map((step) => (
            <span key={step} data-done={step <= guide.step} />
          ))}
        </div>
        {guide.step === 0 && (
          <div className="wb-guide-choices">
            {wb.lines.map((l) => (
              <button
                key={l.id}
                className="wb-guide-choice"
                data-accent={l.accent}
                onClick={() => update({ ...guide, line: l.id, step: 1 })}
              >
                <span className="wb-eyebrow">{l.eyebrow}</span>
                <strong>{l.name}</strong>
                <span>{l.description}</span>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
        )}
        {guide.step === 1 && (
          <div className="wb-guide-materials">
            {modules.map((capabilityModule) => (
              <div key={capabilityModule.id}>
                <ModuleIcon icon={capabilityModule.icon} className="size-5" />
                <div>
                  <strong>{capabilityModule.entryTitle}</strong>
                  <p>{capabilityModule.starterHint}</p>
                  <span className="wb-muted">
                    {capabilityModule.stages.join(' → ')}
                  </span>
                </div>
              </div>
            ))}
            <p className="wb-muted">
              需要连接图片生成服务时，工具会显示相应的配置提示。
            </p>
          </div>
        )}
        {guide.step === 2 && (
          <div className="wb-guide-materials">
            <div>
              <Save size={22} />
              <div>
                <strong>保存成功，才会显示可恢复</strong>
                <p>
                  地图和交互物保存在当前浏览器。源文件仍可在原工具中导出备份。
                </p>
              </div>
            </div>
            <div>
              <Layers3 size={22} />
              <div>
                <strong>制作中 → 找到作品 → 继续制作</strong>
                <p>序列帧作业由本地服务保存；需要处理的问题会单独标出。</p>
              </div>
            </div>
          </div>
        )}
        <div className="wb-guide-actions">
          <button className="wb-button wb-ghost" onClick={close}>
            跳过引导
          </button>
          {guide.step > 0 && (
            <button
              className="wb-button"
              onClick={() => update({ ...guide, step: guide.step - 1 })}
            >
              上一步
            </button>
          )}
          {guide.step === 1 && (
            <button
              className="wb-button wb-primary"
              onClick={() => update({ ...guide, step: 2 })}
            >
              下一步
              <ArrowRight size={15} />
            </button>
          )}
          {guide.step === 2 && (
            <button
              className="wb-button wb-primary"
              onClick={() => {
                close();
                void wb.navigate(line.href);
              }}
            >
              开始制作{line.name}
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WorkbenchAdvanced() {
  const wb = useWorkbench();
  const [selected, setSelected] = useState('');
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- Hydrate a browser URL selection after SSR.
    setSelected(new URLSearchParams(location.search).get('task') || '');
  }, []);
  const task = wb.tasks.find((t) => t.id === selected) || wb.tasks[0];
  return (
    <main className="wb-page wb-advanced">
      <div className="wb-page-heading">
        <div>
          <div className="wb-eyebrow">WORKBENCH / ADVANCED</div>
          <h1>设置与任务详情</h1>
          <p>查看服务连接、执行记录和产物路径。</p>
        </div>
        <button
          className="wb-button"
          onClick={() => void wb.refresh()}
          disabled={wb.refreshing}
        >
          {wb.refreshing ? '刷新中…' : '刷新状态'}
        </button>
      </div>
      <div className="wb-connections">
        <span>
          <Cpu size={16} />
          任务服务 · {connectionLabel(wb.runtimeOnline)}
        </span>
        <span>
          <Layers3 size={16} />
          序列帧服务 · {connectionLabel(wb.spriteOnline)}
        </span>
        <button
          className="wb-button wb-ghost"
          onClick={() => reopenGuide(wb.setGuideOpen)}
        >
          重新查看引导
        </button>
      </div>
      <div className="wb-tool-links">
        {wb.modules.map((m) => (
          <a className="wb-button" key={m.id} href={m.href}>
            {m.name}
            <ArrowRight size={14} />
          </a>
        ))}
      </div>
      <p className="wb-notice">
        图片服务在对应工具中配置。Agent 可继续通过 MCP、CLI
        或浏览器工具使用工作台。
      </p>
      <div className="wb-task-layout">
        <section aria-label="执行记录">
          <h2>执行记录</h2>
          {wb.tasks.map((t) => (
            <button
              className="wb-task-button"
              key={t.id}
              aria-pressed={task?.id === t.id}
              onClick={() => setSelected(t.id)}
            >
              <strong>
                {wb.modules.find((m) => m.id === t.capabilityId)?.shortName} ·{' '}
                {typeof t.input?.operation === 'string'
                  ? t.input.operation
                  : '任务'}
              </strong>
              <span>
                {t.status} · {formatTime(t.updatedAt)}
              </span>
              <small>{t.id}</small>
            </button>
          ))}
          {!wb.tasks.length && (
            <p className="wb-muted">
              {wb.runtimeOnline === false
                ? '任务服务未连接，记录暂不可读取。'
                : '尚无后台执行记录。'}
            </p>
          )}
        </section>
        <section className="wb-task-detail" aria-label="任务详情">
          <h2>任务详情</h2>
          {task ? (
            <>
              <code>{task.id}</code>
              <p>{task.error || task.refreshError || task.status}</p>
              {task.requiredEnvironment && (
                <p className="wb-notice">
                  需要配置：{task.requiredEnvironment}
                </p>
              )}
              <h3>输入</h3>
              <pre>{JSON.stringify(task.input || {}, null, 2)}</pre>
              <h3>产物</h3>
              {task.outputs?.map((output) => (
                <a
                  className="wb-artifact"
                  key={output}
                  href={`/api/workbench/artifacts?path=${encodeURIComponent(output)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {output}
                  <ExternalLink size={14} />
                </a>
              ))}
              {!task.outputs?.length && <p className="wb-muted">尚无产物。</p>}
            </>
          ) : (
            <p className="wb-muted">选择一条执行记录查看详情。</p>
          )}
        </section>
      </div>
    </main>
  );
}
function connectionLabel(value: boolean | null) {
  return value === null ? '正在读取' : value ? '已连接' : '未连接';
}
function formatTime(value?: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '时间未记录';
}
