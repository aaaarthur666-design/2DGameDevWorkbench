'use client';
/* oxlint-disable next/no-html-link-for-pages -- WorkbenchProvider guards navigation. */
import { useState } from 'react';
import { clearLocalProjects } from '@/lib/workbench/browser-store';
import { useWorkbench } from './workbench-provider';

export function ClearHistory() {
  const wb = useWorkbench();
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [blockers, setBlockers] = useState<{ id: string; href: string }[]>([]);
  const active = wb.items.filter((item) => item.state === 'running');
  const clear = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    setBlockers([]);
    try {
      if (wb.sessions.some((session) => session.busy) || active.length)
        throw new Error('仍有制作任务运行，请先处理下方记录。');
      if (confirm === 'archive') {
        const response = await fetch('/api/workbench/history', {
          method: 'DELETE',
        });
        const result = (await response.json()) as {
          error?: string;
          runtimeCount?: number;
          spriteCount?: number;
          blockers?: { id: string; href: string }[];
        };
        setBlockers(result.blockers || []);
        if (!response.ok) throw new Error(result.error || '归档失败。');
        setMessage(
          `已归档 ${result.runtimeCount ?? 0} 条后台任务和 ${result.spriteCount ?? 0} 条序列帧作业。导出素材与浏览器草稿已保留。`,
        );
      } else {
        const count = wb.localItems.length;
        await clearLocalProjects();
        setMessage(
          `已删除此浏览器的项目与草稿（${count} 条制作记录）。后台记录与导出素材已保留。`,
        );
      }
      setConfirm(null);
      await wb.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <section className="wb-history-settings">
        <h2>归档后台制作记录</h2>
        <p>
          当前读取到 {wb.tasks.length} 条后台任务、{wb.spriteItems.length}{' '}
          条序列帧作业。归档后从制作列表移除；保留导出素材、角色资产、配置及任务凭据。尚在生成或需要恢复的作业会阻止归档。
        </p>
        <p>
          包含已完成、失败和未执行的历史记录；可继续编辑的浏览器草稿会留在列表中。
        </p>
        <button
          className="wb-button"
          disabled={busy}
          onClick={() => {
            setConfirm('archive');
            setError('');
            setMessage('');
          }}
        >
          归档后台记录
        </button>
      </section>
      <section className="wb-history-settings">
        <h2>删除浏览器项目与草稿</h2>
        <p>
          此浏览器中有 {wb.localItems.length}{' '}
          条本机制作记录。此操作删除所有本机项目和草稿，不会删除后台任务或导出素材。
        </p>
        <button
          className="wb-button wb-danger"
          disabled={busy}
          onClick={() => {
            setConfirm('delete');
            setError('');
            setMessage('');
          }}
        >
          删除浏览器草稿
        </button>
      </section>
      {confirm && (
        <section className="wb-history-settings" aria-label="确认数据整理">
          <h2>
            {confirm === 'archive' ? '确认归档后台记录' : '确认删除浏览器草稿'}
          </h2>
          <p>
            {confirm === 'archive'
              ? '后台历史将从列表隐藏；文件仍保存在原处。'
              : '删除无法撤销。请先下载需要保留的源文件，并关闭其他编辑页面。'}
          </p>
          <div className="wb-history-actions">
            <button
              className="wb-button"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              取消
            </button>
            <button
              className={`wb-button ${confirm === 'delete' ? 'wb-danger' : ''}`}
              disabled={busy}
              onClick={() => void clear()}
            >
              {busy
                ? '正在处理…'
                : confirm === 'archive'
                  ? '确认归档'
                  : '确认删除草稿'}
            </button>
          </div>
        </section>
      )}
      {active.length > 0 && (
        <section className="wb-history-settings">
          <h2>请先完成这些制作</h2>
          {active.map((item) => (
            <a
              className="wb-artifact"
              key={item.id}
              href={`/advanced?tab=records&item=${encodeURIComponent(item.id)}`}
            >
              {item.title}
            </a>
          ))}
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {blockers.map((entry) => (
        <a className="wb-artifact" key={entry.id} href={entry.href}>
          处理作业：{entry.id}
        </a>
      ))}
      {message && <output className="wb-notice">{message}</output>}
      {wb.storageError && <p role="alert">{wb.storageError}</p>}
    </div>
  );
}
