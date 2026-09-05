import type { WorkItem } from './work-items';

const DB = 'workbench-production-v1';
const CHANGED = 'workbench:items-changed';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('items', { keyPath: 'id' });
      request.result.createObjectStore('drafts');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('草稿数据库被其他页面占用，请关闭旧版工作台后重试。'));
  });
}

export async function listWorkItems(): Promise<WorkItem[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('items').objectStore('items').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function readWorkspaceDraft<T>(
  key: string,
): Promise<T | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Draft bytes and their resumable entries commit atomically, including removed objects. */
export async function saveWorkspaceDraft(
  key: string,
  draft: unknown,
  items: WorkItem[],
  currentKey?: string,
) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['drafts', 'items'], 'readwrite');
      tx.objectStore('drafts').put(draft, key);
      if (currentKey) tx.objectStore('drafts').put(key, currentKey);
      const store = tx.objectStore('items');
      const keep = new Set(items.map((item) => item.id));
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (row.value.draftKey === key && !keep.has(row.value.id)) row.delete();
        row.continue();
      };
      items.forEach((item) => store.put(item));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('本机草稿保存已中断。'));
    });
    window.dispatchEvent(new Event(CHANGED));
  } finally {
    db.close();
  }
}

export function subscribeWorkItems(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  window.addEventListener('focus', listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener('focus', listener);
  };
}
