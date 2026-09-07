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
