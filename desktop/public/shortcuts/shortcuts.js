/*
 * Studio 快捷键注册表：定义可配置命令、读写用户绑定并跨窗口同步。
 *
 * 主窗口通过原生配置持久化（userData），并镜像到同源 localStorage，
 * 让工作流画布等 iframe 与独立窗口通过 storage 事件保持同步。
 * 在每个页面内容脚本之前加载。
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'onmyoji-studio.shortcuts';

  const GROUPS = [
    { id: 'global', label: '全局' },
    { id: 'editor', label: '工作流画布' },
  ];

  const DEFINITIONS = [
    { id: 'global.delete', group: 'global', label: '删除当前选中项', defaultBinding: 'delete|backspace' },
    { id: 'global.rename', group: 'global', label: '重命名当前选中项', defaultBinding: 'f2' },
    { id: 'global.popout', group: 'global', label: '当前模块移到独立窗口', defaultBinding: 'shift+f6' },
    { id: 'editor.undo', group: 'editor', label: '撤销', defaultBinding: 'ctrl+z' },
    { id: 'editor.redo', group: 'editor', label: '重做', defaultBinding: 'ctrl+shift+z|ctrl+y' },
    { id: 'editor.cut', group: 'editor', label: '剪切所选节点', defaultBinding: 'ctrl+x' },
    { id: 'editor.copy', group: 'editor', label: '复制所选节点', defaultBinding: 'ctrl+c' },
    { id: 'editor.paste', group: 'editor', label: '在光标处粘贴节点', defaultBinding: 'ctrl+v' },
    { id: 'editor.selectAll', group: 'editor', label: '全选节点', defaultBinding: 'ctrl+a' },
    { id: 'editor.save', group: 'editor', label: '保存工作流', defaultBinding: 'ctrl+s' },
    { id: 'editor.delete', group: 'editor', label: '删除所选节点、连线或变量', defaultBinding: 'delete|backspace' },
    { id: 'editor.rename', group: 'editor', label: '重命名所选节点', defaultBinding: 'f2' },
    { id: 'editor.fitView', group: 'editor', label: '适应画布', defaultBinding: 'home' },
    { id: 'editor.focusNode', group: 'editor', label: '聚焦到唯一选中的节点', defaultBinding: 'f' },
    { id: 'editor.nextIssue', group: 'editor', label: '跳到下一个校验问题', defaultBinding: 'f8' },
    { id: 'editor.previousIssue', group: 'editor', label: '跳到上一个校验问题', defaultBinding: 'shift+f8' },
  ];

  const byId = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));
  const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'altgraph', 'capslock', 'numlock', 'scrolllock']);
  const DISPLAY_TOKENS = {
    escape: 'Esc', delete: 'Delete', backspace: 'Backspace', home: 'Home', end: 'End', space: '空格',
    arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', enter: 'Enter', tab: 'Tab',
    pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert',
  };

  const listeners = new Set();
  let overrides = {};

  function host() {
    try { return window.onmyoji || window.parent?.onmyoji || window.opener?.onmyoji; } catch { return undefined; }
  }

  function keyToken(event) {
    const key = event && event.key;
    if (typeof key !== 'string' || key === '') return null;
    const lower = key.toLowerCase();
    if (MODIFIER_KEYS.has(lower)) return null;
    return lower === ' ' ? 'space' : lower;
  }

  function normalizeAlternative(text) {
    const parts = String(text).toLowerCase().split('+').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return null;
    const mods = new Set();
    let key = null;
    for (const part of parts) {
      if (part === 'ctrl' || part === 'control' || part === 'cmd' || part === 'command' || part === 'meta') mods.add('ctrl');
      else if (part === 'alt' || part === 'option') mods.add('alt');
      else if (part === 'shift') mods.add('shift');
      else if (key === null) key = part;
      else return null;
    }
    if (!key) return null;
    return [...['ctrl', 'alt', 'shift'].filter((mod) => mods.has(mod)), key].join('+');
  }

  function normalizeBinding(text) {
    const alternatives = String(text).split('|').map(normalizeAlternative);
    if (!alternatives.length || alternatives.some((alt) => !alt)) return null;
    return [...new Set(alternatives)].join('|');
  }

  function alternatives(binding) {
    return typeof binding === 'string' ? binding.split('|').filter(Boolean) : [];
  }

  function bindingFromEvent(event) {
    const key = keyToken(event);
    if (!key) return null;
    const mods = [];
    if (event.ctrlKey || event.metaKey) mods.push('ctrl');
    if (event.altKey) mods.push('alt');
    if (event.shiftKey) mods.push('shift');
    return [...mods, key].join('+');
  }

  function matches(event, binding) {
    const key = keyToken(event);
    if (!key) return false;
    const ctrl = Boolean(event.ctrlKey || event.metaKey);
    const alt = Boolean(event.altKey);
    const shift = Boolean(event.shiftKey);
    return alternatives(binding).some((alternative) => {
      const parts = alternative.split('+');
      if (parts[parts.length - 1] !== key) return false;
      const mods = parts.slice(0, -1);
      return mods.includes('ctrl') === ctrl && mods.includes('alt') === alt && mods.includes('shift') === shift;
    });
  }

  function displayToken(token) {
    if (token === 'ctrl') return 'Ctrl';
    if (token === 'alt') return 'Alt';
    if (token === 'shift') return 'Shift';
    if (DISPLAY_TOKENS[token]) return DISPLAY_TOKENS[token];
    return token.length === 1 ? token.toUpperCase() : token.charAt(0).toUpperCase() + token.slice(1);
  }

  function format(binding) {
    if (!binding) return '';
    return alternatives(binding).map((alternative) => alternative.split('+').map(displayToken).join('+')).join(' / ');
  }

  function parseRaw(raw) {
    const result = {};
    if (typeof raw !== 'string' || raw === '') return result;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return result; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    for (const [id, value] of Object.entries(parsed)) {
      if (!byId.has(id)) continue;
      const normalized = normalizeBinding(value);
      if (normalized) result[id] = normalized;
    }
    return result;
  }

  function readRaw() {
    const native = host();
    if (native && typeof native.readLayout === 'function') {
      try {
        const value = native.readLayout(STORAGE_KEY);
        if (typeof value === 'string') return value;
      } catch { /* fall back to browser storage */ }
    }
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  }

  function effective(id) {
    const definition = byId.get(id);
    if (!definition) return null;
    return Object.hasOwn(overrides, id) ? overrides[id] : definition.defaultBinding;
  }

  /** 按命令 ID 取当前生效绑定并判断事件是否匹配，避免各处重复拼接。 */
  function matchesById(event, id) {
    const binding = effective(id);
    return typeof binding === 'string' && matches(event, binding);
  }

  function persist(raw) {
    // 先镜像到同源 localStorage，让 iframe 与独立窗口收到 storage 事件。
    try { localStorage.setItem(STORAGE_KEY, raw); } catch { /* 预览环境可能不可用 */ }
    const native = host();
    if (native && typeof native.writeLayout === 'function') {
      try { native.writeLayout(STORAGE_KEY, raw); } catch { /* 原生持久化尽力而为 */ }
    }
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function applyRaw(raw) {
    overrides = parseRaw(raw);
    notify();
  }

  function conflictFor(id, binding) {
    const normalized = normalizeBinding(binding);
    if (!normalized) return null;
    const definition = byId.get(id);
    const target = new Set(alternatives(normalized));
    for (const other of DEFINITIONS) {
      if (other.id === id) continue;
      // 全局与画布快捷键在各自上下文中触发，互不冲突。
      if (definition && other.group !== definition.group) continue;
      for (const alternative of alternatives(effective(other.id))) {
        if (target.has(alternative)) return other.id;
      }
    }
    return null;
  }

  function setBinding(id, binding) {
    const definition = byId.get(id);
    if (!definition) return { ok: false, reason: 'unknown' };
    const normalized = normalizeBinding(binding);
    if (!normalized) return { ok: false, reason: 'invalid' };
    const conflictId = conflictFor(id, normalized);
    if (conflictId) return { ok: false, reason: 'conflict', conflictId };
    if (normalized === definition.defaultBinding) delete overrides[id];
    else overrides[id] = normalized;
    persist(JSON.stringify(overrides));
    notify();
    return { ok: true };
  }

  function reset(id) {
    if (!byId.has(id)) return false;
    if (!Object.hasOwn(overrides, id)) return true;
    delete overrides[id];
    persist(JSON.stringify(overrides));
    notify();
    return true;
  }

  function resetAll() {
    overrides = {};
    persist('{}');
    notify();
  }

  overrides = parseRaw(readRaw());
  if (window === window.top) {
    // 顶层窗口把原生配置镜像给同源的 iframe 与独立窗口。
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)); } catch { /* ignore */ }
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    applyRaw(event.newValue);
  });

  window.StudioShortcuts = {
    storageKey: STORAGE_KEY,
    groups: GROUPS,
    definitions: DEFINITIONS,
    getAll: () => Object.fromEntries(DEFINITIONS.map((definition) => [definition.id, effective(definition.id)])),
    get: effective,
    defaultBinding: (id) => byId.get(id)?.defaultBinding ?? null,
    isCustom: (id) => Object.hasOwn(overrides, id),
    set: setBinding,
    reset,
    resetAll,
    format,
    bindingFromEvent,
    matches,
    matchesById,
    conflictFor,
    subscribe(listener) {
      listeners.add(listener);
      listener();
      return () => listeners.delete(listener);
    },
  };
})();
