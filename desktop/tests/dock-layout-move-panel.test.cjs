// Run via npm test (builds the desktop output first).
// 「社区方案比对」要和「御魂配装」共用同一行标签（同一个分组），像「运行日志」跟
// 「内容浏览器」那样。旧布局里它可能单独停在一个分组（甚至整列），恢复时把它挪到
// 御魂配装旁边，空出来的分组剪掉；面板本来没打开就不要凭空加回来。
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { moveLayoutPanel } = require('../dist-test-renderer/renderer/shell/docking/layout.js');

/** 线上常见形状：左边一行标签，右边社区比对单独一组。 */
function twoGroupLayout() {
  return {
    grid: {
      root: {
        type: 'branch',
        data: [
          {
            type: 'leaf',
            data: { views: ['workflow', 'overview', 'onmyojiTeamBuilder', 'soulCalculator', 'soulOptimizer'], activeView: 'soulOptimizer', id: '1' },
            size: 1308,
          },
          { type: 'leaf', data: { views: ['soulCommunityComparison'], activeView: 'soulCommunityComparison', id: '3' }, size: 1252 },
        ],
        size: 1360,
      },
      width: 2560,
      height: 1360,
      orientation: 'HORIZONTAL',
    },
    panels: { soulOptimizer: {}, soulCommunityComparison: {} },
    activeGroup: '1',
  };
}

test('单独一组的社区比对被挪进御魂配装那一行，空分组剪掉（根节点仍是 branch）', () => {
  const layout = twoGroupLayout();
  moveLayoutPanel(layout, 'soulCommunityComparison', 'soulOptimizer');
  assert.equal(layout.grid.root.type, 'branch', '根节点必须保持 branch，否则 dockview 拒绝整份布局');
  assert.equal(layout.grid.root.data.length, 1, '空掉的右列被剪掉');
  assert.deepEqual(layout.grid.root.data[0].data.views,
    ['workflow', 'overview', 'onmyojiTeamBuilder', 'soulCalculator', 'soulOptimizer', 'soulCommunityComparison'],
    '社区比对紧跟在御魂配装后面，同一行标签');
  assert.equal(layout.grid.root.data[0].data.activeView, 'soulOptimizer', '不动原活动标签');
});

test('已经在同一行里就保持原样（幂等）', () => {
  const layout = twoGroupLayout();
  moveLayoutPanel(layout, 'soulCommunityComparison', 'soulOptimizer');
  const once = JSON.stringify(layout);
  moveLayoutPanel(layout, 'soulCommunityComparison', 'soulOptimizer');
  assert.equal(JSON.stringify(layout), once, '重复调用不再改动');
});

test('被挪走的是活动标签时活动标签回退到该组剩下的第一个', () => {
  const layout = {
    grid: {
      root: {
        type: 'branch',
        data: [
          { type: 'leaf', data: { views: ['soulOptimizer', 'workflow'], activeView: 'workflow', id: '1' } },
          { type: 'leaf', data: { views: ['soulCommunityComparison'], activeView: 'soulCommunityComparison', id: '2' } },
        ],
      },
    },
  };
  moveLayoutPanel(layout, 'soulCommunityComparison', 'soulOptimizer');
  assert.deepEqual(layout.grid.root.data, [
    { type: 'leaf', data: { views: ['soulOptimizer', 'soulCommunityComparison', 'workflow'], activeView: 'workflow', id: '1' } },
  ]);
});

test('面板本来就没打开：不凭空加回来', () => {
  const layout = twoGroupLayout();
  layout.grid.root.data[1].data.views = ['soulCommunityUpload'];
  layout.grid.root.data[1].data.activeView = 'soulCommunityUpload';
  const before = JSON.stringify(layout);
  moveLayoutPanel(layout, 'soulCommunityComparison', 'soulOptimizer');
  assert.equal(JSON.stringify(layout), before);
});

test('参照面板不在布局里时保持原样', () => {
  const layout = twoGroupLayout();
  layout.grid.root.data[0].data.views = ['workflow'];
  layout.grid.root.data[0].data.activeView = 'workflow';
  const before = JSON.stringify(layout);
  moveLayoutPanel(layout, 'soulCommunityComparison', 'soulOptimizer');
  assert.equal(JSON.stringify(layout), before);
});

test('浮动分组里的社区比对也会并回主网格那一行，空浮动分组丢弃', () => {
  const layout = {
    grid: { root: { type: 'leaf', data: { views: ['workflow', 'soulOptimizer'], activeView: 'soulOptimizer', id: '1' } } },
    floatingGroups: [
      { data: { grid: { root: { type: 'leaf', data: { views: ['soulCommunityComparison'], activeView: 'soulCommunityComparison', id: '9' } } } } },
    ],
  };
  moveLayoutPanel(layout, 'soulCommunityComparison', 'soulOptimizer');
  assert.deepEqual(layout.grid.root.data.views, ['workflow', 'soulOptimizer', 'soulCommunityComparison']);
  assert.equal(layout.floatingGroups.length, 0, '空掉的浮动分组整块丢掉');
});

test('非对象输入与相同 id 不报错也不改动', () => {
  for (const value of [null, undefined, 42, 'text']) {
    assert.doesNotThrow(() => moveLayoutPanel(value, 'soulCommunityComparison', 'soulOptimizer'));
  }
  const layout = twoGroupLayout();
  const before = JSON.stringify(layout);
  moveLayoutPanel(layout, 'soulOptimizer', 'soulOptimizer');
  assert.equal(JSON.stringify(layout), before);
});
