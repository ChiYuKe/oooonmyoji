/**
 * 画布命令：变量卡片增删与放置、节点重命名与类型切换。
 * 原 `workflow-editor.js` 的两段：removeVariableCard 至 addVariableCardCommand、renameNode 至 changeNodeType。
 *
 * 命令通过 mutate 提交历史，不直接改视图。
 */
import type { CanvasState } from '../state/canvas-state';
import { BOOL_JUDGE_COMPARISON_OPERATORS, boolJudgeShape } from '../model/exec-ports';
import { parameterLiteralCache, parameterLiteralCacheKey } from './literal-cache';

export interface EditorCommandsDeps {
  state: Omit<CanvasState, 'raw'> & { raw: any };
  mutate(fn: () => void): void;
  nodeById(id: string): any;
  nodes(): any[];
  layout(): Record<string, any>;
  position(node: any): { x: number; y: number };
  clone<T>(value: T): T;
  toast(message: string, isError?: boolean): void;
  variableCards(): Record<string, any>;
  variableLinks(): Record<string, any>;
  nextVariableCardId(): string;
  setVariableCardSelection(ids: any): void;
  variableInputTargetAt(...args: any[]): any;
  instanceRunCards(): any[];
  displayNameOfDefinition(definition: any, name?: string): string;
  wrap: HTMLElement;
  variableCardWidth: number;
  variableCardHeight: number;
  variableCardPortY: number;
  nodeWidth: number;
  runCardWidth: number;
}

