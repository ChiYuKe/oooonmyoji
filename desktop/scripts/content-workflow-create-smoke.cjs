// Isolated renderer check: all project operations use in-memory fixtures.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', 'content-workflow-create');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData', path.join(artifacts, 'user-data'));

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(artifacts, {recursive: true});
    const built = path.join(root, 'dist', 'renderer');
    let html = fs.readFileSync(path.join(built, 'index.html'), 'utf8')
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
      .replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, '')
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/g, '')
      .replace(/(href|src)="([^":]+)"/g, (_, attribute, file) => `${attribute}="${pathToFileURL(path.join(built, file.replace(/^\//, '')))}"`);
    const file = path.join(artifacts, 'preview.html');
    fs.writeFileSync(file, html);
    win = new BrowserWindow({show: false, width: 1250, height: 680, webPreferences: {
      nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true,
    }});
    await win.loadFile(file);
    await win.webContents.executeJavaScript(`(async () => {
      const assert = require('node:assert/strict');
      const module = document.querySelector('#module-content-browser');
      const modals = ['#content-name-modal', '#content-rewrite-modal', '#impact-confirm-modal'].map(id => document.querySelector(id));
      document.body.replaceChildren(module, ...modals);
      module.style.cssText = 'display:flex;height:100vh;width:100vw;position:relative';
      const {createContentBrowser} = require(${JSON.stringify(path.join(root, 'dist-test-renderer/renderer/features/content-browser/index.js'))});
      const {createImpactConfirm} = require(${JSON.stringify(path.join(root, 'dist-test-renderer/renderer/ui/impact-confirm.js'))});
      const confirm = createImpactConfirm(...['modal', 'title', 'subtitle', 'body', 'ok', 'cancel', 'close', 'extra']
        .map(id => document.querySelector('#impact-confirm-' + id)));
      window.confirm = window.alert = () => { throw new Error('Native dialogs must not be used'); };
      const delay = () => new Promise(resolve => setTimeout(resolve, 100));
      const data = {projectRoot: 'E:/fixture', workflows: []};
      let createCount = 0;
      let openCount = 0;
      let dirty = true;
      let failDelete = false;
      let failGraph = false;
      const referenceGraphs = new Map();
      const deleted = [];
      const errors = [];
      const api = {
        createWorkflow: async folder => {
          createCount++;
          const name = 'new_workflow' + (createCount === 1 ? '' : '_' + createCount) + '.owf';
          const workflow = {uri: 'file:///E:/fixture/' + folder + '/' + name, name, rel: folder + '/' + name};
          data.workflows.push(workflow);
          return workflow.uri;
        },
        bootstrap: async () => data,
        listAssets: async () => [],
        listContentFolders: async () => ['assets', 'workflows', 'workflows/entrypoints'],
        getReferenceGraph: async value => {
          if (failGraph) throw new Error('引用检查失败');
          return referenceGraphs.get(value) ?? {target: {name: value.split('/').pop(), path: value, kind: 'workflow', exists: true}, references: [], referencedBy: []};
        },
        renameContent: async ({sourcePath, newName}) => {
          const workflow = data.workflows.find(item => item.rel === sourcePath);
          assert.ok(workflow);
          workflow.rel = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1) + newName;
          workflow.name = newName;
          workflow.uri = 'file:///E:/fixture/' + workflow.rel;
          return {sourcePath, targetPath: workflow.rel, rewritten: [], updatedFiles: 0, updatedReferences: 0};
        },
        deleteContent: async value => {
          if (failDelete) throw new Error('内容仍被引用，暂不能删除');
          deleted.push(value);
          data.workflows.splice(data.workflows.findIndex(item => item.rel === value), 1);
        },
      };
      const browser = createContentBrowser({
        api, createIcons: () => {}, desktopIcons: {}, createElement: () => document.createElement('i'),
        showToast: (message, error) => { if (error) errors.push(message); }, errorMessage: String,
        showImpactConfirm: async request => (await confirm.open(request)) === true,
        getBootstrap: () => data, setBootstrap: value => Object.assign(data, value),
        // Existing dirty canvas must stay untouched while the new file is named.
        getCurrentUri: () => 'file:///E:/fixture/workflows/existing.owf', isDirty: () => dirty,
        getWorkflowTabs: () => [{uri: 'file:///E:/fixture/workflows/existing.owf', dirty}],
        getOverview: () => ({reconcileSelection() {}, reconcileConfigurations() {}, render() {}}),
        renderWorkflowSelect() {}, setDeleteTarget() {},
        workflowDescriptorForPath: value => data.workflows.find(item => item.rel === value),
        displayFileUri: value => value.replace('file:///', ''), reloadRewrittenDocuments: async () => [],
        openWorkflowTab: async () => { openCount++; }, openWorkflowInNewTab: () => { openCount++; },
        loadWorkflow: async () => { openCount++; },
      });
      window.fixture = {browser, data, errors, delay, getOpenCount: () => openCount,
        referenceGraphs, setGraphFailure: value => { failGraph = value; },
        confirm, deleted, setDirty: value => { dirty = value; }, setDeleteFailure: value => { failDelete = value; }};
      await Promise.all([browser.createWorkflow(), browser.createWorkflow()]);
      await delay();
      assert.equal(createCount, 1, 'repeated creation while naming must not add more files');
      const input = document.querySelector('.content-item-name-edit');
      assert.ok(input, 'new file must immediately enter inline naming');
      assert.equal(document.activeElement, input, 'name input must receive focus');
      assert.equal(input.selectionStart, 0);
      assert.equal(input.selectionEnd, input.value.length);
      assert.equal(input.value, 'new_workflow.owf');
      assert.equal(browser.isNameDialogOpen(), true);
      assert.equal(openCount, 0, 'creation must not open or reload a canvas');
    })()`);
    fs.writeFileSync(path.join(artifacts, 'naming.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`(async () => {
      const assert = require('node:assert/strict');
      const {browser, data, errors, delay, getOpenCount} = window.fixture;
      let input = document.querySelector('.content-item-name-edit');
      input.value = '活动循环.owf';
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      await delay();
      assert.equal(document.querySelector('.content-item-name-edit'), null);
      assert.equal(data.workflows[0].name, '活动循环.owf');
      assert.equal(getOpenCount(), 0, 'confirming a name must not open a canvas');
      await browser.createWorkflow(); await delay();
      input = document.querySelector('.content-item-name-edit');
      assert.equal(document.activeElement, input, 'second new file must receive focus');
      input.value = '失焦命名.owf';
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new FocusEvent('blur')); await delay();
      assert.equal(data.workflows[1].name, '失焦命名.owf', JSON.stringify({errors, active: document.activeElement?.tagName, naming: browser.isNameDialogOpen()}));
      assert.equal(getOpenCount(), 0);
      await browser.createWorkflow(); await delay();
      input = document.querySelector('.content-item-name-edit');
      input.value = '取消命名.owf';
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); await delay();
      assert.equal(data.workflows[2].name, 'new_workflow_3.owf');
      assert.equal(browser.isNameDialogOpen(), false);
      assert.equal(getOpenCount(), 0);
      document.querySelector('.content-item.workflow').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
      assert.equal(getOpenCount(), 1, 'explicit double-click must still open a workflow');
      assert.deepEqual(errors, []);
      const fixture = window.fixture;
      fixture.setDirty(false);
      const target = browser.resolveDeleteTarget(data.workflows[2].rel);
      const relation = (name, path, kind, exists, label) => ({target: {name, path, kind, exists}, contexts: [{label}]});
      fixture.referenceGraphs.set(target.path, {target: {name: target.name, path: target.path},
        references: [relation('组队按钮.png', 'assets/templates/组队按钮.png', 'asset', true, '等待组队'),
          relation('子流程.owf', 'workflows/子流程.owf', 'workflow', false, '调用子流程')],
        referencedBy: [relation('总流程.owf', 'workflows/总流程.owf', 'workflow', true, '开始循环')],
      });
      fixture.pendingDelete = browser.deleteItem(target);
      await delay();
      assert.equal(fixture.confirm.isOpen(), true);
      assert.equal(document.querySelector('#impact-confirm-title').textContent, '删除内容');
      assert.equal(document.querySelector('#impact-confirm-ok').classList.contains('danger'), true);
      assert.equal(document.querySelector('#impact-confirm-ok').textContent, '删除');
      assert.equal(document.querySelectorAll('#impact-confirm-body > .impact-confirm-list .impact-confirm-item').length, 1);
      assert.equal(document.querySelectorAll('.impact-confirm-section').length, 2);
      assert.ok(document.querySelector('#impact-confirm-body').textContent.includes('引用的内容（2）'));
      assert.ok(document.querySelector('#impact-confirm-body').textContent.includes('被以下内容引用（1）'));
      assert.ok(document.querySelector('#impact-confirm-body').textContent.includes('总流程.owf'));
      assert.ok(document.querySelector('#impact-confirm-body').textContent.includes('文件不存在'));
      assert.ok(document.querySelector('#impact-confirm-body').textContent.includes(target.path));
      assert.equal(fixture.deleted.length, 0, 'deletion must wait for confirmation');
      await browser.deleteItem(target);
      assert.equal(fixture.confirm.isOpen(), true, 'repeated deletion must not replace the pending dialog');
      assert.ok(document.querySelector('.impact-confirm-dialog').getBoundingClientRect().height > 0);
      await delay();
    })()`);
    fs.writeFileSync(path.join(artifacts, 'delete-confirm.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`(async () => {
      const assert = require('node:assert/strict');
      const fixture = window.fixture;
      const {browser, data, deleted, confirm, delay, errors} = fixture;
      document.querySelector('#impact-confirm-cancel').click();
      await fixture.pendingDelete;
      assert.equal(deleted.length, 0);
      assert.equal(data.workflows.length, 3);
      assert.equal(confirm.isOpen(), false);
      fixture.referenceGraphs.clear();
      const cancelByEscape = browser.deleteItem(browser.resolveDeleteTarget(data.workflows[2].rel));
      await delay();
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      await cancelByEscape;
      assert.equal(deleted.length, 0);
      // Select two actual tiles and confirm the resulting batch once.
      const buttons = document.querySelectorAll('.content-item.workflow');
      buttons[0].dispatchEvent(new MouseEvent('click', {bubbles: true}));
      buttons[1].dispatchEvent(new MouseEvent('click', {bubbles: true, ctrlKey: true}));
      const batch = browser.deleteItem(browser.resolveDeleteTarget(buttons[0].dataset.contentPath));
      await delay();
      assert.equal(document.querySelectorAll('.impact-confirm-item').length, 2);
      assert.equal(document.querySelector('#impact-confirm-title').textContent, '删除 2 项内容');
      document.querySelector('#impact-confirm-ok').click();
      await batch;
      assert.equal(deleted.length, 2);
      assert.equal(data.workflows.length, 1);
      fixture.setDeleteFailure(true);
      const failed = browser.deleteItem(browser.resolveDeleteTarget(data.workflows[0].rel));
      await delay();
      document.querySelector('#impact-confirm-ok').click(); await delay();
      assert.equal(confirm.isOpen(), true);
      assert.equal(document.querySelector('#impact-confirm-title').textContent, '删除失败的项目');
      assert.ok(document.querySelector('#impact-confirm-body').textContent.includes('内容仍被引用'));
      assert.equal(document.querySelector('#impact-confirm-ok').classList.contains('danger'), false);
      document.querySelector('#impact-confirm-ok').click(); await failed;
      assert.equal(data.workflows.length, 1);
      assert.equal(deleted.length, 2);
      assert.equal(errors.length, 1);
      assert.ok(errors[0].includes('失败 1 项'));
      fixture.setGraphFailure(true);
      await browser.deleteItem(browser.resolveDeleteTarget(data.workflows[0].rel));
      assert.equal(confirm.isOpen(), false);
      assert.equal(deleted.length, 2, 'failed reference checks must not proceed with deletion');
      assert.equal(errors.length, 2);
      assert.ok(errors[1].includes('引用检查失败'));
    })()`);
    console.log('PASS: inline naming and canvas preservation; custom delete confirmation, cancel/Escape, repeated delete, batch delete and failure details without native dialogs');
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
