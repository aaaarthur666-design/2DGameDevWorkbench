'use client';
import { useState } from 'react';
import {
  ChevronDown,
  CircleHelp,
  Layers3,
  LoaderCircle,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkbench } from './workbench-provider';

export function EditorWorkbenchMenu() {
  const wb = useWorkbench();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" aria-label="工作台导航" />}
      >
        <span className="map-workbench-mark">2D</span>
        <ChevronDown size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="map-compact-menu">
        <DropdownMenuItem onClick={() => void wb.navigate('/')}>
          工作台开始页
        </DropdownMenuItem>
        {wb.lines.map((line) => (
          <DropdownMenuItem
            key={line.id}
            onClick={() => void wb.navigate(line.href)}
          >
            {line.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => wb.setQueueOpen(true)}>
          <Layers3 />
          制作记录
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void wb.navigate('/advanced')}>
          高级工具与服务状态
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            window.dispatchEvent(new Event('workbench:restart-guide'));
            wb.setGuideOpen(true);
          }}
        >
          <CircleHelp />
          新手引导
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EditorDraftControl({ capabilityId }: { capabilityId: string }) {
  const wb = useWorkbench();
  const session = wb.sessions.find(
    (entry) => entry.capabilityId === capabilityId,
  );
  const [saving, setSaving] = useState(false);
  const item = session?.items[0];
  const failed = Boolean(
    wb.storageError ||
    wb.navigationError ||
    (item?.state === 'attention' && /草稿.*失败/.test(item.detail)),
  );
  const label = failed
    ? '草稿需处理'
    : session?.dirty || saving
      ? '正在保存修改…'
      : item?.savedAt
        ? '本机草稿已保存'
        : '准备素材';
  return (
    <Button
      className="map-draft-control"
      variant="ghost"
      size="sm"
      disabled={saving || !item}
      aria-label={`保存草稿：${label}`}
      title={`${label} · 点击保存本机草稿`}
      data-error={failed}
      onClick={async () => {
        if (!session) return;
        setSaving(true);
        try {
          await session.save();
          wb.setNavigationError('');
        } catch (error) {
          wb.setNavigationError(
            error instanceof Error
              ? error.message
              : '草稿保存失败，请下载编辑源文件。',
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      {session?.dirty || saving ? (
        <LoaderCircle className="wb-spin" />
      ) : (
        <Save />
      )}
      <span>{label}</span>
    </Button>
  );
}

export function EditorTaskSummary({ compact = false }: { compact?: boolean }) {
  const wb = useWorkbench();
  const running = wb.items.filter((item) => item.state === 'running').length;
  const attention = wb.items.filter(
    (item) => item.state === 'attention',
  ).length;
  const offline =
    wb.runtimeOnline === false ||
    (wb.spriteOnline === false &&
      wb.items.some((item) => item.capabilityId === 'sprite-generator'));
  const label = [
    running ? `制作中 ${running}` : '制作记录',
    attention ? `待处理 ${attention}` : '',
    offline ? '状态连接中断' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <button
      type="button"
      className="map-task-summary"
      data-attention={attention > 0 || offline}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={wb.queueOpen}
      title={label}
      onClick={() => wb.setQueueOpen(true)}
    >
      <Layers3 size={14} />
      <span>
        {compact
          ? attention || offline
            ? '需处理'
            : running || '记录'
          : label}
      </span>
    </button>
  );
}
