(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);

  byId('run-party').addEventListener('click', () => {
    vscode.postMessage({ type: 'runPartySouls', rounds: Number(byId('rounds').value) });
  });
  byId('stop').addEventListener('click', () => vscode.postMessage({ type: 'stopWorkflow' }));
  byId('open-editor').addEventListener('click', () => vscode.postMessage({ type: 'openWorkflowEditor' }));
  byId('open-log').addEventListener('click', () => vscode.postMessage({ type: 'openRunLog' }));
  byId('open-refs').addEventListener('click', () => vscode.postMessage({ type: 'openWorkflowReferences' }));
  byId('validate').addEventListener('click', () => vscode.postMessage({ type: 'runEngineValidate' }));
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

  window.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.type !== 'state') return;
    const state = String(message.state || 'idle');
    const status = byId('run-status');
    status.className = `status ${state}`;
    byId('status-text').textContent = String(message.detail || '就绪');
    byId('rounds').value = String(message.rounds === 1 ? 1 : 9999);
    const busy = state === 'running' || state === 'stopping';
    byId('run-party').disabled = busy;
    byId('rounds').disabled = busy;
    byId('stop').disabled = !busy;
  });

  vscode.postMessage({ type: 'ready' });
})();
