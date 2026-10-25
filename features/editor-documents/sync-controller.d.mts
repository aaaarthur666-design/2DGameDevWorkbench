import type { DocumentKind, DocumentResult, SharedDocument } from './client';
export type DocumentSyncCache = { revision: number | null; fingerprint: string | null; pending?: { commandId: string; expectedRevision: number; fingerprint: string } };
export type DocumentSyncState = { status: 'connecting' | 'pending' | 'saving' | 'synced' | 'offline' | 'conflict'; message: string; revision: number | null; conflict: boolean };
export type DocumentSavedSnapshot<T> = { document: SharedDocument<T>; fingerprint: string };
export type SyncOptions<T> = {
  id: string; kind: DocumentKind; current: () => T; busy: () => boolean;
  prepare: (snapshot: T) => T | Promise<T>;
  saveLocal: (snapshot: T) => Promise<void>;
  applyRemote: (snapshot: T) => Promise<void>;
  backupLocal: (snapshot: T) => Promise<string>;
  readCache: () => Promise<DocumentSyncCache | undefined>;
  writeCache: (cache: DocumentSyncCache) => Promise<void>;
  api: {
    read: (id: string) => Promise<DocumentResult<T>>;
    metadata: (id: string) => Promise<{ document: Omit<SharedDocument<T>, 'content'> }>;
    save: (id: string, revision: number, content: T, commandId: string) => Promise<DocumentResult<T>>;
    create: (kind: DocumentKind, content: T, commandId: string) => Promise<DocumentResult<T>>;
  };
};
export function documentFingerprint(value: unknown): Promise<string>;
export class DocumentSyncController<T> {
  constructor(options: SyncOptions<T>);
  getState: () => DocumentSyncState;
  subscribe: (listener: () => void) => () => void;
  initialize(): Promise<void>;
  sync(): Promise<void>;
  retry(): Promise<void>;
  poll(): Promise<void>;
  reloadRemote(): Promise<void>;
  flushSaved(): Promise<DocumentSavedSnapshot<T>>;
  acceptAdopted(document: SharedDocument<T>, guard: DocumentSavedSnapshot<T>): Promise<DocumentSavedSnapshot<T>>;
  dispose(): void;
}
