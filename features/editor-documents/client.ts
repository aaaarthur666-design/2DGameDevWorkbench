export type DocumentKind = 'scene' | 'interactable';
export interface SharedDocument<T = unknown> {
  id: string;
  kind: DocumentKind;
  revision: number;
  name: string;
  content: T;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  viewPath: string;
}
export interface DocumentResult<T> {
  document: SharedDocument<T>;
  currentRevision?: number;
  replayed?: boolean;
}
export class DocumentClientError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'DocumentClientError';
  }
}
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/workbench/documents${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(90000),
  });
  const value = await response.json() as { error?: unknown; code?: string };
  if (!response.ok) throw new DocumentClientError(typeof value.error === 'string' ? value.error : '共享工程请求未完成。', response.status, value.code);
  return value as T;
}
export function readDocument<T>(id: string, revision?: number) {
  return request<DocumentResult<T>>(`/${encodeURIComponent(id)}${revision === undefined ? '' : `?revision=${revision}`}`);
}
export function readDocumentMetadata(id: string) {
  return request<DocumentResult<never>>(`/${encodeURIComponent(id)}?metadataOnly=true`);
}
export function listDocuments<T>(kind?: DocumentKind, offset = 0) {
  const query = new URLSearchParams({ offset: String(offset), limit: '100' });
  if (kind) query.set('kind', kind);
  return request<{ documents: Array<SharedDocument<T>>; total: number; nextOffset?: number }>(`?${query}`);
}
export function createDocument<T>(kind: DocumentKind, content: T, commandId = crypto.randomUUID()) {
  return request<DocumentResult<T>>('', { kind, content, commandId });
}
export function saveDocument<T>(id: string, expectedRevision: number, content: T, commandId = crypto.randomUUID()) {
  return request<DocumentResult<T>>(`/${encodeURIComponent(id)}/save`, { expectedRevision, content, commandId });
}
export function applyDocument<T>(id: string, expectedRevision: number, commands: Array<Record<string, unknown>>, commandId = crypto.randomUUID()) {
  return request<DocumentResult<T>>(`/${encodeURIComponent(id)}/apply`, { expectedRevision, commands, commandId });
}
