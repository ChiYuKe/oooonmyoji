/**
 * 资源浏览器：在顶层窗口的模态框里浏览 assets 图片，选择模板或重新截取。
 * 原 `editor-asset-browser.js`；主编辑器通过工厂注入状态与 DOM 依赖。
 */

export interface AssetImage {
  path: string;
  uri: string;
}

export interface AssetBrowserSession {
  requestId: string;
  nodeId: string;
  key: string;
  applyValue?: ((value: string) => void) | null;
  images: AssetImage[] | null;
  folder: string;
  query: string;
  selectedPath: string;
  cacheBust?: number;
}

export interface AssetBrowserState {
  assetBrowser: AssetBrowserSession | null | Record<string, never>;
}

export interface AssetBrowserNode {
  params: Record<string, unknown>;
}

export type CreateAssetElement = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K];

export interface AssetBrowserDeps {
  state: AssetBrowserState;
  $(id: string): HTMLElement;
  el: CreateAssetElement;
  mutate(fn: () => void): void;
  nodeById(id: string): AssetBrowserNode | undefined;
  toast(message: string, error?: boolean): void;
  vscode: { postMessage(message: unknown): void };
  requestRoi(nodeId: string, key: string, mode: 'asset' | 'rect', options?: { returnToAssetBrowser?: boolean; targetPath?: string }): void;
}

export interface AssetBrowser {
  assetBrowserOverlay(): HTMLElement;
  openAssetBrowser(nodeId: string, key: string, currentPath: string, applyValue?: ((value: string) => void) | null): void;
  closeAssetBrowser(): void;
  renderAssetBrowser(): void;
  restoreAssetBrowserAfterRoi(): void;
  recaptureAsset(assetPath: string): void;
  requestTemplateReplacement(nodeId: string, key: string, assetPath: string, options?: { returnToAssetBrowser?: boolean }): boolean;
}

interface AssetBrowserPortal {
  host: HTMLDialogElement;
  overlay: HTMLElement;
  originalParent: Node;
  returnFocus: Element | null;
  observer: MutationObserver;
}

function session(state: AssetBrowserState): AssetBrowserSession | undefined {
  const value = state.assetBrowser;
  return value && typeof value.requestId === 'string' ? value as AssetBrowserSession : undefined;
}

