(() => {
  if (window.__workbenchThemeInstalled) return;
  window.__workbenchThemeInstalled = true;
  const key = 'workbench.theme';
  const root = document.documentElement;
  const query = new URLSearchParams(location.search);
  const embedded = query.get('workbench_embedded') === '1';
  root.classList.toggle('workbench-embedded', embedded);
  const valid = value => value === 'light' || value === 'dark';
  const frameSelector = '.pixel-editor-frame, .animation-player-frame';
  let parentOrigin = location.origin;
  try {
    const configured = new URL(query.get('workbench_origin') || location.origin);
    if (['http:', 'https:'].includes(configured.protocol)) parentOrigin = configured.origin;
  } catch { /* Standalone pixel editor uses its own origin. */ }
  let stored;
  try { stored = localStorage.getItem(key); } catch { /* Storage is optional. */ }
  const media = matchMedia('(prefers-color-scheme: light)');
  let theme = valid(query.get('workbench_theme')) ? query.get('workbench_theme') : valid(stored) ? stored : media.matches ? 'light' : 'dark';
  const syncFrame = frame => {
    if (!frame.contentWindow) return;
    let origin;
    try { origin = new URL(frame.src, location.href).origin; } catch { return; }
    if (origin === location.origin) frame.contentWindow.postMessage({ type: 'workbench:theme', theme }, origin);
  };
  const apply = next => {
    if (!valid(next)) return;
    theme = next;
    root.dataset.theme = theme;
    root.classList.toggle('dark', theme === 'dark');
    document.body?.classList.toggle('dark', theme === 'dark');
    document.querySelectorAll('.gradio-container, gradio-app').forEach(node => node.classList.toggle('dark', theme === 'dark'));
    document.querySelectorAll(frameSelector).forEach(syncFrame);
    const button = document.getElementById('sprite-theme-toggle');
    if (button) {
      button.textContent = theme === 'dark' ? '☀ 浅色模式' : '☾ 深色模式';
      button.setAttribute('aria-label', theme === 'dark' ? '切换到浅色模式' : '切换到深色模式');
      button.hidden = embedded;
    }
    window.dispatchEvent(new Event('workbench:theme-changed'));
  };
  window.addEventListener('message', event => {
    if (event.source === window.parent && event.origin === parentOrigin && event.data?.type === 'workbench:theme' && valid(event.data.theme)) {
      apply(event.data.theme);
    }
    if (event.origin === location.origin && event.data?.type === 'workbench:theme-ready') {
      const frame = [...document.querySelectorAll(frameSelector)].find(node => node.contentWindow === event.source);
      if (frame) syncFrame(frame);
    }
  });
  window.addEventListener('storage', event => {
    if ((event.key === key || event.key === null) && window.parent === window) apply(valid(event.newValue) ? event.newValue : media.matches ? 'light' : 'dark');
  });
  media.addEventListener('change', () => {
    let saved;
    try { saved = localStorage.getItem(key); } catch { /* Storage is optional. */ }
    if (window.parent === window && !valid(saved)) apply(media.matches ? 'light' : 'dark');
  });
  document.addEventListener('click', event => {
    if (!event.target.closest?.('#sprite-theme-toggle')) return;
    const next = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(key, next); } catch { /* Still switch this document. */ }
    apply(next);
  });
  const ready = () => {
    apply(theme);
    if (window.parent !== window) window.parent.postMessage({ type: 'workbench:theme-ready' }, parentOrigin);
  };
  apply(theme);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
  // Gradio and repair frames may be mounted long after the document is ready.
  new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches?.(`${frameSelector}, .gradio-container, gradio-app, #sprite-theme-toggle`) || node.querySelector?.(`${frameSelector}, .gradio-container, gradio-app, #sprite-theme-toggle`))))) apply(theme);
  }).observe(root, { childList: true, subtree: true });
})();
