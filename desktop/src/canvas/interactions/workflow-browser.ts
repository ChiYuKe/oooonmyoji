/**
 * 子工作流选择弹层：列出可用的 workflows 脚本并按文件夹/关键字筛选。
 * 原 `editor-workflow-browser.js`；主编辑器通过工厂注入状态与 DOM 依赖。
 */

export interface WorkflowBrowserFile {
  uri?: string;
  name?: string;
  rel?: string;
  description?: string;
  reference?: string;
  [key: string]: unknown;
}

export interface WorkflowBrowserState {
  workflows?: WorkflowBrowserFile[];
  docUri?: string;
  workflowBrowser?: {
    nodeId: string;
    key: string;
    folder: string;
    query: string;
    selectedReference: string;
  } | null;
}

export interface WorkflowBrowserNode {
  action?: string;
  params: Record<string, unknown>;
}

export type CreateBrowserElement = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K];

export interface WorkflowBrowserDeps {
  state: WorkflowBrowserState;
  $(id: string): HTMLElement;
  el: CreateBrowserElement;
  nodeById(id: string): WorkflowBrowserNode | undefined;
  mutate(fn: () => void): void;
  toast(message: string, error?: boolean): void;
  /** 打开弹层时向壳层要一次最新的脚本目录（别处新建/外部改动后列表不会过期）。 */
  requestWorkflows?(): void;
}

export interface WorkflowBrowser {
  workflowReference(file: WorkflowBrowserFile): string;
  openWorkflowBrowser(nodeId: string, key: string, currentReference: string): void;
  closeWorkflowBrowser(): void;
  renderWorkflowBrowser(): void;
}

interface WorkflowBrowserPortal {
  host: HTMLDialogElement;
  overlay: HTMLElement;
  originalParent: Node;
  returnFocus: Element | null;
}

