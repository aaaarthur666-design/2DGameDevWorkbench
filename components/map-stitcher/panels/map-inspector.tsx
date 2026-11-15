'use client';
import { useState } from 'react';
import { MapGenerationPrompt } from './map-generation-prompt';
import {
  Eye,
  EyeOff,
  LockKeyhole,
  LockKeyholeOpen,
  MousePointer2,
  Pencil,
  PenTool,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  REGION_LAYERS,
  REGION_LAYER_META,
  isEditableMapLayer,
  isRegionAuthoringMapLayer,
  type RegionTool,
} from '@/features/map-stitcher/frame-ronin-types';
import {
  IMAGE_VIEW_LABELS,
  regionsInScope,
} from '@/features/map-stitcher/editor-selectors';
import { regionBounds } from '@/features/map-stitcher/region-engine';
import type { MapEditorController } from '../use-map-editor-controller';

export function MapInspector({
  c,
  onUpload,
  onSettings,
}: {
  c: MapEditorController;
  onUpload: () => void;
  onSettings: () => void;
}) {
  return (
    <aside
      id="map-inspector"
      className={`map-inspector ${c.panelOpen ? 'open' : ''}`}
      aria-label="地图属性面板"
    >
      <div className="map-inspector-tabs">
        <div role="tablist" aria-label="属性面板">
          {(['tile', 'region', 'queue'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={c.panel === tab}
              onClick={() => c.setPanel(tab)}
            >
              {{ tile: '地图块', region: '区域', queue: '生成队列' }[tab]}
              {tab === 'queue' && c.queueState.active > 0
                ? ` ${c.queueState.active}`
                : ''}
            </button>
          ))}
        </div>
        <Button
          className="map-close-panel"
          size="icon-sm"
          variant="ghost"
          aria-label="收起属性面板"
          onClick={() => c.setPanelOpen(false)}
        >
          <X />
        </Button>
      </div>
      <div className="map-inspector-body" role="tabpanel">
        <fieldset className="map-inspector-fields" disabled={c.busy}>
          {c.panel === 'tile' ? (
            <TilePanel c={c} onUpload={onUpload} onSettings={onSettings} />
          ) : c.panel === 'region' ? (
            <RegionPanel c={c} />
          ) : (
            <QueuePanel c={c} onSettings={onSettings} />
          )}
        </fieldset>
      </div>
    </aside>
  );
}

