// Run via npm test (builds the renderer test output first).
// 资源浏览器已迁到 src/canvas/interactions/asset-browser.ts：直接实例化编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAssetBrowser } = require('../dist-test-renderer/canvas/interactions/asset-browser.js');

function harness() {
  const element = (tag) => ({
    tag, children: [], events: {}, style: { setProperty() {}, cssText: '' }, className: '', textContent: '', dataset: {}, rel: '', href: '',
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    addEventListener(type, fn) { this.events[type] = fn; },
    attachShadow() { return element('shadow'); },
    showModal() { this.open = true; },
    close() { this.open = false; },
    remove() { this.removed = true; },
    querySelector() { return undefined; },
    focus() {},
  });
  const parent = element('body');
  const overlay = element('overlay');
  overlay.parentNode = parent;
  const focus = { isConnected: true, focus() { this.restored = true; } };
  const documentStub = { body: parent, documentElement: {}, activeElement: focus, baseURI: 'http://localhost/renderer/canvas.html', createElement: element };
  const topDocument = { body: element('top-body'), createElement: element };
  globalThis.document = documentStub;
  globalThis.window = { top: { document: topDocument } };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#252525' });
  globalThis.MutationObserver = class { observe() {} disconnect() { this.disconnected = true; } };
  const state = { assetBrowser: {} };
  const browser = createAssetBrowser({
    state,
    $: () => overlay,
    el: (tag, className = '', text = '') => { const node = element(tag); node.className = className; node.textContent = text; return node; },
    mutate: (fn) => fn(),
    nodeById: () => undefined,
    toast: () => {},
    vscode: { postMessage: () => {} },
    requestRoi: () => {},
  });
  return {browser, overlay, parent, focus, topDocument, state};
}

test('picker is mounted in the top window modal, not the inspector viewport', () => {
  const h = harness();
  h.browser.openAssetBrowser('node', 'template', 'assets/templates/a.png');
  assert.equal(h.topDocument.body.children.length, 1);
  const host = h.topDocument.body.children[0];
  assert.equal(host.tag, 'dialog');
  assert.equal(host.open, true);
  assert.equal(h.overlay.parentNode.tag, 'shadow');
  assert.equal(h.browser.assetBrowserOverlay(), h.overlay);
  h.browser.openAssetBrowser('node', 'template', 'assets/templates/a.png');
  assert.equal(h.topDocument.body.children.length, 1);
});

// 弹层样式来自画布文档之外的 `<root>/legacy/asset-browser.css`：
// 少写 legacy/ 段会让顶层弹层静默 404，退化成铺满窗口的无样式布局。
test('picker stylesheet resolves to the legacy folder, never the document root', () => {
  const h = harness();
  h.browser.openAssetBrowser('node', 'template', 'assets/templates/a.png');
  const shadow = h.overlay.parentNode;
  const sheet = shadow.children.find((child) => child.tag === 'link' && child.rel === 'stylesheet');
  assert.ok(sheet, '弹层 shadow root 里应挂一份样式表');
  assert.equal(sheet.href, 'http://localhost/renderer/legacy/asset-browser.css');
  assert.ok(sheet.href.includes('/legacy/'), '缺少 legacy/ 段会解析到文档根而 404');
  assert.ok(!/\/renderer\/asset-browser\.css$/.test(sheet.href));
});

test('closing restores the original overlay and focus, including Escape', () => {
  const h = harness();
  h.browser.openAssetBrowser('node', 'template', 'assets/templates/a.png');
  const host = h.topDocument.body.children[0];
  host.events.keydown({key: 'Escape', preventDefault() {}, stopPropagation() {}});
  assert.equal(host.open, false);
  assert.equal(host.removed, true);
  assert.equal(h.overlay.parentNode, h.parent);
  assert.equal(h.focus.restored, true);
  assert.equal(h.state.assetBrowser, null);
  h.browser.closeAssetBrowser();
});

test('picker styling is independent, centered and theme-aware without bright borders', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/legacy/asset-browser.css'), 'utf8');
  assert.match(css, /place-items: center/); assert.match(css, /width: min\(1040px, 100%\)/);
  assert.match(css, /grid-template-columns: 190px minmax\(0, 1fr\)/);
  assert.match(css, /var\(--ui-selected/); assert.match(css, /border: 0; border-radius: 8px/);
});
