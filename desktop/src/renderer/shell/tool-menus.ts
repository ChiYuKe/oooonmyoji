/** Native details keep keyboard activation; dismiss their menus like the other shell menus. */
export function installToolMenus(onOpen: () => void): void {
  const menus = [...document.querySelectorAll<HTMLDetailsElement>('.tool-overflow')];
  const close = (): void => { menus.forEach((menu) => { menu.open = false; }); };
  for (const menu of menus) {
    menu.querySelector('summary')?.addEventListener('click', (event) => {
      // The shell's document click handler closes titlebar menus. Keep native toggling here.
      event.stopPropagation();
      if (!menu.open) {
        close();
        onOpen();
      }
    });
    menu.querySelector('.tool-menu')?.addEventListener('click', (event) => {
      if ((event.target as Element).closest('button:not(:disabled)')) close();
    });
  }
  const dismissOutside = (event: Event): void => {
    if (!menus.some((menu) => menu.contains(event.target as Node))) close();
  };
  document.addEventListener('pointerdown', dismissOutside, true);
  document.addEventListener('click', dismissOutside, true);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = menus.find((menu) => menu.open);
    if (!open) return;
    close();
    open.querySelector<HTMLElement>('summary')?.focus();
  });
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
}
