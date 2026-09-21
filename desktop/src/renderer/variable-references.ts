/**
 * 变量引用面板：列出「谁在引用这个变量」，并提供直接删除变量的出口。
 *
 * 变量一旦被引用就不能直接删除，但只说一句「不能删除」并不告诉用户引用在哪、
 * 更没法快速过去处理。这个面板把引用**按节点分组**列成可点击的清单：
 * 组头给出节点序号、名称与动作（序号与「结构」面板的顺序一致，便于在画布上定位），
 * 行里给出参数名与引用原文，点一行就跳到那张卡片。
 * 引用一多，顶部的搜索与类型筛选（画布连线 / 参数引用 / 初始化输入）负责收窄范围，
 * 方向键在行之间移动、回车跳到第一条，Esc 关闭。
 *
 * 面板本身不读写工作流：数据由详细信息面板（引用与参数的唯一持有者）随消息送来，
 * 面板只渲染并把用户的选择发回去；「刷新」只是请来源画布重新算一遍清单再送回来。
 */
import {
  ArrowRight,
  Columns3,
  Crosshair,
  Link2,
  RefreshCw,
  Search,
  SearchX,
  Trash2,
  Variable,
  X,
  createElement,
} from 'lucide';
import { parameterTypeLabel } from '../shared/parameter-types';
import type { SharedPanelDockBridge } from './docking';

/** 一条引用：来自参数里的 `{ref}`，或变量的「初始化输入」绑定。 */
export interface VariableReferenceEntry {
  /** 引用所在节点；初始化输入这类没有节点。 */
  nodeId?: string;
  nodeName?: string;
  /** 节点动作的显示名（例如「点击匹配项」），复合节点没有动作时为空。 */
  nodeAction?: string;
  /** 节点在工作流 `nodes` 里的序号（1 起）：面板按它分组排序，和结构树顺序一致。 */
  nodeIndex?: number;
  /** 引用所在节点的父节点名，用来提示这条引用藏在哪个分支里。 */
  parentName?: string;
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
  /** 引用所在参数被暴露到了节点组的组接口（组卡/接口卡上有对应端点）。 */
  groupInterface?: boolean;
}

export interface VariableReferencesData {
  scope: 'inputs' | 'variables';
  name: string;
  displayName: string;
  /** 变量类型（`number` / `string` …）；空表示不显示类型标签。 */
  type?: string;
  /** 变量默认值的紧凑写法：删除后这些引用会回落成它。 */
  defaultText?: string;
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
  focusNode: (source: VariableReferencesSource, nodeId: string, param?: string) => void;
  /** 选中该变量（初始化输入这类没有节点可跳时用）。 */
  selectVariable: (source: VariableReferencesSource, scope: string, name: string) => void;
  /** 直接删除变量：引用一并清理，参数回落到动作默认值。 */
  deleteVariable: (source: VariableReferencesSource, scope: string, name: string) => void;
  /** 断开单条引用：画布按一次历史记录，Ctrl+Z 可撤销。 */
  disconnectReference: (source: VariableReferencesSource, entry: VariableReferenceEntry) => void;
  /** 批量断开全部引用：画布合并为一次历史记录，Ctrl+Z 可整体撤销。 */
  disconnectAllReferences: (source: VariableReferencesSource, scope: string, name: string) => void;
  showToast: (message: string, error?: boolean) => void;
}

export interface VariableReferences {
  open(data: VariableReferencesData, source: VariableReferencesSource): void;
  close(): void;
  /** 面板是否打开。 */
  isOpen(): boolean;
}

/** 引用类型：画布连线 / 组接口 / 普通参数引用 / 变量的初始化输入。 */
type ReferenceKind = 'linked' | 'group' | 'param' | 'initializer';

const KIND_LABELS: Record<ReferenceKind, string> = {
  linked: '画布连线',
  group: '组接口',
  param: '参数引用',
  initializer: '初始化输入',
};

/** 筛选按钮的顺序：全部 → 各引用类型（计数为 0 的会被禁用，避免点进空列表）。 */
const KIND_FILTERS: Array<{ key: '' | ReferenceKind; label: string }> = [
  { key: '', label: '全部' },
  { key: 'linked', label: KIND_LABELS.linked },
  { key: 'group', label: KIND_LABELS.group },
  { key: 'param', label: KIND_LABELS.param },
  { key: 'initializer', label: KIND_LABELS.initializer },
];

