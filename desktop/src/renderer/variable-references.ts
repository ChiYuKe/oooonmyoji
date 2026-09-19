/**
 * 变量引用面板：列出「谁在引用这个变量」，并提供直接删除变量的出口。
 *
 * 变量一旦被引用就不能直接删除，但只说一句「不能删除」并不告诉用户引用在哪、
 * 更没法快速过去处理。这个面板把引用列成可点击的清单（点了就跳到那张卡片），
 * 同时给出两条出口：逐个跳过去断开，或者直接删除变量并让引用一并回落默认值。
 *
 * 面板本身不读写工作流：数据由详细信息面板（引用与参数的唯一持有者）随消息送来，
 * 面板只渲染并把用户的选择发回去。
 */
import { ArrowRight, Link2, Trash2, Variable, X, createElement } from 'lucide';
import type { SharedPanelDockBridge } from './docking';

/** 一条引用：来自参数里的 `{ref}`，或变量的「初始化输入」绑定。 */
export interface VariableReferenceEntry {
  /** 引用所在节点；初始化输入这类没有节点。 */
  nodeId?: string;
  nodeName?: string;
  /** 参数名（含 `inputs.x` / `runs.0.inputs.x` 这类嵌套形式）。 */
  param?: string;
  /** 引用原文，例如 `inputs.等待.seconds`。 */
  ref?: string;
  /** 人类可读的引用位置，例如「参数「超时」」。 */
  label?: string;
  /** 这条引用是画布上连出来的（`_variableLinks` 有对应项）。 */
  linked?: boolean;
  /** 变量由某个输入初始化（`variables.x.initial_from`），不是参数引用。 */
  initializer?: boolean;
}

export interface VariableReferencesData {
  scope: 'inputs' | 'variables';
  name: string;
  displayName: string;
  entries: VariableReferenceEntry[];
}

/** 打开面板时的来源：数据来自哪个编辑器画布，命令就回发给它。 */
export interface VariableReferencesSource {
  frame: HTMLIFrameElement;
  post: (command: string, value?: unknown) => void;
}

export interface VariableReferencesDeps {
  /**
   * 面板走共享停靠：默认与「内容浏览器」叠成同一个标签组（内层或外层都跟着它走），
   * 所以这里拿到的是跨层桥，而不是某一个 Dockview。
   */
  getSharedPanels: () => SharedPanelDockBridge | undefined;
  /** 跳到引用所在节点的卡片。 */
  focusNode: (source: VariableReferencesSource, nodeId: string) => void;
  /** 选中该变量（初始化输入这类没有节点可跳时用）。 */
  selectVariable: (source: VariableReferencesSource, scope: string, name: string) => void;
  /** 直接删除变量：引用一并清理，参数回落到动作默认值。 */
  deleteVariable: (source: VariableReferencesSource, scope: string, name: string) => void;
  showToast: (message: string, error?: boolean) => void;
}

export interface VariableReferences {
  open(data: VariableReferencesData, source: VariableReferencesSource): void;
  close(): void;
  /** 面板是否打开。 */
  isOpen(): boolean;
}

