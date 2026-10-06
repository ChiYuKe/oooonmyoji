// Run via npm test (builds the desktop output first).
// 布局恢复前的消毒：dockview 只在按 JSON 恢复布局时才会用 hideHeader 建分组，一旦恢复进去
// 分组就没有标签栏（面板内容顶到分组顶部，用户看到「标签页标签都不见了」），而且之后每次
// 保存都会把它写回去。应用从不需要隐藏标签栏，所以恢复前统一清掉。
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { stripHiddenGroupHeaders } = require('../dist-test-renderer/renderer/shell/docking/layout.js');

/** 造一份带 hideHeader / headerPosition 的布局，形状与 dockview 序列化一致。 */
function layoutWithHiddenHeaders() {
  return {
    grid: {
      root: {
        type: 'branch',
        data: [
          {
            type: 'leaf',
            data: { views: ['workflow', 'soulOptimizer'], activeView: 'soulOptimizer', id: '1', hideHeader: true },
            size: 1308,
          },
          {
            type: 'leaf',
            data: { views: ['soulCommunityComparison'], activeView: 'soulCommunityComparison', id: '3', hideHeader: true, headerPosition: 'bottom' },
            size: 1252,
          },
        ],
        size: 1360,
      },
      width: 2560,
      height: 1360,
      orientation: 'HORIZONTAL',
    },
    panels: {
      workflow: { id: 'workflow', contentComponent: 'existing-module', title: '工作流编辑器' },
    },
    activeGroup: '1',
  };
}

test('清掉叶子上的 hideHeader 与竖排/底部 headerPosition', () => {
  const layout = layoutWithHiddenHeaders();
  stripHiddenGroupHeaders(layout);
  assert.equal('hideHeader' in layout.grid.root.data[0].data, false);
  assert.equal('hideHeader' in layout.grid.root.data[1].data, false);
  assert.equal('headerPosition' in layout.grid.root.data[1].data, false);
  assert.deepEqual(layout.grid.root.data[0].data.views, ['workflow', 'soulOptimizer'], '其余字段保持原样');
  assert.equal(JSON.stringify(layout).includes('hideHeader'), false, '序列化后也不会再留着');
});

test('保留 top 的 headerPosition（等价于默认值）', () => {
  const layout = {
    grid: { root: { type: 'leaf', data: { views: ['workflow'], activeView: 'workflow', id: '1', headerPosition: 'top' } } },
  };
  stripHiddenGroupHeaders(layout);
  assert.equal(layout.grid.root.data.headerPosition, 'top');
});

test('嵌套网格与浮动分组里的 hideHeader 一并清掉', () => {
  const layout = {
    grid: {
      root: {
        type: 'branch',
        data: [
          { type: 'branch', data: [{ type: 'leaf', data: { views: ['a'], id: '1', hideHeader: true } }] },
          { type: 'leaf', data: { views: ['b'], id: '2' } },
        ],
      },
    },
    floatingGroups: [{ data: { grid: { root: { type: 'leaf', data: { views: ['c'], id: '3', hideHeader: true } } } } }],
  };
  stripHiddenGroupHeaders(layout);
  assert.equal(JSON.stringify(layout).includes('hideHeader'), false);
});

test('不含 hideHeader 的布局原样不变', () => {
  const layout = layoutWithHiddenHeaders();
  for (const leaf of layout.grid.root.data) delete leaf.data.hideHeader;
  delete layout.grid.root.data[1].data.headerPosition;
  const before = JSON.stringify(layout);
  stripHiddenGroupHeaders(layout);
  assert.equal(JSON.stringify(layout), before);
});

test('非对象输入不报错', () => {
  for (const value of [null, undefined, 42, 'text', []]) {
    assert.doesNotThrow(() => stripHiddenGroupHeaders(value));
  }
});
