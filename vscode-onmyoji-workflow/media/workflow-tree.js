(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const NS = 'http://www.w3.org/2000/svg';
  const state = { workflows: [], currentUri: '', currentName: '', nodes: [], open: new Set() };

  const $ = (id) => document.getElementById(id);

  function svgEl(tag, attrs, parent) {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    }
    if (parent) parent.appendChild(element);
    return element;
  }

  /** 由形状描述（[tag, attrs] 列表）构建 16×16 的 SVG 图标。 */
  function svgIcon(shape, className, parent) {
    const svg = svgEl('svg', { class: className, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, parent);
    for (const [tag, attrs] of shape) svgEl(tag, attrs, svg);
    return svg;
  }

  /** 节点类型徽章：描边式几何图形，颜色由 CSS 按类型分配。 */
  const SHAPES = {
    root: [['path', { d: 'M8 1.8 L14.2 8 L8 14.2 L1.8 8 Z' }]],
    selector: [['circle', { cx: 8, cy: 8, r: 6.2 }]],
    sequence: [['path', { d: 'M8 1.8 L14.2 13.2 H1.8 Z' }]],
    simple_parallel: [
      ['rect', { x: 4.2, y: 2.4, width: 2.6, height: 11.2, rx: 1.3 }],
      ['rect', { x: 9.2, y: 2.4, width: 2.6, height: 11.2, rx: 1.3 }],
    ],
    task: [['rect', { x: 2.6, y: 2.6, width: 10.8, height: 10.8, rx: 2.2 }]],
  };
  const CARET_ICON = [[
    'path',
    { d: 'M5 3.5 L10.5 8 L5 12.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
  ]];
  const EXPAND_ALL_ICON = [
    ['path', { d: 'M4 3.8 L8 7.8 L12 3.8', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }],
    ['path', { d: 'M4 8.2 L8 12.2 L12 8.2', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }],
  ];
  const COLLAPSE_ALL_ICON = [
    ['path', { d: 'M4 12.2 L8 8.2 L12 12.2', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }],
    ['path', { d: 'M4 7.8 L8 3.8 L12 7.8', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }],
  ];

  function renderPicker() {
    const select = $('workflow-select');
    select.innerHTML = '';
    for (const file of state.workflows) {
      const option = document.createElement('option');
      option.value = file.uri;
      option.textContent = file.rel || file.name;
      if (file.uri === state.currentUri) option.selected = true;
      select.appendChild(option);
    }
  }

  function baseName(value) {
    const text = String(value || '');
    const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
    return slash >= 0 ? text.slice(slash + 1) : text;
  }

  function appendNode(parent, node) {
    const children = node.children || [];
    const li = document.createElement('li');
    li.className = `tree-node type-${node.type}` + (children.length > 0 ? ' branch' : '');
    const open = state.open.has(node.id);
    if (children.length > 0 && open) li.classList.add('open');
    li.dataset.nodeId = node.id;

    const row = document.createElement('div');
    row.className = 'tree-row';
    const caret = document.createElement('span');
    caret.className = 'tree-caret';
    if (children.length > 0) {
      caret.setAttribute('role', 'button');
      caret.setAttribute('aria-label', open ? '收起' : '展开');
      svgIcon(CARET_ICON, 'caret-glyph', caret);
      caret.addEventListener('click', (event) => {
        event.stopPropagation();
        if (state.open.has(node.id)) state.open.delete(node.id); else state.open.add(node.id);
        renderTree();
      });
    }
    row.appendChild(caret);
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    svgIcon(SHAPES[node.type] || SHAPES.task, 'type-glyph', icon);
    row.appendChild(icon);
    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name || node.id;
    name.title = node.name && node.name !== node.id ? `${node.name}（${node.id}）` : node.id;
    row.appendChild(name);
    const meta = document.createElement('span');
    meta.className = 'tree-meta';
    meta.textContent = node.meta || '';
    row.appendChild(meta);
    // 点击节点：在编辑器打开该工作流并定位到此节点。
    row.addEventListener('click', () => {
      vscode.postMessage({ type: 'focusNode', uri: state.currentUri, nodeId: node.id });
    });
    li.appendChild(row);

    if (children.length > 0) {
      const ul = document.createElement('ul');
      ul.className = 'tree-children';
      for (const child of children) appendNode(ul, child);
      li.appendChild(ul);
    }
    parent.appendChild(li);
  }

  function renderTree() {
    const tree = $('tree');
    tree.innerHTML = '';
    $('empty-state').classList.toggle('hidden', state.nodes.length > 0);
    const list = document.createElement('ul');
    list.className = 'bt-tree';
    for (const node of state.nodes) appendNode(list, node);
    tree.appendChild(list);
  }

  function setAllOpen(open) {
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.children && node.children.length > 0) {
          if (open) state.open.add(node.id); else state.open.delete(node.id);
          walk(node.children);
        }
      }
    };
    walk(state.nodes);
    renderTree();
  }

  function render() {
    $('workflow-name').textContent = baseName(state.currentName) || '尚未选择';
    $('workflow-path').textContent = state.currentName || '';
    renderPicker();
    renderTree();
  }

  svgIcon(EXPAND_ALL_ICON, 'btn-glyph', $('btn-expand'));
  svgIcon(COLLAPSE_ALL_ICON, 'btn-glyph', $('btn-collapse'));
  $('workflow-select').addEventListener('change', () => {
    const uri = $('workflow-select').value;
    if (!uri || uri === state.currentUri) return;
    vscode.postMessage({ type: 'switchWorkflow', uri });
  });
  $('btn-refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  $('btn-expand').addEventListener('click', () => setAllOpen(true));
  $('btn-collapse').addEventListener('click', () => setAllOpen(false));

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'init') return;
    state.workflows = Array.isArray(data.workflows) ? data.workflows : [];
    state.currentUri = String(data.currentUri || '');
    state.currentName = String(data.currentName || '');
    state.nodes = Array.isArray(data.nodes) ? data.nodes : [];
    state.open = new Set();
    // 默认全部展开，方便直接看层级。
    const walk = (nodes) => { for (const node of nodes) { if (node.children && node.children.length > 0) { state.open.add(node.id); walk(node.children); } } };
    walk(state.nodes);
    render();
    window.__workflowTree = { state, renderTree, render };
  });

  vscode.postMessage({ type: 'ready' });
}());