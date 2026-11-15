'use client';
import type { DocumentSyncState } from '@/features/editor-documents/sync-controller.mjs';
export function DocumentSyncStatus({ state, disabled }: {
  state: DocumentSyncState & { retry: () => Promise<void> | undefined; reloadRemote: () => Promise<void> | undefined };
  disabled?: boolean;
}) {
  return <div className="wb-document-sync" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '7px 12px', fontSize: 12 }}>
    <output aria-live="polite">{state.message}</output>
    {(state.status === 'offline' || state.status === 'conflict') && <button disabled={disabled} onClick={() => void state.retry()}>重新连接共享工程</button>}
    {state.conflict && <button disabled={disabled} onClick={() => void state.reloadRemote()}>备份本机并读取共享版本</button>}
  </div>;
}