function TilePanel({
  c,
  onUpload,
  onSettings,
}: {
  c: MapEditorController;
  onUpload: () => void;
  onSettings: () => void;
}) {
  const tile = c.selectedTile;
  const editable = isEditableMapLayer(c.activeMapLayer);
  const imageLayer = isEditableMapLayer(c.activeMapLayer)
    ? c.activeMapLayer
    : null;
  const locked = imageLayer !== null && c.imageLocks[imageLayer];
  const asset = tile && imageLayer ? tile.images[imageLayer] : null;
  const readyToGenerate =
    tile &&
    (c.activeMapLayer === 'overall' ||
      (c.activeMapLayer === 'surface' && tile.images.overall) ||
      (c.activeMapLayer === 'object' &&
        tile.images.black &&
        tile.images.white) ||
      ((c.activeMapLayer === 'black' || c.activeMapLayer === 'white') &&
        tile.images.object));
  const generateLabel =
    c.activeMapLayer === 'surface'
      ? '复制为地表草稿'
      : c.activeMapLayer === 'object'
        ? '提取透明物件'
        : c.activeMapLayer === 'overall'
          ? '生成整体图片'
          : '从透明物件生成参考';
  return (
    <>
      <section className="map-panel-section">
        <h2>
          {tile
            ? tile.key === '0,0'
              ? '中心地图'
              : `地图块 ${tile.key}`
            : '选择地图块'}
        </h2>
        {!tile ? (
          <p className="map-muted">在画布上选择一张地图卡片，或先导入图片。</p>
        ) : (
          <>
            <label className="map-check">
              <input
                type="checkbox"
                checked={!tile.hidden}
                onChange={() => c.perform(c.toggleIncluded)}
              />
              此卡片参与地图输出
            </label>
            <p className="map-muted">
              排除后，该卡片的图片和区域不进入 PNG / Godot；状态保存仍保留内容。
            </p>
            <div className="map-property-title">
              <strong>{IMAGE_VIEW_LABELS[c.activeMapLayer]}图片</strong>
              {editable ? (
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={`${IMAGE_VIEW_LABELS[c.activeMapLayer]}图片锁定`}
                  aria-pressed={locked}
                  onClick={() =>
                    c.toggleImageLock(
                      c.activeMapLayer as Exclude<
                        typeof c.activeMapLayer,
                        'mask'
                      >,
                    )
                  }
                >
                  {locked ? <LockKeyhole /> : <LockKeyholeOpen />}
                </Button>
              ) : (
                <span className="map-tag">只读派生</span>
              )}
            </div>
            <p className="map-muted">
              {locked
                ? '该图片类型的全部卡片已锁定。'
                : editable
                  ? '锁定作用于此图片类型的全部卡片。'
                  : 'Mask 来自整体与物件的 Alpha，并应用遮挡扣除区域。'}
            </p>
            <div className={`map-asset-status ${asset ? 'ready' : ''}`}>
              {asset ? (
                <>
                  <strong>{asset.name}</strong>
                  <span>
                    {asset.width} × {asset.height} px
                  </span>
                </>
              ) : c.activeMapLayer === 'mask' ? (
                <span>
                  {tile.images.overall && tile.images.object
                    ? '派生预览已就绪'
                    : '需要整体图片和透明物件'}
                </span>
              ) : (
                <span>
                  当前卡片尚无{IMAGE_VIEW_LABELS[c.activeMapLayer]}图片
                </span>
              )}
            </div>
            <div className="map-action-grid">
              <Button
                variant="outline"
                disabled={!editable || locked}
                onClick={onUpload}
              >
                <Upload />
                上传图片
              </Button>
              <Button
                variant="outline"
                disabled={!asset || locked}
                onClick={() => c.perform(c.startFineEdit)}
              >
                <Pencil />
                像素精修
              </Button>
            </div>
            {c.activeMapLayer === 'overall' && <MapGenerationPrompt key={tile.key} c={c} onSettings={onSettings} />}
            <Button
              className="map-full-width"
              disabled={
                (c.activeMapLayer === 'overall' && Boolean(c.generationUnavailable)) ||
                !editable ||
                locked ||
                !readyToGenerate ||
                c.queueState.jobs.some(
                  (job) =>
                    job.tileKey === tile.key &&
                    (job.status === 'running' || job.status === 'pending'),
                )
              }
              onClick={() =>
                c.perform(() =>
                  c.activeMapLayer === 'overall' ||
                  c.activeMapLayer === 'object'
                    ? c.enqueue(c.activeMapLayer)
                    : imageLayer && c.generateLayer(tile.key, imageLayer),
                )
              }
            >
              {generateLabel}
            </Button>
            {c.activeMapLayer === 'surface' && (
              <>
                <p className="map-muted">
                  复制不会移除原图物件。独立地表请手动上传，或继续精修草稿。
                </p>
                {tile.surfaceIsDraft && (
                  <div className="map-drawing-hint">
                    <p>
                      这是地表草稿，尚不用于分层合成。清除物件并检查画面后，可手动确认。
                    </p>
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={() => c.perform(c.confirmSurface)}
                    >
                      确认为独立地表
                    </Button>
                  </div>
                )}
              </>
            )}
            <Button
              variant="destructive"
              className="map-full-width"
              disabled={
                !asset ||
                locked ||
                (tile.key === '0,0' && c.activeMapLayer === 'overall')
              }
              onClick={() => c.perform(c.removeImage)}
            >
              <Trash2 />
              删除当前图片
            </Button>
          </>
        )}
      </section>
      <section className="map-panel-section">
        <h3>分层素材</h3>
        <p className="map-muted">
          上传真实地表与透明物件，或上传同一物件的黑白底参考后提取。所有原图独立保存。
        </p>
        <ol className="map-pipeline-status">
          {(['overall', 'surface', 'black', 'white', 'object'] as const).map(
            (layer) => (
              <li key={layer}>
                <span>{IMAGE_VIEW_LABELS[layer]}</span>
                <span>
                  {!tile?.images[layer]
                    ? '待上传'
                    : layer === 'surface' && tile.surfaceIsDraft
                      ? '草稿 · 待去除物件'
                      : tile.imageOrigins?.[layer]
                        ? {
                            uploaded: '已上传',
                            'overall-copy': '已确认独立地表',
                            'alpha-reference': '由透明物件派生',
                            'matte-extraction': '黑白参考提取',
                            'local-fill': '旧版本地补全',
                            'api-generated': 'API 生成',
                            'pixel-edited': '已精修',
                          }[tile.imageOrigins[layer]!]
                        : '已导入'}
                </span>
              </li>
            ),
          )}
        </ol>
        <Button
          variant="outline"
          className="map-full-width"
          disabled={
            !tile?.images.object || c.imageLocks.black || c.imageLocks.white
          }
          onClick={() => c.perform(c.createReferences)}
        >
          由透明物件生成黑白参考
        </Button>
      </section>
      <section className="map-panel-section">
        <h3>扩展与重叠</h3>
        <label>
          中心扩展
          <select
            aria-label="中心扩展数量"
            value={c.expandSplit}
            onChange={(event) =>
              c.setExpandSplit(Number(event.target.value) as 4 | 8 | 12)
            }
          >
            <option value={4}>4 块</option>
            <option value={8}>8 块</option>
            <option value={12}>12 块</option>
          </select>
        </label>
        <div className="map-field-pair">
          <label>
            横向重叠 %
            <input
              aria-label="横向重叠"
              type="number"
              min={0}
              max={50}
              value={c.horizontalOverlap}
              onChange={(event) =>
                c.setHorizontalOverlap(
                  Math.max(0, Math.min(50, Number(event.target.value))),
                )
              }
            />
          </label>
          <label>
            纵向重叠 %
            <input
              aria-label="纵向重叠"
              type="number"
              min={0}
              max={50}
              value={c.verticalOverlap}
              onChange={(event) =>
                c.setVerticalOverlap(
                  Math.max(0, Math.min(50, Number(event.target.value))),
                )
              }
            />
          </label>
        </div>
        <p className="map-muted">这些参数只影响新建扩展卡片。</p>
        <Button
          variant="outline"
          className="map-full-width"
          disabled={!tile}
          onClick={() => c.perform(() => c.expand())}
        >
          从当前卡片向外扩展
        </Button>
        {tile && (
          <>
            <h3>卡片边缘羽化</h3>
            <div className="map-field-pair">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <label key={`${tile.key}:${side}:${tile.feather[side]}`}>
                  {{ top: '上', right: '右', bottom: '下', left: '左' }[side]} %
                  <input
                    aria-label={`${side} 羽化`}
                    type="number"
                    min={0}
                    max={50}
                    defaultValue={tile.feather[side]}
                    onBlur={(event) => {
                      const value = Number(event.target.value);
                      if (value !== tile.feather[side])
                        c.perform(() => c.setFeather(side, value));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                </label>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function RegionPanel({ c }: { c: MapEditorController }) {
  const selected = c.shapes.find((shape) => shape.id === c.selectedShapeId);
  const bounds = selected ? regionBounds(selected.points) : null;
  const tools: Array<{ id: RegionTool; label: string; icon: typeof Pencil }> = [
    { id: 'select', label: '选择', icon: MousePointer2 },
    { id: 'rectangle', label: '矩形', icon: Square },
    { id: 'polygon', label: '多边形', icon: PenTool },
    { id: 'free', label: '自由套索', icon: Pencil },
    { id: 'delete', label: '点选删除', icon: Trash2 },
  ];
  const canDraw =
    c.selectedTile &&
    !c.selectedTile.hidden &&
    isRegionAuthoringMapLayer(c.activeMapLayer);
  return (
    <>
      <section className="map-panel-section">
        <h2>区域标注</h2>
        <p className="map-muted">
          {c.selectedKey ?? '尚未选择地图块'} ·{' '}
          {IMAGE_VIEW_LABELS[c.activeMapLayer]}视图
        </p>
        <label>
          区域显示范围
          <select
            aria-label="区域显示范围"
            value={c.preferences.regionScope}
            onChange={(event) => {
              c.resetSession();
              c.setPreferences((value) => ({
                ...value,
                regionScope: event.target.value === 'tile' ? 'tile' : 'view',
              }));
            }}
          >
            <option value="view">当前图片视图</option>
            <option value="tile">当前卡片的全部视图</option>
          </select>
        </label>
        <p className="map-muted">
          另有 {c.otherViewCount} 个区域属于其他图片视图。参考区域以虚线显示。
        </p>
        <div className="map-region-types">
          {REGION_LAYERS.map((layer) => {
            const meta = REGION_LAYER_META[layer];
            const count = regionsInScope(c.shapes, {
              tileKey: c.selectedKey,
              mapLayer: c.activeMapLayer,
              scope: c.preferences.regionScope,
              layer,
            }).length;
            return (
              <div
                key={layer}
                className={c.activeRegionLayer === layer ? 'active' : ''}
                style={{ borderLeftColor: meta.color }}
              >
                <button
                  type="button"
                  onClick={() => c.chooseRegionLayer(layer)}
                  aria-pressed={c.activeRegionLayer === layer}
                >
                  {meta.label}
                  <span>{count}</span>
                </button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${meta.label}显隐`}
                  aria-pressed={c.regionVisibility[layer]}
                  onClick={() => c.toggleRegionVisibility(layer)}
                >
                  {c.regionVisibility[layer] ? <Eye /> : <EyeOff />}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${meta.label}锁定`}
                  aria-pressed={c.regionLocks[layer]}
                  onClick={() => c.toggleRegionLock(layer)}
                >
                  {c.regionLocks[layer] ? <LockKeyhole /> : <LockKeyholeOpen />}
                </Button>
              </div>
            );
          })}
        </div>
        <p className="map-muted">
          {REGION_LAYER_META[c.activeRegionLayer].description}{' '}
          眼睛只控制辅助标注，区域效果仍参与输出。
        </p>
      </section>
      <section className="map-panel-section">
        <h3>绘制工具</h3>
        <div className="map-region-tools">
          {tools.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={
                c.mode === 'region' && c.regionTool === id
                  ? 'default'
                  : 'outline'
              }
              disabled={
                !canDraw ||
                (id !== 'select' && c.regionLocks[c.activeRegionLayer])
              }
              aria-pressed={c.mode === 'region' && c.regionTool === id}
              onClick={() => c.perform(() => c.chooseTool(id))}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </div>
        {!canDraw && (
          <p className="map-muted">
            选择参与输出的卡片，并切换到整体、地表或物件视图后绘制。
          </p>
        )}
        {c.mode === 'region' && (
          <Button
            variant="outline"
            className="map-full-width"
            onClick={() => {
              c.resetSession();
              c.setMode('navigate');
            }}
          >
            退出区域编辑
          </Button>
        )}
        <output className="map-drawing-hint">{c.hint}</output>
      </section>
      <section className="map-panel-section">
        <h3>
          当前范围 · {c.scopedRegions.length} 个
          {REGION_LAYER_META[c.activeRegionLayer].label}
        </h3>
        <div className="map-region-list">
          {c.scopedRegions.map((shape, index) => (
            <button
              type="button"
              key={shape.id}
              aria-pressed={c.selectedShapeId === shape.id}
              onClick={() => c.perform(() => c.selectRegion(shape.id))}
            >
              <span>
                {index + 1}.{' '}
                {
                  { rectangle: '矩形', polygon: '多边形', free: '自由套索' }[
                    shape.mode
                  ]
                }
              </span>
              <small>
                {IMAGE_VIEW_LABELS[shape.mapLayer]} · {shape.points.length} 点
              </small>
            </button>
          ))}
          {!c.scopedRegions.length && (
            <p className="map-muted">当前范围没有可见区域。</p>
          )}
        </div>
        <Button
          variant="outline"
          className="map-full-width"
          disabled={!c.selectedShapeId || c.regionLocks[c.activeRegionLayer]}
          onClick={() =>
            c.perform(
              () => c.selectedShapeId && c.deleteRegion(c.selectedShapeId),
            )
          }
        >
          删除选中区域
        </Button>
        {selected && bounds && (
          <div className="map-region-properties">
            <span>所选区域：{selected.id}</span>
            <span>
              {IMAGE_VIEW_LABELS[selected.mapLayer]} ·{' '}
              {REGION_LAYER_META[selected.layer].label} ·{' '}
              {selected.points.length} 个顶点
            </span>
            <span>
              卡片坐标 ({Math.round(bounds.left)}, {Math.round(bounds.top)}) ·{' '}
              {Math.round(bounds.width)} × {Math.round(bounds.height)} px
            </span>
          </div>
        )}
        <Button
          variant="destructive"
          className="map-full-width"
          disabled={
            !c.scopedRegions.length || c.regionLocks[c.activeRegionLayer]
          }
          onClick={() => c.perform(c.clearRegions)}
        >
          清空
          {c.preferences.regionScope === 'view' ? '当前视图' : '此卡片全部视图'}
          的 {c.scopedRegions.length} 个区域
        </Button>
        <p className="map-muted">
          只影响当前卡片的{REGION_LAYER_META[c.activeRegionLayer].label}
          ，可撤销。
        </p>
      </section>
    </>
  );
}

function QueuePanel({ c, onSettings }: { c: MapEditorController; onSettings: () => void }) {
  const [limit, setLimit] = useState(8);
  const active = c.queueState.jobs.some(
    (job) => job.status === 'running' || job.status === 'pending',
  );
  return (
    <>
      <section className="map-panel-section">
        <h2>生成队列</h2>
        <p className="map-muted">
          {c.api.settings.active
            ? '使用已激活的图片 API 扩展整体层。'
            : '启用并配置图片 API 后才能生成整体图片。'}{' '}
          物件提取在本地处理黑白参考。
        </p>
        {c.generationUnavailable && <div className="map-drawing-hint">
          <p>{c.generationUnavailable}</p>
          <Button size="sm" variant="outline" onClick={onSettings}>打开 API 设置</Button>
        </div>}
        <div className="map-field-pair">
          <label>
            同时生成
            <select
              aria-label="生成并发数量"
              value={c.preferences.concurrency}
              onChange={(event) =>
                c.setPreferences((value) => ({
                  ...value,
                  concurrency: Number(event.target.value),
                }))
              }
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 块
                </option>
              ))}
            </select>
          </label>
          <label>
            自动扩图上限
            <input
              aria-label="自动扩图上限"
              type="number"
              min={1}
              max={64}
              value={limit}
              onChange={(event) =>
                setLimit(Math.max(1, Math.min(64, Number(event.target.value))))
              }
            />
          </label>
        </div>
        <Button
          className="map-full-width"
          disabled={!c.sourceAsset || active || c.imageLocks.overall || Boolean(c.generationUnavailable)}
          onClick={() => c.perform(() => c.startAutomatic(limit))}
        >
          自动扩展并生成，最多 {limit} 块
        </Button>
        <Button
          variant="outline"
          className="map-full-width"
          disabled={!c.sourceAsset || c.imageLocks.overall || Boolean(c.generationUnavailable)}
          onClick={() => c.perform(() => c.enqueue('overall', true))}
        >
          生成所有空整体卡片
        </Button>
        <Button
          variant="outline"
          className="map-full-width"
          disabled={!c.sourceAsset || c.imageLocks.object}
          onClick={() => c.perform(() => c.enqueue('object', true))}
        >
          提取所有参考就绪的物件
        </Button>
      </section>
      <section className="map-panel-section">
        <h3>内存保护</h3>
        <label className="map-check">
          <input
            type="checkbox"
            checked={c.preferences.memoryProtection}
            onChange={(event) =>
              c.setPreferences((value) => ({
                ...value,
                memoryProtection: event.target.checked,
              }))
            }
          />
          达到上限自动暂停调度
        </label>
        <label>
          内存上限 MB
          <input
            aria-label="内存上限 MB"
            type="number"
            min={64}
            max={8192}
            value={c.preferences.memoryLimitMb}
            onChange={(event) =>
              c.setPreferences((value) => ({
                ...value,
                memoryLimitMb: Math.max(
                  64,
                  Math.min(8192, Number(event.target.value)),
                ),
              }))
            }
          />
        </label>
        <p className="map-muted">
          图片与历史解码估算 {(c.memoryBytes / 1024 / 1024).toFixed(1)}{' '}
          MB。调度时额外预留生成临时画布；不是浏览器总内存读数。
        </p>
        <Button
          variant="outline"
          disabled={(!c.canUndo && !c.canRedo) || active}
          onClick={c.clearHistory}
        >
          释放撤销历史占用
        </Button>
      </section>
      <section className="map-panel-section">
        <h3>任务进度</h3>
        <div className="map-action-grid">
          <Button
            variant="outline"
            disabled={!active}
            onClick={() =>
              c.queueState.paused ? c.queue.resume() : c.queue.pause()
            }
          >
            {c.queueState.paused ? '继续队列' : '暂停队列'}
          </Button>
          <Button
            variant="destructive"
            disabled={!active}
            onClick={c.cancelQueue}
          >
            取消队列
          </Button>
          <Button
            variant="outline"
            disabled={!c.queueState.jobs.some((job) => job.status === 'failed')}
            onClick={() => c.queue.retry()}
          >
            重试失败项
          </Button>
          <Button
            variant="outline"
            disabled={active || !c.queueState.jobs.length}
            onClick={() => c.queue.clear()}
          >
            清除记录
          </Button>
        </div>
        {c.queueState.reason && (
          <output className="map-drawing-hint">{c.queueState.reason}</output>
        )}
        <p className="map-muted">
          暂停不影响进行中的任务。取消会停止新调度并丢弃返回结果；已发出的外部请求可能仍在服务端完成。
        </p>
        <ol className="map-queue-list">
          {c.queueState.jobs.map((job) => (
            <li key={job.id} data-state={job.status}>
              <div>
                <strong>
                  {job.tileKey} · {IMAGE_VIEW_LABELS[job.layer]}
                </strong>
                <span>
                  {
                    {
                      pending: '等待',
                      running: '生成中',
                      completed: '完成',
                      failed: '失败',
                      cancelled: '已取消',
                    }[job.status]
                  }
                </span>
              </div>
              {job.request && <details className="map-job-prompt">
                <summary>查看任务提示词 · {c.api.settings.providers.find((p) => p.id === job.request?.provider)?.name ?? job.request.provider}</summary>
                <pre>{job.request.prompt}</pre>
              </details>}
              {job.error && <p>{job.error}</p>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
