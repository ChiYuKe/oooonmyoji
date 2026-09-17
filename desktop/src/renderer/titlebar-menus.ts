/** Menus in the window title bar, including the floating editor actions menu. */
export interface TitlebarMenus {
  close(): void;
  toggleMore(button: HTMLButtonElement): void;
}

const MORE_ACTIONS: Array<{ label: string; type: string } | 'separator'> = [
  { label: '新建工作流', type: 'newWorkflow' },
  { label: '选择其他工作流…', type: 'openWorkflowPicker' },
  { label: '打开 JSON', type: 'openFile' },
  'separator',
  { label: '在结构树窗口查看', type: 'openWorkflowTree' },
  'separator',
  { label: '查看引用', type: 'openReferences' },
  'separator',
  { label: '重新加载', type: 'reloadRequest' },
];

export function createTitlebarMenus(onAction: (type: string) => void): TitlebarMenus {
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
      entry.setAttribute('role', 'menuitem');
      entry.textContent = action.label;
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
      if (menu.contains(event.target as Node) || event.target === button) return;
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
    else showMore(button);
  }

  return { close, toggleMore };
}
