/* Onmyoji 工作流可视化编辑器（Webview 端）。
 * 无第三方依赖；消息协议见 webviewManager.ts。 */
(function () {
  'use strict';
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const NS = 'http://www.w3.org/2000/svg';
  const TERMINALS = ['$success', '$failure', '$cancelled'];
  const TERMINAL_LABELS = { $success: '成功', $failure: '失败', $cancelled: '取消' };
  const TERMINAL_COLORS = { $success: '#2e7d32', $failure: '#b71c1c', $cancelled: '#616161' };
  const EDGE_KINDS = ['on_success', 'on_failure', 'on_skip'];
  const EDGE_KIND_LABELS = { on_success: '成功', on_failure: '失败', on_skip: '跳过' };
  const TOP_KEYS = ['schema_version', 'id', 'version', 'reference_resolution', 'entry', 'limits', 'inputs_schema', 'steps'];
  const STEP_KEYS = ['id', 'action', 'when', 'with', 'retry', 'timeout_seconds', 'on_success', 'on_failure', 'on_skip'];
  const NODE_W = 300; // 节点卡片宽度（UE 蓝图风格面板）
  const NODE_H = 108; // 节点卡片高度
  const HEAD_H = 28; // 彩色标题栏高度
  const TERMINAL_W = 200;
  const ROW_GAP = 96;
  const MARGIN = 40;
  const PORT_R = 6;
  const CONNECT_HIT = 18; // 放线落点命中半径（世界坐标）

  // 只改变编辑器中的显示文本；JSON 字段名和 $ref 值仍使用英文。
  const ACTION_LABELS = {
    'core.capture': '截图',
    'core.save_frame': '保存截图',
    'core.sleep': '等待',
    'core.log': '记录日志',
    'core.assert': '断言',
    'vision.match_template': '模板匹配',
    'vision.ocr': '文字识别',
    'vision.wait_template': '等待模板',
    'input.tap': '点击坐标',
    'input.tap_match': '点击匹配结果',
  };
  const PARAM_LABELS = {
    x: 'X 坐标',
    y: 'Y 坐标',
    hold_ms: '按住时长',
    random_offset: '随机偏移',
    random_interval: '随机间隔',
    template: '模板图',
    roi: '识别区域',
    threshold: '匹配阈值',
    max_results: '最大结果数',
    timeout_seconds: '超时时间',
    present: '等待状态',
    match: '匹配结果',
    revalidate: '点击前复核',
    name: '文件名',
    seconds: '等待秒数',
    message: '日志信息',
    fields: '附加字段',
    value: '断言值',
  };
  const OUTPUT_LABELS = {
    x: 'X 坐标',
    y: 'Y 坐标',
    width: '画面宽度',
    height: '画面高度',
    path: '文件路径',
    offset_x: '实际 X 偏移',
    offset_y: '实际 Y 偏移',
    interval_seconds: '点击前等待',
    revalidated: '复核结果',
    confidence: '匹配置信度',
    reference: '模板引用',
    center: '匹配中心',
    asserted: '断言结果',
  };

  const state = {
    raw: null,
    origOrders: [],
    catalog: [],
    refs: { inputs: [], steps: [] },
    issues: [],
    document: null,
    selectedId: null,
    dirty: false,
    zoom: 1,
    panX: 20,
    panY: 20,
    nodePos: {},
    drag: null,
    connectHoverId: null,
    addOpen: false,
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function actionLabel(name) {
    return ACTION_LABELS[name] || name;
  }

  function parameterLabel(name) {
    return PARAM_LABELS[name] || name;
  }

  function refLabel(ref) {
    const inputMatch = /^inputs\.(.+)$/.exec(ref);
    if (inputMatch) {
      const parts = inputMatch[1].split('.');
      const label = [parameterLabel(parts[0]), ...parts.slice(1)].join('.');
      return `${label}（${ref}）`;
    }
    const outputMatch = /^steps\.([^.]+)\.output\.(.+)$/.exec(ref);
    if (outputMatch) {
      const output = outputMatch[2];
      const label = output === '0' ? '第 1 个结果' : (OUTPUT_LABELS[output] || output);
      return `步骤「${outputMatch[1]}」输出：${label}（${ref}）`;
    }
    return ref;
  }

  function toast(message, ms) {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.add('hidden'), ms || 2600);
  }

  // ---------- 消息 ----------
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'init':
        applyDocument(msg);
        break;
      case 'documentChanged':
        applyDocument(msg);
        break;
      case 'externalChange':
        state.externalNotice = true;
        $('external-banner').classList.remove('hidden');
        $('external-banner').textContent = msg.notice || 'JSON 已在外部修改';
        break;
      case 'saved':
        state.dirty = false;
        state.externalNotice = false;
        $('external-banner').classList.add('hidden');
        refreshBadges();
        break;
      default:
        break;
    }
  });

  function applyDocument(msg) {
    state.document = msg.document || null;
    state.catalog = msg.catalog || [];
    state.refs = msg.refs || { inputs: [], steps: [] };
    state.issues = msg.issues || [];
    state.raw = null;
    state.origOrders = [];
    if (state.document && state.document.text) {
      try {
        const parsed = JSON.parse(state.document.text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          state.raw = parsed;
          if (Array.isArray(parsed.steps)) {
            state.origOrders = parsed.steps.map((s) => (s && typeof s === 'object' ? Object.keys(s) : []));
          }
        }
      } catch (e) {
        state.raw = null;
      }
    }
    state.dirty = false;
    state.externalNotice = false;
    state.drag = null;
    state.connectHoverId = null;
    state.selectedId = state.raw && state.raw.entry ? state.raw.entry : (Array.isArray(state.raw && state.raw.steps) && state.raw.steps[0] ? state.raw.steps[0].id : null);
    $('external-banner').classList.add('hidden');
    $('file-label').textContent = state.document ? state.document.name : '';
    $('file-label').title = state.document ? state.document.uri : '';
    refreshBadges();
    renderAll();
  }

  function markDirty() {
    state.dirty = true;
    refreshBadges();
  }

  function refreshBadges() {
    const dirty = $('dirty-badge');
    dirty.classList.toggle('hidden', !state.dirty);
    const issues = $('issue-badge');
    const errors = state.issues.filter((i) => i.severity === 'error').length;
    const warnings = state.issues.filter((i) => i.severity === 'warning').length;
    issues.textContent = `${errors} 错误 · ${warnings} 警告`;
    issues.className = 'badge ' + (errors ? 'err' : warnings ? 'warn' : 'ok');
  }

  // ---------- 布局 ----------
  function stepsOf() {
    return state.raw && Array.isArray(state.raw.steps) ? state.raw.steps : [];
  }

  function computeLayout() {
    const steps = stepsOf();
    const nodes = steps.map((s, i) => ({
      id: s && typeof s.id === 'string' ? s.id : '__missing_' + i + '__',
      index: i,
      kind: 'step',
      label: s && typeof s.id === 'string' ? s.id : '(未命名步骤)',
      action: s && typeof s.action === 'string' ? s.action : '',
      isEntry: !!(s && typeof s.id === 'string' && state.raw && s.id === state.raw.entry),
    }));
    TERMINALS.forEach((t) => nodes.push({ id: t, index: -1, kind: 'terminal', label: TERMINAL_LABELS[t] || t, isEntry: false }));
    const edges = [];
    const validIds = new Set(nodes.map((n) => n.id));
    steps.forEach((s, index) => {
      if (!s || typeof s.id !== 'string' || !validIds.has(s.id)) return;
      const next = index + 1 < steps.length && steps[index + 1] && typeof steps[index + 1].id === 'string' ? steps[index + 1].id : '$success';
      const pushEdge = (kind, target, explicit, label) => {
        if (!target || target === s.id || !validIds.has(target)) return;
        edges.push({ from: s.id, to: target, kind, explicit, label });
      };
      if (typeof s.on_success === 'string') pushEdge('on_success', s.on_success, true, '成功');
      else if (next !== s.id) pushEdge('on_success', next, false, '成功(默认)');
      if (typeof s.on_failure === 'string') pushEdge('on_failure', s.on_failure, true, '失败');
      else pushEdge('on_failure', '$failure', false, '失败(默认)');
      if (typeof s.on_skip === 'string') pushEdge('on_skip', s.on_skip, true, '跳过');
      else if (next !== s.id) pushEdge('on_skip', next, false, '跳过(默认)');
    });
    const positions = {};
    steps.forEach((s, index) => {
      const id = s && typeof s.id === 'string' ? s.id : '__missing_' + index + '__';
      positions[id] = { id, x: MARGIN, y: MARGIN + index * (NODE_H + ROW_GAP) };
    });
    const terminalRowY = MARGIN + steps.length * (NODE_H + ROW_GAP);
    const terminalGap = TERMINAL_W + 120;
    TERMINALS.forEach((t, i) => {
      positions[t] = { id: t, x: MARGIN + i * terminalGap, y: terminalRowY };
    });
    const width = Math.max(MARGIN * 2 + NODE_W, MARGIN + (TERMINALS.length - 1) * terminalGap + TERMINAL_W + MARGIN);
    const height = terminalRowY + NODE_H + MARGIN;
    return { nodes, edges, positions, width, height };
  }

  function effectivePos(layoutPos) {
    return state.nodePos[layoutPos.id] || { x: layoutPos.x, y: layoutPos.y };
  }

  /** 步骤节点右侧输出引脚（按 EDGE_KINDS 顺序从上到下）。 */
  function outputPinY(index) {
    return HEAD_H + 22 + index * 24; // 50 / 74 / 98（相对节点顶部）
  }

  /** 步骤节点左侧执行输入引脚。 */
  function stepInputPinY() {
    return HEAD_H + 22;
  }

  /** 终态节点左侧执行输入引脚（主体竖直居中）。 */
  function terminalInputPinY() {
    return HEAD_H + (NODE_H - HEAD_H) / 2;
  }

  // ---------- SVG 渲染 ----------
  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    return el;
  }

  function stepIssueCount(index) {
    let count = 0;
    for (const issue of state.issues) {
      if (issue.path && issue.path[0] === 'steps' && issue.path[1] === index) count++;
    }
    return count;
  }

  function renderAll() {
    const svg = $('graph');
    const wrap = $('canvas-wrap');
    const layout = computeLayout();
    svg.innerHTML = '';
    const viewW = Math.max(layout.width * state.zoom, wrap.clientWidth || 800);
    const viewH = Math.max(layout.height * state.zoom, (wrap.clientHeight || 600) - 24);
    svg.setAttribute('width', viewW);
    svg.setAttribute('height', viewH);
    const viewport = svgEl('g', { class: 'viewport', transform: `translate(${state.panX},${state.panY}) scale(${state.zoom})` });
    svg.appendChild(viewport);
    // 蓝图点阵网格（随缩放一起缩放）
    const defs = svgEl('defs', {});
    const pattern = svgEl('pattern', { id: 'bp-grid', width: 24, height: 24, patternUnits: 'userSpaceOnUse' });
    pattern.appendChild(svgEl('circle', { cx: 1.5, cy: 1.5, r: 1.3, fill: '#ffffff', opacity: 0.09 }));
    defs.appendChild(pattern);
    svg.appendChild(defs);
    // 网格矩形铺满可视区（考虑缩放，用户坐标 = 屏幕坐标 / zoom）
    const gridW = Math.max(layout.width, (wrap.clientWidth || 800) / state.zoom);
    const gridH = Math.max(layout.height, ((wrap.clientHeight || 600) - 24) / state.zoom);
    viewport.appendChild(svgEl('rect', { class: 'grid-bg', width: gridW, height: gridH }));

    if (!state.raw) {
      const msg = svgEl('text', { x: 24, y: 40, 'font-size': 14, fill: '#e53935' });
      msg.textContent = '当前文件不是有效的 JSON 工作流，请先修复 JSON，再点击「重新加载」。';
      viewport.appendChild(msg);
      return;
    }

    // edges（从源节点右侧输出引脚，到目标节点左侧输入引脚）
    for (const edge of layout.edges) {
      const from = effectivePos(layout.positions[edge.from]);
      const to = effectivePos(layout.positions[edge.to]);
      const kindIndex = EDGE_KINDS.indexOf(edge.kind);
      const sx = from.x + NODE_W;
      const sy = from.y + outputPinY(Math.max(0, kindIndex));
      const tx = to.x;
      const toNode = layout.nodes.find((n) => n.id === edge.to);
      const ty = to.y + (toNode && toNode.kind === 'terminal' ? terminalInputPinY() : stepInputPinY());
      const bend = Math.max(32, Math.min(160, Math.abs(tx - sx) * 0.4));
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const d = `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
      const g = svgEl('g', { class: 'edge ' + edge.kind + (edge.explicit ? '' : ' fallthrough') });
      const path = svgEl('path', { d, class: edge.explicit ? 'line' : '' });
      g.appendChild(path);
      // 只有默认跳转显示文字标签；显式连线靠引脚颜色识别，中点留给 ✕ 删除手柄
      if (!edge.explicit) {
        const label = svgEl('text', { x: mx, y: my - 8, 'text-anchor': 'middle', class: 'edge-label' });
        label.textContent = edge.label;
        g.appendChild(label);
      }
      // 显式连线的删除手柄（悬停显示，点击移除该跳转）
      if (edge.explicit) {
        const del = svgEl('g', { class: 'edge-del', transform: `translate(${mx},${my})` });
        del.appendChild(svgEl('circle', { class: 'edge-del-bg', r: 9 }));
        const x = svgEl('text', { x: 0, y: 4, 'text-anchor': 'middle', class: 'edge-del-x' });
        x.textContent = '✕';
        del.appendChild(x);
        del.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          removeTransition(edge.from, edge.kind);
        });
        g.appendChild(del);
      }
      viewport.appendChild(g);
    }

    // 连线橡皮筋（正在拖拽连线时，从输出引脚开始）
    if (state.drag && state.drag.mode === 'connect') {
      const from = effectivePos(layout.positions[state.drag.fromId]);
      const kindIndex = EDGE_KINDS.indexOf(state.drag.edgeKind);
      const sx = from.x + NODE_W;
      const sy = from.y + outputPinY(Math.max(0, kindIndex));
      const c = state.drag.cursorWorld || { x: sx + 100, y: sy };
      const bend = Math.max(32, Math.min(160, Math.abs(c.x - sx) * 0.4));
      const d = `M ${sx} ${sy} C ${sx + bend} ${sy}, ${c.x - bend} ${c.y}, ${c.x} ${c.y}`;
      const g = svgEl('g', { class: 'edge connect ' + state.drag.edgeKind });
      g.appendChild(svgEl('path', { d }));
      const label = svgEl('text', { x: (sx + c.x) / 2, y: (sy + c.y) / 2 - 8, 'text-anchor': 'middle' });
      label.textContent = EDGE_KIND_LABELS[state.drag.edgeKind] || state.drag.edgeKind;
      g.appendChild(label);
      viewport.appendChild(g);
    }

    // nodes（UE 蓝图风格卡片：彩色标题栏 + 主体 + 左右执行引脚）
    for (const node of layout.nodes) {
      const pos = effectivePos(layout.positions[node.id]);
      const isTerminal = node.kind === 'terminal';
      const w = isTerminal ? TERMINAL_W : NODE_W;
      const kindClass = isTerminal ? 'kind-terminal' : node.isEntry ? 'kind-entry' : 'kind-step';
      const isDrag = state.drag && state.drag.mode === 'node' && state.drag.nodeId === node.id;
      const isConnectTarget = state.connectHoverId === node.id;
      const g = svgEl('g', {
        class: 'node ' + kindClass + (isTerminal ? ' terminal' : '') + (isDrag ? ' dragging' : '') + (isConnectTarget ? ' connect-target' : ''),
        transform: `translate(${pos.x},${pos.y})`,
        style: 'cursor: grab',
      });
      g.dataset.id = node.id;
      const step = stepsOf()[node.index];
      const nodeTitle = svgEl('title', {});
      nodeTitle.textContent = isTerminal ? '执行终点：' + node.label : '拖动卡片调整位置；点击卡片选择步骤；从右侧彩色引脚拖出连线';
      g.appendChild(nodeTitle);
      // 面板主体
      const box = svgEl('rect', { class: 'node-box' + (state.selectedId === node.id ? ' selected' : ''), width: w, height: NODE_H, rx: 7, ry: 7 });
      g.appendChild(box);
      // 彩色标题栏（底部两角收方）
      const head = svgEl('rect', { class: 'node-head', width: w, height: HEAD_H, rx: 7, ry: 7 });
      g.appendChild(head);
      g.appendChild(svgEl('rect', { class: 'node-head-sq', x: 0, y: HEAD_H - 7, width: w, height: 7 }));
      // 标题栏文字：Action 名（终态节点为终点名）
      const headText = svgEl('text', { x: 10, y: HEAD_H / 2 + 4, class: 'node-head-text' });
      headText.textContent = isTerminal ? (TERMINAL_LABELS[node.id] || node.id) : (node.action || node.label);
      g.appendChild(headText);
      if (node.isEntry) {
        const badge = svgEl('text', { x: w - 44, y: HEAD_H / 2 + 4, 'text-anchor': 'end', class: 'entry-badge' });
        badge.textContent = '入口';
        g.appendChild(badge);
      }
      if (!isTerminal) {
        // 主体：步骤 id
        const idText = svgEl('text', { x: 12, y: HEAD_H + 22, class: 'node-id' });
        idText.textContent = node.label;
        g.appendChild(idText);
        // 参数摘要（首个 with 参数）
        if (step && step.with && typeof step.with === 'object') {
          const keys = Object.keys(step.with);
          if (keys.length) {
            const first = keys[0];
            const v = step.with[first];
            const shown = v !== null && typeof v === 'object' ? (v.$ref || JSON.stringify(v)) : String(v);
            const sum = svgEl('text', { x: 12, y: HEAD_H + 38, class: 'node-params' });
            sum.textContent = first + ': ' + shown;
            g.appendChild(sum);
          }
        }
      } else {
        const idText = svgEl('text', { x: 12, y: terminalInputPinY() + 4, class: 'node-id terminal-id' });
        idText.textContent = node.label;
        g.appendChild(idText);
      }
      const issues = stepIssueCount(node.index);
      if (issues > 0) {
        const mark = svgEl('text', { x: w - 132, y: HEAD_H + 20, 'text-anchor': 'end', class: 'issue-mark' });
        mark.textContent = '⚠' + issues;
        g.appendChild(mark);
      }
      // 执行输入引脚（左侧中部）：作为连线的落点
      const inY = isTerminal ? terminalInputPinY() : stepInputPinY();
      const inPort = svgEl('circle', { class: 'port port-in', cx: 0, cy: inY, r: PORT_R });
      const inTip = svgEl('title', {});
      inTip.textContent = '执行输入：接收上游步骤的执行流';
      inPort.appendChild(inTip);
      inPort.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectNode(node.id);
      });
      g.appendChild(inPort);
      // 执行输出引脚（右侧，仅步骤）：成功 / 失败 / 跳过，各带颜色与标签
      if (!isTerminal) {
        EDGE_KINDS.forEach((kind, index) => {
          const py = outputPinY(index);
          const pin = svgEl('circle', { class: 'port port-out port-out-' + kind.replace('on_', ''), cx: w, cy: py, r: PORT_R });
          const tip = svgEl('title', {});
          tip.textContent = '输出：' + (EDGE_KIND_LABELS[kind] || kind) + '（' + kind + '）— 拖到目标节点左侧输入引脚';
          pin.appendChild(tip);
          pin.addEventListener('mousedown', (e) => startConnectDrag(e, node.id, kind));
          g.appendChild(pin);
          const lab = svgEl('text', { x: w - 14, y: py + 3, 'text-anchor': 'end', class: 'pin-label ' + kind.replace('on_', '') });
          lab.textContent = EDGE_KIND_LABELS[kind] || kind;
          g.appendChild(lab);
        });
      }
      g.addEventListener('mousedown', (e) => startDrag(e, node.id));
      viewport.appendChild(g);
    }

    // empty steps hint
    if (stepsOf().length === 0) {
      const msg = svgEl('text', { x: 24, y: 40, 'font-size': 13, fill: '#9d9d9d' });
      msg.textContent = '（尚无步骤）点击右上角「＋ 新增步骤」开始。';
      viewport.appendChild(msg);
    }
  }

  // ---------- 平移 / 缩放 / 拖拽 / 连线 ----------
  function canvasPoint(e) {
    const scroll = $('canvas-scroll');
    const rect = scroll.getBoundingClientRect();
    return {
      x: e.clientX - rect.left + scroll.scrollLeft,
      y: e.clientY - rect.top + scroll.scrollTop,
    };
  }

  function screenToWorld(e) {
    const p = canvasPoint(e);
    return { x: (p.x - state.panX) / state.zoom, y: (p.y - state.panY) / state.zoom };
  }

  /** 命中检测：返回鼠标下（世界坐标）的节点 id；落在节点外沿附近也算。 */
  function nodeAtWorld(p) {
    const layout = computeLayout();
    for (const node of layout.nodes) {
      const pos = effectivePos(layout.positions[node.id]);
      const w = node.kind === 'terminal' ? TERMINAL_W : NODE_W;
      if (p.x >= pos.x && p.x <= pos.x + w && p.y >= pos.y - 8 && p.y <= pos.y + NODE_H + 8) {
        return node.id;
      }
    }
    return null;
  }

  function startDrag(e, nodeId) {
    if (e.button !== 0) return;
    e.preventDefault();
    removeConnectMenu();
    if (nodeId) e.stopPropagation(); // 防止冒泡到 svg 被当成平移
    state.drag = {
      mode: nodeId ? 'node' : 'pan',
      nodeId: nodeId || null,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: state.panX,
      startPanY: state.panY,
      startPos: nodeId && state.nodePos[nodeId] ? { ...state.nodePos[nodeId] } : null,
      moved: false,
    };
  }

  /** 从右侧输出引脚开始拖拽连线；kind 由引脚决定（on_success / on_failure / on_skip）。 */
  function startConnectDrag(e, fromId, kind) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    removeConnectMenu();
    state.drag = {
      mode: 'connect',
      fromId,
      edgeKind: kind || 'on_success',
      cursorWorld: screenToWorld(e),
      moved: false,
    };
    state.connectHoverId = null;
    renderAll();
  }

  function moveDrag(e) {
    if (!state.drag) return;
    const dx = e.clientX - state.drag.startClientX;
    const dy = e.clientY - state.drag.startClientY;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.drag.moved = true;
    if (state.drag.mode === 'pan') {
      state.panX = state.drag.startPanX + dx;
      state.panY = state.drag.startPanY + dy;
      renderAll();
    } else if (state.drag.mode === 'node') {
      const base = computeLayout().positions[state.drag.nodeId];
      if (!base) return;
      const cur = state.drag.startPos || base;
      state.nodePos[state.drag.nodeId] = { x: cur.x + dx / state.zoom, y: cur.y + dy / state.zoom };
      renderAll();
    } else if (state.drag.mode === 'connect') {
      state.drag.cursorWorld = screenToWorld(e);
      const hit = nodeAtWorld(state.drag.cursorWorld);
      state.connectHoverId = hit && hit !== state.drag.fromId ? hit : null;
      renderAll();
    }
  }

  function endDrag(e) {
    if (!state.drag) return;
    const wasDrag = state.drag;
    state.drag = null;
    if (wasDrag.mode === 'node' && wasDrag.nodeId && !wasDrag.moved) {
      selectNode(wasDrag.nodeId);
    } else if (wasDrag.mode === 'connect') {
      const target = wasDrag.cursorWorld ? nodeAtWorld(wasDrag.cursorWorld) : null;
      state.connectHoverId = null;
      if (target && target !== wasDrag.fromId) {
        // 跳转类型已由起始引脚决定，直接连线
        applyConnection(wasDrag.fromId, target, wasDrag.edgeKind);
      }
      renderAll();
    }
  }

  function cancelDrag() {
    if (!state.drag) return;
    state.drag = null;
    state.connectHoverId = null;
    renderAll();
  }

  /** 写入跳转：source.on_<kind> = targetId */
  function applyConnection(sourceId, targetId, kind) {
    const source = stepsOf().find((s) => s && s.id === sourceId);
    if (!source) return;
    if (source[kind] === targetId) {
      toast('该连线已存在');
      return;
    }
    source[kind] = targetId;
    markDirty();
    renderAll();
    renderInspector();
    toast(`已连线：${sourceId} → ${targetId}（${EDGE_KIND_LABELS[kind] || kind}）`);
  }

  /** 删除跳转：移除 source.on_<kind>（回到默认跳转） */
  function removeTransition(fromId, kind) {
    const source = stepsOf().find((s) => s && s.id === fromId);
    if (!source || !(kind in source)) return;
    delete source[kind];
    markDirty();
    renderAll();
    renderInspector();
    toast(`已移除 ${fromId} 的「${EDGE_KIND_LABELS[kind] || kind}」连线（恢复默认）`);
  }

  function removeConnectMenu() {
    const menu = document.querySelector('.connect-menu');
    if (menu) menu.remove();
  }

  /** 落点处弹出连线类型菜单。 */
  function showConnectMenu(e, sourceId, targetId) {
    removeConnectMenu();
    const menu = document.createElement('div');
    menu.className = 'connect-menu';
    const rect = $('canvas-wrap').getBoundingClientRect();
    let left = (e ? e.clientX : rect.left + rect.width / 2) - rect.left;
    let top = (e ? e.clientY : rect.top + rect.height / 2) - rect.top;
    // 避免溢出画布
    left = Math.max(4, Math.min(left, rect.width - 150));
    top = Math.max(4, Math.min(top, rect.height - 170));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    const header = document.createElement('div');
    header.className = 'connect-menu-title';
    header.textContent = `连线类型：${sourceId} → ${targetId}`;
    menu.appendChild(header);
    for (const kind of EDGE_KINDS) {
      const btn = document.createElement('button');
      btn.className = kind === 'on_success' ? 'ok' : kind === 'on_failure' ? 'err' : 'skip';
      btn.textContent = `${EDGE_KIND_LABELS[kind]}（${kind}）`;
      btn.addEventListener('click', () => {
        removeConnectMenu();
        applyConnection(sourceId, targetId, kind);
      });
      menu.appendChild(btn);
    }
    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    cancel.addEventListener('click', removeConnectMenu);
    menu.appendChild(cancel);
    $('canvas-wrap').appendChild(menu);
  }


  // ---------- 检查器 ----------
  function schemaType(schema) {
    if (!schema || typeof schema !== 'object') return 'any';
    const t = schema.type;
    if (t === 'boolean') return 'boolean';
    if (t === 'number' || t === 'integer') return 'number';
    if (t === 'string') return 'string';
    if (t === 'array') return 'array';
    if (t === 'object') return 'object';
    if (Array.isArray(t)) return t.includes('boolean') ? 'boolean' : 'string';
    return 'any';
  }

  function buildField(labelText, control, hintText) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.innerHTML = labelText;
    wrap.appendChild(label);
    wrap.appendChild(control);
    if (hintText) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = hintText;
      wrap.appendChild(hint);
    }
    return wrap;
  }

  function transitionSelect(step, key, labelText) {
    const options = [['', '(默认)'], ...stepsOf().map((s) => [s && s.id, s && s.id]), ...TERMINALS.map((t) => [t, `${t} (${TERMINAL_LABELS[t]})`])];
    const sel = document.createElement('select');
    for (const [value, text] of options) {
      const opt = document.createElement('option');
      opt.value = value || '';
      opt.textContent = text || '';
      sel.appendChild(opt);
    }
    sel.value = step[key] || '';
    sel.addEventListener('change', () => {
      if (sel.value) step[key] = sel.value;
      else delete step[key];
      markDirty();
      renderAll();
    });
    return buildField(`${labelText} <span style="color:var(--vscode-descriptionForeground,#9d9d9d)">(可选)</span>`, sel, key + ' 指向的步骤或终点');
  }

  function paramControl(key, pSchema, step) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const required = Array.isArray(pSchema ? pSchema.required : undefined);
    const req = (pSchema && Array.isArray((step && step.with) ? undefined : undefined)) || false;
    const spec = state.catalog.find((a) => a.name === step.action);
    const requiredKeys = new Set((spec && spec.inputSchema && spec.inputSchema.required) || []);
    const isRequired = requiredKeys.has(key);
    const label = document.createElement('label');
    label.innerHTML = escapeHtml(parameterLabel(key)) + (isRequired ? ' <span class="req">*</span>' : '');
    wrap.appendChild(label);

    const cur = step.with && typeof step.with === 'object' && step.with[key] !== undefined ? step.with[key] : undefined;
    const isRef = cur !== null && typeof cur === 'object' && '$ref' in cur;

    if (isRef) {
      const refSel = document.createElement('select');
      const choices = [['__literal__', '（改为字面量）'], ...state.refs.inputs.map((p) => [p, refLabel(p)]), ...state.refs.steps.map((p) => [p, refLabel(p)])];
      for (const [value, text] of choices) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        refSel.appendChild(opt);
      }
      refSel.value = cur.$ref;
      refSel.addEventListener('change', () => {
        if (refSel.value === '__literal__') {
          delete step.with[key];
        } else {
          step.with = step.with || {};
          step.with[key] = { $ref: refSel.value };
        }
        markDirty();
        renderInspector();
      });
      wrap.appendChild(refSel);
    } else {
      const type = schemaType(pSchema);
      let control;
      if (type === 'boolean') {
        control = document.createElement('select');
        for (const [value, text] of [['true', 'true'], ['false', 'false']]) {
          const opt = document.createElement('option');
          opt.value = value;
          opt.textContent = text;
          control.appendChild(opt);
        }
        control.value = cur === undefined || cur === null ? 'false' : String(cur);
        control.addEventListener('change', () => {
          step.with = step.with || {};
          step.with[key] = control.value === 'true';
          markDirty();
        });
      } else if (type === 'number') {
        control = document.createElement('input');
        control.type = 'number';
        if (pSchema.minimum !== undefined) control.min = pSchema.minimum;
        if (pSchema.maximum !== undefined) control.max = pSchema.maximum;
        control.step = pSchema.type === 'integer' ? 1 : 'any';
        control.value = cur === undefined || cur === null ? '' : String(cur);
        control.addEventListener('change', () => {
          if (control.value === '') {
            if (step.with) delete step.with[key];
          } else {
            step.with = step.with || {};
            step.with[key] = pSchema.type === 'integer' ? parseInt(control.value, 10) : Number(control.value);
          }
          markDirty();
        });
      } else if (type === 'array') {
        control = document.createElement('input');
        control.type = 'text';
        control.placeholder = '逗号分隔，如 0,0,300,180';
        control.value = Array.isArray(cur) ? cur.join(', ') : '';
        control.addEventListener('change', () => {
          const items = control.value.split(',').map((s) => s.trim()).filter(Boolean);
          if (items.length === 0) {
            if (step.with) delete step.with[key];
          } else {
            step.with = step.with || {};
            step.with[key] = items.map((s) => (pSchema.items && pSchema.items.type === 'string' ? s : Number(s)));
          }
          markDirty();
        });
      } else {
        control = document.createElement('textarea');
        control.placeholder = type === 'object' ? 'JSON 对象，如 {"a": 1}' : '文本';
        control.value = cur === undefined || cur === null ? '' : typeof cur === 'string' ? cur : JSON.stringify(cur, null, 2);
        control.addEventListener('change', () => {
          const text = control.value.trim();
          if (text === '') {
            if (step.with) delete step.with[key];
            markDirty();
            return;
          }
          let value = text;
          if (type === 'object' || type === 'any') {
            try {
              value = JSON.parse(text);
            } catch (e) {
              toast('参数 ' + key + ' 不是合法 JSON：' + e.message, 3200);
              return;
            }
          }
          step.with = step.with || {};
          step.with[key] = value;
          markDirty();
        });
      }
      wrap.appendChild(control);
    }

    if (pSchema && typeof pSchema.description === 'string') {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = pSchema.description;
      wrap.appendChild(hint);
    }

    const tools = document.createElement('div');
    tools.className = 'param-tools';
    const refBtn = document.createElement('button');
    refBtn.textContent = isRef ? '取消引用' : '🔗 引用';
    refBtn.classList.toggle('ref-on', isRef);
    refBtn.addEventListener('click', () => {
      if (isRef) {
        delete step.with[key];
      } else {
        step.with = step.with || {};
        step.with[key] = { $ref: state.refs.inputs[0] || state.refs.steps[0] || 'inputs.template' };
      }
      markDirty();
      renderInspector();
    });
    tools.appendChild(refBtn);
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕ 清除';
    clearBtn.addEventListener('click', () => {
      if (step.with) delete step.with[key];
      markDirty();
      renderInspector();
    });
    tools.appendChild(clearBtn);
    wrap.appendChild(tools);
    return wrap;
  }

  function selectNode(id) {
    state.selectedId = id;
    renderAll();
    renderInspector();
  }

  function selectedStep() {
    if (!state.raw || !Array.isArray(state.raw.steps)) return null;
    return state.raw.steps.find((s) => s && s.id === state.selectedId) || null;
  }

  function renderInspector() {
    const body = $('inspector-body');
    const empty = $('inspector-empty');
    const step = selectedStep();
    if (!step) {
      body.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    body.classList.remove('hidden');
    body.innerHTML = '';

    const stepIndex = state.raw.steps.indexOf(step);
    const stepIssues = state.issues.filter((i) => i.path && i.path[0] === 'steps' && i.path[1] === stepIndex);
    if (stepIssues.length > 0) {
      const box = document.createElement('div');
      box.className = 'step-issues';
      box.textContent = stepIssues.map((i) => `[${i.severity === 'error' ? '错误' : '警告'}] ${i.message}`).join('\n');
      body.appendChild(box);
    }

    // ID
    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.value = step.id || '';
    idInput.addEventListener('change', () => {
      if (!idInput.value.trim()) {
        toast('步骤 ID 不能为空', 2600);
        idInput.value = step.id || '';
        return;
      }
      const oldId = step.id;
      step.id = idInput.value.trim();
      if (state.raw.entry === oldId) state.raw.entry = step.id;
      stepsOf().forEach((s) => {
        if (s === step) return;
        for (const k of ['on_success', 'on_failure', 'on_skip']) {
          if (s[k] === oldId) s[k] = step.id;
        }
      });
      if (state.selectedId === oldId) state.selectedId = step.id;
      markDirty();
      renderAll();
    });
    body.appendChild(buildField('步骤 ID <span class="req">*</span>', idInput, '全局唯一，供跳转与 $ref 引用'));

    // Action
    const actionSel = document.createElement('select');
    for (const spec of state.catalog) {
      const opt = document.createElement('option');
      opt.value = spec.name;
      opt.textContent = `${actionLabel(spec.name)}（${spec.name}）`;
      actionSel.appendChild(opt);
    }
    actionSel.value = step.action || '';
    actionSel.addEventListener('change', () => {
      step.action = actionSel.value;
      if (step.with) delete step.with;
      markDirty();
      renderAll();
      renderInspector();
    });
    body.appendChild(buildField('Action <span class="req">*</span>', actionSel, '切换 Action 会清空该步骤的 with 参数'));

    // with 参数
    const spec = state.catalog.find((a) => a.name === step.action);
    const props = spec && spec.inputSchema && spec.inputSchema.properties ? spec.inputSchema.properties : null;
    if (props) {
      const title = document.createElement('div');
      title.className = 'section-title';
      title.textContent = '参数 (with)';
      body.appendChild(title);
      step.with = step.with && typeof step.with === 'object' && !Array.isArray(step.with) ? step.with : {};
      for (const [key, pSchema] of Object.entries(props)) {
        body.appendChild(paramControl(key, pSchema, step));
      }
    }

    // when
    const title2 = document.createElement('div');
    title2.className = 'section-title';
    title2.textContent = '执行条件 (when)';
    body.appendChild(title2);
    const whenInput = document.createElement('textarea');
    whenInput.placeholder = '空 = 无条件；示例：{"exists": {"$ref": "inputs.template"}}';
    whenInput.value = step.when === undefined ? '' : typeof step.when === 'string' ? step.when : JSON.stringify(step.when, null, 2);
    whenInput.addEventListener('change', () => {
      const text = whenInput.value.trim();
      if (text === '') {
        delete step.when;
        markDirty();
        return;
      }
      try {
        step.when = JSON.parse(text);
        markDirty();
        renderAll();
      } catch (e) {
        toast('when 不是合法 JSON：' + e.message, 3200);
      }
    });
    body.appendChild(buildField('when', whenInput, '支持 exists/eq/ne/gt/gte/lt/lte/contains/and/or/not，不执行 Python 表达式'));

    // 跳转
    const title3 = document.createElement('div');
    title3.className = 'section-title';
    title3.textContent = '跳转';
    body.appendChild(title3);
    body.appendChild(transitionSelect(step, 'on_success', '成功 →'));
    body.appendChild(transitionSelect(step, 'on_failure', '失败 →'));
    body.appendChild(transitionSelect(step, 'on_skip', '跳过 →'));

    // retry / timeout
    const retryAttempts = document.createElement('input');
    retryAttempts.type = 'number';
    retryAttempts.min = 1;
    retryAttempts.step = 1;
    const retryDelay = document.createElement('input');
    retryDelay.type = 'number';
    retryDelay.min = 0;
    retryDelay.step = 'any';
    const loadRetry = () => {
      const r = step.retry;
      if (typeof r === 'number') {
        retryAttempts.value = String(r);
        retryDelay.value = '0';
      } else if (r && typeof r === 'object') {
        retryAttempts.value = String(r.attempts ?? 1);
        retryDelay.value = String(r.delay_seconds ?? 0);
      } else {
        retryAttempts.value = '1';
        retryDelay.value = '0';
      }
    };
    loadRetry();
    const commitRetry = () => {
      const attempts = parseInt(retryAttempts.value || '1', 10);
      const delay = parseFloat(retryDelay.value || '0');
      if (attempts <= 1 && delay <= 0) delete step.retry;
      else if (delay <= 0) step.retry = attempts;
      else step.retry = { attempts, delay_seconds: delay };
      markDirty();
    };
    retryAttempts.addEventListener('change', commitRetry);
    retryDelay.addEventListener('change', commitRetry);
    const retryWrap = document.createElement('div');
    retryWrap.className = 'row';
    retryWrap.appendChild(buildField('重试次数', retryAttempts, '1 表示不重试'));
    retryWrap.appendChild(buildField('重试间隔(秒)', retryDelay, '0 表示立即重试'));
    body.appendChild(retryWrap);
    body.appendChild(buildField('步骤超时(秒)', (() => {
      const t = document.createElement('input');
      t.type = 'number';
      t.min = 0;
      t.step = 'any';
      t.value = step.timeout_seconds === undefined ? '' : String(step.timeout_seconds);
      t.addEventListener('change', () => {
        if (t.value === '') delete step.timeout_seconds;
        else step.timeout_seconds = Number(t.value);
        markDirty();
      });
      return t;
    })(), '可选；留空使用工作流默认'));

    // 删除
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '删除此步骤';
    del.style.marginTop = '14px';
    del.addEventListener('click', () => {
      const idx = state.raw.steps.indexOf(step);
      if (idx >= 0) state.raw.steps.splice(idx, 1);
      state.origOrders.splice(idx, 1);
      if (state.raw.entry === step.id) {
        state.raw.entry = stepsOf()[0] ? stepsOf()[0].id : '';
      }
      state.selectedId = null;
      markDirty();
      renderAll();
      renderInspector();
    });
    body.appendChild(del);
  }

  // ---------- 新增步骤 ----------
  function renderAddModal() {
    let overlay = $('add-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'add-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:60;';
      const box = document.createElement('div');
      box.style.cssText = 'background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-panel-border,#555);border-radius:6px;padding:18px 20px;width:380px;';
      box.innerHTML = '<div style="font-weight:600;margin-bottom:12px">新增步骤</div>';
      const actionSel = document.createElement('select');
      for (const spec of state.catalog) {
        const opt = document.createElement('option');
        opt.value = spec.name;
        opt.textContent = `${actionLabel(spec.name)}（${spec.name}） — ${spec.description.split('\n')[0]}`;
        actionSel.appendChild(opt);
      }
      actionSel.value = state.pendingActionForAdd || 'core.capture';
      const idInput = document.createElement('input');
      idInput.type = 'text';
      idInput.placeholder = '步骤 ID（留空自动生成）';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:12px;';
      row.appendChild(buildField('Action', actionSel));
      row.appendChild(buildField('步骤 ID', idInput));
      box.appendChild(row);
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
      const cancel = document.createElement('button');
      cancel.textContent = '取消';
      const ok = document.createElement('button');
      ok.className = 'primary';
      ok.textContent = '添加';
      actions.appendChild(cancel);
      actions.appendChild(ok);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      cancel.addEventListener('click', () => overlay.remove());
      ok.addEventListener('click', () => {
        const spec = state.catalog.find((a) => a.name === actionSel.value) || state.catalog[0];
        const existing = new Set(stepsOf().map((s) => s && s.id).filter(Boolean));
        let id = idInput.value.trim();
        if (!id) {
          let n = 1;
          while (existing.has('step_' + n)) n++;
          id = 'step_' + n;
        }
        if (existing.has(id)) {
          toast('步骤 ID 已存在：' + id, 2600);
          return;
        }
        const newStep = { id, action: actionSel.value };
        state.raw.steps.push(newStep);
        state.origOrders.push(Object.keys(newStep));
        state.pendingActionForAdd = actionSel.value;
        state.selectedId = id;
        markDirty();
        renderAll();
        renderInspector();
        overlay.remove();
      });
      setTimeout(() => idInput.focus(), 0);
    }
  }

  // ---------- 保存 ----------
  function serializeStep(step, index) {
    const order = state.origOrders[index] && state.origOrders[index].length ? state.origOrders[index] : STEP_KEYS;
    const out = {};
    for (const k of order) if (step[k] !== undefined) out[k] = step[k];
    for (const k of STEP_KEYS) if (step[k] !== undefined && !(k in out)) out[k] = step[k];
    for (const k of Object.keys(step)) if (!(k in out)) out[k] = step[k];
    return out;
  }

  function serialize() {
    if (!state.raw) return '';
    const out = {};
    for (const k of TOP_KEYS) if (state.raw[k] !== undefined) out[k] = state.raw[k];
    for (const k of Object.keys(state.raw)) if (!(k in out)) out[k] = state.raw[k];
    if (Array.isArray(out.steps)) {
      out.steps = out.steps.map((s, i) => serializeStep(s, i));
    }
    return JSON.stringify(out, null, 2) + '\n';
  }

  function save() {
    const text = serialize();
    try {
      JSON.parse(text);
    } catch (e) {
      toast('无法保存：当前模型不是合法 JSON — ' + e.message, 3200);
      return;
    }
    vscode.postMessage({ type: 'save', text });
    state.dirty = false;
    state.externalNotice = false;
    $('external-banner').classList.add('hidden');
    refreshBadges();
    toast('已保存到文件');
  }

  // ---------- 事件绑定 ----------
  function wire() {
    const svg = $('graph');
    const wrap = $('canvas-wrap');
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const p = canvasPoint(e);
      const mx = p.x;
      const my = p.y;
      const worldX = (mx - state.panX) / state.zoom;
      const worldY = (my - state.panY) / state.zoom;
      state.zoom = Math.min(3, Math.max(0.2, state.zoom * factor));
      state.panX = mx - worldX * state.zoom;
      state.panY = my - worldY * state.zoom;
      renderAll();
    }, { passive: false });
    svg.addEventListener('mousedown', (e) => startDrag(e, null));
    // 用 window 级鼠标事件，保证拖到画布外也能移动/收线/取消
    window.addEventListener('mousemove', (e) => moveDrag(e));
    window.addEventListener('mouseup', (e) => endDrag(e));
    window.addEventListener('blur', () => cancelDrag());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        removeConnectMenu();
        if (state.drag && state.drag.mode === 'connect') {
          state.drag = null;
          state.connectHoverId = null;
          renderAll();
        }
      }
    });

   $('btn-add').addEventListener('click', () => renderAddModal());
   $('btn-new').addEventListener('click', () => vscode.postMessage({ type: 'newWorkflow' }));
    $('btn-run').addEventListener('click', () => {
      if (state.dirty) {
        toast('请先保存工作流，再执行');
        return;
      }
      vscode.postMessage({ type: 'runWorkflow' });
    });
   $('btn-save').addEventListener('click', () => save());
    $('btn-open').addEventListener('click', () => vscode.postMessage({ type: 'openFile' }));
    $('btn-reload').addEventListener('click', () => {
      state.dirty = false;
      vscode.postMessage({ type: 'reloadRequest' });
    });

    window.addEventListener('resize', () => renderAll());
    vscode.postMessage({ type: 'ready' });
  }

  wire();
  renderAll();
})();
