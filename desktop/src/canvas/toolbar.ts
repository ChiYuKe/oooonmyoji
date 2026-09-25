/**
 * 标题栏工具条：实例/工作流选择器、面包屑、按钮事件与按 name 搜索卡片。
 * 原 `editor-toolbar.js`；主编辑器通过工厂注入状态与 DOM 依赖，
 * 选择器钩子（setWorkflow/setInstance）随工厂返回，由入口交给桥接转发。
 */
import { documentText } from './state/document-text';

export interface ToolbarInstance {
  id: string;
  displayName?: string;
  backend?: string;
  mumuIndex?: number;
  adbSerial?: string;
}

export interface ToolbarWorkflow {
  uri: string;
  name: string;
  rel?: string;
}

export interface ToolbarTrailItem {
  uri?: string;
  name?: string;
}

export interface ToolbarMenuItem {
  label: string;
  run(): void;
}

export type ToolbarMenuEntry = ToolbarMenuItem | 'separator';

export interface ToolbarState {
  instances?: ToolbarInstance[];
  instanceId: string;
  workflows?: ToolbarWorkflow[];
  docUri?: string;
  documentName?: string;
  dirty?: boolean;
  raw: unknown;
  workflowTrail?: ToolbarTrailItem[];
  nodeSearch: { query: string; ids: string[]; index: number };
  selected: Set<string>;
  selectedEdge: unknown;
  selectedRun: unknown;
  inspector?: string;
}

export interface DropdownEntry {
  value: string;
  label: string;
  title?: string;
  disabled?: boolean;
  detail?: string;
}

export interface ToolbarDropdown extends HTMLElement {
  set?: (value: string) => void;
}

export interface ToolbarUi {
  dropdown(options: {
    value: string;
    options: DropdownEntry[];
    onChange: (value: string) => void;
    className?: string;
    searchable?: boolean;
    placeholder?: string;
    label?: string;
  }): ToolbarDropdown;
}

export interface ToolbarNode {
  id: string;
  name?: unknown;
}

export interface ToolbarDeps {
  state: ToolbarState;
  $(id: string): HTMLElement;
  el(tag: string, className?: string, text?: string): HTMLElement;
  UI: ToolbarUi;
  vscode: { postMessage(message: unknown): void };
  showMenu(x: number, y: number, entries: ToolbarMenuEntry[], options?: { align?: 'start' | 'end' }): void;
  zoomAt(factor: number): void;
  setDirty(value: boolean): void;
  toast(message: string, error?: boolean): void;
  nodes(): ToolbarNode[];
  /** 节点显示标题（值卡片是类型派生标题）；缺省时退回 `node.name`。搜索与提示都说这一层。 */
  nodeTitle?(node: ToolbarNode): string;
  focusNode(id: string): void;
  currentNodeGroup?(): { id: string; name: string } | null;
  leaveNodeGroup?(): boolean;
  groupSelection?(): boolean;
  /**
   * 保存入口：先做「只拦真正跑不起来的错误」的把关；缺省时退化为直接写盘。
   */
  requestSave?(): void;
  /** 上一个 / 下一个校验问题（错误与提醒一起走）。 */
  gotoIssue?(step: 1 | -1): void;
  /** 布局体检与修复：只重建布局。 */
  repairLayout?(): void;
}

export interface ToolbarController {
  renderInstancePicker(): void;
  renderWorkflowPicker(): void;
  renderWorkflowBreadcrumb(): void;
  bindToolbar(): void;
  searchNodeByName(value: string): void;
  /** 顶栏工作流/实例选择器：由桥接在收到 desktopControl 时转发。 */
  setWorkflow(value: string): void;
  setInstance(value: string): void;
}

