const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createParameterControls } = require('../dist-test-renderer/canvas/inspector/parameter-controls.js');
const { createEditorHistory } = require('../dist-test-renderer/canvas/state/history.js');
const { createEditorStatus } = require('../dist-test-renderer/canvas/state/editor-status.js');
const { planActionParameters, parameterValueAccepted, nodeReferenceValidator } = require('../dist-test-renderer/canvas/model/parameter-edits.js');

test('无需动态代码的参数校验与原有 schema 规则一致', () => {
  const Ajv2020 = require('ajv/dist/2020').default;
  const { parameterToSchema } = require('../dist-test-renderer/shared/workflow/parameters.js');
  const { allowBinding } = require('../dist-test-renderer/shared/workflow/bindings.js');
  const ajv = new Ajv2020({ strict: false });
  const cases = [
    [{ type: 'number', min: 0, max: 1 }, [0, .8, 1, -1, 2, '0.8', NaN, Infinity]],
    [{ type: 'integer', min: 1 }, [1, 1.5, 0, '1']],
    [{ type: 'duration', min: 0 }, [300, 3, 0, -1, '3']],
    [{ type: 'boolean' }, [true, false, 0, 'true']],
    ...['string', 'asset', 'path', 'workflow', 'enum', 'key'].map(type => [{ type, minLength: 1, maxLength: 3 }, ['abc', '', 'abcd', '😀', 3]]),
    [{ type: 'key' }, ['BACK', '4', 'A_B', 'A B', '返回']],
    [{ type: 'color' }, ['#fF00aA', '#fff', 'red', 3]],
    [{ type: 'enum', enum: ['a', 'b'] }, ['a', 'b', 'c', 1]],
    [{ type: 'point' }, [{ x: 1, y: 2 }, { x: 1 }, { x: 1.5, y: 2 }, { x: 1, y: 2, extra: 3 }, [1, 2]]],
    [{ type: 'rect' }, [[1669, 832, 251, 248], [1, 2, 3], [1, 2, 3, 4, 5], [1.5, 2, 3, 4], ['1', 2, 3, 4]]],
    [{ type: 'array', minItems: 1, maxItems: 2, items: { type: 'integer' } }, [[1], [1, 2], [], [1, 2, 3], [1.2], ['1']]],
    [{ type: 'object', properties: { x: { type: 'number', required: true }, names: { type: 'array', items: { type: 'string' } } } }, [{ x: 1 }, {}, { x: 1, extra: true }, { x: '1' }, { x: 1, names: ['a'] }, { x: 1, names: [3] }]],
    [{ type: 'object' }, [{}, { free: [1, 'a'] }, null, []]],
    [{ type: 'any', enum: [{ x: 1, y: 2 }] }, [{ y: 2, x: 1 }, { x: 2, y: 1 }]],
    [{ type: 'any' }, [null, 1, 'a', {}, []]],
  ];
  for (const [definition, values] of cases) {
    const expected = ajv.compile(allowBinding(parameterToSchema(definition)));
    for (const value of values) assert.equal(parameterValueAccepted(definition, value), expected(value), `${JSON.stringify(definition)} / ${JSON.stringify(value)}`);
  }
  const accepts = (ref, def) => ref === 'inputs.count' && def.type === 'integer';
  assert.equal(parameterValueAccepted({ type: 'integer' }, { ref: 'inputs.count' }, accepts), true);
  assert.equal(parameterValueAccepted({ type: 'integer' }, { ref: '' }, accepts), false);
  assert.equal(parameterValueAccepted({ type: 'integer' }, { ref: 'inputs.count', extra: true }, accepts), false);
  assert.equal(parameterValueAccepted({ type: 'array', items: { type: 'integer' } }, [{ ref: 'inputs.count' }], accepts), true);
});

function el(tag, className = '', textContent = '') {
  return { tag, className, textContent, children: [], events: {}, type: '', disabled: false, dataset: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(name, fn) { this.events[name] = fn; },
  };
}
function setup(overrides = {}) {
  const nodes = [{ id: 'a', type: 'task', action: 'find', params: { threshold: .8, timeout: 10, template: 'assets/a.png' } }, { id: 'b', type: 'task', action: 'wait', params: { threshold: .9, timeout: 20 } }];
  const common = { threshold: { type: 'number', min: 0, max: 1, default: .85 }, timeout: { type: 'duration', min: 0, default: 5 }, template: { type: 'asset' } };
  const state = { raw: { schema_version: 4, version: '1', id: 'test', root: 'a', resolution: [1920,1080], nodes, inputs: {}, variables: {} }, catalog: [{ name: 'find', parameters: common }, { name: 'wait', parameters: { ...common, timeout: { type: 'duration', min: 0, max: 30, default: 8 } } }], selected: new Set(['a','b']), undo: [], redo: [], paramLiteralCache: {} };
  const links = { 'a:threshold': 'old-card' };
  const toasts = [], confirms = [];
  const history = createEditorHistory({ state, cleanupReleased: () => [], clearVariableCardSelection() {}, nodeById: (id) => state.raw.nodes.find((node) => node.id === id), setDirty() {}, render() {} });
  const controls = createParameterControls({ state, mutate: history.mutate, clone: (value) => JSON.parse(JSON.stringify(value)), el, fieldLabel: (name) => name, enumOption: (value) => value, defaultValue: (def) => def.default ?? '', toast: (...args) => toasts.push(args), variableLinks: () => links,
    confirmParameterRemoval: (names) => { confirms.push(names); return overrides.confirm !== false; },
    UI: { dropdown: (options) => options }, ACTION_LABELS: {}, actionLabel: (name) => name,
    textInput: (value, onChange, options) => Object.assign(el('input'), { value, onChange, options }),
    selectInput: (value, options, onChange) => Object.assign(el('select'), { value, options, onChange }),
  });
  return { state, nodes, controls, links, toasts, confirms, history };
}

