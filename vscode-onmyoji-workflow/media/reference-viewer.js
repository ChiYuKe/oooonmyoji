(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const state = { workflows: [], currentUri: '', currentName: '', outgoing: [], incoming: [], unresolved: [] };

  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  /** 一条引用条目行（outgoing 或 incoming 条目）。 */
  function entryRow(entry) {
    const row = document.createElement('article');
    row.className = 'ref-row';

    const arrow = document.createElement('span');
    arrow.className = 'ref-arrow';
    arrow.textContent = '⇢';
    row.appendChild(arrow);

    const main = document.createElement('div');
    main.className = 'ref-main';
    const title = document.createElement('div');
    title.className = 'ref-title';
    const target = document.createElement('strong');
    target.textContent = entry.name || '（未命名文件）';
    title.appendChild(target);
    const nodeLabel = document.createElement('span');
    nodeLabel.className = 'ref-node';
    nodeLabel.textContent = entry.nodeName ? `${entry.nodeName} (${entry.nodeId})` : entry.nodeId;
    title.appendChild(nodeLabel);
    main.appendChild(title);
    const quote = document.createElement('div');
    quote.className = 'ref-quote';
    quote.textContent = `workflow.run → ${entry.reference}`;
    main.appendChild(quote);
    row.appendChild(main);

    const open = document.createElement('button');
    open.className = 'ref-open';
    open.textContent = '打开';
    open.title = `在编辑器中打开 ${entry.name}`;
    open.addEventListener('click', () => vscode.postMessage({ type: 'openWorkflow', uri: entry.uri }));
    row.appendChild(open);
    return row;
  }

  /** 悬空引用行。 */
  function unresolvedRow(entry) {
    const row = document.createElement('article');
    row.className = 'ref-row unresolved';

    const arrow = document.createElement('span');
    arrow.className = 'ref-arrow';
    arrow.textContent = '?';
    row.appendChild(arrow);

    const main = document.createElement('div');
    main.className = 'ref-main';
    const title = document.createElement('div');
    title.className = 'ref-title';
    const nodeLabel = document.createElement('span');
    nodeLabel.className = 'ref-node';
    nodeLabel.textContent = entry.nodeName ? `${entry.nodeName} (${entry.nodeId})` : entry.nodeId;
    title.appendChild(nodeLabel);
    main.appendChild(title);
    const quote = document.createElement('div');
    quote.className = 'ref-quote';
    quote.textContent = `workflow.run → ${entry.reference}`;
    main.appendChild(quote);
    row.appendChild(main);
    return row;
  }

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

  function renderSummary() {
    const incomingCount = state.incoming.reduce((sum, group) => sum + group.entries.length, 0);
    $('outgoing-count').textContent = String(state.outgoing.length);
    $('incoming-count').textContent = String(incomingCount);
    $('unresolved-count').textContent = String(state.unresolved.length);
  }

  function render() {
    $('workflow-name').textContent = state.currentName ? state.currentName.split('/').pop() : '尚未选择';
    $('workflow-path').textContent = state.currentName || '';
    renderPicker();
    renderSummary();

    const outgoingList = $('outgoing-list');
    outgoingList.innerHTML = '';
    $('outgoing-empty').classList.toggle('hidden', state.outgoing.length > 0);
    for (const entry of state.outgoing) outgoingList.appendChild(entryRow(entry));

    const incomingList = $('incoming-list');
    incomingList.innerHTML = '';
    $('incoming-empty').classList.toggle('hidden', state.incoming.length > 0);
    for (const group of state.incoming) {
      const section = document.createElement('section');
      section.className = 'incoming-group';
      const header = document.createElement('div');
      header.className = 'incoming-header';
      const arrow = document.createElement('span');
      arrow.className = 'ref-arrow';
      arrow.textContent = '⇠';
      header.appendChild(arrow);
      const name = document.createElement('strong');
      name.textContent = group.source.name;
      header.appendChild(name);
      const count = document.createElement('span');
      count.className = 'incoming-count';
      count.textContent = `${group.entries.length} 处引用`;
      header.appendChild(count);
      const open = document.createElement('button');
      open.className = 'ref-open';
      open.textContent = '打开';
      open.addEventListener('click', () => vscode.postMessage({ type: 'openWorkflow', uri: group.source.uri }));
      header.appendChild(open);
      section.appendChild(header);
      for (const entry of group.entries) section.appendChild(entryRow(entry));
      incomingList.appendChild(section);
    }

    const unresolvedBlock = $('unresolved-block');
    const unresolvedList = $('unresolved-list');
    unresolvedList.innerHTML = '';
    unresolvedBlock.classList.toggle('hidden', state.unresolved.length === 0);
    for (const entry of state.unresolved) unresolvedList.appendChild(unresolvedRow(entry));
  }

  $('workflow-select').addEventListener('change', () => {
    const uri = $('workflow-select').value;
    if (!uri || uri === state.currentUri) return;
    vscode.postMessage({ type: 'switchWorkflow', uri });
  });
  $('btn-refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'init') return;
    state.workflows = Array.isArray(data.workflows) ? data.workflows : [];
    state.currentUri = String(data.currentUri || '');
    state.currentName = String(data.currentName || '');
    state.outgoing = Array.isArray(data.outgoing) ? data.outgoing : [];
    state.incoming = Array.isArray(data.incoming) ? data.incoming : [];
    state.unresolved = Array.isArray(data.unresolved) ? data.unresolved : [];
    render();
    window.__refViewer = { state, render, entryRow };
  });

  vscode.postMessage({ type: 'ready' });
}());