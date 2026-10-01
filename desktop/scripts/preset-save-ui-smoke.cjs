// Uses the production canvas and its unchanged CSP, with an isolated preset library.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', 'preset-save-smoke');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData', path.join(artifacts, 'user-data'));
let win;
app.whenReady().then(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const rendererRoot = path.join(root, 'dist', 'renderer');
  win = new BrowserWindow({ show: false, width: 1250, height: 880, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  await win.loadFile(path.join(rendererRoot, 'canvas.html'));
  const { emitRuntimeDocument } = require('../dist-electron/shared/workflow/graph-dsl.js');
  const { loadActionCatalog } = require('../dist-electron/main/core/catalog.js');
  const { ProjectEditingLibrary } = require('../dist-electron/main/core/editingLibrary.js');
  const libraryRoot = await fs.mkdtemp(path.join(artifacts, 'library-'));
  const service = new ProjectEditingLibrary(libraryRoot);
  const sourceParams = { template: 'assets/templates/wait_floor_from_map_1-template.png', present: true, allow_timeout: true, timeout_seconds: 300, roi: [1669, 832, 251, 248], threshold: .8 };
  const raw = { schema_version: 4, id: 'preset-smoke', version: '1', resolution: [1920, 1080], root: 'source', inputs: {}, variables: {}, nodes: [
    { id: 'source', type: 'task', action: 'vision.wait_template', params: sourceParams },
    { id: 'target', type: 'task', action: 'vision.wait_template', params: { template: 'assets/templates/target.png', timeout_seconds: 10 } },
  ] };
  const init = { type: 'init', document: { uri: 'isolated.owf', name: '预设保存验证', text: emitRuntimeDocument(raw) }, catalog: loadActionCatalog(path.dirname(root)).all(), refs: {}, issues: [], workflows: [], instances: [], selectedInstance: '' };
  const send = payload => win.webContents.executeJavaScript(`window.postMessage({ source: 'desktop-shell', payload: ${JSON.stringify(payload)} }, '*')`);
  await win.webContents.executeJavaScript(`
    window.__presetPosts = []; window.__presetErrors = [];
    window.addEventListener('message', e => { if (e.data?.source === 'legacy-editor') window.__presetPosts.push(e.data.message); });
    window.addEventListener('error', e => window.__presetErrors.push(e.error?.stack || e.message));
    window.confirm = () => true;
    void 0;
  `);
  await send(init);
  await new Promise(resolve => setTimeout(resolve, 100));
  await win.webContents.executeJavaScript(`
    window.__btEditor.state.selected = new Set([window.__btEditor.state.raw.nodes[0].id]);
    window.postMessage({ source: 'desktop-shell', payload: { type: 'editorCommand', command: 'savePreset' } }, '*');
  `);
  await new Promise(resolve => setTimeout(resolve, 50));
  const opened = await win.webContents.executeJavaScript(`({ ready: !!document.querySelector('[aria-label="预设名称"]'), errors: window.__presetErrors, toast: document.getElementById('toast').textContent, selected: [...window.__btEditor.state.selected], nodes: window.__btEditor.state.raw.nodes })`);
  assert.ok(opened.ready, JSON.stringify(opened));
  await win.webContents.executeJavaScript(`
    document.querySelector('[aria-label="预设名称"]').value = '11';
    [...document.querySelectorAll('.editing-dialog button')].find(b => b.textContent === '保存预设').click();
  `);
  await new Promise(resolve => setTimeout(resolve, 100));
  const result = await win.webContents.executeJavaScript(`({ posts: window.__presetPosts, errors: window.__presetErrors, dialogOpen: !!document.querySelector('.editing-dialog') })`);
  const save = result.posts.find(message => message.type === 'updateEditingLibrary');
  assert.ok(save, JSON.stringify(result));
  assert.deepEqual(save.change.preset.params, sourceParams);
  const library = await service.update(save.change);
  assert.deepEqual(await new ProjectEditingLibrary(libraryRoot).list(), library);
  await send({ type: 'editingLibrary', library });
  await win.webContents.executeJavaScript(`
    window.__btEditor.state.selected = new Set([window.__btEditor.state.raw.nodes[1].id]);
    window.postMessage({ source: 'desktop-shell', payload: { type: 'editorCommand', command: 'openPresets' } }, '*');
  `);
  await new Promise(resolve => setTimeout(resolve, 50));
  const applied = await win.webContents.executeJavaScript(`
    (() => {
      const apply = [...document.querySelectorAll('.editing-dialog button')].find(b => b.textContent === '套用');
      if (!apply || apply.disabled) throw new Error('套用按钮不可用');
      apply.click();
      return { params: window.__btEditor.state.raw.nodes[1].params, errors: window.__presetErrors };
    })()
  `);
  assert.deepEqual(applied.params, sourceParams);
  assert.deepEqual(applied.errors, []);
  console.log(JSON.stringify({ productionCsp: true, save: true, persisted: true, apply: true }));
  win.destroy(); app.quit();
}).catch(error => {
  console.error(error);
  win?.destroy(); app.exit(1);
});