export function createEditorCommands(deps: EditorCommandsDeps) {
  const {
    state, mutate, nodeById, nodes, layout, position, clone, toast,
    variableCards, variableLinks, nextVariableCardId,
    setVariableCardSelection, variableInputTargetAt,
    instanceRunCards, displayNameOfDefinition, wrap,
    variableCardWidth: VARIABLE_CARD_W, variableCardHeight: VARIABLE_CARD_H,
    variableCardPortY: VARIABLE_CARD_PORT_Y, nodeWidth: NODE_W, runCardWidth: RUN_CARD_W,
  } = deps;
  function removeVariableCard(id: string): void {
    removeVariableCards([id]);
  }

  /**
   * 解除某个端口（键为 `nodeId:param`，实例子输入为 `nodeId:runs.N.inputs.param`）的变量绑定。
   * 绑定前的字面量若已缓存则恢复，否则直接移除引用（参数回落到定义默认值）。
   * 返回这次是否真的释放了一处引用，调用方据此给出提示。
   */
  function releasePinBinding(key: string): boolean {
    const separator = typeof key === 'string' ? key.indexOf(':') : -1;
    if (separator < 0) return false;
    const node = nodeById(key.slice(0, separator));
    const param = key.slice(separator + 1);
    if (!node) return false;
    const runMatch = /^runs\.(\d+)\.inputs\.(.+)$/.exec(param);
    if (runMatch) {
      const run = Array.isArray(node.runs) ? node.runs[Number(runMatch[1])] : null;
      if (run && run.inputs && typeof run.inputs === 'object' && !Array.isArray(run.inputs)) {
        delete run.inputs[runMatch[2]];
        return true;
      }
      return false;
    }
    const nested = param.startsWith('inputs.');
    const name = nested ? param.slice('inputs.'.length) : param;
    const holder = nested ? node.params && node.params.inputs : node.params;
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) return false;
    const cache = parameterLiteralCache(state);
    const cacheKey = parameterLiteralCacheKey(node, name);
    if (Object.prototype.hasOwnProperty.call(cache, cacheKey)) holder[name] = clone(cache[cacheKey]);
    else delete holder[name];
    delete cache[cacheKey];
    return true;
  }

  /**
   * 删除变量卡片。画布连接优先：没有卡片再引用该变量的端口会同步解除绑定，
   * 同一变量若还有别的卡片存活，则把连线改指到存活卡片上（绑定保留）。
   *
   * 另外要收敛**孤儿引用**：参数里的 `{ref}` 与连线映射是两份记录，
   * `_variableLinks` 可能已经丢了这一项（旧文档、手工改过的 JSON、映射与引用不同步），
   * 此时光看映射是找不到它的。剩下来的引用会指向已经不存在的变量，
   * 卡片上继续显示「已连接」——所以删除卡片时按份数扫一遍参数，把引用清掉。
   */
  function removeVariableCards(ids: any): void {
    const targets = [...new Set(Array.isArray(ids) ? ids : [])]
      .filter((id) => Object.prototype.hasOwnProperty.call(variableCards(), id));
    if (!targets.length) return;
    const targetSet = new Set(targets);
    const describe = (value: any) => ({
      scope: value && value.scope === 'variables' ? 'variables' : 'inputs',
      name: value && typeof value.name === 'string' ? value.name : '',
    });
    const released: any[] = [];
    for (const [key, cardId] of Object.entries(variableLinks())) {
      if (!targetSet.has(cardId)) continue;
      const card = variableCards()[cardId];
      if (card) released.push({ key, ...describe(card) });
    }
    const survivors = Object.entries(variableCards())
      .filter(([id]) => !targetSet.has(id))
      .map(([id, value]) => ({ id, ...describe(value) }));
    // 被删卡片所代表的变量里，已经没有存活卡片的那些：它们的引用必须清掉。
    // 这里按**卡片自己**算而不是按映射算——`_variableLinks` 可能压根没有这一项，
    // 那种孤儿引用同样指向已被删掉的变量。
    const orphanedRefs = new Set<string>();
    for (const id of targets) {
      const card = describe(variableCards()[id]);
      if (!card.name) continue;
      if (survivors.some((item) => item.scope === card.scope && item.name === card.name)) continue;
      orphanedRefs.add(`${card.scope}.${card.name}`);
    }
    // 清引用时数一下实际清掉了几处：映射里找不到的孤儿引用也要算进提示。
    let unbound = 0;
    mutate(() => {
      for (const id of targets) delete variableCards()[id];
      for (const [key, cardId] of Object.entries(variableLinks())) if (targetSet.has(cardId)) delete variableLinks()[key];
      for (const item of released) {
        const survivor = survivors.find((card) => card.scope === item.scope && card.name === item.name);
        if (survivor) variableLinks()[item.key] = survivor.id;
        else {
          releasePinBinding(item.key);
          unbound += 1;
        }
      }
      unbound += revertOrphanVariableRefs(orphanedRefs);
      const selected = state.selectedVariableCardIds && typeof state.selectedVariableCardIds.forEach === 'function'
        ? [...state.selectedVariableCardIds]
        : [];
      setVariableCardSelection(selected.filter((id: any) => !targetSet.has(id)));
    });
    toast(unbound
      ? `已删除 ${targets.length} 个变量卡片，并解除 ${unbound} 处端口引用`
      : `已删除 ${targets.length} 个变量卡片`);
  }

  /** 清掉指向已彻底删除的变量的参数引用（`${scope}.${name}` 精确匹配，子引用也算）；返回清掉的处数。 */
  function revertOrphanVariableRefs(refs: Set<string>): number {
    if (!refs.size) return 0;
    let cleared = 0;
    const links = variableLinks();
    for (const node of nodes()) {
      if (!node || !node.params || typeof node.params !== 'object' || Array.isArray(node.params)) continue;
      for (const [name, value] of Object.entries(node.params)) {
        if (isOrphanRef(value, refs)) {
          delete node.params[name];
          delete links[`${node.id}:${name}`];
          cleared += 1;
        }
      }
      const nested = node.params.inputs;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        for (const [name, value] of Object.entries(nested)) {
          if (isOrphanRef(value, refs)) {
            delete nested[name];
            delete links[`${node.id}:inputs.${name}`];
            cleared += 1;
          }
        }
      }
      if (!Array.isArray(node.runs)) continue;
      node.runs.forEach((run: any, index: number) => {
        if (!run || !run.inputs || typeof run.inputs !== 'object' || Array.isArray(run.inputs)) return;
        for (const [name, value] of Object.entries(run.inputs)) {
          if (isOrphanRef(value, refs)) {
            delete run.inputs[name];
            delete links[`${node.id}:runs.${index}.inputs.${name}`];
            cleared += 1;
          }
        }
      });
    }
    return cleared;
  }

  function isOrphanRef(value: any, refs: Set<string>): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const ref = value.ref;
    if (typeof ref !== 'string' || !ref) return false;
    for (const candidate of refs) if (ref === candidate || ref.startsWith(`${candidate}.`)) return true;
    return false;
  }

  /** 把变量卡片放到指定世界坐标；若附近有兼容端点则吸附到端点旁并建立绑定。 */
  function placeVariableCard(scope: string, name: string, point: { x: number; y: number }, options: any = {}): any {
    if (!state.raw[scope] || typeof state.raw[scope] !== 'object' || Array.isArray(state.raw[scope])) return;
    if (!Object.prototype.hasOwnProperty.call(state.raw[scope], name)) { toast(`${scope}.${name} 不存在`, true); return; }
    const target = options.connect === false ? null : variableInputTargetAt(point, scope, name);
    mutate(() => {
      const cards = variableCards();
      const cardId = nextVariableCardId();
      if (target && target.kind === 'instance-input') {
        const runCard = instanceRunCards().find((item: any) => item.node.id === target.nodeId && item.index === target.runIndex);
        const run = runCard && runCard.run;
        const left = runCard.x - VARIABLE_CARD_W - 56;
        const x = left >= 24 ? left : runCard.x + RUN_CARD_W + 56;
        cards[cardId] = { name, scope, x: Math.round(x / 8) * 8, y: Math.max(24, Math.round((target.y - VARIABLE_CARD_PORT_Y) / 8) * 8) };
        if (!run.inputs || typeof run.inputs !== 'object' || Array.isArray(run.inputs)) run.inputs = {};
        run.inputs[target.param] = { ref: `${scope}.${name}` };
        variableLinks()[`${target.nodeId}:runs.${target.runIndex}.inputs.${target.param}`] = cardId;
      } else if (target) {
        const node = nodeById(target.nodeId);
        const pos = position(node);
        const left = pos.x - VARIABLE_CARD_W - 56;
        const x = left >= 24 ? left : pos.x + NODE_W + 56;
        cards[cardId] = { name, scope, x: Math.round(x / 8) * 8, y: Math.max(24, Math.round((target.y - VARIABLE_CARD_PORT_Y) / 8) * 8) };
        variableLinks()[`${target.nodeId}:${target.param}`] = cardId;
        if (target.param.startsWith('inputs.')) {
          if (!node.params.inputs || typeof node.params.inputs !== 'object' || Array.isArray(node.params.inputs)) node.params.inputs = {};
          node.params.inputs[target.param.slice('inputs.'.length)] = { ref: `${scope}.${name}` };
        } else node.params[target.param] = { ref: `${scope}.${name}` };
      } else {
        cards[cardId] = { name, scope, x: Math.round((point.x - VARIABLE_CARD_W / 2) / 8) * 8, y: Math.round((point.y - VARIABLE_CARD_PORT_Y) / 8) * 8 };
      }
    });
    if (target && target.kind === 'instance-input') toast(`已连接 实例输入 ${target.param} ← 变量 ${displayNameOfDefinition(state.raw[scope][name], name)}`);
    else if (target) toast(`已连接 参数 ${target.param} ← 变量 ${name}`);
    else toast(`已添加变量卡片 ${name}`);
  }

  /** 编辑器命令入口：在鼠标处（或视野中心）创建变量卡片。 */
  function addVariableCardCommand(value: any): void {
    const scope = value && value.scope === 'variables' ? 'variables' : 'inputs';
    const variableName = String(value && value.name !== undefined ? value.name : value ?? '').trim();
    if (!variableName) return;
    if (!state.raw[scope] || !Object.prototype.hasOwnProperty.call(state.raw[scope], variableName)) { toast(`${scope}.${variableName} 不存在`, true); return; }
    if (!wrap.clientWidth || !wrap.clientHeight) return;
    const rect = wrap.getBoundingClientRect();
    const point = state.mouse || { x: (rect.width / 2 - state.panX) / state.zoom, y: (rect.height / 2 - state.panY) / state.zoom };
    placeVariableCard(scope, variableName, point, { connect: false });
  }

  function renameNode(oldId: string, value: string): void {
    if (!value || value === oldId) return;
    if (nodeById(value)) { toast('节点 ID 已存在', true); return; }
    mutate(() => {
      const node = nodeById(oldId); node.id = value;
      for (const parent of nodes()) if (Array.isArray(parent.children)) parent.children = parent.children.map((child: any) => child === oldId ? value : child);
      if (state.raw.root === oldId) state.raw.root = value;
      layout()[value] = layout()[oldId]; delete layout()[oldId];
      const remap = (item: any) => {
        if (Array.isArray(item)) return item.forEach(remap);
        if (!item || typeof item !== 'object') return;
        if (typeof item.ref === 'string') item.ref = item.ref.replace(`nodes.${oldId}.output.`, `nodes.${value}.output.`);
        Object.values(item).forEach(remap);
      };
      remap(state.raw.nodes);
      state.selected = new Set([value]);
    });
  }

  /** 类型切换时参与校验的结构字段：不属于目标类型的残留字段两端都会判为非法。 */
  const STRUCTURAL_FIELDS = [
    'action', 'params', 'children', 'finish_mode', 'runs', 'wait_for', 'cancel_on_failure',
    'condition', 'conditions', 'max_iterations', 'expression', 'cases', 'default_child', 'ports',
    'ref', 'fields',
  ];

  /** 各节点类型合法的结构字段（与 validator/schema 的 allowed_fields 对齐）。 */
  const TYPE_FIELDS: Record<string, string[]> = {
    task: ['action', 'params'],
    condition: ['expression', 'children', 'ports'],
    bool_judge: ['expression'],
    break: ['ref', 'fields'],
    instance_parallel: ['runs', 'wait_for', 'cancel_on_failure'],
    repeat_until: ['children', 'condition', 'max_iterations'],
    branch: ['children', 'conditions'],
    switch: ['children', 'expression', 'cases', 'default_child'],
    simple_parallel: ['children', 'finish_mode'],
    parallel: ['children', 'wait_for', 'cancel_on_failure'],
    root: ['children'], selector: ['children'], sequence: ['children'],
  };

  /**
   * 切换节点类型：先清掉不属于目标类型的结构字段，再补该类型必需的默认值。
   * 只清结构字段，id/name/decorators 与 `_` 前缀的编辑器私有键原样保留。
   */
  function changeNodeType(node: any, type: string): void {
    mutate(() => {
      node.type = type;
      const keep = TYPE_FIELDS[type] || ['children'];
      for (const key of [...Object.keys(node)]) {
        if (STRUCTURAL_FIELDS.includes(key) && !keep.includes(key)) delete node[key];
      }
      if (type === 'task') {
        node.action = state.catalog[0] ? state.catalog[0].name : 'core.capture';
        node.params = {};
      } else if (type === 'condition' || type === 'bool_judge') {
        // 判断节点默认恒真；值卡片则用 0 == 0 的操作数输入初始形态。
        if (node.expression === undefined) node.expression = { eq: type === 'bool_judge' ? [0, 0] : [1, 1] };
      } else if (type === 'break') {
        // 拆分卡片：没有可默认的来源绑定，等用户拖一条输出引用到「拆分来源」行。
        delete node.children;
      } else if (type === 'instance_parallel') {
        node.runs = Array.isArray(node.runs) && node.runs.length ? node.runs : [{ instance: state.instances[0]?.id || '', workflow: '', inputs: {} }];
        node.wait_for = node.wait_for === 'any' ? 'any' : 'all';
        node.cancel_on_failure = node.cancel_on_failure !== false;
      } else {
        node.children = Array.isArray(node.children) ? node.children : [];
        if (type === 'simple_parallel') node.finish_mode = 'abort_background';
        if (type === 'repeat_until') { node.condition = node.condition || { eq: [1, 1] }; node.max_iterations = node.max_iterations || 100; }
        if (type === 'branch') node.conditions = Array.isArray(node.conditions) ? node.conditions : [];
        if (type === 'switch') { node.expression = node.expression ?? 0; node.cases = Array.isArray(node.cases) ? node.cases : []; }
        if (type === 'parallel') { node.wait_for = 'all'; node.cancel_on_failure = true; }
      }
    });
  }

  /**
   * 换布尔判断卡片的运算符（UE 的 `Convert Operator`）：保留两个操作数，只替换表达式里的运算符键。
   *
   * 只接受二元比较运算符，且当前表达式必须已经是比较形态：
   * 与/或/非不是比较运算符，把 `{eq: [a, b]}` 换成 `{and: [a, b]}` 会写出 Python 校验直接
   * 拒绝的表达式（and/or 的操作数必须是条件对象或 bool），卡面也没有对应的可编辑引脚——
   * 嵌套条件统一走「嵌套条件（进阶）…」浮层。
   */
  function setBoolJudgeOperator(nodeId: string, operator: string): void {
    const node = nodeById(nodeId);
    if (!node || node.type !== 'bool_judge' || !operator) return;
    if (!BOOL_JUDGE_COMPARISON_OPERATORS.includes(operator)) return;
    if (boolJudgeShape(node) !== 'comparison') return;
    mutate(() => {
      const expression = node.expression as Record<string, unknown>;
      const current = Object.keys(expression)[0] || 'eq';
      const operands = (expression[current] as unknown[]).slice();
      node.expression = { [operator]: operands };
    });
  }

  return {
    removeVariableCard, releasePinBinding, removeVariableCards, placeVariableCard, addVariableCardCommand,
    renameNode, changeNodeType, setBoolJudgeOperator,
  };
}