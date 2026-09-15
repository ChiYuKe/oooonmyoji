const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('workflow documents are real Dockview panels with per-document canvases', () => {
  const docking = read('src/renderer/docking.ts');
  const shell = read('src/renderer/main.ts');
const workspace = read('src/renderer/workspace.ts');
  const styles = read('src/renderer/styles.css');
  const html = read('src/renderer/index.html');

  // 每个工作流文档一个 Dockview 面板，面板自带独立画布 iframe。
  assert.match(docking, /interface DocumentPanelHooks/);
  assert.match(docking, /class WorkflowCanvasRenderer implements IContentRenderer/);
  assert.match(docking, /class WorkflowDocumentTab implements ITabRenderer/);
  assert.match(docking, /const DOCUMENT_COMPONENT = 'workflow-canvas'/);
  assert.match(docking, /const DOCUMENT_TAB_COMPONENT = 'workflow-document-tab'/);
  assert.match(docking, /createComponent: \(\{ name \}\) => name === DOCUMENT_COMPONENT/);
  assert.match(docking, /createTabComponent: \(\{ name \}\) => name === DOCUMENT_TAB_COMPONENT/);
  assert.match(docking, /frame\.src = '\.\/legacy\/editor-frame\.html\?mode=canvas'/);
  assert.match(docking, /onFrameCreated\(this\.panelId, this\.uri, this\.frame\)/);
  assert.match(docking, /openDocument\(uri: string, title: string\): void/);
  assert.match(docking, /closeDocument\(uri: string\): void/);
  assert.match(docking, /onDidRemoveDocument\(listener: \(uri: string\) => void\)/);
  assert.match(docking, /export function documentUriForPanelId/);
  assert.match(docking, /reference === 'editor'\)\s*return documentPanels\(\)\[0\]/);

  // 壳层按面板登记运行时并按 iframe 路由消息，不再共享单一画布。
  assert.match(workspace, /const documentRuntimes = new Map<string, DocumentRuntime>\(\)/);
  assert.match(workspace, /function registerDocumentFrame\(panelId: string, uri: string, frame: HTMLIFrameElement\): void/);
  assert.match(workspace, /function unregisterDocumentFrame\(panelId: string\): void/);
  assert.match(workspace, /function runtimeForFrame\(frame: HTMLIFrameElement\)/);
  assert.match(shell, /function syncDocumentTabs\(\): void/);
  assert.match(shell, /function ensureDocument\(uri: string\): WorkflowDocumentTab/);
  assert.match(shell, /function applyDocumentState\(uri: string, tab: WorkflowDocumentTab, runtime: DocumentRuntime\): void/);
  assert.match(shell, /async function handleDocumentRemoved\(uri: string\): Promise<void>/);
  assert.match(shell, /docking\.onDidRemoveDocument\(\(uri\) => void handleDocumentRemoved\(uri\)\)/);
  assert.match(shell, /docking\.dockviewApi\.onDidActivePanelChange/);
  assert.match(shell, /documentUriForPanelId\(event\.panel\.api\.id\)/);
  assert.match(shell, /onFrameCreated: \(panelId, uri, frame\) => workspace\.registerDocumentFrame\(panelId, uri, frame\)/);
  assert.match(shell, /onCloseRequested: \(uri\) => void closeWorkflowTab\(uri\)/);
  assert.match(shell, /function reconcileDocumentPanels\(\): void/);
  assert.match(shell, /async function closeWorkflowTab\(uri: string\): Promise<void>/);

  // 旧的自定义标签宿主与静态画布已移除。
  assert.doesNotMatch(shell, /workflowTabHost/);
  assert.doesNotMatch(shell, /renderWorkflowDocumentTabs/);
  assert.doesNotMatch(docking, /workflowTabHost/);
  assert.doesNotMatch(html, /id="editor-frame"/);

  // 标签视觉：文字省略、未保存圆点、关闭按钮，以及工作流拖放落点提示。
  assert.match(styles, /\.workflow-document-tab\s*\{[\s\S]*?min-width: 0;/);
  assert.match(styles, /\.workflow-document-tab-dirty\s*\{/);
  assert.match(styles, /\.workflow-document-tab-close\s*\{/);
  assert.match(styles, /#dock-workspace\.workflow-drop-active/);
});
