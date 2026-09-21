// Run via npm test (builds the renderer test output first).
// 删除被引用的变量：不再只弹一句「不能删除」，而是把引用清单交给「变量引用」面板；
// 面板确认后的强制删除要把引用一并清掉，参数回落到动作默认值。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasReferences } = require('../dist-test-renderer/canvas/model/references.js');

const references = createCanvasReferences({
  state: {}, clone: (value) => JSON.parse(JSON.stringify(value)), nodes: () => [],
  definitionSchema: () => undefined, compatibleRefType: () => false, appendNestedRefs: () => {},
  variableSystem: {visible: () => true, referenceLabel: (ref) => ref}, catalogByName: () => null,
});

function element(tag, className = '', text = '') {
  return {
    tag, className, textContent: text, children: [], events: {}, dataset: {}, attrs: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(name, fn) { this.events[name] = fn; },
    setAttribute(name, value) { this.attrs[name] = value; },
    querySelector() { return null; },
  };
}

/** 变量详情的最小环境：只关心「删除」入口，其余控件给同形桩即可。 */
function harness(raw, {scope = 'inputs', name = '等待'} = {}) {
  const body = element('div');
  const posted = [];
  const toasts = [];
  let mutateCalls = 0;
  const state = {selectedVariable: name, selectedVariableScope: scope, raw};
  const variables = raw.variables || {};
  const VariableSystem = {
    expose() { return 'auto'; },
    label: (doc, variableScope, id) => doc?.[variableScope]?.[id]?.display_name || id,
    create: (doc, variableScope, displayName, definition, value) => {
      const id = 'v_new';
      const entry = JSON.parse(JSON.stringify(definition));
      entry.display_name = displayName;
      if (value !== undefined) entry.default = JSON.parse(JSON.stringify(value));
      doc[variableScope] = doc[variableScope] || {};
      doc[variableScope][id] = entry;
      return id;
    },
    rename: (doc, variableScope, id, name) => {
      const definition = doc?.[variableScope]?.[id];
      if (definition) definition.display_name = name;
    },
    references: (doc, variableScope, id) => {
      const found = [];
      const prefix = `${variableScope}.${id}`;
      const walk = (value, path) => {
        if (!value || typeof value !== 'object') return;
        if (typeof value.ref === 'string' && (value.ref === prefix || value.ref.startsWith(`${prefix}.`))) {
          found.push({nodeId: path.split('.')[1], path, ref: value.ref});
        }
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      };
      for (const node of doc.nodes || []) walk(node, `nodes.${node.id}`);
      for (const [key, definition] of Object.entries(doc.variables || {})) {
        if (definition.initial_from === id && variableScope === 'inputs') found.push({path: `variables.${key}.initial_from`, initializer: true});
      }
      return found;
    },
    containsBinding: (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof value.ref === 'string'),
  };
  const inspectors = require('../dist-test-renderer/canvas/inspector/variable-inspectors.js').createVariableInspectors({
    state, mutate: (fn) => { mutateCalls += 1; fn(); },
    // UI.button 要像真控件一样把 onClick 挂成 click 监听（真实实现就是这么连的）。
    UI: {
      button: (options) => {
        const node = element('button', options.className, options.label);
        node.addEventListener('click', options.onClick);
        return node;
      },
    },
    el: element, $: () => element('div'), nodeById: (id) => (raw.nodes || []).find((node) => node.id === id),
    clone: (value) => JSON.parse(JSON.stringify(value)), toast: (message, error) => toasts.push([message, Boolean(error)]),
    defaultValue: references.defaultValue, allRefs: () => [], referenceLabel: (ref) => ref,
    fieldLabel: (param) => param, disconnect: () => {},
    bindAssetPreview: () => {}, openAssetBrowser: () => {},
    variableCards: () => (raw._variableCards || (raw._variableCards = {})),
    variableLinks: () => (raw._variableLinks || (raw._variableLinks = {})),
    clearVariableCardSelection: () => {},
    vscode: {postMessage: (message) => posted.push(message)},
    VariableSystem,
    selectInput: (value) => Object.assign(element('select'), {value}),
    textInput: (value) => Object.assign(element('input'), {value}),
    checkbox: (checked) => Object.assign(element('input', 'ui-checkbox'), {checked}),
    field: (parent, label) => { const row = element('div', 'field', label); parent.appendChild(row); return row; },
    section: (parent, title) => parent.appendChild(element('h3', 'section-header', title)),
    clearInspector: () => body,
  });
  const all = (node) => [node, ...node.children.flatMap(all)];
  return {
    inspectors, state, posted, toasts, body,
    mutateCalls: () => mutateCalls,
    deleteButton: () => all(body).find((node) => node.className === 'variable-delete'),
  };
}

