/**
 * 画布命令：图连接、节点增删、选择子树与复制粘贴。
 * 原 `workflow-editor.js` 的 nextId/buildNode/addNode/deleteSelection/
 * selectionTreeIds/copySelection/cutSelection/pasteClipboard 一组。
 *
 * 所有文档修改都通过注入的 mutate（History）完成，命令本身不渲染。
 */
import type { CanvasState } from './canvas-state';
import type { CanvasClipboardCard, CanvasClipboardPayload, CanvasClipboardVariable } from '../../shared/editor-messages';
import { reconcileVariableLinks } from '../model/variable-links';

export interface PointerPoint {
  x: number;
  y: number;
}

export interface CommandsDeps {
  state: CanvasState;
  nodes(): any[];
  nodeById(id: string): any;
  layout(): Record<string, any>;
  mutate(fn: () => void, options?: { render?: boolean }): void;
  clone<T>(value: T): T;
  toast(message: string, error?: boolean): void;
  worldPoint(event: { clientX: number; clientY: number }): PointerPoint;
  wrap: HTMLElement;
  nodeWidth: number;
  baseHeight: number;
  /** 复制/剪切后把剪贴板交给壳层保管，其他画布（包括弹出到独立窗口的面板）才能粘贴。 */
  publishClipboard?(payload: CanvasClipboardPayload): void;
  /** 变量卡片 id 生成器；缺省按 `card_<n>` 递增。 */
  nextVariableCardId?(): string;
  /** 在节点组内部创建/粘贴时，把新节点留在当前组内。 */
  onNodesCreated?(ids: string[]): void;
  /** 删除/剪切节点后同步节点组元数据（移除成员与端点、清理空组）；须在同一 mutate 内调用。 */
  onNodesRemoved?(ids: string[]): void;
}

export interface CanvasCommands {
  nextId(prefix?: string): string;
  parentOf(childId: string): { node: any; index: number } | null;
  descendants(id: string, out?: Set<string>): Set<string>;
  canConnect(parentId: string, childId: string): string | null;
  connect(parentId: string, childId: string, replaceIndex?: number): boolean;
  disconnect(parentId: string, childId: string): void;
  buildNode(type: string): any;
  addNode(type: string, at?: PointerPoint): void;
  deleteSelection(): void;
  selectionTreeIds(): Set<string>;
  copySelection(): boolean;
  cutSelection(): boolean;
  pasteClipboard(at?: PointerPoint): boolean;
}

