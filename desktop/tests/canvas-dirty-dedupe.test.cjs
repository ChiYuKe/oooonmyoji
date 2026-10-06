// Run via npm test (builds the renderer test output first).
//
// 脏标记上报去重（协议层需要，不是优化）。
//
// 画布里存在**读路径上的派生补齐**：节点组的执行引脚名由画布自己推导，而图文档 / `.owf`
// 都不持久化它 —— 所以「它不是数组」在每次重新解析后都成立。如果每次补齐都把文档标脏并原样
// 上报整份正文，壳层就会把正文回灌 `replaceDocument` 回来，画布文档版本 +1 又让组缓存失效、
// 再次补齐标脏：静置状态下的自转环（实测 40~180 条/秒，主线程 90% 以上耗在 postMessage，
// 整个应用被压到 ~9 fps，而画布自身的渲染 JS 只有 0.1ms）。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createEditorStatus } = require('../dist-test-renderer/canvas/state/editor-status.js');

function harness() {
  const state = createCanvasState();
  state.raw = {
    schema_version: 4, id: 'demo', version: '4.4.0', resolution: [1920, 1080], root: 'root',
    nodes: [
      { id: 'root', type: 'root', children: ['a'] },
      { id: 'a', type: 'task', action: 'core.log', params: { message: 'x' } },
    ],
    inputs: {}, variables: {}, _layout: { root: { x: 0, y: 0 }, a: { x: 0, y: 300 } },
  };
  const posts = [];
  const states = [];
  const status = createEditorStatus({
    state,
    vscode: { postMessage: (message) => posts.push(message), setState: (value) => states.push(value) },
    $: () => ({ classList: { toggle() {} } }),
  });
  return { state, status, posts, states, changes: () => posts.filter((item) => item.type === 'documentStateChanged') };
}

test('同一份正文重复标脏只上报一次', () => {
  const h = harness();
  h.status.setDirty(true);
  assert.equal(h.changes().length, 1, '第一次标脏要如实上报');
  h.status.setDirty(true);
  h.status.setDirty(true);
  assert.equal(h.changes().length, 1, '正文没变就不再上报（否则与壳层形成自转环）');
  assert.equal(h.states.length, 1, 'dirty 值没变也不再发 legacy-editor-state');
});

test('正文真的变了要照常上报；清脏后同一份正文也重新上报', () => {
  const h = harness();
  h.status.setDirty(true);
  const first = h.changes()[0].text;
  h.state.raw.nodes[1].params.message = 'y';
  h.status.setDirty(true);
  const changes = h.changes();
  assert.equal(changes.length, 2);
  assert.notEqual(changes[1].text, first, '改过正文必须上报新正文');

  h.status.setDirty(false); // 落盘：清脏并重置去重基准
  assert.equal(h.state.dirty, false);
  h.status.setDirty(true);
  assert.equal(h.changes().length, 3, '写盘之后即使正文相同也要能重新上报');
});

test('清脏本身不上报正文，只更新状态位', () => {
  const h = harness();
  h.status.setDirty(false);
  assert.deepEqual(h.changes(), []);
  assert.deepEqual(h.states, [{ dirty: false }]);
});

test('节点组的执行引脚名是派生字段，不得把文档标脏', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/model/node-groups.ts'), 'utf8');
  assert.match(source, /value\.execInputs = execInputs;/);
  assert.match(source, /value\.execOutputs = execOutputs;/);
  assert.doesNotMatch(source, /value\.exec(?:Inputs|Outputs) = exec(?:Inputs|Outputs);\s*\n\s*migrated = true;/,
    '执行引脚名不落盘：把它算成「迁移」会让每次缓存失效都标脏 → 上报 → 壳层回灌 → 死循环');
  // 真正需要落盘的迁移（pins / pinPolicy / 边界卡）仍然要标脏。
  assert.match(source, /if \(migrated\) markDirty\?\.\(\);/);
});

test('壳层把「与当前持有正文一致」的上报当作非编辑', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/app/editor-host.ts'), 'utf8');
  assert.match(source, /const held = targetUri \? workspace\.tab\?\.\(targetUri\)\?\.text \?\? '' : '';/);
  assert.match(source, /if \(held && held === text\) return;/);
});