const withReferences = () => ({
  inputs: {等待: {type: 'number', default: 8}},
  variables: {计数: {type: 'number', default: 0, initial_from: '等待'}},
  nodes: [
    {id: 'tap', type: 'task', params: {timeout_seconds: {ref: 'inputs.等待'}}},
    {id: 'settle', type: 'task', params: {inputs: {秒数: {ref: 'inputs.等待'}}}},
    {id: 'run', type: 'task', runs: [{instance: 'mumu-0', inputs: {超时: {ref: 'inputs.等待'}}}]},
  ],
  _variableLinks: {'tap:timeout_seconds': 'card_1'},
  _variableCards: {card_1: {name: '等待', scope: 'inputs', x: 0, y: 0}},
});

test('被引用的变量：删除改为把引用清单交给「变量引用」面板', () => {
  const raw = withReferences();
  const h = harness(raw);

  h.inspectors.renderVariablesInspector();
  h.deleteButton().events.click();

  assert.equal(h.posted.length, 1);
  const message = h.posted[0];
  assert.equal(message.type, 'variableReferencesRequested');
  assert.equal(message.scope, 'inputs');
  assert.equal(message.name, '等待');
  assert.equal(message.entries.length, 4, '三处参数引用 + 一处变量初始化');
  const byNode = Object.fromEntries(message.entries.map((entry) => [entry.nodeId || 'initializer', entry]));
  assert.equal(byNode.tap.param, 'timeout_seconds');
  assert.equal(byNode.tap.label, '参数「timeout_seconds」');
  assert.equal(byNode.tap.linked, true, '画布上连出来的引用要标出来');
  assert.equal(byNode.settle.param, 'inputs.秒数');
  assert.equal(byNode.settle.linked, false);
  assert.equal(byNode.run.param, 'runs.0.inputs.超时');
  assert.equal(byNode.initializer.initializer, true);
  // 变量定义还在：真正删除要等面板确认。
  assert.equal(Object.prototype.hasOwnProperty.call(raw.inputs, '等待'), true);
  assert.deepEqual(h.toasts, []);
});

test('主动查看变量引用：有引用和无引用都会把实时清单交给面板', () => {
  const withRefs = harness(withReferences());
  withRefs.inspectors.showVariableReferences('inputs', '等待');
  assert.equal(withRefs.posted.length, 1);
  assert.equal(withRefs.posted[0].type, 'variableReferencesRequested');
  assert.equal(withRefs.posted[0].entries.length, 4);

  const withoutRefs = harness({inputs: {等待: {type: 'number'}}, variables: {}, nodes: []});
  withoutRefs.inspectors.showVariableReferences('inputs', '等待');
  assert.equal(withoutRefs.posted.length, 1, '空结果也要打开面板');
  assert.deepEqual(withoutRefs.posted[0].entries, []);
});

test('强制删除：普通参数、嵌套 inputs、实例子输入与变量初始化一并清掉', () => {
  const raw = withReferences();
  const h = harness(raw);

  h.inspectors.deleteVariable('inputs', '等待');

  const [tap, settle, run] = raw.nodes;
  assert.equal(Object.prototype.hasOwnProperty.call(tap.params, 'timeout_seconds'), false);
  assert.deepEqual(settle.params.inputs, {});
  assert.deepEqual(run.runs[0].inputs, {});
  assert.equal(raw.variables.计数.initial_from, undefined, '变量的初始化输入也要解除');
  assert.equal(Object.prototype.hasOwnProperty.call(raw.inputs, '等待'), false, '变量定义已删除');
  assert.deepEqual(raw._variableLinks, {}, '连线映射一并清掉');
  assert.deepEqual(raw._variableCards, {}, '同名变量卡片一并删除');
});

test('没有引用时：删除按钮直接删掉变量，不发消息', () => {
  const raw = {inputs: {等待: {type: 'number', default: 8}}, variables: {}, nodes: [], _variableLinks: {}, _variableCards: {}};
  const h = harness(raw);

  h.inspectors.renderVariablesInspector();
  h.deleteButton().events.click();

  assert.deepEqual(h.posted, [], '没有引用就没有必要开面板');
  assert.equal(Object.prototype.hasOwnProperty.call(raw.inputs, '等待'), false);
});

