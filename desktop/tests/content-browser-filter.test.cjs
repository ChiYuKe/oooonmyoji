const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {contentBrowserRecursiveItems, isUnderContentFolder, nextContentBrowserZoom, CONTENT_BROWSER_ZOOM_MIN, CONTENT_BROWSER_ZOOM_MAX} = require('../dist-test-renderer/renderer/content-browser/items.js');

/** 复现内容浏览器的递归类型过滤：类型列在“最上层”也会收集深层资产。 */
function harness(folder) {
  const sources = {
    folder,
    contentName: (value) => String(value).split('/').pop(),
    contentFolders: () => ['', 'assets', 'assets/templates', 'assets/templates/realm', 'workflows'],
    workflowItems: () => [{kind: 'workflow', path: 'workflows/a.json', name: 'a.json'}],
    assetItems: () => [
      {kind: 'asset', path: 'assets/templates/x.png', name: 'x.png'},
      {kind: 'asset', path: 'assets/other.png', name: 'other.png'},
    ],
  };
  return {
    recursive: (kind) => contentBrowserRecursiveItems(sources, kind),
    isUnderContentFolder,
  };
}

test('类型过滤按目录递归收集，根目录能覆盖深层资产', () => {
  const atRoot = harness('');
  assert.deepEqual(Array.from(atRoot.recursive('asset'), (item) => item.path), ['assets/templates/x.png', 'assets/other.png']);
  assert.deepEqual(Array.from(atRoot.recursive('folder'), (item) => item.path), ['assets', 'assets/templates', 'assets/templates/realm', 'workflows']);
  assert.deepEqual(Array.from(atRoot.recursive('workflow'), (item) => item.path), ['workflows/a.json']);

  const inTemplates = harness('assets/templates');
  assert.deepEqual(Array.from(inTemplates.recursive('asset'), (item) => item.path), ['assets/templates/x.png']);
  assert.deepEqual(Array.from(inTemplates.recursive('folder'), (item) => item.path), ['assets/templates/realm']);
});

test('目录归属按完整路径段判断，避免前缀误伤', () => {
  const ctx = harness('');
  assert.equal(ctx.isUnderContentFolder('assets/templates/x.png', 'assets'), true);
  assert.equal(ctx.isUnderContentFolder('assets', 'assets'), true);
  assert.equal(ctx.isUnderContentFolder('assetsX/x.png', 'assets'), false);
  assert.equal(ctx.isUnderContentFolder('anything/at/all', ''), true);
});

test('内容区 Ctrl + 滚轮缩放条目尺寸', () => {
  // 向上滚放大、向下滚缩小；缩放是乘法步进，所以一下一上回到原值。
  const bigger = nextContentBrowserZoom(1, -100);
  const smaller = nextContentBrowserZoom(1, 100);
  assert(bigger > 1 && smaller < 1);
  assert.equal(nextContentBrowserZoom(bigger, 100), 1);
  // 行/页模式的位移先归一到像素，量级接近像素模式。
  assert(nextContentBrowserZoom(1, -3, 1) > 1.02, 'deltaMode=1 也要能放大');
  assert(nextContentBrowserZoom(1, 1, 2) < 1, 'deltaMode=2 也要能缩小');
  // 夹在上下限内，并且只保留两位小数（持久化不出现浮点噪声）。
  assert.equal(nextContentBrowserZoom(1e6, -100), CONTENT_BROWSER_ZOOM_MAX);
  assert.equal(nextContentBrowserZoom(1e-6, 100), CONTENT_BROWSER_ZOOM_MIN);
  assert.equal(nextContentBrowserZoom(0, 0), 1, '非法/零值按 1 处理');
  for (const step of [-200, -40, 40, 200]) {
    const value = nextContentBrowserZoom(1.13, step);
    assert.equal(Number(value.toFixed(2)), value, '缩放值保留两位小数');
    assert(value >= CONTENT_BROWSER_ZOOM_MIN && value <= CONTENT_BROWSER_ZOOM_MAX);
  }

  // 尺寸必须由 --cb-zoom 派生（否则改了变量也不缩放），滚轮必须 Ctrl 门控并持久化。
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/styles.css'), 'utf8');
  assert.match(styles, /\.content-browser-items\.grid \{[^}]*minmax\(calc\(112px \* var\(--cb-zoom\)\)/, '网格列宽要跟随 --cb-zoom');
  assert.match(styles, /\.content-item-preview \{[^}]*height: calc\(72px \* var\(--cb-zoom\)\)/, '预览区高度要跟随 --cb-zoom');
  assert.match(styles, /\.content-browser-items \{[^}]*--cb-zoom: 1/, '默认缩放大小的声明在条目容器上');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/content-browser.ts'), 'utf8');
  assert.match(source, /addEventListener\('wheel',[\s\S]{0,200}?ctrlKey/, '内容区要监听 Ctrl + 滚轮');
  assert.match(source, /event\.preventDefault\(\)/, 'Ctrl + 滚轮要吃掉默认缩放');
  assert.match(source, /onmyoji-studio\.content-browser\.zoom/, '缩放值要持久化');
});
