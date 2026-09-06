'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLiveState } from '../use-live-state';
import { DEFAULT_OVERALL_PROMPT } from '@/features/map-stitcher/frame-ronin-types';

export interface MapApiSettings {
  active: boolean;
  provider: string | null;
  providers: Array<{
    id: string;
    name: string;
    host: string;
    model: string;
    configured: boolean;
    setupUrl?: string;
    usageNote?: string;
  }>;
}
export function useMapApiSettings() {
  const [settings, setSettings, settingsRef] = useLiveState<MapApiSettings>({
    active: false,
    provider: null,
    providers: [],
  });
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/workbench/map-stitcher/settings', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string };
        if (!response.ok)
          throw new Error(payload?.error || '无法读取 API 设置');
        setSettings(readSettings(payload));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : '无法读取 API 设置',
          );
      });
    return () => controller.abort();
  }, [setSettings]);
  return { settings, settingsRef, setSettings, error, setError };
}
function readSettings(value: unknown): MapApiSettings {
  if (!value || typeof value !== 'object') throw new Error('API 设置响应无效');
  const data = value as Record<string, unknown>;
  const providers = Array.isArray(data.providers)
    ? data.providers
        .filter((item): item is MapApiSettings['providers'][number] =>
          Boolean(
            item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            typeof item.host === 'string' &&
            typeof item.model === 'string',
          ),
        )
        .map((item) => ({
          id: item.id,
          name: item.name,
          host: item.host,
          model: item.model,
          configured: item.configured === true,
          setupUrl: item.setupUrl,
          usageNote: item.usageNote,
        }))
    : [];
  return {
    active: data.active === true,
    provider:
      typeof data.provider === 'string' &&
      providers.some((item) => item.id === data.provider)
        ? data.provider
        : (providers[0]?.id ?? null),
    providers,
  };
}
export function MapApiSettingsDialog({
  api,
  prompt,
  setPrompt,
  onClose,
}: {
  api: ReturnType<typeof useMapApiSettings>;
  prompt: string;
  setPrompt: (value: string) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(api.settings.active);
  const [provider, setProvider] = useState(
    api.settings.provider ?? api.settings.providers[0]?.id ?? '',
  );
  const [saving, setSaving] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);
  const selected = api.settings.providers.find((item) => item.id === provider);
  const save = async () => {
    if (active && !prompt.trim()) {
      api.setError('整体层生成提示词不能为空。');
      return;
    }
    setSaving(true);
    api.setError('');
    try {
      const apiKey = keyRef.current?.value.trim();
      const response = await fetch('/api/workbench/map-stitcher/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          active,
          provider,
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload?.error || 'API 设置保存失败');
      api.setSettings(readSettings(payload));
      if (keyRef.current) keyRef.current.value = '';
      onClose();
    } catch (error) {
      api.setError(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="map-api-dialog">
        <DialogHeader>
          <DialogTitle>地图生成设置</DialogTitle>
          <DialogDescription>
            图片 API
            用于地图原图生成与整体层扩图。地表与透明物件可直接上传，或使用有效的黑白参考提取物件。
          </DialogDescription>
        </DialogHeader>
        <div className="map-form-grid">
          <label className="map-check">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            激活图片 API
          </label>
          <label>
            图片 API 模式
            <select
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value);
                if (keyRef.current) keyRef.current.value = '';
              }}
            >
              <option value="" disabled>
                选择服务
              </option>
              {api.settings.providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Host<output>{selected?.host ?? '—'}</output>
          </label>
          <label>
            Model<output>{selected?.model ?? '—'}</output>
          </label>
          {selected?.usageNote && <p className="map-muted">{selected.usageNote}</p>}
          {selected?.setupUrl && <a href={selected.setupUrl} target="_blank" rel="noreferrer">开通账号 / 获取 API Key ↗</a>}
          <label>
            API Key
            <input
              ref={keyRef}
              type="password"
              autoComplete="off"
              placeholder={
                selected?.configured
                  ? '已配置；留空保持不变'
                  : '输入所选服务的密钥'
              }
            />
          </label>
          <p className="map-muted">
            密钥由服务端保管，网页不会回显。此处填写的密钥在当前服务运行期间有效；关闭 API 后停止原图生成与扩图。
          </p>
          <label>
            整体层提示词
            <textarea
              rows={7}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <p className="map-muted">
            默认用于纯 2D 横版侧视背景。地图块的额外提示词会追加在此基础提示词后；修改仅影响新加入的任务。
          </p>
          <Button
            variant="outline"
            onClick={() => setPrompt(DEFAULT_OVERALL_PROMPT)}
          >
            恢复横版侧视默认词
          </Button>
          {api.error && (
            <p role="alert" className="map-error">
              {api.error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            关闭
          </Button>
          <Button disabled={saving || !provider} onClick={() => void save()}>
            {saving ? '正在保存…' : active ? '保存并激活 API' : '保存 API 设置'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
