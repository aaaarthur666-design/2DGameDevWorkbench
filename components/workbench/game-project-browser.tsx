'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Folder, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type SelectedGameProject = {
  path: string;
  name: string;
  versionWarning?: string | null;
};
type DirectoryPage = {
  directory: string;
  parent: string | null;
  roots: { path: string; name: string }[];
  folders: { path: string; name: string }[];
  truncated: boolean;
  project: SelectedGameProject | null;
  projectIssue: string | null;
};
export function GameProjectBrowser({
  initialPath,
  getToken,
  onSelect,
  onCancel,
}: {
  initialPath: string;
  getToken: () => string;
  onSelect: (project: SelectedGameProject) => void;
  onCancel: () => void;
}) {
  const [startPath] = useState(initialPath),
    [address, setAddress] = useState(initialPath);
  const [page, setPage] = useState<DirectoryPage | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const active = useRef<{ serial: number; addressRevision:number; controller: AbortController | null }>(
    { serial: 0, addressRevision:0, controller: null },
  );
  const browse = useCallback(
    async (directory?: string) => {
      const state = active.current;
      state.controller?.abort();
      const controller = new AbortController();
      state.controller = controller;
      const serial = ++state.serial;
      const addressRevision=state.addressRevision;
      setLoading(true);
      setError('');
      try {
        const response = await fetch('/api/workbench/game-export/browse', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forge-game-token': getToken(),
          },
          body: JSON.stringify(
            directory?.trim() ? { directory: directory.trim() } : {},
          ),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(8000),
          ]),
          cache: 'no-store',
        });
        const data = (await response.json()) as DirectoryPage & {
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || '无法读取文件夹。');
        if (serial === state.serial && !controller.signal.aborted) {
          setPage(data);
          if(state.addressRevision===addressRevision)setAddress(data.directory);
        }
      } catch (e) {
        if (serial === state.serial && !controller.signal.aborted)
          setError(
            (e as Error).name === 'TimeoutError'
              ? '读取文件夹超时，可以取消选择并直接输入项目路径。'
              : (e as Error).message,
          );
      } finally {
        if (serial === state.serial && !controller.signal.aborted)
          setLoading(false);
      }
    },
    [getToken],
  );
  useEffect(() => {
    const state = active.current;
    const timer=setTimeout(()=>void browse(startPath),0);
    return () => {
      clearTimeout(timer);
      state.serial++;
      state.controller?.abort();
    };
  }, [browse, startPath]);
  return (
    <section
      aria-label="选择游戏项目文件夹"
      className="grid gap-3 rounded-lg border border-border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <strong>选择游戏项目文件夹</strong>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消选择
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {page?.roots.map((root) => (
          <Button
            key={root.path}
            size="sm"
            variant="outline"
            onClick={() => void browse(root.path)}
          >
            {root.name}
          </Button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void browse(address);
        }}
      >
        <input
          aria-label="浏览文件夹路径"
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
          value={address}
          onChange={(e) => {active.current.addressRevision++;setAddress(e.target.value);}}
          placeholder="输入文件夹路径"
        />
        <Button type="submit" variant="outline" size="sm">
          打开路径
        </Button>
      </form>
      {page?.parent && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-start"
          onClick={() => void browse(page.parent!)}
        >
          <ArrowUp className="size-4" />
          上一级
        </Button>
      )}
      {loading ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          正在读取文件夹…
        </p>
      ) : (
        <div className="max-h-44 overflow-y-auto">
          {page?.folders.map((folder) => (
            <button
              key={folder.path}
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-muted"
              onClick={() => void browse(folder.path)}
            >
              <Folder className="size-4 shrink-0" />
              <span className="break-all">{folder.name}</span>
            </button>
          ))}
          {page && !page.folders.length && (
            <p className="text-muted-foreground">没有子文件夹。</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {page?.truncated && (
        <p className="text-muted-foreground">
          仅列出前 500 个文件夹；可输入更具体的路径。
        </p>
      )}
      {!loading && !error &&
        page &&
        (page.project ? (
          <>
            <p>
              已找到游戏：<strong>{page.project.name}</strong>
            </p>
            <Button disabled={address!==page.directory} onClick={() => onSelect(page.project!)}>
              使用这个项目
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">
            {page.projectIssue ||
              '当前文件夹没有 project.godot，请继续打开游戏项目文件夹。'}
          </p>
        ))}
    </section>
  );
}
