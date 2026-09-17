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
}

export interface WorkflowBrowser {
  workflowReference(file: WorkflowBrowserFile): string;
  openWorkflowBrowser(nodeId: string, key: string, currentReference: string): void;
  closeWorkflowBrowser(): void;
  renderWorkflowBrowser(): void;
}

export function createWorkflowBrowser(deps: WorkflowBrowserDeps): WorkflowBrowser {
  const { state, $, el, nodeById, mutate, toast } = deps;

  function workflowReference(file: WorkflowBrowserFile): string {
    const rel = typeof file.rel === 'string' ? file.rel.replace(/\\/g, '/') : '';
    const match = rel.match(/(?:^|\/)workflows\/(.+)$/i);
    return match ? match[1] : String(file.name || '').replace(/\\/g, '/');
  }

  function workflowBrowserFiles(): Array<WorkflowBrowserFile & { reference: string }> {
    return (Array.isArray(state.workflows) ? state.workflows : [])
      .filter((file) => file && file.uri !== state.docUri)
      .map((file) => ({ ...file, reference: workflowReference(file) }))
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
    $('workflow-browser').classList.remove('hidden');
    renderWorkflowBrowser();
  }

  function closeWorkflowBrowser(): void {
    const overlay = $('workflow-browser');
    if (overlay) overlay.classList.add('hidden');
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
    const overlay = $('workflow-browser');
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
      const next = $('workflow-browser').children[0];
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
      const item = el('button', `workflow-file${file.reference === browser.selectedReference ? ' selected' : ''}`);
      item.dataset.reference = file.reference;
      item.title = [file.description, file.rel || file.reference].filter(Boolean).join('\n');
      item.appendChild(el('span', 'workflow-file-icon', '{ }'));
      const detail = el('span', 'workflow-file-detail');
      detail.appendChild(el('span', 'workflow-file-name', file.name || file.reference.slice(file.reference.lastIndexOf('/') + 1)));
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