export function createAssetBrowser(deps: AssetBrowserDeps): AssetBrowser {
  const { state, $, el, mutate, nodeById, toast, vscode, requestRoi } = deps;

  let assetBrowserPortal: AssetBrowserPortal | null = null;

  function assetBrowserOverlay(): HTMLElement {
    return assetBrowserPortal ? assetBrowserPortal.overlay : $('asset-browser');
  }

  function mountAssetBrowser(): void {
    if (assetBrowserPortal) return;
    let owner: Document = document;
    try { owner = window.top!.document; } catch { /* Standalone / cross-origin host. */ }
    const overlay = $('asset-browser');
    const originalParent = overlay.parentNode!;
    const returnFocus = document.activeElement;
    const host = owner.createElement('dialog');
    host.setAttribute('aria-label', '选择模板');
    host.style.cssText = 'padding:0;border:0;max-width:none;max-height:none;width:100vw;height:100vh;background:transparent;color:inherit;overflow:hidden;';
    const surface = owner.createElement('div');
    host.appendChild(surface);
    const shadow = surface.attachShadow({ mode: 'open' });
    const sheet = owner.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = new URL('./asset-browser.css', document.baseURI).href;
    shadow.appendChild(sheet);
    shadow.appendChild(overlay);
    const syncTheme = (): void => {
      const computed = getComputedStyle(document.documentElement);
      for (const name of ['--ui-panel', '--ui-bg', '--ui-field', '--ui-surface', '--ui-hover', '--ui-selected', '--ui-line', '--ui-text', '--ui-muted', '--ui-focus']) host.style.setProperty(name, computed.getPropertyValue(name));
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    host.addEventListener('cancel', (event) => { event.preventDefault(); closeAssetBrowser(); });
    host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeAssetBrowser(); }
      event.stopPropagation();
    });
    owner.body.appendChild(host);
    assetBrowserPortal = { host, overlay, originalParent, returnFocus, observer };
    host.showModal();
  }

  function openAssetBrowser(nodeId: string, key: string, currentPath: string, applyValue: ((value: string) => void) | null = null): void {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const normalized = typeof currentPath === 'string' ? currentPath.replace(/\\/g, '/') : '';
    const slash = normalized.lastIndexOf('/');
    state.assetBrowser = {
      requestId,
      nodeId,
      key,
      applyValue,
      images: null,
      folder: slash > 0 ? normalized.slice(0, slash) : 'assets',
      query: '',
      selectedPath: normalized,
    };
    mountAssetBrowser();
    assetBrowserOverlay().classList.remove('hidden');
    renderAssetBrowser();
    assetBrowserOverlay().querySelector('input')?.focus();
    vscode.postMessage({ type: 'listAssetImages', requestId });
  }

  function closeAssetBrowser(): void {
    const overlay = assetBrowserOverlay();
    if (overlay) overlay.classList.add('hidden');
    if (assetBrowserPortal) {
      const { host, originalParent, returnFocus, observer } = assetBrowserPortal;
      observer.disconnect();
      host.close();
      originalParent.appendChild(overlay);
      host.remove();
      assetBrowserPortal = null;
      if (returnFocus?.isConnected) (returnFocus as HTMLElement).focus();
    }
    state.assetBrowser = null;
  }

  function assetFolders(images: AssetImage[]): Array<[string, number]> {
    const counts = new Map<string, number>([['assets', 0]]);
    for (const image of images) {
      const parts = image.path.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        const folder = parts.slice(0, index).join('/');
        counts.set(folder, (counts.get(folder) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'));
  }

  function applyAssetSelection(assetPath: string): void {
    const browser = session(state);
    if (!browser || !assetPath) return;
    if (typeof browser.applyValue === 'function') mutate(() => browser.applyValue!(assetPath));
    else {
      const node = nodeById(browser.nodeId);
      if (!node) {
        closeAssetBrowser();
        toast('目标节点已不存在', true);
        return;
      }
      mutate(() => { node.params[browser.key] = assetPath; });
    }
    closeAssetBrowser();
    toast('已选择模板');
  }

  function restoreAssetBrowserAfterRoi(): void {
    if (!session(state)) return;
    const overlay = assetBrowserOverlay();
    if (assetBrowserPortal && !assetBrowserPortal.host.open) assetBrowserPortal.host.showModal();
    if (overlay) overlay.classList.remove('hidden');
    renderAssetBrowser();
  }

  function recaptureAsset(assetPath: string): void {
    const browser = session(state);
    if (!browser || !assetPath) return;
    browser.selectedPath = assetPath;
    if (!requestTemplateReplacement(browser.nodeId, browser.key, assetPath, { returnToAssetBrowser: true })) return;
    assetBrowserOverlay().classList.add('hidden');
    assetBrowserPortal?.host.close();
  }

  function requestTemplateReplacement(nodeId: string, key: string, assetPath: string, options: { returnToAssetBrowser?: boolean } = {}): boolean {
    const normalized = typeof assetPath === 'string' ? assetPath.replace(/\\/g, '/').trim() : '';
    if (!normalized) {
      toast('请先选择要替换的模板', true);
      return false;
    }
    if (!/^assets\//i.test(normalized) || !/\.(?:png|jpe?g|webp)$/i.test(normalized)) {
      toast('替换仅支持 assets 下的 PNG、JPG 和 WebP 模板', true);
      return false;
    }
    requestRoi(nodeId, key, 'asset', { ...options, targetPath: normalized });
    return true;
  }

  function renderAssetBrowser(): void {
    const browser = session(state);
    const overlay = assetBrowserOverlay();
    if (!browser || !overlay) return;
    overlay.innerHTML = '';

    const dialog = el('div', 'asset-browser-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', '选择模板');
    const head = el('div', 'asset-browser-head');
    const title = el('div', 'asset-browser-title', '选择模板');
    const close = el('button', 'icon-button', '×');
    close.title = '关闭';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', closeAssetBrowser);
    head.appendChild(title);
    head.appendChild(close);
    dialog.appendChild(head);

    const toolbar = el('div', 'asset-browser-toolbar');
    const search = el('input', 'asset-search');
    search.type = 'search';
    search.placeholder = '搜索图片名称或路径';
    search.value = browser.query;
    search.setAttribute('aria-label', '搜索图片名称或路径');
    search.addEventListener('input', () => {
      browser.query = search.value;
      renderAssetBrowser();
      assetBrowserOverlay().querySelector('input')?.focus();
    });
    toolbar.appendChild(search);
    const total = Array.isArray(browser.images) ? browser.images.length : 0;
    toolbar.appendChild(el('span', 'asset-total', browser.images === null ? '正在读取…' : `${total} 张图片`));
    dialog.appendChild(toolbar);

    const content = el('div', 'asset-browser-content');
    const folders = el('nav', 'asset-folders');
    folders.setAttribute('aria-label', '资源文件夹');
    const grid = el('div', 'asset-grid');
    content.appendChild(folders);
    content.appendChild(grid);
    dialog.appendChild(content);

    const footer = el('div', 'asset-browser-footer');
    const selectedValue = el('div', 'asset-selected-path', browser.selectedPath || '未选择图片');
    selectedValue.title = browser.selectedPath || '';
    const cancel = el('button', '', '取消');
    cancel.addEventListener('click', closeAssetBrowser);
    const confirm = el('button', 'primary', '选择');
    confirm.disabled = !browser.selectedPath;
    confirm.addEventListener('click', () => applyAssetSelection(browser.selectedPath));
    const recapture = el('button', '', '重新截取');
    recapture.disabled = !browser.selectedPath;
    recapture.addEventListener('click', () => recaptureAsset(browser.selectedPath));
    const actions = el('div', 'asset-browser-actions');
    actions.appendChild(recapture);
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    footer.appendChild(selectedValue);
    footer.appendChild(actions);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);

    if (browser.images === null) {
      grid.appendChild(el('div', 'asset-browser-status', '正在读取 assets 图片…'));
      return;
    }

    const folderEntries = assetFolders(browser.images);
    if (!folderEntries.some(([folder]) => folder === browser.folder)) browser.folder = 'assets';
    for (const [folder, count] of folderEntries) {
      const button = el('button', `asset-folder${folder === browser.folder ? ' selected' : ''}`);
      button.style.paddingLeft = `${10 + Math.max(0, folder.split('/').length - 1) * 14}px`;
      const label = el('span', 'asset-folder-name', folder === 'assets' ? '全部图片' : folder.slice(folder.lastIndexOf('/') + 1));
      label.title = folder;
      button.appendChild(label);
      button.appendChild(el('span', 'asset-folder-count', String(count)));
      button.addEventListener('click', () => {
        browser.folder = folder;
        renderAssetBrowser();
      });
      folders.appendChild(button);
    }

    const query = browser.query.trim().toLocaleLowerCase('zh-CN');
    const visible = browser.images.filter((image) => {
      const inFolder = browser.folder === 'assets' || image.path.startsWith(`${browser.folder}/`);
      return inFolder && (!query || image.path.toLocaleLowerCase('zh-CN').includes(query));
    });
    (toolbar.lastChild as HTMLElement).textContent = `${visible.length} / ${total} 张图片`;
    if (!visible.length) {
      grid.appendChild(el('div', 'asset-browser-status', browser.images.length ? '没有匹配的图片' : 'assets 中暂无图片'));
      return;
    }

    const setSelection = (assetPath: string): void => {
      browser.selectedPath = assetPath;
      selectedValue.textContent = assetPath;
      selectedValue.title = assetPath;
      confirm.disabled = false;
      recapture.disabled = false;
      for (const tile of Array.from(grid.children)) {
        const element = tile as HTMLElement;
        element.classList.toggle('selected', element.dataset.path === assetPath);
        element.setAttribute('aria-pressed', String(element.dataset.path === assetPath));
      }
    };
    for (const asset of visible) {
      const tile = el('button', `asset-tile${asset.path === browser.selectedPath ? ' selected' : ''}`);
      tile.dataset.path = asset.path;
      tile.title = asset.path;
      tile.setAttribute('aria-pressed', String(asset.path === browser.selectedPath));
      const preview = el('span', 'asset-preview');
      const image = el('img');
      image.src = asset.uri;
      image.alt = '';
      image.loading = 'lazy';
      if (browser.cacheBust) image.src += `${image.src.includes('?') ? '&' : '?'}v=${browser.cacheBust}`;
      image.addEventListener('error', () => {
        preview.classList.add('failed');
        image.remove();
        preview.appendChild(el('span', '', '无法预览'));
      });
      preview.appendChild(image);
      tile.appendChild(preview);
      const filename = asset.path.slice(asset.path.lastIndexOf('/') + 1);
      tile.appendChild(el('span', 'asset-name', filename));
      tile.appendChild(el('span', 'asset-path', asset.path));
      tile.addEventListener('click', () => setSelection(asset.path));
      tile.addEventListener('dblclick', () => applyAssetSelection(asset.path));
      tile.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setSelection(asset.path);
        // Keep the menu inside the top-level modal, not the inspector iframe.
        overlay.querySelector('.asset-context-menu')?.remove();
        const menu = el('button', 'asset-context-menu', '重新截取');
        menu.style.left = `${Math.max(8, Math.min(event.clientX, overlay.clientWidth - 112))}px`;
        menu.style.top = `${Math.max(8, Math.min(event.clientY, overlay.clientHeight - 40))}px`;
        menu.addEventListener('click', () => { menu.remove(); recaptureAsset(asset.path); });
        menu.addEventListener('blur', () => menu.remove());
        overlay.appendChild(menu);
        menu.focus();
      });
      grid.appendChild(tile);
    }
  }

  return { assetBrowserOverlay, openAssetBrowser, closeAssetBrowser, renderAssetBrowser, restoreAssetBrowserAfterRoi, recaptureAsset, requestTemplateReplacement };
}
