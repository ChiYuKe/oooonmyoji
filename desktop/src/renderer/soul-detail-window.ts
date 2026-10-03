/** Hover details use the top layer without taking focus or intercepting the pointer. */
export interface SoulDetailWindowOptions {
  /** 浮窗元素 id：同一页面可能有多个面板各带一个浮窗，所以不能写死。 */
  id?: string;
  /** 滚动这个容器时关掉浮窗（默认取 root 里的背包结果区）。 */
  viewport?: HTMLElement;
}

export function installSoulDetailWindow(root: HTMLElement, options: SoulDetailWindowOptions = {}): { open(anchor: HTMLElement, update: () => void): void; close(): void; dispose(): void } {
  const doc = root.ownerDocument;
  const view = doc.defaultView!;
  const panel = root.querySelector<HTMLElement>(`#${options.id ?? 'soul-detail-window'}`)!;
  const viewport = options.viewport ?? root.querySelector<HTMLElement>('.soul-results');
  let anchor: HTMLElement | undefined;
  let disposed = false;
  const close = (): void => {
    anchor?.removeAttribute('aria-describedby'); anchor = undefined;
    if (panel.matches(':popover-open')) panel.hidePopover();
  };
  const open = (nextAnchor: HTMLElement, update: () => void): void => {
    if (disposed) return;
    if (!nextAnchor.isConnected || !root.getClientRects().length) { close(); return; }
    anchor?.removeAttribute('aria-describedby'); anchor = nextAnchor;
    update();
    if (!panel.matches(':popover-open')) panel.showPopover();
    nextAnchor.setAttribute('aria-describedby', panel.id);
    const card = nextAnchor.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const left = card.right + rect.width + 20 <= view.innerWidth ? card.right + 12 : card.left - rect.width - 12;
    panel.style.left = `${Math.max(8, Math.min(left, view.innerWidth - rect.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(card.top, view.innerHeight - rect.height - 8))}px`;
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && panel.matches(':popover-open')) {
      event.preventDefault(); event.stopPropagation(); close();
    }
  };
  // Scrolling can recycle the hovered card; never keep its stale details visible.
  viewport?.addEventListener('scroll', close, { passive: true });
  doc.addEventListener('keydown', key, true);
  view.addEventListener('resize', close);
  const observer = new IntersectionObserver(entries => { if (!entries[0].isIntersecting) close(); });
  observer.observe(root);
  return {
    open, close,
    dispose(): void {
      disposed = true; close(); observer.disconnect();
      viewport?.removeEventListener('scroll', close);
      doc.removeEventListener('keydown', key, true);
      view.removeEventListener('resize', close);
    },
  };
}
