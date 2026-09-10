/**
 * Dockview moves the original iframe DOM into this document when a panel is
 * popped out. The legacy bridge then posts to this window instead of the main
 * renderer, so forward those messages with the iframe id preserved.
 */
import 'dockview/dist/styles/dockview.css';
import './styles.css';
import { createIcons, Minus, Square, X } from 'lucide';

document.body.classList.add('dockview-popout-host');
createIcons({ icons: { Minus, Square, X } });

const htmlNamespace = 'http://www.w3.org/1999/xhtml';
const installCustomTooltips = (): void => {
  const tooltip = document.createElement('div');
  tooltip.className = 'app-tooltip hidden';
  tooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltip);
  let activeTarget: HTMLElement | undefined;
  let activeRect: DOMRect | undefined;
  const position = (rect: DOMRect): void => {
    const margin = 8;
    const gap = 7;
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const x = Math.max(margin, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - margin));
    let y = rect.bottom + gap;
    if (y + height > window.innerHeight - margin) y = rect.top - height - gap;
    y = Math.max(margin, Math.min(y, window.innerHeight - height - margin));
    tooltip.style.left = `${Math.round(x)}px`;
    tooltip.style.top = `${Math.round(y)}px`;
  };
  const hide = (): void => {
    activeTarget = undefined;
    activeRect = undefined;
    tooltip.classList.add('hidden');
  };
  const show = (target: HTMLElement, rect = target.getBoundingClientRect()): void => {
    const text = target.dataset.tooltip || '';
    if (!text) return hide();
    activeTarget = target;
    activeRect = rect;
    tooltip.classList.remove('asset-preview');
    tooltip.textContent = text;
    tooltip.classList.remove('hidden');
    position(rect);
  };
  const showAsset = (preview: { uri?: string; path?: string }, rect: DOMRect): void => {
    const uri = typeof preview.uri === 'string' ? preview.uri.trim() : '';
    if (!uri) return hide();
    activeTarget = undefined;
    activeRect = rect;
    tooltip.replaceChildren();
    tooltip.classList.add('asset-preview');
    const image = document.createElement('img');
    image.src = uri;
    image.alt = '';
    image.decoding = 'async';
    const path = document.createElement('span');
    path.className = 'app-tooltip-preview-path';
    path.textContent = typeof preview.path === 'string' ? preview.path : '';
    tooltip.append(image, path);
    tooltip.classList.remove('hidden');
    position(rect);
    image.addEventListener('load', () => {
      if (activeRect === rect && tooltip.classList.contains('asset-preview')) position(rect);
    }, { once: true });
    image.addEventListener('error', () => {
      if (activeRect !== rect || !tooltip.classList.contains('asset-preview')) return;
      image.remove();
      const missing = document.createElement('div');
      missing.className = 'app-tooltip-preview-missing';
      missing.textContent = '图片无法预览';
      tooltip.insertBefore(missing, path);
      position(rect);
    }, { once: true });
  };
  const targetForEvent = (event: Event): HTMLElement | undefined => {
    const target = event.target;
    return target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') ?? undefined : undefined;
  };
  const scan = (): void => {
    document.querySelectorAll<HTMLElement>('[title]').forEach((element) => {
      if (element.namespaceURI !== htmlNamespace || element.tagName === 'IFRAME') return;
      const label = element.getAttribute('title')?.trim();
      if (!label) return;
      element.dataset.tooltip = label;
      element.removeAttribute('title');
      if (!element.getAttribute('aria-label') && element.tagName === 'BUTTON') {
        element.setAttribute('aria-label', label.replace(/\s+/g, ' '));
      }
    });
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { attributes: true, attributeFilter: ['title'], childList: true, subtree: true });
  document.addEventListener('mouseover', (event) => {
    const target = targetForEvent(event);
    if (target) show(target); else hide();
  });
  document.addEventListener('mouseout', (event) => {
    if (!activeTarget || event.target !== activeTarget) return;
    const related = event.relatedTarget;
    if (!(related instanceof Node) || !activeTarget.contains(related)) hide();
  });
  document.addEventListener('focusin', (event) => {
    const target = targetForEvent(event);
    if (target) show(target);
  });
  document.addEventListener('focusout', (event) => {
    if (activeTarget && event.target === activeTarget) hide();
  });
  document.addEventListener('pointerdown', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', () => {
    if (activeRect && !tooltip.classList.contains('hidden')) position(activeRect);
  });
  window.addEventListener('scroll', hide, true);

  window.addEventListener('message', (event: MessageEvent<Record<string, unknown>>) => {
    const message = event.data;
    if (message?.source !== 'onmyoji-tooltip') return;
    if (message.type === 'hide') {
      hide();
      return;
    }
    if ((message.type !== 'show' && message.type !== 'showAsset') || !message.rect || typeof message.rect !== 'object') return;
    const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe')]
      .find((candidate) => candidate.contentWindow === event.source);
    if (!frame) return;
    const rect = message.rect as Record<string, unknown>;
    const frameRect = frame.getBoundingClientRect();
    const targetRect = {
      left: frameRect.left + Number(rect.left || 0),
      top: frameRect.top + Number(rect.top || 0),
      right: frameRect.left + Number(rect.right || 0),
      bottom: frameRect.top + Number(rect.bottom || 0),
      width: Number(rect.width || 0),
      height: Number(rect.height || 0),
    } as DOMRect;
    if (message.type === 'showAsset' && message.preview && typeof message.preview === 'object') {
      showAsset(message.preview as { uri?: string; path?: string }, targetRect);
    } else if (message.type === 'show') {
      const target = document.createElement('span');
      target.dataset.tooltip = String(message.text || '');
      show(target, targetRect);
    }
  });
};
installCustomTooltips();

const popoutApi = window.onmyoji;
document.querySelector('#popout-minimize')?.addEventListener('click', () => void popoutApi.minimizeWindow());
document.querySelector('#popout-maximize')?.addEventListener('click', () => void popoutApi.toggleMaximizeWindow());
document.querySelector('#popout-close')?.addEventListener('click', () => void popoutApi.closeWindow());

const sendToOpener = (data: Record<string, unknown>): void => {
  window.opener?.postMessage({ ...data, source: 'dockview-popout' }, '*');
};

const relayFrameMessage = (event: MessageEvent<Record<string, unknown>>): void => {
  if (event.data?.source !== 'legacy-editor' && event.data?.source !== 'legacy-editor-state') return;
  const source = event.source;
  if (!source || source === window) return;
  const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe')]
    .find((candidate) => candidate.contentWindow === source);
  if (!frame) return;
  sendToOpener({ ...event.data, frameId: frame.id });
};

window.addEventListener('message', relayFrameMessage);
