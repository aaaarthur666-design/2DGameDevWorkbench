import palette from './theme-palette.json';
export type WorkbenchTheme = 'light' | 'dark';
export function themeColor(name: keyof typeof palette, theme: WorkbenchTheme) {
  return palette[name][theme === 'light' ? 0 : 1];
}
export const themeStorageKey = 'workbench.theme';
export const themeEvent = 'workbench:theme-changed';
export function isTheme(value: unknown): value is WorkbenchTheme {
  return value === 'light' || value === 'dark';
}

// Runs before the first paint, independently of React hydration.
export const themeBootstrap = `(() => {
  let theme;
  try { theme = localStorage.getItem('${themeStorageKey}'); } catch {}
  if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
})();`;

export function applyTheme(theme: WorkbenchTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  window.dispatchEvent(new Event(themeEvent));
}

export function setTheme(theme: WorkbenchTheme) {
  try { localStorage.setItem(themeStorageKey, theme); } catch { /* Still switch in this tab. */ }
  applyTheme(theme);
}

export function getTheme(): WorkbenchTheme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function subscribeTheme(listener: () => void) {
  const system = matchMedia('(prefers-color-scheme: light)');
  const readPreference = () => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(themeStorageKey); } catch { /* Private browser storage. */ }
    applyTheme(isTheme(saved) ? saved : system.matches ? 'light' : 'dark');
  };
  const storage = (event: StorageEvent) => {
    if (event.key === themeStorageKey || event.key === null) readPreference();
  };
  window.addEventListener(themeEvent, listener);
  window.addEventListener('storage', storage);
  system.addEventListener('change', readPreference);
  return () => {
    window.removeEventListener(themeEvent, listener);
    window.removeEventListener('storage', storage);
    system.removeEventListener('change', readPreference);
  };
}
