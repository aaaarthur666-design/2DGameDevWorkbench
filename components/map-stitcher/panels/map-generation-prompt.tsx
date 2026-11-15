'use client';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ADDITIONAL_PROMPT_LIMIT,
  composeGenerationPrompt,
} from '@/features/map-stitcher/generation-request';
import type { MapEditorController } from '../use-map-editor-controller';

export function MapGenerationPrompt({
  c,
  onSettings,
}: {
  c: MapEditorController;
  onSettings: () => void;
}) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  const tile = c.selectedTile;
  if (!tile) return null;
  const extra = tile.additionalPrompt ?? '';
  const provider = c.api.settings.providers.find(
    (p) => p.id === c.api.settings.provider,
  );
  return (
    <div className="map-generation-prompt">
      <div className="map-property-title">
        <label htmlFor={id}>额外提示词（可选）</label>
        <Button
          size="sm"
          variant="ghost"
          disabled={!extra}
          onClick={() => c.updateTilePrompt(tile.key, '')}
        >
          清空
        </Button>
      </div>
      <textarea
        id={id}
        rows={3}
        maxLength={ADDITIONAL_PROMPT_LIMIT}
        aria-describedby={`${id}-help ${id}-count`}
        placeholder="例如：延续森林背景，添加一座破旧木桥，保持原有像素风格。"
        value={extra}
        onChange={(event) => c.updateTilePrompt(tile.key, event.target.value)}
      />
      <div className="map-prompt-actions">
        <Button size="sm" variant="ghost" onClick={() => setPreview(true)}>
          查看完整提示词
        </Button>
        <span id={`${id}-count`} className="map-muted">
          {extra.length} / {ADDITIONAL_PROMPT_LIMIT}
        </span>
      </div>
      <p id={`${id}-help`} className="map-muted">
        仅用于当前地图块；留空沿用基础提示词。修改仅影响新任务。
      </p>
      {c.generationUnavailable && (
        <output className="map-drawing-hint">
          <p>{c.generationUnavailable}</p>
          <Button size="sm" variant="outline" onClick={onSettings}>
            打开 API 设置
          </Button>
        </output>
      )}
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="map-dialog map-prompt-dialog">
          <DialogHeader>
            <DialogTitle>完整生成提示词</DialogTitle>
            <DialogDescription>
              地图块 {tile.key} · {provider?.name ?? '未选择服务商'}
              。以下是基础与额外要求；服务端会补充适配模板的输出尺寸约束，实际发送文本保存在任务产物中。已入队任务保留原要求。
            </DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="完整生成提示词"
            readOnly
            rows={14}
            value={composeGenerationPrompt(c.prompt, extra)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
