export function canonicalView(value) {
  const url = new URL(value, 'http://workbench.local');
  url.searchParams.sort();
  return url.pathname + url.search;
}
export function followDecision({ currentPath, targetPath, following, busy, editing, handled }) {
  if (!following) return 'paused';
  if (canonicalView(currentPath) === canonicalView(targetPath)) return 'displayed';
  if (handled) return 'ignore';
  if (busy) return 'busy';
  if (editing) return 'editing';
  return 'navigate';
}
