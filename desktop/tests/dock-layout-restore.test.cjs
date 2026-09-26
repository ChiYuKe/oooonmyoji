// Run via npm test (builds the desktop output first).
// 停靠布局持久化：读写/清理走编译产物并做行为验证；「恢复时不再无条件补回关闭的面板」
// 是 docking.ts 的装配顺序，没有可实例化的 Dockview DOM 环境，按仓库既有做法做源码级断言。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(base, file), 'utf8');
const {
  LAYOUT_STORAGE_KEY,
  WORKBENCH_LAYOUT_STORAGE_KEY,
  clearPersistedLayout,
  persistLayout,
  readPersistedLayout,
} = require('../dist-test-renderer/renderer/docking/layout.js');

/** 主进程存储 + localStorage 回退的最小桩。 */
function stubWindow() {
  const stored = new Map();
  const local = new Map();
  const writes = [];
  globalThis.window = {
    onmyoji: {
      readLayout: (key) => stored.get(key) ?? null,
      writeLayout: (key, value) => {
        writes.push([key, value]);
        if (value === null) stored.delete(key);
        else stored.set(key, value);
      },
    },
    localStorage: {
      getItem: (key) => local.get(key) ?? null,
      removeItem: (key) => { local.delete(key); },
    },
  };
  return {stored, local, writes};
}

test('布局读写优先主进程存储，localStorage 只作为回退', () => {
  const {stored, local, writes} = stubWindow();
  persistLayout(LAYOUT_STORAGE_KEY, '{"grid":1}');
  assert.deepEqual(writes, [[LAYOUT_STORAGE_KEY, '{"grid":1}']]);
  assert.equal(stored.get(LAYOUT_STORAGE_KEY), '{"grid":1}');
  assert.equal(readPersistedLayout(LAYOUT_STORAGE_KEY), '{"grid":1}');

  local.set(LAYOUT_STORAGE_KEY, '{"grid":2}');
  assert.equal(readPersistedLayout(LAYOUT_STORAGE_KEY), '{"grid":1}', '主进程存储优先');
  stored.clear();
  assert.equal(readPersistedLayout(LAYOUT_STORAGE_KEY), '{"grid":2}', '主进程没有时才用回退副本');
  assert.equal(readPersistedLayout('onmyoji-studio.unknown'), null);
});

test('清掉坏布局时两份存储一起删', () => {
  const {stored, local, writes} = stubWindow();
  stored.set(WORKBENCH_LAYOUT_STORAGE_KEY, 'broken');
  local.set(WORKBENCH_LAYOUT_STORAGE_KEY, 'broken');
  clearPersistedLayout(WORKBENCH_LAYOUT_STORAGE_KEY);
  assert.deepEqual(writes, [[WORKBENCH_LAYOUT_STORAGE_KEY, null]]);
  assert.equal(stored.has(WORKBENCH_LAYOUT_STORAGE_KEY), false);
  assert.equal(local.has(WORKBENCH_LAYOUT_STORAGE_KEY), false);
  assert.equal(readPersistedLayout(WORKBENCH_LAYOUT_STORAGE_KEY), null);
});

test('默认脚手架只出现在首次运行与恢复默认布局', () => {
  const docking = read('src/renderer/docking.ts');
  const section = (start, end) => docking.slice(docking.indexOf(start), docking.indexOf(end));
  // 恢复过布局就不再补面板：用户关掉的固定面板不该重启后自己回来。
  assert.match(docking, /restoredLayout = api\.totalPanels > 0/);
  assert.match(
    section('const ensureLayout', 'const resetLayout'),
    /if \(!restoredLayout\) \{\s*\n\s*DEFAULT_PANEL_ORDER\.forEach\(addPanel\);\s*\n\s*restoredLayout = true;\s*\n\s*\}/,
  );
  assert.equal(
    (docking.match(/DEFAULT_PANEL_ORDER\.forEach\(addPanel\)/g) || []).length, 2,
    'DEFAULT_PANEL_ORDER.forEach(addPanel) 只允许在 ensureLayout 的首次运行分支与 resetLayout 里出现',
  );
  // 「恢复默认布局」重建后同样回到「已经有脚手架」的状态，避免下一次 ensureLayout 再铺一遍。
  assert.match(
    section('const resetLayout', 'const layoutDisposable'),
    /DEFAULT_PANEL_ORDER\.forEach\(addPanel\);\s*\n\s*restoredLayout = true;/,
  );
  // 没有可恢复布局时仍然保证「至少有一个工作流画布」。
  const ensure = section('const ensureLayout', 'const resetLayout');
  assert.match(ensure, /if \(documentPanels\(\)\.length === 0 && fallbackDocument\) openDocument\(/);
  assert.match(ensure, /if \(documentPanels\(\)\.length === 0\) \{/);
  assert.equal(
    (docking.match(/clearPersistedLayout\(/g) || []).length, 2,
    '内层与外层两份坏布局都要清掉',
  );
});

test('兜底根模块保留，其余面板关掉就是关掉', () => {
  const docking = read('src/renderer/docking.ts');
  assert.match(docking, /else if \(!api\.getPanel\('workflow'\)\) addPanel\('workflow'\)/, '「工作流编辑器」必须始终存在');
  assert.equal(
    /addPanel\('overview'\)/.test(docking), false,
    '概览不再被恢复流程无条件补回（要开走顶部「窗口」菜单）',
  );
  // 内容依赖本次会话的面板仍旧不恢复成空白面板。
  assert.match(docking, /const restoredReferenceViewer = api\.getPanel\('referenceViewer'\);\s*\n\s*if \(restoredReferenceViewer\) restoredReferenceViewer\.api\.close\(\);/);
  // 设置面板恢复用户自己停靠的位置：恢复流程不再把它挪回标签。
  assert.equal(/restoredSettings/.test(docking), false);
  assert.match(docking, /if \(panelId === 'settings' && !settingsTabbedWithWorkflow\(\)\) \{/, '从菜单打开时仍归位到工作流编辑器那一行');
});
