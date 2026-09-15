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

const installCustomTooltips = (): void => {
  window.StudioTooltip?.install({
    bridge: 'receive',
    assetPreview: true,
    ariaLabelTags: /^BUTTON$/,
    trimText: true,
    repositionOnResize: true,
    hideOnScroll: true,
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

/**
 * Dockview 把面板 DOM 搬进这个窗口后，主窗口 document 上的快捷键与点击清理都不再触发。
 * 把删除键和指针事件转回主窗口，让它用同一套删除目标逻辑处理。
 */
document.addEventListener('pointerdown', () => {
  sendToOpener({ type: 'shellContextReset' });
}, true);
document.addEventListener('keydown', (event) => {
  if (!window.StudioShortcuts?.matchesById(event, 'global.delete')) return;
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
  event.preventDefault();
  sendToOpener({ type: 'shellShortcut', key: event.key });
});