function referenceKind(entry: VariableReferenceEntry): ReferenceKind {
  if (entry.initializer) return 'initializer';
  if (entry.groupInterface) return 'group';
  return entry.linked ? 'linked' : 'param';
}

/** 一个节点（或「初始化输入」）下的所有引用。 */
interface ReferenceGroup {
  initializer: boolean;
  title: string;
  action: string;
  parent: string;
  order: number;
  entries: VariableReferenceEntry[];
}

export function createVariableReferences(deps: VariableReferencesDeps): VariableReferences {
  const { getSharedPanels, focusNode, selectVariable, deleteVariable, showToast } = deps;

  let panel: HTMLElement | undefined;
  let bodyEl: HTMLElement | undefined;
  let hintEl: HTMLElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let data: VariableReferencesData | undefined;
  let source: VariableReferencesSource | undefined;
  let keyHandler: ((event: KeyboardEvent) => void) | undefined;
  /** 搜索词与类型筛选：面板内部状态，同一变量刷新清单时保留。 */
  let query = '';
  let kind: '' | ReferenceKind = '';
  /** 当前渲染出来的行：方向键在它们之间移动焦点，回车等同点击。 */
  let rows: Array<{ button: HTMLButtonElement; entry: VariableReferenceEntry }> = [];
  /** 筛选按钮：搜索时计数要跟着变，所以留下引用就地更新，不重建工具栏。 */
  let chips = new Map<string, { button: HTMLButtonElement; count: HTMLElement }>();

  function isOpen(): boolean {
    return Boolean(getSharedPanels()?.surface('variableReferences'));
  }

  function close(): void {
    if (panel && keyHandler) panel.removeEventListener('keydown', keyHandler, true);
    getSharedPanels()?.close('variableReferences');
    panel?.remove();
    panel = undefined;
    bodyEl = undefined;
    hintEl = undefined;
    searchInput = undefined;
    data = undefined;
    source = undefined;
    keyHandler = undefined;
    rows = [];
    chips = new Map();
  }

  function entryTitle(entry: VariableReferenceEntry): string {
    if (entry.initializer) return entry.label || '变量的初始化输入';
    const where = entry.nodeName ? `节点「${entry.nodeName}」` : '节点';
    const target = entry.label || (entry.param ? `参数「${entry.param}」` : '参数');
    return `${where} · ${target}`;
  }

  function entryHaystack(entry: VariableReferenceEntry): string {
    return [entry.nodeName, entry.nodeAction, entry.parentName, entry.param, entry.label, entry.ref]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLocaleLowerCase();
  }

  function matchesQuery(entry: VariableReferenceEntry, needle: string): boolean {
    return !needle || entryHaystack(entry).includes(needle);
  }

  function visibleEntries(target: VariableReferencesData): VariableReferenceEntry[] {
    const needle = query.trim().toLocaleLowerCase();
    return target.entries.filter((entry) => (kind ? referenceKind(entry) === kind : true) && matchesQuery(entry, needle));
  }

  /** 按节点分组：同一个节点的多处引用只占一个组头，跳一次就够。 */
  function buildGroups(entries: VariableReferenceEntry[]): ReferenceGroup[] {
    const groups = new Map<string, ReferenceGroup>();
    for (const entry of entries) {
      const key = entry.nodeId ? `node:${entry.nodeId}` : 'initializer';
      let group = groups.get(key);
      if (!group) {
        group = {
          initializer: !entry.nodeId,
          title: entry.nodeId ? entry.nodeName || entry.nodeId : '初始化输入',
          action: entry.nodeAction || '',
          parent: entry.parentName || '',
          order: typeof entry.nodeIndex === 'number' && entry.nodeIndex > 0 ? entry.nodeIndex : Number.MAX_SAFE_INTEGER,
          entries: [],
        };
        groups.set(key, group);
      }
      group.entries.push(entry);
    }
    // 按工作流里的节点顺序排（序号来自 `nodes` 数组），初始化输入永远垫底。
    return [...groups.values()].sort((left, right) => {
      if (left.initializer !== right.initializer) return left.initializer ? 1 : -1;
      return left.order - right.order;
    });
  }

  function activate(entry: VariableReferenceEntry): void {
    const target = data;
    const origin = source;
    if (!target || !origin) return;
    if (entry.nodeId) focusNode(origin, entry.nodeId, entry.param);
    else selectVariable(origin, target.scope, target.name);
  }

  /** 刷新：请来源画布重新算一遍引用清单（它算完会再送回来）。 */
  function refreshReferences(): void {
    const target = data;
    const origin = source;
    if (!target || !origin) return;
    origin.post('showVariableReferences', { scope: target.scope, name: target.name });
  }

  function buildHeader(doc: Document, target: VariableReferencesData): HTMLElement {
    const header = doc.createElement('div');
    header.className = 'variable-references-header';

    const icon = doc.createElement('span');
    icon.className = 'variable-references-icon';
    icon.appendChild(createElement(Variable, { width: '15', height: '15', 'aria-hidden': 'true' }));

    const heading = doc.createElement('div');
    heading.className = 'variable-references-heading';
    const titleRow = doc.createElement('div');
    titleRow.className = 'variable-references-title';
    const title = doc.createElement('strong');
    title.textContent = target.displayName || target.name;
    title.title = target.name;
    titleRow.appendChild(title);
    const scopeChip = doc.createElement('span');
    scopeChip.className = 'variable-references-chip';
    scopeChip.textContent = target.scope === 'inputs' ? '输入' : '运行变量';
    titleRow.appendChild(scopeChip);
    if (target.type) {
      const typeChip = doc.createElement('span');
      typeChip.className = 'variable-references-chip type';
      typeChip.textContent = parameterTypeLabel(target.type);
      titleRow.appendChild(typeChip);
    }
    const meta = doc.createElement('small');
    const nodeCount = new Set(target.entries.filter((entry) => entry.nodeId).map((entry) => entry.nodeId)).size;
    meta.textContent = nodeCount
      ? `${target.entries.length} 处引用 · ${nodeCount} 个节点`
      : `${target.entries.length} 处引用`;
    heading.append(titleRow, meta);

    const actions = doc.createElement('div');
    actions.className = 'variable-references-actions';
    const refresh = doc.createElement('button');
    refresh.type = 'button';
    refresh.className = 'panel-action';
    refresh.title = '重新读取引用清单';
    refresh.setAttribute('aria-label', '刷新引用');
    refresh.appendChild(createElement(RefreshCw, { width: '14', height: '14', 'aria-hidden': 'true' }));
    refresh.addEventListener('click', refreshReferences);
    const closeButton = doc.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'panel-action';
    closeButton.title = '关闭 (Esc)';
    closeButton.setAttribute('aria-label', '关闭');
    closeButton.appendChild(createElement(X, { width: '14', height: '14', 'aria-hidden': 'true' }));
    closeButton.addEventListener('click', close);
    actions.append(refresh, closeButton);
    header.append(icon, heading, actions);
    return header;
  }

  function buildToolbar(doc: Document): HTMLElement {
    const toolbar = doc.createElement('div');
    toolbar.className = 'variable-references-toolbar';

    const search = doc.createElement('label');
    search.className = 'variable-references-search';
    search.appendChild(createElement(Search, { width: '13', height: '13', 'aria-hidden': 'true' }));
    const input = doc.createElement('input');
    input.type = 'search';
    input.className = 'variable-references-search-input';
    input.placeholder = '筛选节点、参数或引用';
    input.title = '输入关键词收窄清单，回车跳到第一条';
    input.setAttribute('aria-label', '筛选引用');
    input.value = query;
    input.addEventListener('input', () => {
      query = input.value;
      renderList();
    });
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const first = rows[0];
      if (!first) return;
      first.button.focus();
      activate(first.entry);
    });
    search.appendChild(input);
    searchInput = input;
    toolbar.appendChild(search);

    const filters = doc.createElement('div');
    filters.className = 'variable-references-filters';
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', '按引用类型筛选');
    for (const option of KIND_FILTERS) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'variable-references-filter';
      const label = doc.createElement('span');
      label.className = 'variable-references-filter-label';
      label.textContent = option.label;
      const count = doc.createElement('span');
      count.className = 'variable-references-filter-count';
      button.append(label, count);
      button.addEventListener('click', () => {
        kind = option.key;
        renderList();
      });
      chips.set(option.key, { button, count });
      filters.appendChild(button);
    }
    toolbar.appendChild(filters);
    return toolbar;
  }

  function buildRow(doc: Document, entry: VariableReferenceEntry): HTMLElement {
    const entryKind = referenceKind(entry);
    const wrap = doc.createElement('div');
    wrap.className = `variable-reference-row-wrap ${entryKind}`;

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'variable-reference-row';
    const jumpHint = entry.nodeId ? '点击定位到这张卡片' : '点击选中这个变量';
    button.title = `${entryTitle(entry)}${entry.ref ? `\n${entry.ref}` : ''}\n${jumpHint}`;

    const icon = doc.createElement('span');
    icon.className = 'variable-reference-icon';
    icon.appendChild(createElement(entryKind === 'initializer' ? Variable : entryKind === 'linked' ? Link2 : entryKind === 'group' ? Columns3 : ArrowRight, {
      width: '14', height: '14', 'aria-hidden': 'true',
    }));

    const text = doc.createElement('span');
    text.className = 'variable-reference-text';
    const name = doc.createElement('strong');
    name.textContent = entry.label || entry.param || '参数引用';
    name.title = name.textContent;
    text.appendChild(name);
    if (entry.ref) {
      const ref = doc.createElement('code');
      ref.className = 'variable-reference-ref';
      ref.textContent = entry.ref;
      ref.title = entry.ref;
      text.appendChild(ref);
    }

    const badge = doc.createElement('span');
    badge.className = `variable-reference-badge ${entryKind}`;
    badge.textContent = KIND_LABELS[entryKind];

    const jump = doc.createElement('span');
    jump.className = 'variable-reference-jump';
    jump.appendChild(createElement(Crosshair, { width: '12', height: '12', 'aria-hidden': 'true' }));
    const jumpLabel = doc.createElement('span');
    jumpLabel.textContent = entry.nodeId ? '定位' : '选中';
    jump.appendChild(jumpLabel);

    button.append(icon, text, badge, jump);
    button.addEventListener('click', () => activate(entry));
    wrap.appendChild(button);
    rows.push({ button, entry });

    // 断开：把这条引用解除（参数回落到字面量/初始化解除），画布按一次历史记录，可撤销。
    const unlink = doc.createElement('button');
    unlink.type = 'button';
    unlink.className = 'variable-reference-unlink';
    unlink.title = entry.initializer
      ? '解除这个初始化绑定'
      : `断开参数「${entry.param || entry.label || ''}」上的这条引用`;
    unlink.setAttribute('aria-label', unlink.title);
    unlink.appendChild(createElement(Link2, { width: '12', height: '12', 'aria-hidden': 'true' }));
    unlink.addEventListener('click', () => {
      const origin = source;
      const target = data;
      if (!origin || !target) return;
      deps.disconnectReference(origin, entry);
      showToast(`已断开 ${entry.nodeId ? `节点「${entry.nodeName || entry.nodeId}」` : '初始化'}上的引用`);
      refreshReferences();
    });
    wrap.appendChild(unlink);
    return wrap;
  }

  function buildGroup(doc: Document, group: ReferenceGroup): HTMLElement {
    const section = doc.createElement('section');
    section.className = `variable-reference-group${group.initializer ? ' initializer' : ''}`;

    const head = doc.createElement('div');
    head.className = 'variable-reference-group-head';
    const order = doc.createElement('span');
    order.className = 'variable-reference-group-order';
    order.textContent = group.order === Number.MAX_SAFE_INTEGER ? '—' : `#${group.order}`;
    order.title = group.order === Number.MAX_SAFE_INTEGER ? '位置未知' : `工作流里的第 ${group.order} 个节点`;
    const name = doc.createElement('strong');
    name.className = 'variable-reference-group-name';
    name.textContent = group.title;
    name.title = group.title;
    head.append(order, name);
    if (group.action) {
      const action = doc.createElement('span');
      action.className = 'variable-reference-group-action';
      action.textContent = group.action;
      head.appendChild(action);
    }
    if (group.parent) {
      const parent = doc.createElement('span');
      parent.className = 'variable-reference-group-parent';
      parent.textContent = `在「${group.parent}」内`;
      parent.title = `这个节点挂在「${group.parent}」下面`;
      head.appendChild(parent);
    }
    const count = doc.createElement('span');
    count.className = 'variable-reference-group-count';
    count.textContent = `${group.entries.length} 处`;
    head.appendChild(count);
    section.appendChild(head);

    const list = doc.createElement('ul');
    list.className = 'variable-reference-group-list';
    for (const entry of group.entries) {
      const item = doc.createElement('li');
      item.appendChild(buildRow(doc, entry));
      list.appendChild(item);
    }
    section.appendChild(list);
    return section;
  }

  function buildEmptyState(doc: Document, filtered: boolean): HTMLElement {
    const empty = doc.createElement('div');
    empty.className = `variable-references-empty${filtered ? ' filtered' : ''}`;
    const icon = doc.createElement('span');
    icon.className = 'variable-references-empty-icon';
    icon.appendChild(createElement(filtered ? SearchX : Variable, { width: '20', height: '20', 'aria-hidden': 'true' }));
    const title = doc.createElement('strong');
    const note = doc.createElement('span');
    note.className = 'variable-references-empty-note';
    if (filtered) {
      title.textContent = '没有匹配的引用';
      note.textContent = '换个关键词，或清掉类型筛选。';
    } else {
      title.textContent = '当前没有其他位置引用这个变量';
      note.textContent = '可以直接删除变量。';
    }
    empty.append(icon, title, note);
    if (filtered) {
      const reset = doc.createElement('button');
      reset.type = 'button';
      reset.className = 'variable-references-reset';
      reset.textContent = '清除筛选';
      reset.addEventListener('click', () => {
        query = '';
        kind = '';
        if (searchInput) searchInput.value = '';
        renderList();
      });
      empty.appendChild(reset);
    }
    return empty;
  }

  function buildFooter(doc: Document, target: VariableReferencesData): HTMLElement {
    const footer = doc.createElement('div');
    footer.className = 'variable-references-footer';
    hintEl = doc.createElement('span');
    hintEl.className = 'variable-references-hint';
    const batch = doc.createElement('button');
    batch.type = 'button';
    batch.className = 'panel-action';
    batch.appendChild(createElement(Link2, { width: '13', height: '13', 'aria-hidden': 'true' }));
    const batchLabel = doc.createElement('span');
    batchLabel.textContent = `断开全部引用（${target.entries.length} 处）`;
    batch.appendChild(batchLabel);
    batch.title = '一次性解除所有引用并让参数回落默认值；合并为一次历史记录，Ctrl+Z 可整体撤销';
    batch.disabled = target.entries.length === 0;
    batch.addEventListener('click', () => {
      const current = data;
      const origin = source;
      if (!current || !origin) return;
      deps.disconnectAllReferences(origin, current.scope, current.name);
      showToast(`已断开 ${current.entries.length} 处引用（可撤销）`);
      refreshReferences();
    });
    const remove = doc.createElement('button');
    remove.type = 'button';
    remove.className = 'panel-action danger';
    remove.appendChild(createElement(Trash2, { width: '13', height: '13', 'aria-hidden': 'true' }));
    const removeLabel = doc.createElement('span');
    removeLabel.textContent = '直接删除变量';
    remove.appendChild(removeLabel);
    remove.title = target.defaultText
      ? `删除变量，并让这些引用清空、参数回落到动作默认值（当前默认值 ${target.defaultText}）`
      : '删除变量，并让这些引用清空、参数回落到动作默认值';
    remove.addEventListener('click', () => {
      const current = data;
      const origin = source;
      if (!current || !origin) return;
      deleteVariable(origin, current.scope, current.name);
      showToast(`已删除变量 ${current.displayName || current.name}，${current.entries.length} 处引用已回落到默认值`);
      close();
    });
    footer.append(hintEl, batch, remove);
    return footer;
  }

  function updateChips(target: VariableReferencesData): void {
    const needle = query.trim().toLocaleLowerCase();
    const counts: Record<ReferenceKind, number> = { linked: 0, group: 0, param: 0, initializer: 0 };
    let total = 0;
    for (const entry of target.entries) {
      if (!matchesQuery(entry, needle)) continue;
      counts[referenceKind(entry)] += 1;
      total += 1;
    }
    for (const [key, chip] of chips) {
      const count = key === '' ? total : counts[key as ReferenceKind];
      chip.count.textContent = String(count);
      const active = kind === key;
      chip.button.className = `variable-references-filter${active ? ' active' : ''}${count ? '' : ' empty'}`;
      chip.button.disabled = count === 0 && !active;
      chip.button.setAttribute('aria-pressed', String(active));
    }
  }

  function updateHint(target: VariableReferencesData, visible: number, filtering: boolean): void {
    if (!hintEl) return;
    if (!target.entries.length) hintEl.textContent = '没有引用，可以直接删除变量。';
    else if (filtering) hintEl.textContent = `筛出 ${visible} / ${target.entries.length} 处引用。`;
    else hintEl.textContent = '点「定位」跳过去看现场，或「断开」解除单条引用；底部可批量断开。';
  }

  /** 只重建清单：搜索框保持原节点，输入焦点与光标不会随每次按键丢失。 */
  function renderList(): void {
    const target = data;
    const body = bodyEl;
    if (!target || !body) return;
    const doc = document;
    const visible = visibleEntries(target);
    const filtering = Boolean(query.trim()) || Boolean(kind);
    rows = [];
    body.replaceChildren();
    updateChips(target);
    updateHint(target, visible.length, filtering);
    if (!target.entries.length) {
      body.appendChild(buildEmptyState(doc, false));
      return;
    }
    if (!visible.length) {
      body.appendChild(buildEmptyState(doc, true));
      return;
    }
    for (const group of buildGroups(visible)) body.appendChild(buildGroup(doc, group));
  }

  function moveRowFocus(step: number, from: EventTarget | null): void {
    if (!rows.length) return;
    const current = rows.findIndex((row) => row.button === from);
    const next = current < 0
      ? (step > 0 ? 0 : rows.length - 1)
      : (current + step + rows.length) % rows.length;
    rows[next].button.focus();
  }

  function render(): void {
    const host = document.querySelector<HTMLElement>('#module-variable-references');
    const target = data;
    if (!host || !target) return;
    const doc = document;
    rows = [];
    chips = new Map();
    searchInput = undefined;

    const root = doc.createElement('div');
    root.className = 'variable-references';
    root.tabIndex = -1;
    root.appendChild(buildHeader(doc, target));
    if (target.entries.length) root.appendChild(buildToolbar(doc));
    bodyEl = doc.createElement('div');
    bodyEl.className = 'variable-references-body';
    root.appendChild(bodyEl);
    root.appendChild(buildFooter(doc, target));

    host.replaceChildren(root);
    panel = root;
    keyHandler = (event: KeyboardEvent): void => {
      const eventTarget = event.target as HTMLElement | null;
      const inSearch = eventTarget?.tagName === 'INPUT';
      if (event.key === 'Escape') {
        // 搜索框里先清筛选，再按一次才关面板。
        event.preventDefault();
        event.stopPropagation();
        if (inSearch && query) {
          query = '';
          if (searchInput) searchInput.value = '';
          renderList();
          return;
        }
        close();
        return;
      }
      if (event.key === '/' && !inSearch) {
        event.preventDefault();
        searchInput?.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!rows.length) return;
        event.preventDefault();
        moveRowFocus(event.key === 'ArrowDown' ? 1 : -1, event.target);
      }
    };
    root.addEventListener('keydown', keyHandler, true);
    renderList();
    // 打开就把焦点交给搜索框：可以直接打字收窄范围，Esc 由根节点捕获、照样有效。
    const initialSearch = root.querySelector<HTMLInputElement>('.variable-references-search-input');
    if (initialSearch) initialSearch.focus();
    else root.focus();
  }

  function open(next: VariableReferencesData, origin: VariableReferencesSource): void {
    // 换了变量就清掉上一份筛选；同一变量刷新清单时保留用户的搜索词。
    const targetChanged = !data || data.scope !== next.scope || data.name !== next.name;
    if (targetChanged) {
      query = '';
      kind = '';
    }
    data = next;
    source = origin;
    getSharedPanels()?.show('variableReferences');
    render();
  }

  return { open, close, isOpen };
}
