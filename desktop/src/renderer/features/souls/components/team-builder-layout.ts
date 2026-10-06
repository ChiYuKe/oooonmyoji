import type { OnmyojiDesktopApi } from '../../../../shared/contracts';

const WIDTH_KEY = 'onmyoji-studio.team-builder.sidebar-width';

/** Keep the divider attached to its module when Dockview moves it to a popout. */
export function installTeamBuilderResizer(
  container: HTMLElement,
  handle: HTMLElement,
  storage: Pick<OnmyojiDesktopApi, 'readLayout' | 'writeLayout'>,
): () => void {
  const stored = Number(storage.readLayout(WIDTH_KEY));
  let preferredWidth: number | undefined = Number.isFinite(stored) && stored > 0 ? stored : undefined;
  let width = 120;
  let maximum = 120;
  let drag: { pointer: number; x: number; width: number } | undefined;

  const apply = (): void => {
    const total = container.getBoundingClientRect().width;
    if (total <= 0) return;
    const available = Math.max(0, total - 5);
    const minimum = Math.min(120, available / 2);
    maximum = Math.max(minimum, available - 160);
    width = Math.max(minimum, Math.min(maximum, preferredWidth ?? total * .15));
    container.style.setProperty('--team-builder-sidebar-width', `${width}px`);
    handle.setAttribute('aria-valuemin', String(Math.round(minimum)));
    handle.setAttribute('aria-valuemax', String(Math.round(maximum)));
    handle.setAttribute('aria-valuenow', String(Math.round(width)));
  };
  const persist = (): void => storage.writeLayout(WIDTH_KEY, preferredWidth === undefined ? null : String(width));
  const down = (event: PointerEvent): void => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    event.stopPropagation();
    apply();
    drag = { pointer: event.pointerId, x: event.clientX, width };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
  };
  const move = (event: PointerEvent): void => {
    if (drag?.pointer !== event.pointerId) return;
    preferredWidth = drag.width + event.clientX - drag.x;
    apply();
  };
  const end = (event: PointerEvent): void => {
    if (drag?.pointer !== event.pointerId) return;
    drag = undefined;
    handle.classList.remove('dragging');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (preferredWidth !== undefined) preferredWidth = width;
    persist();
  };
  const reset = (): void => { preferredWidth = undefined; apply(); persist(); };
  const key = (event: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') { reset(); return; }
    const step = event.shiftKey ? 32 : 16;
    preferredWidth = event.key === 'End' ? maximum : width + (event.key === 'ArrowLeft' ? -step : step);
    apply();
    preferredWidth = width;
    persist();
  };

  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, end as EventListener);
  handle.addEventListener('keydown', key);
  handle.addEventListener('dblclick', reset);
  const observer = new ResizeObserver(apply);
  observer.observe(container);
  apply();
  return () => {
    observer.disconnect();
    handle.removeEventListener('pointerdown', down);
    handle.removeEventListener('pointermove', move);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.removeEventListener(type, end as EventListener);
    handle.removeEventListener('keydown', key);
    handle.removeEventListener('dblclick', reset);
    if (drag && handle.hasPointerCapture(drag.pointer)) handle.releasePointerCapture(drag.pointer);
    drag = undefined;
    handle.classList.remove('dragging');
  };
}
