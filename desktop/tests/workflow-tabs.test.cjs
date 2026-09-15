const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('workflow canvas exposes a document tab host and dedicated drop payload', () => {
  const docking = read('src/renderer/docking.ts');
  const shell = read('src/renderer/main.ts');
  const styles = read('src/renderer/styles.css');

  assert.match(docking, /workflowTabHost: HTMLElement/);
  assert.match(docking, /workflowTabDropTarget: HTMLElement/);
  assert.match(docking, /const workflowTabDropTarget = container;/);
  assert.match(docking, /workflow-document-tabs/);
  const innerDockview = docking.indexOf("document.querySelector<HTMLElement>('#dock-workspace')");
  const tabHost = docking.indexOf("workflowTabHost.id = 'workflow-document-tabs'");
  const outerWorkbench = docking.indexOf('export function createWorkbenchFrame');
  assert.ok(innerDockview >= 0 && tabHost > innerDockview, 'tab host must be created in the inner canvas Dockview');
  assert.equal(docking.slice(outerWorkbench).includes("workflowTabHost.id = 'workflow-document-tabs'"), false, 'outer workbench must not own document tabs');
  assert.match(docking, /groupContainsEditor\(params\.group\)/);
  assert.match(docking, /nativeTabs\.appendChild\(this\.workflowTabHost\)/);
  const headerUpdate = docking.indexOf('const update = (): void => {', docking.indexOf('class PopoutHeaderAction'));
  const editorGroupCheck = docking.indexOf('groupContainsEditor(params.group)', headerUpdate);
  assert.ok(headerUpdate >= 0 && editorGroupCheck > headerUpdate, 'editor ownership must be checked after Dockview populates the group');
  assert.match(shell, /workflowTabDropTarget/);
  assert.match(shell, /bindWorkflowTabDropTarget\(docking\.workflowTabDropTarget, true\)/);
  assert.match(shell, /closest<HTMLElement>\('\.dv-tabs-and-actions-container'\)/);
  assert.match(shell, /headerOnly \? \{ capture: true \} : undefined/);
  assert.match(shell, /application\/x-onmyoji-workflow/);
  assert.match(shell, /application\/x-onmyoji-content/);
  assert.match(shell, /async function openWorkflowTab\(uri: string\)/);
  assert.match(shell, /async function closeWorkflowTab\(uri: string\)/);
  assert.match(shell, /backStack: string\[\]/);
  assert.match(styles, /\.workflow-document-tab-host\s*\{/);
  assert.match(styles, /\.workflow-editor-tab-header/);
  assert.match(styles, /\.workflow-editor-tab-header \.dv-tabs-container > \.dv-tab\[data-tab-panel-id="editor"\]\s*\{[\s\S]*?display: none;/);
  assert.match(styles, /\.workflow-document-tab-host\s*\{[\s\S]*?pointer-events: auto;/);
  assert.match(shell, /dv-tab workflow-document-tab/);
  assert.match(shell, /dv-default-tab-content workflow-document-tab-label/);
  assert.match(shell, /close\.appendChild\(createCloseButton\(\)\)/);
  assert.match(shell, /tab\.addEventListener\('pointerdown', \(event\) => event\.stopPropagation\(\)\)/);
  assert.match(shell, /tab\.addEventListener\('keydown'/);
  assert.match(styles, /\.workflow-document-tab\s*\{[\s\S]*?min-width: 0;/);
});