export function createVariableReferences(deps: VariableReferencesDeps): VariableReferences {
  const { getSharedPanels, focusNode, selectVariable, deleteVariable, showToast } = deps;

  let panel: HTMLElement | undefined;
  let data: VariableReferencesData | undefined;
  let source: VariableReferencesSource | undefined;
  let keyHandler: ((event: KeyboardEvent) => void) | undefined;

  function isOpen(): boolean {
    return Boolean(getSharedPanels()?.surface('variableReferences'));
  }

  function close(): void {
    if (panel && keyHandler) panel.removeEventListener('keydown', keyHandler, true);
    getSharedPanels()?.close('variableReferences');
    panel?.remove();
    panel = undefined;
    data = undefined;
    source = undefined;
    keyHandler = undefined;
  }

  function entryTitle(entry: VariableReferenceEntry): string {
    if (entry.initializer) return '变量的初始化输入';
    const where = entry.nodeName ? `节点「${entry.nodeName}」` : '节点';
    const target = entry.param ? `参数「${entry.param}」` : '参数';
    return `${where} · ${target}`;
  }

  function render(): void {
    const host = document.querySelector<HTMLElement>('#module-variable-references');
    if (!host || !data) return;
    const doc = document;

    const root = doc.createElement('div');
    root.className = 'variable-references';
    root.tabIndex = -1;

    const header = doc.createElement('div');
    header.className = 'variable-references-header';
    const heading = doc.createElement('div');
    heading.className = 'variable-references-heading';
    const title = doc.createElement('strong');
    title.textContent = data.displayName || data.name;
    title.title = data.name;
    const meta = doc.createElement('small');
    const nodeCount = new Set(data.entries.filter((entry) => entry.nodeId).map((entry) => entry.nodeId)).size;
    meta.textContent = nodeCount
      ? `${data.entries.length} 处引用 · ${nodeCount} 个节点`
      : `${data.entries.length} 处引用`;
    heading.append(title, meta);
    const closeButton = doc.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'panel-action';
    closeButton.title = '关闭 (Esc)';
    closeButton.setAttribute('aria-label', '关闭');
    closeButton.appendChild(createElement(X, { width: '14', height: '14', 'aria-hidden': 'true' }));
    closeButton.addEventListener('click', close);
    header.append(heading, closeButton);
    root.appendChild(header);

    const body = doc.createElement('div');
    body.className = 'variable-references-body';
    const list = doc.createElement('ul');
    list.className = 'variable-references-list';
    for (const entry of data.entries) {
      const item = doc.createElement('li');
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = `variable-reference-row${entry.initializer ? ' initializer' : ''}${entry.linked ? ' linked' : ''}`;
      button.title = entry.ref ? `${entryTitle(entry)}\n${entry.ref}` : entryTitle(entry);

      const icon = doc.createElement('span');
      icon.className = 'variable-reference-icon';
      icon.appendChild(createElement(entry.initializer ? Variable : entry.linked ? Link2 : ArrowRight, {
        width: '14', height: '14', 'aria-hidden': 'true',
      }));

      const text = doc.createElement('span');
      text.className = 'variable-reference-text';
      const name = doc.createElement('strong');
      name.textContent = entry.nodeName || (entry.initializer ? '初始化输入' : '未知节点');
      const detail = doc.createElement('small');
      detail.textContent = entry.label || entry.param || entry.ref || '';
      text.append(name, detail);

      const badge = doc.createElement('span');
      badge.className = `variable-reference-badge${entry.linked ? ' linked' : ''}`;
      badge.textContent = entry.linked ? '画布连线' : '参数引用';

      button.append(icon, text, badge);
      button.addEventListener('click', () => {
        if (!source) return;
        if (entry.nodeId) focusNode(source, entry.nodeId);
        else selectVariable(source, data!.scope, data!.name);
      });
      item.appendChild(button);
      list.appendChild(item);
    }
    body.appendChild(list);
    root.appendChild(body);

    const footer = doc.createElement('div');
    footer.className = 'variable-references-footer';
    const hint = doc.createElement('span');
    hint.className = 'variable-references-hint';
    hint.textContent = '点引用跳过去逐个断开，或直接删除变量。';
    const remove = doc.createElement('button');
    remove.type = 'button';
    remove.className = 'panel-action danger';
    remove.appendChild(createElement(Trash2, { width: '13', height: '13', 'aria-hidden': 'true' }));
    const removeLabel = doc.createElement('span');
    removeLabel.textContent = '直接删除变量';
    remove.appendChild(removeLabel);
    remove.title = '删除变量，并让这些引用清空、参数回落到动作默认值';
    remove.addEventListener('click', () => {
      const target = data;
      const origin = source;
      if (!target || !origin) return;
      deleteVariable(origin, target.scope, target.name);
      showToast(`已删除变量 ${target.displayName || target.name}，${target.entries.length} 处引用已回落到默认值`);
      close();
    });
    footer.append(hint, remove);
    root.appendChild(footer);

    host.replaceChildren(root);
    panel = root;
    keyHandler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    root.addEventListener('keydown', keyHandler, true);
    root.focus();
  }

  function open(next: VariableReferencesData, origin: VariableReferencesSource): void {
    data = next;
    source = origin;
    getSharedPanels()?.show('variableReferences');
    render();
  }

  return { open, close, isOpen };
}
