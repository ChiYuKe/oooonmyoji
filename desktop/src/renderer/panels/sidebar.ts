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
  /** 选中结构树/变量行后登记删除目标，让 Delete 交给画布执行。 */
  registerEditorDeleteTarget: () => void;
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
      row.title = `${node.name}\n${node.meta}\nDelete 删除该节点`;
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

      const name = document.createElement('span');
      name.className = 'tree-name';
      name.textContent = node.name;

      const meta = document.createElement('span');
      meta.className = 'tree-meta';
      meta.textContent = node.meta;

      const children = document.createElement('div');
      children.className = 'tree-children';

      label.append(name, meta);
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
        // 结构树选中即等价于画布选中：Delete 交由画布执行删除。
        registerEditorDeleteTarget();
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
        row.title = `${variable.displayName || overviewInputDisplayName(variable.name)} (${variable.name})\n类型：${variable.type}\n${variable.public ? '公开：引用此流程的节点可见' : '私有：仅流程内部使用'}${variable.onCard ? '\n已连接：画布上已有端口引用它' : ''}\n拖到画布可创建引用卡片\nDelete 删除该变量`;
        row.dataset.variableName = variable.name;
        row.dataset.variableScope = scope;
        row.innerHTML = '<span class="variable-icon"></span><span class="variable-name"></span><span class="variable-flags"></span>';
        const variableGlyph = variableTypeGlyphs[variable.type.toLowerCase()] ?? variableTypeFallbackGlyph;
        const icon = row.querySelector<HTMLElement>('.variable-icon')!;
        icon.classList.add(variableGlyph.className);
        icon.appendChild(createTreeIcon(variableGlyph.icon, 'variable-icon-svg'));
        const nameNode = row.querySelector<HTMLElement>('.variable-name')!;
        nameNode.textContent = variable.displayName || overviewInputDisplayName(variable.name);
        if (variable.onCard) {
          // 变量已经连在某个节点卡片端口上：在名字后标出“已连接”，避免看起来像是没用上。
          const onCard = document.createElement('span');
          onCard.className = 'variable-on-card';
          onCard.textContent = '已连接';
          onCard.title = '画布上的节点端口已经引用该变量';
          nameNode.appendChild(onCard);
        }
        const flags = row.querySelector<HTMLElement>('.variable-flags')!;
        flags.textContent = variableTypeLabels[variable.type.toLowerCase()] ?? variable.type;
        flags.title = variable.type;
        const eye = document.createElement('span');
        eye.className = `variable-eye${variable.public ? '' : ' off'}`;
        eye.setAttribute('aria-hidden', 'true');
        eye.appendChild(createTreeIcon(variable.public ? Eye : EyeOff, 'variable-eye-svg'));
        if (scope === 'variables') {
          eye.classList.add('toggle');
          eye.title = variable.public
            ? '公开：父流程可设置它的初始值（点击取消公开）'
            : '私有：仅流程内部使用（点击公开并生成初始值输入）';
          eye.addEventListener('click', (event) => {
            event.stopPropagation();
            editorCommand('setVariablePublic', { name: variable.name, scope, public: !variable.public });
          });
        } else {
          eye.classList.add('fixed');
          eye.title = '工作流输入默认公开，父流程可直接传值';
        }
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
          // 变量行选中即等价于画布选中该变量：Delete 交由画布执行删除。
          registerEditorDeleteTarget();
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
  };
}