test('动作切换保留兼容参数，移除不兼容参数前确认，取消没有历史或数据变化', () => {
  const h = setup({ confirm: false });
  h.nodes[0].params.extra = 'old';
  const dropdown = h.controls.actionDropdown(h.nodes[0]);
  assert.equal(dropdown.onChange('wait'), false);
  assert.equal(h.nodes[0].action, 'find');
  assert.equal(h.state.undo.length, 0);
  assert.deepEqual(h.confirms, [['extra']]);
  const accepted = setup();
  accepted.nodes[0].params.extra = 'old';
  accepted.links['a:extra'] = 'card';
  accepted.links['a:extra.child'] = 'nested-card';
  accepted.controls.actionDropdown(accepted.nodes[0]).onChange('wait');
  assert.deepEqual(accepted.nodes[0].params, { threshold: .8, timeout: 10, template: 'assets/a.png' });
  assert.equal(accepted.nodes[0].action, 'wait');
  assert.equal(accepted.links['a:extra'], undefined);
  assert.equal(accepted.links['a:extra.child'], undefined);
  assert.equal(accepted.state.undo.length, 1);
  accepted.history.undo();
  assert.equal(accepted.state.raw.nodes[0].params.extra, 'old');
});

test('兼容性检查覆盖数值边界、枚举、对象、数组及高序号输出引用', () => {
  assert.equal(parameterValueAccepted({ type: 'integer', min: 1 }, 1.2), false);
  assert.equal(parameterValueAccepted({ type: 'number', max: 1 }, NaN), false);
  assert.equal(parameterValueAccepted({ type: 'enum', enum: ['a'] }, 'b'), false);
  assert.equal(parameterValueAccepted({ type: 'array', minItems: 2, items: { type: 'integer' } }, [1]), false);
  assert.equal(parameterValueAccepted({ type: 'object', properties: { x: { type: 'integer', required: true } } }, { y: 2 }), false);
  const raw = { schema_version: 4, root: 'source', nodes: [{ id: 'source', type: 'task', action: 'produce' }, { id: 'target', type: 'task', action: 'consume' }] };
  const catalog = { names: () => ['produce'], byName: () => ({ parameters: {}, inputSchema: {}, outputSchema: { type: 'array', items: { type: 'object', properties: { confidence: { type: 'number' } } } } }) };
  const accept = nodeReferenceValidator(raw, catalog, 'target');
  const result = planActionParameters({ threshold: { ref: 'nodes.source.output.12.confidence' }, template: { ref: 'nodes.source.output.12.confidence' } }, { threshold: { type: 'number' }, template: { type: 'asset' } }, accept);
  assert.deepEqual(Object.keys(result.params), ['threshold']);
  assert.deepEqual(result.removed, ['template']);
});

test('批量编辑显示多个值，验证所有节点后一次提交，一次撤销还原全部值', () => {
  const h = setup();
  const body = el('div'); h.controls.renderBatchParameters(body, h.nodes);
  const threshold = body.children.find((block) => block.children.some((item) => item.textContent === 'threshold'));
  assert.ok(threshold.children.some((item) => item.textContent.includes('多个值')));
  const input = threshold.children.find((item) => item.tag === 'input');
  const apply = threshold.children.find((item) => item.textContent.startsWith('应用到'));
  input.onChange('1.5'); apply.events.click();
  assert.deepEqual(h.nodes.map((node) => node.params.threshold), [.8,.9]);
  assert.equal(h.state.undo.length, 0);
  input.onChange('.7'); apply.events.click();
  assert.deepEqual(h.nodes.map((node) => node.params.threshold), [.7,.7]);
  assert.equal(h.links['a:threshold'], undefined);
  assert.equal(h.state.undo.length, 1);
  h.history.undo();
  assert.deepEqual(h.state.raw.nodes.map((node) => node.params.threshold), [.8,.9]);
  const timeout = body.children.find((block) => block.children.some((item) => item.textContent === 'timeout'));
  timeout.children.find((item) => item.textContent === '各自恢复默认值').events.click();
  assert.ok(h.nodes.every((node) => !('timeout' in node.params)));
});

test('详情栏镜像拿到完整多选集合', () => {
  const h = setup();
  const status = createEditorStatus({ state: h.state, vscode: {}, $: () => ({}) });
  assert.deepEqual(status.currentInspectorSelection(), { kind: 'nodes', nodeIds: ['a','b'] });
});
