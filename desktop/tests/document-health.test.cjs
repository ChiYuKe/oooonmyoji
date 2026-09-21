// Run via npm test (builds the renderer test output first).
// 阶段 7：旧格式可撤销迁移与「布局异常只重建布局」的纯逻辑。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  migrateDocument, inspectLayout, pruneOrphanLayout, WORKFLOW_SCHEMA_VERSION,
} = require('../dist-test-renderer/canvas/model/document-health.js');

test('旧格式迁移：补 schema_version / version，移除废弃的 public 字段', () => {
  const raw = {
    id: 'demo', root: 'root',
    inputs: { 阈值: { type: 'number', public: true }, 另一个: { type: 'string', public: false } },
    variables: { 计数: { type: 'integer', default: 0, public: true } },
    nodes: [{ id: 'root', type: 'root', children: [] }],
  };
  const outcome = migrateDocument(raw);
  assert.equal(outcome.changed, true);
  assert.deepEqual(outcome.steps, [
    'schema_version 缺失 → 4',
    '补上 version = 4.0.0',
    '移除 3 处 schema v4 已废弃的 public 字段',
  ]);
  assert.equal(raw.schema_version, WORKFLOW_SCHEMA_VERSION);
  assert.equal(raw.version, '4.0.0');
  assert.equal('public' in raw.inputs.阈值, false);
  assert.equal(raw.inputs.阈值._migratedPublic, true, '曾经公开过的定义留痕');
  assert.equal('public' in raw.inputs.另一个, false);
  assert.equal('_migratedPublic' in raw.inputs.另一个, false, '本来就没公开的不留痕');
  assert.equal('public' in raw.variables.计数, false);

  // 幂等：再迁移一次什么都不做。
  const again = migrateDocument(raw);
  assert.equal(again.changed, false);
  assert.deepEqual(again.steps, []);
});

test('已经是 v4 的文档不会被迁移改动', () => {
  const raw = {
    schema_version: 4, version: '4.0.0', id: 'demo', root: 'root',
    inputs: {}, variables: {}, nodes: [{ id: 'root', type: 'root', children: [] }],
  };
  const snapshot = JSON.stringify(raw);
  assert.deepEqual(migrateDocument(raw), { changed: false, steps: [] });
  assert.equal(JSON.stringify(raw), snapshot);
  assert.deepEqual(migrateDocument(null), { changed: false, steps: [] });
  assert.deepEqual(migrateDocument('nope'), { changed: false, steps: [] });
});

test('布局体检：缺坐标 / 坐标非法 / 量级离谱 / 残留项分别认出来', () => {
  const raw = {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    _layout: {
      b: { x: Number.NaN, y: 0 },
      c: { x: 12_000_000, y: 0 },
      d: { x: 10, y: 20 },
      ghost: { x: 0, y: 0 },
    },
  };
  const health = inspectLayout(raw);
  assert.deepEqual(health.missing, ['a']);
  assert.deepEqual(health.invalid, ['b']);
  assert.deepEqual(health.absurd, ['c']);
  assert.deepEqual(health.orphan, ['ghost']);
  assert.equal(health.needsRebuild, true);
  assert.equal(health.needsPrune, true);
  assert.match(health.summary, /1 个节点没有坐标/);
  assert.match(health.summary, /坐标不是有效数字/);
  assert.match(health.summary, /坐标量级异常/);
  assert.match(health.summary, /坐标残留指向不存在的节点/);
});

test('布局健康时体检不报任何问题', () => {
  const raw = { nodes: [{ id: 'a' }, { id: 'b' }], _layout: { a: { x: 0, y: 0 }, b: { x: 100, y: 200 } } };
  const health = inspectLayout(raw);
  assert.deepEqual(health.missing, []);
  assert.deepEqual(health.invalid, []);
  assert.deepEqual(health.absurd, []);
  assert.deepEqual(health.orphan, []);
  assert.equal(health.needsRebuild, false);
  assert.equal(health.needsPrune, false);
  assert.equal(health.summary, '');
  // 没有 _layout 时全部算「缺坐标」，而不是崩掉。
  assert.equal(inspectLayout({ nodes: [{ id: 'a' }] }).needsRebuild, true);
  assert.equal(inspectLayout(null).needsRebuild, false);
});

test('清理残留坐标只删指向不存在节点的项，并返回条数', () => {
  const raw = { nodes: [{ id: 'a' }], _layout: { a: { x: 1, y: 2 }, ghost: { x: 0, y: 0 }, ghost2: { x: 0, y: 0 } } };
  assert.equal(pruneOrphanLayout(raw), 2);
  assert.deepEqual(Object.keys(raw._layout), ['a']);
  assert.equal(pruneOrphanLayout(raw), 0);
  assert.equal(pruneOrphanLayout(null), 0);
  assert.equal(pruneOrphanLayout({ nodes: [] }), 0);
});

test('迁移与布局修复都接在画布入口上，且迁移走一次历史（可撤销）', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/editor.ts'), 'utf8');
  const repair = editor.slice(editor.indexOf('function repairLayout('), editor.indexOf('function requestSave('));
  assert.match(repair, /inspectLayout\(state\.raw\)/, '先体检');
  assert.match(repair, /autoLayoutPreview\('all'\)/, '只算布局');
  assert.match(repair, /applyLayoutPositions\(positions\)/, '只写坐标');
  assert.match(repair, /pruneOrphanLayout\(state\.raw\)/, '顺手清残留');
  assert.match(repair, /只重建布局/, '提示里说明只动了布局');
  assert.doesNotMatch(repair, /state\.raw\.nodes\s*=/, '绝不动节点数据');
  const messages = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/shell/messages.ts'), 'utf8');
  const initBlock = messages.slice(messages.indexOf("message.type === 'init'"), messages.indexOf("message.type === 'workflows'"));
  assert.match(initBlock, /mutate\(\(\) => \{ migrationSteps = migrateDocument\(state\.raw\)\.steps; \}\)/, '迁移包进 mutate：Ctrl+Z 能回到打开时的原样');
  assert.match(initBlock, /repairLayout\(false\)/, '打开文档时顺手修布局（不进历史）');
  assert.match(initBlock, /Ctrl\+Z 可撤销/, '迁移后告诉用户可撤销');
  const dispatch = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/state/editor-command-dispatch.ts'), 'utf8');
  assert.match(dispatch, /command === 'repairLayout'\) repairLayout\(true\)/);
});
