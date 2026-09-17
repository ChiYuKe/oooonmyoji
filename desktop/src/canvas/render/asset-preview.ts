/**
 * 画布资产预览：模板缩略图、图片悬停预览与其绑定。
 * 原 `workflow-editor.js` 的 templatePreview 至 bindAssetPathPreview 区间。
 *
 * 预览浮层持模块级单例，绑定与解绑在文档滚轮/移出时清理。
 */
import type { CanvasState } from '../state/canvas-state';

export interface AssetPreviewDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  $(id: string): HTMLElement;
}

export function createAssetPreview(deps: AssetPreviewDeps) {
  const { state, $ } = deps;
  function templatePreview(node: any): any {
    if (!node || node.type !== 'task' || !['vision.match_template', 'vision.wait_template', 'vision.wait_any'].includes(node.action)) return null;
    let value = node.params && (node.action === 'vision.wait_any'
      ? Array.isArray(node.params.templates) ? node.params.templates[0] : ''
      : node.params.template);
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string' && value.ref.startsWith('inputs.')) {
      const definition = state.raw && state.raw.inputs && state.raw.inputs[value.ref.slice('inputs.'.length)];
      value = definition && typeof definition === 'object' && Object.prototype.hasOwnProperty.call(definition, 'default')
        ? definition.default
        : '';
    }
    return assetPreviewForPath(value);
  }

  function assetPreviewForPath(value: any): any {
    if (typeof value !== 'string' || !state.assetsBaseUri) return null;
    const path = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = path.split('/');
    const extension = parts.length ? parts[parts.length - 1].slice(parts[parts.length - 1].lastIndexOf('.')).toLocaleLowerCase() : '';
    if (parts[0] !== 'assets' || parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..')) return null;
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(extension)) return null;
    return {
      path,
      uri: `${state.assetsBaseUri}${parts.slice(1).map((part) => encodeURIComponent(part)).join('/')}`,
    };
  }

  let activeAssetPreview: any = null;

  function hideAssetPathPreview(): void {
    const current = activeAssetPreview;
    if (!current) return;
    activeAssetPreview = null;
    if (current.node) current.node.remove();
    if (window.parent !== window) window.parent.postMessage({ source: 'onmyoji-tooltip', type: 'hide' }, '*');
  }

  function showAssetPathPreview(target: any, preview: any): void {
    if (!target || !preview) return hideAssetPathPreview();
    hideAssetPathPreview();
    const embedded = window.parent !== window;
    let hostDocument = document;
    let hostWindow: any = window;
    let frameRect = null;
    if (embedded) {
      // 详情页是 iframe。直接把预览挂到宿主窗口 body，避免被详情栏的滚动容器裁剪；
      // 跨源或弹出窗口不允许访问宿主时，再退回 postMessage 通道。
      try {
        const frame = window.frameElement;
        if (frame) {
          hostDocument = window.parent.document;
          hostWindow = window.parent;
          frameRect = frame.getBoundingClientRect();
        }
      } catch {
        hostDocument = document;
        hostWindow = window;
      }
    }
    if (embedded && hostDocument === document) {
      const rect = target.getBoundingClientRect();
      activeAssetPreview = { target, preview };
      window.parent.postMessage({
        source: 'onmyoji-tooltip',
        type: 'showAsset',
        preview: { uri: preview.uri, path: preview.path },
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      }, '*');
      return;
    }
    const node = hostDocument.createElement('div');
    node.className = 'app-tooltip asset-preview';
    node.setAttribute('role', 'tooltip');
    const image = hostDocument.createElement('img');
    image.alt = '';
    image.src = preview.uri;
    const caption = hostDocument.createElement('span');
    caption.className = 'asset-hover-preview-path';
    caption.textContent = preview.path;
    node.append(image, caption);
    hostDocument.body.appendChild(node);
    activeAssetPreview = { target, preview, node };
    const position = () => {
      if (!activeAssetPreview || activeAssetPreview.node !== node) return;
      const margin = 8;
      const gap = 8;
      const targetRect = target.getBoundingClientRect();
      const rect = frameRect
        ? {
          left: frameRect.left + targetRect.left,
          right: frameRect.left + targetRect.right,
          top: frameRect.top + targetRect.top,
          bottom: frameRect.top + targetRect.bottom,
        }
        : targetRect;
      node.style.left = '0px';
      node.style.top = '0px';
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      let left = rect.right + gap;
      if (left + width > hostWindow.innerWidth - margin) left = rect.left - width - gap;
      left = Math.max(margin, Math.min(left, hostWindow.innerWidth - width - margin));
      let top = rect.top;
      if (top + height > hostWindow.innerHeight - margin) top = hostWindow.innerHeight - height - margin;
      top = Math.max(margin, top);
      node.style.left = `${Math.round(left)}px`;
      node.style.top = `${Math.round(top)}px`;
    };
    image.addEventListener('load', position, { once: true });
    image.addEventListener('error', () => {
      if (!activeAssetPreview || activeAssetPreview.node !== node) return;
      image.remove();
      const missing = hostDocument.createElement('div');
      missing.className = 'app-tooltip-preview-missing';
      missing.textContent = '图片无法预览';
      node.insertBefore(missing, caption);
      position();
    }, { once: true });
    hostWindow.requestAnimationFrame(position);
  }

  function bindAssetPreview(input: any): void {
    if (!input) return;
    input.dataset.assetPreview = 'true';
    const refresh = () => showAssetPathPreview(input, assetPreviewForPath(input.value));
    const hide = () => {
      if (activeAssetPreview && activeAssetPreview.target === input) hideAssetPathPreview();
    };
    // 使用 mouseenter 而不是 pointerenter：统一 tooltip 的 mouseover 监听会先清理旧提示，
    // 让预览在事件顺序的最后显示，避免刚弹出就被隐藏。
    input.addEventListener('mouseenter', refresh);
    input.addEventListener('mouseleave', hide);
    input.addEventListener('input', () => {
      if (activeAssetPreview && activeAssetPreview.target === input) refresh();
    });
  }

  function bindAssetPathPreview(target: any, getValue: () => any): void {
    if (!target) return;
    const refresh = () => showAssetPathPreview(target, assetPreviewForPath(typeof getValue === 'function' ? getValue() : getValue));
    const hide = () => {
      if (activeAssetPreview && activeAssetPreview.target === target) hideAssetPathPreview();
    };
    target.addEventListener('mouseenter', refresh);
    target.addEventListener('mouseleave', hide);
  }

  return { templatePreview, assetPreviewForPath, hideAssetPathPreview, showAssetPathPreview, bindAssetPreview, bindAssetPathPreview };
}