export function createCanvasCommands(deps: CommandsDeps): CanvasCommands {
  const { state, nodes, nodeById, layout, mutate, clone, toast, worldPoint, wrap, nodeWidth, baseHeight } = deps;

  function nextId(prefix = 'node'): string {
    const used = new Set(nodes().map((node) => node.id));
    let index = 1;
    while (used.has(`${prefix}_${index}`)) index += 1;
    return `${prefix}_${index}`;
  }

  function parentOf(childId: string): { node: any; index: number } | null {
    for (const node of nodes()) {
      const index = Array.isArray(node.children) ? node.children.indexOf(childId) : -1;
      if (index >= 0) return { node, index };
    }
    return null;
  }

  function descendants(id: string, out = new Set<string>()): Set<string> {
    const node = nodeById(id);
    for (const child of (node && Array.isArray(node.children) ? node.children : [])) {
      if (!out.has(child)) {
        out.add(child);
        descendants(child, out);
      }
    }
    return out;
  }

  function canConnect(parentId: string, childId: string): string | null {
    const parent = nodeById(parentId);
    const child = nodeById(childId);
    if (!parent || !child) return '节点不存在';
    if (parent.type === 'task') return 'Task 没有子节点输出';
    if (parent.type === 'instance_parallel') return 'Instance Parallel 由 runs 配置实例，不能连接子节点';
    if (child.type === 'root') return 'Root 不允许父节点';
    if (parentId === childId || descendants(childId).has(parentId)) return '连接会形成环';
    if (parent.type === 'root' && parent.children && parent.children.length >= 1 && parent.children[0] !== childId) return null;
    if (parent.type === 'simple_parallel') {
      const children = Array.isArray(parent.children) ? parent.children : [];
      if (children.length >= 2 && !children.includes(childId)) return 'Simple Parallel 只能连接两个子节点';
      if (children.length === 0 && child.type !== 'task') return '第一个子节点必须是主 Task';
    }
    return null;
  }

  function connect(parentId: string, childId: string, replaceIndex?: number): boolean {
    const error = canConnect(parentId, childId);
    if (error) {
      toast(error, true);
      return false;
    }
    const parent = nodeById(parentId);
    if (!Array.isArray(parent.children)) parent.children = [];
    const oldParent = parentOf(childId);
    if (oldParent && oldParent.node.id === parentId && replaceIndex === undefined) return true;
    if (oldParent) oldParent.node.children.splice(oldParent.index, 1);
    if (parent.type === 'root' && parent.children.length) parent.children.splice(0, 1);
    if (replaceIndex !== undefined && replaceIndex >= 0 && replaceIndex < parent.children.length) parent.children.splice(replaceIndex, 1, childId);
    else parent.children.push(childId);
    if (parent.type === 'branch') {
      if (!Array.isArray(parent.conditions)) parent.conditions = [];
      while (parent.conditions.length < parent.children.length) parent.conditions.push({ eq: [1, 1] });
    }
    if (parent.type === 'switch') {
      if (!Array.isArray(parent.cases)) parent.cases = [];
      if (!parent.cases.some((item: any) => item && item.child === childId)) parent.cases.push({ value: parent.cases.length, child: childId });
    }
    return true;
  }

  function disconnect(parentId: string, childId: string): void {
    const parent = nodeById(parentId);
    if (!parent || !Array.isArray(parent.children)) return;
    const index = parent.children.indexOf(childId);
    if (index >= 0) parent.children.splice(index, 1);
    if (index >= 0 && parent.type === 'switch' && Array.isArray(parent.cases)) parent.cases = parent.cases.filter((item: any) => item && item.child !== childId);
  }

  /** 按类型构建一个尚未入图的新节点（addNode / 端口右键插入共用）。 */
  function buildNode(type: string): any {
    const prefix = type === 'simple_parallel' ? 'parallel' : type === 'instance_parallel' ? 'instances' : type;
    const node: any = { id: nextId(prefix), type, children: [] };
    if (type === 'task') {
      delete node.children;
      node.action = state.catalog[0] ? state.catalog[0].name : 'core.capture';
      node.params = {};
    } else if (type === 'instance_parallel') {
      delete node.children;
      node.runs = [{ instance: state.instances[0]?.id || '', workflow: '', inputs: {} }];
      node.wait_for = 'all';
      node.cancel_on_failure = true;
    } else if (type === 'repeat_until') {
      node.children = [];
      node.condition = { eq: [1, 1] };
      node.max_iterations = 100;
    } else if (type === 'branch') {
      node.children = [];
      node.conditions = [];
    } else if (type === 'switch') {
      node.children = [];
      node.expression = 0;
      node.cases = [];
    } else if (type === 'parallel') {
      node.children = [];
      node.wait_for = 'all';
      node.cancel_on_failure = true;
    }
    return node;
  }

  function addNode(type: string, at?: PointerPoint): void {
    mutate(() => {
      const node = buildNode(type);
      nodes().push(node);
      deps.onNodesCreated?.([node.id]);
      const point = at || worldPoint({ clientX: wrap.clientWidth / 2, clientY: wrap.clientHeight / 2 });
      layout()[node.id] = { x: Math.round(point.x - nodeWidth / 2), y: Math.round(point.y - baseHeight / 2) };
      state.selected = new Set([node.id]);
      state.selectedRun = null;
      state.inspector = 'node';
    });
  }

  function deleteSelection(): void {
    if (state.selectedEdge) {
      const { parent, child } = state.selectedEdge;
      mutate(() => disconnect(parent, child));
      state.selectedEdge = null;
      return;
    }
    const ids = [...state.selected].filter((id) => id !== state.raw?.root && nodeById(id)?.type !== 'root');
    if (!ids.length) return;
    mutate(() => {
      state.raw!.nodes = nodes().filter((node) => !ids.includes(node.id));
      for (const node of nodes()) if (Array.isArray(node.children)) node.children = node.children.filter((id: string) => !ids.includes(id));
      for (const id of ids) delete layout()[id];
      // 组元数据与节点删除同一次历史提交：失效成员/端点就地清理，空组整组删除。
      deps.onNodesRemoved?.(ids);
      state.selected.clear();
      state.selectedRun = null;
    });
  }

  /** 收集选中节点及其全部子树（排除 root），返回 id 集合。 */
  function selectionTreeIds(): Set<string> {
    const ids = new Set<string>();
    for (const id of state.selected) {
      if (id === state.raw?.root || (nodeById(id)?.type === 'root')) continue;
      ids.add(id);
      for (const descendant of descendants(id)) ids.add(descendant);
    }
    return ids;
  }

  /**
   * 收集被复制节点引用到的输入/变量，连同它们在画布上的卡片一起打包。
   * 没有这一步，粘到别的工作流时绑定会指向不存在的变量（画布上显示「失效」、校验也报错）。
   */
  function clipboardCarry(ids: Set<string>): { variables: CanvasClipboardVariable[]; cards: CanvasClipboardCard[] } {
    const raw = state.raw || {};
    const wanted = new Map<string, { scope: 'inputs' | 'variables'; name: string }>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (typeof record.ref === 'string' && Object.keys(record).length === 1) {
        const match = /^(inputs|variables)\.([^\.]+)/.exec(record.ref);
        if (match) {
          const scope = match[1] as 'inputs' | 'variables';
          wanted.set(`${scope}.${match[2]}`, { scope, name: match[2] });
        }
      }
      Object.values(record).forEach(visit);
    };
    for (const node of nodes()) if (ids.has(node.id)) visit(node);

    const variables: CanvasClipboardVariable[] = [];
    const cards: CanvasClipboardCard[] = [];
    const cardEntries = raw._variableCards && typeof raw._variableCards === 'object' ? Object.entries<any>(raw._variableCards) : [];
    for (const { scope, name } of wanted.values()) {
      const definition = raw[scope] && typeof raw[scope] === 'object' ? raw[scope][name] : undefined;
      if (definition && typeof definition === 'object') variables.push({ scope, name, definition: clone(definition) });
      const card = cardEntries.find(([, value]) => value && value.scope === scope && value.name === name);
      if (!card) continue;
      cards.push({ scope, name, x: Number(card[1].x ?? 0), y: Number(card[1].y ?? 0) });
    }
    return { variables, cards };
  }

  /** 把选中子树打包成剪贴板内容（节点 + 布局 + 引用到的变量与卡片），并存进画布状态。 */
  function captureSelection(ids: Set<string>): CanvasClipboardPayload {
    const copied = clone(nodes().filter((node) => ids.has(node.id)));
    const copiedLayout: Record<string, { x: number; y: number }> = {};
    for (const id of ids) {
      const position = layout()[id];
      if (position) copiedLayout[id] = { x: position.x, y: position.y };
    }
    const { variables, cards } = clipboardCarry(ids);
    const payload: CanvasClipboardPayload = {
      version: 1,
      sourceUri: String(state.docUri || ''),
      nodes: copied,
      layout: copiedLayout,
      variables,
      cards,
    };
    state.clipboard = payload;
    // 交给壳层：同一窗口的其他画布（含弹出面板）会同步到同一份剪贴板。
    deps.publishClipboard?.(payload);
    return payload;
  }

  /** 粘贴到别的文档时把变量定义与变量卡片补上（同文档粘贴无需重复补）。 */
  function carryIntoDocument(payload: CanvasClipboardPayload, dx: number, dy: number): void {
    if (!payload.sourceUri || payload.sourceUri === String(state.docUri || '')) return;
    const raw = state.raw;
    if (!raw) return;
    for (const variable of payload.variables) {
      raw[variable.scope] ||= {};
      // 目标文档已有同名变量就以它为准（可能是刻意的不同定义），不覆盖。
      if (Object.prototype.hasOwnProperty.call(raw[variable.scope], variable.name)) continue;
      raw[variable.scope][variable.name] = clone(variable.definition);
    }
    for (const card of payload.cards) {
      const scopeValues = raw[card.scope];
      if (!scopeValues || !Object.prototype.hasOwnProperty.call(scopeValues, card.name)) continue;
      const cards = (raw._variableCards ||= {});
      const exists = Object.values<any>(cards).some((value) => value && value.scope === card.scope && value.name === card.name);
      if (exists) continue;
      cards[nextCardId()] = { name: card.name, scope: card.scope, x: Math.round(card.x + dx), y: Math.round(card.y + dy) };
    }
  }

  function nextCardId(): string {
    if (deps.nextVariableCardId) return deps.nextVariableCardId();
    const cards = state.raw && state.raw._variableCards && typeof state.raw._variableCards === 'object' ? state.raw._variableCards : {};
    let index = 1;
    while (Object.prototype.hasOwnProperty.call(cards, `card_${index}`)) index += 1;
    return `card_${index}`;
  }

  /** 把选中节点及其子树复制到画布剪贴板。 */
  function copySelection(): boolean {
    const ids = selectionTreeIds();
    if (ids.size === 0) {
      toast('请先选择要复制的节点', true);
      return false;
    }
    captureSelection(ids);
    toast(`已复制 ${ids.size} 个节点`);
    return true;
  }

  /** 剪切：复制选中子树后从图中移除。 */
  function cutSelection(): boolean {
    const ids = selectionTreeIds();
    if (ids.size === 0) {
      toast('请先选择要剪切的节点', true);
      return false;
    }
    captureSelection(ids);
    mutate(() => {
      state.raw!.nodes = nodes().filter((node) => !ids.has(node.id));
      for (const node of nodes()) if (Array.isArray(node.children)) node.children = node.children.filter((id: string) => !ids.has(id));
      for (const id of ids) delete layout()[id];
      deps.onNodesRemoved?.([...ids]);
      state.selected.clear();
    });
    toast(`已剪切 ${ids.size} 个节点`);
    return true;
  }

  /**
   * 粘贴剪贴板内容：生成新 ID、重映射 children/refs、放置到目标位置（默认鼠标处）。
   * 剪贴板来自壳层，所以这里粘的可能是**另一个画布**复制的卡片：一起把变量定义与变量卡片补过去。
   */
  function pasteClipboard(at?: PointerPoint): boolean {
    const payload = state.clipboard;
    if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0) {
      toast('剪贴板为空', true);
      return false;
    }
    const used = new Set(nodes().map((node) => node.id));
    const idMap = new Map<string, string>();
    for (const src of payload.nodes) {
      const prefix = (src.id || 'node').replace(/_\d+$/, '') || 'node';
      let index = 1;
      let candidate = `${prefix}_${index}`;
      while (used.has(candidate)) { index += 1; candidate = `${prefix}_${index}`; }
      used.add(candidate);
      idMap.set(src.id, candidate);
    }
    // 以剪贴板内容的包围盒左上角为锚点，把整组移动到目标位置。
    const positions = Object.values(payload.layout || {});
    let minX = 0;
    let minY = 0;
    if (positions.length) {
      minX = Math.min(...positions.map((p) => p.x));
      minY = Math.min(...positions.map((p) => p.y));
    }
    const target = at || state.mouse || null;
    let dx = 40;
    let dy = 40;
    if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
      dx = Math.round(target.x - minX);
      dy = Math.round(target.y - minY);
    }
    mutate(() => {
      const created: string[] = [];
      const remap = (item: any): void => {
        if (Array.isArray(item)) return item.forEach(remap);
        if (!item || typeof item !== 'object') return;
        if (typeof item.ref === 'string') {
          for (const [oldId, newId] of idMap) item.ref = item.ref.replace(`nodes.${oldId}.output.`, `nodes.${newId}.output.`);
        }
        Object.values(item).forEach(remap);
      };
      carryIntoDocument(payload, dx, dy);
      for (const src of payload.nodes) {
        const copy = clone(src);
        copy.id = idMap.get(src.id);
        if (Array.isArray(copy.children)) copy.children = copy.children.filter((id: string) => idMap.has(id)).map((id: string) => idMap.get(id));
        remap(copy);
        const base = payload.layout[src.id] || { x: 0, y: 0 };
        layout()[copy.id] = { x: base.x + dx, y: base.y + dy };
        nodes().push(copy);
        created.push(copy.id);
      }
      state.selected = new Set(created);
      deps.onNodesCreated?.(created);
      state.selectedRun = null;
      state.inspector = 'node';
      // 粘贴出来的节点带着参数的变量引用，但连线项是按节点 id 记的：
      // 不补上的话同一个绑定会出现两种说法（新节点只显示「引用」）。
      reconcileVariableLinks(state.raw);
    });
    toast(`已粘贴 ${idMap.size} 个节点`);
    return true;
  }

  return {
    nextId,
    parentOf,
    descendants,
    canConnect,
    connect,
    disconnect,
    buildNode,
    addNode,
    deleteSelection,
    selectionTreeIds,
    copySelection,
    cutSelection,
    pasteClipboard,
  };
}
