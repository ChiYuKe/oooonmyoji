(() => {
  'use strict';

  const vscode = acquireVsCodeApi();
  const NS = 'http://www.w3.org/2000/svg';
  const NODE_W = 260;
  const BASE_H = 96;
  const DECO_H = 22;
  const PORT_R = 7;
  const PREVIEW = { x: 154, y: 38, width: 92, height: 44 };
  const TYPES = ['root', 'selector', 'sequence', 'simple_parallel', 'task'];
  const TYPE_LABEL = { root: 'ROOT', selector: 'SELECTOR', sequence: 'SEQUENCE', simple_parallel: 'SIMPLE PARALLEL', task: 'TASK' };
  const TYPE_ICON = { root: '◆', selector: '?', sequence: '→', simple_parallel: '∥', task: '▣' };
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
    instances: [],
    instanceId: '',
    selected: new Set(),
    selectedEdge: null,
    zoom: 1,
    panX: 80,
    panY: 48,
    drag: null,
    connect: null,
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

  const $ = (id) => document.getElementById(id);
  const graph = $('graph');
  const wrap = $('canvas-wrap');
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const nodes = () => Array.isArray(state.raw && state.raw.nodes) ? state.raw.nodes : [];
  const nodeById = (id) => nodes().find((node) => node && node.id === id) || null;
  const catalogByName = (name) => state.catalog.find((item) => item.name === name) || null;
  const nodeHeight = (node) => BASE_H + (Array.isArray(node.decorators) ? node.decorators.length * DECO_H : 0);
  const layout = () => {
    if (!state.raw._layout || typeof state.raw._layout !== 'object' || Array.isArray(state.raw._layout)) state.raw._layout = {};
    return state.raw._layout;
  };
  const position = (node) => {
    const value = layout()[node.id];
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : { x: 0, y: 0 };
  };

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
    return true;
  }

  function disconnect(parentId, childId) {
    const parent = nodeById(parentId);
    if (!parent || !Array.isArray(parent.children)) return;
    const index = parent.children.indexOf(childId);
    if (index >= 0) parent.children.splice(index, 1);
  }

  function addNode(type, at) {
    const prefix = type === 'simple_parallel' ? 'parallel' : type;
    const node = { id: nextId(prefix), type, children: [] };
    if (type === 'task') {
      delete node.children;
      node.action = state.catalog[0] ? state.catalog[0].name : 'core.capture';
      node.params = {};
    }
    mutate(() => {
      nodes().push(node);
      const point = at || worldPoint({ clientX: wrap.clientWidth / 2, clientY: wrap.clientHeight / 2 });
      layout()[node.id] = { x: Math.round(point.x - NODE_W / 2), y: Math.round(point.y - BASE_H / 2) };
      state.selected = new Set([node.id]);
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
    return {
      minX: Math.min(...points.map((item) => item.pos.x)),
      minY: Math.min(...points.map((item) => item.pos.y)),
      maxX: Math.max(...points.map((item) => item.pos.x + NODE_W)),
      maxY: Math.max(...points.map((item) => item.pos.y + nodeHeight(item.node))),
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

  function render() {
    if (!state.raw) return;
    ensureLayout();
    graph.innerHTML = '';
    const root = svgEl('g', { class: 'graph-world', transform: `translate(${state.panX},${state.panY}) scale(${state.zoom})` }, graph);
    const wires = svgEl('g', { class: 'wires' }, root);
    for (const parent of nodes()) {
      const children = Array.isArray(parent.children) ? parent.children : [];
      children.forEach((childId, order) => renderEdge(wires, parent, childId, order));
    }
    if (state.connect) renderConnection(wires);
    const cards = svgEl('g', { class: 'cards' }, root);
    nodes().forEach((node) => renderNode(cards, node));
    if (state.marquee) {
      const box = state.marquee;
      svgEl('rect', { class: 'marquee', x: Math.min(box.x1, box.x2), y: Math.min(box.y1, box.y2), width: Math.abs(box.x2 - box.x1), height: Math.abs(box.y2 - box.y1) }, root);
    }
    $('zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
    updateIssueBadge();
    renderMinimap();
    renderInspector();
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
      state.inspector = 'node';
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
    if (run && run.status) classes.push(`run-${run.status}`);
    const group = svgEl('g', { class: classes.join(' '), transform: `translate(${pos.x},${pos.y})`, 'data-id': node.id }, layer);
    group.dataset.id = node.id;
    const body = svgEl('rect', { class: 'node-box', width: NODE_W, height, rx: 5 }, group);
    svgEl('rect', { class: 'node-head', width: NODE_W, height: 32, rx: 5 }, group);
    svgEl('rect', { class: 'node-head-square', y: 26, width: NODE_W, height: 8 }, group);
    svgEl('text', { class: 'node-icon', x: 13, y: 21 }, group).textContent = TYPE_ICON[node.type] || '•';
    svgEl('text', { class: 'node-type', x: 34, y: 20 }, group).textContent = TYPE_LABEL[node.type] || node.type;
    if (run && run.status) {
      svgEl('rect', { class: 'run-badge', x: NODE_W - 72, y: 7, width: 62, height: 18, rx: 3 }, group);
      svgEl('circle', { class: 'run-dot', cx: NODE_W - 63, cy: 16, r: 4 }, group);
      svgEl('text', { class: 'run-label', x: NODE_W - 15, y: 20, 'text-anchor': 'end' }, group).textContent = RUN_LABEL[run.status] || run.status;
      const title = svgEl('title', {}, group);
      title.textContent = [RUN_LABEL[run.status] || run.status, run.error].filter(Boolean).join('：');
    }
    svgEl('text', { class: 'node-name', x: 14, y: 53 }, group).textContent = node.name || node.id;
    const subtitle = node.type === 'task'
      ? (subRef ? `⇢ ${subRef.split(/[\\/]/).pop()}` : (node.action || '未选择 Action'))
      : compositeSubtitle(node);
    svgEl('text', { class: 'node-subtitle', x: 14, y: 72 }, group).textContent = subtitle;
    if (run && run.thumbnail) {
      const uri = run.thumbnail.startsWith('data:') ? run.thumbnail : `data:image/png;base64,${run.thumbnail}`;
      renderNodePreview(group, { uri, path: '' }, 'step-thumb', 'xMidYMid slice', run.screenshot || uri);
    } else if (template) renderNodePreview(group, template, 'template-thumb', 'xMidYMid meet');
    else if (run && Number.isFinite(run.duration)) svgEl('text', { class: 'node-duration', x: NODE_W - 12, y: 72, 'text-anchor': 'end' }, group).textContent = `${run.duration} ms`;
    const decorators = Array.isArray(node.decorators) ? node.decorators : [];
    decorators.forEach((decorator, index) => {
      const y = BASE_H + index * DECO_H;
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
    body.addEventListener('mousedown', (event) => {
      if (event.button !== 0) { startNodeDrag(event, node.id); return; }
      const now = Date.now();
      const sameNode = lastClickNode === node.id;
      const nearby = Math.abs(event.clientX - lastClickX) < 8 && Math.abs(event.clientY - lastClickY) < 8;
      const isDouble = now - lastClickTime < 300 && sameNode && nearby;
      lastClickTime = now; lastClickNode = node.id; lastClickX = event.clientX; lastClickY = event.clientY;
      if (isDouble) {
        event.preventDefault(); event.stopPropagation();
        if (subRef) { requestOpenSubWorkflow(node.id); return; }
        state.selected = new Set([node.id]); state.inspector = 'node'; render();
        return;
      }
      startNodeDrag(event, node.id);
    });
    if (subRef) {
      // 子流程节点右键菜单：直接进入子工作流视图
      body.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.selected = new Set([node.id]); render();
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

  /** 若节点是子流程 task（workflow.run），返回子工作流引用，否则返回空字符串。 */
  function subWorkflowRef(node) {
    if (!node || node.type !== 'task' || node.action !== 'workflow.run') return '';
    const value = node.params && typeof node.params.workflow === 'string' ? node.params.workflow : '';
    return value.trim();
  }

  /** 请求打开子工作流视图；当前有未保存修改时先询问保存/放弃。 */
  function requestOpenSubWorkflow(nodeId) {
    const doOpen = (saveText) => vscode.postMessage({ type: 'openSubWorkflow', nodeId, saveText });
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
    return `${count} 个有序子节点`;
  }

  function decoratorLabel(decorator) {
    if (!decorator) return 'Decorator';
    if (decorator.type === 'condition') return `Condition · ${conditionSummary(decorator.expression)}`;
    if (decorator.type === 'cooldown') return `Cooldown · ${decorator.seconds}s`;
    if (decorator.type === 'timeout') return `Time Limit · ${decorator.seconds}s`;
    if (decorator.type === 'retry') return `Retry · ${decorator.attempts} 次`;
    if (decorator.type === 'repeat') return `Repeat · ${decorator.count} 次`;
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

  function startNodeDrag(event, id) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.shiftKey && !state.selected.has(id)) state.selected = new Set([id]);
    else if (event.shiftKey) {
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    }
    state.selectedEdge = null;
    state.inspector = 'node';
    const point = worldPoint(event);
    const origins = {};
    for (const selected of state.selected) origins[selected] = { ...position(nodeById(selected)) };
    state.drag = { kind: 'nodes', start: point, origins, before: snapshot(), moved: false };
    render();
  }

  function onPointerDown(event) {
    hideMenus();
    if (event.button === 1 || event.button === 2 || (event.button === 0 && event.altKey)) {
      event.preventDefault();
      state.drag = { kind: 'pan', x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      return;
    }
    if (event.button === 0 && event.target === graph) {
      const point = worldPoint(event);
      if (!event.shiftKey) state.selected.clear();
      state.selectedEdge = null;
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
    if (!state.drag) return;
    if (state.drag.kind === 'pan') {
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
    if (!state.drag) return;
    if (state.drag.kind === 'nodes' && state.drag.moved && snapshot() !== state.drag.before) {
      state.undo.push(state.drag.before); state.redo = []; setDirty();
    }
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

  function showMenu(x, y, items) {
    hideMenus();
    const menu = el('div', 'context-menu');
    menu.style.left = `${x}px`; menu.style.top = `${y}px`;
    for (const item of items) {
      if (item === 'separator') { menu.appendChild(el('div', 'menu-separator')); continue; }
      const button = el('button', item.danger ? 'danger' : '', item.label);
      button.addEventListener('click', () => { hideMenus(); item.run(); });
      menu.appendChild(button);
    }
    document.body.appendChild(menu);
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
    const instances = state.instances.length ? state.instances : [{ id: 'mumu-0' }];
    for (const instance of instances) {
      const suffix = instance.backend ? ` (${instance.backend})` : '';
      const name = instance.displayName ? ` · ${instance.displayName}` : '';
      const option = el('option', '', `${instance.id}${name}${suffix}`);
      option.value = instance.id;
      picker.appendChild(option);
    }
    if (!instances.some((instance) => instance.id === state.instanceId)) state.instanceId = instances[0].id;
    picker.value = state.instanceId;
    const selected = instances.find((instance) => instance.id === state.instanceId);
    picker.title = selected
      ? [selected.id, selected.displayName, selected.adbSerial].filter(Boolean).join(' · ')
      : `运行实例：${state.instanceId}`;
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
      || state.inspector === 'blackboard'
      || Boolean(state.selectedEdge)
      || Boolean(selectedNode);
    $('inspector').classList.toggle('hidden', !open);
    $('editor-main').classList.toggle('inspector-open', open);
    if (!open) return;
    if (state.inspector === 'workflow') { renderWorkflowInspector(); return; }
    if (state.inspector === 'blackboard') { renderBlackboardInspector(); return; }
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
        node.action = state.catalog[0] ? state.catalog[0].name : 'core.capture'; node.params = {};
      } else {
        delete node.action; delete node.params;
        node.children = [];
        if (type === 'simple_parallel') node.finish_mode = 'abort_background'; else delete node.finish_mode;
      }
    });
  }

  function renderTaskInspector(body, node) {
    section(body, 'Action');
    const row = field(body, '实现');
    row.appendChild(selectInput(node.action || '', state.catalog.map((item) => ({ value: item.name, label: item.name })), (value) => mutate(() => { node.action = value; node.params = {}; })));
    const spec = catalogByName(node.action);
    if (spec && spec.description) body.appendChild(el('div', 'description', spec.description));
    section(body, '参数');
    if (!node.params || typeof node.params !== 'object' || Array.isArray(node.params)) node.params = {};
    if (!spec || !Object.keys(spec.parameters || {}).length) {
      body.appendChild(el('div', 'empty-section', '无参数'));
      return;
    }
    for (const [name, definition] of Object.entries(spec.parameters)) renderParameter(body, node, name, definition);
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

  function renderParameter(body, node, name, definition) {
    const block = el('div', 'parameter-block');
    const heading = el('div', 'parameter-heading');
    heading.appendChild(el('span', '', `${name}${definition.required ? ' *' : ''}`));
    const exists = Object.prototype.hasOwnProperty.call(node.params, name);
    if (!definition.required && definition.default === undefined) {
      const enabled = checkbox(exists, (checked) => mutate(() => { if (checked) node.params[name] = defaultValue(definition); else delete node.params[name]; }));
      const toggleLabel = el('label', 'parameter-enable'); toggleLabel.appendChild(enabled); toggleLabel.appendChild(el('span', '', '启用'));
      heading.appendChild(toggleLabel);
    }
    if (name === 'threshold' && ['vision.match_template', 'vision.wait_template'].includes(node.action)) {
      const check = el('button', 'parameter-check', '检查'); check.title = '获取当前画面并执行模板匹配';
      let pointerPending = false;
      check.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        pointerPending = true;
        setTimeout(() => { if (pointerPending) { pointerPending = false; requestTemplateCheck(node.id); } }, 0);
      });
      check.addEventListener('click', () => { if (!pointerPending) requestTemplateCheck(node.id); });
      heading.appendChild(check);
    }
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
    }), 'value-mode');
    block.appendChild(mode);
    if (bound) {
      const refs = allRefs(node, definition);
      const ref = value.ref;
      const options = refs.includes(ref) ? refs : [ref, ...refs];
      block.appendChild(selectInput(ref, options.map((item) => ({
        value: item,
        label: item || '无可用引用',
      })), (next) => mutate(() => { node.params[name] = { ref: next }; }), 'full'));
    } else {
      block.appendChild(literalControl(node, name, definition, value));
    }
    body.appendChild(block);
  }

  function literalControl(node, name, definition, value) {
    const set = (next) => mutate(() => { node.params[name] = next; });
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
    const workflowParameter = node.action === 'workflow.run' && name === 'workflow';
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
    if (node.type === 'simple_parallel') {
      body.appendChild(el('div', 'description', '第 1 个子节点是主 Task，第 2 个是后台分支。'));
      const finish = field(body, '结束模式');
      finish.appendChild(selectInput(node.finish_mode || 'abort_background', [
        { value: 'abort_background', label: '主任务结束时中止后台' },
        { value: 'wait_for_background', label: '主任务结束后等待后台' },
      ], (value) => mutate(() => { node.finish_mode = value; })));
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
    ], (type) => {
      if (!type) return;
      mutate(() => {
        if (!Array.isArray(node.decorators)) node.decorators = [];
        const defaults = { condition: { type, expression: true }, cooldown: { type, seconds: 1 }, timeout: { type, seconds: 10 }, retry: { type, attempts: 2, delay_seconds: 0 }, repeat: { type, count: 2 } };
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
      shell.appendChild(selectInput(ref || '', (options.length ? options : ['']).map((value) => ({ value, label: value || '无可用引用' })), (value) => mutate(() => { decorator.expression = { exists: { ref: value } }; }), 'full'));
    } else if (['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'].includes(op)) {
      const refs = allRefs(node);
      const operands = Array.isArray(expression[op]) ? expression[op] : [{ ref: refs[0] || '' }, null];
      const left = operands[0] && operands[0].ref ? operands[0].ref : refs[0] || '';
      const options = left && !refs.includes(left) ? [left, ...refs] : refs;
      shell.appendChild(selectInput(left, (options.length ? options : ['']).map((value) => ({ value, label: value || '无可用引用' })), (value) => mutate(() => { decorator.expression[op][0] = { ref: value }; }), 'full'));
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

  function renderBlackboardInspector() {
    const body = clearInspector('黑板');
    if (!state.raw.blackboard || typeof state.raw.blackboard !== 'object' || Array.isArray(state.raw.blackboard)) state.raw.blackboard = {};
    const add = el('button', '', '＋ 添加键'); add.addEventListener('click', () => mutate(() => { let index = 1; while (state.raw.blackboard[`key_${index}`]) index += 1; state.raw.blackboard[`key_${index}`] = { type: 'string' }; }));
    section(body, '键定义', add);
    const entries = Object.entries(state.raw.blackboard);
    if (!entries.length) body.appendChild(el('div', 'empty-section', '无黑板键'));
    entries.forEach(([name, definition]) => {
      const block = el('div', 'blackboard-row');
      const top = el('div', 'inline-control');
      top.appendChild(textInput(name, (value) => renameBlackboard(name, value.trim())));
      top.appendChild(selectInput(definition.type || 'string', ['string', 'number', 'integer', 'boolean', 'rect', 'asset', 'path', 'array', 'object', 'any'].map((value) => ({ value, label: value })), (value) => mutate(() => { definition.type = value; delete definition.items; delete definition.properties; })));
      const remove = el('button', 'icon-button danger', '×'); remove.addEventListener('click', () => mutate(() => { delete state.raw.blackboard[name]; })); top.appendChild(remove); block.appendChild(top);
      const required = el('label', 'check-label'); required.appendChild(checkbox(definition.required === true, (value) => mutate(() => { if (value) definition.required = true; else delete definition.required; }))); required.appendChild(el('span', '', '必填')); block.appendChild(required);
      const area = el('textarea', 'blackboard-advanced'); area.value = JSON.stringify(definition, null, 2); area.title = '参数定义高级字段';
      area.addEventListener('change', () => { try { const value = JSON.parse(area.value); mutate(() => { state.raw.blackboard[name] = value; }); } catch { toast('参数定义不是有效 JSON', true); } }); block.appendChild(area);
      body.appendChild(block);
    });
  }

  function renameBlackboard(oldName, name) {
    if (!name || name === oldName) return;
    if (state.raw.blackboard[name]) { toast('黑板键已存在', true); return; }
    mutate(() => {
      const next = {};
      for (const [key, value] of Object.entries(state.raw.blackboard)) next[key === oldName ? name : key] = value;
      state.raw.blackboard = next;
      const remap = (item) => {
        if (Array.isArray(item)) return item.forEach(remap);
        if (!item || typeof item !== 'object') return;
        if (typeof item.ref === 'string') item.ref = item.ref.replace(`blackboard.${oldName}`, `blackboard.${name}`);
        Object.values(item).forEach(remap);
      };
      remap(state.raw.nodes);
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
      exported.querySelectorAll('.connection-preview, .marquee, .node-preview-frame, .node-preview-image, .edge-hit, .edge-rewire').forEach((element) => element.remove());

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

  function openAssetBrowser(nodeId, key, currentPath) {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const normalized = typeof currentPath === 'string' ? currentPath.replace(/\\/g, '/') : '';
    const slash = normalized.lastIndexOf('/');
    state.assetBrowser = {
      requestId,
      nodeId,
      key,
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
    const node = nodeById(browser.nodeId);
    if (!node) { closeAssetBrowser(); toast('目标节点已不存在', true); return; }
    mutate(() => { node.params[browser.key] = assetPath; });
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
    mutate(() => { node.params[browser.key] = reference; });
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
    $('btn-run').addEventListener('click', () => vscode.postMessage({ type: 'runWorkflow', instanceId: state.instanceId }));
    $('btn-stop').addEventListener('click', () => vscode.postMessage({ type: 'stopWorkflow' }));
    $('btn-save').addEventListener('click', () => { vscode.postMessage({ type: 'save', text: JSON.stringify(state.raw, null, 2) + '\n' }); setDirty(false); });
    $('btn-more').addEventListener('click', (event) => showMenu(event.clientX || window.innerWidth - 180, event.clientY || 40, [
      { label: '新建工作流', run: () => vscode.postMessage({ type: 'newWorkflow' }) },
      { label: '选择其他工作流…', run: () => vscode.postMessage({ type: 'openWorkflowPicker' }) },
      { label: '打开 JSON', run: () => vscode.postMessage({ type: 'openFile' }) },
      'separator',
      { label: '查看引用', run: () => vscode.postMessage({ type: 'openReferences' }) },
      'separator',
      { label: '重新加载', run: () => vscode.postMessage({ type: 'reloadRequest' }) },
    ]));
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
    state.inspector = 'node';
    const pos = position(target);
    const rect = wrap.getBoundingClientRect();
    state.panX = rect.width / 2 - (pos.x + NODE_W / 2) * state.zoom;
    state.panY = rect.height / 2 - (pos.y + nodeHeight(target) / 2) * state.zoom;
    render();
    toast(`卡片 ${index + 1}/${matches.length}：${String(target.name).trim()}`);
  }

  function executeEditorCommand(command, value) {
    if (command === 'addTask') addNode('task');
    else if (command === 'addSelector') addNode('selector');
    else if (command === 'addSequence') addNode('sequence');
    else if (command === 'addParallel') addNode('simple_parallel');
    else if (command === 'autoLayout') { autoLayout(); fitView(); }
    else if (command === 'fitView') fitView();
    else if (command === 'exportImage') exportFullCanvasImage();
    else if (command === 'workflowSettings') { state.inspector = 'workflow'; state.selected.clear(); state.selectedEdge = null; renderInspector(); }
    else if (command === 'blackboard') { state.inspector = 'blackboard'; state.selected.clear(); state.selectedEdge = null; renderInspector(); }
    else if (command === 'searchNodeByName') searchNodeByName(value);
  }

  graph.addEventListener('mousedown', onPointerDown);
  graph.addEventListener('mousemove', onPointerMove);
  graph.addEventListener('mouseup', onPointerUp);
  graph.addEventListener('mousemove', (event) => { state.mouse = worldPoint(event); });
  graph.addEventListener('pointermove', (event) => { if (state.connect) onPointerMove(event); });
  graph.addEventListener('pointerup', (event) => { if (state.connect) onPointerUp(event); });
  graph.addEventListener('pointercancel', () => cancelConnection());
  graph.addEventListener('mouseleave', (event) => { if (state.drag || state.connect) onPointerMove(event); });
  graph.addEventListener('wheel', (event) => { event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY); }, { passive: false });
  graph.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const point = worldPoint(event);
    const items = [
      { label: '＋ Task', run: () => addNode('task', point) }, { label: '＋ Selector', run: () => addNode('selector', point) },
      { label: '＋ Sequence', run: () => addNode('sequence', point) }, { label: '＋ Simple Parallel', run: () => addNode('simple_parallel', point) },
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
  window.addEventListener('mousemove', (event) => { if (state.drag || state.connect) onPointerMove(event); });
  window.addEventListener('mouseup', onPointerUp);
  window.addEventListener('keydown', (event) => {
    const tag = event.target && event.target.tagName;
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (event.key === 'Escape') { if (state.connect) cancelConnection(); state.drag = null; state.marquee = null; hideMenus(); const lightbox = $('lightbox'); if (lightbox) lightbox.classList.add('hidden'); closeAssetBrowser(); closeTemplateCheck(); render(); }
    if (!editing && event.key === 'Delete') { event.preventDefault(); deleteSelection(); }
    if (!editing && event.ctrlKey && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); }
    if (!editing && event.ctrlKey && event.key.toLowerCase() === 'x') { event.preventDefault(); cutSelection(); }
    if (!editing && event.ctrlKey && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteClipboard(); }
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
      state.instances = Array.isArray(message.instances) ? message.instances.filter((item) => item && typeof item.id === 'string' && item.id) : [];
      state.instanceId = typeof message.selectedInstance === 'string' ? message.selectedInstance : '';
      state.selected.clear(); state.selectedEdge = null; state.undo = []; state.redo = []; state.run.clear(); state.inspector = 'node'; state.nodeSearch = { query: '', ids: [], index: -1 };
      $('btn-back').classList.toggle('hidden', !message.canGoBack);
      renderWorkflowPicker(); renderInstancePicker(); ensureLayout(); setDirty(false); render();
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
      const node = nodeById(message.nodeId); if (node) mutate(() => { node.params[message.key] = message.path; });
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
    else if (message.type === 'editorCommand') executeEditorCommand(String(message.command || ''), message.value);
  });

  for (const id of ['lightbox', 'roi-picker', 'asset-browser', 'workflow-browser', 'template-check']) {
    const overlay = el('div', `overlay hidden`); overlay.id = id; document.body.appendChild(overlay);
    if (id === 'asset-browser') overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeAssetBrowser(); });
    if (id === 'workflow-browser') overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeWorkflowBrowser(); });
    if (id === 'template-check') overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeTemplateCheck(); });
  }
  bindToolbar();
  window.__btEditor = { state, connect, disconnect, autoLayout, render, exportFullCanvasImage, copySelection, cutSelection, pasteClipboard, snapshot: () => clone(state.raw) };
  vscode.postMessage({ type: 'ready' });
})();
