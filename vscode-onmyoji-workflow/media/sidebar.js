(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);
  const state = {
    variables: [],
    selectedVariable: '',
    nodes: [],
    root: '',
    selectedNode: '',
    openNodes: new Set(),
    structureQuery: '',
    variableQuery: '',
    initialized: false,
  };

  function setSidebarTab(name) {
    for (const tab of document.querySelectorAll('[data-sidebar-tab]')) {
      const active = tab.dataset.sidebarTab === name;
      tab.className = `dock-tab${active ? ' active' : ''}`;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    byId('structure-panel').className = `dock-content${name === 'structure' ? '' : ' hidden'}`;
    byId('controls-panel').className = `dock-content${name === 'controls' ? '' : ' hidden'}`;
  }

  function empty(parent, text) {
    const item = document.createElement('div');
    item.className = 'pane-empty';
    item.textContent = text;
    parent.appendChild(item);
  }

  function renderVariables() {
    const list = byId('variable-list');
    list.innerHTML = '';
    const query = state.variableQuery.trim().toLocaleLowerCase();
    const variables = state.variables.filter((variable) => !query
      || variable.name.toLocaleLowerCase().includes(query)
      || String(variable.type || '').toLocaleLowerCase().includes(query));
    if (!state.variables.length) {
      empty(list, '打开工作流后显示变量');
      return;
    }
    if (!variables.length) {
      empty(list, '没有匹配的变量');
      return;
    }
    for (const variable of variables) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `sidebar-variable${variable.name === state.selectedVariable ? ' selected' : ''}`;
      item.dataset.variable = variable.name;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', variable.name === state.selectedVariable ? 'true' : 'false');
      const dot = document.createElement('span');
      dot.className = `variable-type-dot type-${variable.type || 'any'}`;
      const name = document.createElement('span');
      name.className = 'sidebar-variable-name';
      name.textContent = variable.name;
      name.title = variable.name;
      const type = document.createElement('span');
      type.className = 'sidebar-variable-type';
      type.textContent = variable.type || 'any';
      const scope = document.createElement('span');
      scope.className = `sidebar-variable-scope${variable.public ? ' public' : ''}`;
      scope.textContent = variable.public ? '公开' : '私有';
      item.appendChild(dot);
      item.appendChild(name);
      item.appendChild(type);
      item.appendChild(scope);
      item.addEventListener('click', () => vscode.postMessage({ type: 'editorCommand', command: 'selectVariable', value: variable.name }));
      list.appendChild(item);
    }
  }

  function renderStructure() {
    const tree = byId('structure-tree');
    tree.innerHTML = '';
    if (!state.nodes.length) {
      empty(tree, '打开工作流后显示结构');
      return;
    }
    const byNodeId = new Map(state.nodes.map((node) => [node.id, node]));
    const childIds = new Set(state.nodes.flatMap((node) => node.children || []));
    const roots = [];
    const preferredRoot = byNodeId.get(state.root);
    if (preferredRoot) roots.push(preferredRoot);
    for (const node of state.nodes) {
      if (!childIds.has(node.id) && !roots.some((item) => item.id === node.id)) roots.push(node);
    }
    if (!roots.length) roots.push(state.nodes[0]);

    const query = state.structureQuery.trim().toLocaleLowerCase();
    const matches = (node, path = new Set()) => {
      if (!node || path.has(node.id)) return false;
      const text = `${node.name} ${node.id} ${node.meta || ''}`.toLocaleLowerCase();
      if (!query || text.includes(query)) return true;
      const nested = new Set(path); nested.add(node.id);
      return (node.children || []).some((id) => matches(byNodeId.get(id), nested));
    };
    const rendered = new Set();
    const appendNode = (parent, node, path = new Set()) => {
      if (!node || path.has(node.id) || !matches(node)) return;
      rendered.add(node.id);
      const childNodes = (node.children || []).map((id) => byNodeId.get(id)).filter(Boolean);
      const branch = childNodes.length > 0;
      const open = query ? true : state.openNodes.has(node.id);
      const li = document.createElement('li');
      li.className = `structure-node type-${node.type || 'task'}${branch ? ' branch' : ''}${branch && open ? ' open' : ''}`;
      li.dataset.nodeId = node.id;
      const row = document.createElement('div');
      row.className = `structure-row${node.id === state.selectedNode ? ' selected' : ''}`;
      row.dataset.nodeId = node.id;
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', node.id === state.selectedNode ? 'true' : 'false');

      const caret = document.createElement('span');
      caret.className = `tree-caret${branch ? ' clickable' : ''}`;
      if (branch) {
        const glyph = document.createElement('span');
        glyph.className = 'tree-caret-glyph';
        glyph.textContent = '›';
        caret.appendChild(glyph);
        caret.addEventListener('click', (event) => {
          event.stopPropagation();
          if (state.openNodes.has(node.id)) state.openNodes.delete(node.id); else state.openNodes.add(node.id);
          renderStructure();
        });
      }
      const icon = document.createElement('span');
      icon.className = 'node-type-icon';
      const name = document.createElement('span');
      name.className = 'structure-name';
      name.textContent = node.name || node.id;
      name.title = node.name && node.name !== node.id ? `${node.name} (${node.id})` : node.id;
      const meta = document.createElement('span');
      meta.className = 'structure-meta';
      meta.textContent = node.meta || '';
      meta.title = node.meta || '';
      row.appendChild(caret);
      row.appendChild(icon);
      row.appendChild(name);
      row.appendChild(meta);
      row.addEventListener('click', () => vscode.postMessage({ type: 'editorCommand', command: 'focusNode', value: node.id }));
      li.appendChild(row);
      if (branch) {
        const children = document.createElement('ul');
        children.className = 'structure-children';
        const nested = new Set(path); nested.add(node.id);
        childNodes.forEach((child) => appendNode(children, child, nested));
        li.appendChild(children);
      }
      parent.appendChild(li);
    };

    const list = document.createElement('ul');
    list.className = 'structure-list';
    roots.forEach((node) => appendNode(list, node));
    state.nodes.filter((node) => !rendered.has(node.id)).forEach((node) => appendNode(list, node));
    if (!list.children.length) empty(tree, '没有匹配的节点');
    else tree.appendChild(list);
  }

  function setAllOpen(open) {
    state.openNodes.clear();
    if (open) for (const node of state.nodes) if (node.children && node.children.length) state.openNodes.add(node.id);
    renderStructure();
  }

  function revealSelectedNode() {
    if (!state.selectedNode) return;
    const parents = new Map();
    for (const node of state.nodes) for (const child of node.children || []) parents.set(child, node.id);
    let current = parents.get(state.selectedNode);
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      state.openNodes.add(current);
      current = parents.get(current);
    }
  }

  function acceptEditorState(message) {
    state.variables = Array.isArray(message.variables)
      ? message.variables.filter((item) => item && typeof item.name === 'string')
      : [];
    state.selectedVariable = String(message.selectedVariable || '');
    state.nodes = Array.isArray(message.nodes)
      ? message.nodes.filter((item) => item && typeof item.id === 'string')
      : [];
    state.root = String(message.root || '');
    state.selectedNode = String(message.selectedNode || '');
    if (!state.initialized) {
      for (const node of state.nodes) if (node.children && node.children.length) state.openNodes.add(node.id);
      state.initialized = true;
    } else {
      const valid = new Set(state.nodes.map((node) => node.id));
      state.openNodes = new Set([...state.openNodes].filter((id) => valid.has(id)));
    }
    revealSelectedNode();
    renderStructure();
    renderVariables();
  }

  byId('stop').addEventListener('click', () => vscode.postMessage({ type: 'stopWorkflow' }));
  byId('open-editor').addEventListener('click', () => vscode.postMessage({ type: 'openWorkflowEditor' }));
  byId('open-log').addEventListener('click', () => vscode.postMessage({ type: 'openRunLog' }));
  byId('open-tree').addEventListener('click', () => vscode.postMessage({ type: 'openWorkflowTree' }));
  byId('open-refs').addEventListener('click', () => vscode.postMessage({ type: 'openWorkflowReferences' }));
  byId('validate').addEventListener('click', () => vscode.postMessage({ type: 'runEngineValidate' }));
  byId('add-variable').addEventListener('click', () => vscode.postMessage({ type: 'editorCommand', command: 'addVariable' }));
  byId('collapse-tree').addEventListener('click', () => setAllOpen(false));
  byId('expand-tree').addEventListener('click', () => setAllOpen(true));
  for (const tab of document.querySelectorAll('[data-sidebar-tab]')) {
    tab.addEventListener('click', () => setSidebarTab(tab.dataset.sidebarTab));
  }
  for (const button of document.querySelectorAll('[data-editor-command]')) {
    button.addEventListener('click', () => vscode.postMessage({ type: 'editorCommand', command: button.dataset.editorCommand }));
  }
  const findNode = () => vscode.postMessage({ type: 'editorCommand', command: 'searchNodeByName', value: byId('node-search').value });
  byId('find-node').addEventListener('click', findNode);
  byId('node-search').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    findNode();
  });
  byId('structure-search').addEventListener('input', () => {
    state.structureQuery = byId('structure-search').value;
    renderStructure();
  });
  byId('variable-search').addEventListener('input', () => {
    state.variableQuery = byId('variable-search').value;
    renderVariables();
  });

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type === 'state') {
      const runState = String(message.state || 'idle');
      const status = byId('run-status');
      status.className = `status ${runState}`;
      byId('status-text').textContent = String(message.detail || '就绪');
      const busy = runState === 'running' || runState === 'stopping';
      byId('stop').disabled = !busy;
    } else if (message.type === 'editorState') {
      acceptEditorState(message);
    }
  });

  setSidebarTab('structure');
  vscode.postMessage({ type: 'ready' });
})();
