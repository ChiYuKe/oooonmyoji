import type { SoulRecord } from '../shared/souls';

export function soulGridRange(total: number, columns: number, rowHeight: number, scrollTop: number, height: number): { start: number; end: number; rows: number } {
  const rows = Math.ceil(total / columns);
  const first = Math.max(0, Math.min(rows - 1, Math.floor(Math.max(0, scrollTop) / rowHeight) - 3));
  const last = Math.min(rows, Math.max(first, Math.ceil((Math.max(0, scrollTop) + height) / rowHeight) + 3));
  return { start: first * columns, end: Math.min(total, last * columns), rows };
}

/** Keep the full scrollbar while retaining only nearby rows and their icons. */
export class SoulGrid {
  private items: SoulRecord[] = [];
  private nodes = new Map<number, HTMLLIElement>();
  private frame = 0;
  private columns = 1;
  private rowHeight = 158;
  private gap = 10;
  private padding = 12;
  private start = -1;
  private end = -1;
  private disposed = false;
  private observer: ResizeObserver;
  private win: Window;
  private viewport: HTMLElement;

  constructor(private grid: HTMLUListElement, private createItem: (soul: SoulRecord) => HTMLLIElement) {
    this.win = grid.ownerDocument.defaultView!;
    this.viewport = grid.parentElement!;
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(this.viewport);
    this.viewport.addEventListener('scroll', this.schedule, { passive: true });
    this.grid.addEventListener('keydown', this.keydown);
  }

  setItems(items: SoulRecord[]): void {
    this.items = items;
    this.grid.dataset.total = String(items.length);
    this.nodes.clear(); this.start = this.end = -1;
    if (!items.length) this.grid.replaceChildren();
    this.update();
  }

  private schedule = (): void => {
    if (this.disposed || this.frame) return;
    this.frame = this.win.requestAnimationFrame(() => { this.frame = 0; this.update(); });
  };

  private update(): void {
    if (this.disposed || !this.viewport.clientWidth || this.grid.hidden) return;
    const style = this.win.getComputedStyle(this.grid);
    const columns = Math.max(1, style.gridTemplateColumns.split(' ').filter(Boolean).length);
    const changed = columns !== this.columns;
    this.columns = columns;
    this.gap = parseFloat(style.rowGap) || 10;
    this.padding = parseFloat(style.paddingTop) || 12;
    this.rowHeight = (parseFloat(style.getPropertyValue('--soul-card-height')) || 148) + this.gap;
    const { start, end, rows } = soulGridRange(this.items.length, columns, this.rowHeight,
      this.viewport.scrollTop - this.padding, this.viewport.clientHeight);
    if (!changed && start === this.start && end === this.end) return;
    this.start = start; this.end = end;
    const focused = this.grid.ownerDocument.activeElement;
    const fragment = this.grid.ownerDocument.createDocumentFragment();
    const spacer = (height: number): void => {
      const item = this.grid.ownerDocument.createElement('li'); item.className = 'soul-grid-spacer';
      item.setAttribute('aria-hidden', 'true'); item.style.height = `${height}px`; fragment.append(item);
    };
    if (start) spacer(start / columns * this.rowHeight - this.gap);
    for (const [index] of this.nodes) if (index < start || index >= end) this.nodes.delete(index);
    for (let index = start; index < end; index++) {
      let item = this.nodes.get(index);
      if (!item) {
        item = this.createItem(this.items[index]);
        item.dataset.index = String(index);
        item.setAttribute('aria-posinset', String(index + 1));
        item.setAttribute('aria-setsize', String(this.items.length));
        this.nodes.set(index, item);
      }
      fragment.append(item);
    }
    const trailing = rows - Math.ceil(end / columns);
    if (trailing > 0) spacer(trailing * this.rowHeight - this.gap);
    this.grid.replaceChildren(fragment);
    if (focused && this.grid.contains(focused)) (focused as HTMLElement).focus({ preventScroll: true });
  }

  private keydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLLIElement>('li[data-index]');
    if (!item || !this.items.length) return;
    let index = Number(item.dataset.index);
    const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -this.columns, ArrowDown: this.columns,
      PageUp: -this.columns * Math.max(1, Math.floor(this.viewport.clientHeight / this.rowHeight)),
      PageDown: this.columns * Math.max(1, Math.floor(this.viewport.clientHeight / this.rowHeight)) };
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = this.items.length - 1;
    else if (event.key in keys) index += keys[event.key];
    else return;
    event.preventDefault(); index = Math.max(0, Math.min(this.items.length - 1, index));
    const top = this.padding + Math.floor(index / this.columns) * this.rowHeight;
    const bottom = top + this.rowHeight - this.gap;
    if (top < this.viewport.scrollTop) this.viewport.scrollTop = top;
    else if (bottom > this.viewport.scrollTop + this.viewport.clientHeight) this.viewport.scrollTop = bottom - this.viewport.clientHeight;
    this.update(); this.nodes.get(index)?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  };

  dispose(): void {
    this.disposed = true;
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.viewport.removeEventListener('scroll', this.schedule);
    this.grid.removeEventListener('keydown', this.keydown);
    this.nodes.clear();
  }
}
