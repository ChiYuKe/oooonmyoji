(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const TYPE_ICON = { root: '◆', selector: '?', sequence: '→', simple_parallel: '∥', task: '▣' };
  const state = { workflows: [], currentUri: '', currentName: '', nodes: [], open: new Set() };

  const $ = (id) => document.getElementById(id);

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
    caret.textContent = children.length > 0 ? (open ? '▾' : '▸') : '';
    if (children.length > 0) {
      caret.addEventListener('click', (event) => {
        event.stopPropagation();
        if (state.open.has(node.id)) state.open.delete(node.id); else state.open.add(node.id);
        renderTree();
      });
    }
    row.appendChild(caret);
    const icon = document.createElement('span');
    icon.className = `tree-icon type-${node.type}`;
    icon.textContent = TYPE_ICON[node.type] || '•';
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