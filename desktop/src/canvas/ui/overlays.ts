/**
 * 画布浮层：右键菜单（搜索、子菜单、键盘导航）、提示 toast 与图片灯箱。
 * 原 `workflow-editor.js` 的 showMenu/hideMenus/toast/openLightbox。
 */

export type MenuEntry = {
  label: string;
  /** 叶子动作；带 children 的分组项可以不提供。 */
  run?: () => void;
  danger?: boolean;
  children?: MenuEntry[];
} | 'separator';

export interface OverlaysDeps {
  el(tag: string, className?: string, text?: string): HTMLElement;
  $(id: string): HTMLElement;
  toastDurationMs?: number;
}

export interface CanvasOverlays {
  showMenu(x: number, y: number, items: MenuEntry[], options?: { align?: 'start' | 'end' }): void;
  hideMenus(): void;
  openLightbox(src: string): void;
  toast(message: string, error?: boolean): void;
}

export function createCanvasOverlays(deps: OverlaysDeps): CanvasOverlays {
  const { el, $ } = deps;
  const toastDurationMs = deps.toastDurationMs ?? 2200;

  function hideMenus(): void {
    for (const menu of Array.from(document.querySelectorAll('.context-menu'))) menu.remove();
  }

  function toast(message: string, error = false): void {
    const target = $('toast') as HTMLElement & { _timer?: ReturnType<typeof setTimeout> };
    target.textContent = message;
    target.classList.remove('hidden');
    target.classList.toggle('error', error);
    clearTimeout(target._timer);
    target._timer = setTimeout(() => target.classList.add('hidden'), toastDurationMs);
  }

  function showMenu(x: number, y: number, items: MenuEntry[], options: { align?: 'start' | 'end' } = {}): void {
    hideMenus();
    const menu = el('div', 'context-menu');
    const list = el('div', 'context-menu-list');
    menu.appendChild(list);
    const closeSubmenus = (): void => {
      for (const sub of Array.from(menu.querySelectorAll('.context-menu-sub'))) sub.remove();
    };
    let highlightIndex = -1;
    const visibleButtons = (): HTMLButtonElement[] => Array.from(list.querySelectorAll('button'));
    const highlight = (index: number): void => {
      const buttons = visibleButtons();
      if (!buttons.length) { highlightIndex = -1; return; }
      highlightIndex = ((index % buttons.length) + buttons.length) % buttons.length;
      buttons.forEach((button, i) => button.classList.toggle('menu-highlight', i === highlightIndex));
      const active = buttons[highlightIndex];
      if (active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    };
    const renderItems = (query: string): void => {
      list.innerHTML = '';
      closeSubmenus();
      const q = (query || '').trim().toLowerCase();
      if (q) {
        // 搜索时把子菜单打平，全部动作一起过滤（UE 的 Search 行为）。
        // 打平后必须带上父级标签：分组里的同名子项（例如数组每项下都有的
        // 「复制 置信度」）单看自己分不清来自哪一组，也没法按「第 N 项」搜。
        const walk = (item: MenuEntry, prefix: string): void => {
          if (item === 'separator') return;
          const label = String(item.label || '');
          const path = prefix && label ? `${prefix} · ${label}` : (label || prefix);
          if (item.children && item.children.length) { for (const child of item.children) walk(child, path); return; }
          if (!path.toLowerCase().includes(q)) return;
          const button = el('button', item.danger ? 'danger' : '', path);
          button.addEventListener('click', () => { hideMenus(); item.run?.(); });
          button.addEventListener('mouseenter', () => highlight(visibleButtons().indexOf(button as HTMLButtonElement)));
          list.appendChild(button);
        };
        for (const item of items) walk(item, '');
      } else {
        for (const item of items) {
          if (item === 'separator') { list.appendChild(el('div', 'menu-separator')); continue; }
          const label = String(item.label || '');
          const button = el('button', item.danger ? 'danger' : '', label);
          if (item.children && item.children.length) {
            button.classList.add('has-submenu');
            const chevron = document.createElement('span');
            chevron.className = 'menu-chevron';
            chevron.textContent = '▸';
            button.appendChild(chevron);
            const openSubmenu = (): void => {
              closeSubmenus();
              const sub = el('div', 'context-menu context-menu-sub');
              for (const child of item.children!) {
                if (child === 'separator') { sub.appendChild(el('div', 'menu-separator')); continue; }
                const childButton = el('button', child.danger ? 'danger' : '', child.label);
                childButton.addEventListener('click', () => { hideMenus(); child.run?.(); });
                sub.appendChild(childButton);
              }
              menu.appendChild(sub);
              const rect = button.getBoundingClientRect();
              const subRect = sub.getBoundingClientRect();
              const left = rect.right + 2 + subRect.width > window.innerWidth ? rect.left - subRect.width - 2 : rect.right + 2;
              sub.style.left = `${left}px`;
              sub.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - subRect.height - 8))}px`;
            };
            button.addEventListener('mouseenter', () => { openSubmenu(); });
            button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openSubmenu(); });
          } else {
            button.addEventListener('click', () => { hideMenus(); item.run?.(); });
            button.addEventListener('mouseenter', () => closeSubmenus());
          }
          button.addEventListener('mouseenter', () => highlight(visibleButtons().indexOf(button as HTMLButtonElement)));
          list.appendChild(button);
        }
      }
      highlight(0);
    };
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'context-menu-search';
    search.placeholder = '搜索操作…';
    search.spellcheck = false;
    search.addEventListener('input', () => renderItems(search.value));
    search.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'ArrowDown') { event.preventDefault(); highlight(highlightIndex + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); highlight(highlightIndex - 1); }
      else if (event.key === 'Enter') {
        const buttons = visibleButtons();
        if (highlightIndex >= 0 && highlightIndex < buttons.length) buttons[highlightIndex].click();
        else if (buttons.length) buttons[0].click();
      } else if (event.key === 'Escape') hideMenus();
    });
    menu.prepend(search);
    renderItems('');
    document.body.appendChild(menu);
    search.focus();
    search.select();
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const preferredLeft = options.align === 'end' ? x - rect.width : x;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    menu.style.left = `${Math.min(Math.max(margin, preferredLeft), maxLeft)}px`;
    menu.style.top = `${Math.min(Math.max(margin, y), maxTop)}px`;
  }

  function openLightbox(src: string): void {
    if (!src) return;
    const box = $('lightbox');
    box.innerHTML = '';
    box.classList.remove('hidden');
    const shell = el('div', 'lightbox-shell');
    const close = el('button', 'icon-button lightbox-close', '×');
    const image = el('img') as HTMLImageElement;
    image.src = src;
    close.addEventListener('click', () => box.classList.add('hidden'));
    shell.appendChild(close);
    shell.appendChild(image);
    box.appendChild(shell);
  }

  return { showMenu, hideMenus, openLightbox, toast };
}