export function createWorkflowBrowser(deps: WorkflowBrowserDeps): WorkflowBrowser {
  const { state, $, el, nodeById, mutate, toast, requestWorkflows } = deps;

  let workflowBrowserPortal: WorkflowBrowserPortal | null = null;

  /** 弹层默认在画布文档里；移植到顶层后就取移植过去的那个。 */
  function workflowBrowserOverlay(): HTMLElement {
    return workflowBrowserPortal ? workflowBrowserPortal.overlay : $('workflow-browser');
  }

  function createStylesheets(owner: Document): HTMLLinkElement[] {
    // 弹层挂到顶层文档、样式却来自画布文档：href 必须相对画布文档解析。
    // workflow-editor.css 提供按钮/输入框/.overlay/.hidden 这些基础样式，弹层专用规则在其后。
    const base = document.baseURI || 'http://localhost/canvas.html';
    return ['./legacy/workflow-editor.css', './legacy/workflow-browser.css'].map((href) => {
      const sheet = owner.createElement('link');
      sheet.rel = 'stylesheet';
      sheet.href = new URL(href, base).href;
      return sheet;
    });
  }

  /**
   * 把弹层移植到顶层文档的 <dialog> + shadow root。
   * 详情栏是窄 iframe，弹层留在里面会被挤成一条；素材浏览器就是这么做的，这里保持一致。
   */
  function mountWorkflowBrowser(): void {
    if (workflowBrowserPortal) return;
    let owner: Document = document;
    try { owner = window.top!.document; } catch { /* Standalone / cross-origin host. */ }
    const overlay = $('workflow-browser');
    const originalParent = overlay.parentNode!;
    const returnFocus = document.activeElement;
    const host = owner.createElement('dialog');
    host.setAttribute('aria-label', '选择子工作流');
    host.style.cssText = 'padding:0;border:0;max-width:none;max-height:none;width:100vw;height:100vh;background:transparent;color:inherit;overflow:hidden;';
    const surface = owner.createElement('div');
    host.appendChild(surface);
    const shadow = surface.attachShadow({ mode: 'open' });
    for (const sheet of createStylesheets(owner)) shadow.appendChild(sheet);
    shadow.appendChild(overlay);
    // shadow root 里 :root 的变量不会继承，把弹层用到的语义变量同步到 host 上。
    const computed = getComputedStyle(document.documentElement);
    const variables = [
      '--bg', '--fg', '--muted', '--panel', '--panel-2', '--border', '--accent', '--button', '--button-hover',
      '--danger', '--vscode-input-background', '--vscode-input-foreground', '--vscode-button-foreground',
      '--vscode-list-activeSelectionBackground',
    ];
    for (const name of variables) host.style.setProperty(name, computed.getPropertyValue(name));
    host.addEventListener('cancel', (event) => { event.preventDefault(); closeWorkflowBrowser(); });
    host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeWorkflowBrowser(); }
      event.stopPropagation();
    });
    owner.body.appendChild(host);
    workflowBrowserPortal = { host, overlay, originalParent, returnFocus };
    host.showModal();
  }

  function unmountWorkflowBrowser(): void {
    const portal = workflowBrowserPortal;
    if (!portal) return;
    const { host, overlay, originalParent, returnFocus } = portal;
    host.close();
    originalParent.appendChild(overlay);
    host.remove();
    workflowBrowserPortal = null;
    if (returnFocus?.isConnected) (returnFocus as HTMLElement).focus();
  }

  function workflowReference(file: WorkflowBrowserFile): string {
    const rel = typeof file.rel === 'string' ? file.rel.replace(/\\/g, '/') : '';
    const match = rel.match(/(?:^|\/)workflows\/(.+)$/i);
    return match ? match[1] : String(file.name || '').replace(/\\/g, '/');
  }

  /**
   * 可选脚本清单：**包含当前文档**（否则「子文件夹里的脚本」会整个消失，让人以为目录漏了），
   * 但当前文档标成 current，不允许选成自己的子工作流。
   */
  function workflowBrowserFiles(): Array<WorkflowBrowserFile & { reference: string; current: boolean }> {
    return (Array.isArray(state.workflows) ? state.workflows : [])
      .filter((file) => Boolean(file))
      .map((file) => ({ ...file, reference: workflowReference(file), current: Boolean(state.docUri) && file.uri === state.docUri }))
      .filter((file) => file.reference);
  }

  function openWorkflowBrowser(nodeId: string, key: string, currentReference: string): void {
    const normalized = typeof currentReference === 'string' ? currentReference.replace(/\\/g, '/').replace(/^workflows\//i, '') : '';
    const slash = normalized.lastIndexOf('/');
    state.workflowBrowser = {
      nodeId,
      key,
      folder: slash > 0 ? `workflows/${normalized.slice(0, slash)}` : 'workflows',
      query: '',
      selectedReference: normalized,
    };
    requestWorkflows?.();
    mountWorkflowBrowser();
    workflowBrowserOverlay().classList.remove('hidden');
    renderWorkflowBrowser();
    workflowBrowserOverlay().querySelector('input')?.focus();
  }

  function closeWorkflowBrowser(): void {
    const overlay = workflowBrowserOverlay();
    if (overlay) overlay.classList.add('hidden');
    unmountWorkflowBrowser();
    state.workflowBrowser = null;
  }

  function workflowFolders(files: Array<WorkflowBrowserFile & { reference: string }>): Array<[string, number]> {
    const counts = new Map<string, number>([['workflows', files.length]]);
    for (const file of files) {
      const parts = file.reference.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        const folder = `workflows/${parts.slice(0, index).join('/')}`;
        counts.set(folder, (counts.get(folder) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'));
  }

  function applyWorkflowSelection(reference: string): void {
    const browser = state.workflowBrowser;
    if (!browser || !reference) return;
    if (workflowBrowserFiles().some((file) => file.reference === reference && file.current)) {
      toast('当前工作流不能作为自己的子工作流', true);
      return;
    }
    const node = nodeById(browser.nodeId);
    if (!node) {
      closeWorkflowBrowser();
      toast('目标节点已不存在', true);
      return;
    }
    mutate(() => {
      const changed = node.params[browser.key] !== reference;
      node.params[browser.key] = reference;
      if (node.action === 'workflow.run' && browser.key === 'workflow' && changed) node.params.inputs = {};
    });
    closeWorkflowBrowser();
    toast('已选择子工作流');
  }

  function renderWorkflowBrowser(): void {
    const browser = state.workflowBrowser;
    const overlay = workflowBrowserOverlay();
    if (!browser || !overlay) return;
    overlay.innerHTML = '';

    const files = workflowBrowserFiles();
    const dialog = el('div', 'workflow-browser-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', '选择子工作流');
    const head = el('div', 'workflow-browser-head');
    const title = el('div', 'workflow-browser-title', '选择子工作流');
    const close = el('button', 'icon-button', '×');
    close.title = '关闭';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', closeWorkflowBrowser);
    head.appendChild(title);
    head.appendChild(close);
    dialog.appendChild(head);

    const toolbar = el('div', 'workflow-browser-toolbar');
    const search = el('input', 'workflow-search');
    search.type = 'search';
    search.placeholder = '搜索脚本名称或路径';
    search.value = browser.query;
    search.addEventListener('input', () => {
      browser.query = search.value;
      renderWorkflowBrowser();
      const next = workflowBrowserOverlay().children[0];
      const input = next && next.children[1] && next.children[1].children[0] as HTMLInputElement | undefined;
      if (input) {
        input.focus();
        input.setSelectionRange?.(input.value.length, input.value.length);
      }
    });
    toolbar.appendChild(search);
    toolbar.appendChild(el('span', 'workflow-total', `${files.length} 个脚本`));
    dialog.appendChild(toolbar);

    const content = el('div', 'workflow-browser-content');
    const folders = el('nav', 'workflow-folders');
    folders.setAttribute('aria-label', '工作流文件夹');
    const list = el('div', 'workflow-list');
    content.appendChild(folders);
    content.appendChild(list);
    dialog.appendChild(content);

    const footer = el('div', 'workflow-browser-footer');
    const selectedValue = el('div', 'workflow-selected-path', browser.selectedReference || '未选择脚本');
    selectedValue.title = browser.selectedReference || '';
    const cancel = el('button', '', '取消');
    cancel.addEventListener('click', closeWorkflowBrowser);
    const confirm = el('button', 'primary', '选择');
    confirm.disabled = !browser.selectedReference;
    confirm.addEventListener('click', () => applyWorkflowSelection(browser.selectedReference));
    const actions = el('div', 'workflow-browser-actions');
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    footer.appendChild(selectedValue);
    footer.appendChild(actions);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);

    const folderEntries = workflowFolders(files);
    if (!folderEntries.some(([folder]) => folder === browser.folder)) browser.folder = 'workflows';
    for (const [folder, count] of folderEntries) {
      const button = el('button', `workflow-folder${folder === browser.folder ? ' selected' : ''}`);
      button.style.paddingLeft = `${10 + Math.max(0, folder.split('/').length - 1) * 14}px`;
      const label = el('span', 'workflow-folder-name', folder === 'workflows' ? '全部脚本' : folder.slice(folder.lastIndexOf('/') + 1));
      label.title = folder;
      button.appendChild(label);
      button.appendChild(el('span', 'workflow-folder-count', String(count)));
      button.addEventListener('click', () => {
        browser.folder = folder;
        renderWorkflowBrowser();
      });
      folders.appendChild(button);
    }

    const query = browser.query.trim().toLocaleLowerCase('zh-CN');
    const folderPrefix = browser.folder === 'workflows' ? '' : `${browser.folder.slice('workflows/'.length)}/`;
    const visible = files.filter((file) => file.reference.startsWith(folderPrefix)
      && (!query
        || file.reference.toLocaleLowerCase('zh-CN').includes(query)
        || String(file.name || '').toLocaleLowerCase('zh-CN').includes(query)
        || String(file.description || '').toLocaleLowerCase('zh-CN').includes(query)));
    if (!visible.length) {
      list.appendChild(el('div', 'workflow-browser-status', files.length ? '没有匹配的脚本' : '没有其他可用的工作流脚本'));
      return;
    }

    const setSelection = (reference: string): void => {
      browser.selectedReference = reference;
      selectedValue.textContent = reference;
      selectedValue.title = reference;
      confirm.disabled = false;
      for (const item of Array.from(list.children)) {
        (item as HTMLElement).classList.toggle('selected', (item as HTMLElement).dataset.reference === reference);
      }
    };
    for (const file of visible) {
      const item = el('button', `workflow-file${file.reference === browser.selectedReference ? ' selected' : ''}${file.current ? ' current' : ''}`);
      item.dataset.reference = file.reference;
      item.title = [file.description, file.rel || file.reference].filter(Boolean).join('\n');
      item.appendChild(el('span', 'workflow-file-icon', '{ }'));
      const detail = el('span', 'workflow-file-detail');
      detail.appendChild(el('span', 'workflow-file-name', file.name || file.reference.slice(file.reference.lastIndexOf('/') + 1)));
      if (file.current) detail.appendChild(el('span', 'workflow-file-current', '当前脚本'));
      if (file.description) detail.appendChild(el('span', 'workflow-file-description', file.description));
      detail.appendChild(el('span', 'workflow-file-path', file.reference));
      item.appendChild(detail);
      item.addEventListener('click', () => setSelection(file.reference));
      item.addEventListener('dblclick', () => applyWorkflowSelection(file.reference));
      list.appendChild(item);
    }
  }

  return { workflowReference, openWorkflowBrowser, closeWorkflowBrowser, renderWorkflowBrowser };
}
