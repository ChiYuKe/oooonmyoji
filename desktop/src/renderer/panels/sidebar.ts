/**
 * 工作台左侧面板：结构树与变量列表。
 *
 * 画布把节点/变量投影通过消息发到壳层，本模块持有当前活动文档的展示状态，
 * 并在内容指纹不变时只更新选中行，保持滚动位置与折叠状态。
 */
import {
  Braces,
  ChevronRight,
  CircleDot,
  CircleHelp,
  Clock,
  Columns3,
  Crosshair,
  Eye,
  EyeOff,
  Flag,
  Folder,
  GitBranch,
  Hash,
  Image,
  Keyboard,
  List,
  ListTree,
  ListOrdered,
  MonitorUp,
  Network,
  Palette,
  Scan,
  Sigma,
  ToggleLeft,
  Type,
  Workflow,
  createElement,
  createIcons,
} from 'lucide';
import type { SidebarNode, SidebarStateChangedMessage, SidebarVariable } from '../../shared/editor-messages';
import { overviewInputDisplayName } from '../naming';

type IconComponent = typeof Flag;

export interface SidebarSnapshot {
  nodes: SidebarNode[];
  variables: SidebarVariable[];
  selectedNode: string;
  selectedVariable: string;
  selectedVariableScope: 'inputs' | 'variables';
  collapsed: Set<string>;
}

export interface SidebarDeps {
  structureView: HTMLElement;
  variablesView: HTMLElement;
  icons: NonNullable<Parameters<typeof createIcons>[0]>['icons'];
  editorCommand: (command: string, value?: unknown) => void;
  showDetailsPanel: () => void;
  /** 选中结构树/变量行后登记删除目标（Delete 交给画布执行），并带上名称信息供 F2 原地改名。 */
  registerEditorDeleteTarget: (target?: {
    nodeId?: string;
    variable?: { name: string; scope: 'inputs' | 'variables' };
  }) => void;
}

export interface Sidebar {
  snapshot(): SidebarSnapshot;
  apply(snapshot: SidebarSnapshot): void;
  /** 清空节点/变量/选中项，保留折叠状态。 */
  resetViews(): void;
  resetCollapsed(): void;
  render(): void;
  updateFromMessage(message: SidebarStateChangedMessage): void;
  /** 展开或收起全部结构树分支。 */
  setAllBranches(open: boolean): void;
  /** F2：结构树里这一行原地变成输入框。 */
  startNodeRename(nodeId: string): void;
  /** F2：变量列表里这一行原地变成输入框。 */
  startVariableRename(name: string, scope: 'inputs' | 'variables'): void;
  /** 是否有行正在行内改名（F2/Delete 守卫用）。 */
  isRenaming(): boolean;
  cancelRename(): void;
}

/** 结构树节点类型 → Lucide 图标与语义色（保持低饱和，遵循设计规则）。 */
const treeNodeGlyphs: Record<string, { icon: IconComponent; className: string }> = {
  root: { icon: Flag, className: 'type-root' },
  sequence: { icon: ListTree, className: 'type-sequence' },
  selector: { icon: GitBranch, className: 'type-selector' },
  simple_parallel: { icon: Columns3, className: 'type-parallel' },
  instance_parallel: { icon: MonitorUp, className: 'type-instance-parallel' },
  task: { icon: Workflow, className: 'type-task' },
};
const treeNodeFallbackGlyph = { icon: CircleDot, className: 'type-default' };

/** 工作流变量类型 → 图标；颜色由类型 class 统一控制。 */
const variableTypeGlyphs: Record<string, { icon: IconComponent; className: string }> = {
  string: { icon: Type, className: 'type-string' },
  number: { icon: Sigma, className: 'type-number' },
  integer: { icon: Hash, className: 'type-integer' },
  boolean: { icon: ToggleLeft, className: 'type-boolean' },
  rect: { icon: Scan, className: 'type-rect' },
  asset: { icon: Image, className: 'type-asset' },
  path: { icon: Folder, className: 'type-path' },
  array: { icon: List, className: 'type-array' },
  object: { icon: Braces, className: 'type-object' },
  any: { icon: CircleHelp, className: 'type-any' },
  point: { icon: Crosshair, className: 'type-point' },
  enum: { icon: ListOrdered, className: 'type-enum' },
  key: { icon: Keyboard, className: 'type-key' },
  color: { icon: Palette, className: 'type-color' },
  duration: { icon: Clock, className: 'type-duration' },
};
const variableTypeFallbackGlyph = { icon: CircleHelp, className: 'type-any' };
const variableTypeLabels: Record<string, string> = {
  string: '文本', number: '数值', integer: '整数', boolean: '布尔', rect: '区域',
  asset: '资源', path: '路径', array: '列表', object: '对象', any: '任意',
  point: '坐标点', enum: '枚举', key: '按键', color: '颜色', duration: '时长',
};

