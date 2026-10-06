/**
 * Dockview moves the original iframe DOM into this document when a panel is
 * popped out. The legacy bridge then posts to this window instead of the main
 * renderer, so forward those messages with the iframe id preserved.
 */
import 'dockview/dist/styles/dockview.css';
import '../../styles/workbench.css';
import { createIcons, Minus, Pin, Square, X } from 'lucide';

document.body.classList.add('dockview-popout-host');
createIcons({ icons: { Minus, Pin, Square, X } });

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

// 顶置按钮：总在最前的状态由主进程窗口持有，这里只负责切换与回报。
// 加载完成后向主窗口报到，主窗口按面板 id 回发偏好；点按钮时也回报一次，
// 让停靠控制器把偏好记下来，弹窗下次打开（含布局恢复）时自动顶置。
const pinButton = document.querySelector<HTMLButtonElement>('#popout-always-on-top');
const applyPinState = (pinned: boolean): void => {
  if (!pinButton) return;
  pinButton.setAttribute('aria-pressed', String(pinned));
  pinButton.title = pinned ? '取消顶置' : '顶置';
  pinButton.setAttribute('aria-label', pinButton.title);
};
let pinned = false;
const applyAlwaysOnTop = (flag: boolean): void => {
  pinned = flag; applyPinState(flag);
  void popoutApi.setAlwaysOnTop(flag);
};
void popoutApi.isAlwaysOnTop().then((flag) => { pinned = flag; applyPinState(flag); });
pinButton?.addEventListener('click', () => {
  applyAlwaysOnTop(!pinned);
  sendToOpener({ type: 'popoutAlwaysOnTop', flag: pinned });
});
window.addEventListener('message', (event) => {
  const data = event.data as Record<string, unknown> | undefined;
  if (data?.source !== 'dockview-main' || data.type !== 'popoutTopmost') return;
  applyAlwaysOnTop(Boolean(data.flag));
});
sendToOpener({ type: 'popoutReady' });

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
 * 把删除/重命名键和指针事件转回主窗口，让它用同一套目标逻辑处理。
 */
document.addEventListener('pointerdown', () => {
  sendToOpener({ type: 'shellContextReset' });
}, true);
document.addEventListener('keydown', (event) => {
  if (!window.StudioShortcuts?.matchesById(event, 'global.delete')
    && !window.StudioShortcuts?.matchesById(event, 'global.rename')) return;
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
  event.preventDefault();
  sendToOpener({ type: 'shellShortcut', key: event.key });
});
