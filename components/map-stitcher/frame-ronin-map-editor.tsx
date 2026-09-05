'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
  CircleHelp,
  Download,
  FolderOpen,
  Layers3,
  PanelRight,
  Redo2,
  Save,
  Settings,
  Undo2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Toaster } from '@/components/ui/toast';
import {
  MAP_DISPLAY_LAYERS,
  REGION_LAYER_META,
} from '@/features/map-stitcher/frame-ronin-types';
import {
  hasImageView,
  IMAGE_VIEW_LABELS,
} from '@/features/map-stitcher/editor-selectors';
import {
  useMapEditorController,
  type MapExportFormat,
} from './use-map-editor-controller';
import { useMapAgentTools } from './use-map-agent-tools';
import { MapCanvas } from './canvas/map-canvas';
import { MapInspector } from './panels/map-inspector';
import { MapApiSettingsDialog } from './panels/map-api-settings';
import { ImageFineEditor } from './editors/image-fine-editor';
import './frame-ronin-editor.css';

export function FrameRoninMapEditor() {
  const c = useMapEditorController();
  useMapAgentTools(c);
  const sourceInput = useRef<HTMLInputElement>(null),
    layerInput = useRef<HTMLInputElement>(null),
    stateInput = useRef<HTMLInputElement>(null),
    directoryInput = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false);
  const openSettings = () => {
    c.resetSession();
    setSettingsOpen(true);
  };
  const activeCount = c.tiles.filter((tile) =>
    hasImageView(tile, c.activeMapLayer),
  ).length;
  const doExport = (format: MapExportFormat) =>
    c.perform(async () => {
      await c.exportArtifact(format);
      setExportOpen(false);
      c.setHint('文件已导出。');
    });
  return (
    <Toaster>
      <main className="map-workspace" data-map-editor>
        <header className="map-project-bar">
          <div className="map-project-title">
            <Layers3 size={21} />
            <h1>地图拼接</h1>
            <span>{c.tiles.length} 块</span>
          </div>
          <div className="map-project-actions">
            <Button
              variant="outline"
              disabled={c.busy}
              onClick={() => sourceInput.current?.click()}
            >
              <Upload />
              新建 / 导入
            </Button>
            <Button
              variant="outline"
              disabled={c.busy}
              onClick={() => stateInput.current?.click()}
            >
              <FolderOpen />
              打开状态 / Godot
            </Button>
            <Button
              variant="outline"
              disabled={c.busy || !c.sourceAsset}
              onClick={() => doExport('state')}
            >
              <Save />
              保存
            </Button>
            <Button
              disabled={c.busy || !c.sourceAsset}
              onClick={() => {
                c.resetSession();
                setExportOpen(true);
              }}
            >
              <Download />
              导出
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="生成设置"
              onClick={openSettings}
            >
              <Settings />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="地图帮助"
              onClick={() => {
                c.resetSession();
                setHelpOpen(true);
              }}
            >
              <CircleHelp />
            </Button>
          </div>
        </header>
        <div className="map-view-bar">
          <fieldset className="map-primary-views" aria-label="图片视图">
            {(['overall', 'surface', 'object'] as const).map((layer) => (
              <Button
                key={layer}
                variant={
                  c.activeMapLayer === layer && !c.exportPreview
                    ? 'default'
                    : 'ghost'
                }
                aria-pressed={c.activeMapLayer === layer && !c.exportPreview}
                onClick={() => c.selectView(layer)}
              >
                {IMAGE_VIEW_LABELS[layer]}
                <span>
                  {c.tiles.filter((tile) => hasImageView(tile, layer)).length}/
                  {c.tiles.length}
                </span>
              </Button>
            ))}
            <select
              aria-label="参考与派生预览"
              value={
                ['black', 'white', 'mask'].includes(c.activeMapLayer) &&
                !c.exportPreview
                  ? c.activeMapLayer
                  : ''
              }
              onChange={(event) => {
                const layer = event.target.value;
                if (
                  MAP_DISPLAY_LAYERS.includes(layer as typeof c.activeMapLayer)
                )
                  c.selectView(layer as typeof c.activeMapLayer);
              }}
            >
              <option value="" disabled>
                参考与派生
              </option>
              <option value="black">黑底参考</option>
              <option value="white">白底参考</option>
              <option value="mask">Mask · 只读</option>
            </select>
          </fieldset>
          <div className="map-view-options">
            <label className="map-check">
              <input
                type="checkbox"
                checked={c.preferences.showImage}
                onChange={(event) =>
                  c.setPreferences((value) => ({
                    ...value,
                    showImage: event.target.checked,
                  }))
                }
              />
              底图
            </label>
            <label className="map-check">
              <input
                type="checkbox"
                checked={c.preferences.showRegions}
                onChange={(event) => {
                  c.resetSession();
                  c.setPreferences((value) => ({
                    ...value,
                    showRegions: event.target.checked,
                  }));
                }}
              />
              区域标注
            </label>
            <label className="map-check">
              <input
                type="checkbox"
                checked={c.hideCards && c.hideBorders}
                onChange={(event) => {
                  c.setHideCards(event.target.checked);
                  c.setHideBorders(event.target.checked);
                }}
              />
              干净预览
            </label>
            <Button
              size="sm"
              variant={c.exportPreview ? 'default' : 'outline'}
              disabled={!c.sourceAsset}
              aria-pressed={c.exportPreview}
              onClick={() => {
                c.resetSession();
                c.setExportPreview((value) => !value);
              }}
            >
              导出效果
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="撤销地图修改"
              title={c.undoLabel ? `撤销：${c.undoLabel}` : '没有可撤销的修改'}
              disabled={!c.canUndo || c.busy}
              onClick={c.undo}
            >
              <Undo2 />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="重做地图修改"
              title={c.redoLabel ? `重做：${c.redoLabel}` : '没有可重做的修改'}
              disabled={!c.canRedo || c.busy}
              onClick={c.redo}
            >
              <Redo2 />
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-expanded={c.panelOpen}
              onClick={() => c.setPanelOpen((value) => !value)}
            >
              <PanelRight />
              属性
            </Button>
          </div>
        </div>
        <div className={`map-work-area ${c.panelOpen ? 'panel-open' : ''}`}>
          <MapCanvas
            c={c}
            disabled={
              c.busy ||
              settingsOpen ||
              helpOpen ||
              exportOpen ||
              Boolean(c.fineSession)
            }
            onImport={() => sourceInput.current?.click()}
          />
          <MapInspector c={c} onUpload={() => layerInput.current?.click()} />
        </div>
        <footer className="map-status-bar">
          <span>
            {c.selectedKey ?? '未选卡片'} ·{' '}
            {IMAGE_VIEW_LABELS[c.activeMapLayer]} {activeCount}/{c.tiles.length}
          </span>
          <span>
            {c.mode === 'region'
              ? `${REGION_LAYER_META[c.activeRegionLayer].label} · ${{ select: '选择', rectangle: '矩形', polygon: '多边形', free: '自由套索', delete: '删除' }[c.regionTool]}`
              : c.mode === 'pixel'
                ? '像素精修'
                : '地图浏览'}
          </span>
          <output className="map-status-hint">
            {c.busy ? '正在处理文件…' : c.hint}
          </output>
          <span>
            {c.imageCount} 图 · {c.shapes.length} 区域
          </span>
        </footer>
        <input
          ref={sourceInput}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp,.jfif"
          multiple
          aria-label="新建地图图片"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            c.perform(() => c.importImages(files));
          }}
        />
        <input
          ref={layerInput}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp,.jfif"
          multiple
          aria-label="当前卡片图片"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            c.perform(() => c.uploadToLayer(files));
          }}
        />
        <input
          ref={stateInput}
          className="sr-only"
          type="file"
          accept=".zip,.json,image/png,image/jpeg,image/webp"
          multiple
          aria-label="打开地图状态或 Godot"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length) c.perform(() => c.openProject(files));
          }}
        />
        <input
          ref={directoryInput}
          className="sr-only"
          type="file"
          multiple
          {...{ webkitdirectory: '' }}
          aria-label="打开 Godot 资源文件夹"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length) c.perform(() => c.openProject(files));
          }}
        />
        {settingsOpen && (
          <MapApiSettingsDialog
            api={c.api}
            prompt={c.prompt}
            setPrompt={c.setPrompt}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        <Dialog open={exportOpen} onOpenChange={setExportOpen}>
          <DialogContent className="map-export-dialog">
            <DialogHeader>
              <DialogTitle>导出地图</DialogTitle>
              <DialogDescription>
                标注显隐不会停用区域。已排除输出的卡片只保留在完整编辑源中。
              </DialogDescription>
            </DialogHeader>
            <div className="map-export-options">
              {(
                [
                  ['png', '当前图片视图 PNG'],
                  ['composite', '导出效果 PNG'],
                  ['all-png', '全部图片层 PNG · ZIP'],
                  ['top-png', '顶层区域 PNG'],
                  ['psd', '分层 PSD'],
                  ['godot', 'Godot 包 · 含完整编辑源'],
                  ['state', 'Pixelwork 编辑状态'],
                ] as const
              ).map(([format, label]) => (
                <Button
                  key={format}
                  variant="outline"
                  disabled={
                    c.busy ||
                    (format === 'top-png' &&
                      !c.shapes.some((shape) => shape.layer === 'top'))
                  }
                  onClick={() => doExport(format)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="map-help-dialog">
            <DialogHeader>
              <DialogTitle>地图编辑操作</DialogTitle>
              <DialogDescription>
                图片视图、区域标注和像素精修分别操作。
              </DialogDescription>
            </DialogHeader>
            <div className="map-help-copy">
              <p>
                先选地图块，再切换整体、地表或物件视图。在区域页签选择类别和工具后直接绘制。
              </p>
              <p>
                矩形点击两次；多边形按 Enter / C
                完成；自由套索按住左键绘制，松开闭合。区域显隐只控制辅助标注。
              </p>
              <p>
                中键、右键或空格 + 左键平移。0 适配画布，H 切换卡片标签。Esc
                依次取消草稿、选择和编辑；Ctrl / Cmd + Z 撤销，Shift + Ctrl /
                Cmd + Z 重做。
              </p>
              <p>
                新建 / 导入会建立新地图。开始新项目之前，请先保存当前状态。新
                Godot 包包含完整编辑源；旧包可能只能恢复合成图片。
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setHelpOpen(false);
                  directoryInput.current?.click();
                }}
              >
                打开资源文件夹（清单与图片）
              </Button>
              <Link href="/tools/map-stitcher-legacy">打开旧版编辑器</Link>
            </div>
          </DialogContent>
        </Dialog>
        {c.fineSession && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) c.closeFineEdit();
            }}
          >
            <DialogContent className="map-fine-dialog" showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>
                  像素精修 · {IMAGE_VIEW_LABELS[c.fineSession.ticket.layer]}
                </DialogTitle>
                <DialogDescription>
                  只修改当前卡片图片。保存后可从地图历史撤销。
                </DialogDescription>
              </DialogHeader>
              <div className="map-stitcher-surface map-fine-container">
                <ImageFineEditor
                  width={c.fineSession.original.width}
                  height={c.fineSession.original.height}
                  imageUrl={c.fineSession.original.url}
                  tileKey={c.fineSession.ticket.tileKey}
                  layerLabel={IMAGE_VIEW_LABELS[c.fineSession.ticket.layer]}
                  onCancel={c.closeFineEdit}
                  onApply={async (blob) => {
                    try {
                      await c.applyFineEdit(blob);
                    } catch (error) {
                      c.report(error);
                    }
                  }}
                />
              </div>
            </DialogContent>
          </Dialog>
        )}
      </main>
    </Toaster>
  );
}
