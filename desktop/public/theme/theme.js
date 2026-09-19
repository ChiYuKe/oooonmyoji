/* Runs before page content in the workbench, popouts and embedded panels. */
(() => {
  'use strict';
  const key = 'onmyoji-studio.appearance';
  const names = { dark: '墨黑', graphite: '柔灰', warm: '暖炭', contrast: '高对比', light: '浅色' };
  const valid = value => Object.prototype.hasOwnProperty.call(names, value);
  const normalize = value => valid(value) ? value : 'dark';
  const listeners = new Set();
  let host;
  try { host = window.onmyoji || window.parent?.onmyoji || window.opener?.onmyoji; } catch { /* isolated preview */ }
  let current = 'dark';
  try { current = normalize(host?.getTheme ? host.getTheme() : localStorage.getItem(key)); } catch { /* default dark */ }
  function apply(value) {
    current = normalize(value);
    document.documentElement.dataset.palette = current;
    document.documentElement.dataset.theme = current === 'light' ? 'light' : 'dark';
    document.documentElement.style.colorScheme = current === 'light' ? 'light' : 'dark';
    for (const listener of listeners) listener(current);
  }
  apply(current);
  const unsubscribe = host?.onThemeChanged?.(apply);
  window.addEventListener('storage', event => { if (event.key === key && !host?.getTheme) apply(event.newValue); });
  window.addEventListener('pagehide', () => unsubscribe?.(), { once: true });
  window.StudioTheme = {
    get: () => current,
    name: value => names[value] || names.dark,
    set(value) {
      if (!valid(value)) return false;
      try {
        if (host?.setTheme) {
          const saved = host.setTheme(value);
          apply(saved);
          return saved === value;
        }
        localStorage.setItem(key, value);
        apply(value);
        return true;
      } catch { return false; }
    },
    subscribe(listener) { listeners.add(listener); listener(current); return () => listeners.delete(listener); },
  };
})();
