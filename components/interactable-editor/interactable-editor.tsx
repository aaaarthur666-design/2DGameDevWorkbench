/* oxlint-disable next/no-img-element -- User-uploaded local data URLs must retain their original bytes. */
'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import { Box, Plus, Copy, Download, Upload, Save, Trash2 } from 'lucide-react';
import {
  createProject,
  createObject,
  makeId,
  nextClipName,
  KINDS,
  KIND_LABELS,
  TRIGGERS,
  describeError,
  referencedAssets,
  type Asset,
  type Kind,
  type Interactable,
  type InteractableProject,
} from '@/features/interactable-editor/contract.mjs';
import {
  importAsset,
  importProject,
  loadDraft,
  loadTaskProject,
  saveDraft,
  downloadJson,
  exportProject,
  interactableWorkItems,
} from '@/features/interactable-editor/browser-storage';
import {
  publishEditorSession,
  removeEditorSession,
  markEditorSaved,
} from '@/lib/workbench/editor-session';
import { listWorkItems } from '@/lib/workbench/browser-store';
import { isUntouchedStarterProject } from '@/features/interactable-editor/draft-activity';
import { Field, Numeric, Check, BehaviorPanel } from './property-panels';
import { VisualPanel } from './visual-panel';
import { Preview, assetUrl } from './preview';
import './interactable-editor.css';

