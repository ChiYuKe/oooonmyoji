(() => {
  'use strict';

  const vscode = acquireVsCodeApi();
  const NS = 'http://www.w3.org/2000/svg';
  const NODE_W = 260;
  const BASE_H = 96;
  const DECO_H = 22;
  const PORT_R = 7;
  const RUN_CARD_W = 250;
  const RUN_CARD_BASE_H = 78;
  const RUN_VARIABLE_H = 24;
  const RUN_CARD_GAP_X = 48;
  const RUN_CARD_GAP_Y = 92;
  const PREVIEW = { x: 164, y: 48, width: 82, height: 34 };
  const VARIABLE_CARD_W = 168;
  const VARIABLE_CARD_H = 58;
  const VARIABLE_CARD_PORT_Y = 29;
  const VARIABLE_PIN_X = 10;
  const VARIABLE_DRAG_MIME = 'application/x-onmyoji-variable';
  const TYPES = ['root', 'selector', 'sequence', 'simple_parallel', 'parallel', 'repeat_until', 'branch', 'switch', 'instance_parallel', 'task'];
  const TYPE_LABEL = { root: 'ROOT', selector: 'SELECTOR', sequence: 'SEQUENCE', simple_parallel: 'SIMPLE PARALLEL', parallel: 'PARALLEL', repeat_until: 'REPEAT UNTIL', branch: 'BRANCH', switch: 'SWITCH', instance_parallel: 'INSTANCE PARALLEL', task: 'TASK' };
  const TYPE_ICON = { root: '◆', selector: '?', sequence: '→', simple_parallel: '∥', parallel: '⇉', repeat_until: '↻', branch: '⑂', switch: '⎇', instance_parallel: '⇶', task: '▣' };
  const RUN_LABEL = {
    running: '运行中', succeeded: '已完成', matched: '已匹配', not_matched: '未匹配',
    failed: '失败', cancelled: '已取消', branch_miss: '分支跳过',
  };
  const state = {
    raw: null,
    catalog: [],
    refs: { blackboard: [], nodes: [] },
    issues: [],
    workflows: [],
    docUri: '',
    documentName: '',
    workflowTrail: [],
    instances: [],
    instanceId: '',
    selected: new Set(),
    selectedEdge: null,
    selectedRun: null,
    selectedVariable: '',
    zoom: 1,
    panX: 80,
    panY: 48,
    drag: null,
    connect: null,
    variableConnect: null,
    marquee: null,
    undo: [],
    redo: [],
    dirty: false,
    inspector: 'node',
    run: new Map(),
    activeRun: null,
    roi: null,
    assetBrowser: null,
    workflowBrowser: null,
    assetsBaseUri: '',
    templateCheck: null,
    exportBusy: false,
    nodeSearch: { query: '', ids: [], index: -1 },
    clipboard: null,
    clipboardLayout: null,
    mouse: null,
  };
  // 双击检测（原生 dblclick 会被 mousedown 后的 render() 重建 DOM 破坏，改用两次按下计时）
  let lastClickTime = 0;
  let lastClickNode = '';
  let lastClickX = -1;
  let lastClickY = -1;
  // 右键拖拽平移后，Windows 在松开右键时才触发 contextmenu，需要抑制这次误触
  let suppressPanContextMenu = false;

  const $ = (id) => document.getElementById(id);
  const graph = $('graph');
  const wrap = $('canvas-wrap');
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const nodes = () => Array.isArray(state.raw && state.raw.nodes) ? state.raw.nodes : [];
  const nodeById = (id) => nodes().find((node) => node && node.id === id) || null;
  const catalogByName = (name) => state.catalog.find((item) => item.name === name) || null;
  const workflowNodeVariables = (node) => subWorkflowRef(node) ? publicWorkflowVariables(subWorkflowRef(node)) : [];
  const nodeHeight = (node) => BASE_H
    + nodeVariablePins(node).length * RUN_VARIABLE_H
    + (Array.isArray(node.decorators) ? node.decorators.length * DECO_H : 0);
  const layout = () => {
    if (!state.raw._layout || typeof state.raw._layout !== 'object' || Array.isArray(state.raw._layout)) state.raw._layout = {};
    return state.raw._layout;
  };
  const position = (node) => {
    const value = layout()[node.id];
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : { x: 0, y: 0 };
  };

  /** 变量卡片位置表，随文档保存（schema 允许 `_` 前缀的编辑器私有键）。 */
  function variableCards() {
    if (!state.raw || typeof state.raw !== 'object') return {};
    if (!state.raw._variableCards || typeof state.raw._variableCards !== 'object' || Array.isArray(state.raw._variableCards)) state.raw._variableCards = {};
    return state.raw._variableCards;
  }

  function variableLinks() {
    if (!state.raw || typeof state.raw !== 'object') return {};
    if (!state.raw._variableLinks || typeof state.raw._variableLinks !== 'object' || Array.isArray(state.raw._variableLinks)) state.raw._variableLinks = {};
    return state.raw._variableLinks;
  }

  function nextVariableCardId() {
    const cards = variableCards();
    let index = 1;
    while (Object.prototype.hasOwnProperty.call(cards, `card_${index}`)) index += 1;
    return `card_${index}`;
  }

  function variableCardList() {
    const blackboard = state.raw && state.raw.blackboard && typeof state.raw.blackboard === 'object' && !Array.isArray(state.raw.blackboard)
      ? state.raw.blackboard
      : {};
    return Object.entries(variableCards())
      .map(([id, value]) => ({
        id,
        name: value && typeof value.name === 'string' && value.name ? value.name : id,
        x: value && Number.isFinite(value.x) ? value.x : 0,
        y: value && Number.isFinite(value.y) ? value.y : 0,
      }))
      .filter((card) => Object.prototype.hasOwnProperty.call(blackboard, card.name));
  }

  function variableTypeOf(name) {
    const definition = state.raw.blackboard && state.raw.blackboard[name];
    return definition && typeof definition === 'object' && definition.type ? definition.type : 'any';
  }

  /** 节点卡片左侧的变量端点：公开参数，以及子工作流的公开输入。 */
  function nodeVariablePins(node) {
    if (!node || node.type !== 'task') return [];
    const params = node.params && typeof node.params === 'object' && !Array.isArray(node.params) ? node.params : {};
    const pins = [];
    const spec = catalogByName(node.action);
    const publicParams = publicParameterNames(node);
    for (const param of publicParams) {
      if (!spec || !spec.parameters || !spec.parameters[param]) continue;
      const value = params[param];
      const variable = value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string' && value.ref.startsWith('blackboard.')
        ? value.ref.slice('blackboard.'.length)
        : '';
      const definition = spec && spec.parameters ? spec.parameters[param] : null;
      pins.push({ param, variable, type: variable ? variableTypeOf(variable) : definition && definition.type || 'any', label: param });
    }
    for (const variable of workflowNodeVariables(node)) {
      const input = params.inputs && typeof params.inputs === 'object' ? params.inputs[variable.name] : null;
      const ref = input && typeof input === 'object' && typeof input.ref === 'string' && input.ref.startsWith('blackboard.') ? input.ref.slice('blackboard.'.length) : '';
      pins.push({ param: `inputs.${variable.name}`, variable: ref, type: variable.definition.type || 'any', label: variable.name });
    }
    return pins;
  }

  function variableCardPosition(node, index = 0) {
    const pos = position(node);
    const left = pos.x - VARIABLE_CARD_W - 56;
    const x = left >= 24 ? left : pos.x + NODE_W + 56;
    const pinY = pos.y + BASE_H + index * RUN_VARIABLE_H + RUN_VARIABLE_H / 2;
    return {
      x: Math.round(x / 8) * 8,
      y: Math.max(24, Math.round((pinY - VARIABLE_CARD_PORT_Y) / 8) * 8),
    };
  }

  function publicParameterMetadata() {
    if (!state.raw || typeof state.raw !== 'object') return {};
    if (!state.raw._publicParams || typeof state.raw._publicParams !== 'object' || Array.isArray(state.raw._publicParams)) state.raw._publicParams = {};
    return state.raw._publicParams;
  }

  function publicParameterNames(node) {
    const value = state.raw && state.raw._publicParams && state.raw._publicParams[node && node.id];
    if (Array.isArray(value)) return value.filter((name) => typeof name === 'string' && name);
    if (value && typeof value === 'object') return Object.keys(value).filter((name) => value[name] === true);
    return [];
  }

  function isParameterPublic(node, name) {
    return publicParameterNames(node).includes(name);
  }

  /** 将旧版“公开即自动绑定”数据迁移为公开元数据，并保留现有引用。 */
  function syncLegacyPublicParameters() {
    if (!state.raw || Object.prototype.hasOwnProperty.call(state.raw, '_publicParams')) return false;
    const blackboard = state.raw.blackboard;
    if (!blackboard || typeof blackboard !== 'object' || Array.isArray(blackboard)) return false;
    const metadata = {};
    let changed = false;
    for (const node of nodes()) {
      if (!node || node.type !== 'task' || !node.params || typeof node.params !== 'object' || Array.isArray(node.params)) continue;
      const names = Object.entries(node.params)
        .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string' && value.ref.startsWith('blackboard.') && Object.prototype.hasOwnProperty.call(blackboard, value.ref.slice('blackboard.'.length)))
        .map(([name]) => name);
      if (names.length) { metadata[node.id] = names; changed = true; }
    }
    if (!changed) return false;
    state.raw._publicParams = metadata;
    return true;
  }

  /** 将旧文档中已有的 blackboard 绑定迁移为可见的变量卡片。 */
  function syncLegacyVariableCards() {
    if (!state.raw || Object.prototype.hasOwnProperty.call(state.raw, '_variableCards')) return false;
    const blackboard = state.raw.blackboard;
    if (!blackboard || typeof blackboard !== 'object' || Array.isArray(blackboard)) return false;
    const references = new Map();
    for (const node of nodes()) {
      nodeVariablePins(node).forEach((pin, index) => {
        if (pin.variable && Object.prototype.hasOwnProperty.call(blackboard, pin.variable) && !references.has(pin.variable)) {
          references.set(pin.variable, { node, index });
        }
      });
    }
    if (!references.size) return false;
    const cards = variableCards();
    for (const [name, reference] of references) {
      const id = nextVariableCardId();
      cards[id] = { name, ...variableCardPosition(reference.node, reference.index) };
    }
    return true;
  }

  function variablePinPosition(node, index) {
    const pos = position(node);
    return { x: pos.x + VARIABLE_PIN_X, y: pos.y + BASE_H + index * RUN_VARIABLE_H + RUN_VARIABLE_H / 2 };
  }

  function variableCompatibleWithPin(variableName, node, param) {
    if (!node) return false;
    const spec = node.action ? catalogByName(node.action) : null;
    let definition = spec && spec.parameters ? spec.parameters[param] : undefined;
    if (!definition && typeof param === 'string' && param.startsWith('inputs.')) {
      const publicVariable = workflowNodeVariables(node).find((item) => `inputs.${item.name}` === param);
      definition = publicVariable && publicVariable.definition;
    }
    if (!definition) return true;
    const variableDefinition = state.raw.blackboard && state.raw.blackboard[variableName];
    return compatibleRefType(definitionSchema(definition), definitionSchema(variableDefinition));
  }

  function workflowDescriptor(reference) {
    const normalized = String(reference || '').trim().replace(/\\/g, '/').replace(/^workflows\//i, '');
    if (!normalized) return null;
    const withExt = normalized.toLowerCase().endsWith('.json') ? normalized : `${normalized}.json`;
    return (state.workflows || []).find((file) => {
      const candidate = workflowReference(file);
      return candidate === normalized
        || candidate === withExt
        || candidate.endsWith(`/${normalized}`)
        || candidate.endsWith(`/${withExt}`)
        || file.id === normalized;
    }) || null;
  }

  function publicWorkflowVariables(reference) {
    const descriptor = workflowDescriptor(reference);
    return descriptor && Array.isArray(descriptor.variables)
      ? descriptor.variables.filter((variable) => variable && variable.public !== false && variable.definition)
      : [];
  }

  function instanceRunCards() {
    const cards = [];
    for (const node of nodes()) {
      if (node.type !== 'instance_parallel' || !Array.isArray(node.runs) || !node.runs.length) continue;
      const parent = position(node);
      const totalWidth = node.runs.length * RUN_CARD_W + Math.max(0, node.runs.length - 1) * RUN_CARD_GAP_X;
      const startX = parent.x + NODE_W / 2 - totalWidth / 2;
      node.runs.forEach((run, index) => {
        const variables = publicWorkflowVariables(run.workflow);
        cards.push({
          key: `${node.id}:${index}`,
          node,
          run,
          index,
          variables,
          x: startX + index * (RUN_CARD_W + RUN_CARD_GAP_X),
          y: parent.y + nodeHeight(node) + RUN_CARD_GAP_Y,
          height: RUN_CARD_BASE_H + variables.length * RUN_VARIABLE_H,
        });
      });
    }
    return cards;
  }

  function svgEl(tag, attrs, parent) {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    }
    if (parent) parent.appendChild(element);
    return element;
  }

  function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setDirty(value = true) {
    state.dirty = value;
    $('dirty-badge').classList.toggle('hidden', !value);
    vscode.setState({ dirty: value });
    if (value && state.raw) {
      vscode.postMessage({
        type: 'documentStateChanged',
        text: JSON.stringify(state.raw, null, 2) + '\n',
        dirty: true,
      });
    }
  }

  let lastSidebarState = '';

  function currentInspectorSelection() {
    if (state.inspector === 'workflow') return { kind: 'workflow' };
    if (state.inspector === 'variables') return { kind: 'variables', name: state.selectedVariable || '' };
    if (state.selectedRun) return { kind: 'run', nodeId: state.selectedRun.nodeId, index: state.selectedRun.index };
    if (state.selectedEdge) return { kind: 'edge', parent: state.selectedEdge.parent, child: state.selectedEdge.child };
    if (state.selected.size === 1) return { kind: 'node', nodeId: [...state.selected][0] };
    return { kind: 'none' };
  }

  function requestInspector(selection = currentInspectorSelection()) {
    vscode.postMessage({ type: 'inspectorRequested', inspectorSelection: selection });
  }

  function postSidebarState() {
    const blackboard = state.raw && state.raw.blackboard && typeof state.raw.blackboard === 'object' && !Array.isArray(state.raw.blackboard)
      ? state.raw.blackboard
      : {};
    const variables = Object.entries(blackboard).map(([name, rawDefinition]) => {
      const definition = rawDefinition && typeof rawDefinition === 'object' && !Array.isArray(rawDefinition) ? rawDefinition : {};
      return { name, type: definition.type || 'any', public: definition.public !== false };
    });
    const selectedVariable = state.inspector === 'variables' && Object.prototype.hasOwnProperty.call(blackboard, state.selectedVariable)
      ? state.selectedVariable
      : '';
    const sidebarNodes = nodes().map((node) => {
      const subRef = node.type === 'task' && node.action === 'workflow.run' && typeof node.params?.workflow === 'string'
        ? String(node.params.workflow).split(/[\\/]/).pop()
        : '';
      const meta = node.type === 'task'
        ? (subRef ? `⇢ ${subRef}` : node.action || 'task')
        : node.type === 'instance_parallel' && Array.isArray(node.runs)
          ? `${node.runs.length} 个实例`
          : node.type;
      return {
        id: node.id,
        name: String(node.name || node.id),
        type: node.type || 'task',
        meta,
        children: Array.isArray(node.children) ? node.children.slice() : [],
      };
    });
    const selectedNode = state.inspector === 'node' && state.selected.size === 1 ? [...state.selected][0] : '';
    const payload = {
      variables,
      selectedVariable,
      nodes: sidebarNodes,
      root: String(state.raw.root || ''),
      selectedNode,
      inspectorSelection: currentInspectorSelection(),
    };
    const signature = JSON.stringify(payload);
    if (signature === lastSidebarState) return;
    lastSidebarState = signature;
    vscode.postMessage({ type: 'sidebarStateChanged', ...payload });
  }

  function snapshot() {
    return JSON.stringify(state.raw);
  }

  function mutate(fn, options = {}) {
    const before = snapshot();
    fn();
    if (snapshot() === before) return;
    state.undo.push(before);
    if (state.undo.length > 80) state.undo.shift();
    state.redo = [];
    setDirty();
    if (options.render !== false) render();
  }

  function restore(text) {
    state.raw = JSON.parse(text);
    state.selected.clear();
    state.selectedEdge = null;
    state.selectedRun = null;
    render();
  }

  function replaceDocument(text, recordHistory = false) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { return; }
    const before = snapshot();
    const next = normalizeRaw(parsed);
    if (JSON.stringify(next) === before) return;
    if (recordHistory) {
      state.undo.push(before);
      if (state.undo.length > 80) state.undo.shift();
      state.redo = [];
    }
    state.raw = next;
    state.selected = new Set([...state.selected].filter((id) => nodeById(id)));
    if (state.selectedEdge) {
      const parent = nodeById(state.selectedEdge.parent);
      if (!parent || !Array.isArray(parent.children) || !parent.children.includes(state.selectedEdge.child)) state.selectedEdge = null;
    }
    if (state.selectedRun) {
      const node = nodeById(state.selectedRun.nodeId);
      if (!node || !Array.isArray(node.runs) || !node.runs[state.selectedRun.index]) state.selectedRun = null;
    }
    if (state.inspector === 'variables' && !Object.prototype.hasOwnProperty.call(state.raw.blackboard || {}, state.selectedVariable)) {
      state.selectedVariable = '';
    }
    render();
  }

  function undo() {
    const value = state.undo.pop();
    if (!value) return;
    state.redo.push(snapshot());
    restore(value);
    setDirty();
  }

  function redo() {
    const value = state.redo.pop();
    if (!value) return;
    state.undo.push(snapshot());
    restore(value);
    setDirty();
  }

  function nextId(prefix = 'node') {
    const used = new Set(nodes().map((node) => node.id));
    let index = 1;
    while (used.has(`${prefix}_${index}`)) index += 1;
    return `${prefix}_${index}`;
  }

  function parentOf(childId) {
    for (const node of nodes()) {
      const index = Array.isArray(node.children) ? node.children.indexOf(childId) : -1;
      if (index >= 0) return { node, index };
    }
    return null;
  }

  function descendants(id, out = new Set()) {
    const node = nodeById(id);
    for (const child of (node && Array.isArray(node.children) ? node.children : [])) {
      if (!out.has(child)) {
        out.add(child);
        descendants(child, out);
      }
    }
    return out;
  }

  function canConnect(parentId, childId) {
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

  function connect(parentId, childId, replaceIndex) {
    const error = canConnect(parentId, childId);
    if (error) { toast(error, true); return false; }
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
      if (!parent.cases.some((item) => item && item.child === childId)) parent.cases.push({ value: parent.cases.length, child: childId });
    }
    return true;
  }

  function disconnect(parentId, childId) {
    const parent = nodeById(parentId);
    if (!parent || !Array.isArray(parent.children)) return;
    const index = parent.children.indexOf(childId);
    if (index >= 0) parent.children.splice(index, 1);
    if (index >= 0 && parent.type === 'switch' && Array.isArray(parent.cases)) parent.cases = parent.cases.filter((item) => item && item.child !== childId);
  }

  function addNode(type, at) {
    const prefix = type === 'simple_parallel' ? 'parallel' : type === 'instance_parallel' ? 'instances' : type;
    const node = { id: nextId(prefix), type, children: [] };
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
    mutate(() => {
      nodes().push(node);
      const point = at || worldPoint({ clientX: wrap.clientWidth / 2, clientY: wrap.clientHeight / 2 });
      layout()[node.id] = { x: Math.round(point.x - NODE_W / 2), y: Math.round(point.y - BASE_H / 2) };
      state.selected = new Set([node.id]);
      state.selectedRun = null;
      state.inspector = 'node';
    });
  }

  function deleteSelection() {
    if (state.selectedEdge) {
      const { parent, child } = state.selectedEdge;
      mutate(() => disconnect(parent, child));
      state.selectedEdge = null;
      return;
    }
    const ids = [...state.selected].filter((id) => id !== state.raw.root && nodeById(id)?.type !== 'root');
    if (!ids.length) return;
    mutate(() => {
      state.raw.nodes = nodes().filter((node) => !ids.includes(node.id));
      for (const node of nodes()) if (Array.isArray(node.children)) node.children = node.children.filter((id) => !ids.includes(id));
      for (const id of ids) delete layout()[id];
      state.selected.clear();
      state.selectedRun = null;
    });
  }

  /** 收集选中节点及其全部子树（排除 root），返回 id 集合。 */
  function selectionTreeIds() {
    const ids = new Set();
    for (const id of state.selected) {
      if (id === state.raw.root || (nodeById(id)?.type === 'root')) continue;
      ids.add(id);
      for (const descendant of descendants(id)) ids.add(descendant);
    }
    return ids;
  }

  /** 把选中节点及其子树复制到内部剪贴板。 */
  function copySelection() {
    const ids = selectionTreeIds();
    if (ids.size === 0) { toast('请先选择要复制的节点', true); return false; }
    state.clipboard = clone(nodes().filter((node) => ids.has(node.id)));
    state.clipboardLayout = {};
    for (const id of ids) if (layout()[id]) state.clipboardLayout[id] = { ...layout()[id] };
    toast(`已复制 ${ids.size} 个节点`);
    return true;
  }

  /** 剪切：复制选中子树后从图中移除。 */
  function cutSelection() {
    const ids = selectionTreeIds();
    if (ids.size === 0) { toast('请先选择要剪切的节点', true); return false; }
    state.clipboard = clone(nodes().filter((node) => ids.has(node.id)));
    state.clipboardLayout = {};
    for (const id of ids) if (layout()[id]) state.clipboardLayout[id] = { ...layout()[id] };
    mutate(() => {
      state.raw.nodes = nodes().filter((node) => !ids.has(node.id));
      for (const node of nodes()) if (Array.isArray(node.children)) node.children = node.children.filter((id) => !ids.has(id));
      for (const id of ids) delete layout()[id];
      state.selected.clear();
    });
    toast(`已剪切 ${ids.size} 个节点`);
    return true;
  }

  /** 粘贴剪贴板内容：生成新 ID、重映射 children/refs、放置到目标位置（默认鼠标处）。 */
  function pasteClipboard(at) {
    if (!state.clipboard || state.clipboard.length === 0) { toast('剪贴板为空', true); return false; }
    const used = new Set(nodes().map((node) => node.id));
    const idMap = new Map();
    for (const src of state.clipboard) {
      const prefix = (src.id || 'node').replace(/_\d+$/, '') || 'node';
      let index = 1;
      let candidate = `${prefix}_${index}`;
      while (used.has(candidate)) { index += 1; candidate = `${prefix}_${index}`; }
      used.add(candidate);
      idMap.set(src.id, candidate);
    }
    // 以剪贴板内容的包围盒左上角为锚点，把整组移动到目标位置。
    const positions = Object.values(state.clipboardLayout || {});
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
      const created = [];
      const remap = (item) => {
        if (Array.isArray(item)) return item.forEach(remap);
        if (!item || typeof item !== 'object') return;
        if (typeof item.ref === 'string') {
          for (const [oldId, newId] of idMap) item.ref = item.ref.replace(`nodes.${oldId}.output.`, `nodes.${newId}.output.`);
        }
        Object.values(item).forEach(remap);
      };
      for (const src of state.clipboard) {
        const copy = clone(src);
        copy.id = idMap.get(src.id);
        if (Array.isArray(copy.children)) copy.children = copy.children.filter((id) => idMap.has(id)).map((id) => idMap.get(id));
        remap(copy);
        const base = state.clipboardLayout[src.id] || { x: 0, y: 0 };
        layout()[copy.id] = { x: base.x + dx, y: base.y + dy };
        nodes().push(copy);
        created.push(copy.id);
      }
      state.selected = new Set(created);
      state.selectedRun = null;
      state.inspector = 'node';
    });
    toast(`已粘贴 ${idMap.size} 个节点`);
    return true;
  }

  function autoLayout(record = true) {
    const run = () => {
      const map = new Map(nodes().map((node) => [node.id, node]));
      const placed = new Set();
      let leaf = 0;
      const xGap = 72;
      const yGap = 112;
      const place = (id, depth) => {
        const node = map.get(id);
        if (!node || placed.has(id)) return 0;
        placed.add(id);
        const children = Array.isArray(node.children) ? node.children.filter((child) => map.has(child)) : [];
        let x;
        if (!children.length) {
          x = leaf * (NODE_W + xGap);
          leaf += 1;
        } else {
          const values = children.map((child) => place(child, depth + 1));
          x = (values[0] + values[values.length - 1]) / 2;
        }
        layout()[id] = { x: Math.round(x), y: Math.round(depth * (BASE_H + yGap)) };
        return x;
      };
      if (state.raw.root) place(state.raw.root, 0);
      for (const node of nodes()) {
        if (!placed.has(node.id)) {
          layout()[node.id] = { x: leaf * (NODE_W + xGap), y: 0 };
          leaf += 1;
        }
      }
    };
    if (record) mutate(run); else run();
  }

  function ensureLayout() {
    const values = layout();
    if (nodes().some((node) => !values[node.id])) autoLayout(false);
  }

  function bounds() {
    if (!nodes().length) return { minX: 0, minY: 0, maxX: NODE_W, maxY: BASE_H };
    const points = nodes().map((node) => ({ node, pos: position(node) }));
    const runCards = instanceRunCards();
    const cards = variableCardList();
    return {
      minX: Math.min(...points.map((item) => item.pos.x), ...runCards.map((item) => item.x), ...cards.map((item) => item.x)),
      minY: Math.min(...points.map((item) => item.pos.y), ...cards.map((item) => item.y)),
      maxX: Math.max(...points.map((item) => item.pos.x + NODE_W), ...runCards.map((item) => item.x + RUN_CARD_W), ...cards.map((item) => item.x + VARIABLE_CARD_W)),
      maxY: Math.max(...points.map((item) => item.pos.y + nodeHeight(item.node)), ...runCards.map((item) => item.y + item.height), ...cards.map((item) => item.y + VARIABLE_CARD_H)),
    };
  }

  function fitView() {
    const rect = wrap.getBoundingClientRect();
    const box = bounds();
    const width = Math.max(1, box.maxX - box.minX + 160);
    const height = Math.max(1, box.maxY - box.minY + 160);
    const mini = $('minimap');
    const miniHeight = mini.getBoundingClientRect().height;
    const reservedBottom = miniHeight > 0 ? miniHeight + 24 : 0;
    const availableHeight = Math.max(1, rect.height - reservedBottom);
    state.zoom = Math.min(1.5, Math.max(0.25, Math.min(rect.width / width, availableHeight / height)));
    state.panX = (rect.width - (box.maxX - box.minX) * state.zoom) / 2 - box.minX * state.zoom;
    state.panY = (availableHeight - (box.maxY - box.minY) * state.zoom) / 2 - box.minY * state.zoom;
    render();
  }

  function zoomAt(factor, clientX, clientY) {
    const rect = wrap.getBoundingClientRect();
    const x = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const y = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    const next = Math.min(2.5, Math.max(0.25, state.zoom * factor));
    const ratio = next / state.zoom;
    state.panX = x - (x - state.panX) * ratio;
    state.panY = y - (y - state.panY) * ratio;
    state.zoom = next;
    render();
  }

  function worldPoint(event) {
    const rect = wrap.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - state.panX) / state.zoom,
      y: (event.clientY - rect.top - state.panY) / state.zoom,
    };
  }

  function bezier(x1, y1, x2, y2) {
    const bend = Math.max(48, Math.abs(y2 - y1) * 0.48);
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
  }

  function renderVariableEdges(layer) {
    const cards = new Map(variableCardList().map((card) => [card.id, card]));
    const byName = new Map();
    for (const card of variableCardList()) if (!byName.has(card.name)) byName.set(card.name, card);
    const links = state.raw && state.raw._variableLinks && typeof state.raw._variableLinks === 'object' ? state.raw._variableLinks : {};
    for (const node of nodes()) {
      const pos = position(node);
      nodeVariablePins(node).forEach((pin, index) => {
        if (!pin.variable) return;
        const card = cards.get(links[`${node.id}:${pin.param}`]) || byName.get(pin.variable);
        if (!card) return;
        const x1 = card.x + VARIABLE_CARD_W;
        const y1 = card.y + VARIABLE_CARD_PORT_Y;
        const x2 = pos.x + VARIABLE_PIN_X;
        const y2 = pos.y + BASE_H + index * RUN_VARIABLE_H + RUN_VARIABLE_H / 2;
        const bend = Math.max(32, Math.abs(x2 - x1) * 0.42);
        svgEl('path', { class: 'variable-edge', d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` }, layer);
      });
    }
  }

  function render() {
    if (!state.raw) return;
    ensureLayout();
    const migratedPublic = syncLegacyPublicParameters();
    const migratedCards = syncLegacyVariableCards();
    if (migratedPublic || migratedCards) setDirty(true);
    graph.innerHTML = '';
    const root = svgEl('g', { class: 'graph-world', transform: `translate(${state.panX},${state.panY}) scale(${state.zoom})` }, graph);
    const wires = svgEl('g', { class: 'wires' }, root);
    for (const parent of nodes()) {
      const children = Array.isArray(parent.children) ? parent.children : [];
      children.forEach((childId, order) => renderEdge(wires, parent, childId, order));
    }
    const runCards = instanceRunCards();
    runCards.forEach((card) => renderInstanceRunEdge(wires, card));
    if (state.connect) renderConnection(wires);
    const variableEdges = svgEl('g', { class: 'variable-edges' }, root);
    renderVariableEdges(variableEdges);
    const cards = svgEl('g', { class: 'cards' }, root);
    nodes().forEach((node) => renderNode(cards, node));
    runCards.forEach((card) => renderInstanceRunCard(cards, card));
    const variableLayer = svgEl('g', { class: 'variable-cards' }, root);
    variableCardList().forEach((card) => renderVariableCard(variableLayer, card));
    if (state.variableConnect) renderVariableConnection(variableLayer);
    if (state.marquee) {
      const box = state.marquee;
      svgEl('rect', { class: 'marquee', x: Math.min(box.x1, box.x2), y: Math.min(box.y1, box.y2), width: Math.abs(box.x2 - box.x1), height: Math.abs(box.y2 - box.y1) }, root);
    }
    $('zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
    updateIssueBadge();
    renderMinimap();
    renderInspector();
    postSidebarState();
  }

  /** 把画布视野中心移到指定节点（搜索定位与结构树窗口共用）。 */
  function focusNode(id) {
    const node = nodeById(id);
    if (!node) return;
    const pos = position(node);
    const rect = wrap.getBoundingClientRect();
    state.panX = rect.width / 2 - (pos.x + NODE_W / 2) * state.zoom;
    state.panY = rect.height / 2 - (pos.y + nodeHeight(node) / 2) * state.zoom;
    render();
  }

  function renderEdge(layer, parent, childId, order) {
    const child = nodeById(childId);
    if (!child) return;
    const from = position(parent);
    const to = position(child);
    const x1 = from.x + NODE_W / 2;
    const y1 = from.y + nodeHeight(parent);
    const x2 = to.x + NODE_W / 2;
    const y2 = to.y;
    const selected = state.selectedEdge && state.selectedEdge.parent === parent.id && state.selectedEdge.child === childId;
    const run = state.run.get(childId);
    const runStatus = run && ['running', 'succeeded', 'matched', 'failed', 'not_matched', 'branch_miss', 'cancelled'].includes(run.status) ? run.status : '';
    const group = svgEl('g', { class: `edge${selected ? ' selected' : ''}${runStatus ? ` run-${runStatus}` : ''}`, 'data-parent': parent.id, 'data-child': childId }, layer);
    group.dataset.parent = parent.id;
    group.dataset.child = childId;
    const path = svgEl('path', { class: 'edge-hit', d: bezier(x1, y1, x2, y2) }, group);
    const edgePath = bezier(x1, y1, x2, y2);
    svgEl('path', { class: 'edge-line', d: edgePath }, group);
    svgEl('path', { class: 'edge-flow', d: edgePath }, group);
    const midY = (y1 + y2) / 2;
    svgEl('circle', { class: 'edge-order-bg', cx: (x1 + x2) / 2, cy: midY, r: 10 }, group);
    svgEl('text', { class: 'edge-order', x: (x1 + x2) / 2, y: midY + 4, 'text-anchor': 'middle' }, group).textContent = String(order + 1);
    const rewire = svgEl('circle', { class: 'edge-rewire', cx: x2, cy: y2 - 18, r: 6, title: '拖动以重新连接' }, group);
    path.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      state.selected.clear();
      state.selectedEdge = { parent: parent.id, child: childId };
      state.selectedRun = null;
      state.inspector = 'node';
      requestInspector({ kind: 'edge', parent: parent.id, child: childId });
      render();
    });
    group.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      mutate(() => disconnect(parent.id, childId));
    });
    rewire.addEventListener('pointerdown', (event) => {
      event.preventDefault(); event.stopPropagation();
      const point = worldPoint(event);
      state.connect = { direction: 'from-output', parent: parent.id, x: point.x, y: point.y, oldChild: childId, oldIndex: order, hover: null, pointerId: captureConnectionPointer(event) };
      render();
    });
  }

  function renderInstanceRunEdge(layer, card) {
    const parent = position(card.node);
    const x1 = parent.x + NODE_W / 2;
    const y1 = parent.y + nodeHeight(card.node);
    const x2 = card.x + RUN_CARD_W / 2;
    const y2 = card.y;
    const path = bezier(x1, y1, x2, y2);
    const group = svgEl('g', { class: 'instance-run-edge', 'data-run-key': card.key }, layer);
    svgEl('path', { class: 'instance-run-edge-line', d: path }, group);
    const midY = (y1 + y2) / 2;
    svgEl('circle', { class: 'edge-order-bg', cx: (x1 + x2) / 2, cy: midY, r: 10 }, group);
    svgEl('text', { class: 'edge-order', x: (x1 + x2) / 2, y: midY + 4, 'text-anchor': 'middle' }, group).textContent = String(card.index + 1);
  }

  function renderConnection(layer) {
    const classes = `connection-preview${state.connect.hover ? ' snapped' : ''}`;
    if (state.connect.direction === 'from-input') {
      const child = nodeById(state.connect.child);
      if (!child) return;
      const pos = position(child);
      svgEl('path', { class: classes, d: bezier(state.connect.x, state.connect.y, pos.x + NODE_W / 2, pos.y) }, layer);
      return;
    }
    const parent = nodeById(state.connect.parent);
    if (!parent) return;
    const pos = position(parent);
    svgEl('path', { class: classes, d: bezier(pos.x + NODE_W / 2, pos.y + nodeHeight(parent), state.connect.x, state.connect.y) }, layer);
  }

  function templatePreview(node) {
    if (!node || node.type !== 'task' || !['vision.match_template', 'vision.wait_template'].includes(node.action)) return null;
    let value = node.params && node.params.template;
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string' && value.ref.startsWith('blackboard.')) {
      const definition = state.raw && state.raw.blackboard && state.raw.blackboard[value.ref.slice('blackboard.'.length)];
      value = definition && typeof definition === 'object' && Object.prototype.hasOwnProperty.call(definition, 'default')
        ? definition.default
        : '';
    }
    if (typeof value !== 'string' || !state.assetsBaseUri) return null;
    const path = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = path.split('/');
    if (parts[0] !== 'assets' || parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..')) return null;
    return {
      path,
      uri: `${state.assetsBaseUri}${parts.slice(1).map((part) => encodeURIComponent(part)).join('/')}`,
    };
  }

  function renderNodePreview(group, preview, className, preserveAspectRatio, onOpen) {
    const frame = svgEl('rect', { class: 'node-preview-frame', x: PREVIEW.x, y: PREVIEW.y, width: PREVIEW.width, height: PREVIEW.height, rx: 3 }, group);
    const image = svgEl('image', {
      class: `node-preview-image ${className}`,
      href: preview.uri,
      x: PREVIEW.x + 1,
      y: PREVIEW.y + 1,
      width: PREVIEW.width - 2,
      height: PREVIEW.height - 2,
      preserveAspectRatio,
      'data-template-path': preview.path || undefined,
    }, group);
    const stop = (event) => event.stopPropagation();
    image.addEventListener('mousedown', stop);
    image.addEventListener('pointerdown', stop);
    image.addEventListener('click', (event) => { event.stopPropagation(); openLightbox(onOpen || preview.uri); });
    image.addEventListener('error', () => { image.remove(); frame.remove(); });
    const title = svgEl('title', {}, image); title.textContent = preview.path || '运行截图';
  }

  function renderNode(layer, node) {
    const pos = position(node);
    const height = nodeHeight(node);
    const run = state.run.get(node.id);
    const subRef = subWorkflowRef(node);
    const template = templatePreview(node);
    const classes = ['node', `type-${node.type}`];
    if (subRef) classes.push('node-subworkflow');
    if (state.selected.has(node.id)) classes.push('selected');
    if (state.connect && state.connect.hover === node.id) classes.push('connect-hover');
    if (state.variableConnect && state.variableConnect.hover && state.variableConnect.hover.nodeId === node.id) classes.push('connect-hover');
    if (run && run.status) classes.push(`run-${run.status}`);
    const group = svgEl('g', { class: classes.join(' '), transform: `translate(${pos.x},${pos.y})`, 'data-id': node.id }, layer);
    group.dataset.id = node.id;
    const body = svgEl('rect', { class: 'node-box', width: NODE_W, height, rx: 4 }, group);
    const head = svgEl('rect', { class: 'node-head', x: 1, y: 3, width: NODE_W - 2, height: 36, rx: 3 }, group);
    svgEl('rect', { class: 'node-accent', width: NODE_W, height: 3, rx: 2 }, group);
    svgEl('line', { class: 'node-header-rule', x1: 1, y1: 39, x2: NODE_W - 1, y2: 39 }, group);
    const iconPlate = svgEl('rect', { class: 'node-icon-plate', x: 10, y: 10, width: 22, height: 22, rx: 3 }, group);
    svgEl('text', { class: 'node-icon', x: 21, y: 26, 'text-anchor': 'middle' }, group).textContent = TYPE_ICON[node.type] || '•';
    const hasRunStatus = Boolean(run && run.status);
    svgEl('text', { class: 'node-name', x: 41, y: 20 }, group).textContent = compactValue(node.name || node.id, hasRunStatus ? 10 : 16);
    svgEl('text', { class: 'node-type', x: 41, y: 32 }, group).textContent = TYPE_LABEL[node.type] || node.type;
    if (hasRunStatus) {
      svgEl('rect', { class: 'run-badge', x: NODE_W - 76, y: 10, width: 66, height: 22, rx: 3 }, group);
      svgEl('circle', { class: 'run-dot', cx: NODE_W - 65, cy: 21, r: 3.5 }, group);
      svgEl('text', { class: 'run-label', x: NODE_W - 15, y: 25, 'text-anchor': 'end' }, group).textContent = RUN_LABEL[run.status] || run.status;
      const title = svgEl('title', {}, group);
      title.textContent = [RUN_LABEL[run.status] || run.status, run.error].filter(Boolean).join('：');
    }
    const subtitle = node.type === 'task'
      ? (subRef ? `↳ ${subRef.split(/[\\/]/).pop()}` : (node.action || '未选择 Action'))
      : compositeSubtitle(node);
    svgEl('text', { class: 'node-field-label', x: 14, y: 55 }, group).textContent = node.type === 'task' ? 'ACTION' : 'FLOW';
    svgEl('text', { class: 'node-subtitle', x: 14, y: 71 }, group).textContent = compactValue(subtitle, template || (run && run.thumbnail) ? 13 : 22);
    svgEl('text', { class: 'node-meta', x: 14, y: 87 }, group).textContent = compactValue(`ID  ${node.id}`, template || (run && run.thumbnail) ? 14 : 18);
    if (run && run.thumbnail) {
      const uri = run.thumbnail.startsWith('data:') ? run.thumbnail : `data:image/png;base64,${run.thumbnail}`;
      renderNodePreview(group, { uri, path: '' }, 'step-thumb', 'xMidYMid slice', run.screenshot || uri);
    } else if (template) renderNodePreview(group, template, 'template-thumb', 'xMidYMid meet');
    else if (run && Number.isFinite(run.duration)) svgEl('text', { class: 'node-duration', x: NODE_W - 12, y: 87, 'text-anchor': 'end' }, group).textContent = `${run.duration} ms`;
    const pins = nodeVariablePins(node);
    const pinOffset = pins.length * RUN_VARIABLE_H;
    pins.forEach((pin, index) => {
      const y = BASE_H + index * RUN_VARIABLE_H;
      svgEl('line', { class: 'instance-variable-rule', x1: 0, y1: y, x2: NODE_W, y2: y }, group);
      svgEl('circle', { class: `port port-variable type-${pin.type}`, cx: VARIABLE_PIN_X, cy: y + RUN_VARIABLE_H / 2, r: 5.5 }, group);
      svgEl('text', { class: 'pin-variable-name', x: 21, y: y + 16 }, group).textContent = compactValue(pin.variable || pin.label || '未绑定', 14);
      svgEl('text', { class: 'pin-variable-param', x: NODE_W - 10, y: y + 16, 'text-anchor': 'end' }, group).textContent = compactValue(pin.label || pin.param, 14);
      const hit = svgEl('circle', { class: 'variable-port-hit', cx: VARIABLE_PIN_X, cy: y + RUN_VARIABLE_H / 2, r: 10, 'data-node': node.id, 'data-param': pin.param }, group);
      hit.addEventListener('pointerdown', (event) => startVariableConnectionFromPin(event, node.id, pin.param));
    });
    const decorators = Array.isArray(node.decorators) ? node.decorators : [];
    decorators.forEach((decorator, index) => {
      const y = BASE_H + pinOffset + index * DECO_H;
      svgEl('line', { class: 'decorator-rule', x1: 0, y1: y, x2: NODE_W, y2: y }, group);
      svgEl('text', { class: 'decorator-icon', x: 14, y: y + 15 }, group).textContent = '◇';
      svgEl('text', { class: 'decorator-label', x: 32, y: y + 15 }, group).textContent = decoratorLabel(decorator);
    });
    if (node.type !== 'root') {
      const input = svgEl('circle', { class: 'port port-in', cx: NODE_W / 2, cy: 0, r: PORT_R, 'data-node': node.id }, group);
      input.addEventListener('pointerdown', (event) => startConnectionFromInput(event, node.id));
    }
    if (node.type !== 'task') {
      const output = svgEl('circle', { class: 'port port-out', cx: NODE_W / 2, cy: height, r: PORT_R, 'data-node': node.id }, group);
      output.addEventListener('pointerdown', (event) => startConnection(event, node.id));
    }
    const handleNodeMouseDown = (event) => {
      if (event.button !== 0) { startNodeDrag(event, node.id); return; }
      requestInspector({ kind: 'node', nodeId: node.id });
      const now = Date.now();
      const sameNode = lastClickNode === node.id;
      const nearby = Math.abs(event.clientX - lastClickX) < 8 && Math.abs(event.clientY - lastClickY) < 8;
      const isDouble = now - lastClickTime < 300 && sameNode && nearby;
      lastClickTime = now; lastClickNode = node.id; lastClickX = event.clientX; lastClickY = event.clientY;
      if (isDouble) {
        event.preventDefault(); event.stopPropagation();
        if (subRef) { requestOpenSubWorkflow(node.id); return; }
        state.selected = new Set([node.id]); state.selectedRun = null; state.inspector = 'node'; render();
        return;
      }
      startNodeDrag(event, node.id);
    };
    [body, head, iconPlate].forEach((surface) => surface.addEventListener('mousedown', handleNodeMouseDown));
    if (subRef) {
      // 子流程节点右键菜单：直接进入子工作流视图
      body.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (contextMenuSuppressedByPan()) return;
        state.selected = new Set([node.id]); state.selectedRun = null; render();
        showMenu(event.clientX, event.clientY, [
          { label: '进入子工作流视图', run: () => requestOpenSubWorkflow(node.id) },
          'separator',
          { label: '复制 (Ctrl+C)', run: () => copySelection() },
          { label: '剪切 (Ctrl+X)', run: () => cutSelection() },
          { label: '删除节点', danger: true, run: () => deleteSelection() },
        ]);
      });
    }
  }

  function compactValue(value, max = 24) {
    let text;
    if (value === undefined) text = '未传值';
    else if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string') text = `← ${value.ref.replace(/^blackboard\./, '')}`;
    else if (typeof value === 'string') text = value;
    else {
      try { text = JSON.stringify(value); } catch { text = String(value); }
    }
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function workflowInputVariableValue(holder, variable) {
    const inputs = holder && holder.inputs && typeof holder.inputs === 'object' && !Array.isArray(holder.inputs) ? holder.inputs : {};
    if (Object.prototype.hasOwnProperty.call(inputs, variable.name)) return compactValue(inputs[variable.name]);
    if (Object.prototype.hasOwnProperty.call(variable.definition, 'default')) return `默认 ${compactValue(variable.definition.default, 18)}`;
    return variable.definition.required ? '需要传值' : '未传值';
  }

  function renderInstanceRunCard(layer, card) {
    const selected = state.selectedRun && state.selectedRun.nodeId === card.node.id && state.selectedRun.index === card.index;
    const group = svgEl('g', {
      class: `instance-run-card${selected ? ' selected' : ''}`,
      transform: `translate(${card.x},${card.y})`,
      'data-run-key': card.key,
    }, layer);
    group.dataset.runKey = card.key;
    const body = svgEl('rect', { class: 'instance-run-card-box', width: RUN_CARD_W, height: card.height, rx: 4 }, group);
    svgEl('rect', { class: 'instance-run-card-head', x: 1, y: 3, width: RUN_CARD_W - 2, height: 34, rx: 3 }, group);
    svgEl('rect', { class: 'instance-run-card-accent', width: RUN_CARD_W, height: 3, rx: 2 }, group);
    svgEl('line', { class: 'instance-run-card-header-rule', x1: 1, y1: 37, x2: RUN_CARD_W - 1, y2: 37 }, group);
    svgEl('rect', { class: 'instance-run-card-icon-plate', x: 10, y: 9, width: 22, height: 22, rx: 3 }, group);
    svgEl('text', { class: 'instance-run-card-icon', x: 21, y: 25, 'text-anchor': 'middle' }, group).textContent = '▣';
    svgEl('text', { class: 'instance-run-card-instance', x: 41, y: 19 }, group).textContent = compactValue(card.run.instance || '未选择实例', 16);
    svgEl('text', { class: 'instance-run-card-type', x: 41, y: 31 }, group).textContent = 'CHILD WORKFLOW';
    const workflowName = String(card.run.workflow || '未选择工作流').split(/[\\/]/).pop();
    svgEl('text', { class: 'instance-run-card-field-label', x: 14, y: 53 }, group).textContent = 'WORKFLOW';
    svgEl('text', { class: 'instance-run-card-workflow', x: 14, y: 69 }, group).textContent = compactValue(workflowName, 22);
    card.variables.forEach((variable, variableIndex) => {
      const y = RUN_CARD_BASE_H + variableIndex * RUN_VARIABLE_H;
      svgEl('line', { class: 'instance-variable-rule', x1: 0, y1: y, x2: RUN_CARD_W, y2: y }, group);
      svgEl('circle', { class: `instance-variable-pin type-${variable.definition.type || 'any'}`, cx: 10, cy: y + RUN_VARIABLE_H / 2, r: 5 }, group);
      svgEl('text', { class: 'instance-variable-name', x: 21, y: y + 16 }, group).textContent = compactValue(variable.name, 15);
      svgEl('text', { class: 'instance-variable-value', x: RUN_CARD_W - 10, y: y + 16, 'text-anchor': 'end' }, group).textContent = workflowInputVariableValue(card.run, variable);
    });
    const input = svgEl('circle', { class: 'port port-in instance-run-port', cx: RUN_CARD_W / 2, cy: 0, r: PORT_R }, group);
    input.style.pointerEvents = 'none';
    body.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const clickKey = `run:${card.key}`;
      const now = Date.now();
      const nearby = Math.abs(event.clientX - lastClickX) < 8 && Math.abs(event.clientY - lastClickY) < 8;
      const isDouble = now - lastClickTime < 300 && lastClickNode === clickKey && nearby;
      lastClickTime = now; lastClickNode = clickKey; lastClickX = event.clientX; lastClickY = event.clientY;
      state.selected.clear(); state.selectedEdge = null;
      state.selectedRun = { nodeId: card.node.id, index: card.index };
      state.inspector = 'node';
      requestInspector({ kind: 'run', nodeId: card.node.id, index: card.index });
      if (isDouble && card.run.workflow) requestOpenWorkflowReference(card.run.workflow);
      else render();
    });
    body.addEventListener('contextmenu', (event) => {
      event.preventDefault(); event.stopPropagation();
      if (contextMenuSuppressedByPan()) return;
      state.selected.clear(); state.selectedEdge = null;
      state.selectedRun = { nodeId: card.node.id, index: card.index };
      render();
      const items = [];
      if (card.run.workflow) items.push({ label: '进入子工作流视图', run: () => requestOpenWorkflowReference(card.run.workflow) }, 'separator');
      items.push({ label: '删除实例运行项', danger: true, run: () => removeInstanceRun(card.node, card.index) });
      showMenu(event.clientX, event.clientY, items);
    });
  }

  function renderVariableCard(layer, card) {
    const definition = (state.raw.blackboard && state.raw.blackboard[card.name]) || {};
    const type = definition.type || 'any';
    const selected = state.inspector === 'variables' && state.selectedVariable === card.name;
    const targeted = state.variableConnect && state.variableConnect.direction === 'from-pin'
      && state.variableConnect.hover && state.variableConnect.hover.card === card.name;
    const group = svgEl('g', {
      class: `variable-card type-${type}${selected ? ' selected' : ''}${targeted ? ' connect-target' : ''}`,
      transform: `translate(${card.x},${card.y})`,
      'data-variable': card.name,
    }, layer);
    group.dataset.variable = card.name;
    const body = svgEl('rect', { class: 'variable-card-box', width: VARIABLE_CARD_W, height: VARIABLE_CARD_H, rx: 4 }, group);
    svgEl('rect', { class: 'variable-card-head', x: 1, y: 3, width: VARIABLE_CARD_W - 2, height: 30, rx: 3 }, group);
    svgEl('rect', { class: 'variable-card-accent', width: VARIABLE_CARD_W, height: 3, rx: 2 }, group);
    svgEl('line', { class: 'variable-card-header-rule', x1: 1, y1: 33, x2: VARIABLE_CARD_W - 1, y2: 33 }, group);
    svgEl('circle', { class: `variable-card-dot type-${type}`, cx: 15, cy: 18, r: 4.5 }, group);
    svgEl('text', { class: 'variable-card-name', x: 28, y: 21 }, group).textContent = compactValue(card.name, 9);
    svgEl('text', { class: 'variable-card-type', x: VARIABLE_CARD_W - 10, y: 20, 'text-anchor': 'end' }, group).textContent = String(type).toUpperCase();
    svgEl('text', { class: 'variable-card-access', x: 12, y: 50 }, group).textContent = definition.public !== false ? 'PUBLIC' : 'PRIVATE';
    svgEl('text', { class: 'variable-card-value', x: VARIABLE_CARD_W - 12, y: 50, 'text-anchor': 'end' }, group).textContent = variableValueSummary(definition);
    svgEl('circle', { class: `port port-variable-out type-${type}`, cx: VARIABLE_CARD_W, cy: VARIABLE_CARD_PORT_Y, r: PORT_R }, group);
    const port = svgEl('circle', { class: 'variable-port-hit', cx: VARIABLE_CARD_W, cy: VARIABLE_CARD_PORT_Y, r: 10, 'data-variable': card.name }, group);
    port.addEventListener('pointerdown', (event) => startVariableConnectionFromCard(event, card.name, card.id));
    body.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      state.selected.clear(); state.selectedEdge = null; state.selectedRun = null;
      state.selectedVariable = card.name;
      state.inspector = 'variables';
      const point = worldPoint(event);
      state.drag = { kind: 'variable-card', id: card.id, name: card.name, start: point, origin: { x: card.x, y: card.y }, before: snapshot(), moved: false };
      render();
    });
    body.addEventListener('contextmenu', (event) => {
      event.preventDefault(); event.stopPropagation();
      if (contextMenuSuppressedByPan()) return;
      state.selected.clear(); state.selectedEdge = null; state.selectedRun = null;
      state.selectedVariable = card.name;
      state.inspector = 'variables';
      render();
      showMenu(event.clientX, event.clientY, [
        { label: '删除变量卡片', run: () => removeVariableCard(card.id) },
      ]);
    });
  }

  function variableValueSummary(definition) {
    if (definition && Object.prototype.hasOwnProperty.call(definition, 'default')) return compactValue(definition.default, 10);
    if (definition && definition.required === true) return '必填';
    return '未设默认';
  }

  function removeVariableCard(id) {
    if (!Object.prototype.hasOwnProperty.call(variableCards(), id)) return;
    mutate(() => {
      delete variableCards()[id];
      for (const [key, cardId] of Object.entries(variableLinks())) if (cardId === id) delete variableLinks()[key];
    });
  }

  /** 把变量卡片放到指定世界坐标；若附近有兼容端点则吸附到端点旁并建立绑定。 */
  function placeVariableCard(name, point, options = {}) {
    if (!state.raw.blackboard || typeof state.raw.blackboard !== 'object' || Array.isArray(state.raw.blackboard)) return;
    if (!Object.prototype.hasOwnProperty.call(state.raw.blackboard, name)) { toast(`变量 ${name} 不存在`, true); return; }
    const target = options.connect === false ? null : variablePinTargetAt(point, name);
    mutate(() => {
      const cards = variableCards();
      const cardId = nextVariableCardId();
      if (target) {
        const node = nodeById(target.nodeId);
        const pos = position(node);
        const left = pos.x - VARIABLE_CARD_W - 56;
        const x = left >= 24 ? left : pos.x + NODE_W + 56;
        cards[cardId] = { name, x: Math.round(x / 8) * 8, y: Math.max(24, Math.round((target.y - VARIABLE_CARD_PORT_Y) / 8) * 8) };
        variableLinks()[`${target.nodeId}:${target.param}`] = cardId;
        if (target.param.startsWith('inputs.')) {
          if (!node.params.inputs || typeof node.params.inputs !== 'object' || Array.isArray(node.params.inputs)) node.params.inputs = {};
          node.params.inputs[target.param.slice('inputs.'.length)] = { ref: `blackboard.${name}` };
        } else node.params[target.param] = { ref: `blackboard.${name}` };
      } else {
        cards[cardId] = { name, x: Math.round((point.x - VARIABLE_CARD_W / 2) / 8) * 8, y: Math.round((point.y - VARIABLE_CARD_PORT_Y) / 8) * 8 };
      }
    });
    if (target) toast(`已连接 参数 ${target.param} ← 变量 ${name}`);
    else toast(`已添加变量卡片 ${name}`);
  }

  /** 编辑器命令入口：在鼠标处（或视野中心）创建变量卡片。 */
  function addVariableCardCommand(name) {
    const variableName = String(name ?? '').trim();
    if (!variableName) return;
    if (!state.raw.blackboard || !Object.prototype.hasOwnProperty.call(state.raw.blackboard, variableName)) { toast(`变量 ${variableName} 不存在`, true); return; }
    if (!wrap.clientWidth || !wrap.clientHeight) return;
    const rect = wrap.getBoundingClientRect();
    const point = state.mouse || { x: (rect.width / 2 - state.panX) / state.zoom, y: (rect.height / 2 - state.panY) / state.zoom };
    placeVariableCard(variableName, point, { connect: false });
  }

  /** 若节点是子流程 task（workflow.run），返回子工作流引用，否则返回空字符串。 */
  function subWorkflowRef(node) {
    if (!node || node.type !== 'task' || node.action !== 'workflow.run') return '';
    const value = node.params && typeof node.params.workflow === 'string' ? node.params.workflow : '';
    return value.trim();
  }

  /** 请求打开子工作流视图；当前有未保存修改时先询问保存/放弃。 */
  function requestOpenSubWorkflow(nodeId) {
    const node = nodeById(nodeId);
    requestOpenWorkflowReference(subWorkflowRef(node), nodeId);
  }

  function requestOpenWorkflowReference(reference, nodeId = '') {
    if (!reference) return;
    const doOpen = (saveText) => vscode.postMessage({ type: 'openSubWorkflow', nodeId, reference, saveText });
    if (state.dirty) {
      const rect = $('workflow-select').getBoundingClientRect();
      showMenu(rect.left, rect.bottom + 4, [
        { label: '保存并进入子工作流', run: () => doOpen(JSON.stringify(state.raw, null, 2) + '\n') },
        { label: '放弃修改并进入', run: () => doOpen(undefined) },
        'separator',
        { label: '取消', run: () => {} },
      ]);
    } else {
      doOpen(undefined);
    }
  }

  function compositeSubtitle(node) {
    const count = Array.isArray(node.children) ? node.children.length : 0;
    if (node.type === 'root') return count ? 'Tree Root' : '等待连接';
    if (node.type === 'simple_parallel') return `${count}/2 · ${node.finish_mode === 'wait_for_background' ? '等待后台' : '中止后台'}`;
    if (node.type === 'instance_parallel') {
      const runs = Array.isArray(node.runs) ? node.runs : [];
      return `${runs.length} 个实例 · ${node.wait_for === 'any' ? '任一完成' : '全部完成'}`;
    }
    return `${count} 个有序子节点`;
  }

  function decoratorLabel(decorator) {
    if (!decorator) return 'Decorator';
    if (decorator.type === 'condition') return `Condition · ${conditionSummary(decorator.expression)}`;
    if (decorator.type === 'cooldown') return `Cooldown · ${decorator.seconds}s`;
    if (decorator.type === 'timeout') return `Time Limit · ${decorator.seconds}s`;
    if (decorator.type === 'retry') return `Retry · ${decorator.attempts} 次`;
    if (decorator.type === 'repeat') return `Repeat · ${decorator.count} 次`;
    if (decorator.type === 'do_once') return `Do Once · ${decorator.reset_on_failure ? '成功才锁定' : '整个运行只执行一次'}`;
    return String(decorator.type || 'Decorator');
  }

  function conditionSummary(expression) {
    if (typeof expression === 'boolean') return expression ? 'True' : 'False';
    if (!expression || typeof expression !== 'object') return '未配置';
    const key = Object.keys(expression)[0];
    return key ? key.toUpperCase() : '未配置';
  }

  function startConnection(event, parentId) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const point = worldPoint(event);
    state.connect = { direction: 'from-output', parent: parentId, x: point.x, y: point.y, hover: null, pointerId: captureConnectionPointer(event) };
    state.selectedEdge = null;
    render();
  }

  function startConnectionFromInput(event, childId) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const point = worldPoint(event);
    state.connect = { direction: 'from-input', child: childId, x: point.x, y: point.y, hover: null, pointerId: captureConnectionPointer(event) };
    state.selectedEdge = null;
    render();
  }

  function captureConnectionPointer(event) {
    if (!Number.isInteger(event.pointerId)) return null;
    try { graph.setPointerCapture(event.pointerId); } catch { /* Synthetic tests may not own an active pointer. */ }
    return event.pointerId;
  }

  function releaseConnectionPointer(pointerId) {
    if (!Number.isInteger(pointerId)) return;
    try { graph.releasePointerCapture(pointerId); } catch { /* Capture may already be released. */ }
  }

  function cancelConnection() {
    if (!state.connect) return;
    const pointerId = state.connect.pointerId;
    state.connect = null;
    releaseConnectionPointer(pointerId);
    render();
  }

  function finishConnection(event, childId) {
    if (!state.connect) return;
    event.preventDefault(); event.stopPropagation();
    const connection = state.connect;
    state.connect = null;
    releaseConnectionPointer(connection.pointerId);
    const before = snapshot();
    mutate(() => {
      if (connection.direction === 'from-input') {
        connect(childId, connection.child);
        return;
      }
      if (connection.oldChild) disconnect(connection.parent, connection.oldChild);
      if (!connect(connection.parent, childId, connection.oldIndex) && connection.oldChild) connect(connection.parent, connection.oldChild, connection.oldIndex);
    });
    if (snapshot() === before) render();
  }

  function connectionTargetAt(event) {
    if (!state.connect || !event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const point = worldPoint(event);
    const maxDistance = Math.max(PORT_R + 6, 24 / state.zoom);
    let best = null;
    let bestDistance = maxDistance;
    for (const node of nodes()) {
      const wantsOutput = state.connect.direction === 'from-input';
      if ((wantsOutput && node.type === 'task') || (!wantsOutput && node.type === 'root')) continue;
      if ((wantsOutput && node.id === state.connect.child) || (!wantsOutput && node.id === state.connect.parent)) continue;
      const pos = position(node);
      const x = pos.x + NODE_W / 2;
      const y = wantsOutput ? pos.y + nodeHeight(node) : pos.y;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= bestDistance) { best = node.id; bestDistance = distance; }
    }
    return best;
  }

  /** 变量连线拖拽中，光标附近类型兼容的节点端点（变量卡片 → 节点）。 */
  function variablePinTargetAt(point, variableName) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const maxDistance = Math.max(PORT_R + 8, 32 / state.zoom);
    let best = null;
    let bestDistance = maxDistance;
    for (const node of nodes()) {
      const pins = nodeVariablePins(node);
      if (!pins.length) continue;
      const pos = position(node);
      pins.forEach((pin, index) => {
        if (!variableCompatibleWithPin(variableName, node, pin.param)) return;
        const x = pos.x + VARIABLE_PIN_X;
        const y = pos.y + BASE_H + index * RUN_VARIABLE_H + RUN_VARIABLE_H / 2;
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance <= bestDistance) { best = { nodeId: node.id, param: pin.param, x, y }; bestDistance = distance; }
      });
    }
    if (best) return best;
    // 落在节点卡片本体上时，自动接到第一个类型兼容的参数端点（不必精确捏住引脚）。
    for (const node of nodes()) {
      const pos = position(node);
      if (point.x < pos.x || point.x > pos.x + NODE_W || point.y < pos.y || point.y > pos.y + nodeHeight(node)) continue;
      const pins = nodeVariablePins(node);
      const index = pins.findIndex((pin) => variableCompatibleWithPin(variableName, node, pin.param));
      if (index < 0) continue;
      return { nodeId: node.id, param: pins[index].param, x: pos.x + VARIABLE_PIN_X, y: pos.y + BASE_H + index * RUN_VARIABLE_H + RUN_VARIABLE_H / 2 };
    }
    return null;
  }

  /** 变量连线拖拽中，光标附近的变量卡片（节点端点 → 变量卡片）。 */
  function variableCardTargetAt(point, nodeId, param) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const node = nodeById(nodeId);
    const maxDistance = Math.max(PORT_R + 8, 32 / state.zoom);
    let best = null;
    let bestDistance = maxDistance;
    for (const card of variableCardList()) {
      if (!variableCompatibleWithPin(card.name, node, param)) continue;
      const x = card.x + VARIABLE_CARD_W;
      const y = card.y + VARIABLE_CARD_PORT_Y;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= bestDistance) { best = { card: card.name, cardId: card.id, x, y }; bestDistance = distance; }
    }
    if (best) return best;
    // 落在卡片本体上时也视为连到该变量（允许重复连接当前变量，作为成功反馈）。
    for (const card of variableCardList()) {
      if (!variableCompatibleWithPin(card.name, node, param)) continue;
      if (point.x >= card.x && point.x <= card.x + VARIABLE_CARD_W && point.y >= card.y && point.y <= card.y + VARIABLE_CARD_H) {
        return { card: card.name, cardId: card.id, x: card.x + VARIABLE_CARD_W, y: card.y + VARIABLE_CARD_PORT_Y };
      }
    }
    return null;
  }

  function variableConnectionTargetAt(event) {
    if (!state.variableConnect || !event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const point = worldPoint(event);
    return state.variableConnect.direction === 'from-card'
      ? variablePinTargetAt(point, state.variableConnect.variable)
      : variableCardTargetAt(point, state.variableConnect.nodeId, state.variableConnect.param);
  }

  function startVariableConnectionFromCard(event, name, cardId) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const point = worldPoint(event);
    state.variableConnect = { direction: 'from-card', variable: name, cardId, x: point.x, y: point.y, hover: null, pointerId: captureConnectionPointer(event) };
    state.selectedEdge = null;
    render();
  }

  function startVariableConnectionFromPin(event, nodeId, param) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const point = worldPoint(event);
    state.variableConnect = { direction: 'from-pin', nodeId, param, x: point.x, y: point.y, hover: null, pointerId: captureConnectionPointer(event) };
    state.selectedEdge = null;
    render();
  }

  function cancelVariableConnection() {
    if (!state.variableConnect) return;
    const pointerId = state.variableConnect.pointerId;
    state.variableConnect = null;
    releaseConnectionPointer(pointerId);
    render();
  }

  function finishVariableConnection(event) {
    if (!state.variableConnect) return;
    event.preventDefault(); event.stopPropagation();
    const connection = state.variableConnect;
    const target = variableConnectionTargetAt(event) || connection.hover;
    state.variableConnect = null;
    releaseConnectionPointer(connection.pointerId);
    if (!target) { render(); return; }
    if (connection.direction === 'from-card') connectVariableToPin(connection.variable, target.nodeId, target.param, connection.cardId);
    else connectVariableToPin(target.card, connection.nodeId, connection.param, target.cardId);
  }

  /** 用变量绑定节点参数端点（等价于把该参数接到对应变量）。 */
  function connectVariableToPin(variable, nodeId, param, cardId) {
    const node = nodeById(nodeId);
    if (!node || !state.raw.blackboard || !Object.prototype.hasOwnProperty.call(state.raw.blackboard, variable)) return;
    mutate(() => {
      if (param.startsWith('inputs.')) {
        if (!node.params.inputs || typeof node.params.inputs !== 'object' || Array.isArray(node.params.inputs)) node.params.inputs = {};
        node.params.inputs[param.slice('inputs.'.length)] = { ref: `blackboard.${variable}` };
      } else node.params[param] = { ref: `blackboard.${variable}` };
      if (cardId) variableLinks()[`${nodeId}:${param}`] = cardId;
    });
    toast(`参数 ${param} ← 变量 ${variable}`);
  }

  function renderVariableConnection(layer) {
    const connection = state.variableConnect;
    if (!connection) return;
    let origin = null;
    if (connection.direction === 'from-card') {
      const card = variableCardList().find((item) => item.id === connection.cardId) || variableCardList().find((item) => item.name === connection.variable);
      if (card) origin = { x: card.x + VARIABLE_CARD_W, y: card.y + VARIABLE_CARD_PORT_Y };
    } else {
      const node = nodeById(connection.nodeId);
      const index = node ? nodeVariablePins(node).findIndex((pin) => pin.param === connection.param) : -1;
      if (node && index >= 0) origin = variablePinPosition(node, index);
    }
    if (!origin) return;
    const hover = connection.hover;
    svgEl('path', {
      class: `variable-connection-preview${hover ? ' snapped' : ''}`,
      d: bezier(origin.x, origin.y, hover ? hover.x : connection.x, hover ? hover.y : connection.y),
    }, layer);
  }

  function startNodeDrag(event, id) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.shiftKey && !state.selected.has(id)) state.selected = new Set([id]);
    else if (event.shiftKey) {
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    }
    state.selectedEdge = null;
    state.selectedRun = null;
    state.inspector = 'node';
    const point = worldPoint(event);
    const origins = {};
    for (const selected of state.selected) origins[selected] = { ...position(nodeById(selected)) };
    state.drag = { kind: 'nodes', start: point, origins, before: snapshot(), moved: false };
    render();
  }

  function onPointerDown(event) {
    hideMenus();
    suppressPanContextMenu = false;
    if (event.button === 1 || event.button === 2 || (event.button === 0 && event.altKey)) {
      event.preventDefault();
      state.drag = { kind: 'pan', x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY, moved: false };
      return;
    }
    if (event.button === 0 && event.target === graph) {
      const point = worldPoint(event);
      if (!event.shiftKey) state.selected.clear();
      state.selectedEdge = null;
      state.selectedRun = null;
      state.inspector = 'node';
      state.marquee = { x1: point.x, y1: point.y, x2: point.x, y2: point.y, additive: event.shiftKey };
      state.drag = { kind: 'marquee' };
      render();
    }
  }

  function autoPan(event) {
    if (!state.drag && !state.connect) return;
    const rect = wrap.getBoundingClientRect();
    const margin = 36;
    let dx = 0; let dy = 0;
    if (event.clientX - rect.left < margin) dx = 12;
    else if (rect.right !== undefined && rect.right - event.clientX < margin) dx = -12;
    else if (event.clientX > rect.left + rect.width - margin) dx = -12;
    if (event.clientY - rect.top < margin) dy = 12;
    else if (rect.bottom !== undefined && rect.bottom - event.clientY < margin) dy = -12;
    else if (event.clientY > rect.top + rect.height - margin) dy = -12;
    state.panX += dx; state.panY += dy;
  }

  function onPointerMove(event) {
    if (state.connect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.connect.pointerId) && event.pointerId !== state.connect.pointerId) return;
      autoPan(event);
      const point = worldPoint(event);
      state.connect.x = point.x; state.connect.y = point.y;
      state.connect.hover = connectionTargetAt(event);
      render();
      return;
    }
    if (state.variableConnect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.variableConnect.pointerId) && event.pointerId !== state.variableConnect.pointerId) return;
      autoPan(event);
      const point = worldPoint(event);
      state.variableConnect.x = point.x;
      state.variableConnect.y = point.y;
      state.variableConnect.hover = variableConnectionTargetAt(event);
      render();
      return;
    }
    if (!state.drag) return;
    if (state.drag.kind === 'pan') {
      state.drag.moved = state.drag.moved || Math.abs(event.clientX - state.drag.x) + Math.abs(event.clientY - state.drag.y) > 3;
      state.panX = state.drag.panX + event.clientX - state.drag.x;
      state.panY = state.drag.panY + event.clientY - state.drag.y;
    } else if (state.drag.kind === 'nodes') {
      autoPan(event);
      const point = worldPoint(event);
      const dx = point.x - state.drag.start.x;
      const dy = point.y - state.drag.start.y;
      state.drag.moved = state.drag.moved || Math.abs(dx) + Math.abs(dy) > 2;
      for (const [id, origin] of Object.entries(state.drag.origins)) {
        layout()[id] = { x: Math.round((origin.x + dx) / 8) * 8, y: Math.round((origin.y + dy) / 8) * 8 };
      }
    } else if (state.drag.kind === 'variable-card') {
      autoPan(event);
      const point = worldPoint(event);
      const dx = point.x - state.drag.start.x;
      const dy = point.y - state.drag.start.y;
      state.drag.moved = state.drag.moved || Math.abs(dx) + Math.abs(dy) > 2;
      const card = variableCards()[state.drag.id];
      if (card) {
        card.x = Math.round((state.drag.origin.x + dx) / 8) * 8;
        card.y = Math.round((state.drag.origin.y + dy) / 8) * 8;
      }
    } else if (state.drag.kind === 'marquee' && state.marquee) {
      const point = worldPoint(event);
      state.marquee.x2 = point.x; state.marquee.y2 = point.y;
      const x1 = Math.min(state.marquee.x1, point.x); const x2 = Math.max(state.marquee.x1, point.x);
      const y1 = Math.min(state.marquee.y1, point.y); const y2 = Math.max(state.marquee.y1, point.y);
      const selected = state.marquee.additive ? new Set(state.selected) : new Set();
      for (const node of nodes()) {
        const pos = position(node);
        if (pos.x + NODE_W >= x1 && pos.x <= x2 && pos.y + nodeHeight(node) >= y1 && pos.y <= y2) selected.add(node.id);
      }
      state.selected = selected;
    }
    render();
  }

  function onPointerUp(event) {
    if (state.connect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.connect.pointerId) && event.pointerId !== state.connect.pointerId) return;
      const target = connectionTargetAt(event) || state.connect.hover;
      if (target) finishConnection(event, target);
      else cancelConnection();
      return;
    }
    if (state.variableConnect) {
      if (Number.isInteger(event.pointerId) && Number.isInteger(state.variableConnect.pointerId) && event.pointerId !== state.variableConnect.pointerId) return;
      finishVariableConnection(event);
      return;
    }
    if (!state.drag) return;
    if (state.drag.kind === 'nodes' && state.drag.moved && snapshot() !== state.drag.before) {
      state.undo.push(state.drag.before); state.redo = []; setDirty();
    }
    if (state.drag.kind === 'variable-card' && state.drag.moved && snapshot() !== state.drag.before) {
      state.undo.push(state.drag.before); state.redo = []; setDirty();
    }
    if (state.drag.kind === 'pan' && state.drag.moved) suppressPanContextMenu = true;
    state.drag = null;
    state.marquee = null;
    render();
  }

  function renderMinimap() {
    const mini = $('minimap');
    mini.innerHTML = '';
    const box = bounds();
    const pad = 40;
    mini.setAttribute('viewBox', `${box.minX - pad} ${box.minY - pad} ${Math.max(1, box.maxX - box.minX + pad * 2)} ${Math.max(1, box.maxY - box.minY + pad * 2)}`);
    for (const node of nodes()) {
      const pos = position(node);
      svgEl('rect', { class: `mini-node type-${node.type}`, x: pos.x, y: pos.y, width: NODE_W, height: nodeHeight(node) }, mini);
    }
    for (const card of instanceRunCards()) {
      svgEl('rect', { class: 'mini-node type-instance-run', x: card.x, y: card.y, width: RUN_CARD_W, height: card.height }, mini);
    }
    for (const card of variableCardList()) {
      svgEl('rect', { class: 'mini-node type-variable-card', x: card.x, y: card.y, width: VARIABLE_CARD_W, height: VARIABLE_CARD_H }, mini);
    }
    const rect = wrap.getBoundingClientRect();
    svgEl('rect', { class: 'mini-viewport', x: -state.panX / state.zoom, y: -state.panY / state.zoom, width: rect.width / state.zoom, height: rect.height / state.zoom }, mini);
  }

  function updateIssueBadge() {
    const local = localIssueCount();
    const count = Math.max(local, Array.isArray(state.issues) ? state.issues.filter((item) => item.severity === 'error').length : 0);
    const badge = $('issue-badge');
    badge.textContent = count ? `${count} 个问题` : '结构有效';
    badge.classList.toggle('error', count > 0);
  }

  function localIssueCount() {
    if (!state.raw) return 1;
    let count = state.raw.schema_version === 3 ? 0 : 1;
    const map = new Map(nodes().map((node) => [node.id, node]));
    const root = map.get(state.raw.root);
    if (!root || root.type !== 'root') count += 1;
    const parents = new Map(nodes().map((node) => [node.id, 0]));
    for (const node of nodes()) for (const child of (Array.isArray(node.children) ? node.children : [])) parents.set(child, (parents.get(child) || 0) + 1);
    for (const node of nodes()) if (node.id !== state.raw.root && parents.get(node.id) !== 1) count += 1;
    return count;
  }

  function toast(message, error = false) {
    const target = $('toast');
    target.textContent = message;
    target.classList.remove('hidden');
    target.classList.toggle('error', error);
    clearTimeout(target._timer);
    target._timer = setTimeout(() => target.classList.add('hidden'), 2200);
  }

  function hideMenus() {
    for (const menu of Array.from(document.querySelectorAll ? document.querySelectorAll('.context-menu') : [])) menu.remove();
  }

  /** 右键平移拖拽结束后应吞掉紧随的 contextmenu，避免误弹出菜单。 */
  function contextMenuSuppressedByPan() {
    if (suppressPanContextMenu) { suppressPanContextMenu = false; return true; }
    return Boolean(state.drag && state.drag.kind === 'pan' && state.drag.moved);
  }

  function showMenu(x, y, items, options = {}) {
    hideMenus();
    const menu = el('div', 'context-menu');
    for (const item of items) {
      if (item === 'separator') { menu.appendChild(el('div', 'menu-separator')); continue; }
      const button = el('button', item.danger ? 'danger' : '', item.label);
      button.addEventListener('click', () => { hideMenus(); item.run(); });
      menu.appendChild(button);
    }
    document.body.appendChild(menu);
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const preferredLeft = options.align === 'end' ? x - rect.width : x;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    menu.style.left = `${Math.min(Math.max(margin, preferredLeft), maxLeft)}px`;
    menu.style.top = `${Math.min(Math.max(margin, y), maxTop)}px`;
  }

  function openLightbox(src) {
    if (!src) return;
    let box = $('lightbox');
    box.innerHTML = '';
    box.classList.remove('hidden');
    const shell = el('div', 'lightbox-shell');
    const close = el('button', 'icon-button lightbox-close', '×');
    const image = el('img'); image.src = src;
    close.addEventListener('click', () => box.classList.add('hidden'));
    shell.appendChild(close); shell.appendChild(image); box.appendChild(shell);
  }

  function clearInspector(title) {
    $('inspector-title').textContent = title;
    const empty = $('inspector-empty');
    const body = $('inspector-body');
    empty.classList.add('hidden'); body.classList.remove('hidden'); body.innerHTML = '';
    return body;
  }

  function section(body, title, action) {
    const header = el('div', 'section-header');
    header.appendChild(el('span', '', title));
    if (action) header.appendChild(action);
    body.appendChild(header);
    return header;
  }

  function field(body, label, hint) {
    const row = el('label', 'field');
    const caption = el('span', 'field-label', label);
    if (hint) caption.title = hint;
    row.appendChild(caption); body.appendChild(row);
    return row;
  }

  function textInput(value, onChange, options = {}) {
    const input = el('input', options.className || '');
    input.type = options.type || 'text';
    input.value = value === undefined || value === null ? '' : String(value);
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    if (options.step !== undefined) input.step = String(options.step);
    if (options.placeholder) input.placeholder = options.placeholder;
    input.addEventListener('change', () => onChange(input.value));
    return input;
  }

  function selectInput(value, options, onChange, className = '') {
    const select = el('select', className);
    for (const option of options) {
      const item = el('option', '', option.label === undefined ? String(option.value) : option.label);
      item.value = String(option.value);
      if (String(option.value) === String(value)) item.selected = true;
      select.appendChild(item);
    }
    select.value = String(value);
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function renderInstancePicker() {
    const picker = $('instance-select');
    picker.innerHTML = '';
    const instances = Array.isArray(state.instances) ? state.instances : [];
    if (!instances.length) {
      const option = el('option', '', '未检测到运行实例');
      option.value = '';
      option.disabled = true;
      picker.appendChild(option);
      state.instanceId = '';
      picker.value = '';
      picker.title = '请先启动 MuMu 或连接 Android 设备';
      $('btn-run').title = '未检测到运行实例';
      return;
    }
    for (const instance of instances) {
      const label = instance.displayName
        || (instance.backend === 'mumu' && Number.isInteger(instance.mumuIndex) ? `MuMu ${instance.mumuIndex}` : instance.id);
      const option = el('option', '', label);
      option.value = instance.id;
      option.title = [instance.displayName, instance.id, instance.backend, instance.adbSerial].filter(Boolean).join(' · ');
      picker.appendChild(option);
    }
    if (!instances.some((instance) => instance.id === state.instanceId)) state.instanceId = instances[0].id;
    picker.value = state.instanceId;
    const selected = instances.find((instance) => instance.id === state.instanceId);
    picker.title = selected
      ? [selected.id, selected.displayName, selected.adbSerial].filter(Boolean).join(' · ')
      : '请先启动 MuMu 或连接 Android 设备';
    $('btn-run').title = `在 ${state.instanceId} 执行当前工作流`;
  }

  function renderWorkflowPicker() {
    const picker = $('workflow-select');
    picker.innerHTML = '';
    const workflows = Array.isArray(state.workflows) ? state.workflows : [];
    const all = workflows.slice();
    if (state.docUri && !all.some((item) => item.uri === state.docUri)) {
      // 当前文件不在已发现列表（如新建未保存）时仍保留为可切换项。
      const current = state.documentName || '当前工作流';
      all.unshift({ uri: state.docUri, name: current, rel: '' });
    }
    for (const item of all) {
      const option = el('option', '', item.name);
      option.value = item.uri;
      if (item.rel) option.title = item.rel;
      picker.appendChild(option);
    }
    picker.value = state.docUri || '';
    picker.title = '切换工作流（无需重新打开）';
  }

  function navigateWorkflowTrail(index) {
    const send = (saveText) => vscode.postMessage({ type: 'navigateWorkflowTrail', index, saveText });
    if (!state.dirty) { send(undefined); return; }
    const rect = $('workflow-breadcrumb').getBoundingClientRect();
    showMenu(rect.left, rect.bottom + 4, [
      { label: '保存并跳转', run: () => send(JSON.stringify(state.raw, null, 2) + '\n') },
      { label: '放弃修改并跳转', run: () => send(undefined) },
      'separator',
      { label: '取消', run: () => {} },
    ]);
  }

  function renderWorkflowBreadcrumb() {
    const nav = $('workflow-breadcrumb');
    if (!nav) return;
    nav.innerHTML = '';
    const trail = Array.isArray(state.workflowTrail) ? state.workflowTrail : [];
    if (!trail.length) { nav.classList.add('hidden'); return; }
    nav.classList.remove('hidden');
    nav.appendChild(el('span', 'workflow-breadcrumb-mark', '◆'));
    trail.forEach((item, index) => {
      if (index > 0) nav.appendChild(el('span', 'workflow-breadcrumb-separator', '›'));
      const current = index === trail.length - 1;
      const button = el('button', `workflow-crumb${current ? ' current' : ''}`, item.name || '工作流');
      button.type = 'button';
      button.title = item.uri || item.name || '工作流';
      if (current) {
        button.disabled = true;
        button.setAttribute('aria-current', 'page');
      } else button.addEventListener('click', () => navigateWorkflowTrail(index));
      nav.appendChild(button);
    });
  }

  function checkbox(value, onChange) {
    const input = el('input'); input.type = 'checkbox'; input.checked = !!value;
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }

  function renderInspector() {
    if (!state.raw) return;
    const selected = [...state.selected];
    const selectedNode = selected.length === 1 ? nodeById(selected[0]) : null;
    const open = state.inspector === 'workflow'
      || state.inspector === 'variables'
      || Boolean(state.selectedRun)
      || Boolean(state.selectedEdge)
      || Boolean(selectedNode);
    $('inspector').classList.toggle('hidden', !open);
    $('editor-main').classList.toggle('inspector-open', open);
    if (!open) return;
    if (state.inspector === 'workflow') { renderWorkflowInspector(); return; }
    if (state.inspector === 'variables') { renderVariablesInspector(); return; }
    if (state.selectedRun) { renderInstanceRunInspector(); return; }
    if (state.selectedEdge) { renderEdgeInspector(); return; }
    if (selected.length !== 1) {
      $('inspector-title').textContent = selected.length ? `${selected.length} 个节点` : '详细信息';
      $('inspector-empty').textContent = selected.length ? '可拖动或按 Delete 删除所选节点' : '选择一个节点';
      $('inspector-empty').classList.remove('hidden'); $('inspector-body').classList.add('hidden');
      return;
    }
    const node = selectedNode;
    if (!node) return;
    const body = clearInspector(node.name || node.id);
    section(body, '节点');
    const idRow = field(body, 'ID', '引用与运行事件使用的稳定标识');
    idRow.appendChild(textInput(node.id, (value) => renameNode(node.id, value.trim())));
    const nameRow = field(body, '显示名称');
    nameRow.appendChild(textInput(node.name || '', (value) => mutate(() => { if (value.trim()) node.name = value.trim(); else delete node.name; })));
    if (node.type !== 'root') {
      const typeRow = field(body, '类型');
      typeRow.appendChild(selectInput(node.type, TYPES.filter((type) => type !== 'root').map((type) => ({ value: type, label: TYPE_LABEL[type] })), (value) => changeNodeType(node, value)));
    }
    if (node.type === 'task') renderTaskInspector(body, node);
    else renderCompositeInspector(body, node);
    if (node.type !== 'root') renderDecorators(body, node);
    const remove = el('button', 'danger full-command', '删除节点');
    remove.addEventListener('click', deleteSelection);
    body.appendChild(remove);
  }

  function renameNode(oldId, value) {
    if (!value || value === oldId) return;
    if (nodeById(value)) { toast('节点 ID 已存在', true); return; }
    mutate(() => {
      const node = nodeById(oldId); node.id = value;
      for (const parent of nodes()) if (Array.isArray(parent.children)) parent.children = parent.children.map((child) => child === oldId ? value : child);
      if (state.raw.root === oldId) state.raw.root = value;
      layout()[value] = layout()[oldId]; delete layout()[oldId];
      const remap = (item) => {
        if (Array.isArray(item)) return item.forEach(remap);
        if (!item || typeof item !== 'object') return;
        if (typeof item.ref === 'string') item.ref = item.ref.replace(`nodes.${oldId}.output.`, `nodes.${value}.output.`);
        Object.values(item).forEach(remap);
      };
      remap(state.raw.nodes);
      state.selected = new Set([value]);
    });
  }

  function changeNodeType(node, type) {
    mutate(() => {
      node.type = type;
      if (type === 'task') {
        delete node.children; delete node.finish_mode;
        delete node.runs; delete node.wait_for; delete node.cancel_on_failure;
        node.action = state.catalog[0] ? state.catalog[0].name : 'core.capture'; node.params = {};
      } else if (type === 'instance_parallel') {
        delete node.action; delete node.params; delete node.children; delete node.finish_mode;
        node.runs = Array.isArray(node.runs) && node.runs.length ? node.runs : [{ instance: state.instances[0]?.id || '', workflow: '', inputs: {} }];
        node.wait_for = node.wait_for === 'any' ? 'any' : 'all';
        node.cancel_on_failure = node.cancel_on_failure !== false;
      } else {
        delete node.action; delete node.params;
        node.children = [];
        delete node.runs; delete node.wait_for; delete node.cancel_on_failure;
        if (type === 'simple_parallel') node.finish_mode = 'abort_background'; else delete node.finish_mode;
        if (type === 'repeat_until') { node.condition = node.condition || { eq: [1, 1] }; node.max_iterations = node.max_iterations || 100; }
        if (type === 'branch') node.conditions = Array.isArray(node.conditions) ? node.conditions : [];
        if (type === 'switch') { node.expression = node.expression ?? 0; node.cases = Array.isArray(node.cases) ? node.cases : []; }
        if (type === 'parallel') { node.wait_for = 'all'; node.cancel_on_failure = true; }
        if (type !== 'parallel') { delete node.wait_for; delete node.cancel_on_failure; }
      }
    });
  }

  function renderTaskInspector(body, node) {
    section(body, 'Action');
    const row = field(body, '实现');
    row.appendChild(selectInput(node.action || '', state.catalog.map((item) => ({ value: item.name, label: item.name })), (value) => mutate(() => { node.action = value; node.params = {}; delete publicParameterMetadata()[node.id]; })));
    const spec = catalogByName(node.action);
    if (spec && spec.description) body.appendChild(el('div', 'description', spec.description));
    section(body, '参数');
    if (!node.params || typeof node.params !== 'object' || Array.isArray(node.params)) node.params = {};
    if (!spec || !Object.keys(spec.parameters || {}).length) {
      body.appendChild(el('div', 'empty-section', '无参数'));
      return;
    }
    for (const [name, definition] of Object.entries(spec.parameters)) {
      if (node.action === 'workflow.run' && name === 'inputs') continue;
      renderParameter(body, node, name, definition);
    }
    if (node.action === 'workflow.run') renderPublicWorkflowInputs(body, node.params, node.params.workflow);
  }

  function removeInstanceRun(node, index) {
    mutate(() => {
      if (Array.isArray(node.runs)) node.runs.splice(index, 1);
      state.selectedRun = null;
    });
  }

  function parentVariableRefs(definition) {
    const expected = definitionSchema(definition);
    const blackboard = state.raw && state.raw.blackboard && typeof state.raw.blackboard === 'object' && !Array.isArray(state.raw.blackboard)
      ? state.raw.blackboard
      : {};
    return Object.entries(blackboard)
      .filter(([, parentDefinition]) => compatibleRefType(expected, definitionSchema(parentDefinition)))
      .map(([name]) => `blackboard.${name}`);
  }

  function runInputLiteralControl(holder, name, definition) {
    const value = holder.inputs[name];
    const set = (next) => mutate(() => { holder.inputs[name] = next; });
    if (Array.isArray(definition.enum) && definition.enum.length) {
      return selectInput(JSON.stringify(value), definition.enum.map((item) => ({ value: JSON.stringify(item), label: String(item) })), (next) => set(JSON.parse(next)), 'full');
    }
    if (definition.type === 'boolean') return checkbox(!!value, set);
    if (definition.type === 'number' || definition.type === 'integer') {
      return textInput(value, (next) => set(definition.type === 'integer' ? parseInt(next || '0', 10) : parseFloat(next || '0')), { type: 'number', min: definition.min, max: definition.max, step: definition.type === 'integer' ? 1 : 'any' });
    }
    if (['array', 'object', 'any', 'rect'].includes(definition.type)) {
      const area = el('textarea', 'json-value'); area.value = JSON.stringify(value, null, 2);
      area.addEventListener('change', () => { try { set(JSON.parse(area.value)); } catch { toast(`${name} 不是有效 JSON`, true); } });
      return area;
    }
    return textInput(value ?? '', set);
  }

  function renderPublicWorkflowInputs(body, holder, reference) {
    if (!holder.inputs || typeof holder.inputs !== 'object' || Array.isArray(holder.inputs)) holder.inputs = {};
    const variables = publicWorkflowVariables(reference);
    section(body, '公开变量');
    if (!variables.length) body.appendChild(el('div', 'empty-section', reference ? '该子工作流没有公开变量' : '请先选择子工作流'));
    variables.forEach((variable) => {
      const definition = variable.definition || {};
      const block = el('div', 'run-variable-block');
      const heading = el('div', 'run-variable-heading');
      heading.appendChild(el('span', '', variable.name));
      heading.appendChild(el('span', 'variable-type-label', `${definition.type || 'any'}${definition.required ? ' · 必填' : ''}`));
      block.appendChild(heading);
      const current = holder.inputs[variable.name];
      const binding = current && typeof current === 'object' && !Array.isArray(current) && typeof current.ref === 'string';
      const exists = Object.prototype.hasOwnProperty.call(holder.inputs, variable.name);
      const mode = !exists ? 'default' : binding ? 'binding' : 'literal';
      const modeRow = field(block, '传值方式');
      modeRow.appendChild(selectInput(mode, [
        { value: 'default', label: Object.prototype.hasOwnProperty.call(definition, 'default') ? '使用默认值' : '不传值' },
        { value: 'literal', label: '常量' },
        { value: 'binding', label: '绑定父变量' },
      ], (next) => mutate(() => {
        if (next === 'default') delete holder.inputs[variable.name];
        else if (next === 'literal') holder.inputs[variable.name] = Object.prototype.hasOwnProperty.call(definition, 'default') ? clone(definition.default) : defaultValue(definition);
        else {
          const refs = parentVariableRefs(definition);
          holder.inputs[variable.name] = { ref: refs[0] || '' };
        }
      })));
      if (mode === 'binding') {
        const refs = parentVariableRefs(definition);
        const bindingRow = field(block, '父变量');
        bindingRow.appendChild(selectInput(current.ref || '', refs.length ? refs.map((ref) => ({ value: ref, label: ref.replace(/^blackboard\./, '') })) : [{ value: '', label: '没有兼容变量' }], (ref) => mutate(() => { holder.inputs[variable.name] = { ref }; })));
      } else if (mode === 'literal') {
        field(block, '值').appendChild(runInputLiteralControl(holder, variable.name, definition));
      }
      if (definition.description) block.appendChild(el('div', 'description', definition.description));
      body.appendChild(block);
    });
    const privateKeys = Object.keys(holder.inputs).filter((name) => !variables.some((variable) => variable.name === name));
    if (privateKeys.length) body.appendChild(el('div', 'private-input-warning', `不可传变量：${privateKeys.join(', ')}`));
  }

  function renderInstanceRunInspector() {
    const selection = state.selectedRun;
    const node = selection && nodeById(selection.nodeId);
    const run = node && Array.isArray(node.runs) ? node.runs[selection.index] : null;
    if (!node || !run) { state.selectedRun = null; renderInspector(); return; }
    if (!run.inputs || typeof run.inputs !== 'object' || Array.isArray(run.inputs)) run.inputs = {};
    const body = clearInspector(run.instance || `运行 ${selection.index + 1}`);
    section(body, '子工作流');
    const instanceOptions = (state.instances || []).map((item) => ({ value: item.id, label: item.display_name ? `${item.display_name} · ${item.id}` : item.id }));
    field(body, '实例').appendChild(selectInput(run.instance || '', instanceOptions.length ? instanceOptions : [{ value: run.instance || '', label: run.instance || '未配置实例' }], (value) => mutate(() => { run.instance = value; })));
    const workflowOptions = (state.workflows || []).filter((item) => item && item.rel).map((item) => {
      const relative = workflowReference(item);
      return { value: relative, label: item.name || relative };
    });
    field(body, '工作流').appendChild(selectInput(run.workflow || '', [{ value: '', label: '选择工作流' }, ...workflowOptions], (value) => mutate(() => { run.workflow = value; run.inputs = {}; })));
    if (run.workflow) {
      const open = el('button', 'full-command', '打开子工作流');
      open.addEventListener('click', () => requestOpenWorkflowReference(run.workflow));
      body.appendChild(open);
    }
    renderPublicWorkflowInputs(body, run, run.workflow);
    const remove = el('button', 'danger full-command', '删除实例运行项');
    remove.addEventListener('click', () => removeInstanceRun(node, selection.index));
    body.appendChild(remove);
  }

  function defaultValue(definition) {
    if (definition.default !== undefined) return clone(definition.default);
    if (definition.type === 'boolean') return false;
    if (definition.type === 'number' || definition.type === 'integer') return 0;
    if (definition.type === 'rect') return [0, 0, 100, 100];
    if (definition.type === 'array') return [];
    if (definition.type === 'object') return {};
    return '';
  }

  function definitionSchema(definition) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return {};
    const type = definition.type;
    if (type === 'asset' || type === 'path') return { type: 'string' };
    if (type === 'rect') return { type: 'array', items: { type: 'integer' } };
    if (type === 'any') return {};
    const schema = typeof type === 'string' ? { type } : {};
    if (type === 'object' && definition.properties && typeof definition.properties === 'object') {
      schema.properties = Object.fromEntries(Object.entries(definition.properties).map(([key, child]) => [key, definitionSchema(child)]));
    }
    if (type === 'array') schema.items = definitionSchema(definition.items || {});
    return schema;
  }

  function schemaTypes(schema) {
    if (!schema || typeof schema !== 'object') return new Set();
    if (typeof schema.type === 'string') return new Set([schema.type]);
    if (Array.isArray(schema.type)) return new Set(schema.type.filter((item) => typeof item === 'string'));
    return new Set();
  }

  function compatibleRefType(expected, actual) {
    const wanted = schemaTypes(expected);
    const offered = schemaTypes(actual);
    if (!wanted.size || !offered.size) return true;
    if (wanted.has('number') && offered.has('integer')) offered.add('number');
    return [...wanted].some((type) => offered.has(type));
  }

  function appendNestedRefs(prefix, schema, out, depth = 0) {
    if (!schema || typeof schema !== 'object' || depth >= 12) return;
    if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object') {
      for (const [key, child] of Object.entries(schema.properties)) {
        if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
        const ref = `${prefix}.${key}`;
        out.push({ ref, schema: child });
        appendNestedRefs(ref, child, out, depth + 1);
      }
    }
    if (schema.type === 'array') {
      const item = Array.isArray(schema.prefixItems) && schema.prefixItems[0] && typeof schema.prefixItems[0] === 'object'
        ? schema.prefixItems[0]
        : schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)
          ? schema.items
          : {};
      const ref = `${prefix}.0`;
      out.push({ ref, schema: item });
      appendNestedRefs(ref, item, out, depth + 1);
    }
  }

  function guaranteedOutputIds(nodeId, map, visiting = new Set()) {
    if (visiting.has(nodeId)) return new Set();
    const node = map.get(nodeId);
    if (!node) return new Set();
    if (node.type === 'task') return node.action ? new Set([node.id]) : new Set();
    const nested = new Set(visiting); nested.add(nodeId);
    if (node.type === 'root' && Array.isArray(node.children) && node.children.length === 1) {
      return guaranteedOutputIds(node.children[0], map, nested);
    }
    if (node.type === 'sequence') {
      const result = new Set();
      for (const child of node.children || []) for (const id of guaranteedOutputIds(child, map, nested)) result.add(id);
      return result;
    }
    if (node.type === 'selector' && Array.isArray(node.children) && node.children.length === 1) {
      return guaranteedOutputIds(node.children[0], map, nested);
    }
    if (node.type === 'simple_parallel' && Array.isArray(node.children) && node.children.length === 2) {
      return guaranteedOutputIds(node.children[0], map, nested);
    }
    return new Set();
  }

  function availableOutputIds(targetNodeId) {
    const map = new Map(nodes().filter((node) => node && node.id).map((node) => [node.id, node]));
    const parents = new Map();
    for (const parent of nodes()) {
      for (const child of parent.children || []) {
        const entries = parents.get(child) || [];
        entries.push(parent.id);
        parents.set(child, entries);
      }
    }
    const result = new Set();
    const visited = new Set();
    let current = targetNodeId;
    while (!visited.has(current)) {
      visited.add(current);
      const parentIds = parents.get(current) || [];
      if (parentIds.length !== 1) break;
      const parent = map.get(parentIds[0]);
      if (!parent) break;
      if (parent.type === 'sequence') {
        const index = (parent.children || []).indexOf(current);
        for (const sibling of (parent.children || []).slice(0, Math.max(0, index))) {
          for (const id of guaranteedOutputIds(sibling, map)) result.add(id);
        }
      }
      current = parent.id;
    }
    return result;
  }

  function possibleOutputIdsInSubtree(nodeId, map, visiting = new Set()) {
    if (visiting.has(nodeId)) return new Set();
    const node = map.get(nodeId);
    if (!node) return new Set();
    if (node.type === 'task') return node.action ? new Set([node.id]) : new Set();
    const nested = new Set(visiting); nested.add(nodeId);
    const result = new Set();
    for (const child of node.children || []) for (const id of possibleOutputIdsInSubtree(child, map, nested)) result.add(id);
    return result;
  }

  function possiblyAvailableOutputIds(targetNodeId) {
    const map = new Map(nodes().filter((node) => node && node.id).map((node) => [node.id, node]));
    const parents = new Map();
    for (const parent of nodes()) {
      for (const child of parent.children || []) {
        const entries = parents.get(child) || [];
        entries.push(parent.id);
        parents.set(child, entries);
      }
    }
    const result = availableOutputIds(targetNodeId);
    const visited = new Set();
    let current = targetNodeId;
    while (!visited.has(current)) {
      visited.add(current);
      const parentIds = parents.get(current) || [];
      if (parentIds.length !== 1) break;
      const parent = map.get(parentIds[0]);
      if (!parent) break;
      if (parent.type === 'sequence' || parent.type === 'selector') {
        const index = (parent.children || []).indexOf(current);
        for (const sibling of (parent.children || []).slice(0, Math.max(0, index))) {
          for (const id of possibleOutputIdsInSubtree(sibling, map)) result.add(id);
        }
      }
      current = parent.id;
    }
    return result;
  }

  function allRefs(node, definition, includePossible = false) {
    const expected = definition ? definitionSchema(definition) : undefined;
    const candidates = [];
    const blackboard = state.raw && state.raw.blackboard && typeof state.raw.blackboard === 'object' && !Array.isArray(state.raw.blackboard)
      ? state.raw.blackboard
      : {};
    for (const [name, rawDefinition] of Object.entries(blackboard)) {
      const schema = definitionSchema(rawDefinition);
      const ref = `blackboard.${name}`;
      candidates.push({ ref, schema });
      appendNestedRefs(ref, schema, candidates);
    }
    const available = node
      ? includePossible ? possiblyAvailableOutputIds(node.id) : availableOutputIds(node.id)
      : null;
    for (const source of nodes()) {
      if (!source || !source.id || !source.action || (available && !available.has(source.id))) continue;
      const spec = catalogByName(source.action);
      if (spec && spec.outputSchema) appendNestedRefs(`nodes.${source.id}.output`, spec.outputSchema, candidates);
    }
    return candidates.filter((candidate) => compatibleRefType(expected, candidate.schema)).map((candidate) => candidate.ref);
  }

  function referenceLabel(ref) {
    if (!ref) return '无可用引用';
    if (ref.startsWith('blackboard.')) return `变量 · ${ref.slice('blackboard.'.length)}`;
    return ref;
  }

  function setParameterPublic(node, name, definition, checked) {
    const metadata = publicParameterMetadata();
    const names = new Set(publicParameterNames(node));
    if (checked) names.add(name);
    else {
      names.delete(name);
      const value = node.params && node.params[name];
      if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string' && value.ref.startsWith('blackboard.')) {
        const variableName = value.ref.slice('blackboard.'.length);
        const variableDefinition = state.raw.blackboard && state.raw.blackboard[variableName];
        node.params[name] = variableDefinition && Object.prototype.hasOwnProperty.call(variableDefinition, 'default')
          ? clone(variableDefinition.default)
          : definition.default !== undefined ? clone(definition.default) : defaultValue(definition);
      }
      delete variableLinks()[`${node.id}:${name}`];
    }
    if (names.size) metadata[node.id] = [...names];
    else delete metadata[node.id];
  }

  function renderParameter(body, node, name, definition) {
    const block = el('div', 'parameter-block');
    const heading = el('div', 'parameter-heading');
    heading.appendChild(el('span', '', `${name}${definition.required ? ' *' : ''}`));
    const headingActions = el('div', 'parameter-heading-actions');
    const exists = Object.prototype.hasOwnProperty.call(node.params, name);
    if (!definition.required && definition.default === undefined) {
      const enabled = checkbox(exists, (checked) => mutate(() => { if (checked) node.params[name] = defaultValue(definition); else delete node.params[name]; }));
      const toggleLabel = el('label', 'parameter-enable'); toggleLabel.appendChild(enabled); toggleLabel.appendChild(el('span', '', '启用'));
      headingActions.appendChild(toggleLabel);
    }
    const exposed = isParameterPublic(node, name);
    const publicToggle = el('label', 'parameter-public');
    publicToggle.title = exposed ? '显示节点输入端点；未连接变量时使用当前默认值' : '公开参数端点；不连接变量时保持当前默认值';
    publicToggle.appendChild(checkbox(exposed, (checked) => mutate(() => setParameterPublic(node, name, definition, checked))));
    publicToggle.appendChild(el('span', '', '公开'));
    headingActions.appendChild(publicToggle);
    if (name === 'threshold' && ['vision.match_template', 'vision.wait_template'].includes(node.action)) {
      const check = el('button', 'parameter-check', '检查'); check.title = '获取当前画面并执行模板匹配';
      let pointerPending = false;
      check.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        pointerPending = true;
        setTimeout(() => { if (pointerPending) { pointerPending = false; requestTemplateCheck(node.id); } }, 0);
      });
      check.addEventListener('click', () => { if (!pointerPending) requestTemplateCheck(node.id); });
      headingActions.appendChild(check);
    }
    heading.appendChild(headingActions);
    block.appendChild(heading);
    if (definition.description) block.appendChild(el('div', 'field-hint', definition.description));
    if (!exists && !definition.required && definition.default === undefined) { body.appendChild(block); return; }
    const value = exists
      ? node.params[name]
      : definition.default !== undefined
        ? clone(definition.default)
        : defaultValue(definition);
    const bound = value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string' && Object.keys(value).length === 1;
    const mode = selectInput(bound ? 'binding' : 'literal', [{ value: 'literal', label: '固定值' }, { value: 'binding', label: '引用' }], (next) => mutate(() => {
      node.params[name] = next === 'binding' ? { ref: allRefs(node, definition)[0] || '' } : defaultValue(definition);
      if (next !== 'binding') delete variableLinks()[`${node.id}:${name}`];
    }), 'value-mode');
    block.appendChild(mode);
    if (bound) {
      const refs = allRefs(node, definition);
      const ref = value.ref;
      const options = refs.includes(ref) ? refs : [ref, ...refs];
      block.appendChild(selectInput(ref, options.map((item) => ({
        value: item,
        label: referenceLabel(item),
      })), (next) => mutate(() => { node.params[name] = { ref: next }; delete variableLinks()[`${node.id}:${name}`]; }), 'full'));
    } else {
      block.appendChild(literalControl(node, name, definition, value));
    }
    body.appendChild(block);
  }

  function literalControl(node, name, definition, value) {
    const workflowParameter = node.action === 'workflow.run' && name === 'workflow';
    const set = (next) => mutate(() => {
      const changed = node.params[name] !== next;
      node.params[name] = next;
      if (workflowParameter && changed) node.params.inputs = {};
    });
    if (Array.isArray(definition.enum) && definition.enum.length) {
      return selectInput(JSON.stringify(value), definition.enum.map((item) => ({ value: JSON.stringify(item), label: String(item) })), (next) => set(JSON.parse(next)), 'full');
    }
    if (definition.type === 'boolean') return checkbox(!!value, set);
    if (definition.type === 'number' || definition.type === 'integer') {
      return textInput(value, (next) => set(definition.type === 'integer' ? parseInt(next || '0', 10) : parseFloat(next || '0')), { type: 'number', min: definition.min, max: definition.max, step: definition.type === 'integer' ? 1 : 'any' });
    }
    if (definition.type === 'rect') {
      const shell = el('div', 'rect-control');
      const values = Array.isArray(value) && value.length === 4 ? value : [0, 0, 100, 100];
      values.forEach((item, index) => shell.appendChild(textInput(item, (next) => { const updated = values.slice(); updated[index] = parseInt(next || '0', 10); set(updated); }, { type: 'number' })));
      const pick = el('button', '', '框选'); pick.addEventListener('click', () => requestRoi(node.id, name, 'rect')); shell.appendChild(pick);
      return shell;
    }
    if (definition.type === 'array' || definition.type === 'object' || definition.type === 'any') {
      const area = el('textarea', 'json-value'); area.value = JSON.stringify(value, null, 2);
      area.addEventListener('change', () => { try { set(JSON.parse(area.value)); } catch { toast(`${name} 不是有效 JSON`, true); } });
      return area;
    }
    const shell = el('div', 'inline-control');
    shell.appendChild(textInput(value, set, { placeholder: definition.type === 'asset' ? 'assets/templates/...' : workflowParameter ? '_folder/workflow.json' : '' }));
    if (definition.type === 'asset') {
      const browse = el('button', '', '浏览'); browse.title = '浏览 assets 中的图片'; browse.addEventListener('click', () => openAssetBrowser(node.id, name, value)); shell.appendChild(browse);
      const pick = el('button', '', '截取'); pick.addEventListener('click', () => requestRoi(node.id, name, 'asset')); shell.appendChild(pick);
    } else if (workflowParameter) {
      const browse = el('button', '', '浏览'); browse.title = '浏览 workflows 中的脚本'; browse.addEventListener('click', () => openWorkflowBrowser(node.id, name, value)); shell.appendChild(browse);
    }
    return shell;
  }

  function renderCompositeInspector(body, node) {
    section(body, '复合节点');
    if (node.type === 'selector') body.appendChild(el('div', 'description', '按顺序执行，首个成功后返回成功。'));
    if (node.type === 'sequence') body.appendChild(el('div', 'description', '按顺序执行，首个失败后返回失败。'));
    if (node.type === 'parallel') {
      body.appendChild(el('div', 'description', '并发执行所有子节点。'));
      const wait = field(body, '完成条件'); wait.appendChild(selectInput(node.wait_for || 'all', [{ value: 'all', label: '全部完成' }, { value: 'any', label: '任一成功' }], (value) => mutate(() => { node.wait_for = value; })));
      const cancel = field(body, '失败时取消其他分支'); cancel.appendChild(checkbox(node.cancel_on_failure !== false, (value) => mutate(() => { node.cancel_on_failure = value; })));
    }
    if (node.type === 'repeat_until') {
      body.appendChild(el('div', 'description', '重复执行唯一子节点，直到条件成立。'));
      const condition = field(body, '结束条件'); const area = el('textarea', 'json-value'); area.value = JSON.stringify(node.condition || { eq: [1, 1] }); area.addEventListener('change', () => { try { mutate(() => { node.condition = JSON.parse(area.value); }); } catch { toast('条件不是有效 JSON', true); } }); condition.appendChild(area);
      const max = field(body, '最大次数'); max.appendChild(textInput(node.max_iterations || 100, (value) => mutate(() => { node.max_iterations = Math.max(1, parseInt(value || '100', 10)); }), { type: 'number', min: 1, step: 1 }));
    }
    if (node.type === 'branch') {
      body.appendChild(el('div', 'description', '按 conditions 顺序选择第一个成立的分支。')); const area = el('textarea', 'json-value'); area.value = JSON.stringify(node.conditions || [], null, 2); area.addEventListener('change', () => { try { mutate(() => { node.conditions = JSON.parse(area.value); }); } catch { toast('conditions 不是有效 JSON', true); } }); body.appendChild(area);
    }
    if (node.type === 'switch') {
      body.appendChild(el('div', 'description', '按 expression 的值匹配 cases。')); const expression = field(body, '表达式'); const expr = el('textarea', 'json-value'); expr.value = JSON.stringify(node.expression ?? 0); expr.addEventListener('change', () => { try { mutate(() => { node.expression = JSON.parse(expr.value); }); } catch { toast('expression 不是有效 JSON', true); } }); expression.appendChild(expr); const cases = field(body, '分支映射'); const map = el('textarea', 'json-value'); map.value = JSON.stringify(node.cases || [], null, 2); map.addEventListener('change', () => { try { mutate(() => { node.cases = JSON.parse(map.value); }); } catch { toast('cases 不是有效 JSON', true); } }); cases.appendChild(map);
    }
    if (node.type === 'simple_parallel') {
      body.appendChild(el('div', 'description', '第 1 个子节点是主 Task，第 2 个是后台分支。'));
      const finish = field(body, '结束模式');
      finish.appendChild(selectInput(node.finish_mode || 'abort_background', [
        { value: 'abort_background', label: '主任务结束时中止后台' },
        { value: 'wait_for_background', label: '主任务结束后等待后台' },
      ], (value) => mutate(() => { node.finish_mode = value; })));
    }
    if (node.type === 'instance_parallel') {
      body.appendChild(el('div', 'description', 'Supervisor 会同时把每个运行项投递到对应实例。该节点不能连接普通子节点。'));
      const wait = field(body, '完成条件');
      wait.appendChild(selectInput(node.wait_for || 'all', [
        { value: 'all', label: '全部实例完成' },
        { value: 'any', label: '任一实例完成' },
      ], (value) => mutate(() => { node.wait_for = value; })));
      const cancel = field(body, '失败时取消其他实例');
      cancel.appendChild(checkbox(node.cancel_on_failure !== false, (value) => mutate(() => { node.cancel_on_failure = value; })));
      section(body, '实例运行项');
      if (!Array.isArray(node.runs)) node.runs = [];
      const instanceOptions = (state.instances || []).map((item) => ({ value: item.id, label: item.display_name ? `${item.display_name} · ${item.id}` : item.id }));
      const workflowOptions = (state.workflows || []).filter((item) => item && item.rel).map((item) => {
        const relative = String(item.rel).replace(/^.*workflows[\\/]/i, '');
        return { value: relative, label: item.name || relative };
      });
      node.runs.forEach((run, index) => {
        const block = el('div', 'instance-run-block');
        const heading = el('div', 'parameter-heading');
        heading.appendChild(el('span', '', `运行 ${index + 1} · ${run.instance || '未选择实例'}`));
        const remove = el('button', 'icon-button danger', '×'); remove.title = '删除运行项';
        remove.addEventListener('click', () => removeInstanceRun(node, index));
        heading.appendChild(remove); block.appendChild(heading);
        const instanceRow = field(block, '实例');
        instanceRow.appendChild(selectInput(run.instance || '', instanceOptions.length ? instanceOptions : [{ value: run.instance || '', label: run.instance || '未配置实例' }], (value) => mutate(() => { run.instance = value; })));
        const workflowRow = field(block, '工作流');
        workflowRow.appendChild(selectInput(run.workflow || '', workflowOptions.length ? [{ value: '', label: '选择工作流' }, ...workflowOptions] : [{ value: run.workflow || '', label: run.workflow || '输入路径' }], (value) => mutate(() => { run.workflow = value; run.inputs = {}; })));
        const edit = el('button', 'full-command', `编辑公开变量（${publicWorkflowVariables(run.workflow).length}）`);
        edit.addEventListener('click', () => { state.selected.clear(); state.selectedEdge = null; state.selectedRun = { nodeId: node.id, index }; render(); });
        block.appendChild(edit); body.appendChild(block);
      });
      const addRun = el('button', 'full-command', '＋ 添加实例运行项');
      addRun.addEventListener('click', () => {
        const index = node.runs.length;
        mutate(() => {
          node.runs.push({ instance: state.instances[0]?.id || '', workflow: '', inputs: {} });
          state.selected.clear(); state.selectedEdge = null; state.selectedRun = { nodeId: node.id, index };
        });
      });
      body.appendChild(addRun);
      return;
    }
    section(body, '有序子节点');
    const children = Array.isArray(node.children) ? node.children : [];
    if (!children.length) body.appendChild(el('div', 'empty-section', '尚未连接'));
    children.forEach((childId, index) => {
      const row = el('div', 'child-row');
      row.appendChild(el('span', 'child-order', String(index + 1)));
      row.appendChild(el('span', 'child-name', nodeById(childId)?.name || childId));
      const up = el('button', 'icon-button', '↑'); up.title = '提高优先级'; up.disabled = index === 0;
      up.addEventListener('click', () => mutate(() => { const value = node.children.splice(index, 1)[0]; node.children.splice(index - 1, 0, value); }));
      const down = el('button', 'icon-button', '↓'); down.title = '降低优先级'; down.disabled = index === children.length - 1;
      down.addEventListener('click', () => mutate(() => { const value = node.children.splice(index, 1)[0]; node.children.splice(index + 1, 0, value); }));
      const remove = el('button', 'icon-button danger', '×'); remove.title = '断开连接';
      remove.addEventListener('click', () => mutate(() => disconnect(node.id, childId)));
      row.appendChild(up); row.appendChild(down); row.appendChild(remove); body.appendChild(row);
    });
  }

  function renderDecorators(body, node) {
    const add = selectInput('', [
      { value: '', label: '＋ 添加' }, { value: 'condition', label: 'Condition' }, { value: 'cooldown', label: 'Cooldown' },
      { value: 'timeout', label: 'Time Limit' }, { value: 'retry', label: 'Retry' }, { value: 'repeat', label: 'Repeat' },
      { value: 'do_once', label: 'Do Once' },
    ], (type) => {
      if (!type) return;
      mutate(() => {
        if (!Array.isArray(node.decorators)) node.decorators = [];
        const defaults = { condition: { type, expression: true }, cooldown: { type, seconds: 1 }, timeout: { type, seconds: 10 }, retry: { type, attempts: 2, delay_seconds: 0 }, repeat: { type, count: 2 }, do_once: { type, reset_on_failure: false } };
        node.decorators.push(defaults[type]);
      });
    }, 'decorator-add');
    section(body, '装饰器', add);
    const decorators = Array.isArray(node.decorators) ? node.decorators : [];
    if (!decorators.length) body.appendChild(el('div', 'empty-section', '无装饰器'));
    decorators.forEach((decorator, index) => renderDecorator(body, node, decorator, index));
  }

  function renderDecorator(body, node, decorator, index) {
    const block = el('div', 'decorator-block');
    const head = el('div', 'decorator-heading'); head.appendChild(el('span', '', decoratorLabel(decorator)));
    const remove = el('button', 'icon-button danger', '×'); remove.addEventListener('click', () => mutate(() => node.decorators.splice(index, 1))); head.appendChild(remove); block.appendChild(head);
    if (decorator.type === 'condition') block.appendChild(conditionControl(node, decorator));
    else if (decorator.type === 'cooldown' || decorator.type === 'timeout') block.appendChild(textInput(decorator.seconds, (value) => mutate(() => { decorator.seconds = Math.max(0.001, parseFloat(value || '0')); }), { type: 'number', min: 0.001, step: 0.1 }));
    else if (decorator.type === 'retry') {
      const row = el('div', 'inline-control');
      row.appendChild(textInput(decorator.attempts, (value) => mutate(() => { decorator.attempts = Math.max(1, parseInt(value || '1', 10)); }), { type: 'number', min: 1, step: 1 }));
      row.appendChild(textInput(decorator.delay_seconds || 0, (value) => mutate(() => { decorator.delay_seconds = Math.max(0, parseFloat(value || '0')); }), { type: 'number', min: 0, step: 0.1 }));
      block.appendChild(row);
    } else if (decorator.type === 'repeat') block.appendChild(textInput(decorator.count, (value) => mutate(() => { decorator.count = Math.max(1, parseInt(value || '1', 10)); }), { type: 'number', min: 1, step: 1 }));
    else if (decorator.type === 'do_once') {
      const row = el('div', 'inline-control');
      row.appendChild(checkbox(decorator.reset_on_failure === true, (value) => mutate(() => { decorator.reset_on_failure = value; if (!value) delete decorator.reset_on_failure; })));
      row.appendChild(el('span', 'do-once-note', '失败后自动重置（成功才锁定）'));
      block.appendChild(row);
    }
    body.appendChild(block);
  }

  function conditionControl(node, decorator) {
    const shell = el('div', 'condition-control');
    const expression = decorator.expression;
    const op = expression && typeof expression === 'object' && !Array.isArray(expression) ? Object.keys(expression)[0] : 'literal';
    const choices = ['literal', 'exists', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'and', 'or', 'not'];
    shell.appendChild(selectInput(op, choices.map((value) => ({ value, label: value.toUpperCase() })), (next) => mutate(() => {
      if (next === 'literal') decorator.expression = true;
      else if (next === 'exists') decorator.expression = { exists: { ref: allRefs(node, undefined, true)[0] || '' } };
      else if (next === 'and' || next === 'or') decorator.expression = { [next]: [true, true] };
      else if (next === 'not') decorator.expression = { not: true };
      else decorator.expression = { [next]: [{ ref: allRefs(node)[0] || '' }, null] };
    }), 'when-op'));
    if (op === 'literal') shell.appendChild(checkbox(!!expression, (value) => mutate(() => { decorator.expression = value; })));
    else if (op === 'exists') {
      const ref = expression.exists && expression.exists.ref;
      const refs = allRefs(node, undefined, true);
      const options = ref && !refs.includes(ref) ? [ref, ...refs] : refs;
      shell.appendChild(selectInput(ref || '', (options.length ? options : ['']).map((value) => ({ value, label: referenceLabel(value) })), (value) => mutate(() => { decorator.expression = { exists: { ref: value } }; }), 'full'));
    } else if (['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'].includes(op)) {
      const refs = allRefs(node);
      const operands = Array.isArray(expression[op]) ? expression[op] : [{ ref: refs[0] || '' }, null];
      const left = operands[0] && operands[0].ref ? operands[0].ref : refs[0] || '';
      const options = left && !refs.includes(left) ? [left, ...refs] : refs;
      shell.appendChild(selectInput(left, (options.length ? options : ['']).map((value) => ({ value, label: referenceLabel(value) })), (value) => mutate(() => { decorator.expression[op][0] = { ref: value }; }), 'full'));
      const right = textInput(JSON.stringify(operands[1]), (value) => { try { mutate(() => { decorator.expression[op][1] = JSON.parse(value); }); } catch { toast('比较值不是有效 JSON', true); } });
      shell.appendChild(right);
    } else {
      const area = el('textarea', 'json-value'); area.value = JSON.stringify(expression, null, 2);
      area.addEventListener('change', () => { try { const value = JSON.parse(area.value); mutate(() => { decorator.expression = value; }); } catch { toast('条件不是有效 JSON', true); } }); shell.appendChild(area);
    }
    return shell;
  }

  function renderEdgeInspector() {
    const edge = state.selectedEdge;
    const body = clearInspector('连接');
    section(body, '父子关系');
    const from = field(body, '父节点'); from.appendChild(el('div', 'readonly-value', edge.parent));
    const to = field(body, '子节点'); to.appendChild(el('div', 'readonly-value', edge.child));
    const parent = nodeById(edge.parent); const index = parent && parent.children ? parent.children.indexOf(edge.child) : -1;
    const order = field(body, '执行顺序'); order.appendChild(el('div', 'readonly-value', index >= 0 ? String(index + 1) : '—'));
    const remove = el('button', 'danger full-command', '断开连接'); remove.addEventListener('click', () => { mutate(() => disconnect(edge.parent, edge.child)); state.selectedEdge = null; }); body.appendChild(remove);
  }

  function renderWorkflowInspector() {
    const body = clearInspector('工作流设置');
    section(body, '标识');
    field(body, 'ID').appendChild(textInput(state.raw.id || '', (value) => mutate(() => { state.raw.id = value.trim(); })));
    field(body, '版本').appendChild(textInput(state.raw.version || '3.0.0', (value) => mutate(() => { state.raw.version = value.trim(); })));
    const descriptionRow = field(body, '描述', '用于说明脚本用途，并显示在子工作流选择器中');
    const description = el('textarea', 'workflow-description-input');
    description.value = typeof state.raw.description === 'string' ? state.raw.description : '';
    description.placeholder = '说明这个工作流的用途';
    description.addEventListener('change', () => mutate(() => { state.raw.description = description.value.trim(); }));
    descriptionRow.appendChild(description);
    section(body, '运行限制');
    if (!state.raw.limits) state.raw.limits = { timeout_seconds: 300, max_steps: 1000 };
    field(body, '总超时（秒）').appendChild(textInput(state.raw.limits.timeout_seconds || 300, (value) => mutate(() => { state.raw.limits.timeout_seconds = Math.max(0.001, parseFloat(value || '300')); }), { type: 'number', min: 0.001 }));
    field(body, '最大节点执行数').appendChild(textInput(state.raw.limits.max_steps || 1000, (value) => mutate(() => { state.raw.limits.max_steps = Math.max(1, parseInt(value || '1000', 10)); }), { type: 'number', min: 1 }));
    const resolution = Array.isArray(state.raw.resolution) ? state.raw.resolution : [1920, 1080];
    const resolutionRow = field(body, '参考分辨率'); const inline = el('div', 'inline-control');
    inline.appendChild(textInput(resolution[0], (value) => mutate(() => { state.raw.resolution[0] = Math.max(1, parseInt(value || '1', 10)); }), { type: 'number', min: 1 }));
    inline.appendChild(textInput(resolution[1], (value) => mutate(() => { state.raw.resolution[1] = Math.max(1, parseInt(value || '1', 10)); }), { type: 'number', min: 1 })); resolutionRow.appendChild(inline);
  }

  const DEFINITION_TYPES = ['string', 'number', 'integer', 'boolean', 'rect', 'asset', 'path', 'array', 'object', 'any'];

  function sameDefinitionValue(left, right) {
    try { return JSON.stringify(left) === JSON.stringify(right); } catch { return left === right; }
  }

  function definitionAcceptsValue(type, value) {
    if (type === 'any') return true;
    if (type === 'string' || type === 'asset' || type === 'path') return typeof value === 'string';
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'integer') return Number.isInteger(value);
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'rect') return Array.isArray(value) && value.length === 4 && value.every(Number.isInteger);
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    return false;
  }

  function changeDefinitionType(definition, type) {
    definition.type = type;
    if (!['number', 'integer'].includes(type)) { delete definition.min; delete definition.max; }
    if (!['string', 'asset', 'path'].includes(type)) { delete definition.min_length; delete definition.max_length; }
    if (type !== 'array') { delete definition.min_items; delete definition.max_items; delete definition.items; }
    if (type !== 'object') delete definition.properties;
    if (Object.prototype.hasOwnProperty.call(definition, 'default') && !definitionAcceptsValue(type, definition.default)) delete definition.default;
    if (Array.isArray(definition.enum)) {
      definition.enum = definition.enum.filter((value) => definitionAcceptsValue(type, value));
      if (!definition.enum.length) delete definition.enum;
    }
  }

  function initialDefinitionValue(definition) {
    if (Array.isArray(definition.enum) && definition.enum.length) return clone(definition.enum[0]);
    return defaultValue({ type: definition.type });
  }

  function definitionValueControl(definition, value, assign, options = {}) {
    const set = (next) => mutate(() => assign(next));
    if (options.useEnum !== false && Array.isArray(definition.enum) && definition.enum.length) {
      const values = definition.enum.slice();
      if (!values.some((item) => sameDefinitionValue(item, value))) values.unshift(value);
      return selectInput(JSON.stringify(value), values.map((item) => ({ value: JSON.stringify(item), label: String(item) })), (next) => set(JSON.parse(next)), 'full');
    }
    if (definition.type === 'boolean') return checkbox(!!value, set);
    if (definition.type === 'number' || definition.type === 'integer') {
      return textInput(value, (next) => set(definition.type === 'integer' ? parseInt(next || '0', 10) : parseFloat(next || '0')), {
        type: 'number', min: definition.min, max: definition.max, step: definition.type === 'integer' ? 1 : 'any',
      });
    }
    if (definition.type === 'rect') {
      const shell = el('div', 'definition-rect-control');
      const values = Array.isArray(value) && value.length === 4 ? value : [0, 0, 100, 100];
      values.forEach((item, index) => shell.appendChild(textInput(item, (next) => {
        const updated = values.slice(); updated[index] = parseInt(next || '0', 10); set(updated);
      }, { type: 'number' })));
      return shell;
    }
    if (['array', 'object', 'any'].includes(definition.type)) {
      const area = el('textarea', 'json-value definition-json-value'); area.value = JSON.stringify(value, null, 2);
      area.addEventListener('change', () => { try { set(JSON.parse(area.value)); } catch { toast('默认值不是有效 JSON', true); } });
      return area;
    }
    if (definition.type === 'asset') {
      const shell = el('div', 'inline-control');
      shell.appendChild(textInput(value ?? '', set, { placeholder: 'assets/templates/...' }));
      const browse = el('button', '', '浏览'); browse.title = '从 assets 中选择模板';
      browse.addEventListener('click', () => openAssetBrowser(options.nodeId || '', options.key || '', value, assign));
      shell.appendChild(browse);
      return shell;
    }
    return textInput(value ?? '', set);
  }

  function optionalDefinitionNumber(body, label, definition, key, options = {}) {
    const row = field(body, label);
    row.appendChild(textInput(definition[key] ?? '', (value) => mutate(() => {
      if (String(value).trim() === '') delete definition[key];
      else definition[key] = options.integer ? parseInt(value, 10) : parseFloat(value);
    }), { type: 'number', min: options.min, step: options.integer ? 1 : 'any', placeholder: '不限' }));
  }

  function nextEnumValue(definition) {
    const values = Array.isArray(definition.enum) ? definition.enum : [];
    if (definition.type === 'boolean') return values.includes(false) ? true : false;
    if (definition.type === 'number' || definition.type === 'integer') {
      let value = 0; while (values.includes(value)) value += 1; return value;
    }
    let index = values.length + 1;
    let value = `选项 ${index}`;
    while (values.includes(value)) { index += 1; value = `选项 ${index}`; }
    return value;
  }

  function renderDefinitionEnum(body, definition) {
    if (!['string', 'number', 'integer', 'boolean', 'path'].includes(definition.type)) return;
    const heading = el('div', 'definition-option-heading');
    heading.appendChild(el('span', '', '可选值'));
    const add = el('button', 'small-command', '＋ 添加选项');
    add.disabled = definition.type === 'boolean' && Array.isArray(definition.enum) && definition.enum.length >= 2;
    add.addEventListener('click', () => mutate(() => {
      if (!Array.isArray(definition.enum)) definition.enum = [];
      definition.enum.push(nextEnumValue(definition));
    }));
    heading.appendChild(add); body.appendChild(heading);
    const values = Array.isArray(definition.enum) ? definition.enum : [];
    if (!values.length) body.appendChild(el('div', 'definition-option-empty', '未限制可选值'));
    values.forEach((value, index) => {
      const row = el('div', 'definition-enum-row');
      const editable = { ...definition }; delete editable.enum;
      row.appendChild(definitionValueControl(editable, value, (next) => { definition.enum[index] = next; }, { useEnum: false }));
      const remove = el('button', 'icon-button danger', '×'); remove.title = '删除选项';
      remove.addEventListener('click', () => mutate(() => {
        const removed = definition.enum.splice(index, 1)[0];
        if (!definition.enum.length) delete definition.enum;
        if (Object.prototype.hasOwnProperty.call(definition, 'default') && sameDefinitionValue(definition.default, removed)) {
          if (Array.isArray(definition.enum) && definition.enum.length) definition.default = clone(definition.enum[0]);
          else delete definition.default;
        }
      }));
      row.appendChild(remove); body.appendChild(row);
    });
  }

  function renameDefinitionProperty(definition, oldName, name) {
    if (!name || name === oldName) return;
    if (definition.properties[name]) { toast('字段名称已存在', true); return; }
    const next = {};
    for (const [key, value] of Object.entries(definition.properties)) next[key === oldName ? name : key] = value;
    definition.properties = next;
  }

  function renderDefinitionShape(body, definition) {
    if (definition.type === 'number' || definition.type === 'integer') {
      optionalDefinitionNumber(body, '最小值', definition, 'min');
      optionalDefinitionNumber(body, '最大值', definition, 'max');
    } else if (['string', 'asset', 'path'].includes(definition.type)) {
      optionalDefinitionNumber(body, '最短长度', definition, 'min_length', { integer: true, min: 0 });
      optionalDefinitionNumber(body, '最长长度', definition, 'max_length', { integer: true, min: 0 });
    } else if (definition.type === 'array') {
      optionalDefinitionNumber(body, '最少元素', definition, 'min_items', { integer: true, min: 0 });
      optionalDefinitionNumber(body, '最多元素', definition, 'max_items', { integer: true, min: 0 });
      const itemType = field(body, '元素类型');
      itemType.appendChild(selectInput(definition.items?.type || '', [
        { value: '', label: '任意类型' },
        ...DEFINITION_TYPES.map((type) => ({ value: type, label: type })),
      ], (type) => mutate(() => { if (type) definition.items = { type }; else delete definition.items; })));
    } else if (definition.type === 'object') {
      if (!definition.properties || typeof definition.properties !== 'object' || Array.isArray(definition.properties)) definition.properties = {};
      const heading = el('div', 'definition-option-heading'); heading.appendChild(el('span', '', '对象字段'));
      const add = el('button', 'small-command', '＋ 添加字段');
      add.addEventListener('click', () => mutate(() => {
        let index = 1; while (definition.properties[`field_${index}`]) index += 1;
        definition.properties[`field_${index}`] = { type: 'string' };
      }));
      heading.appendChild(add); body.appendChild(heading);
      const properties = Object.entries(definition.properties);
      if (!properties.length) body.appendChild(el('div', 'definition-option-empty', '自由对象，不限制字段'));
      properties.forEach(([name, child]) => {
        const row = el('div', 'definition-property-row');
        row.appendChild(textInput(name, (value) => mutate(() => renameDefinitionProperty(definition, name, value.trim()))));
        row.appendChild(selectInput(child.type || 'string', DEFINITION_TYPES.map((type) => ({ value: type, label: type })), (type) => mutate(() => changeDefinitionType(child, type))));
        const required = checkbox(child.required === true, (value) => mutate(() => { if (value) child.required = true; else delete child.required; })); required.title = '必填字段'; row.appendChild(required);
        const remove = el('button', 'icon-button danger', '×'); remove.title = '删除字段'; remove.addEventListener('click', () => mutate(() => { delete definition.properties[name]; })); row.appendChild(remove);
        body.appendChild(row);
      });
    }
  }

  function renderDefinitionOptions(body, name, definition) {
    field(body, '描述').appendChild(textInput(definition.description || '', (value) => mutate(() => {
      if (value.trim()) definition.description = value.trim(); else delete definition.description;
    }), { placeholder: '说明这个变量的用途' }));
    const hasDefault = Object.prototype.hasOwnProperty.call(definition, 'default');
    const defaultRow = field(body, '默认值');
    const defaultShell = el('div', 'definition-default');
    const enabled = el('label', 'check-label'); enabled.appendChild(checkbox(hasDefault, (value) => mutate(() => {
      if (value) definition.default = initialDefinitionValue(definition); else delete definition.default;
    }))); enabled.appendChild(el('span', '', '启用')); defaultShell.appendChild(enabled);
    if (hasDefault) defaultShell.appendChild(definitionValueControl(definition, definition.default, (value) => { definition.default = value; }, { key: name }));
    defaultRow.appendChild(defaultShell);
    renderDefinitionEnum(body, definition);
    renderDefinitionShape(body, definition);
  }

  function nextVariableName() {
    let index = 1;
    while (state.raw.blackboard[`new_variable_${index}`]) index += 1;
    return `new_variable_${index}`;
  }

  function variableReferenceCount(name) {
    const prefix = `blackboard.${name}`;
    let count = 0;
    const visit = (value) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== 'object') return;
      if (typeof value.ref === 'string' && (value.ref === prefix || value.ref.startsWith(`${prefix}.`))) count += 1;
      Object.values(value).forEach(visit);
    };
    visit(state.raw.nodes);
    return count;
  }

  function removeVariable(name) {
    const references = variableReferenceCount(name);
    if (references) {
      toast(`变量 ${name} 正在被 ${references} 处引用，不能删除`, true);
      return;
    }
    mutate(() => {
      const names = Object.keys(state.raw.blackboard);
      const index = names.indexOf(name);
      delete state.raw.blackboard[name];
      for (const [id, card] of Object.entries(variableCards())) {
        const cardName = card && typeof card.name === 'string' ? card.name : id;
        if (cardName === name) delete variableCards()[id];
      }
      for (const [key, cardId] of Object.entries(variableLinks())) {
        if (!Object.prototype.hasOwnProperty.call(variableCards(), cardId)) delete variableLinks()[key];
      }
      const remaining = Object.keys(state.raw.blackboard);
      state.selectedVariable = remaining[Math.min(Math.max(0, index), remaining.length - 1)] || '';
    });
  }

  function addVariable() {
    mutate(() => {
      if (!state.raw.blackboard || typeof state.raw.blackboard !== 'object' || Array.isArray(state.raw.blackboard)) state.raw.blackboard = {};
      const name = nextVariableName();
      state.raw.blackboard[name] = { type: 'string', public: false };
      state.selectedVariable = name;
      state.inspector = 'variables';
      state.selected.clear();
      state.selectedEdge = null;
      state.selectedRun = null;
    });
  }

  function renderVariablesInspector() {
    const name = state.selectedVariable;
    const body = clearInspector(name ? `变量 · ${name}` : '变量');
    if (!state.raw.blackboard || typeof state.raw.blackboard !== 'object' || Array.isArray(state.raw.blackboard)) state.raw.blackboard = {};
    const rawDefinition = name ? state.raw.blackboard[name] : null;
    if (!rawDefinition) {
      body.appendChild(el('div', 'variable-inspector-empty', '从左侧变量列表选择一个变量'));
      return;
    }
    const definition = rawDefinition && typeof rawDefinition === 'object' && !Array.isArray(rawDefinition)
      ? rawDefinition
      : { type: 'any', public: false };
    if (definition !== rawDefinition) state.raw.blackboard[name] = definition;
    const remove = el('button', 'icon-button danger', '×'); remove.title = '删除变量'; remove.addEventListener('click', () => removeVariable(name));
    section(body, '变量', remove);
    const details = el('div', 'variable-details');
    field(details, '名称').appendChild(textInput(name, (value) => renameBlackboard(name, value.trim())));
    field(details, '类型').appendChild(selectInput(definition.type || 'string', DEFINITION_TYPES.map((value) => ({ value, label: value })), (value) => mutate(() => changeDefinitionType(definition, value))));
    const flags = el('div', 'variable-flags');
    const exposed = el('label', 'check-label'); exposed.appendChild(checkbox(definition.public !== false, (value) => mutate(() => { definition.public = value; }))); exposed.appendChild(el('span', '', '公开给父工作流')); flags.appendChild(exposed);
    const required = el('label', 'check-label'); required.appendChild(checkbox(definition.required === true, (value) => mutate(() => { if (value) definition.required = true; else delete definition.required; }))); required.appendChild(el('span', '', '必填')); flags.appendChild(required);
    details.appendChild(flags);
    const references = variableReferenceCount(name);
    const usage = el('div', 'variable-usage', references ? `${references} 处节点引用` : '尚未被节点引用');
    details.appendChild(usage);
    const options = el('div', 'variable-options'); renderDefinitionOptions(options, name, definition); details.appendChild(options);
    body.appendChild(details);
  }

  function renameBlackboard(oldName, name) {
    if (!name || name === oldName) return;
    if (state.raw.blackboard[name]) { toast('变量名称已存在', true); return; }
    mutate(() => {
      const next = {};
      for (const [key, value] of Object.entries(state.raw.blackboard)) next[key === oldName ? name : key] = value;
      state.raw.blackboard = next;
      for (const [id, card] of Object.entries(variableCards())) {
        const cardName = card && typeof card.name === 'string' ? card.name : id;
        if (cardName === oldName && card && typeof card === 'object') card.name = name;
      }
      const remap = (item) => {
        if (Array.isArray(item)) return item.forEach(remap);
        if (!item || typeof item !== 'object') return;
        const prefix = `blackboard.${oldName}`;
        if (typeof item.ref === 'string' && (item.ref === prefix || item.ref.startsWith(`${prefix}.`))) {
          item.ref = `blackboard.${name}${item.ref.slice(prefix.length)}`;
        }
        Object.values(item).forEach(remap);
      };
      remap(state.raw.nodes);
      state.selectedVariable = name;
    });
  }

  const SVG_EXPORT_STYLE_PROPERTIES = [
    'color', 'display', 'visibility', 'opacity',
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
    'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight', 'letter-spacing',
    'text-anchor', 'dominant-baseline', 'paint-order', 'shape-rendering', 'vector-effect', 'filter',
  ];

  function inlineSvgStyles(source, target) {
    const computed = window.getComputedStyle(source);
    for (const property of SVG_EXPORT_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value, computed.getPropertyPriority(property));
    }
    const sourceChildren = Array.from(source.children);
    const targetChildren = Array.from(target.children);
    sourceChildren.forEach((child, index) => inlineSvgStyles(child, targetChildren[index]));
  }

  function loadSvgImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('无法渲染工作流画布'));
      image.src = dataUrl;
    });
  }

  function requestAssetDataUrls(paths) {
    if (!paths.length) return Promise.resolve(new Map());
    return new Promise((resolve) => {
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let settled = false;
      const finish = (map) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', listener);
        clearTimeout(timer);
        resolve(map);
      };
      const listener = (event) => {
        const message = event.data || {};
        if (message.type !== 'assetData' || message.requestId !== requestId) return;
        const map = new Map();
        for (const entry of Array.isArray(message.items) ? message.items : []) {
          if (entry && typeof entry.path === 'string' && typeof entry.dataUrl === 'string') map.set(entry.path, entry.dataUrl);
        }
        finish(map);
      };
      const timer = setTimeout(() => finish(new Map()), 8000);
      window.addEventListener('message', listener);
      vscode.postMessage({ type: 'requestAssetData', requestId, paths });
    });
  }

  /** 收集画布上需要内嵌的模板路径（运行截图已是 data URL，无需请求）。 */
  function collectExportTemplatePaths(root) {
    const paths = new Set();
    for (const image of root.querySelectorAll('image.node-preview-image')) {
      const href = image.getAttribute('href') || '';
      if (href && !href.startsWith('data:')) {
        const templatePath = image.getAttribute('data-template-path') || '';
        if (templatePath) paths.add(templatePath);
      }
    }
    return [...paths];
  }

  /** 把导出克隆里的缩略图 <image> 换成内嵌 data URL，返回保留数量。 */
  function applyInlineThumbnails(root, dataUrls) {
    let count = 0;
    for (const image of root.querySelectorAll('image.node-preview-image')) {
      const href = image.getAttribute('href') || '';
      if (href.startsWith('data:')) { count += 1; continue; }
      const dataUrl = dataUrls.get(image.getAttribute('data-template-path') || '');
      if (dataUrl) { image.setAttribute('href', dataUrl); count += 1; }
    }
    return count;
  }

  async function inlineExportThumbnails(exported) {
    const paths = collectExportTemplatePaths(exported);
    const dataUrls = paths.length ? await requestAssetDataUrls(paths) : new Map();
    return applyInlineThumbnails(exported, dataUrls);
  }

  function encodeSvgDataUrl(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  }

  function setExportBusy(value) {
    state.exportBusy = value;
  }

  async function exportFullCanvasImage() {
    if (!state.raw || state.exportBusy) return;
    setExportBusy(true);
    try {
      const padding = 56;
      const box = bounds();
      const logicalWidth = Math.max(1, Math.ceil(box.maxX - box.minX + padding * 2));
      const logicalHeight = Math.max(1, Math.ceil(box.maxY - box.minY + padding * 2));
      const exported = graph.cloneNode(true);
      inlineSvgStyles(graph, exported);
      exported.removeAttribute('id');
      exported.setAttribute('xmlns', NS);
      exported.setAttribute('width', String(logicalWidth));
      exported.setAttribute('height', String(logicalHeight));
      exported.setAttribute('viewBox', `0 0 ${logicalWidth} ${logicalHeight}`);
      exported.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      const world = exported.querySelector('.graph-world');
      if (!world) throw new Error('工作流画布尚未准备好');
      world.setAttribute('transform', `translate(${padding - box.minX},${padding - box.minY})`);
      exported.querySelectorAll('.connection-preview, .marquee, .edge-hit, .edge-rewire').forEach((element) => element.remove());
      // 缩略图保留进导出：把模板 <image> 的外部资源 URI 替换为内嵌 data URL，
      // 运行截图本身已是 data URL。请求失败或文件缺失时只跳过该图，不阻断导出。
      await inlineExportThumbnails(exported);

      const serialized = new XMLSerializer().serializeToString(exported);
      const image = await loadSvgImage(encodeSvgDataUrl(serialized));
      const maxDimension = 8192;
      const maxPixels = 32 * 1024 * 1024;
      const rasterScale = Math.min(
        2,
        maxDimension / logicalWidth,
        maxDimension / logicalHeight,
        Math.sqrt(maxPixels / (logicalWidth * logicalHeight)),
      );
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(logicalWidth * rasterScale));
      canvas.height = Math.max(1, Math.floor(logicalHeight * rasterScale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法创建图片画布');
      const wrapStyle = window.getComputedStyle(wrap);
      const rootStyle = window.getComputedStyle(document.documentElement);
      context.fillStyle = wrapStyle.backgroundColor || '#1e1f22';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const gridStep = 24 * rasterScale;
      if (gridStep >= 4) {
        context.beginPath();
        for (let x = 0.5; x < canvas.width; x += gridStep) { context.moveTo(x, 0); context.lineTo(x, canvas.height); }
        for (let y = 0.5; y < canvas.height; y += gridStep) { context.moveTo(0, y); context.lineTo(canvas.width, y); }
        context.strokeStyle = rootStyle.getPropertyValue('--grid').trim() || 'rgba(153, 157, 168, 0.1)';
        context.lineWidth = 1;
        context.stroke();
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const workflowName = String(state.raw.id || state.documentName || 'workflow')
        .replace(/\.json$/i, '')
        .replace(/[\\/\x00-\x1f<>:"|?*]/g, '_')
        .trim() || 'workflow';
      vscode.postMessage({
        type: 'saveCanvasImage',
        filename: `${workflowName}-layout.png`,
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
        logicalWidth,
        logicalHeight,
      });
    } catch (error) {
      setExportBusy(false);
      toast(`导出完整画布失败：${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  function requestRoi(nodeId, key, mode, options = {}) {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.roi = { requestId, nodeId, key, mode, ...options };
    vscode.postMessage({ type: 'pickRoi', requestId, nodeId, key, targetPath: options.targetPath, instanceId: state.instanceId, referenceResolution: state.raw.resolution || [1920, 1080] });
  }

  function templateCheckParam(node, name, fallback) {
    const definition = catalogByName(node.action)?.parameters?.[name] || {};
    let value = Object.prototype.hasOwnProperty.call(node.params || {}, name)
      ? node.params[name]
      : definition.default !== undefined ? clone(definition.default) : fallback;
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string') {
      const prefix = 'blackboard.';
      if (value.ref.startsWith(prefix)) {
        const entry = state.raw.blackboard && state.raw.blackboard[value.ref.slice(prefix.length)];
        if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'default')) value = entry.default;
        else if (entry !== undefined && (typeof entry !== 'object' || entry === null)) value = entry;
        else throw new Error(`${name} 引用没有可用的默认值`);
      } else {
        throw new Error(`${name} 使用了运行时引用，无法即时检查`);
      }
    }
    return value;
  }

  function requestTemplateCheck(nodeId) {
    const node = nodeById(nodeId);
    if (!node) return;
    try {
      const template = templateCheckParam(node, 'template', '');
      const roi = templateCheckParam(node, 'roi', null);
      const threshold = Number(templateCheckParam(node, 'threshold', 0.85));
      const maxResults = Number(templateCheckParam(node, 'max_results', 20));
      const scaleSearch = Boolean(templateCheckParam(node, 'scale_search', false));
      if (typeof template !== 'string' || !template.trim()) throw new Error('请先选择模板图片');
      if (roi !== null && (!Array.isArray(roi) || roi.length !== 4 || !roi.every((value) => Number.isInteger(value)))) throw new Error('ROI 必须是 [x, y, width, height]');
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('匹配阈值必须在 0 到 1 之间');
      if (!Number.isInteger(maxResults) || maxResults < 1) throw new Error('最大匹配数必须为正整数');
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      state.templateCheck = { requestId, nodeId, template: template.trim(), threshold, status: 'loading', result: null, error: '' };
      $('template-check').classList.remove('hidden');
      renderTemplateCheck();
      vscode.postMessage({
        type: 'checkTemplate',
        requestId,
        nodeId,
        template: template.trim(),
        roi,
        threshold,
        maxResults,
        scaleSearch,
        instanceId: state.instanceId,
        referenceResolution: state.raw.resolution || [1920, 1080],
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function closeTemplateCheck() {
    const overlay = $('template-check');
    if (overlay) overlay.classList.add('hidden');
    state.templateCheck = null;
  }

  function templateCheckBox(className, rect, width, height, label) {
    const box = el('div', className);
    box.style.left = `${Math.max(0, rect[0]) / width * 100}%`;
    box.style.top = `${Math.max(0, rect[1]) / height * 100}%`;
    box.style.width = `${Math.max(0, Math.min(width - rect[0], rect[2])) / width * 100}%`;
    box.style.height = `${Math.max(0, Math.min(height - rect[1], rect[3])) / height * 100}%`;
    box.appendChild(el('span', 'template-check-box-label', label));
    return box;
  }

  function renderTemplateCheck() {
    const check = state.templateCheck;
    const overlay = $('template-check');
    if (!check || !overlay) return;
    overlay.innerHTML = '';
    const dialog = el('div', 'template-check-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '模板检查');
    const head = el('div', 'template-check-head');
    const heading = el('div', 'template-check-heading'); heading.appendChild(el('strong', '', '模板检查')); heading.appendChild(el('span', '', check.template));
    const headActions = el('div', 'template-check-head-actions');
    if (check.status !== 'loading') {
      const refresh = el('button', 'icon-button', '↻'); refresh.title = '重新检查'; refresh.setAttribute('aria-label', '重新检查'); refresh.addEventListener('click', () => requestTemplateCheck(check.nodeId)); headActions.appendChild(refresh);
    }
    const close = el('button', 'icon-button', '×'); close.title = '关闭'; close.setAttribute('aria-label', '关闭'); close.addEventListener('click', closeTemplateCheck); headActions.appendChild(close);
    head.appendChild(heading); head.appendChild(headActions); dialog.appendChild(head);

    if (check.status === 'loading') {
      dialog.appendChild(el('div', 'template-check-status', '正在获取当前画面并匹配…'));
      overlay.appendChild(dialog);
      return;
    }
    if (check.status === 'error') {
      const status = el('div', 'template-check-status error', check.error || '模板检查失败'); dialog.appendChild(status);
      overlay.appendChild(dialog);
      return;
    }

    const result = check.result;
    const matches = Array.isArray(result.matches) ? result.matches : [];
    const summary = el('div', 'template-check-summary');
    summary.appendChild(el('span', 'template-check-chip roi', result.roi[0] === 0 && result.roi[1] === 0 && result.roi[2] === result.width && result.roi[3] === result.height ? '全画面 ROI' : 'ROI'));
    summary.appendChild(el('span', 'template-check-chip', `阈值 ${check.threshold.toFixed(3)}`));
    summary.appendChild(el('span', `template-check-chip ${matches.length ? 'matched' : 'missed'}`, `命中 ${matches.length}`));
    if (matches.length) summary.appendChild(el('span', 'template-check-chip matched', `最高 ${Math.max(...matches.map((item) => item.confidence)).toFixed(3)}`));
    dialog.appendChild(summary);

    const viewport = el('div', 'template-check-viewport');
    const stage = el('div', 'template-check-stage'); stage.style.aspectRatio = `${result.width} / ${result.height}`;
    const image = el('img'); image.src = result.dataUrl; image.alt = '当前实例画面'; stage.appendChild(image);
    stage.appendChild(templateCheckBox('template-check-roi', result.roi, result.width, result.height, 'ROI'));
    matches.forEach((match, index) => stage.appendChild(templateCheckBox(
      'template-check-match',
      [match.x, match.y, match.width, match.height],
      result.width,
      result.height,
      `${index + 1}  ${match.confidence.toFixed(3)}`,
    )));
    viewport.appendChild(stage); dialog.appendChild(viewport);
    const message = matches.length
      ? `找到 ${matches.length} 个达到阈值的匹配结果`
      : `未找到达到阈值 ${check.threshold.toFixed(3)} 的匹配结果`;
    dialog.appendChild(el('div', `template-check-footer ${matches.length ? 'matched' : 'missed'}`, message));
    overlay.appendChild(dialog);
  }

  function openAssetBrowser(nodeId, key, currentPath, applyValue = null) {
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
    $('asset-browser').classList.remove('hidden');
    renderAssetBrowser();
    vscode.postMessage({ type: 'listAssetImages', requestId });
  }

  function closeAssetBrowser() {
    const overlay = $('asset-browser');
    if (overlay) overlay.classList.add('hidden');
    state.assetBrowser = null;
  }

  function assetFolders(images) {
    const counts = new Map([['assets', 0]]);
    for (const image of images) {
      const parts = image.path.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        const folder = parts.slice(0, index).join('/');
        counts.set(folder, (counts.get(folder) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'));
  }

  function applyAssetSelection(assetPath) {
    const browser = state.assetBrowser;
    if (!browser || !assetPath) return;
    if (typeof browser.applyValue === 'function') mutate(() => browser.applyValue(assetPath));
    else {
      const node = nodeById(browser.nodeId);
      if (!node) { closeAssetBrowser(); toast('目标节点已不存在', true); return; }
      mutate(() => { node.params[browser.key] = assetPath; });
    }
    closeAssetBrowser();
    toast('已选择模板');
  }

  function restoreAssetBrowserAfterRoi() {
    if (!state.assetBrowser) return;
    const overlay = $('asset-browser');
    if (overlay) overlay.classList.remove('hidden');
    renderAssetBrowser();
  }

  function recaptureAsset(assetPath) {
    const browser = state.assetBrowser;
    if (!browser || !assetPath) return;
    if (!/\.(?:png|jpe?g|webp)$/i.test(assetPath)) {
      toast('重新截取仅支持 PNG、JPG 和 WebP 模板', true);
      return;
    }
    browser.selectedPath = assetPath;
    $('asset-browser').classList.add('hidden');
    requestRoi(browser.nodeId, browser.key, 'asset', { targetPath: assetPath, returnToAssetBrowser: true });
  }

  function renderAssetBrowser() {
    const browser = state.assetBrowser;
    const overlay = $('asset-browser');
    if (!browser || !overlay) return;
    overlay.innerHTML = '';

    const dialog = el('div', 'asset-browser-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', '选择模板');
    const head = el('div', 'asset-browser-head');
    const title = el('div', 'asset-browser-title', '选择模板');
    const close = el('button', 'icon-button', '×'); close.title = '关闭'; close.setAttribute('aria-label', '关闭'); close.addEventListener('click', closeAssetBrowser);
    head.appendChild(title); head.appendChild(close); dialog.appendChild(head);

    const toolbar = el('div', 'asset-browser-toolbar');
    const search = el('input', 'asset-search'); search.type = 'search'; search.placeholder = '搜索图片名称或路径'; search.value = browser.query;
    search.addEventListener('input', () => { browser.query = search.value; renderAssetBrowser(); const next = $('asset-browser').children[0]; if (next) { const input = next.children[1] && next.children[1].children[0]; if (input) { input.focus(); input.setSelectionRange?.(input.value.length, input.value.length); } } });
    toolbar.appendChild(search);
    const total = Array.isArray(browser.images) ? browser.images.length : 0;
    toolbar.appendChild(el('span', 'asset-total', browser.images === null ? '正在读取…' : `${total} 张图片`));
    dialog.appendChild(toolbar);

    const content = el('div', 'asset-browser-content');
    const folders = el('nav', 'asset-folders'); folders.setAttribute('aria-label', '资源文件夹');
    const grid = el('div', 'asset-grid');
    content.appendChild(folders); content.appendChild(grid); dialog.appendChild(content);

    const footer = el('div', 'asset-browser-footer');
    const selectedValue = el('div', 'asset-selected-path', browser.selectedPath || '未选择图片'); selectedValue.title = browser.selectedPath || '';
    const cancel = el('button', '', '取消'); cancel.addEventListener('click', closeAssetBrowser);
    const confirm = el('button', 'primary', '选择'); confirm.disabled = !browser.selectedPath; confirm.addEventListener('click', () => applyAssetSelection(browser.selectedPath));
    const actions = el('div', 'asset-browser-actions'); actions.appendChild(cancel); actions.appendChild(confirm);
    footer.appendChild(selectedValue); footer.appendChild(actions); dialog.appendChild(footer);
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
      const label = el('span', 'asset-folder-name', folder === 'assets' ? '全部图片' : folder.slice(folder.lastIndexOf('/') + 1)); label.title = folder;
      button.appendChild(label); button.appendChild(el('span', 'asset-folder-count', String(count)));
      button.addEventListener('click', () => { browser.folder = folder; renderAssetBrowser(); });
      folders.appendChild(button);
    }

    const query = browser.query.trim().toLocaleLowerCase('zh-CN');
    const visible = browser.images.filter((image) => {
      const inFolder = browser.folder === 'assets' || image.path.startsWith(`${browser.folder}/`);
      return inFolder && (!query || image.path.toLocaleLowerCase('zh-CN').includes(query));
    });
    if (!visible.length) {
      grid.appendChild(el('div', 'asset-browser-status', browser.images.length ? '没有匹配的图片' : 'assets 中暂无图片'));
      return;
    }

    const setSelection = (assetPath) => {
      browser.selectedPath = assetPath;
      selectedValue.textContent = assetPath;
      selectedValue.title = assetPath;
      confirm.disabled = false;
      for (const tile of grid.children) tile.classList.toggle('selected', tile.dataset.path === assetPath);
    };
    for (const asset of visible) {
      const tile = el('button', `asset-tile${asset.path === browser.selectedPath ? ' selected' : ''}`);
      tile.dataset.path = asset.path; tile.title = asset.path;
      const preview = el('span', 'asset-preview');
      const image = el('img'); image.src = asset.uri; image.alt = ''; image.loading = 'lazy';
      if (browser.cacheBust) image.src += `${image.src.includes('?') ? '&' : '?'}v=${browser.cacheBust}`;
      image.addEventListener('error', () => { preview.classList.add('failed'); image.remove(); preview.appendChild(el('span', '', '无法预览')); });
      preview.appendChild(image); tile.appendChild(preview);
      const filename = asset.path.slice(asset.path.lastIndexOf('/') + 1);
      tile.appendChild(el('span', 'asset-name', filename));
      tile.appendChild(el('span', 'asset-path', asset.path));
      tile.addEventListener('click', () => setSelection(asset.path));
      tile.addEventListener('dblclick', () => applyAssetSelection(asset.path));
      tile.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setSelection(asset.path);
        showMenu(event.clientX, event.clientY, [
          { label: '重新截取', run: () => recaptureAsset(asset.path) },
        ]);
      });
      grid.appendChild(tile);
    }
  }

  function workflowReference(file) {
    const rel = typeof file.rel === 'string' ? file.rel.replace(/\\/g, '/') : '';
    const match = rel.match(/(?:^|\/)workflows\/(.+)$/i);
    return match ? match[1] : String(file.name || '').replace(/\\/g, '/');
  }

  function workflowBrowserFiles() {
    return (Array.isArray(state.workflows) ? state.workflows : [])
      .filter((file) => file && file.uri !== state.docUri)
      .map((file) => ({ ...file, reference: workflowReference(file) }))
      .filter((file) => file.reference);
  }

  function openWorkflowBrowser(nodeId, key, currentReference) {
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

  function closeWorkflowBrowser() {
    const overlay = $('workflow-browser');
    if (overlay) overlay.classList.add('hidden');
    state.workflowBrowser = null;
  }

  function workflowFolders(files) {
    const counts = new Map([['workflows', files.length]]);
    for (const file of files) {
      const parts = file.reference.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        const folder = `workflows/${parts.slice(0, index).join('/')}`;
        counts.set(folder, (counts.get(folder) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'));
  }

  function applyWorkflowSelection(reference) {
    const browser = state.workflowBrowser;
    if (!browser || !reference) return;
    const node = nodeById(browser.nodeId);
    if (!node) { closeWorkflowBrowser(); toast('目标节点已不存在', true); return; }
    mutate(() => {
      const changed = node.params[browser.key] !== reference;
      node.params[browser.key] = reference;
      if (node.action === 'workflow.run' && browser.key === 'workflow' && changed) node.params.inputs = {};
    });
    closeWorkflowBrowser();
    toast('已选择子工作流');
  }

  function renderWorkflowBrowser() {
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
    const close = el('button', 'icon-button', '×'); close.title = '关闭'; close.setAttribute('aria-label', '关闭'); close.addEventListener('click', closeWorkflowBrowser);
    head.appendChild(title); head.appendChild(close); dialog.appendChild(head);

    const toolbar = el('div', 'workflow-browser-toolbar');
    const search = el('input', 'workflow-search'); search.type = 'search'; search.placeholder = '搜索脚本名称或路径'; search.value = browser.query;
    search.addEventListener('input', () => {
      browser.query = search.value;
      renderWorkflowBrowser();
      const next = $('workflow-browser').children[0];
      const input = next && next.children[1] && next.children[1].children[0];
      if (input) { input.focus(); input.setSelectionRange?.(input.value.length, input.value.length); }
    });
    toolbar.appendChild(search);
    toolbar.appendChild(el('span', 'workflow-total', `${files.length} 个脚本`));
    dialog.appendChild(toolbar);

    const content = el('div', 'workflow-browser-content');
    const folders = el('nav', 'workflow-folders'); folders.setAttribute('aria-label', '工作流文件夹');
    const list = el('div', 'workflow-list');
    content.appendChild(folders); content.appendChild(list); dialog.appendChild(content);

    const footer = el('div', 'workflow-browser-footer');
    const selectedValue = el('div', 'workflow-selected-path', browser.selectedReference || '未选择脚本'); selectedValue.title = browser.selectedReference || '';
    const cancel = el('button', '', '取消'); cancel.addEventListener('click', closeWorkflowBrowser);
    const confirm = el('button', 'primary', '选择'); confirm.disabled = !browser.selectedReference; confirm.addEventListener('click', () => applyWorkflowSelection(browser.selectedReference));
    const actions = el('div', 'workflow-browser-actions'); actions.appendChild(cancel); actions.appendChild(confirm);
    footer.appendChild(selectedValue); footer.appendChild(actions); dialog.appendChild(footer);
    overlay.appendChild(dialog);

    const folderEntries = workflowFolders(files);
    if (!folderEntries.some(([folder]) => folder === browser.folder)) browser.folder = 'workflows';
    for (const [folder, count] of folderEntries) {
      const button = el('button', `workflow-folder${folder === browser.folder ? ' selected' : ''}`);
      button.style.paddingLeft = `${10 + Math.max(0, folder.split('/').length - 1) * 14}px`;
      const label = el('span', 'workflow-folder-name', folder === 'workflows' ? '全部脚本' : folder.slice(folder.lastIndexOf('/') + 1)); label.title = folder;
      button.appendChild(label); button.appendChild(el('span', 'workflow-folder-count', String(count)));
      button.addEventListener('click', () => { browser.folder = folder; renderWorkflowBrowser(); });
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

    const setSelection = (reference) => {
      browser.selectedReference = reference;
      selectedValue.textContent = reference;
      selectedValue.title = reference;
      confirm.disabled = false;
      for (const item of list.children) item.classList.toggle('selected', item.dataset.reference === reference);
    };
    for (const file of visible) {
      const item = el('button', `workflow-file${file.reference === browser.selectedReference ? ' selected' : ''}`);
      item.dataset.reference = file.reference; item.title = [file.description, file.rel || file.reference].filter(Boolean).join('\n');
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

  function openRoiPicker(message) {
    if (!state.roi || state.roi.requestId !== message.requestId) return;
    let overlay = $('roi-picker'); overlay.innerHTML = ''; overlay.classList.remove('hidden');
    const dialog = el('div', 'roi-dialog'); const head = el('div', 'roi-head', state.roi.targetPath ? '重新截取模板' : state.roi.mode === 'asset' ? '截取模板' : '选择区域'); dialog.appendChild(head);
    const stage = el('div', 'roi-stage'); const image = el('img'); image.src = message.dataUrl; stage.appendChild(image); const selection = el('div', 'roi-selection'); stage.appendChild(selection); dialog.appendChild(stage);
    const actions = el('div', 'roi-actions'); const cancel = el('button', '', '取消'); const confirm = el('button', 'primary', '确认'); actions.appendChild(cancel); actions.appendChild(confirm); dialog.appendChild(actions); overlay.appendChild(dialog);
    const data = { x1: 0, y1: 0, x2: 0, y2: 0, dragging: false };
    const update = () => { selection.style.left = `${Math.min(data.x1, data.x2)}px`; selection.style.top = `${Math.min(data.y1, data.y2)}px`; selection.style.width = `${Math.abs(data.x2 - data.x1)}px`; selection.style.height = `${Math.abs(data.y2 - data.y1)}px`; };
    const point = (event) => { const rect = stage.getBoundingClientRect(); return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) }; };
    stage.addEventListener('mousedown', (event) => { const p = point(event); data.x1 = data.x2 = p.x; data.y1 = data.y2 = p.y; data.dragging = true; update(); });
    const move = (event) => { if (!data.dragging) return; const p = point(event); data.x2 = p.x; data.y2 = p.y; update(); };
    const up = () => { data.dragging = false; };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    cancel.addEventListener('click', () => {
      const request = state.roi;
      overlay.classList.add('hidden');
      state.roi = null;
      if (request && request.returnToAssetBrowser) restoreAssetBrowserAfterRoi();
    });
    confirm.addEventListener('click', () => {
      const rect = stage.getBoundingClientRect(); const ref = message.referenceResolution || state.raw.resolution || [1920, 1080];
      const x = Math.round(Math.min(data.x1, data.x2) * ref[0] / rect.width); const y = Math.round(Math.min(data.y1, data.y2) * ref[1] / rect.height);
      const width = Math.round(Math.abs(data.x2 - data.x1) * ref[0] / rect.width); const height = Math.round(Math.abs(data.y2 - data.y1) * ref[1] / rect.height);
      if (width < 1 || height < 1) { toast('请选择有效区域', true); return; }
      const request = state.roi; const node = nodeById(request.nodeId);
      if (request.mode === 'rect') {
        mutate(() => { node.params[request.key] = [x, y, width, height]; });
      } else {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        try {
          const context = canvas.getContext('2d'); context.drawImage(image, x * message.width / ref[0], y * message.height / ref[1], width * message.width / ref[0], height * message.height / ref[1], 0, 0, width, height);
          const extension = String(request.targetPath || '').slice(String(request.targetPath || '').lastIndexOf('.')).toLocaleLowerCase();
          const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
          vscode.postMessage({ type: 'saveTemplate', requestId: request.requestId, nodeId: request.nodeId, key: request.key, filename: `${request.nodeId}-${request.key}.png`, targetPath: request.targetPath, dataUrl: canvas.toDataURL(mime) });
        } catch (error) { toast(String(error), true); }
      }
      overlay.classList.add('hidden'); if (request.mode === 'rect') state.roi = null;
    });
  }

  function handleRunEvent(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'run_started') { state.activeRun = event.run_id; state.run.clear(); }
    if (event.type === 'step' && event.step_id) {
      const step = event.step || {};
      const workflowId = typeof step.workflow_id === 'string' ? step.workflow_id : '';
      if (workflowId && state.raw && workflowId !== state.raw.id) return;
      let status = String(step.status || '');
      if (status === 'succeeded' && step.action === 'vision.match_template') status = 'matched';
      if (status === 'failed' && step.error_category === 'not_matched') status = 'not_matched';
      state.run.set(String(event.step_id), {
        status,
        engineStatus: step.status,
        duration: step.duration_ms,
        error: step.error,
        errorCategory: step.error_category,
        thumbnail: event.thumbnail,
        screenshot: event.screenshot,
      });
    }
    if (event.type === 'run_finished') state.activeRun = null;
    render();
  }

  function normalizeRaw(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {
      schema_version: 3, id: 'new_behavior_tree', version: '3.0.0', description: '', resolution: [1920, 1080], root: 'root', blackboard: {}, limits: { timeout_seconds: 300, max_steps: 1000 },
      nodes: [{ id: 'root', type: 'root', children: ['main'] }, { id: 'main', type: 'sequence', children: ['task_1'] }, { id: 'task_1', type: 'task', action: 'core.capture', params: {} }],
    };
    if (!raw._layout || typeof raw._layout !== 'object') raw._layout = {};
    return raw;
  }

  function bindToolbar() {
    $('btn-zoom-in').addEventListener('click', () => zoomAt(1.2));
    $('btn-zoom-out').addEventListener('click', () => zoomAt(1 / 1.2));
    $('btn-back').addEventListener('click', () => {
      const goBack = (saveText) => vscode.postMessage({ type: 'goBackWorkflow', saveText });
      if (state.dirty) {
        const rect = $('btn-back').getBoundingClientRect();
        showMenu(rect.left, rect.bottom + 4, [
          { label: '保存并返回', run: () => goBack(JSON.stringify(state.raw, null, 2) + '\n') },
          { label: '放弃修改并返回', run: () => goBack(undefined) },
          'separator',
          { label: '取消', run: () => {} },
        ]);
      } else {
        goBack(undefined);
      }
    });
    $('workflow-select').addEventListener('change', () => {
      const picker = $('workflow-select');
      const uri = picker.value;
      if (!uri || uri === state.docUri) return;
      const switchTo = (saveText) => {
        state.docUri = uri; // 乐观更新，切换失败由 init 纠正
        vscode.postMessage({ type: 'switchWorkflow', uri, saveText });
      };
      if (state.dirty) {
        const rect = picker.getBoundingClientRect();
        showMenu(rect.left, rect.bottom + 4, [
          { label: '保存并切换', run: () => switchTo(JSON.stringify(state.raw, null, 2) + '\n') },
          { label: '放弃修改并切换', run: () => switchTo(undefined) },
          'separator',
          { label: '取消', run: () => { picker.value = state.docUri; } },
        ]);
      } else {
        switchTo(undefined);
      }
    });
    $('instance-select').addEventListener('change', () => {
      state.instanceId = $('instance-select').value;
      renderInstancePicker();
      vscode.postMessage({ type: 'selectInstance', instanceId: state.instanceId });
    });
    $('btn-run').addEventListener('click', () => vscode.postMessage({
      type: 'runWorkflow',
      uri: state.docUri,
      instanceId: state.instanceId,
      text: JSON.stringify(state.raw, null, 2) + '\n',
    }));
    $('btn-stop').addEventListener('click', () => vscode.postMessage({ type: 'stopWorkflow' }));
    $('btn-save').addEventListener('click', () => { vscode.postMessage({ type: 'save', text: JSON.stringify(state.raw, null, 2) + '\n' }); setDirty(false); });
    $('btn-more').addEventListener('click', () => {
      const rect = $('btn-more').getBoundingClientRect();
      showMenu(rect.right, rect.bottom + 4, [
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

  function searchNodeByName(value) {
    const query = String(value || '').trim();
    if (!query) { toast('请输入卡片 name', true); return; }
    const normalized = query.toLocaleLowerCase();
    const matches = nodes().filter((node) => String(node && node.name || '').trim().toLocaleLowerCase().includes(normalized));
    if (matches.length === 0) {
      state.nodeSearch = { query: normalized, ids: [], index: -1 };
      toast(`没有找到 name 包含“${query}”的卡片`, true);
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
    toast(`卡片 ${index + 1}/${matches.length}：${String(target.name).trim()}`);
  }

  function executeEditorCommand(command, value) {
    if (command === 'undo') undo();
    else if (command === 'redo') redo();
    else if (command === 'cut') cutSelection();
    else if (command === 'copy') copySelection();
    else if (command === 'paste') pasteClipboard();
    else if (command === 'deleteSelection') deleteSelection();
    else if (command === 'selectAll') {
      state.selected = new Set(nodes().map((node) => node.id));
      state.selectedEdge = null; state.selectedRun = null; state.selectedVariable = ''; state.inspector = 'node'; render();
    }
    else if (command === 'clearSelection') {
      state.selected.clear(); state.selectedEdge = null; state.selectedRun = null; state.selectedVariable = ''; render();
    }
    else if (command === 'addTask') addNode('task');
    else if (command === 'addSelector') addNode('selector');
    else if (command === 'addSequence') addNode('sequence');
    else if (command === 'addParallel') addNode('simple_parallel');
    else if (command === 'addGenericParallel') addNode('parallel');
    else if (command === 'addRepeatUntil') addNode('repeat_until');
    else if (command === 'addBranch') addNode('branch');
    else if (command === 'addSwitch') addNode('switch');
    else if (command === 'addInstanceParallel') addNode('instance_parallel');
    else if (command === 'autoLayout') { autoLayout(); fitView(); }
    else if (command === 'fitView') fitView();
    else if (command === 'exportImage') exportFullCanvasImage();
    else if (command === 'workflowSettings') { state.inspector = 'workflow'; state.selected.clear(); state.selectedEdge = null; state.selectedRun = null; renderInspector(); }
    else if (command === 'variables') {
      if (!state.raw.blackboard || typeof state.raw.blackboard !== 'object' || Array.isArray(state.raw.blackboard)) state.raw.blackboard = {};
      if (!state.raw.blackboard[state.selectedVariable]) state.selectedVariable = Object.keys(state.raw.blackboard)[0] || '';
      state.inspector = 'variables'; state.selected.clear(); state.selectedEdge = null; state.selectedRun = null; render();
    }
    else if (command === 'selectVariable') {
      const name = String(value ?? '');
      if (!state.raw.blackboard || !Object.prototype.hasOwnProperty.call(state.raw.blackboard, name)) return;
      state.selectedVariable = name;
      state.inspector = 'variables'; state.selected.clear(); state.selectedEdge = null; state.selectedRun = null; render();
    }
    else if (command === 'addVariable') addVariable();
    else if (command === 'addVariableCard') addVariableCardCommand(value);
    else if (command === 'searchNodeByName') searchNodeByName(value);
    else if (command === 'focusNode') {
      const id = String(value ?? '');
      const node = nodeById(id);
      if (!node) return;
      state.selected = new Set([id]);
      state.selectedEdge = null;
      state.selectedRun = null;
      state.inspector = 'node';
      focusNode(id);
    }
    else if (command === 'setInspectorSelection') {
      const selection = value && typeof value === 'object' ? value : { kind: 'none' };
      state.selected.clear();
      state.selectedEdge = null;
      state.selectedRun = null;
      state.selectedVariable = '';
      if (selection.kind === 'workflow') state.inspector = 'workflow';
      else if (selection.kind === 'variables') {
        state.inspector = 'variables';
        state.selectedVariable = String(selection.name || '');
      } else if (selection.kind === 'run') {
        state.inspector = 'node';
        state.selectedRun = { nodeId: String(selection.nodeId || ''), index: Number(selection.index || 0) };
      } else if (selection.kind === 'edge') {
        state.inspector = 'node';
        state.selectedEdge = { parent: String(selection.parent || ''), child: String(selection.child || '') };
      } else if (selection.kind === 'node') {
        state.inspector = 'node';
        const id = String(selection.nodeId || '');
        if (nodeById(id)) state.selected.add(id);
      } else state.inspector = 'node';
      render();
    }
  }

  graph.addEventListener('mousedown', onPointerDown);
  graph.addEventListener('mousemove', onPointerMove);
  graph.addEventListener('mouseup', onPointerUp);
  graph.addEventListener('mousemove', (event) => { state.mouse = worldPoint(event); });
  graph.addEventListener('pointermove', (event) => { if (state.connect || state.variableConnect) onPointerMove(event); });
  graph.addEventListener('pointerup', (event) => { if (state.connect || state.variableConnect) onPointerUp(event); });
  graph.addEventListener('pointercancel', () => { cancelConnection(); cancelVariableConnection(); });
  graph.addEventListener('mouseleave', (event) => { if (state.drag || state.connect || state.variableConnect) onPointerMove(event); });
  graph.addEventListener('wheel', (event) => { event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY); }, { passive: false });
  graph.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (contextMenuSuppressedByPan()) return;
    const point = worldPoint(event);
    const items = [
      { label: '＋ Task', run: () => addNode('task', point) }, { label: '＋ Selector', run: () => addNode('selector', point) },
      { label: '＋ Sequence', run: () => addNode('sequence', point) }, { label: '＋ Simple Parallel', run: () => addNode('simple_parallel', point) },
      { label: '＋ Parallel', run: () => addNode('parallel', point) }, { label: '＋ Repeat Until', run: () => addNode('repeat_until', point) },
      { label: '＋ Branch', run: () => addNode('branch', point) }, { label: '＋ Switch', run: () => addNode('switch', point) },
      { label: '＋ Instance Parallel', run: () => addNode('instance_parallel', point) },
      'separator',
    ];
    if (state.selected.size > 0) {
      items.push(
        { label: '复制 (Ctrl+C)', run: () => copySelection() },
        { label: '剪切 (Ctrl+X)', run: () => cutSelection() },
      );
    }
    if (state.clipboard && state.clipboard.length > 0) {
      items.push({ label: `粘贴 (Ctrl+V) · ${state.clipboard.length} 个节点`, run: () => pasteClipboard(point) });
    }
    items.push('separator', { label: '自动排列', run: () => { autoLayout(); fitView(); } });
    showMenu(event.clientX, event.clientY, items);
  });
  window.addEventListener('mousemove', (event) => { if (state.drag || state.connect || state.variableConnect) onPointerMove(event); });
  window.addEventListener('mouseup', onPointerUp);

  // 从桌面端变量面板拖入变量：允许放置时显示跟随光标的提示，落点吸附兼容端点。
  let dropGhost = null;
  const variableDragAccepted = (event) => Boolean(event.dataTransfer && Array.from(event.dataTransfer.types || []).includes(VARIABLE_DRAG_MIME));
  const hideVariableDropGhost = () => { if (dropGhost) dropGhost.classList.add('hidden'); };
  wrap.addEventListener('dragover', (event) => {
    if (!variableDragAccepted(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (!dropGhost) dropGhost = el('div', 'variable-drop-ghost');
    const rect = wrap.getBoundingClientRect();
    dropGhost.textContent = '＋ 变量卡片';
    dropGhost.style.left = `${event.clientX - rect.left + 14}px`;
    dropGhost.style.top = `${event.clientY - rect.top + 12}px`;
    dropGhost.classList.remove('hidden');
  });
  wrap.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget || !wrap.contains(event.relatedTarget)) hideVariableDropGhost();
  });
  wrap.addEventListener('drop', (event) => {
    hideVariableDropGhost();
    if (!variableDragAccepted(event)) return;
    event.preventDefault();
    const name = event.dataTransfer.getData(VARIABLE_DRAG_MIME);
    if (!name) return;
    placeVariableCard(name, worldPoint(event));
  });
  wrap.addEventListener('pointerdown', hideVariableDropGhost);
  window.addEventListener('keydown', (event) => {
    const tag = event.target && event.target.tagName;
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (event.key === 'Escape') { if (state.connect) cancelConnection(); if (state.variableConnect) cancelVariableConnection(); state.drag = null; state.marquee = null; hideMenus(); const lightbox = $('lightbox'); if (lightbox) lightbox.classList.add('hidden'); closeAssetBrowser(); closeTemplateCheck(); render(); }
    if (!editing && event.key === 'Delete') {
      event.preventDefault();
      if (state.selectedRun) {
        const selection = state.selectedRun;
        const node = nodeById(selection.nodeId);
        if (node && Array.isArray(node.runs) && node.runs[selection.index]) removeInstanceRun(node, selection.index);
        else { state.selectedRun = null; render(); }
      } else deleteSelection();
    }
    if (!editing && event.ctrlKey && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); }
    if (!editing && event.ctrlKey && event.key.toLowerCase() === 'x') { event.preventDefault(); cutSelection(); }
    if (!editing && event.ctrlKey && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteClipboard(); }
    if (!editing && event.ctrlKey && event.key.toLowerCase() === 'a') { event.preventDefault(); executeEditorCommand('selectAll'); }
    if (!editing && event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); $('btn-save')?.click(); }
    if (!editing && event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    if (!editing && event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    if (!editing && event.key === 'Home') { event.preventDefault(); fitView(); }
    if (!editing && event.key.toLowerCase() === 'f' && state.selected.size === 1) {
      const node = nodeById([...state.selected][0]); const pos = position(node); const rect = wrap.getBoundingClientRect();
      state.panX = rect.width / 2 - (pos.x + NODE_W / 2) * state.zoom; state.panY = rect.height / 2 - (pos.y + nodeHeight(node) / 2) * state.zoom; render();
    }
  });
  $('minimap').addEventListener('click', (event) => {
    const mini = $('minimap'); const rect = mini.getBoundingClientRect(); const box = bounds();
    const x = box.minX + (event.clientX - rect.left) / rect.width * (box.maxX - box.minX); const y = box.minY + (event.clientY - rect.top) / rect.height * (box.maxY - box.minY);
    const canvas = wrap.getBoundingClientRect(); state.panX = canvas.width / 2 - x * state.zoom; state.panY = canvas.height / 2 - y * state.zoom; render();
  });

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'init') {
      let raw = null;
      try { raw = JSON.parse(message.document.text); } catch { raw = null; }
      // 同一文档的重复初始化（如保存后的外部变更同步）保留当前视口；
      // 只有切换/重新打开其他工作流时才重新适配。
      const sameDocument = Boolean(message.document && message.document.uri && message.document.uri === state.docUri);
      state.raw = normalizeRaw(raw); state.catalog = Array.isArray(message.catalog) ? message.catalog : [];
      state.assetsBaseUri = typeof message.assetsBaseUri === 'string' ? message.assetsBaseUri.replace(/\/?$/, '/') : '';
      state.refs = message.refs || { blackboard: [], nodes: [] }; state.issues = message.issues || [];
      state.workflows = Array.isArray(message.workflows) ? message.workflows.filter((item) => item && typeof item.uri === 'string') : [];
      state.docUri = message.document.uri || '';
      state.documentName = message.document.name || '';
      state.workflowTrail = Array.isArray(message.workflowTrail) ? message.workflowTrail : [];
      state.instances = Array.isArray(message.instances) ? message.instances.filter((item) => item && typeof item.id === 'string' && item.id) : [];
      state.instanceId = typeof message.selectedInstance === 'string' ? message.selectedInstance : '';
      state.selected.clear(); state.selectedEdge = null; state.selectedRun = null; state.selectedVariable = ''; state.undo = []; state.redo = []; state.run.clear(); state.inspector = 'node'; state.nodeSearch = { query: '', ids: [], index: -1 };
      $('btn-back').classList.toggle('hidden', !message.canGoBack);
      renderWorkflowPicker(); renderWorkflowBreadcrumb(); renderInstancePicker(); ensureLayout(); setDirty(false); render();
      setTimeout(() => { if (!sameDocument) fitView(); }, 0);
    } else if (message.type === 'runEvent') handleRunEvent(message.event);
    else if (message.type === 'runtimeInstances') {
      state.instances = Array.isArray(message.instances) ? message.instances.filter((item) => item && typeof item.id === 'string' && item.id) : [];
      state.instanceId = typeof message.selectedInstance === 'string' ? message.selectedInstance : state.instanceId;
      renderInstancePicker();
    }
    else if (message.type === 'runReplay') { state.run.clear(); (message.events || []).forEach(handleRunEvent); }
    else if (message.type === 'roiPickerImage') openRoiPicker(message);
    else if (message.type === 'roiPickerCancelled' || message.type === 'roiPickerError') {
      const request = state.roi;
      const overlay = $('roi-picker'); if (overlay) overlay.classList.add('hidden');
      state.roi = null;
      if (request && request.returnToAssetBrowser) restoreAssetBrowserAfterRoi();
      if (message.message) toast(message.message, true);
    }
    else if (message.type === 'templateSaved' && state.roi && state.roi.requestId === message.requestId) {
      const request = state.roi;
      const browser = request.returnToAssetBrowser ? state.assetBrowser : null;
      if (browser && typeof browser.applyValue === 'function') mutate(() => browser.applyValue(message.path));
      else {
        const node = nodeById(message.nodeId); if (node) mutate(() => { node.params[message.key] = message.path; });
      }
      state.roi = null;
      if (request.returnToAssetBrowser && state.assetBrowser) {
        state.assetBrowser.selectedPath = message.path;
        state.assetBrowser.cacheBust = Date.now();
        restoreAssetBrowserAfterRoi();
      }
      toast(request.targetPath ? '模板已重新截取' : '模板已保存');
    }
    else if (message.type === 'assetImages' && state.assetBrowser && state.assetBrowser.requestId === message.requestId) {
      state.assetBrowser.images = Array.isArray(message.images) ? message.images.filter((item) => item && typeof item.path === 'string' && typeof item.uri === 'string') : [];
      renderAssetBrowser();
    }
    else if (message.type === 'assetImagesError' && state.assetBrowser && state.assetBrowser.requestId === message.requestId) { closeAssetBrowser(); toast(message.message || '读取 assets 图片失败', true); }
    else if (message.type === 'templateCheckResult' && state.templateCheck && state.templateCheck.requestId === message.requestId) {
      const matches = Array.isArray(message.matches) ? message.matches.filter((item) => item && [item.x, item.y, item.width, item.height, item.confidence].every(Number.isFinite)) : [];
      state.templateCheck.status = 'success';
      state.templateCheck.result = { dataUrl: message.dataUrl, width: message.width, height: message.height, roi: message.roi, matches };
      renderTemplateCheck();
    }
    else if (message.type === 'templateCheckError' && state.templateCheck && state.templateCheck.requestId === message.requestId) { state.templateCheck.status = 'error'; state.templateCheck.error = message.message || '模板检查失败'; renderTemplateCheck(); }
    else if (message.type === 'canvasImageSaved') { setExportBusy(false); toast('完整画布图片已保存'); }
    else if (message.type === 'canvasImageCancelled') { setExportBusy(false); }
    else if (message.type === 'canvasImageError') { setExportBusy(false); toast(message.message || '保存完整画布图片失败', true); }
    else if (message.type === 'instanceSelected') { state.instanceId = String(message.instanceId || ''); renderInstancePicker(); }
    else if (message.type === 'externalChange') { const banner = $('external-banner'); banner.textContent = '文件已在外部修改'; banner.classList.remove('hidden'); }
    else if (message.type === 'replaceDocument') replaceDocument(String(message.text || ''), message.recordHistory === true);
    else if (message.type === 'editorCommand') executeEditorCommand(String(message.command || ''), message.value);
  });

  for (const id of ['lightbox', 'roi-picker', 'asset-browser', 'workflow-browser', 'template-check']) {
    const overlay = el('div', `overlay hidden`); overlay.id = id; document.body.appendChild(overlay);
    if (id === 'asset-browser') overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeAssetBrowser(); });
    if (id === 'workflow-browser') overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeWorkflowBrowser(); });
    if (id === 'template-check') overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeTemplateCheck(); });
  }
  bindToolbar();
  window.__btEditor = { state, connect, disconnect, autoLayout, render, exportFullCanvasImage, copySelection, cutSelection, pasteClipboard, snapshot: () => clone(state.raw), collectExportTemplatePaths, applyInlineThumbnails, placeVariableCard, variableCardList, nodeVariablePins, connectVariableToPin };
  vscode.postMessage({ type: 'ready' });
})();
