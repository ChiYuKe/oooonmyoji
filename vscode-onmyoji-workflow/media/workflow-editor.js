(() => {
  'use strict';

  const vscode = acquireVsCodeApi();
  const NS = 'http://www.w3.org/2000/svg';
  const NODE_W = 260;
  const BASE_H = 96;
  const DECO_H = 22;
  const PORT_R = 7;
  const TYPES = ['root', 'selector', 'sequence', 'simple_parallel', 'task'];
  const TYPE_LABEL = { root: 'ROOT', selector: 'SELECTOR', sequence: 'SEQUENCE', simple_parallel: 'SIMPLE PARALLEL', task: 'TASK' };
  const TYPE_ICON = { root: '◆', selector: '?', sequence: '→', simple_parallel: '∥', task: '▣' };
  const state = {
    raw: null,
    catalog: [],
    refs: { blackboard: [], nodes: [] },
    issues: [],
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
  };

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
    const group = svgEl('g', { class: `edge${selected ? ' selected' : ''}`, 'data-parent': parent.id, 'data-child': childId }, layer);
    group.dataset.parent = parent.id;
    group.dataset.child = childId;
    const path = svgEl('path', { class: 'edge-hit', d: bezier(x1, y1, x2, y2) }, group);
    svgEl('path', { class: 'edge-line', d: bezier(x1, y1, x2, y2) }, group);
    const midY = (y1 + y2) / 2;
    svgEl('circle', { class: 'edge-order-bg', cx: (x1 + x2) / 2, cy: midY, r: 10 }, group);
    svgEl('text', { class: 'edge-order', x: (x1 + x2) / 2, y: midY + 4, 'text-anchor': 'middle' }, group).textContent = String(order + 1);
    const rewire = svgEl('circle', { class: 'edge-rewire', cx: x2, cy: y2 - 18, r: 6, title: '拖动以重新连接' }, group);
    path.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      state.selected.clear();
      state.selectedEdge = { parent: parent.id, child: childId };
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

  function renderNode(layer, node) {
    const pos = position(node);
    const height = nodeHeight(node);
    const run = state.run.get(node.id);
    const classes = ['node', `type-${node.type}`];
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
    if (run && run.status) svgEl('circle', { class: 'run-dot', cx: NODE_W - 14, cy: 16, r: 5 }, group);
    svgEl('text', { class: 'node-name', x: 14, y: 53 }, group).textContent = node.name || node.id;
    const subtitle = node.type === 'task' ? (node.action || '未选择 Action') : compositeSubtitle(node);
    svgEl('text', { class: 'node-subtitle', x: 14, y: 72 }, group).textContent = subtitle;
    if (run && Number.isFinite(run.duration)) svgEl('text', { class: 'node-duration', x: NODE_W - 12, y: 72, 'text-anchor': 'end' }, group).textContent = `${run.duration} ms`;
    if (run && run.thumbnail) {
      const image = svgEl('image', { class: 'step-thumb', href: run.thumbnail.startsWith('data:') ? run.thumbnail : `data:image/png;base64,${run.thumbnail}`, x: NODE_W - 62, y: 38, width: 48, height: 28, preserveAspectRatio: 'xMidYMid slice' }, group);
      image.addEventListener('click', (event) => { event.stopPropagation(); openLightbox(run.screenshot || image.getAttribute('href')); });
    }
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
    body.addEventListener('mousedown', (event) => startNodeDrag(event, node.id));
    body.addEventListener('dblclick', () => { state.selected = new Set([node.id]); state.inspector = 'node'; render(); });
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

  function checkbox(value, onChange) {
    const input = el('input'); input.type = 'checkbox'; input.checked = !!value;
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }

  function renderInspector() {
    if (!state.raw) return;
    if (state.inspector === 'workflow') { renderWorkflowInspector(); return; }
    if (state.inspector === 'blackboard') { renderBlackboardInspector(); return; }
    if (state.selectedEdge) { renderEdgeInspector(); return; }
    const selected = [...state.selected];
    if (selected.length !== 1) {
      $('inspector-title').textContent = selected.length ? `${selected.length} 个节点` : '详细信息';
      $('inspector-empty').textContent = selected.length ? '可拖动或按 Delete 删除所选节点' : '选择一个节点';
      $('inspector-empty').classList.remove('hidden'); $('inspector-body').classList.add('hidden');
      return;
    }
    const node = nodeById(selected[0]);
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

  function allRefs() {
    return [...(state.refs.blackboard || []), ...(state.refs.nodes || [])];
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
      node.params[name] = next === 'binding' ? { ref: allRefs()[0] || 'blackboard.key' } : defaultValue(definition);
    }), 'value-mode');
    block.appendChild(mode);
    if (bound) {
      const refs = allRefs();
      const ref = value.ref;
      const options = refs.includes(ref) ? refs : [ref, ...refs];
      block.appendChild(selectInput(ref, options.map((item) => ({ value: item, label: item })), (next) => mutate(() => { node.params[name] = { ref: next }; }), 'full'));
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
    shell.appendChild(textInput(value, set, { placeholder: definition.type === 'asset' ? 'assets/templates/...' : '' }));
    if (definition.type === 'asset') {
      const pick = el('button', '', '截取'); pick.addEventListener('click', () => requestRoi(node.id, name, 'asset')); shell.appendChild(pick);
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
      else if (next === 'exists') decorator.expression = { exists: { ref: allRefs()[0] || 'blackboard.key' } };
      else if (next === 'and' || next === 'or') decorator.expression = { [next]: [true, true] };
      else if (next === 'not') decorator.expression = { not: true };
      else decorator.expression = { [next]: [{ ref: allRefs()[0] || 'blackboard.key' }, null] };
    }), 'when-op'));
    if (op === 'literal') shell.appendChild(checkbox(!!expression, (value) => mutate(() => { decorator.expression = value; })));
    else if (op === 'exists') {
      const ref = expression.exists && expression.exists.ref;
      shell.appendChild(selectInput(ref || '', allRefs().map((value) => ({ value, label: value })), (value) => mutate(() => { decorator.expression = { exists: { ref: value } }; }), 'full'));
    } else if (['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'].includes(op)) {
      const operands = Array.isArray(expression[op]) ? expression[op] : [{ ref: allRefs()[0] || 'blackboard.key' }, null];
      const left = operands[0] && operands[0].ref ? operands[0].ref : allRefs()[0] || 'blackboard.key';
      shell.appendChild(selectInput(left, allRefs().map((value) => ({ value, label: value })), (value) => mutate(() => { decorator.expression[op][0] = { ref: value }; }), 'full'));
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

  function requestRoi(nodeId, key, mode) {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.roi = { requestId, nodeId, key, mode };
    vscode.postMessage({ type: 'pickRoi', requestId, nodeId, key, referenceResolution: state.raw.resolution || [1920, 1080] });
  }

  function openRoiPicker(message) {
    if (!state.roi || state.roi.requestId !== message.requestId) return;
    let overlay = $('roi-picker'); overlay.innerHTML = ''; overlay.classList.remove('hidden');
    const dialog = el('div', 'roi-dialog'); const head = el('div', 'roi-head', state.roi.mode === 'asset' ? '截取模板' : '选择区域'); dialog.appendChild(head);
    const stage = el('div', 'roi-stage'); const image = el('img'); image.src = message.dataUrl; stage.appendChild(image); const selection = el('div', 'roi-selection'); stage.appendChild(selection); dialog.appendChild(stage);
    const actions = el('div', 'roi-actions'); const cancel = el('button', '', '取消'); const confirm = el('button', 'primary', '确认'); actions.appendChild(cancel); actions.appendChild(confirm); dialog.appendChild(actions); overlay.appendChild(dialog);
    const data = { x1: 0, y1: 0, x2: 0, y2: 0, dragging: false };
    const update = () => { selection.style.left = `${Math.min(data.x1, data.x2)}px`; selection.style.top = `${Math.min(data.y1, data.y2)}px`; selection.style.width = `${Math.abs(data.x2 - data.x1)}px`; selection.style.height = `${Math.abs(data.y2 - data.y1)}px`; };
    const point = (event) => { const rect = stage.getBoundingClientRect(); return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) }; };
    stage.addEventListener('mousedown', (event) => { const p = point(event); data.x1 = data.x2 = p.x; data.y1 = data.y2 = p.y; data.dragging = true; update(); });
    const move = (event) => { if (!data.dragging) return; const p = point(event); data.x2 = p.x; data.y2 = p.y; update(); };
    const up = () => { data.dragging = false; };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    cancel.addEventListener('click', () => { overlay.classList.add('hidden'); state.roi = null; });
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
          vscode.postMessage({ type: 'saveTemplate', requestId: request.requestId, nodeId: request.nodeId, key: request.key, filename: `${request.nodeId}-${request.key}.png`, dataUrl: canvas.toDataURL('image/png') });
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
      state.run.set(String(event.step_id), { status: step.status, duration: step.duration_ms, thumbnail: event.thumbnail, screenshot: event.screenshot });
    }
    if (event.type === 'run_finished') state.activeRun = null;
    render();
  }

  function normalizeRaw(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {
      schema_version: 3, id: 'new_behavior_tree', version: '3.0.0', resolution: [1920, 1080], root: 'root', blackboard: {}, limits: { timeout_seconds: 300, max_steps: 1000 },
      nodes: [{ id: 'root', type: 'root', children: ['main'] }, { id: 'main', type: 'sequence', children: ['task_1'] }, { id: 'task_1', type: 'task', action: 'core.capture', params: {} }],
    };
    if (!raw._layout || typeof raw._layout !== 'object') raw._layout = {};
    return raw;
  }

  function bindToolbar() {
    $('btn-add-task').addEventListener('click', () => addNode('task'));
    $('btn-add-selector').addEventListener('click', () => addNode('selector'));
    $('btn-add-sequence').addEventListener('click', () => addNode('sequence'));
    $('btn-add-parallel').addEventListener('click', () => addNode('simple_parallel'));
    $('btn-layout').addEventListener('click', () => { autoLayout(); fitView(); });
    $('btn-fit').addEventListener('click', fitView);
    $('btn-zoom-in').addEventListener('click', () => zoomAt(1.2));
    $('btn-zoom-out').addEventListener('click', () => zoomAt(1 / 1.2));
    $('btn-workflow').addEventListener('click', () => { state.inspector = 'workflow'; state.selected.clear(); state.selectedEdge = null; renderInspector(); });
    $('btn-blackboard').addEventListener('click', () => { state.inspector = 'blackboard'; state.selected.clear(); state.selectedEdge = null; renderInspector(); });
    $('btn-run').addEventListener('click', () => vscode.postMessage({ type: 'runWorkflow' }));
    $('btn-save').addEventListener('click', () => { vscode.postMessage({ type: 'save', text: JSON.stringify(state.raw, null, 2) + '\n' }); setDirty(false); });
    $('btn-more').addEventListener('click', (event) => showMenu(event.clientX || window.innerWidth - 180, event.clientY || 40, [
      { label: '新建工作流', run: () => vscode.postMessage({ type: 'newWorkflow' }) },
      { label: '打开 JSON', run: () => vscode.postMessage({ type: 'openFile' }) },
      { label: '重新加载', run: () => vscode.postMessage({ type: 'reloadRequest' }) },
    ]));
  }

  graph.addEventListener('mousedown', onPointerDown);
  graph.addEventListener('mousemove', onPointerMove);
  graph.addEventListener('mouseup', onPointerUp);
  graph.addEventListener('pointermove', (event) => { if (state.connect) onPointerMove(event); });
  graph.addEventListener('pointerup', (event) => { if (state.connect) onPointerUp(event); });
  graph.addEventListener('pointercancel', () => cancelConnection());
  graph.addEventListener('mouseleave', (event) => { if (state.drag || state.connect) onPointerMove(event); });
  graph.addEventListener('wheel', (event) => { event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY); }, { passive: false });
  graph.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const point = worldPoint(event);
    showMenu(event.clientX, event.clientY, [
      { label: '＋ Task', run: () => addNode('task', point) }, { label: '＋ Selector', run: () => addNode('selector', point) },
      { label: '＋ Sequence', run: () => addNode('sequence', point) }, { label: '＋ Simple Parallel', run: () => addNode('simple_parallel', point) },
      'separator', { label: '自动排列', run: () => { autoLayout(); fitView(); } },
    ]);
  });
  window.addEventListener('mousemove', (event) => { if (state.drag || state.connect) onPointerMove(event); });
  window.addEventListener('mouseup', onPointerUp);
  window.addEventListener('keydown', (event) => {
    const tag = event.target && event.target.tagName;
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (event.key === 'Escape') { if (state.connect) cancelConnection(); state.drag = null; state.marquee = null; hideMenus(); const lightbox = $('lightbox'); if (lightbox) lightbox.classList.add('hidden'); render(); }
    if (!editing && event.key === 'Delete') { event.preventDefault(); deleteSelection(); }
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
      state.raw = normalizeRaw(raw); state.catalog = Array.isArray(message.catalog) ? message.catalog : [];
      state.refs = message.refs || { blackboard: [], nodes: [] }; state.issues = message.issues || [];
      state.selected.clear(); state.selectedEdge = null; state.undo = []; state.redo = []; state.run.clear(); state.inspector = 'node';
      $('file-label').textContent = message.document.name || ''; $('file-label').title = message.document.uri || '';
      ensureLayout(); setDirty(false); render(); setTimeout(fitView, 0);
    } else if (message.type === 'runEvent') handleRunEvent(message.event);
    else if (message.type === 'runReplay') { state.run.clear(); (message.events || []).forEach(handleRunEvent); }
    else if (message.type === 'roiPickerImage') openRoiPicker(message);
    else if (message.type === 'roiPickerCancelled' || message.type === 'roiPickerError') { const overlay = $('roi-picker'); if (overlay) overlay.classList.add('hidden'); state.roi = null; if (message.message) toast(message.message, true); }
    else if (message.type === 'templateSaved' && state.roi && state.roi.requestId === message.requestId) { const node = nodeById(message.nodeId); if (node) mutate(() => { node.params[message.key] = message.path; }); state.roi = null; toast('模板已保存'); }
    else if (message.type === 'externalChange') { const banner = $('external-banner'); banner.textContent = '文件已在外部修改'; banner.classList.remove('hidden'); }
  });

  for (const id of ['lightbox', 'roi-picker']) {
    const overlay = el('div', `overlay hidden`); overlay.id = id; document.body.appendChild(overlay);
  }
  bindToolbar();
  window.__btEditor = { state, connect, disconnect, autoLayout, render, snapshot: () => clone(state.raw) };
  vscode.postMessage({ type: 'ready' });
})();