const triggerLabels = {
  proximity_press: '靠近后按键',
  pointer_click: '鼠标点击',
  automatic_enter: '进入范围自动触发',
  external_request: '外部调用',
};
async function flushPendingDrafts(pass: () => Promise<boolean>) {
  while (await pass()) {
    /* Drain edits made while a previous save was committing. */
  }
}
export function InteractableEditor() {
  const [project, setProjectState] =
      useState<InteractableProject>(createProject),
    [selected, setSelected] = useState(''),
    [exportIds, setExportIds] = useState<string[]>([]),
    [tab, setTab] = useState('visual');
  const [started, setStarted] = useState(false);
  const setProject = useCallback(
    (value: SetStateAction<InteractableProject>) => {
      setStarted(true);
      setProjectState(value);
    },
    [],
  );
  const [message, setMessage] = useState(''),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [draftStatus, setDraftStatus] = useState('正在读取草稿');
  const [result, setResult] = useState<{
    taskId: string;
    status: string;
    outputs: string[];
  } | null>(null);
  const [draftWritable, setDraftWritable] = useState(true);
  const assetInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    framesInput = useRef<HTMLInputElement>(null);
  const current =
    project.objects.find((o) => o.definitionId === selected) ??
    project.objects[0];
  const latest = useRef({ project, ready, draftWritable, busy, started });
  useLayoutEffect(() => {
    latest.current = { project, ready, draftWritable, busy, started };
  });
  const savedProject = useRef<InteractableProject | null>(null);
  const unreadableFallback = useRef<InteractableProject | null>(null);
  const savedAt = useRef('');
  const completedIds = useRef<string[]>([]);
  const writeChain = useRef(Promise.resolve());
  const persist = useCallback((explicit = false) => {
    if (explicit) {
      if (!latest.current.started) savedProject.current = null;
      latest.current = { ...latest.current, started: true };
      setStarted(true);
    }
    return flushPendingDrafts(async () => {
      const value = latest.current;
      if (!value.ready) throw new Error('交互物草稿还在读取，请稍候。');
      if (!value.started) return false;
      if (!value.draftWritable) {
        if (value.project === unreadableFallback.current) return false;
        throw new Error(
          '原草稿暂时无法读取。请先保存当前源文件或导入项目，再离开页面。',
        );
      }
      if (savedProject.current === value.project) return false;
      const writing = writeChain.current
        .catch(() => undefined)
        .then(() => saveDraft(value.project, completedIds.current));
      writeChain.current = writing;
      try {
        await writing;
        savedProject.current = value.project;
        savedAt.current = new Date().toISOString();
        if (latest.current.project !== value.project) return true;
        markEditorSaved('interactable-editor');
        setDraftStatus('草稿已保存');
        return false;
      } catch {
        setDraftStatus('草稿保存失败，请下载源文件');
        throw new Error('交互物草稿保存失败，请保留页面并下载源文件。');
      }
    });
  }, []);
  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams(location.search);
    const taskId = params.get('task');
    (taskId ? loadTaskProject(taskId) : loadDraft(params.get('project') || undefined))
      .then(async (p) => {
        if (!p) {
          if (alive) setDraftStatus('开始编辑后自动保存');
          return;
        }
        const items = await listWorkItems();
        if (alive) {
          const existing = items.find((item) => item.scopeId === p.projectId);
          // Migrate a real legacy draft once; merely restoring a registered draft is clean.
          savedProject.current = existing ? p : null;
          completedIds.current = p.objects
            .filter((object) =>
              items.some(
                (item) =>
                  item.scopeId === p.projectId &&
                  item.state === 'completed' &&
                  item.id.endsWith(`:${object.definitionId}`),
              ),
            )
            .map((object) => object.definitionId);
          savedAt.current = existing?.savedAt || '';
          setStarted(Boolean(existing) || !isUntouchedStarterProject(p));
          setDraftStatus(
            existing || !isUntouchedStarterProject(p)
              ? '草稿已恢复'
              : '开始编辑后自动保存',
          );
          setProjectState(p);
          const objectId = params.get('object');
          if (objectId && p.objects.some((o) => o.definitionId === objectId))
            setSelected(objectId);
        }
      })
      .catch((e) => {
        if (alive) {
          unreadableFallback.current = latest.current.project;
          setMessage(`草稿读取失败：${describeError(e)}`);
          setError(true);
          setDraftWritable(false);
        }
      })
      .finally(() => {
        if (alive) {
          setReady(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (
      !ready ||
      !draftWritable ||
      !started ||
      savedProject.current === project
    )
      return;
    completedIds.current = [];
    // oxlint-disable-next-line react/react-compiler -- Synchronize the visible status with an IndexedDB save cycle.
    setDraftStatus('正在保存草稿…');
    const timer = setTimeout(() => {
      void persist().catch(() => undefined);
    }, 700);
    return () => clearTimeout(timer);
  }, [project, ready, draftWritable, started, persist]);
  useEffect(() => {
    if (!ready) return;
    const dirty =
      started &&
      (draftWritable
        ? savedProject.current !== project
        : unreadableFallback.current !== project);
    const failed = !draftWritable || draftStatus.includes('失败');
    const items = (
      started ? interactableWorkItems(project, completedIds.current) : []
    ).map((item) => ({
      ...item,
      savedAt: savedAt.current || undefined,
      state: failed
        ? ('attention' as const)
        : dirty
          ? ('editing' as const)
          : item.state,
      detail: failed
        ? '草稿保存需要处理，请先下载源文件'
        : dirty
          ? '正在保存交互物修改'
          : item.detail,
    }));
    items.sort(
      (a, b) =>
        Number(b.id.endsWith(`:${current?.definitionId}`)) -
        Number(a.id.endsWith(`:${current?.definitionId}`)),
    );
    publishEditorSession({
      capabilityId: 'interactable-editor',
      items,
      dirty,
      busy,
      save: persist,
      beforeLeave: () => {
        if (latest.current.busy)
          throw new Error('交互物正在导入或导出，请完成后再切换页面。');
      },
    });
  }, [
    project,
    current?.definitionId,
    ready,
    draftWritable,
    draftStatus,
    busy,
    started,
    persist,
  ]);
  useEffect(() => () => removeEditorSession('interactable-editor'), []);
  const edit = (fn: (o: Interactable) => void) =>
    setProject((p) => {
      const next = structuredClone(p);
      const o = next.objects.find(
        (o) => o.definitionId === current.definitionId,
      );
      if (o) fn(o);
      return next;
    });
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    setMessage('');
    try {
      await action();
    } catch (e) {
      setMessage(describeError(e));
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const add = (kind: Kind) => {
    const o = createObject(kind);
    setProject((p) => ({ ...p, objects: [...p.objects, o] }));
    setSelected(o.definitionId);
  };
  const clone = () => {
    const o = structuredClone(current);
    o.definitionId = makeId();
    o.displayName += ' 副本';
    setProject((p) => ({ ...p, objects: [...p.objects, o] }));
    setSelected(o.definitionId);
  };
  const remove = () => {
    const id = current.definitionId;
    setProject((p) => ({
      ...p,
      objects: p.objects.filter((o) => o.definitionId !== id),
    }));
    setSelected('');
    setExportIds((ids) => ids.filter((v) => v !== id));
  };
  const loadAssets = (files: File[], frames = false) =>
    run(async () => {
      const ordered = frames
        ? [...files].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true }),
          )
        : files;
      const imported: Asset[] = [];
      for (const f of ordered) imported.push(await importAsset(f));
      setProject((p) => {
        const next = structuredClone(p);
        next.assets.push(...imported);
        const o = next.objects.find(
          (o) => o.definitionId === current.definitionId,
        );
        if (!o) return next;
        if (frames) {
          const name = nextClipName(o);
          o.visual.clips.push({
            name,
            fps: 8,
            loop: true,
            frames: imported.map((a) => ({ assetId: a.id, duration: 1 })),
          });
          if (!o.visual.idleAnimation) o.visual.idleAnimation = name;
        } else if (!o.visual.assetId)
          o.visual.assetId =
            imported.find((a) => a.mime.startsWith('image'))?.id ?? '';
        return next;
      });
      setMessage(`已导入 ${imported.length} 个素材`);
    });
  const doExport = (targetProfile: 'generic' | 'copyworms') =>
    run(async () => {
      setMessage('正在生成 Godot 包…');
      const task = await exportProject(
        project,
        exportIds.length ? exportIds : [current.definitionId],
        targetProfile,
      );
      setResult(task);
      if (latest.current.project === project) {
        completedIds.current = exportIds.length
          ? exportIds
          : [current.definitionId];
        savedProject.current = null;
        await persist(true);
      }
      setMessage('已导出，点击下方文件下载。');
      const output = task.outputs.find((p) => p.endsWith('.zip'));
      if (output) {
        const a = document.createElement('a');
        a.href = `/api/workbench/artifacts?path=${encodeURIComponent(output)}`;
        a.download = output.split('/').pop() ?? 'interactables.zip';
        a.click();
      }
    });
  const used = new Set(referencedAssets(project).map((a) => a.id));
  return (
    <main className="ie-workspace">
      {!ready && (
        <output className="wb-loading-veil">正在恢复交互物草稿…</output>
      )}
      <header className="ie-toolbar">
        <Box color="#55dfb4" />
        <strong>交互物编辑器</strong>
        <input
          aria-label="项目名称"
          value={project.name}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
        />
        <span className="ie-note">
          {draftWritable
            ? draftStatus
            : '原草稿保留，请保存源文件；导入项目可恢复自动保存'}
        </span>
        <span className="ie-spacer" />
        <button disabled={busy} onClick={() => projectInput.current?.click()}>
          <Upload size={16} />
          导入项目
        </button>
        <button
          onClick={() => {
            downloadJson(project);
            void persist(true).catch(() => undefined);
          }}
        >
          <Save size={16} />
          保存源文件
        </button>
        <button
          className="ie-primary"
          disabled={busy || !ready}
          onClick={() => doExport('generic')}
        >
          <Download size={16} />
          {busy
            ? '处理中…'
            : `导出 Godot${exportIds.length ? ` · ${exportIds.length} 个` : ''}`}
        </button>
        <button
          disabled={busy || !ready}
          onClick={() => doExport('copyworms')}
          title="使用 copyWorms 的人物、Enter 输入与输入锁；可选连接原事件"
        >
          <Download size={16} />
          导出 copyWorms 兼容版
        </button>
      </header>
      {message && (
        <div
          role={error ? 'alert' : 'status'}
          className={`ie-message ${error ? 'ie-error' : ''}`}
        >
          {message}
          {result && !error && (
            <div className="ie-row">
              {result.outputs
                .filter((p) => !p.endsWith('result.json'))
                .map((p) => (
                  <a
                    key={p}
                    href={`/api/workbench/artifacts?path=${encodeURIComponent(p)}`}
                  >
                    {p.split('/').at(-1)}
                  </a>
                ))}
              <small>
                任务 {result.taskId} · {result.status}
              </small>
            </div>
          )}
        </div>
      )}
      <input
        hidden
        ref={projectInput}
        type="file"
        accept=".json,.zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f)
            void run(async () => {
              const p = await importProject(f);
              if (latest.current.draftWritable) await persist();
              setProject(p);
              setDraftWritable(true);
              setSelected('');
              setExportIds([]);
              setResult(null);
              setMessage('项目与素材已恢复');
            });
        }}
      />
      <input
        hidden
        ref={assetInput}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,audio/wav,audio/ogg,audio/mpeg"
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (fs.length) void loadAssets(fs);
        }}
      />
      <input
        hidden
        ref={framesInput}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (fs.length) void loadAssets(fs, true);
        }}
      />
      <div className="ie-layout">
        <aside className="ie-library">
          <h2>
            物件 <small>{project.objects.length}</small>
          </h2>
          {project.objects.map((o) => (
            <div key={o.definitionId} className="ie-object-row">
              <button
                aria-pressed={o.definitionId === current.definitionId}
                onClick={() => setSelected(o.definitionId)}
              >
                <Box size={17} />
                <span>
                  {o.displayName}
                  <small>{KIND_LABELS[o.behavior.kind]}</small>
                </span>
              </button>
              <input
                aria-label={`导出 ${o.displayName}`}
                type="checkbox"
                checked={exportIds.includes(o.definitionId)}
                onChange={(e) =>
                  setExportIds((ids) =>
                    e.target.checked
                      ? [...ids, o.definitionId]
                      : ids.filter((i) => i !== o.definitionId),
                  )
                }
              />
            </div>
          ))}
          <p className="ie-note">勾选可批量导出；未勾选时导出当前物件。</p>
          <div className="ie-presets">
            {KINDS.map((kind) => (
              <button key={kind} onClick={() => add(kind)}>
                <Plus size={14} />
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
          <div className="ie-row" style={{ marginTop: 14 }}>
            <button onClick={clone}>
              <Copy size={14} />
              复制
            </button>
            <button disabled={project.objects.length === 1} onClick={remove}>
              <Trash2 size={14} />
              删除
            </button>
          </div>
          <details open>
            <summary>素材 · {project.assets.length}</summary>
            <button disabled={busy} onClick={() => assetInput.current?.click()}>
              <Upload size={14} />
              导入图片 / 音效
            </button>
            <div className="ie-asset-list">
              {project.assets.map((a) => (
                <div key={a.id}>
                  {a.mime.startsWith('image') ? (
                    <img src={assetUrl(a)} alt="" />
                  ) : (
                    <span>♫</span>
                  )}
                  <span title={a.name}>{a.name}</span>
                  {!used.has(a.id) && (
                    <button
                      title={`移除未使用素材 ${a.name}`}
                      onClick={() =>
                        setProject((p) => ({
                          ...p,
                          assets: p.assets.filter((v) => v.id !== a.id),
                        }))
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
        </aside>
        <Preview object={current} assets={project.assets} edit={edit} />
        <aside className="ie-inspector">
          <Field label="物件名称">
            <input
              value={current.displayName}
              onChange={(e) =>
                edit((o) => {
                  o.displayName = e.target.value;
                })
              }
            />
          </Field>
          <div className="ie-tabs">
            {[
              ['visual', '外观'],
              ['trigger', '触发'],
              ['behavior', '行为'],
              ['memory', '记忆'],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'visual' && (
            <VisualPanel
              object={current}
              assets={project.assets}
              edit={edit}
              run={run}
              importFrames={() => framesInput.current?.click()}
              busy={busy}
            />
          )}
          {tab === 'trigger' && (
            <div className="ie-tab-content">
              <Field label="触发方式">
                <select
                  value={current.activation.mode}
                  onChange={(e) =>
                    edit((o) => {
                      o.activation.mode = e.target
                        .value as Interactable['activation']['mode'];
                    })
                  }
                >
                  {TRIGGERS.map((t) => (
                    <option key={t} value={t}>
                      {triggerLabels[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Check
                label="初始启用"
                value={current.activation.enabled}
                onChange={(v) =>
                  edit((o) => {
                    o.activation.enabled = v;
                  })
                }
              />
              <Field label="提示文字（留空自动显示按键）">
                <input
                  value={current.content.prompt}
                  onChange={(e) =>
                    edit((o) => {
                      o.content.prompt = e.target.value;
                    })
                  }
                />
              </Field>
              <Field label="默认按键（action 尚未配置时）">
                <input
                  value={current.activation.key}
                  onChange={(e) =>
                    edit((o) => {
                      o.activation.key = e.target.value;
                    })
                  }
                />
              </Field>
              <div className="ie-row">
                <Numeric
                  label="提示偏移 X"
                  value={current.content.promptOffset.x}
                  onChange={(x) =>
                    edit((o) => {
                      o.content.promptOffset.x = x;
                    })
                  }
                />
                <Numeric
                  label="提示偏移 Y"
                  value={current.content.promptOffset.y}
                  onChange={(y) =>
                    edit((o) => {
                      o.content.promptOffset.y = y;
                    })
                  }
                />
              </div>
              <Check
                label="来源离开时取消未完成交互"
                value={current.activation.cancelOnExit}
                onChange={(v) =>
                  edit((o) => {
                    o.activation.cancelOnExit = v;
                  })
                }
              />
              <details open>
                <summary>高级接入</summary>
                <Field label="copyWorms 原事件物件 ID（可选）">
                  <input
                    value={current.copyworms.objectId}
                    placeholder="例如 notice；留空仅运行当前物件行为"
                    onChange={(e) =>
                      edit((o) => {
                        o.copyworms.objectId = e.target.value;
                      })
                    }
                  />
                </Field>
                <p className="ie-note">
                  仅兼容版生效：完成交互后触发对应原事件。原剧情仍由关卡阶段控制。
                  兼容版自动使用 player、碰撞层 4 和 ui_accept（默认 Enter）。
                </p>
                <Field label="InputMap action">
                  <input
                    value={current.activation.action}
                    onChange={(e) =>
                      edit((o) => {
                        o.activation.action = e.target.value;
                      })
                    }
                  />
                </Field>
                <Field label="人物 group">
                  <input
                    value={current.detection.actorGroup}
                    onChange={(e) =>
                      edit((o) => {
                        o.detection.actorGroup = e.target.value;
                      })
                    }
                  />
                </Field>
                <Numeric
                  label="感知 mask（位掩码）"
                  value={current.detection.mask}
                  min={0}
                  onChange={(mask) =>
                    edit((o) => {
                      o.detection.mask = mask;
                    })
                  }
                />
                <Numeric
                  label="焦点优先级"
                  value={current.detection.priority}
                  onChange={(priority) =>
                    edit((o) => {
                      o.detection.priority = priority;
                    })
                  }
                />
                <p className="ie-note">
                  靠近模式需要 PhysicsBody2D，且 mask 包含人物所在
                  layer。鼠标和外部调用无需人物。
                </p>
              </details>
            </div>
          )}
          {tab === 'behavior' && (
            <div className="ie-tab-content">
              <h2>{KIND_LABELS[current.behavior.kind]}</h2>
              <BehaviorPanel
                object={current}
                assets={project.assets}
                edit={edit}
              />
            </div>
          )}
          {tab === 'memory' && (
            <div className="ie-tab-content">
              <Field label="记忆范围">
                <select
                  value={current.memory.scope}
                  onChange={(e) =>
                    edit((o) => {
                      o.memory.scope = e.target
                        .value as Interactable['memory']['scope'];
                    })
                  }
                >
                  <option value="instance">当前实例（重载重置）</option>
                  <option value="session">同一局跨场景</option>
                  <option value="persistent">保存到存档</option>
                </select>
              </Field>
              {current.memory.scope !== 'instance' && (
                <>
                  <Field label="命名空间">
                    <input
                      value={current.memory.namespace}
                      onChange={(e) =>
                        edit((o) => {
                          o.memory.namespace = e.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="存档槽">
                    <input
                      value={current.memory.slot}
                      onChange={(e) =>
                        edit((o) => {
                          o.memory.slot = e.target.value;
                        })
                      }
                    />
                  </Field>
                  <p>
                    同一局记忆需要游戏根节点持有共享 StateStore。持久化使用独立
                    ConfigFile，也可通过快照接口接入已有存档。
                  </p>
                  <p>
                    动态物件需要在 Godot 中设置稳定
                    instance_id。静态物件默认按关卡内路径区分。
                  </p>
                </>
              )}
              <details>
                <summary>模板身份</summary>
                <code style={{ overflowWrap: 'anywhere' }}>
                  {current.definitionId}
                </code>
                <p className="ie-note">
                  复制物件会生成新的模板身份。关卡中同模板的不同实例各自保存状态。
                </p>
              </details>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
