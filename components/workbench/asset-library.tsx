'use client';
/* oxlint-disable next/no-img-element -- Preserve animated asset previews. */
/* oxlint-disable next/no-html-link-for-pages -- Native links use the workbench draft guard. */
import { useEffect, useState } from 'react';
import manifest from '@/workbench/manifest.json';
import {offerGodotExport} from '@/lib/workbench/godot-export';
import { importLink } from '@/lib/workbench/asset-import';
import { operationLabel } from '@/lib/workbench/work-items';

type Asset = {
  trashedAt?: string;
  id: string;
  title: string;
  kind: string;
  origin?: string;
  mapType?: 'project' | 'image';
  statusLabel: string;
  availability: string;
  previewKind?: string;
  previewUrl: string;
  viewPath: string;
  editorPath?: string;
  candidateIndex?: number;
  candidateCount?: number;
  frameCount?: number;
  width?: number;
  height?: number;
  updatedAt?: string;
  hasArtwork?: boolean;
  files?: { key: string; path: string; available: boolean; sha256?: string }[];
  readiness?: { issues: string[] };
  revision?: string;
  sceneRevision?: number;
  sceneId?: string;
  exportId?: string;
  instanceCount?: number;
  materialCount?: number;
  tileCount?: number;
  createdAt?: string;
  history?: { taskId: string; operation: string; createdAt: string; status: string; viewPath: string }[];
};
type Catalog = {
  assets: Asset[];
  total: number;
  nextOffset: number | null;
  snapshot: string;
  coverage: { complete: boolean; note: string; issues: { message: string }[] };
};
const labels: Record<string, string> = {
  character: '角色原图',
  prop: '物品原图',
  animation: '动画',
  map: '地图',
  interactable: '交互物',
  scene: '完整场景',
};
const route = manifest.agentAssets.assetCatalog.route;
export function AssetLibrary() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState({ offset: 0, snapshot: '' });
  const [reload, setReload] = useState(0);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [assetId, setAssetId] = useState('');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [selected, setSelected] = useState<Asset[]>([]);
  const [scope, setScope] = useState<'active' | 'trashed'>('active');
  const [pending, setPending] = useState<{ operation: 'trash' | 'restore'; assets: Asset[] } | null>(null);
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [failedPreviews, setFailedPreviews] = useState<string[]>([]);
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- Hydrate the browser-only selection.
    setAssetId(new URLSearchParams(location.search).get('asset') || '');
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = assetId
      ? new URLSearchParams({ assetId })
      : new URLSearchParams({
          query: search,
          scope,
          offset: String(page.offset),
          limit: '24',
          ...(kind ? { kind: kind === 'map-image' ? 'map' : kind } : {}),
          ...(kind === 'map' ? { mapType: 'project' } : kind === 'map-image' ? { mapType: 'image' } : {}),
          ...(page.snapshot ? { snapshot: page.snapshot } : {}),
        });
    void (async () => {
      try {
        const response = await fetch(`/api/workbench/assets?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = (await response.json()) as Catalog & {
          asset: Asset;
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            data.error || '资产目录暂时无法读取，请检查本地服务。',
          );
        if (controller.signal.aborted) return;
        setError('');
        if (assetId) setAsset(data.asset);
        else setCatalog(data);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => controller.abort();
  }, [assetId, search, kind, page, reload, scope]);
  async function confirmManagement() {
    if (!pending || managing) return;
    setManaging(true);
    setNotice('');
    try {
      const response = await fetch('/api/workbench/assets/manage', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: pending.operation, assetIds: pending.assets.map((a) => a.id) }),
      });
      const data = await response.json() as { count: number; error?: string };
      if (!response.ok) throw new Error(data.error || '回收站更新失败，请重试。');
      setNotice(pending.operation === 'trash' ? `已将 ${data.count} 件素材移入回收站，源文件已保留。` : `已恢复 ${data.count} 件素材。`);
      setPending(null);
      setSelected([]);
      setPage({ offset: 0, snapshot: '' });
      setCatalog(null);
      setAsset(null);
      setReload((v) => v + 1);
    } catch (error) { setNotice((error as Error).message); }
    finally { setManaging(false); }
  }
  async function downloadAssets(ids: string[]) {
    setExporting(true);
    setNotice('');
    try {
      const response = await fetch('/api/workbench/assets/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetIds: ids }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || '素材包暂时无法下载。');
      }
      if (!response.headers.get('content-type')?.includes('application/zip'))
        throw new Error('未收到有效素材包，请刷新页面后重试。');
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'forge-assets.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        `已下载 ${response.headers.get('x-asset-count') || ids.length} 件资产的素材包，解压后即可查看和使用。`,
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  function preview(a: Asset) {
    const previewKey = `${a.id}:${a.updatedAt}`;
    const map = a.origin === 'map-project';
    const frameStyle = map ? {
      aspectRatio: '16 / 9', width: '100%',
      backgroundColor: 'var(--theme-canvas)',
      backgroundImage: 'conic-gradient(from 90deg, transparent 25%, var(--wb-line) 0 50%, transparent 0 75%, var(--wb-line) 0)',
      backgroundSize: '16px 16px', borderRadius: 12,
    } : {};
    return a.previewKind !== 'none' && a.availability === 'available' && !failedPreviews.includes(previewKey) ? (
      <img
        src={`${a.previewUrl}${map ? `&version=${encodeURIComponent(a.updatedAt || '')}` : ''}`}
        alt={
          a.candidateIndex ? `${a.title} · 候选 ${a.candidateIndex}` : a.title
        }
        loading="lazy"
        onError={() => setFailedPreviews((keys) => keys.includes(previewKey) ? keys : [...keys, previewKey])}
        style={{
          width: '100%',
          height: map ? 'auto' : assetId ? 350 : 170,
          maxHeight: assetId ? 420 : undefined,
          objectFit: 'contain',
          imageRendering: 'pixelated',
          background: 'var(--theme-canvas)',
          borderRadius: 12,
          ...frameStyle,
        }}
      />
    ) : (
      <div style={{ minHeight: 120, display: 'grid', placeItems: 'center', ...frameStyle }}>
        {a.availability === 'missing'
          ? '文件暂不可读取'
          : map ? '暂无预览 · 打开并保存后更新'
          : a.kind === 'scene'
            ? '完整场景 · 源包与 Godot 包'
            : '交互逻辑 · 在编辑器查看'}
      </div>
    );
  }
  return (
    <main className="wb-page">
      <div className="wb-page-heading">
        <div>
          <div className="wb-eyebrow">FORGE / ASSETS</div>
          <h1>{assetId ? '资产详情' : scope === 'trashed' ? '资产回收站' : '资产库'}</h1>
          <p>查找已经保存的素材，整理后交接给游戏项目。</p>
        </div>
        {assetId ? (
          <a className="wb-button" href={route}>
            返回资产库
          </a>
        ) : (
          <button
            className="wb-button"
            onClick={() => {
              setPage({ offset: 0, snapshot: '' });
              setReload((v) => v + 1);
              setFailedPreviews([]);
            }}
          >
            刷新资产
          </button>
        )}
      </div>
      {pending && (
        <dialog ref={(node) => { if (node && !node.open) node.showModal(); }} onCancel={(event) => { event.preventDefault(); if (!managing) setPending(null); }} aria-labelledby="asset-management-title" style={{ margin: 'auto', inset: 0, maxHeight: '85vh', overflow: 'auto', maxWidth: 560, width: '90vw', padding: 24, borderRadius: 16, background: 'var(--wb-panel)', color: 'var(--wb-text)', border: '1px solid var(--wb-line)' }}>
          <h2 id="asset-management-title" style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>{pending.operation === 'trash' ? '移入回收站' : '恢复素材'} · {pending.assets.length} 件</h2>
          <p>{pending.operation === 'trash' ? '所选素材将从资产库隐藏，可在回收站恢复。源文件、制作记录和已有场景引用保留，不释放磁盘空间。' : '所选素材将重新出现在资产库。来源离线或文件缺失时，恢复不会修复源文件。'}</p>
          <ul style={{ maxHeight: 260, overflow: 'auto', margin: '16px 0', lineHeight: 1.8 }}>{pending.assets.map((a) => <li key={a.id}>{a.title}{a.candidateIndex ? ` · 候选 ${a.candidateIndex}` : ''} · {labels[a.kind]}<small style={{ display: 'block', overflowWrap: 'anywhere' }}>{a.id}</small></li>)}</ul>
          {notice && <output>{notice}</output>}
          <div className="wb-tool-links">
            <button className="wb-button" disabled={managing} onClick={() => setPending(null)}>取消</button>
            <button className="wb-button" disabled={managing} onClick={() => void confirmManagement()}>{managing ? '正在处理…' : pending.operation === 'trash' ? '确认移入回收站' : '确认恢复'}</button>
          </div>
        </dialog>
      )}
      {error && (
        <p role="alert" className="wb-notice">
          {error}
        </p>
      )}
      {notice && (
        <output
          className="wb-notice"
          style={{ display: 'block', margin: '16px 0' }}
        >
          {notice}
        </output>
      )}
      {assetId ? (
        asset && !error ? (
          <section>
            <h2>
              {asset.title}
              {asset.candidateIndex ? ` · 候选 ${asset.candidateIndex}` : ''}
            </h2>
            {asset.trashedAt && <p className="wb-notice">已移入回收站 · {new Date(asset.trashedAt).toLocaleString('zh-CN')}</p>}
            {preview(asset)}
            {asset.origin === 'map-project' && (
              <p>
                {asset.tileCount ?? '未知'} 个地图块 · 最后保存 {asset.updatedAt ? new Date(asset.updatedAt).toLocaleString('zh-CN') : '未知'}
                {asset.previewKind === 'image' && <a className="wb-button" href={asset.previewUrl} target="_blank" rel="noreferrer">放大预览</a>}
              </p>
            )}
            <p>
              {asset.kind === 'map' ? asset.origin === 'map-project' ? '地图工程' : '地图原图 / 历史素材' : labels[asset.kind]} · {asset.statusLabel}
              {asset.frameCount ? ` · ${asset.frameCount} 帧` : ''}
              {asset.width ? ` · ${asset.width} × ${asset.height}` : ''}
              {asset.sceneRevision !== undefined ? ` · 场景版本 ${asset.sceneRevision}` : ''}
            </p>
            {asset.kind === 'scene' && (
              <p>包含 {asset.materialCount ?? '未知'} 件场景素材、{asset.instanceCount ?? '未知'} 个实例。可直接继续组装，也可下载源包备份。</p>
            )}
            {asset.readiness?.issues.map((message) => (
              <p className="wb-notice" key={message}>
                {message}
              </p>
            ))}
            <div className="wb-tool-links">
              <button className="wb-button" disabled={managing || exporting} onClick={() => { setNotice(''); setPending({ operation: asset.trashedAt ? 'restore' : 'trash', assets: [asset] }); }}>{asset.trashedAt ? '恢复到资产库' : '移入回收站'}</button>
              {asset.origin === 'map-project' && asset.editorPath && <a className="wb-button" href={asset.editorPath}>继续编辑地图</a>}
              {asset.kind === 'map' && <><a className="wb-button" href={importLink('map-stitcher','map',asset.id)}>导入地图编辑器</a><a className="wb-button" href={importLink('scene-composer','map',asset.id)}>用于制作场景</a></>}
              {asset.kind === 'interactable' && <><a className="wb-button" href={importLink('interactable-editor','interactable',asset.id)}>编辑交互物项目</a><a className="wb-button" href={importLink('scene-composer','interactable',asset.id)}>加入场景</a></>}
              {asset.kind === 'scene' && <a className="wb-button" href={importLink('scene-composer','scene',asset.id)}>继续组装此场景</a>}
              {['prop','character','map'].includes(asset.kind) && asset.origin !== 'map-project' && <a className="wb-button" href={importLink('interactable-editor','image',asset.id)}>用于交互物外观</a>}
              {asset.kind === 'animation' && <a className="wb-button" href={importLink('interactable-editor','animation',asset.id)}>用于交互物动画</a>}
              {asset.editorPath && !['map','interactable','scene'].includes(asset.kind) && (
                <a className="wb-button" href={asset.editorPath}>
                  {asset.kind === 'map' ? '继续编辑地图' : '在原工具中打开'}
                </a>
              )}
              <button
                className="wb-button"
                disabled={exporting}
                onClick={() => void downloadAssets([asset.id])}
              >
                {exporting ? '正在打包…' : asset.origin === 'map-project' ? '下载编辑源文件（ZIP）' : '下载素材（ZIP）'}
              </button>
            </div>
            {asset.origin === 'map-project' && asset.editorPath && <a className="wb-button" href={asset.editorPath}>在地图编辑器导出 Godot</a>}
            {asset.origin !== 'map-project' && ['map','scene','interactable','animation'].includes(asset.kind) && asset.revision && <button className="wb-primary" onClick={()=>offerGodotExport({name:asset.title,assetId:asset.id,revision:asset.revision})}>导出到游戏项目</button>}
            <details style={{ marginTop: 20 }}>
              <summary>来源文件与版本</summary>
              <p>创建时间：{asset.createdAt ? new Date(asset.createdAt).toLocaleString() : '未知'}</p>
              {asset.exportId && <p>场景导出记录：{asset.exportId}</p>}
              <p>版本指纹：{asset.revision}</p>
              {asset.files?.map((f) => (
                <p key={f.key}>
                  <code style={{ overflowWrap: 'anywhere' }}>{f.path}</code> ·{' '}
                  {f.available ? '已校验' : '缺失'}
                </p>
              ))}
              {!!asset.history?.length && (
                <>
                  <h3>制作与导出记录</h3>
                  {asset.history.map((entry) => (
                    <p key={entry.taskId}>
                      <a href={entry.viewPath}>{operationLabel(entry.operation)} · {new Date(entry.createdAt).toLocaleString()}</a>
                    </p>
                  ))}
                </>
              )}
            </details>
          </section>
        ) : (
          !error && <p>正在读取这件资产…</p>
        )
      ) : (
        <>
          <nav className="wb-tool-links" aria-label="资产范围" style={{ marginBottom: 16 }}>
            {(['active', 'trashed'] as const).map((value) => <button key={value} className="wb-button" aria-pressed={scope === value} onClick={() => { setScope(value); setSelected([]); setCatalog(null); setPage({ offset: 0, snapshot: '' }); }}>{value === 'active' ? '已保存素材' : '回收站'}</button>)}
          </nav>
          {scope === 'trashed' && <p className="wb-notice">这里的素材可以恢复。源文件仍保留在原处，不释放磁盘空间。</p>}
          <form
            className="wb-tool-links"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
              setCatalog(null);
              setPage({ offset: 0, snapshot: '' });
            }}
          >
            <input
              aria-label="搜索资产"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索角色、动作或作品名称"
              style={{
                padding: '10px 14px',
                background: 'var(--wb-panel)',
                color: 'var(--wb-text)',
                border: '1px solid var(--theme-control-border)',
                borderRadius: 8,
                minWidth: 250,
              }}
            />
            <select
              aria-label="资产类型"
              className="wb-button"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setCatalog(null);
                setPage({ offset: 0, snapshot: '' });
              }}
            >
              <option value="">全部类型</option>
              {Object.entries(labels).map(([id, label]) => (
                <option key={id} value={id}>
                  {id === 'map' ? '地图工程' : label}
                </option>
              ))}
              <option value="map-image">地图原图 / 历史素材</option>
            </select>
            <button className="wb-button" type="submit">
              查找
            </button>
            <button
              className="wb-button"
              type="button"
              disabled={!selected.length || exporting}
              onClick={() => void downloadAssets(selected.map((a) => a.id))}
            >
              {exporting ? '正在打包…' : `下载所选素材（${selected.length}）`}
            </button>
            <button type="button" className="wb-button" disabled={!selected.length || managing || exporting} onClick={() => { setNotice(''); setPending({ operation: scope === 'trashed' ? 'restore' : 'trash', assets: [...selected] }); }}>{scope === 'trashed' ? '恢复所选' : '移入回收站'}（{selected.length}）</button>
            {!!selected.length && <button type="button" className="wb-button" onClick={() => setSelected([])}>取消选择</button>}
          </form>
          <p className="wb-muted">
            地图工程提供编辑源文件；原图与历史素材仍可查找和下载。动画与完整场景保留实际素材及已有 Godot 包。
          </p>
          {catalog && (
            <>
              <p className="wb-muted">
                {catalog.total} 件资产 · 按创建时间排序；动画每个候选分别列出。
              </p>
              <p className="wb-notice">{catalog.coverage.note}</p>
              {catalog.coverage.issues.map((i, index) => (
                <output key={index}>{i.message}</output>
              ))}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                  gap: 16,
                }}
              >
                {catalog.assets.map((a) => (
                  <article
                    key={a.id}
                    style={{
                      border: '1px solid var(--wb-line)',
                      background: 'var(--wb-panel)',
                      borderRadius: 14,
                      padding: 16,
                    }}
                  >
                    <a
                      href={!a.trashedAt && a.origin === 'map-project' ? a.editorPath || a.viewPath : a.viewPath}
                      aria-label={`${!a.trashedAt && a.kind === 'map' ? '继续编辑' : '查看'} ${a.title}${a.candidateIndex ? ` 候选 ${a.candidateIndex}` : ''}`}
                    >
                      {preview(a)}
                    </a>
                    <h2 style={{ fontSize: 16, marginTop: 12 }}>
                      {a.title}
                      {a.candidateIndex ? ` · 候选 ${a.candidateIndex}` : ''}
                    </h2>
                    <p>
                      {a.kind === 'map' ? a.origin === 'map-project' ? '地图工程' : '地图原图 / 历史素材' : labels[a.kind]} ·{' '}
                      {a.availability === 'missing'
                        ? '文件缺失'
                        : a.statusLabel}
                      {a.frameCount ? ` · ${a.frameCount} 帧` : ''}
                      {a.sceneRevision !== undefined ? ` · 场景版本 ${a.sceneRevision}` : ''}
                    </p>
                    {a.kind === 'map' && <p>{a.tileCount ?? '未知'} 个地图块 · {a.updatedAt ? new Date(a.updatedAt).toLocaleString('zh-CN') : '保存时间未知'}</p>}
                    <div className="wb-tool-links">
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.some((item) => item.id === a.id)}
                          disabled={
                            exporting ||
                            (!selected.some((item) => item.id === a.id) && selected.length >= 100)
                          }
                          onChange={(e) =>
                            setSelected((ids) =>
                              e.target.checked
                                ? [...ids, a]
                                : ids.filter((item) => item.id !== a.id),
                            )
                          }
                        />{' '}
                        选择素材
                      </label>
                      <a href={a.viewPath} className="wb-button">
                        查看详情
                      </a>
                    </div>
                  </article>
                ))}
              </div>
              {!catalog.assets.length && (
                <p>
                  当前范围没有匹配的已保存资产。可更换条件，或到原工具保存作品后刷新。
                </p>
              )}
              <div className="wb-tool-links" style={{ marginTop: 24 }}>
                <button
                  className="wb-button"
                  disabled={!page.offset}
                  onClick={() =>
                    setPage({
                      offset: Math.max(0, page.offset - 24),
                      snapshot: catalog.snapshot,
                    })
                  }
                >
                  上一页
                </button>
                <button
                  className="wb-button"
                  disabled={catalog.nextOffset === null}
                  onClick={() =>
                    setPage({
                      offset: catalog.nextOffset!,
                      snapshot: catalog.snapshot,
                    })
                  }
                >
                  下一页
                </button>
              </div>
            </>
          )}
          {!catalog && !error && <p>正在读取已保存资产…</p>}
        </>
      )}
    </main>
  );
}
