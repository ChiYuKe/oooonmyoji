// Run via npm test (builds the renderer test output first).
// 阶段 5：节点位置锁定。锁记在文档的编辑器元数据 `_layoutLocks` 里，
// 拖动与自动排列都会跳过锁定的卡片；这里验证纯函数读写与「空数组不留痕」。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lockedNodeIds, isNodeLocked, toggleNodeLock } = require('../dist-test-renderer/canvas/model/layout-locks.js');

test('锁定/解锁来往切换，且不留下空数组', () => {
  const raw = {};
  assert.equal(isNodeLocked(raw, 'a'), false, '缺省未锁定');
  assert.equal(toggleNodeLock(raw, 'a'), true);
  assert.deepEqual(raw._layoutLocks, ['a']);
  assert.equal(isNodeLocked(raw, 'a'), true);

  assert.equal(toggleNodeLock(raw, 'b'), true);
  assert.deepEqual(raw._layoutLocks, ['a', 'b']);
  assert.equal(toggleNodeLock(raw, 'a'), false, '再切一次即解锁');
  assert.deepEqual(raw._layoutLocks, ['b']);
  toggleNodeLock(raw, 'b');
  assert.equal('_layoutLocks' in raw, false, '全部解锁后整个字段删掉');
});

test('脏数据与非法输入安全退化', () => {
  assert.deepEqual([...lockedNodeIds(null)], []);
  assert.deepEqual([...lockedNodeIds({_layoutLocks: 'a'})], [], '不是数组就当没有');
  assert.deepEqual([...lockedNodeIds({_layoutLocks: ['a', '', null, 3]})], ['a', '3']);
  assert.equal(toggleNodeLock(null, 'a'), false);
  assert.equal(toggleNodeLock({}, ''), false);
});

test('锁定状态进文档、可被撤销（调用方 mutate + 快照即可回退）', () => {
  const raw = {_layout: {a: {x: 0, y: 0}}};
  const before = JSON.stringify(raw);
  toggleNodeLock(raw, 'a');
  assert.equal(isNodeLocked(raw, 'a'), true);
  const after = JSON.stringify(raw);
  assert.notEqual(before, after, '锁定确实写进了文档快照');
  // 撤销 = 把快照写回去：解锁后与最初完全一致。
  const restored = JSON.parse(before);
  assert.equal(isNodeLocked(restored, 'a'), false);
  assert.deepEqual(JSON.parse(after).nodes, undefined, '锁不引入 nodes 字段以外的结构');
});

test('保存 → 重新打开后锁定状态还在（规范化不丢编辑器元数据）', () => {
  const { normalizeRaw } = require('../dist-test-renderer/canvas/state/normalize.js');
  const raw = {root: 'root', nodes: [{id: 'root', type: 'root', children: []}], inputs: {}, variables: {}, _layout: {root: {x: 0, y: 0}}};
  toggleNodeLock(raw, 'root');
  // 保存 = 序列化写成 JSON 文本；重新打开 = 解析 + normalizeRaw。
  const saved = JSON.stringify(raw, null, 2);
  const reopened = normalizeRaw(JSON.parse(saved));
  assert.equal(isNodeLocked(reopened, 'root'), true, '重新打开后仍然锁定');
  assert.deepEqual(reopened._layoutLocks, ['root']);
  // 没有锁的文档不因为规范化凭空长出一个空数组。
  const clean = normalizeRaw(JSON.parse(JSON.stringify({root: 'r', nodes: [], inputs: {}, variables: {}})));
  assert.equal('_layoutLocks' in clean, false);
});

test('卡片渲染与拖拽都接上锁定：画小锁角标、拖动跳过锁定卡片', () => {
  const card = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/render/node-card.ts'), 'utf8');
  assert.match(card, /node-locked-badge/, '卡片上有锁定角标');
  assert.match(card, /位置已锁定/, '悬停提示说明锁定含义');
  assert.match(card, /node-locked'\)/, '锁定卡片带 node-locked class');
  const pointer = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/interactions/pointer.ts'), 'utf8');
  assert.match(pointer, /isNodeLocked\(selected\)/, '拖动时跳过锁定卡片');
  const viewport = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/canvas/viewport.ts'), 'utf8');
  assert.match(viewport, /isLocked\?\.\(String\(node\.id\)\)/, '自动排列尊重锁定');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/legacy/workflow-editor.css'), 'utf8');
  assert.match(css, /\.node\.node-locked \.node-box \{/, '锁定卡片有样式');
  assert.match(css, /\.node-locked-badge \{/, '锁定角标有样式');
});
