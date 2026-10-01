const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planParameterReplacement, replacementStillCurrent } = require('../dist-test-renderer/canvas/model/parameter-replacement.js');
const defs = { threshold: { type: 'number', min: 0, max: 1 }, template: { type: 'asset' }, templates: { type: 'array', items: { type: 'asset' } }, timeout: { type: 'duration', min: 0 }, enabled: { type: 'boolean' } };
const catalog = { names: () => ['wait', 'match'], byName: () => ({ parameters: defs, outputSchema: { type: 'string' } }) };
const fixture = () => ({ schema_version: 4, root: 'root', nodes: [{ id: 'root', type: 'sequence', children: ['a', 'b'] }, { id: 'a', name: '等待', type: 'task', action: 'wait', params: { threshold: .8, template: 'assets/old/a.png', templates: ['assets/old/a.png', 'assets/old/b.png'], timeout: 10, enabled: true } }, { id: 'b', type: 'task', action: 'match', params: { threshold: .8, template: { ref: 'nodes.a.output' } } }] });

test('替换预览覆盖嵌套固定参数，保留引用及原文，并支持动作和字段限制', () => {
  const raw = fixture(), before = JSON.stringify(raw);
  const plan = planParameterReplacement(raw, raw.nodes, catalog, { find: 'assets/old/', replacement: 'assets/new/', mode: 'text' });
  assert.equal(plan.length, 2); assert.equal(plan[1].count, 2);
  assert.deepEqual(plan[1].after, ['assets/new/a.png', 'assets/new/b.png']);
  assert.ok(plan.every((item) => !item.error)); assert.equal(JSON.stringify(raw), before);
  const exact = planParameterReplacement(raw, raw.nodes, catalog, { find: '0.8', replacement: '0.9', mode: 'exact', action: 'wait', param: 'threshold' });
  assert.equal(exact.length, 1); assert.equal(exact[0].after, .9);
});

test('数值边界、空数值、布尔值和文本转换不合法时禁止应用', () => {
  const raw = fixture();
  for (const replacement of ['2', '', 'NaN']) {
    const plan = planParameterReplacement(raw, raw.nodes, catalog, { find: '.8', replacement, mode: 'exact' });
    assert.equal(plan.length, 0);
    const matched = planParameterReplacement(raw, raw.nodes, catalog, { find: '0.8', replacement, mode: 'exact' });
    assert.equal(matched.length, 2); assert.ok(matched.every((item) => item.error));
  }
  assert.ok(planParameterReplacement(raw, raw.nodes, catalog, { find: 'true', replacement: 'yes', mode: 'exact' })[0].error);
  assert.equal(planParameterReplacement(raw, raw.nodes, catalog, { find: 'true', replacement: 'false', mode: 'exact' })[0].after, false);
});

test('预览后参数发生变化或节点被删时要求重新预览', () => {
  const raw = fixture(), plan = planParameterReplacement(raw, raw.nodes, catalog, { find: '0.8', replacement: '0.9', mode: 'exact' });
  assert.equal(replacementStillCurrent(raw.nodes, plan), true);
  raw.nodes[1].action = 'match'; assert.equal(replacementStillCurrent(raw.nodes, plan), false); raw.nodes[1].action = 'wait';
  raw.nodes[1].params.threshold = .7; assert.equal(replacementStillCurrent(raw.nodes, plan), false);
  raw.nodes.splice(1, 1); assert.equal(replacementStillCurrent(raw.nodes, plan), false);
});