export function createSidebar(deps: SidebarDeps): Sidebar {
  const { structureView, variablesView, icons, editorCommand, showDetailsPanel, registerEditorDeleteTarget } = deps;

  let nodes: SidebarNode[] = [];
  let variables: SidebarVariable[] = [];
  let selectedNode = '';
  let selectedVariable = '';
  let selectedVariableScope: 'inputs' | 'variables' = 'inputs';
  let collapsed = new Set<string>();
  /** 行内改名草稿（F2）：命中的那一行渲染成输入框，Enter/失焦提交、Esc 取消。 */
  let nodeRenameDraft = '';
  let variableRenameDraft: { name: string; scope: 'inputs' | 'variables' } | undefined;
  let variableContextMenu: {
    owner: Document;
    menu: HTMLElement;
    dismiss: (event: Event) => void;
    keyHandler: (event: KeyboardEvent) => void;
  } | undefined;

  function closeVariableContextMenu(): void {
    if (!variableContextMenu) return;
    variableContextMenu.owner.removeEventListener('pointerdown', variableContextMenu.dismiss, true);
    variableContextMenu.owner.removeEventListener('keydown', variableContextMenu.keyHandler, true);
    variableContextMenu.menu.remove();
    variableContextMenu = undefined;
  }

  /** 变量行右键菜单：引用数据由文档画布在点击时实时计算，侧栏不缓存引用清单。 */
  function showVariableContextMenu(event: MouseEvent, variable: SidebarVariable, row: HTMLElement): void {
    closeVariableContextMenu();
    const doc = row.ownerDocument || document;
    const menu = doc.createElement('div');
    menu.className = 'sidebar-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '变量操作');

    const entry = doc.createElement('button');
    entry.type = 'button';
    entry.setAttribute('role', 'menuitem');
    entry.appendChild(createTreeIcon(Network, 'sidebar-context-menu-icon'));
    const label = doc.createElement('span');
    label.textContent = '查看变量引用';
    entry.appendChild(label);
    entry.addEventListener('click', () => {
      closeVariableContextMenu();
      editorCommand('showVariableReferences', { name: variable.name, scope: variable.scope });
    });
    menu.appendChild(entry);
    doc.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const viewportWidth = doc.documentElement.clientWidth;
    const viewportHeight = doc.documentElement.clientHeight;
    menu.style.left = `${Math.max(4, Math.min(event.clientX, viewportWidth - rect.width - 6))}px`;
    menu.style.top = `${Math.max(4, Math.min(event.clientY, viewportHeight - rect.height - 6))}px`;

    const dismiss = (pointerEvent: Event): void => {
      if (menu.contains(pointerEvent.target as Node)) return;
      closeVariableContextMenu();
    };
    const keyHandler = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key === 'Escape') closeVariableContextMenu();
    };
    doc.addEventListener('pointerdown', dismiss, true);
    doc.addEventListener('keydown', keyHandler, true);
    variableContextMenu = { owner: doc, menu, dismiss, keyHandler };
  }

  /** 行内改名输入框：把「输入 → 提交/取消」的按键与失焦语义收在一处。 */
  function createRowNameInput(
    value: string,
    commit: (next: string) => void,
    cancel: () => void,
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-rename-input row-name-edit';
    input.value = value;
    input.autocomplete = 'off';
    input.spellcheck = false;
    const stop = (event: Event): void => event.stopPropagation();
    input.addEventListener('click', stop);
    input.addEventListener('pointerdown', stop);
    input.addEventListener('dblclick', stop);
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(input.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    input.addEventListener('blur', () => { setTimeout(() => commit(input.value), 0); });
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return input;
  }

  function startNodeRename(nodeId: string): void {
    if (!nodeId || !nodes.some((node) => node.id === nodeId)) return;
    variableRenameDraft = undefined;
    nodeRenameDraft = nodeId;
    // render() 同时重建变量列表，顺手收掉可能遗留的变量输入框。
    render();
  }

  function startVariableRename(name: string, scope: 'inputs' | 'variables'): void {
    if (!name || !variables.some((variable) => variable.name === name && variable.scope === scope)) return;
    const hadNodeDraft = Boolean(nodeRenameDraft);
    nodeRenameDraft = '';
    variableRenameDraft = { name, scope };
    // 结构树里若还留着节点输入框，必须整棵重建才会收掉。
    if (hadNodeDraft) render();
    else renderVariables();
  }

  function cancelRename(): void {
    const hadNodeDraft = Boolean(nodeRenameDraft);
    const hadVariableDraft = Boolean(variableRenameDraft);
    if (!hadNodeDraft && !hadVariableDraft) return;
    nodeRenameDraft = '';
    variableRenameDraft = undefined;
    if (hadNodeDraft) render();
    if (hadVariableDraft) renderVariables();
  }

  /** 内联创建 Lucide SVG，供动态树行使用（data-lucide + createIcons 无法覆盖局部更新）。 */
  function createTreeIcon(icon: IconComponent, className: string): SVGSVGElement {
    return createElement(icon, { width: '14', height: '14', 'aria-hidden': 'true', class: className }) as SVGSVGElement;
  }

  function toggleTreeNode(nodeId: string, row: HTMLButtonElement, children: HTMLElement): void {
    const open = row.classList.toggle('open');
    children.classList.toggle('closed', !open);
    if (open) collapsed.delete(nodeId);
    else collapsed.add(nodeId);
    row.setAttribute('aria-expanded', String(open));
  }

  function createTreeRows(): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const childIds = new Set(nodes.flatMap((node) => node.children));
    const roots = nodes.filter((node) => !childIds.has(node.id));
    const visited = new Set<string>();

    const appendNode = (node: SidebarNode, depth: number, container: ParentNode & { append: (parent: Node) => void }): void => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      const glyph = treeNodeGlyphs[node.type] ?? treeNodeFallbackGlyph;
      const hasChildren = node.children.some((childId) => byId.has(childId));
      const branchOpen = hasChildren && !collapsed.has(node.id);

      const row = document.createElement('button');
      row.type = 'button';
      row.className = `tree-row${node.id === selectedNode ? ' selected' : ''}`;
      row.title = `${node.name}\n${node.meta}\nF2 重命名\nDelete 删除该节点`;
      row.dataset.nodeId = node.id;
      if (hasChildren) row.setAttribute('aria-expanded', String(branchOpen));

      const chevron = document.createElement('span');
      chevron.className = 'tree-chevron';
      if (hasChildren) chevron.appendChild(createTreeIcon(ChevronRight, 'chevron-closed'));

      const icon = document.createElement('span');
      icon.className = `node-type-glyph ${glyph.className}`;
      icon.appendChild(createTreeIcon(glyph.icon, 'glyph-svg'));

      const label = document.createElement('span');
      label.className = 'tree-label';

      const meta = document.createElement('span');
      meta.className = 'tree-meta';
      meta.textContent = node.meta;

      const children = document.createElement('div');
      children.className = 'tree-children';

      if (node.id === nodeRenameDraft) {
        // F2：这一行原地改名。提交改的是显示名（node.name），节点 id 保持稳定。
        row.classList.add('renaming');
        const input = createRowNameInput(node.name, (next) => {
          const value = next.trim();
          nodeRenameDraft = '';
          if (value && value !== node.name) editorCommand('renameNodeName', { nodeId: node.id, name: value });
          render();
        }, () => { nodeRenameDraft = ''; render(); });
        input.setAttribute('aria-label', '节点名称');
        label.appendChild(input);
      } else {
        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = node.name;
        label.append(name);
      }
      label.append(meta);
      row.append(chevron, icon, label);
      const count = document.createElement('span');
      count.className = 'tree-child-count';
      const childCount = node.children.filter((childId) => byId.has(childId)).length;
      count.textContent = childCount ? String(childCount) : '';
      if (childCount) count.title = `${childCount} 个直接子节点`;
      row.appendChild(count);
      row.addEventListener('click', (event) => {
        if (hasChildren && event.target instanceof Node && chevron.contains(event.target)) {
          toggleTreeNode(node.id, row, children);
          return;
        }
        showDetailsPanel();
        editorCommand('focusNode', node.id);
        // 结构树选中即等价于画布选中：Delete 交由画布执行删除；F2 在这一行原地改名。
        registerEditorDeleteTarget({ nodeId: node.id });
      });
      container.append(row, children);
      if (hasChildren) {
        if (branchOpen) row.classList.add('open');
        else children.classList.add('closed');
        for (const childId of node.children) {
          const child = byId.get(childId);
          if (child) appendNode(child, depth + 1, children);
        }
      }
    };
    for (const root of roots) appendNode(root, 0, fragment);
    for (const node of nodes) appendNode(node, 0, fragment);
    return fragment;
  }

  function collectAllBranchNodeIds(): Set<string> {
    return new Set(nodes.filter((node) => node.children.length > 0).map((node) => node.id));
  }

  function hasTreeChildren(row: HTMLButtonElement): boolean {
    return Boolean(row.nextElementSibling?.classList.contains('tree-children')
      && row.nextElementSibling.childElementCount > 0);
  }

  /** 结构树内容指纹：id、子级、名称、类型、meta 都没变时无需重建 DOM。 */
  function treeSignature(): string {
    return nodes.map((node) => `${node.id}\u0001${node.type}\u0001${node.name}\u0001${node.meta}\u0002${node.children.join('\u0003')}`).join('\u0004');
  }

  /** 仅更新结构树选中行（含祖先），不重建 DOM，保持滚动位置与展开状态。 */
  function syncTreeSelection(previousNode: string): void {
    if (previousNode === selectedNode) return;
    const view = structureView;
    if (previousNode) {
      const previousRow = view.querySelector<HTMLButtonElement>(`.tree-row[data-node-id="${CSS.escape(previousNode)}"]`);
      if (previousRow) previousRow.classList.remove('selected');
    }
    if (!selectedNode) return;
    const nextRow = view.querySelector<HTMLButtonElement>(`.tree-row[data-node-id="${CSS.escape(selectedNode)}"]`);
    if (!nextRow) return;
    nextRow.classList.add('selected');
    // 保证选中的行自身可见：仅展开其祖先链，不动其他手动折叠的分支。
    for (let parent = nextRow.parentElement; parent && parent !== view; parent = parent.parentElement) {
      if (parent.classList.contains('tree-children') && parent.classList.contains('closed')) {
        parent.classList.remove('closed');
        const branchRow = parent.previousElementSibling as HTMLElement | null;
        branchRow?.classList.add('open');
        if (branchRow?.dataset.nodeId) collapsed.delete(branchRow.dataset.nodeId);
      }
    }
    const rowRect = nextRow.getBoundingClientRect();
    const viewRect = view.getBoundingClientRect();
    if (rowRect.bottom < viewRect.top || rowRect.top > viewRect.bottom) {
      nextRow.scrollIntoView({ block: 'nearest' });
    }
  }

  /** 仅更新变量列表选中行，避免整体重建导致滚动跳动。 */
  function syncVariableSelection(previousVariable: string, previousScope: 'inputs' | 'variables'): void {
    if (previousVariable === selectedVariable && previousScope === selectedVariableScope) return;
    const previousRow = variablesView.querySelector<HTMLButtonElement>(`.variable-row[data-variable-scope="${previousScope}"][data-variable-name="${CSS.escape(previousVariable)}"]`);
    if (previousRow) { previousRow.classList.remove('selected'); previousRow.setAttribute('aria-pressed', 'false'); }
    const nextRow = variablesView.querySelector<HTMLButtonElement>(`.variable-row[data-variable-scope="${selectedVariableScope}"][data-variable-name="${CSS.escape(selectedVariable)}"]`);
    nextRow?.classList.add('selected');
    nextRow?.setAttribute('aria-pressed', 'true');
  }

  /** 输入与状态列表内容指纹。 */
  function variableSignature(): string {
    return variables.map((variable) => `${variable.scope}\u0001${variable.name}\u0001${variable.type}\u0001${variable.displayName || ''}\u0001${variable.group || ''}\u0001${variable.public ? '1' : '0'}\u0001${variable.onCard ? '1' : '0'}`).join('\u0004');
  }

  function renderVariables(): void {
    closeVariableContextMenu();
    const keepScroll = variablesView.scrollTop;
    const groupView = variablesView as HTMLElement & { collapsedGroups?: Set<string> };
    const collapsedGroups = groupView.collapsedGroups ||= new Set<string>();
    variablesView.replaceChildren();
    if (variables.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'variable-group-empty';
      empty.textContent = '暂无变量 · 点击上方「＋ 变量」添加';
      variablesView.appendChild(empty);
    }
    const groups = new Map<string, SidebarVariable[]>();
    for (const variable of variables) {
      const group = variable.group || '';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(variable);
    }
    for (const [group, members] of groups) {
      if (group || groups.size > 1) {
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.className = 'variable-category-toggle';
        toggle.textContent = `${collapsedGroups.has(group) ? '▸' : '▾'} ${group || '未分组'} · ${members.length}`;
        toggle.setAttribute('aria-expanded', String(!collapsedGroups.has(group)));
        toggle.addEventListener('click', () => {
          if (collapsedGroups.has(group)) collapsedGroups.delete(group); else collapsedGroups.add(group);
          renderVariables();
        });
        variablesView.appendChild(toggle);
      }
      for (const variable of members) {
        const scope = variable.scope;
        const row = document.createElement('button');
        row.type = 'button';
        row.hidden = collapsedGroups.has(group);
        row.className = `variable-row scope-${scope}${variable.name === selectedVariable && scope === selectedVariableScope ? ' selected' : ''}`;
        row.setAttribute('aria-pressed', String(variable.name === selectedVariable && scope === selectedVariableScope));
        // 名称、类型、公开状态、「已连接」与引用处数都已行内可见，悬浮提示只保留隐藏操作。
        row.title = `拖到画布创建引用卡片\nF2 重命名\nDelete 删除${variable.refCount ? `\n当前被引用 ${variable.refCount} 处` : ''}`;
        row.dataset.variableName = variable.name;
        row.dataset.variableScope = scope;
        row.innerHTML = '<span class="variable-icon"></span><span class="variable-name"></span><span class="variable-flags"></span><span class="variable-ref-count"></span>';
        const variableGlyph = variableTypeGlyphs[variable.type.toLowerCase()] ?? variableTypeFallbackGlyph;
        const icon = row.querySelector<HTMLElement>('.variable-icon')!;
        icon.classList.add(variableGlyph.className);
        icon.appendChild(createTreeIcon(variableGlyph.icon, 'variable-icon-svg'));
        const nameNode = row.querySelector<HTMLElement>('.variable-name')!;
        const renaming = variableRenameDraft !== undefined
          && variableRenameDraft.name === variable.name
          && variableRenameDraft.scope === scope;
        if (renaming) {
          // F2：这一行原地改名。提交走详情栏同一个改名实现（公开镜像输入一起同步）。
          row.classList.add('renaming');
          const input = createRowNameInput(variable.displayName || variable.name, (next) => {
            const value = next.trim();
            variableRenameDraft = undefined;
            if (value) editorCommand('renameVariable', { scope, oldName: variable.name, name: value });
            renderVariables();
          }, () => { variableRenameDraft = undefined; renderVariables(); });
          input.setAttribute('aria-label', '变量名称');
          nameNode.replaceWith(input);
        } else {
          nameNode.textContent = variable.displayName || overviewInputDisplayName(variable.name);
          // 名称可能因侧栏宽度被截断，只在名称本身上提供完整内容。
          nameNode.title = nameNode.textContent;
          if (variable.onCard) {
            // 变量已经连在某个节点卡片端口上：在名字后标出“已连接”，避免看起来像是没用上。
            const onCard = document.createElement('span');
            onCard.className = 'variable-on-card';
            onCard.textContent = '已连接';
            onCard.title = '画布上的节点端口已经引用该变量';
            nameNode.appendChild(onCard);
          }
        }
        const flags = row.querySelector<HTMLElement>('.variable-flags')!;
        flags.textContent = variableTypeLabels[variable.type.toLowerCase()] ?? variable.type;
        flags.title = variable.type;
        // 引用处数徽标：有引用才显示，0 处时留空让行布局稳定。
        const refCount = row.querySelector<HTMLElement>('.variable-ref-count')!;
        const count = Number(variable.refCount) || 0;
        if (count > 0) {
          refCount.textContent = `${count} 引用`;
          refCount.title = `变量被 ${count} 处引用，点击行右键可查看详情`;
        }
        const eye = document.createElement('span');
        eye.className = `variable-eye${variable.public ? '' : ' off'}`;
        eye.setAttribute('role', 'button');
        eye.setAttribute('tabindex', '0');
        eye.setAttribute('aria-pressed', String(variable.public));
        eye.appendChild(createTreeIcon(variable.public ? Eye : EyeOff, 'variable-eye-svg'));
        eye.classList.add('toggle');
        eye.title = variable.public ? '取消公开，仅在流程内部使用' : '公开，允许父流程传值';
        eye.setAttribute('aria-label', eye.title);
        const togglePublic = () => editorCommand('setVariablePublic', { name: variable.name, scope, public: !variable.public });
        eye.addEventListener('click', (event) => { event.stopPropagation(); togglePublic(); });
        eye.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault(); event.stopPropagation(); togglePublic();
        });
        eye.addEventListener('mousedown', (event) => event.stopPropagation());
        row.appendChild(eye);
        row.draggable = true;
        row.addEventListener('dragstart', (event) => {
          const transfer = event.dataTransfer;
          if (!transfer) return;
          transfer.setData('application/x-onmyoji-variable', JSON.stringify({ name: variable.name, scope }));
          transfer.effectAllowed = 'copy';
        });
        row.addEventListener('click', () => {
          showDetailsPanel();
          editorCommand('selectVariable', { name: variable.name, scope });
          // 变量行选中即等价于画布选中该变量：Delete 交由画布执行删除；F2 在这一行原地改名。
          registerEditorDeleteTarget({ variable: { name: variable.name, scope } });
        });
        row.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          // 右键目标同步为当前变量，但不强制切换详情面板。
          editorCommand('selectVariable', { name: variable.name, scope });
          registerEditorDeleteTarget({ variable: { name: variable.name, scope } });
          showVariableContextMenu(event, variable, row);
        });
        variablesView.appendChild(row);
      }
    }
    variablesView.scrollTop = keepScroll;
  }

  function render(): void {
    const keepScroll = structureView.scrollTop;
    structureView.replaceChildren();
    if (nodes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-panel';
      empty.textContent = '打开工作流后显示节点结构';
      structureView.appendChild(empty);
    } else {
      structureView.appendChild(createTreeRows());
    }
    structureView.scrollTop = keepScroll;
    renderVariables();
    createIcons({ icons, root: structureView });
  }

  return {
    snapshot: () => ({ nodes, variables, selectedNode, selectedVariable, selectedVariableScope, collapsed }),
    apply(snapshot) {
      nodes = snapshot.nodes;
      variables = snapshot.variables;
      selectedNode = snapshot.selectedNode;
      selectedVariable = snapshot.selectedVariable;
      selectedVariableScope = snapshot.selectedVariableScope;
      collapsed = snapshot.collapsed;
    },
    resetViews() {
      nodes = [];
      variables = [];
      selectedNode = '';
      selectedVariable = '';
      selectedVariableScope = 'inputs';
    },
    resetCollapsed() {
      collapsed = new Set();
    },
    render,
    updateFromMessage(message) {
      const previousTreeSignature = treeSignature();
      const previousVariableSignature = variableSignature();
      const previousSelectedNode = selectedNode;
      const previousSelectedVariable = selectedVariable;
      const previousSelectedVariableScope = selectedVariableScope;
      variables = Array.isArray(message.variables) ? message.variables as SidebarVariable[] : [];
      nodes = Array.isArray(message.nodes) ? message.nodes as SidebarNode[] : [];
      selectedVariable = typeof message.selectedVariable === 'string' ? message.selectedVariable : '';
      selectedVariableScope = message.selectedVariableScope === 'variables' ? 'variables' : 'inputs';
      selectedNode = typeof message.selectedNode === 'string' ? message.selectedNode : '';
      const treeUnchanged = nodes.length > 0 && treeSignature() === previousTreeSignature;
      const variablesUnchanged = variableSignature() === previousVariableSignature;
      if (treeUnchanged && variablesUnchanged) {
        // 结构与变量都没变（如仅在画布上切换选中节点）：只更新选中行，不重建树，
        // 展开状态、折叠状态与滚动位置都原样保留。
        syncTreeSelection(previousSelectedNode);
        syncVariableSelection(previousSelectedVariable, previousSelectedVariableScope);
      } else if (treeUnchanged) {
        // 结构没变但变量列表变了：仅重建变量列表。
        renderVariables();
      } else {
        render();
      }
    },
    setAllBranches(open) {
      collapsed = open ? new Set() : new Set(collectAllBranchNodeIds());
      structureView.querySelectorAll<HTMLButtonElement>('.tree-row').forEach((row) => {
        if (!hasTreeChildren(row)) return;
        row.classList.toggle('open', open);
        row.setAttribute('aria-expanded', String(open));
      });
      structureView.querySelectorAll<HTMLElement>('.tree-children').forEach((children) => {
        children.classList.toggle('closed', !open);
      });
    },
    startNodeRename,
    startVariableRename,
    isRenaming: () => Boolean(nodeRenameDraft || variableRenameDraft),
    cancelRename,
  };
}