export function createEditorToolbar(deps: ToolbarDeps): ToolbarController {
  const { state, $, el, UI, vscode, showMenu, zoomAt, setDirty, toast, nodes, focusNode } = deps;

  function renderInstancePicker(): void {
    const slot = $('instance-select');
    slot.innerHTML = '';
    const instances = Array.isArray(state.instances) ? state.instances : [];
    if (!instances.length) {
      state.instanceId = '';
      const dropdown = UI.dropdown({
        value: '',
        options: [{ value: '', label: '未检测到运行实例' }],
        onChange: () => {},
        className: 'instance-slot-control',
      });
      dropdown.title = '请先启动 MuMu 或连接 Android 设备';
      slot.appendChild(dropdown);
      $('btn-run').title = '未检测到运行实例';
      return;
    }
    if (!instances.some((instance) => instance.id === state.instanceId)) state.instanceId = instances[0].id;
    const options = instances.map((instance) => {
      const label = instance.displayName
        || (instance.backend === 'mumu' && Number.isInteger(instance.mumuIndex) ? `MuMu ${instance.mumuIndex}` : instance.id);
      return {
        value: instance.id,
        label,
        title: [instance.displayName, instance.id, instance.backend, instance.adbSerial].filter(Boolean).join(' · '),
      };
    });
    const dropdown = UI.dropdown({
      value: state.instanceId,
      options,
      onChange: (value) => {
        state.instanceId = value;
        vscode.postMessage({ type: 'selectInstance', instanceId: state.instanceId });
      },
      className: 'instance-slot-control',
    });
    const selected = instances.find((instance) => instance.id === state.instanceId);
    dropdown.title = selected
      ? [selected.id, selected.displayName, selected.adbSerial].filter(Boolean).join(' · ')
      : '请先启动 MuMu 或连接 Android 设备';
    slot.appendChild(dropdown);
    $('btn-run').title = `在 ${state.instanceId} 执行当前工作流`;
  }

  function renderWorkflowPicker(): void {
    const slot = $('workflow-select');
    slot.innerHTML = '';
    const workflows = Array.isArray(state.workflows) ? state.workflows : [];
    const all = workflows.slice();
    if (state.docUri && !all.some((item) => item.uri === state.docUri)) {
      // 当前文件不在已发现列表（如新建未保存）时仍保留为可切换项。
      const current = state.documentName || '当前工作流';
      all.unshift({ uri: state.docUri, name: current, rel: '' });
    }
    const dropdown = UI.dropdown({
      value: state.docUri || '',
      options: all.map((item) => ({ value: item.uri, label: item.name, title: item.rel || item.uri })),
      onChange: (uri) => {
        if (!uri || uri === state.docUri) return;
        const switchTo = (saveText?: string): void => {
          state.docUri = uri; // 乐观更新，切换失败由 init 纠正
          vscode.postMessage({ type: 'switchWorkflow', uri, saveText });
        };
        if (state.dirty) {
          const rect = slot.querySelector<HTMLElement>('.ui-dropdown-button')?.getBoundingClientRect();
          showMenu(rect ? rect.left : 8, (rect ? rect.bottom : 40) + 4, [
            { label: '保存并切换', run: () => switchTo(documentText(state)) },
            { label: '放弃修改并切换', run: () => switchTo(undefined) },
            'separator',
            { label: '取消', run: () => slot.querySelector<ToolbarDropdown>('.ui-dropdown')?.set?.(state.docUri || '') },
          ]);
        } else {
          switchTo(undefined);
        }
      },
      className: 'workflow-slot-control',
    });
    dropdown.title = '切换工作流（无需重新打开）';
    slot.appendChild(dropdown);
  }

  function navigateWorkflowTrail(index: number): void {
    const send = (saveText?: string): void => vscode.postMessage({ type: 'navigateWorkflowTrail', index, saveText });
    if (!state.dirty) { send(undefined); return; }
    const rect = $('workflow-breadcrumb').getBoundingClientRect();
    showMenu(rect.left, rect.bottom + 4, [
      { label: '保存并跳转', run: () => send(documentText(state)) },
      { label: '放弃修改并跳转', run: () => send(undefined) },
      'separator',
      { label: '取消', run: () => {} },
    ]);
  }

  function renderWorkflowBreadcrumb(): void {
    const nav = $('workflow-breadcrumb');
    if (!nav) return;
    nav.innerHTML = '';
    const group = deps.currentNodeGroup?.() || null;
    let trail = Array.isArray(state.workflowTrail) ? state.workflowTrail.slice() : [];
    $('btn-back')?.classList.toggle('hidden', !group && trail.length < 2);
    if (group && !trail.length) trail = [{ uri: state.docUri, name: state.documentName || '当前工作流' }];
    if (!trail.length && !group) {
      nav.classList.add('hidden');
      return;
    }
    nav.classList.remove('hidden');
    nav.appendChild(el('span', 'workflow-breadcrumb-mark', '◆'));
    trail.forEach((item, index) => {
      if (index > 0) nav.appendChild(el('span', 'workflow-breadcrumb-separator', '›'));
      const current = index === trail.length - 1 && !group;
      const button = el('button', `workflow-crumb${current ? ' current' : ''}`, item.name || '工作流') as HTMLButtonElement;
      button.type = 'button';
      button.title = item.uri || item.name || '工作流';
      if (current) {
        button.disabled = true;
        button.setAttribute('aria-current', 'page');
      } else if (group && index === trail.length - 1) button.addEventListener('click', () => deps.leaveNodeGroup?.());
      else button.addEventListener('click', () => navigateWorkflowTrail(index));
      nav.appendChild(button);
    });
    if (group) {
      nav.appendChild(el('span', 'workflow-breadcrumb-separator', '›'));
      const button = el('button', 'workflow-crumb current node-group-crumb', group.name) as HTMLButtonElement;
      button.type = 'button';
      button.disabled = true;
      button.setAttribute('aria-current', 'page');
      nav.appendChild(button);
    }
  }

  function bindToolbar(): void {
    $('btn-zoom-in').addEventListener('click', () => zoomAt(1.2));
    $('btn-zoom-out').addEventListener('click', () => zoomAt(1 / 1.2));
    $('btn-back').addEventListener('click', () => {
      if (deps.currentNodeGroup?.()) {
        deps.leaveNodeGroup?.();
        return;
      }
      const goBack = (saveText?: string): void => vscode.postMessage({ type: 'goBackWorkflow', saveText });
      if (state.dirty) {
        const rect = $('btn-back').getBoundingClientRect();
        showMenu(rect.left, rect.bottom + 4, [
          { label: '保存并返回', run: () => goBack(documentText(state)) },
          { label: '放弃修改并返回', run: () => goBack(undefined) },
          'separator',
          { label: '取消', run: () => {} },
        ]);
      } else {
        goBack(undefined);
      }
    });
    $('btn-run').addEventListener('click', () => vscode.postMessage({
      type: 'runWorkflow',
      uri: state.docUri,
      instanceId: state.instanceId,
      text: documentText(state),
    }));
    $('btn-stop').addEventListener('click', () => vscode.postMessage({ type: 'stopWorkflow' }));
    $('btn-save').addEventListener('click', () => {
      // 保存把关：只有运行时会拒绝的错误才弹确认；提醒直接放行。
      if (deps.requestSave) { deps.requestSave(); return; }
      vscode.postMessage({ type: 'save', text: documentText(state) });
      setDirty(false);
    });
    $('btn-more').addEventListener('click', () => {
      const rect = $('btn-more').getBoundingClientRect();
      showMenu(rect.right, rect.bottom + 4, [
        { label: '将所选节点打组', run: () => deps.groupSelection?.() },
        'separator',
        // 问题导航：画布上的红标记走到哪都能一键跳到下一个（F8 / Shift+F8 同一条命令）。
        { label: '下一个问题 (F8)', run: () => deps.gotoIssue?.(1) },
        { label: '上一个问题 (Shift+F8)', run: () => deps.gotoIssue?.(-1) },
        'separator',
        // 布局体检：坐标坏了只重建布局，不动节点数据。
        { label: '重建布局（只动坐标）', run: () => deps.repairLayout?.() },
        'separator',
        { label: '新建工作流', run: () => vscode.postMessage({ type: 'newWorkflow' }) },
        { label: '选择其他工作流…', run: () => vscode.postMessage({ type: 'openWorkflowPicker' }) },
        { label: '打开 JSON', run: () => vscode.postMessage({ type: 'openFile' }) },
        'separator',
        { label: '在结构树窗口查看', run: () => vscode.postMessage({ type: 'openWorkflowTree' }) },
        'separator',
        { label: '查看引用', run: () => vscode.postMessage({ type: 'openReferences' }) },
        'separator',
        { label: '重新加载', run: () => vscode.postMessage({ type: 'reloadRequest' }) },
      ], { align: 'end' });
    });
  }

  function searchNodeByName(value: string): void {
    const query = String(value || '').trim();
    if (!query) {
      toast('请输入卡片名称', true);
      return;
    }
    // 搜索匹配卡片上看得见的标题：值卡片显示类型派生标题（`Break 识别结果` / `等于`），
    // 只按 `name` 找会漏掉它们。
    const titleOf = (node: ToolbarNode): string => {
      const title = deps.nodeTitle ? String(deps.nodeTitle(node) || '').trim() : '';
      return title || String(node && node.name || '').trim();
    };
    const normalized = query.toLocaleLowerCase();
    const matches = nodes().filter((node) => titleOf(node).toLocaleLowerCase().includes(normalized));
    if (matches.length === 0) {
      state.nodeSearch = { query: normalized, ids: [], index: -1 };
      toast(`没有找到标题包含“${query}”的卡片`, true);
      return;
    }
    const ids = matches.map((node) => node.id);
    const sameResults = state.nodeSearch.query === normalized
      && ids.length === state.nodeSearch.ids.length
      && ids.every((id, index) => id === state.nodeSearch.ids[index]);
    const index = sameResults ? (state.nodeSearch.index + 1) % matches.length : 0;
    const target = matches[index];
    state.nodeSearch = { query: normalized, ids, index };
    state.selected = new Set([target.id]);
    state.selectedEdge = null;
    state.selectedRun = null;
    state.inspector = 'node';
    focusNode(target.id);
    toast(`卡片 ${index + 1}/${matches.length}：${titleOf(target)}`);
  }

  function setWorkflow(uri: string): void {
    state.docUri = String(uri || '');
    renderWorkflowPicker();
  }

  function setInstance(instanceId: string): void {
    state.instanceId = String(instanceId || '');
    renderInstancePicker();
    vscode.postMessage({ type: 'selectInstance', instanceId: state.instanceId });
  }

  return { renderInstancePicker, renderWorkflowPicker, renderWorkflowBreadcrumb, bindToolbar, searchNodeByName, setWorkflow, setInstance };
}
