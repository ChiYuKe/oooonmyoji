/** Menus in the window title bar, including the floating editor actions menu. */
export interface TitlebarMenus {
  close(): void;
  toggleMore(button: HTMLButtonElement): void;
}

/**
 * Wire the title bar menu bar: click toggles a menu, hovering the bar while a menu is open
 * switches to that menu, and the open menu closes once the pointer leaves it — like a native
 * menu bar. Moving onto another menu keeps the bar active instead of just dismissing it.
 */
export function installTitlebarMenuBar(close: () => void): void {
  document.querySelectorAll<HTMLElement>('.menu-root').forEach((root) => {
    const trigger = root.querySelector<HTMLButtonElement>('.menu-trigger');
    if (!trigger) return;
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const shouldOpen = !root.classList.contains('open');
      close();
      root.classList.toggle('open', shouldOpen);
      trigger.setAttribute('aria-expanded', String(shouldOpen));
    });
    root.addEventListener('mouseenter', () => {
      if (!document.querySelector('.menu-root.open')) return;
      close();
      root.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    });
    root.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'mouse' || !root.classList.contains('open')) return;
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.menu-root')) return;
      close();
    });
    root.querySelectorAll<HTMLElement>('.titlebar-dropdown').forEach((menu) => menu.addEventListener('click', close));
  });
}

export interface TitlebarMenuOptions {
  runtimeEdgePreviewEnabled?(): boolean;
}

const MORE_ACTIONS: Array<{ label: string; type: string; checkable?: boolean } | 'separator'> = [
  { label: '快捷创建节点 (Tab)', type: 'quickCreate' },
  { label: '项目参数预设…', type: 'openPresets' },
  { label: '保存所选节点为项目预设…', type: 'savePreset' },
  { label: '搜索并批量替换参数…', type: 'replaceParameters' },
  { label: '搜索节点和参数 (Ctrl+F)', type: 'searchNodes' },
  { label: '新建工作流', type: 'newWorkflow' },
  { label: '选择其他工作流…', type: 'openWorkflowPicker' },
  { label: '打开 JSON', type: 'openFile' },
  'separator',
  { label: '在结构树窗口查看', type: 'openWorkflowTree' },
  'separator',
  { label: '查看引用', type: 'openReferences' },
  { label: '版本历史…', type: 'openWorkflowHistory' },
  'separator',
  { label: '运行连线预览', type: 'toggleRuntimeEdgePreview', checkable: true },
  'separator',
  { label: '重新加载', type: 'reloadRequest' },
];

export function createTitlebarMenus(onAction: (type: string) => void, options: TitlebarMenuOptions = {}): TitlebarMenus {
  let moreMenu: { menu: HTMLElement; dismiss: (event: Event) => void; keyHandler: (event: KeyboardEvent) => void } | undefined;

  function closeMore(): void {
    if (!moreMenu) return;
    document.removeEventListener('pointerdown', moreMenu.dismiss, true);
    document.removeEventListener('keydown', moreMenu.keyHandler, true);
    window.removeEventListener('resize', closeMore);
    window.removeEventListener('scroll', closeMore, true);
    moreMenu.menu.remove();
    moreMenu = undefined;
    document.querySelector<HTMLButtonElement>('#more-button')?.setAttribute('aria-expanded', 'false');
  }

  function showMore(button: HTMLButtonElement): void {
    closeMore();
    const menu = document.createElement('div');
    menu.className = 'desktop-more-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '更多操作');

    for (const action of MORE_ACTIONS) {
      if (action === 'separator') {
        const separator = document.createElement('div');
        separator.className = 'desktop-more-separator';
        separator.setAttribute('role', 'separator');
        menu.appendChild(separator);
        continue;
      }
      const entry = document.createElement('button');
      entry.type = 'button';
      if (action.checkable) {
        const checked = options.runtimeEdgePreviewEnabled?.() !== false;
        entry.setAttribute('role', 'menuitemcheckbox');
        entry.setAttribute('aria-checked', String(checked));
        entry.textContent = `${checked ? '✓' : '　'} ${action.label}`;
      } else {
        entry.setAttribute('role', 'menuitem');
        entry.textContent = action.label;
      }
      entry.addEventListener('click', () => {
        closeMore();
        onAction(action.type);
      });
      menu.appendChild(entry);
    }

    document.body.appendChild(menu);
    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const left = Math.min(
      Math.max(margin, buttonRect.right - menuRect.width),
      Math.max(margin, viewportWidth - menuRect.width - margin),
    );
    const top = Math.min(
      Math.max(margin, buttonRect.bottom + 4),
      Math.max(margin, viewportHeight - menuRect.height - margin),
    );
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const dismiss = (event: Event): void => {
      if (menu.contains(event.target as Node) || button.contains(event.target as Node)) return;
      closeMore();
    };
    const keyHandler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMore();
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', keyHandler, true);
    window.addEventListener('resize', closeMore);
    window.addEventListener('scroll', closeMore, true);
    moreMenu = { menu, dismiss, keyHandler };
    button.setAttribute('aria-expanded', 'true');
  }

  function close(): void {
    document.querySelectorAll<HTMLElement>('.menu-root.open').forEach((root) => {
      root.classList.remove('open');
      root.querySelector<HTMLButtonElement>('.menu-trigger')?.setAttribute('aria-expanded', 'false');
    });
    closeMore();
  }

  function toggleMore(button: HTMLButtonElement): void {
    if (moreMenu) closeMore();
    else { close(); showMore(button); }
  }

  return { close, toggleMore };
}
