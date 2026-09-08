'use client';
/* oxlint-disable next/no-img-element -- Preserve animated asset previews. */
/* oxlint-disable next/no-html-link-for-pages -- Native links use the workbench draft guard. */
import { useEffect, useState } from 'react';
import manifest from '@/workbench/manifest.json';

type Asset = {
  id: string;
  title: string;
  kind: string;
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
  animation: '动画',
  map: '地图素材',
  interactable: '交互物',
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
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
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
          offset: String(page.offset),
          limit: '24',
          ...(kind ? { kind } : {}),
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
  }, [assetId, search, kind, page, reload]);
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
    return a.previewKind !== 'none' && a.availability === 'available' ? (
      <img
        src={a.previewUrl}
        alt={
          a.candidateIndex ? `${a.title} · 候选 ${a.candidateIndex}` : a.title
        }
        loading="lazy"
        style={{
          width: '100%',
          height: assetId ? 350 : 170,
          objectFit: 'contain',
          imageRendering: 'pixelated',
          background: 'var(--theme-canvas)',
          borderRadius: 12,
        }}
      />
    ) : (
      <div style={{ minHeight: 120, display: 'grid', placeItems: 'center' }}>
        {a.availability === 'missing'
          ? '文件暂不可读取'
          : '交互逻辑 · 在编辑器查看'}
      </div>
    );
  }
  return (
    <main className="wb-page">
      <div className="wb-page-heading">
        <div>
          <div className="wb-eyebrow">FORGE / ASSETS</div>
          <h1>{assetId ? '资产详情' : '资产库'}</h1>
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
            }}
          >
            刷新资产
          </button>
        )}
      </div>
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
            {preview(asset)}
            <p>
              {labels[asset.kind]} · {asset.statusLabel}
              {asset.frameCount ? ` · ${asset.frameCount} 帧` : ''}
              {asset.width ? ` · ${asset.width} × ${asset.height}` : ''}
            </p>
            {asset.readiness?.issues.map((message) => (
              <p className="wb-notice" key={message}>
                {message}
              </p>
            ))}
            <div className="wb-tool-links">
              {asset.editorPath && (
                <a className="wb-button" href={asset.editorPath}>
                  {asset.kind === 'map' ? '进入地图工具' : '在原工具中打开'}
                </a>
              )}
              <button
                className="wb-button"
                disabled={exporting}
                onClick={() => void downloadAssets([asset.id])}
              >
                {exporting ? '正在打包…' : '下载素材（ZIP）'}
              </button>
            </div>
            <details style={{ marginTop: 20 }}>
              <summary>来源文件与版本</summary>
              <p>版本指纹：{asset.revision}</p>
              {asset.files?.map((f) => (
                <p key={f.key}>
                  <code style={{ overflowWrap: 'anywhere' }}>{f.path}</code> ·{' '}
                  {f.available ? '已校验' : '缺失'}
                </p>
              ))}
            </details>
          </section>
        ) : (
          !error && <p>正在读取这件资产…</p>
        )
      ) : (
        <>
          <form
            className="wb-tool-links"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
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
                setPage({ offset: 0, snapshot: '' });
              }}
            >
              <option value="">全部类型</option>
              {Object.entries(labels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <button className="wb-button" type="submit">
              查找
            </button>
            <button
              className="wb-button"
              type="button"
              disabled={!selected.length || exporting}
              onClick={() => void downloadAssets(selected)}
            >
              {exporting ? '正在打包…' : `下载所选素材（${selected.length}）`}
            </button>
          </form>
          <p className="wb-muted">
            下载包含所选图片、动画帧及已有导出文件，按作品分别打包为 ZIP。
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
                      href={a.viewPath}
                      aria-label={`查看 ${a.title}${a.candidateIndex ? ` 候选 ${a.candidateIndex}` : ''}`}
                    >
                      {preview(a)}
                    </a>
                    <h2 style={{ fontSize: 16, marginTop: 12 }}>
                      {a.title}
                      {a.candidateIndex ? ` · 候选 ${a.candidateIndex}` : ''}
                    </h2>
                    <p>
                      {labels[a.kind]} ·{' '}
                      {a.availability === 'missing'
                        ? '文件缺失'
                        : a.statusLabel}
                      {a.frameCount ? ` · ${a.frameCount} 帧` : ''}
                    </p>
                    <div className="wb-tool-links">
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.includes(a.id)}
                          disabled={
                            exporting ||
                            (!selected.includes(a.id) && selected.length >= 100)
                          }
                          onChange={(e) =>
                            setSelected((ids) =>
                              e.target.checked
                                ? [...ids, a.id]
                                : ids.filter((id) => id !== a.id),
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