test('断开单条引用：参数回落、嵌套/实例输入与初始化各自解除，连线映射清理', () => {
  const raw = withReferences();
  const h = harness(raw);
  const [tap, settle, run] = raw.nodes;

  h.inspectors.disconnectVariableReference({nodeId: 'tap', param: 'timeout_seconds', ref: 'inputs.等待', linked: true});
  assert.equal(Object.prototype.hasOwnProperty.call(tap.params, 'timeout_seconds'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(raw._variableLinks, 'tap:timeout_seconds'), false, '连线映射一并清理');
  assert.match(h.toasts[0][0], /已断开参数 timeout_seconds/);

  h.inspectors.disconnectVariableReference({nodeId: 'run', param: 'runs.0.inputs.超时', ref: 'inputs.等待'});
  assert.deepEqual(run.runs[0].inputs, {}, '实例子输入引用解除');

  h.inspectors.disconnectVariableReference({initializer: true, ref: 'variables.计数.initial_from'});
  assert.equal(raw.variables.计数.initial_from, undefined, '初始化绑定解除');
  assert.match(h.toasts[2][0], /已解除初始化绑定/);

  // 变量定义与其余引用不受影响。
  assert.equal(Object.prototype.hasOwnProperty.call(raw.inputs, '等待'), true);
  assert.deepEqual(settle.params.inputs, {秒数: {ref: 'inputs.等待'}});
});

test('批量断开全部引用：一次清空所有引用与连线映射，保留变量定义', () => {
  const raw = withReferences();
  const h = harness(raw);
  const [tap, settle, run] = raw.nodes;

  const count = h.inspectors.disconnectAllVariableReferences('inputs', '等待');
  assert.equal(count, 4, '四类引用（普通/嵌套/实例/初始化）全部计入');
  assert.equal(Object.prototype.hasOwnProperty.call(tap.params, 'timeout_seconds'), false);
  assert.deepEqual(settle.params.inputs, {});
  assert.deepEqual(run.runs[0].inputs, {});
  assert.equal(raw.variables.计数.initial_from, undefined);
  assert.deepEqual(raw._variableLinks, {}, '连线映射全部清理');
  assert.equal(Object.prototype.hasOwnProperty.call(raw.inputs, '等待'), true, '变量定义保留，可继续使用');
  assert.equal(h.mutateCalls(), 1, '批量断开合并为一次历史记录，Ctrl+Z 可整体撤销');

  const none = harness({inputs: {等待: {type: 'number'}}, variables: {}, nodes: []});
  assert.equal(none.inspectors.disconnectAllVariableReferences('inputs', '等待'), 0, '没有引用时返回 0');
});

test('改名影响范围：有引用先弹确认（不真正改名），确认后改名，取消则保持原名', () => {
  const raw = withReferences();
  const h = harness(raw);

  h.inspectors.renameVariable('inputs', '等待', '新名');
  assert.equal(h.posted.length, 1, '有引用时要先亮影响范围');
  const message = h.posted[0];
  assert.equal(message.type, 'variableRenameImpactRequested');
  assert.equal(message.count, 4);
  assert.equal(message.entries.length, 4);
  assert.equal(raw.inputs.等待.display_name, undefined, '确认前不真正改名');

  h.inspectors.confirmPendingRename();
  assert.equal(raw.inputs.等待.display_name, '新名', '确认后应用新名字');

  const cancelled = harness(withReferences());
  cancelled.inspectors.renameVariable('inputs', '等待', '另一个名');
  assert.equal(cancelled.state.raw.inputs.等待.display_name, undefined, '确认前不真正改名');
  cancelled.inspectors.cancelPendingRename();
  assert.equal(cancelled.state.raw.inputs.等待.display_name, undefined, '取消后保持原名');
});

test('无引用的变量改名不弹确认，直接改名', () => {
  const raw = {inputs: {等待: {type: 'number'}}, variables: {}, nodes: []};
  const h = harness(raw);
  h.inspectors.renameVariable('inputs', '等待', '新名');
  assert.deepEqual(h.posted, [], '没有引用不需要确认');
  assert.equal(raw.inputs.等待.display_name, '新名');
});
