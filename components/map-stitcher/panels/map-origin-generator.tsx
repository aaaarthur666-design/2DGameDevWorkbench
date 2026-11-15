/* oxlint-disable next/no-img-element -- Preview the locally stored generation artifact. */
'use client';
import { useRef, useState } from 'react';
import { Sparkles, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { generationUnavailableReason } from '@/features/map-stitcher/generation-request';
import type { MapEditorController } from '../use-map-editor-controller';

type Candidate = { image: string; taskId: string; prompt: string };
export function MapOriginGenerator({
  open,
  onOpenChange,
  onSettings,
  c,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettings: () => void;
  c: MapEditorController;
}) {
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const unavailable = generationUnavailableReason(c.api.settings);
  const model = c.api.settings.providers.find(
    (p) => p.id === c.api.settings.provider,
  );
  const generate = async () => {
    if (inFlight.current || !prompt.trim() || unavailable) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const requestedPrompt = prompt.trim();
    try {
      const response = await fetch('/api/workbench/map-stitcher/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'generate-origin',
          prompt: requestedPrompt,
          aspectRatio: ratio,
          provider: c.api.settings.provider,
        }),
      });
      const result = (await response.json()) as {
        image?: string;
        taskId?: string;
        error?: string;
      };
      if (!response.ok || !result.image || !result.taskId)
        throw new Error(
          `${result.error || '原图生成失败。'}${result.taskId ? ` 任务：${result.taskId}` : ''}`,
        );
      setCandidate({
        image: result.image,
        taskId: result.taskId,
        prompt: requestedPrompt,
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '原图生成失败，请检查制作记录后再决定是否重试。',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const adopt = async () => {
    if (!candidate || inFlight.current || c.busy) return;
    inFlight.current = true;
    setApplying(true);
    setError('');
    try {
      const response = await fetch(candidate.image);
      if (!response.ok)
        throw new Error('无法读取原图，请重试采用；无需重新生成。');
      const file = new File(
        [await response.blob()],
        `地图原图-${candidate.taskId}.png`,
        { type: 'image/png' },
      );
      await c.importImages([file], 'api-generated');
      c.setHint('原图已用作中心图。选择周围卡片即可继续扩图。');
      onOpenChange(false);
      setCandidate(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '原图采用失败。');
    } finally {
      inFlight.current = false;
      setApplying(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!inFlight.current) onOpenChange(value);
      }}
    >
      <DialogContent className="map-origin-dialog">
        <DialogHeader>
          <DialogTitle>生成地图原图</DialogTitle>
          <DialogDescription>
            描述地图环境，先生成一张原图。确认采用后，它将成为中心图，用于继续向外扩展。
          </DialogDescription>
        </DialogHeader>
        <div className="map-origin-body">
          <div className="map-origin-form">
            <label htmlFor="map-origin-prompt">你想制作怎样的地图？</label>
            <Textarea
              id="map-origin-prompt"
              value={prompt}
              maxLength={12000}
              disabled={busy || applying}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="例如：像素风俯视角森林营地，小路穿过中央，周围有帐篷、篝火和溪流。无人物、无文字。"
            />
            <fieldset disabled={busy || applying}>
              <legend>画幅</legend>
              <div className="map-origin-ratios">
                {(
                  [
                    ['1:1', '方形'],
                    ['3:2', '横向'],
                    ['2:3', '竖向'],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    variant={ratio === value ? 'default' : 'outline'}
                    aria-pressed={ratio === value}
                    onClick={() => setRatio(value)}
                  >
                    {label} {value}
                  </Button>
                ))}
              </div>
            </fieldset>
            <p className="map-origin-model">
              {model?.name || '尚未选择模型'} · 沿用地图生成设置
            </p>
            {unavailable && <output>{unavailable}</output>}
            <Button
              variant="outline"
              disabled={busy || applying}
              onClick={onSettings}
            >
              生成设置
            </Button>
            <Button
              disabled={busy || applying || !!unavailable || !prompt.trim()}
              onClick={() => void generate()}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              {busy ? '正在生成原图…' : candidate ? '再生成一张' : '生成原图'}
            </Button>
            <p className="map-origin-note">
              点击生成会调用所选图片 API。每次生成一张，完成前请保留此页面。
            </p>
          </div>
          <div className="map-origin-result">
            {candidate ? (
              <>
                <img src={candidate.image} alt="待采用的地图原图" />
                <p className="map-origin-note">{candidate.prompt}</p>
                <a href={candidate.image} download="地图原图.png">
                  下载原图
                </a>
                {c.sourceAsset && (
                  <p className="map-origin-note">
                    采用时会先保存当前地图，再以此原图建立新地图。
                  </p>
                )}
                <Button
                  disabled={busy || applying || c.busy}
                  onClick={() => void adopt()}
                >
                  {applying ? '正在载入…' : '用作中心图'}
                </Button>
              </>
            ) : (
              <p>生成结果将在这里预览。当前地图会保持原样，直到你确认采用。</p>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="map-origin-error">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
