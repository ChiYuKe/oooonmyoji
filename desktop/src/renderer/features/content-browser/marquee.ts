/** Blank-space marquee shared by the thumbnail and list views. */
export function bindContentMarquee(
  container: HTMLElement,
  readSelection: () => ReadonlySet<string>,
  select: (paths: Set<string>) => void,
  canStart: () => boolean,
): () => void {
  let cancel = (): void => {};
  container.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary || !canStart()) return;
    const target = event.target as Element;
    if (target.closest('.content-item, input, button')) return;
    const bounds = container.getBoundingClientRect();
    const left = bounds.left + container.clientLeft;
    const top = bounds.top + container.clientTop;
    if (event.clientX >= left + container.clientWidth || event.clientY >= top + container.clientHeight) return;
    cancel();
    event.preventDefault();
    const doc = container.ownerDocument;
    const win = doc.defaultView!;
    const before = new Set(readSelection());
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const start = { x: event.clientX - left + container.scrollLeft, y: event.clientY - top + container.scrollTop };
    let x = event.clientX;
    let y = event.clientY;
    let dragging = false;
    let frame = 0;
    const box = doc.createElement('div');
    box.className = 'content-selection-marquee';
    box.setAttribute('aria-hidden', 'true');
    const update = (): void => {
      const rect = container.getBoundingClientRect();
      const originX = rect.left + container.clientLeft;
      const originY = rect.top + container.clientTop;
      const endX = Math.max(0, Math.min(container.clientWidth, x - originX)) + container.scrollLeft;
      const endY = Math.max(0, Math.min(container.clientHeight, y - originY)) + container.scrollTop;
      const selection = { left: Math.min(start.x, endX), top: Math.min(start.y, endY), right: Math.max(start.x, endX), bottom: Math.max(start.y, endY) };
      Object.assign(box.style, { left: `${selection.left}px`, top: `${selection.top}px`, width: `${selection.right - selection.left}px`, height: `${selection.bottom - selection.top}px` });
      const paths = additive ? new Set(before) : new Set<string>();
      container.querySelectorAll<HTMLElement>('.content-item:not(.editing)').forEach((item) => {
        const itemRect = item.getBoundingClientRect();
        const itemLeft = itemRect.left - originX + container.scrollLeft;
        const itemTop = itemRect.top - originY + container.scrollTop;
        if (itemLeft < selection.right && itemLeft + itemRect.width > selection.left
          && itemTop < selection.bottom && itemTop + itemRect.height > selection.top) paths.add(item.dataset.contentPath!);
      });
      select(paths);
    };
    const tick = (): void => {
      const rect = container.getBoundingClientRect();
      const edgeSpeed = (position: number, size: number): number => position < 28
        ? -Math.min(16, (28 - position) / 2) : position > size - 28 ? Math.min(16, (position - size + 28) / 2) : 0;
      container.scrollTop += edgeSpeed(y - rect.top - container.clientTop, container.clientHeight);
      container.scrollLeft += edgeSpeed(x - rect.left - container.clientLeft, container.clientWidth);
      update();
      frame = win.requestAnimationFrame(tick);
    };
    const move = (next: PointerEvent): void => {
      if (next.pointerId !== event.pointerId) return;
      x = next.clientX;
      y = next.clientY;
      if (!dragging && Math.hypot(x - event.clientX, y - event.clientY) < 4) return;
      if (!dragging) {
        dragging = true;
        container.appendChild(box);
        container.classList.add('marquee-selecting');
        frame = win.requestAnimationFrame(tick);
      }
      update();
    };
    const finish = (restore: boolean): void => {
      win.cancelAnimationFrame(frame);
      box.remove();
      container.classList.remove('marquee-selecting');
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerup', up);
      container.removeEventListener('pointercancel', abort);
      container.removeEventListener('lostpointercapture', abort);
      doc.removeEventListener('keydown', key, true);
      win.removeEventListener('blur', abort);
      cancel = () => {};
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
      if (restore) select(before);
    };
    const up = (next: PointerEvent): void => {
      if (next.pointerId !== event.pointerId) return;
      if (dragging) { x = next.clientX; y = next.clientY; update(); }
      else if (!additive) select(new Set());
      finish(false);
    };
    const abort = (): void => finish(true);
    const key = (next: KeyboardEvent): void => {
      if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); abort(); }
    };
    cancel = abort;
    container.setPointerCapture(event.pointerId);
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerup', up);
    container.addEventListener('pointercancel', abort);
    container.addEventListener('lostpointercapture', abort);
    doc.addEventListener('keydown', key, true);
    win.addEventListener('blur', abort);
  });
  return () => cancel();
}
