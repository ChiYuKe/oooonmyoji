/** Flat workspace splitters. Keep room for results when the window shrinks. */
export function installTestResizer(
  handle: HTMLElement, container: HTMLElement, property: string,
  initial: number, minimum: number, maximum: number,
): () => void {
  let width = initial;
  let drag: { pointer: number; x: number; width: number } | undefined;
  const view = container.ownerDocument.defaultView!;
  function apply(value: number): void {
    const available = container.getBoundingClientRect().width;
    const limit = Math.max(minimum, Math.min(maximum, available - 360));
    width = Math.max(minimum, Math.min(limit, value));
    container.style.setProperty(property, `${width}px`);
    handle.setAttribute('aria-valuemin', String(minimum));
    handle.setAttribute('aria-valuemax', String(limit));
    handle.setAttribute('aria-valuenow', String(Math.round(width)));
  }
  const down = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { pointer: event.pointerId, x: event.clientX, width };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
  };
  const move = (event: PointerEvent): void => {
    if (drag?.pointer === event.pointerId) apply(drag.width + event.clientX - drag.x);
  };
  const end = (event: PointerEvent): void => {
    if (drag?.pointer !== event.pointerId) return;
    drag = undefined;
    handle.classList.remove('dragging');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  const key = (event: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    apply(event.key === 'Home' ? initial : width + (event.key === 'ArrowLeft' ? -16 : 16));
  };
  const resize = (): void => apply(width);
  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, end as EventListener);
  handle.addEventListener('keydown', key);
  view.addEventListener('resize', resize);
  apply(initial);
  return () => {
    handle.removeEventListener('pointerdown', down);
    handle.removeEventListener('pointermove', move);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.removeEventListener(type, end as EventListener);
    handle.removeEventListener('keydown', key);
    view.removeEventListener('resize', resize);
  };
}
