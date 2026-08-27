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
  const NODE_W = 260; // 节点卡片宽度（UE 蓝图风格面板）
  const NODE_H = 140; // 节点卡片高度
  const HEAD_H = 28; // 彩色标题栏高度
  const TERMINAL_W = 200;
  const ROW_GAP = 96;
  const MARGIN = 40;
  const PORT_R = 6;
  const CONNECT_HIT = 18; // 放线落点命中半径（世界坐标）
  const SNAP = 12; // 拖拽节点时的网格吸附步长（UE 风格；按住 Ctrl+Alt 拖动可临时取消吸附）

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
    workflow: '子工作流',
    inputs: '传入参数',
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
  const STATUS_LABELS = {
    running: '运行中',
    succeeded: '已成功',
    failed: '已失败',
    skipped: '已跳过',
    cancelled: '已取消',
  };

  function clipText(text, max) {
    const value = String(text);
    if (value.length <= max) return value;
    return value.slice(0, max - 1) + '…';
  }

  const state = {
    raw: null,
    origOrders: [],
    catalog: [],
    refs: { inputs: [], steps: [] },
    issues: [],
    document: null,
    selectedId: null,
    selectedIds: new Set(), // 多选（UE 风格框选 / Shift 点选）
    selectedEdge: null, // { from, kind } 当前选中的连线
    run: { session: null, running: false, byStep: {} }, // 最近一次运行的步骤状态与截图缩略图
    dirty: false,
    zoom: 1,
    panX: 20,
    panY: 20,
    nodePos: {},
    drag: null,
    connectHoverId: null,
    addOpen: false,
    paramModes: {},
    roiPickPending: null,
    roiPicker: null,
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

  // ---------- 运行事件 ----------
  function applyRunEvent(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'run_started') {
      state.run = { session: event.run_id || null, running: true, byStep: {} };
      renderAll();
    } else if (event.type === 'step') {
      if (state.run && event.run_id && state.run.session === event.run_id) {
        const st = event.step || {};
        state.run.byStep[event.step_id] = {
          status: st.status || 'running',
          thumbnail: event.thumbnail || null,
          screenshot: event.screenshot || null,
          durationMs: typeof st.duration_ms === 'number' ? st.duration_ms : null,
          error: st.error ? String(st.error) : null,
        };
        renderAll();
      }
    } else if (event.type === 'run_finished') {
      if (state.run && event.run_id && state.run.session === event.run_id) {
        state.run.running = false;
        renderAll();
        const label = event.status === 'succeeded' ? '成功' : event.status === 'failed' ? '失败' : event.status;
        toast('工作流执行完成：' + label, 4200);
      }
    }
  }

  /** 重放最近一次运行的完整事件序列（刷新面板后缩略图仍在）。 */
  function applyRunEvents(events) {
    state.run = { session: null, running: false, byStep: {} };
    let sessionSnapshot = true;
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      if (event.type === 'run_started') {
        state.run = { session: event.run_id || null, running: true, byStep: {} };
        sessionSnapshot = true;
      } else if (event.type === 'step') {
        if (!sessionSnapshot || state.run.session !== event.run_id) continue;
        const st = event.step || {};
        state.run.byStep[event.step_id] = {
          status: st.status || 'running',
          thumbnail: event.thumbnail || null,
          screenshot: event.screenshot || null,
          durationMs: typeof st.duration_ms === 'number' ? st.duration_ms : null,
          error: st.error ? String(st.error) : null,
        };
      } else if (event.type === 'run_finished' && sessionSnapshot) {
        state.run.running = false;
      }
    }
    renderAll();
  }

  // ---------- 截图大图查看（点击卡片内缩略图） ----------
  function lightboxEl() {
    let overlay = document.getElementById('lightbox');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'lightbox';
      overlay.className = 'hidden';
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) closeLightbox();
      });
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function openLightbox(stepId) {
    const info = state.run && state.run.byStep[stepId];
    if (!info) return;
    hideThumbPreview();
    const overlay = lightboxEl();
    overlay.innerHTML = '';
    const frame = document.createElement('div');
    frame.className = 'lightbox-frame';
    const title = document.createElement('div');
    title.className = 'lightbox-title';
    const statusLabel = STATUS_LABELS[info.status] || info.status || '';
    const dur = info.durationMs != null ? ' · ' + info.durationMs + 'ms' : '';
    title.textContent = '步骤「' + stepId + '」' + (statusLabel ? ' · ' + statusLabel : '') + dur;
    frame.appendChild(title);
    if (info.error) {
      const err = document.createElement('div');
      err.className = 'lightbox-error';
      err.textContent = '✗ ' + info.error;
      frame.appendChild(err);
    }
    const img = document.createElement('img');
    img.src = info.screenshot || (info.thumbnail ? 'data:image/png;base64,' + info.thumbnail : '');
    img.alt = '步骤 ' + stepId + ' 截图';
    frame.appendChild(img);
    const close = document.createElement('button');
    close.className = 'primary';
    close.textContent = '关闭';
    close.addEventListener('click', () => closeLightbox());
    frame.appendChild(close);
    overlay.appendChild(frame);
    overlay.classList.remove('hidden');
  }

  /** 缩略图悬停：浮动大预览（跟随鼠标，不阻碍点击）。 */
  function thumbPreviewEl() {
    let el = document.getElementById('thumb-preview');
    if (!el) {
      el = document.createElement('div');
      el.id = 'thumb-preview';
      el.className = 'hidden';
      document.body.appendChild(el);
    }
    return el;
  }

  function showThumbPreview(e, stepId) {
    const info = state.run && state.run.byStep[stepId];
    if (!info) return;
    const src = info.screenshot || (info.thumbnail ? 'data:image/png;base64,' + info.thumbnail : null);
    if (!src) return;
    const el = thumbPreviewEl();
    el.textContent = '';
    const img = document.createElement('img');
    img.src = src;
    el.appendChild(img);
    const label = document.createElement('div');
    label.className = 'thumb-preview-label';
    label.textContent = '步骤「' + stepId + '」' + (STATUS_LABELS[info.status] || '');
    el.appendChild(label);
    el.classList.remove('hidden');
    let x = e.clientX + 14;
    let y = e.clientY + 10;
    if (x > window.innerWidth - 340) x = e.clientX - 340;
    if (y > window.innerHeight - 230) y = e.clientY - 220;
    el.style.left = Math.max(4, x) + 'px';
    el.style.top = Math.max(4, y) + 'px';
  }

  function hideThumbPreview() {
    const el = document.getElementById('thumb-preview');
    if (el) el.classList.add('hidden');
  }

  function closeLightbox() {
    const overlay = document.getElementById('lightbox');
    if (overlay) overlay.classList.add('hidden');
  }

  function lightboxOpen() {
    const overlay = document.getElementById('lightbox');
    return !!overlay && !overlay.classList.contains('hidden');
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
      case 'runEvent':
        applyRunEvent(msg.event);
        break;
      case 'runReplay':
        applyRunEvents(Array.isArray(msg.events) ? msg.events : []);
        break;
      case 'roiSelected':
        applyPickedRoi(msg);
        break;
      case 'roiPickerImage':
        openRoiPicker(msg);
        break;
      case 'roiPickerCancelled':
        if (!msg.requestId || msg.requestId === state.roiPickPending) {
          closeRoiPicker();
          state.roiPickPending = null;
          renderInspector();
        }
        break;
      case 'roiPickerError':
        if (!state.roiPickPending || !msg.requestId || msg.requestId === state.roiPickPending) {
          closeRoiPicker();
          state.roiPickPending = null;
          toast('ROI 选择失败：' + (msg.message || '未知错误'), 4200);
          renderInspector();
        }
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
    state.paramModes = {};
    state.roiPickPending = null;
    state.selectedId = state.raw && state.raw.entry ? state.raw.entry : (Array.isArray(state.raw && state.raw.steps) && state.raw.steps[0] ? state.raw.steps[0].id : null);
    state.selectedIds = new Set(state.selectedId ? [state.selectedId] : []);
    state.selectedEdge = null;
    // 卡片位置持久化：从原脚本的 _layout 元数据字段恢复
    state.nodePos = {};
    {
      const layoutRaw = state.raw && state.raw._layout;
      if (layoutRaw && typeof layoutRaw === 'object') {
        const valid = new Set(Array.isArray(state.raw.steps) ? state.raw.steps.map((s) => s && s.id).filter(Boolean) : []);
        const next = {};
        for (const key of Object.keys(layoutRaw)) {
          const p = layoutRaw[key];
          if (!valid.has(key) || !p || typeof p !== 'object') continue;
          const x = Number(p.x);
          const y = Number(p.y);
          if (Number.isFinite(x) && Number.isFinite(y)) next[key] = { x, y };
        }
        state.nodePos = next;
      }
    }
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
      const pushEdge = (kind, target, explicit, label, visible = true) => {
        if (!target || target === s.id || !validIds.has(target)) return;
        edges.push({ from: s.id, to: target, kind, explicit, label, visible });
      };
      if (typeof s.on_success === 'string') pushEdge('on_success', s.on_success, true, '成功');
      else if (next !== s.id) pushEdge('on_success', next, false, '成功(默认)');
      if (typeof s.on_failure === 'string') pushEdge('on_failure', s.on_failure, true, '失败');
      else pushEdge('on_failure', '$failure', false, '失败(默认)', false);
      if (typeof s.on_skip === 'string') pushEdge('on_skip', s.on_skip, true, '跳过');
      else if (s.when !== undefined && s.when !== null && next !== s.id) pushEdge('on_skip', next, false, '跳过(默认)', false);
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

  /** UE 蓝图式连线张力：水平/垂直位移各自钳制后相加；目标在左（回连）时弯度更大。 */
  function connectionTension(sx, sy, tx, ty) {
    const dx = tx - sx;
    const dy = ty - sy;
    let tension;
    if (dx >= 0) {
      tension = Math.min(Math.abs(dx), 1000) + Math.min(Math.abs(dy), 1000);
    } else {
      tension = 2 * Math.min(Math.abs(dx), 220) + 1.5 * Math.min(Math.abs(dy), 220);
    }
    return Math.max(24, Math.min(tension, 360));
  }

  /**
   * UE 的 MakeDrawSpaceSpline 接收 Hermite 切线；SVG C 命令接收 Bezier 控制点。
   * 三次曲线的控制点是 P0 + tangent / 3 与 P1 - tangent / 3。
   */
  function connectionPath(sx, sy, tx, ty) {
    const controlOffset = connectionTension(sx, sy, tx, ty) / 3;
    return `M ${sx} ${sy} C ${sx + controlOffset} ${sy}, ${tx - controlOffset} ${ty}, ${tx} ${ty}`;
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
      if (edge.visible === false) continue;
      const from = effectivePos(layout.positions[edge.from]);
      const to = effectivePos(layout.positions[edge.to]);
      const kindIndex = EDGE_KINDS.indexOf(edge.kind);
      const sx = from.x + NODE_W;
      const sy = from.y + outputPinY(Math.max(0, kindIndex));
      const tx = to.x;
      const toNode = layout.nodes.find((n) => n.id === edge.to);
      const ty = to.y + (toNode && toNode.kind === 'terminal' ? terminalInputPinY() : stepInputPinY());
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const d = connectionPath(sx, sy, tx, ty);
      const g = svgEl('g', { class: 'edge ' + edge.kind + (edge.explicit ? '' : ' fallthrough') + (state.selectedEdge && state.selectedEdge.from === edge.from && state.selectedEdge.kind === edge.kind ? ' selected' : '') });
      const path = svgEl('path', { d, class: edge.explicit ? 'line' : '' });
      g.appendChild(path);
      // 点击连线选中（UE 风格：选中后按 Delete 删除该连线）
      g.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        selectEdge(edge.from, edge.kind);
      });
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

    // 连线橡皮筋（正在拖拽连线时，从输出引脚开始；吸附到目标引脚时线尾贴住引脚）
    if (state.drag && state.drag.mode === 'connect') {
      const from = effectivePos(layout.positions[state.drag.fromId]);
      const kindIndex = EDGE_KINDS.indexOf(state.drag.edgeKind);
      const sx = from.x + NODE_W;
      const sy = from.y + outputPinY(Math.max(0, kindIndex));
      const snapped = !!state.drag.snap;
      const c = snapped ? state.drag.snap : (state.drag.cursorWorld || { x: sx + 100, y: sy });
      const d = connectionPath(sx, sy, c.x, c.y);
      const g = svgEl('g', { class: 'edge connect ' + state.drag.edgeKind + (snapped ? ' snapped' : '') });
      g.appendChild(svgEl('path', { d }));
      // 吸附时在目标引脚上画一个明显的接收点
      if (snapped) {
        g.appendChild(svgEl('circle', { class: 'connect-snap-ring', cx: c.x, cy: c.y, r: PORT_R + 5 }));
      }
      const label = svgEl('text', { x: (sx + c.x) / 2, y: (sy + c.y) / 2 - 8, 'text-anchor': 'middle' });
      label.textContent = EDGE_KIND_LABELS[state.drag.edgeKind] || state.drag.edgeKind;
      g.appendChild(label);
      viewport.appendChild(g);
    }

    // 框选矩形（UE 风格 marquee selection）
    if (state.drag && state.drag.mode === 'marquee') {
      const a = state.drag.startWorld;
      const b = state.drag.endWorld;
      viewport.appendChild(svgEl('rect', {
        class: 'marquee',
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
      }));
    }

    // nodes（UE 蓝图风格卡片：彩色标题栏 + 主体 + 左右执行引脚）
    for (const node of layout.nodes) {
      const pos = effectivePos(layout.positions[node.id]);
      const isTerminal = node.kind === 'terminal';
      const w = isTerminal ? TERMINAL_W : NODE_W;
      const kindClass = isTerminal ? 'kind-terminal' : node.isEntry ? 'kind-entry' : 'kind-step';
      const isDrag = state.drag && state.drag.mode === 'node' && state.drag.nodeId === node.id;
      const isConnectTarget = state.connectHoverId === node.id;
      const runInfo = !isTerminal ? (state.run && state.run.byStep[node.id]) || null : null;
      const g = svgEl('g', {
        class: 'node ' + kindClass + (isTerminal ? ' terminal' : '') + (isDrag ? ' dragging' : '') + (isConnectTarget ? ' connect-target' : '') + (runInfo ? ' run-' + runInfo.status : ''),
        transform: `translate(${pos.x},${pos.y})`,
        style: 'cursor: grab',
      });
      g.dataset.id = node.id;
      const step = stepsOf()[node.index];
      const nodeTitle = svgEl('title', {});
      nodeTitle.textContent = isTerminal ? '执行终点：' + node.label : '拖动卡片调整位置；点击卡片选择步骤；从右侧彩色引脚拖出连线';
      g.appendChild(nodeTitle);
      // 面板主体
      const box = svgEl('rect', { class: 'node-box' + (state.selectedIds.has(node.id) ? ' selected' : ''), width: w, height: NODE_H, rx: 7, ry: 7 });
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
      // 运行状态点（标题栏右上角，tooltip 带状态与耗时）
      if (runInfo) {
        const dot = svgEl('circle', { class: 'run-dot run-' + runInfo.status, cx: w - 8, cy: HEAD_H / 2, r: 4 });
        const dotTip = svgEl('title', {});
        const dur = runInfo.durationMs != null ? ' · ' + runInfo.durationMs + 'ms' : '';
        dotTip.textContent = (STATUS_LABELS[runInfo.status] || runInfo.status) + dur;
        dot.appendChild(dotTip);
        g.appendChild(dot);
      }
      if (!isTerminal) {
        const hasThumb = !!(runInfo && runInfo.thumbnail);
        const textX = hasThumb ? 84 : 12;
        // 序号徽章（有运行缩略图时省略，让位给截图）
        if (!hasThumb && node.index >= 0) {
          g.appendChild(svgEl('rect', { class: 'node-seq', x: 6, y: HEAD_H + 10, width: 16, height: 16, rx: 3 }));
          const seqText = svgEl('text', { x: 14, y: HEAD_H + 21, 'text-anchor': 'middle', class: 'node-seq-text' });
          seqText.textContent = String(node.index + 1);
          g.appendChild(seqText);
        }
        // 主体：步骤 id（有缩略图/序号徽章时右移）
        const idText = svgEl('text', { x: hasThumb ? 84 : 28, y: HEAD_H + 22, class: 'node-id' });
        idText.textContent = node.label;
        g.appendChild(idText);
        // when 条件标记（id 行右侧）
        if (step && step.when !== undefined && step.when !== null) {
          const whenText = svgEl('text', { x: w - 44, y: HEAD_H + 21, 'text-anchor': 'end', class: 'node-when' });
          whenText.textContent = 'when';
          const whenTip = svgEl('title', {});
          whenTip.textContent = '仅当条件成立时执行：' + JSON.stringify(step.when);
          whenText.appendChild(whenTip);
          g.appendChild(whenText);
        }
        // 参数摘要（最多两行，超长截断）
        if (step && step.with && typeof step.with === 'object') {
          Object.keys(step.with).slice(0, 2).forEach((key, row) => {
            const v = step.with[key];
            const shown = v !== null && typeof v === 'object' ? (v.$ref || JSON.stringify(v)) : String(v);
            const sum = svgEl('text', { x: textX, y: HEAD_H + 38 + row * 16, class: 'node-params' });
            sum.textContent = clipText(key + ': ' + shown, 36);
            g.appendChild(sum);
          });
        }
        // 失败错误摘要（主体底部红字）
        if (runInfo && runInfo.status === 'failed' && runInfo.error) {
          const errText = svgEl('text', { x: textX, y: HEAD_H + 72, class: 'node-error' });
          errText.textContent = clipText('✗ ' + runInfo.error, 42);
          const errTip = svgEl('title', {});
          errTip.textContent = runInfo.error;
          errText.appendChild(errTip);
          g.appendChild(errText);
        }
        // 运行耗时 / 状态行（主体底部）：成功显示耗时，运行中/跳过/取消显示状态
        if (runInfo && runInfo.status === 'succeeded') {
          const durText = svgEl('text', { x: textX, y: HEAD_H + 72, class: 'node-duration' });
          durText.textContent = '✓ ' + (runInfo.durationMs != null ? runInfo.durationMs + ' ms' : '完成');
          g.appendChild(durText);
        } else if (runInfo && runInfo.status === 'running') {
          const runText = svgEl('text', { x: textX, y: HEAD_H + 72, class: 'node-duration running' });
          runText.textContent = '运行中…';
          g.appendChild(runText);
        } else if (runInfo && (runInfo.status === 'skipped' || runInfo.status === 'cancelled')) {
          const skipText = svgEl('text', { x: textX, y: HEAD_H + 72, class: 'node-duration muted' });
          skipText.textContent = runInfo.status === 'skipped' ? '已跳过' : '已取消';
          g.appendChild(skipText);
        } else if (!runInfo && (!step || typeof step.on_failure !== 'string')) {
          const defaultFailure = svgEl('text', { x: textX, y: HEAD_H + 72, class: 'node-default' });
          defaultFailure.textContent = '失败 → 终止';
          const defaultFailureTip = svgEl('title', {});
          defaultFailureTip.textContent = '未配置失败跳转，默认进入失败终点';
          defaultFailure.appendChild(defaultFailureTip);
          g.appendChild(defaultFailure);
        }
        if (!runInfo && step && step.when !== undefined && step.when !== null && typeof step.on_skip !== 'string') {
          const defaultSkip = svgEl('text', { x: textX, y: HEAD_H + 88, class: 'node-default' });
          defaultSkip.textContent = '跳过 → 下一步';
          const defaultSkipTip = svgEl('title', {});
          defaultSkipTip.textContent = '条件不满足时默认进入下一步';
          defaultSkip.appendChild(defaultSkipTip);
          g.appendChild(defaultSkip);
        }
        // 运行截图缩略图：悬停浮动预览，点击放大查看
        if (runInfo && runInfo.thumbnail) {
          const img = svgEl('image', {
            x: 10,
            y: HEAD_H + 14,
            width: 64,
            height: 72,
            preserveAspectRatio: 'xMidYMid slice',
            href: 'data:image/png;base64,' + runInfo.thumbnail,
            class: 'step-thumb',
          });
          const imgTip = svgEl('title', {});
          imgTip.textContent = '悬停预览 · 点击查看大图（' + node.id + '）';
          img.appendChild(imgTip);
          img.addEventListener('mousemove', (e) => showThumbPreview(e, node.id));
          img.addEventListener('mouseleave', () => hideThumbPreview());
          img.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openLightbox(node.id);
          });
          g.appendChild(img);
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
      const inPort = svgEl('circle', { class: 'port port-in' + (state.connectHoverId === node.id ? ' pin-hover' : ''), cx: 0, cy: inY, r: PORT_R });
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
    // UE 操作习惯：右键 / 中键拖拽 = 平移画布；左键拖节点 = 移动；左键拖空白 = 框选
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      if (nodeId) e.stopPropagation();
      removeConnectMenu();
      state.drag = {
        mode: 'pan',
        button: e.button,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: state.panX,
        startPanY: state.panY,
        moved: false,
      };
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    removeConnectMenu();
    if (nodeId) {
      e.stopPropagation(); // 防止冒泡到 svg 被当成框选
      state.selectedEdge = null;
      if (!state.selectedIds.has(nodeId)) {
        if (e.shiftKey) {
          state.selectedIds.add(nodeId);
        } else {
          state.selectedIds = new Set([nodeId]);
        }
        state.selectedId = nodeId;
        renderAll();
        renderInspector();
      }
      // 记录所有已选中节点的起始位置，拖动时整组随动（用 effectivePos 保留已拖过的手动位置）
      const layout = computeLayout();
      const startPositions = {};
      for (const id of state.selectedIds) {
        const bp = layout.positions[id];
        startPositions[id] = bp ? effectivePos(bp) : { x: 0, y: 0 };
      }
      state.drag = {
        mode: 'node',
        nodeId,
        dragIds: [...state.selectedIds],
        startPositions,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: state.panX,
        startPanY: state.panY,
        moved: false,
      };
    } else {
      state.drag = {
        mode: 'marquee',
        startWorld: screenToWorld(e),
        endWorld: screenToWorld(e),
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
      };
    }
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
      // UE 风格：整组选中节点一起移动；默认吸附网格，按住 Ctrl+Alt 拖动临时取消吸附
      const dxw = dx / state.zoom;
      const dyw = dy / state.zoom;
      const noSnap = !!(e.ctrlKey && e.altKey);
      for (const id of state.drag.dragIds) {
        const base = state.drag.startPositions[id];
        if (!base) continue;
        let nx = base.x + dxw;
        let ny = base.y + dyw;
        if (!noSnap) {
          nx = Math.round(nx / SNAP) * SNAP;
          ny = Math.round(ny / SNAP) * SNAP;
        }
        state.nodePos[id] = { x: nx, y: ny };
      }
      renderAll();
    } else if (state.drag.mode === 'marquee') {
      state.drag.endWorld = screenToWorld(e);
      renderAll();
    } else if (state.drag.mode === 'connect') {
      state.drag.cursorWorld = screenToWorld(e);
      // UE 风格：磁吸——进入目标输入引脚命中区时，线尾吸到引脚中心
      const hit = pinAtWorld(state.drag.cursorWorld);
      state.connectHoverId = hit ? hit.nodeId : null;
      state.drag.snap = null;
      if (hit && hit.nodeId !== state.drag.fromId) {
        const layout = computeLayout();
        const pos = effectivePos(layout.positions[hit.nodeId]);
        const targetNode = layout.nodes.find((n) => n.id === hit.nodeId);
        const inY = targetNode && targetNode.kind === 'terminal' ? terminalInputPinY() : stepInputPinY();
        state.drag.snap = { x: pos.x, y: pos.y + inY };
      }
      renderAll();
    }
  }

  function endDrag(e) {
    if (!state.drag) return;
    const wasDrag = state.drag;
    state.drag = null;
    if (wasDrag.mode === 'marquee') {
      state.connectHoverId = null;
      if (wasDrag.moved) {
        const sel = new Set(nodesInRect(wasDrag.startWorld, wasDrag.endWorld));
        state.selectedIds = sel;
        state.selectedId = sel.size ? [...sel][0] : null;
        state.selectedEdge = null;
        renderAll();
        renderInspector();
      } else {
        // 点击空白处：取消选中
        state.selectedIds = new Set();
        state.selectedId = null;
        state.selectedEdge = null;
        renderAll();
        renderInspector();
      }
    } else if (wasDrag.mode === 'node') {
      // 位置已在移动中实时更新；mousedown 时已完成选中
      renderAll();
      renderInspector();
      if (wasDrag.moved) markDirty();
    } else if (wasDrag.mode === 'connect') {
      // UE 风格：必须释放到目标输入引脚上才连线，否则取消
      const target = wasDrag.cursorWorld ? pinAtWorld(wasDrag.cursorWorld) : null;
      state.connectHoverId = null;
      if (target && target.nodeId !== wasDrag.fromId) {
        applyConnection(wasDrag.fromId, target.nodeId, wasDrag.edgeKind);
        state.selectedEdge = { from: wasDrag.fromId, kind: wasDrag.edgeKind };
      }
      renderAll();
    } else if (wasDrag.mode === 'pan') {
      state.connectHoverId = null;
      // 右键单击（无位移）＝ UE 节点面板：添加步骤菜单
      if (!wasDrag.moved && wasDrag.button === 2) {
        showAddMenu({ clientX: wasDrag.startClientX, clientY: wasDrag.startClientY });
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

  /** 命中检测（UE 风格）：只有悬停在节点左侧输入引脚附近才算连线落点；半径按缩放归一，屏幕手感触感恒定。 */
  function pinAtWorld(p) {
    const layout = computeLayout();
    const hitRadius = 12 / (state.zoom || 1);
    for (const node of layout.nodes) {
      const pos = effectivePos(layout.positions[node.id]);
      const inY = node.kind === 'terminal' ? terminalInputPinY() : stepInputPinY();
      const ddx = Math.abs(p.x - pos.x);
      const ddy = Math.abs(p.y - (pos.y + inY));
      if (ddx <= hitRadius && ddy <= hitRadius) return { nodeId: node.id };
    }
    return null;
  }

  /** 框选：返回与矩形相交的节点 id。 */
  function nodesInRect(a, b) {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    const layout = computeLayout();
    const result = [];
    for (const node of layout.nodes) {
      const pos = effectivePos(layout.positions[node.id]);
      const w = node.kind === 'terminal' ? TERMINAL_W : NODE_W;
      if (pos.x < x1 && pos.x + w > x0 && pos.y < y1 && pos.y + NODE_H > y0) result.push(node.id);
    }
    return result;
  }

  /** 选中一条连线（点击连线，Delete 删除）。 */
  function selectEdge(fromId, kind) {
    state.selectedEdge = { from: fromId, kind };
    state.selectedIds = new Set();
    state.selectedId = null;
    renderAll();
    renderInspector();
  }

  /** 单选一个节点。 */
  function selectOnly(id) {
    state.selectedIds = new Set(id ? [id] : []);
    state.selectedId = id || null;
    state.selectedEdge = null;
    renderAll();
    renderInspector();
  }

  const DELETE_REF = {};

  function referencesDeletedStep(value, ids) {
    if (typeof value !== 'string') return false;
    const match = /^steps\.([^.]+)\.output(?:\.|$)/.exec(value);
    return !!match && ids.has(match[1]);
  }

  /** 删除指向已删除步骤的嵌套 $ref，同时保留其余工作流内容。 */
  function cleanDeletedReferences(value, ids) {
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) {
        if (cleanDeletedReferences(value[i], ids) === DELETE_REF) value.splice(i, 1);
      }
      return value;
    }
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).length === 1 && typeof value.$ref === 'string' && referencesDeletedStep(value.$ref, ids)) {
      return DELETE_REF;
    }
    for (const key of Object.keys(value)) {
      if (cleanDeletedReferences(value[key], ids) === DELETE_REF) delete value[key];
    }
    return value;
  }

  function cleanupDeletedStepReferences(ids) {
    for (const step of stepsOf()) {
      if (!step || typeof step !== 'object') continue;
      for (const key of EDGE_KINDS) {
        if (step[key] && ids.has(step[key])) delete step[key];
      }
      if (cleanDeletedReferences(step.with, ids) === DELETE_REF) delete step.with;
      if (cleanDeletedReferences(step.when, ids) === DELETE_REF) delete step.when;
      if (cleanDeletedReferences(step.retry, ids) === DELETE_REF) delete step.retry;
      if (step.when && typeof step.when === 'object' && !Array.isArray(step.when) && Object.keys(step.when).length === 0) {
        delete step.when;
      }
    }
  }

  /** 删除所有选中的步骤（UE：选中后按 Delete），并清理指向它们的跳转。 */
  function deleteSelectedSteps() {
    if (state.selectedIds.size === 0) return;
    const steps = stepsOf();
    const ids = new Set(steps.filter((s) => s && state.selectedIds.has(s.id)).map((s) => s.id));
    if (ids.size === 0) return;
    state.raw.steps = steps.filter((s) => !(s && ids.has(s.id)));
    state.origOrders = state.raw.steps.map((s) => (s && typeof s === 'object' ? Object.keys(s) : []));
    cleanupDeletedStepReferences(ids);
    if (state.raw.entry && ids.has(state.raw.entry)) {
      state.raw.entry = (state.raw.steps[0] && state.raw.steps[0].id) || '';
    }
    void (ids.forEach((removedId) => delete state.nodePos[removedId]));
    state.selectedIds = new Set();
    state.selectedId = null;
    state.selectedEdge = null;
    markDirty();
    renderAll();
    renderInspector();
    toast('已删除 ' + ids.size + ' 个步骤');
  }

  /** UE 风格视图适应：F 聚焦选中（或全部），Home 适应全部。 */
  function fitView(ids) {
    const layout = computeLayout();
    const wrap = $('canvas-wrap');
    const nodes = layout.nodes.filter((n) => !ids || ids.includes(n.id));
    if (!nodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const pos = effectivePos(layout.positions[n.id]);
      const w = n.kind === 'terminal' ? TERMINAL_W : NODE_W;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + w);
      maxY = Math.max(maxY, pos.y + NODE_H);
    }
    const pad = 80;
    const cw = wrap.clientWidth || 800;
    const ch = (wrap.clientHeight || 600) - 24;
    const zoom = Math.min(3, Math.max(0.2, Math.min((cw - pad * 2) / (maxX - minX || 1), (ch - pad * 2) / (maxY - minY || 1))));
    state.zoom = zoom;
    state.panX = (cw - (maxX - minX) * zoom) / 2 - minX * zoom;
    state.panY = (ch - (maxY - minY) * zoom) / 2 - minY * zoom;
    renderAll();
  }

  /** 右键单击空白处弹出 UE 风格节点面板：选择要添加的 Action。 */
  function showAddMenu(e) {
    removeConnectMenu();
    const menu = document.createElement('div');
    menu.className = 'connect-menu palette-menu';
    const rect = $('canvas-wrap').getBoundingClientRect();
    const left = Math.max(4, Math.min(e.clientX - rect.left, rect.width - 230));
    const top = Math.max(4, Math.min(e.clientY - rect.top, rect.height - 260));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    const header = document.createElement('div');
    header.className = 'connect-menu-title';
    header.textContent = '添加步骤';
    menu.appendChild(header);
    const world = screenToWorld(e);
    for (const spec of state.catalog) {
      const btn = document.createElement('button');
      btn.textContent = actionLabel(spec.name) + '（' + spec.name + '）';
      btn.style.textAlign = 'left';
      btn.style.width = '100%';
      btn.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      btn.addEventListener('click', () => {
        removeConnectMenu();
        addStepAt(spec.name, world);
      });
      menu.appendChild(btn);
    }
    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    cancel.style.width = '100%';
    cancel.addEventListener('click', removeConnectMenu);
    menu.appendChild(cancel);
    $('canvas-wrap').appendChild(menu);
  }

  /** 在指定世界坐标处（吸附网格）添加一个步骤并选中它。 */
  function addStepAt(action, world) {
    const existing = new Set(stepsOf().map((s) => s && s.id).filter(Boolean));
    let n = 1;
    while (existing.has('step_' + n)) n++;
    const id = 'step_' + n;
    const step = { id, action };
    state.raw.steps.push(step);
    state.origOrders.push(Object.keys(step));
    if (!state.raw.entry) state.raw.entry = id;
    state.nodePos[id] = {
      x: Math.round(world.x / SNAP) * SNAP,
      y: Math.round(world.y / SNAP) * SNAP,
    };
    state.selectedIds = new Set([id]);
    state.selectedId = id;
    state.selectedEdge = null;
    markDirty();
    renderAll();
    renderInspector();
    toast('已添加步骤 ' + id + '（' + action + '）');
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
    if (state.selectedEdge && state.selectedEdge.from === fromId && state.selectedEdge.kind === kind) {
      state.selectedEdge = null;
    }
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

  function isRefValue(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.$ref === 'string';
  }

  function refChoices() {
    const refs = [...((state.refs && state.refs.inputs) || []), ...((state.refs && state.refs.steps) || [])];
    return [...new Set(refs.filter((ref) => typeof ref === 'string' && ref))];
  }

  function refSelect(currentRef, onChange) {
    const select = document.createElement('select');
    select.className = 'param-ref-select';
    const choices = refChoices();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = choices.length ? '请选择一个引用…' : '暂无可用引用';
    select.appendChild(placeholder);
    if (currentRef && !choices.includes(currentRef)) choices.unshift(currentRef);
    for (const ref of choices) {
      const option = document.createElement('option');
      option.value = ref;
      option.textContent = refLabel(ref);
      select.appendChild(option);
    }
    select.value = currentRef || '';
    select.disabled = choices.length === 0;
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function inputText(value) {
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  function itemSchema(schema, index) {
    if (!schema || typeof schema !== 'object') return {};
    if (Array.isArray(schema.prefixItems) && schema.prefixItems[index]) return schema.prefixItems[index];
    if (Array.isArray(schema.items) && schema.items[index]) return schema.items[index];
    return schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items) ? schema.items : {};
  }

  function itemLabel(key, index) {
    const labels = {
      roi: ['X', 'Y', '宽度', '高度'],
      random_interval: ['最小秒数', '最大秒数'],
    };
    return labels[key] && labels[key][index] ? labels[key][index] : `第 ${index + 1} 项`;
  }

  function parseTypedValue(text, schema) {
    const type = schemaType(schema);
    if (type === 'number') {
      if (String(text).trim() === '') throw new Error('不能为空');
      const value = Number(text);
      if (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) throw new Error('必须是数字');
      return value;
    }
    if (type === 'boolean') return String(text) === 'true';
    if (type === 'object' || type === 'any') return JSON.parse(text);
    return String(text);
  }

  function buildArrayEditor(key, pSchema, step, cur) {
    const editor = document.createElement('div');
    editor.className = 'array-editor';
    const rows = document.createElement('div');
    rows.className = 'array-rows';
    editor.appendChild(rows);
    const status = document.createElement('span');
    status.className = 'array-status hint';
    editor.appendChild(status);
    const fixedCount = pSchema && pSchema.minItems !== undefined && pSchema.minItems === pSchema.maxItems
      ? Number(pSchema.minItems)
      : 0;
    const minItems = pSchema && pSchema.minItems !== undefined ? Number(pSchema.minItems) : 0;
    const maxItems = pSchema && pSchema.maxItems !== undefined ? Number(pSchema.maxItems) : Infinity;

    function currentValues() {
      const value = step.with && Array.isArray(step.with[key]) ? step.with[key] : [];
      return value.slice();
    }

    function writeValues(values) {
      if (values.length === 0) {
        if (step.with) delete step.with[key];
      } else {
        step.with = step.with || {};
        step.with[key] = values;
      }
      markDirty();
    }

    function commit(controls) {
      const texts = controls.map((control) => String(control.value || '').trim());
      if (texts.every((text) => text === '')) {
        writeValues([]);
        status.textContent = '';
        return;
      }
      if (texts.some((text) => text === '')) {
        status.textContent = fixedCount ? `请填写 ${fixedCount} 项后保存` : '数组项不能为空';
        return;
      }
      if (texts.length < minItems || texts.length > maxItems) {
        status.textContent = `需要 ${minItems}${maxItems !== Infinity ? `-${maxItems}` : ''} 项`;
        return;
      }
      try {
        writeValues(texts.map((text, index) => parseTypedValue(text, itemSchema(pSchema, index))));
        status.textContent = '';
      } catch (e) {
        status.textContent = e.message;
      }
    }

    function renderRows() {
      rows.innerHTML = '';
      const values = currentValues();
      const count = Math.max(fixedCount, values.length);
      const controls = [];
      for (let index = 0; index < count; index++) {
        const row = document.createElement('div');
        row.className = 'array-row';
        const input = document.createElement('input');
        const schema = itemSchema(pSchema, index);
        input.type = schemaType(schema) === 'number' ? 'number' : 'text';
        if (input.type === 'number') {
          if (schema.minimum !== undefined) input.min = schema.minimum;
          if (schema.maximum !== undefined) input.max = schema.maximum;
          input.step = schema.type === 'integer' ? 1 : 'any';
        }
        input.placeholder = itemLabel(key, index);
        input.value = inputText(values[index]);
        controls.push(input);
        row.appendChild(input);
        const label = document.createElement('span');
        label.className = 'array-index';
        label.textContent = itemLabel(key, index);
        row.appendChild(label);
        if (!fixedCount) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'icon-button';
          remove.textContent = '×';
          remove.title = '删除这一项';
          remove.setAttribute('aria-label', '删除这一项');
          remove.disabled = count <= minItems;
          remove.addEventListener('click', () => {
            const next = currentValues();
            next.splice(index, 1);
            writeValues(next);
            renderRows();
          });
          row.appendChild(remove);
        }
        input.addEventListener('change', () => commit(controls));
        rows.appendChild(row);
      }
      if (!fixedCount) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'array-add';
        add.textContent = '+ 添加一项';
        add.disabled = count >= maxItems;
        add.addEventListener('click', () => {
          const next = currentValues();
          next.push('');
          step.with = step.with || {};
          step.with[key] = next;
          markDirty();
          renderRows();
        });
        editor.appendChild(add);
      }
      if (fixedCount) status.textContent = `共 ${fixedCount} 项`;
      else if (minItems) status.textContent = `至少 ${minItems} 项`;
    }
    renderRows();
    return editor;
  }

  function objectValueMode(value) {
    if (isRefValue(value)) return 'ref';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (value !== null && typeof value === 'object') return 'json';
    return 'text';
  }

  function objectEditor(key, step) {
    const editor = document.createElement('div');
    editor.className = 'object-editor';
    const rows = document.createElement('div');
    rows.className = 'object-rows';
    editor.appendChild(rows);
    const empty = document.createElement('span');
    empty.className = 'object-empty hint';
    empty.textContent = '暂无字段';
    editor.appendChild(empty);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'object-add';
    add.textContent = '+ 添加字段';
    add.addEventListener('click', () => {
      const value = step.with && step.with[key] && typeof step.with[key] === 'object' && !Array.isArray(step.with[key]) ? step.with[key] : {};
      let name = 'field_1';
      let index = 1;
      while (Object.prototype.hasOwnProperty.call(value, name)) name = `field_${++index}`;
      const next = { ...value, [name]: '' };
      step.with = step.with || {};
      step.with[key] = next;
      markDirty();
      renderRows();
    });
    editor.appendChild(add);

    function currentObject() {
      const value = step.with && step.with[key];
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function writeObject(value) {
      if (Object.keys(value).length === 0) {
        if (step.with) delete step.with[key];
      } else {
        step.with = step.with || {};
        step.with[key] = value;
      }
      markDirty();
    }

    function writeProperty(row, mode, control) {
      const name = row.key;
      if (!name) return;
      let value;
      try {
        if (mode === 'ref') {
          if (!control.value) return;
          value = { $ref: control.value };
        } else if (mode === 'text') {
          value = String(control.value);
        } else if (mode === 'number') {
          if (String(control.value).trim() === '') throw new Error('数字不能为空');
          value = Number(control.value);
          if (!Number.isFinite(value)) throw new Error('必须是数字');
        } else if (mode === 'boolean') {
          value = control.value === 'true';
        } else {
          value = JSON.parse(control.value);
        }
      } catch (e) {
        toast('字段 ' + name + ' 的值格式不正确：' + e.message, 3200);
        return;
      }
      const next = { ...currentObject(), [name]: value };
      writeObject(next);
    }

    function renderValue(row, valueWrap, modeSelect) {
      valueWrap.innerHTML = '';
      const value = currentObject()[row.key];
      const mode = modeSelect.value;
      let control;
      if (mode === 'ref') {
        control = refSelect(isRefValue(value) ? value.$ref : '', (ref) => writeProperty(row, mode, { value: ref }));
      } else if (mode === 'boolean') {
        control = document.createElement('select');
        for (const [v, text] of [['true', 'true'], ['false', 'false']]) {
          const option = document.createElement('option');
          option.value = v;
          option.textContent = text;
          control.appendChild(option);
        }
        control.value = String(value) === 'false' ? 'false' : 'true';
        control.addEventListener('change', () => writeProperty(row, mode, control));
      } else if (mode === 'json') {
        control = document.createElement('input');
        control.type = 'text';
        control.placeholder = '{...} 或 [...]';
        control.value = value === undefined ? '' : inputText(value);
        control.addEventListener('change', () => writeProperty(row, mode, control));
      } else if (mode === 'number') {
        control = document.createElement('input');
        control.type = 'number';
        control.value = value === undefined || value === null ? '' : String(value);
        control.addEventListener('change', () => writeProperty(row, mode, control));
      } else {
        control = document.createElement('input');
        control.type = 'text';
        control.placeholder = '值';
        control.value = value === undefined || value === null || isRefValue(value) ? '' : String(value);
        control.addEventListener('change', () => writeProperty(row, mode, control));
      }
      valueWrap.appendChild(control);
    }

    function renderRows() {
      rows.innerHTML = '';
      const value = currentObject();
      const keys = Object.keys(value);
      empty.classList.toggle('hidden', keys.length > 0);
      for (const keyName of keys) {
        const row = document.createElement('div');
        row.className = 'object-row';
        row.key = keyName;
        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.className = 'object-key';
        keyInput.value = keyName;
        keyInput.placeholder = '字段名';
        keyInput.addEventListener('change', () => {
          const nextName = keyInput.value.trim();
          const current = currentObject();
          if (!nextName || (nextName !== row.key && Object.prototype.hasOwnProperty.call(current, nextName))) {
            toast('字段名不能为空且不能重复', 2600);
            keyInput.value = row.key;
            return;
          }
          if (nextName === row.key) return;
          const next = {};
          for (const [name, item] of Object.entries(current)) next[name === row.key ? nextName : name] = item;
          row.key = nextName;
          writeObject(next);
        });
        row.appendChild(keyInput);
        const modeSelect = document.createElement('select');
        modeSelect.className = 'object-mode';
        for (const [mode, text] of [['text', '文本'], ['number', '数字'], ['boolean', '布尔'], ['json', 'JSON'], ['ref', '引用']]) {
          const option = document.createElement('option');
          option.value = mode;
          option.textContent = text;
          modeSelect.appendChild(option);
        }
        modeSelect.value = objectValueMode(value[keyName]);
        row.appendChild(modeSelect);
        const valueWrap = document.createElement('div');
        valueWrap.className = 'object-value';
        row.appendChild(valueWrap);
        renderValue(row, valueWrap, modeSelect);
        modeSelect.addEventListener('change', () => renderValue(row, valueWrap, modeSelect));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-button';
        remove.textContent = '×';
        remove.title = '删除字段';
        remove.setAttribute('aria-label', '删除字段');
        remove.addEventListener('click', () => {
          const next = { ...currentObject() };
          delete next[row.key];
          writeObject(next);
          renderRows();
        });
        row.appendChild(remove);
        rows.appendChild(row);
      }
    }
    renderRows();
    return editor;
  }

  function buildLiteralEditor(key, pSchema, step, cur) {
    const type = schemaType(pSchema);
    if (type === 'array') return buildArrayEditor(key, pSchema, step, cur);
    if (type === 'object' || (type === 'any' && cur && typeof cur === 'object' && !Array.isArray(cur))) return objectEditor(key, step);

    const control = document.createElement('input');
    const defaultText = pSchema && pSchema.default !== undefined ? inputText(pSchema.default) : '';
    if (pSchema && Array.isArray(pSchema.enum)) {
      const select = document.createElement('select');
      if (cur === undefined) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '使用默认值';
        select.appendChild(option);
      }
      for (const item of pSchema.enum) {
        const option = document.createElement('option');
        option.value = String(item);
        option.textContent = String(item);
        select.appendChild(option);
      }
      select.value = cur === undefined ? '' : String(cur);
      select.addEventListener('change', () => {
        if (select.value === '') {
          if (step.with) delete step.with[key];
        } else {
          step.with = step.with || {};
          step.with[key] = select.value;
        }
        markDirty();
      });
      return select;
    }
    if (type === 'boolean') {
      const select = document.createElement('select');
      const unset = document.createElement('option');
      unset.value = '';
      unset.textContent = '使用默认值';
      select.appendChild(unset);
      for (const [value, text] of [['true', '是 / true'], ['false', '否 / false']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      }
      select.value = cur === undefined || cur === null ? '' : String(cur);
      select.addEventListener('change', () => {
        if (select.value === '') {
          if (step.with) delete step.with[key];
        } else {
          step.with = step.with || {};
          step.with[key] = select.value === 'true';
        }
        markDirty();
      });
      return select;
    }
    control.type = type === 'number' ? 'number' : 'text';
    if (type === 'number') {
      if (pSchema && pSchema.minimum !== undefined) control.min = pSchema.minimum;
      if (pSchema && pSchema.maximum !== undefined) control.max = pSchema.maximum;
      control.step = pSchema && pSchema.type === 'integer' ? 1 : 'any';
    }
    if (key === 'workflow') control.placeholder = '例如 workflows/demo.json';
    else if (defaultText) control.placeholder = `默认：${defaultText}`;
    else control.placeholder = type === 'number' ? '请输入数字' : '请输入文本';
    control.value = cur === undefined || cur === null ? '' : inputText(cur);
    control.addEventListener('change', () => {
      const text = String(control.value);
      if (text.trim() === '') {
        if (step.with) delete step.with[key];
        markDirty();
        return;
      }
      try {
        const value = type === 'number' ? parseTypedValue(text, pSchema) : text;
        step.with = step.with || {};
        step.with[key] = value;
        markDirty();
      } catch (e) {
        toast('参数 ' + key + ' 格式不正确：' + e.message, 3200);
      }
    });
    return control;
  }

  function workflowReferenceResolution() {
    const value = state.raw && state.raw.reference_resolution;
    if (Array.isArray(value) && value.length === 2
      && value.every((item) => Number.isInteger(item) && item > 0)) {
      return value;
    }
    return [1920, 1080];
  }

  function postRoiPicker(requestId, stepId, key, referenceResolution, notice) {
    state.roiPickPending = requestId;
    vscode.postMessage({
      type: 'pickRoi',
      requestId,
      stepId,
      key,
      referenceResolution,
    });
    toast(notice || '正在从 MuMu 获取截图…', 4200);
    renderInspector();
  }

  function requestRoiPicker(stepId, key) {
    if (state.roiPickPending) {
      toast('已有一个 ROI 选择器正在打开', 2600);
      return;
    }
    const requestId = 'roi-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    postRoiPicker(requestId, stepId, key, workflowReferenceResolution(), '正在从 MuMu 获取截图…');
  }

  function roiPickerEl() {
    let overlay = document.getElementById('roi-picker');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'roi-picker';
      overlay.className = 'hidden';
      overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) cancelRoiPicker();
      });
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function openRoiPicker(message) {
    if (!state.roiPickPending || message.requestId !== state.roiPickPending) return;
    const width = Number(message.width);
    const height = Number(message.height);
    if (typeof message.dataUrl !== 'string' || !message.dataUrl
      || !Number.isInteger(width) || width < 1
      || !Number.isInteger(height) || height < 1) {
      state.roiPickPending = null;
      toast('MuMu 截图返回了无效数据', 4200);
      renderInspector();
      return;
    }
    closeRoiPicker();
    const overlay = roiPickerEl();
    overlay.textContent = '';

    const frame = document.createElement('div');
    frame.className = 'roi-picker-frame';
    const title = document.createElement('div');
    title.className = 'roi-picker-title';
    title.textContent = '选择识别区域';
    frame.appendChild(title);

    const stage = document.createElement('div');
    stage.className = 'roi-picker-stage';
    const image = document.createElement('img');
    image.src = message.dataUrl;
    image.alt = 'MuMu 当前画面';
    stage.appendChild(image);
    const selection = document.createElement('div');
    selection.className = 'roi-picker-selection hidden';
    stage.appendChild(selection);
    frame.appendChild(stage);

    const footer = document.createElement('div');
    footer.className = 'roi-picker-footer';
    const info = document.createElement('span');
    info.className = 'roi-picker-info';
    footer.appendChild(info);
    const actions = document.createElement('div');
    actions.className = 'roi-picker-actions';
    const recapture = document.createElement('button');
    recapture.type = 'button';
    recapture.textContent = '重新截图';
    recapture.addEventListener('click', () => recaptureRoi());
    actions.appendChild(recapture);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => cancelRoiPicker());
    actions.appendChild(cancel);
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'primary';
    confirm.textContent = '确认选择';
    confirm.disabled = true;
    confirm.addEventListener('click', () => confirmRoiSelection());
    actions.appendChild(confirm);
    footer.appendChild(actions);
    frame.appendChild(footer);
    overlay.appendChild(frame);
    overlay.classList.remove('hidden');

    const rawReference = message.referenceResolution;
    const referenceResolution = Array.isArray(rawReference) && rawReference.length === 2
      && rawReference.every((item) => Number.isInteger(item) && item > 0)
      ? [rawReference[0], rawReference[1]]
      : workflowReferenceResolution();
    state.roiPicker = {
      requestId: message.requestId,
      stepId: message.stepId,
      key: message.key,
      width,
      height,
      referenceResolution,
      image,
      stage,
      selection,
      info,
      confirm,
      drag: null,
    };
    image.addEventListener('load', () => renderRoiSelection());
    stage.addEventListener('mousedown', (event) => beginRoiSelection(event));
    renderRoiSelection();
  }

  function closeRoiPicker() {
    const overlay = document.getElementById('roi-picker');
    if (overlay) overlay.classList.add('hidden');
    state.roiPicker = null;
  }

  function roiImagePoint(event) {
    const picker = state.roiPicker;
    if (!picker) return null;
    const rect = picker.image.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.max(0, Math.min(picker.width, (event.clientX - rect.left) * picker.width / rect.width)),
      y: Math.max(0, Math.min(picker.height, (event.clientY - rect.top) * picker.height / rect.height)),
    };
  }

  function pickerRect(first, second) {
    const picker = state.roiPicker;
    if (!picker) return null;
    const x = Math.max(0, Math.min(picker.width, Math.round(Math.min(first.x, second.x))));
    const y = Math.max(0, Math.min(picker.height, Math.round(Math.min(first.y, second.y))));
    const right = Math.max(0, Math.min(picker.width, Math.round(Math.max(first.x, second.x))));
    const bottom = Math.max(0, Math.min(picker.height, Math.round(Math.max(first.y, second.y))));
    return { x, y, width: right - x, height: bottom - y };
  }

  function beginRoiSelection(event) {
    if (!state.roiPicker || event.button !== 0) return;
    const point = roiImagePoint(event);
    if (!point) return;
    state.roiPicker.drag = { start: point };
    state.roiPicker.selection = { x: Math.round(point.x), y: Math.round(point.y), width: 0, height: 0 };
    renderRoiSelection();
    event.preventDefault();
  }

  function moveRoiSelection(event) {
    const picker = state.roiPicker;
    if (!picker || !picker.drag) return;
    const point = roiImagePoint(event);
    if (!point) return;
    picker.selection = pickerRect(picker.drag.start, point);
    renderRoiSelection();
  }

  function endRoiSelection(event) {
    const picker = state.roiPicker;
    if (!picker || !picker.drag) return;
    const point = roiImagePoint(event);
    if (point) picker.selection = pickerRect(picker.drag.start, point);
    picker.drag = null;
    renderRoiSelection();
  }

  function renderRoiSelection() {
    const picker = state.roiPicker;
    if (!picker) return;
    const selected = picker.selection;
    const stageRect = picker.stage.getBoundingClientRect();
    const imageRect = picker.image.getBoundingClientRect();
    if (!selected || !imageRect.width || !imageRect.height) {
      picker.selection.classList.add('hidden');
      picker.confirm.disabled = true;
      picker.info.textContent = picker.width + '×' + picker.height;
      return;
    }
    const scaleX = imageRect.width / picker.width;
    const scaleY = imageRect.height / picker.height;
    picker.selection.style.left = (imageRect.left - stageRect.left + selected.x * scaleX) + 'px';
    picker.selection.style.top = (imageRect.top - stageRect.top + selected.y * scaleY) + 'px';
    picker.selection.style.width = Math.max(0, selected.width * scaleX) + 'px';
    picker.selection.style.height = Math.max(0, selected.height * scaleY) + 'px';
    picker.selection.classList.remove('hidden');
    picker.confirm.disabled = selected.width < 2 || selected.height < 2;
    picker.info.textContent = selected.width >= 2 && selected.height >= 2
      ? '选择区：' + selected.x + ',' + selected.y + ' ' + selected.width + '×' + selected.height
      : picker.width + '×' + picker.height;
  }

  function recaptureRoi() {
    const picker = state.roiPicker;
    if (!picker || state.roiPickPending !== picker.requestId) return;
    const context = {
      requestId: picker.requestId,
      stepId: picker.stepId,
      key: picker.key,
      referenceResolution: picker.referenceResolution,
    };
    closeRoiPicker();
    postRoiPicker(context.requestId, context.stepId, context.key, context.referenceResolution, '正在重新获取 MuMu 截图…');
  }

  function cancelRoiPicker() {
    if (!state.roiPickPending && !state.roiPicker) return;
    closeRoiPicker();
    state.roiPickPending = null;
    renderInspector();
    toast('已取消 ROI 选择', 2600);
  }

  function confirmRoiSelection() {
    const picker = state.roiPicker;
    if (!picker || !picker.selection || picker.selection.width < 2 || picker.selection.height < 2) {
      toast('请先框选一个有效区域', 2600);
      return;
    }
    const selected = picker.selection;
    const referenceWidth = picker.referenceResolution[0];
    const referenceHeight = picker.referenceResolution[1];
    const roi = [
      Math.round(selected.x * referenceWidth / picker.width),
      Math.round(selected.y * referenceHeight / picker.height),
      Math.round(selected.width * referenceWidth / picker.width),
      Math.round(selected.height * referenceHeight / picker.height),
    ];
    const message = {
      requestId: picker.requestId,
      stepId: picker.stepId,
      key: picker.key,
      roi,
    };
    closeRoiPicker();
    applyPickedRoi(message);
  }

  function applyPickedRoi(message) {
    if (!state.roiPickPending || message.requestId !== state.roiPickPending) return;
    closeRoiPicker();
    state.roiPickPending = null;
    const roi = message.roi;
    if (!Array.isArray(roi) || roi.length !== 4
      || !roi.every((item) => Number.isInteger(item))
      || roi[0] < 0 || roi[1] < 0 || roi[2] <= 0 || roi[3] <= 0) {
      toast('ROI 选择器返回了无效坐标', 4200);
      return;
    }
    const step = stepsOf().find((item) => item && item.id === message.stepId);
    if (!step) {
      toast('ROI 已选择，但原步骤已不存在', 4200);
      return;
    }
    step.with = step.with && typeof step.with === 'object' && !Array.isArray(step.with) ? step.with : {};
    const current = step.with[message.key];
    const inputRef = isRefValue(current) && /^inputs\.([^\.]+)$/.exec(current.$ref || '');
    let keptReference = false;
    if (inputRef && state.raw && state.raw.inputs_schema && typeof state.raw.inputs_schema === 'object') {
      const schema = state.raw.inputs_schema;
      const properties = schema.properties;
      const inputName = inputRef[1];
      const inputSchema = properties && typeof properties === 'object' && !Array.isArray(properties)
        ? properties[inputName]
        : null;
      if (inputSchema && typeof inputSchema === 'object' && !Array.isArray(inputSchema)) {
        inputSchema.default = roi.slice();
        keptReference = true;
      }
    }
    if (!keptReference) {
      step.with[message.key] = roi.slice();
      delete state.paramModes[`${step.id || ''}:${message.key}`];
    }
    markDirty();
    renderAll();
    renderInspector();
    toast(keptReference ? '已更新输入参数的 ROI 默认值' : '已写入 ROI 坐标：[' + roi.join(', ') + ']', 4200);
  }

  function paramControl(key, pSchema, step) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const spec = state.catalog.find((a) => a.name === step.action);
    const requiredKeys = new Set((spec && spec.inputSchema && spec.inputSchema.required) || []);
    const isRequired = requiredKeys.has(key);
    const label = document.createElement('label');
    label.innerHTML = escapeHtml(parameterLabel(key)) + (isRequired ? ' <span class="req">*</span>' : '');
    wrap.appendChild(label);

    const cur = step.with && typeof step.with === 'object' && step.with[key] !== undefined ? step.with[key] : undefined;
    const isRef = isRefValue(cur);
    const modeKey = `${step.id || ''}:${key}`;
    const mode = state.paramModes[modeKey] || (isRef ? 'ref' : 'literal');
    const controlRow = document.createElement('div');
    controlRow.className = 'param-control-row';
    if (mode === 'ref') {
      const ref = refSelect(isRef ? cur.$ref : '', (value) => {
        if (!value) return;
        step.with = step.with || {};
        step.with[key] = { $ref: value };
        markDirty();
        renderInspector();
      });
      controlRow.appendChild(ref);
    } else {
      controlRow.appendChild(buildLiteralEditor(key, pSchema, step, cur));
    }

    const canPickRoi = key === 'roi' && schemaType(pSchema) === 'array'
      && Number(pSchema.minItems) === 4 && Number(pSchema.maxItems) === 4;
    if (canPickRoi) {
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'param-icon-button roi-pick-button';
      pickBtn.textContent = '▣';
      pickBtn.title = '从 MuMu 截图框选 ROI';
      pickBtn.setAttribute('aria-label', pickBtn.title);
      pickBtn.disabled = !!state.roiPickPending;
      pickBtn.addEventListener('click', () => requestRoiPicker(step.id, key));
      controlRow.appendChild(pickBtn);
    }

    const refBtn = document.createElement('button');
    refBtn.type = 'button';
    refBtn.className = 'param-icon-button';
    refBtn.textContent = mode === 'ref' ? '⌨' : '🔗';
    refBtn.title = mode === 'ref' ? '改为直接填写' : '引用已有值';
    refBtn.setAttribute('aria-label', refBtn.title);
    refBtn.disabled = mode !== 'ref' && refChoices().length === 0;
    refBtn.addEventListener('click', () => {
      if (mode === 'ref') {
        delete state.paramModes[modeKey];
        if (isRef && step.with) delete step.with[key];
      } else {
        state.paramModes[modeKey] = 'ref';
      }
      markDirty();
      renderInspector();
    });
    controlRow.appendChild(refBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'param-icon-button clear-param';
    clearBtn.textContent = '×';
    clearBtn.title = '清除参数';
    clearBtn.setAttribute('aria-label', '清除参数');
    clearBtn.disabled = cur === undefined;
    clearBtn.addEventListener('click', () => {
      if (step.with) delete step.with[key];
      delete state.paramModes[modeKey];
      markDirty();
      renderInspector();
    });
    controlRow.appendChild(clearBtn);
    wrap.appendChild(controlRow);

    if (pSchema && typeof pSchema.description === 'string') {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = pSchema.description;
      wrap.appendChild(hint);
    }
    return wrap;
  }

  function selectNode(id) {
    selectOnly(id);
  }

  function selectedStep() {
    if (!state.raw || !Array.isArray(state.raw.steps)) return null;
    if (state.selectedIds.size !== 1) return null;
    const id = [...state.selectedIds][0];
    return state.raw.steps.find((s) => s && s.id === id) || null;
  }

  function renderInspector() {
    const body = $('inspector-body');
    const empty = $('inspector-empty');
    const step = selectedStep();
    if (!step) {
      body.classList.add('hidden');
      empty.classList.remove('hidden');
      empty.textContent = state.selectedIds.size > 1
        ? `已选择 ${state.selectedIds.size} 个节点：拖动同移 · Delete 删除`
        : '点击左侧节点查看/编辑；或点击「＋ 新增步骤」。';
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
    actionSel.className = 'action-select';
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
      cleanupDeletedStepReferences(new Set([step.id]));
      if (state.raw.entry === step.id) {
        state.raw.entry = stepsOf()[0] ? stepsOf()[0].id : '';
      }
      state.selectedIds = new Set();
      state.selectedId = null;
      state.selectedEdge = null;
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
    // 卡片位置布局写入原脚本（_layout 元数据字段，引擎已允许下划线前缀字段）
    if (Object.keys(state.nodePos).length > 0) {
      out._layout = state.nodePos;
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
    window.addEventListener('mousemove', (e) => moveRoiSelection(e));
    window.addEventListener('mouseup', (e) => endRoiSelection(e));
    window.addEventListener('blur', () => cancelDrag());
    window.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape' && lightboxOpen()) {
        closeLightbox();
        return;
      }
      if (e.key === 'Escape' && state.roiPicker) {
        cancelRoiPicker();
        return;
      }
      if (e.key === 'Escape') {
        removeConnectMenu();
        state.selectedEdge = null;
        state.selectedIds = new Set();
        state.selectedId = null;
        state.drag = null;
        state.connectHoverId = null;
        renderAll();
        renderInspector();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedEdge) {
          const edge = state.selectedEdge;
          state.selectedEdge = null;
          removeTransition(edge.from, edge.kind);
          renderAll();
          toast('已删除连线');
        } else if (state.selectedIds.size > 0) {
          deleteSelectedSteps();
        }
      } else if (e.key === 'f' || e.key === 'F') {
        fitView(state.selectedIds.size ? [...state.selectedIds] : null);
      } else if (e.key === 'Home') {
        fitView(null);
      }
    });
    // 屏蔽原生右键菜单（右键平移 / 右键单击弹出添加节点面板由上面处理）
    svg.addEventListener('contextmenu', (e) => e.preventDefault());

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
