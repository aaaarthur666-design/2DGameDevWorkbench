import type { WorkItem } from './work-items';

export type EditorSession = {
  capabilityId: string;
  items: WorkItem[];
  dirty: boolean;
  busy: boolean;
  save: () => Promise<void>;
  beforeLeave?: () => void;
};
const sessions = new Map<string, EditorSession>();
const listeners = new Set<() => void>();
let snapshot: EditorSession[] = [];
const empty: EditorSession[] = [];
function notify() {
  snapshot = [...sessions.values()];
  listeners.forEach((fn) => fn());
}
export function publishEditorSession(session: EditorSession) {
  sessions.set(session.capabilityId, session);
  notify();
}
export function removeEditorSession(capabilityId: string) {
  sessions.delete(capabilityId);
  notify();
}
export function subscribeEditorSessions(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const getEditorSessions = () => snapshot;
export const getServerEditorSessions = () => empty;
export function markEditorSaved(capabilityId: string) {
  const session = sessions.get(capabilityId);
  if (session) {
    sessions.set(capabilityId, { ...session, dirty: false });
    notify();
  }
}
export async function saveBeforeNavigation() {
  const current = [...sessions.values()];
  current.forEach((session) => session.beforeLeave?.());
  for (const session of current) {
    await session.save();
    for (
      let attempt = 0;
      sessions.get(session.capabilityId)?.dirty;
      attempt++
    ) {
      if (attempt >= 3) throw new Error('作品仍在修改，请稍候再切换页面。');
      await sessions.get(session.capabilityId)!.save();
    }
  }
}

export async function saveBeforeReplacement(capabilityId: string) {
  const session = sessions.get(capabilityId);
  session?.beforeLeave?.();
  await session?.save();
}
