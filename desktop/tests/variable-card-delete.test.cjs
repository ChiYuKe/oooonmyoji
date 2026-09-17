const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = (value) => JSON.parse(JSON.stringify(value));

// 变量卡片删除属于画布数据操作，这里直接跑生产实现（编译模块）。
function harness(raw, literals) {
  const calls = { toasts: [], renders: 0 };
  const ctx = vm.createContext({ JSON, console });
  const state = { raw, paramLiteralCache: literals || {}, selectedVariableCardId: '', selectedVariableCardIds: vm.runInContext('new Set()', ctx) };
  ctx.state = state;
  ctx.clone = (value) => JSON.parse(JSON.stringify(value));
  ctx.mutate = (fn) => { fn(); calls.renders += 1; };
  ctx.toast = (message) => calls.toasts.push(message);
  ctx.nodeById = (id) => (Array.isArray(raw.nodes) ? raw.nodes : []).find((node) => node.id === id) || null;
  const model = require('../dist-test-renderer/canvas/model/workflow-model.js').createWorkflowModel(state);
  const vmSet = (values) => { ctx.__values = [...values]; return vm.runInContext('new Set(__values)', ctx); };
  ctx.variableCards = model.variableCards;
  ctx.variableLinks = model.variableLinks;
  // 切片函数在 vm 领域内做 `instanceof Set`，模型返回的 Set 需要转换回该领域。
  ctx.setVariableCardSelection = (ids) => {
    model.setVariableCardSelection(ids);
    if (state.selectedVariableCardIds instanceof Set) state.selectedVariableCardIds = vmSet(state.selectedVariableCardIds);
  };
  const controls = require('../dist-test-renderer/canvas/inspector/parameter-controls.js').createParameterControls({ state, clone: ctx.clone, UI: { ICON_SVG: {}, icon: () => null } });
  ctx.parameterLiteralCache = controls.parameterLiteralCache;
  ctx.parameterLiteralCacheKey = controls.parameterLiteralCacheKey;
  const commands = require('../dist-test-renderer/canvas/state/editor-commands.js').createEditorCommands({
    state, mutate: (fn) => ctx.mutate(fn), nodeById: (id) => ctx.nodeById(id), nodes: () => Array.isArray(raw.nodes) ? raw.nodes : [],
    layout: () => ({}), position: () => ({ x: 0, y: 0 }), clone: ctx.clone, toast: (message) => ctx.toast(message),
    variableCards: model.variableCards, variableLinks: model.variableLinks, nextVariableCardId: () => `card_${Math.random()}`,
    parameterLiteralCache: controls.parameterLiteralCache, parameterLiteralCacheKey: controls.parameterLiteralCacheKey,
    setVariableCardSelection: (ids) => ctx.setVariableCardSelection(ids), variableInputTargetAt: () => null,
    instanceRunCards: () => [], displayNameOfDefinition: (definition) => definition && definition.display_name || '',
    wrap: { clientWidth: 0, clientHeight: 0, getBoundingClientRect: () => ({ width: 0, height: 0 }) },
    variableCardWidth: 168, variableCardHeight: 58, variableCardPortY: 29, nodeWidth: 260, runCardWidth: 250,
  });
  ctx.releasePinBinding = commands.releasePinBinding;
  ctx.removeVariableCards = commands.removeVariableCards;
  ctx.removeVariableCard = commands.removeVariableCard;
  return {ctx, state, calls};
}
function documentWith(node, cards, links) {
  return { inputs: { 超时: { type: 'number' }, 阈值: { type: 'number' }, 模板: { type: 'string' } }, nodes: [node], _variableCards: cards, _variableLinks: links };
}

test('删除变量卡片会同时解除端口引用（画布连接优先）', () => {
  const node = { id: 'task_1', type: 'task', params: { 超时: { ref: 'inputs.超时' }, 阈值: 1 } };
  const raw = documentWith(node, { card_1: { name: '超时', scope: 'inputs', x: 0, y: 0 } }, { 'task_1:超时': 'card_1' });
  const h = harness(raw);
  h.ctx.removeVariableCard('card_1');
  assert.deepEqual(plain(raw._variableCards), {});
  assert.deepEqual(plain(raw._variableLinks), {});
  // 端口不再处于引用状态
  assert.equal(Object.prototype.hasOwnProperty.call(node.params, '超时'), false);
  assert.deepEqual(plain(node.params), { 阈值: 1 });
  assert.deepEqual(h.calls.toasts, ['已删除 1 个变量卡片，并解除 1 处端口引用']);
});

test('删除卡片时优先恢复绑定前缓存的字面量', () => {
  const node = { id: 'task_2', type: 'task', params: { 阈值: { ref: 'inputs.阈值' } } };
  const raw = documentWith(node, { card_2: { name: '阈值', scope: 'inputs', x: 0, y: 0 } }, { 'task_2:阈值': 'card_2' });
  const h = harness(raw, { 'task_2:阈值': 0.85 });
  h.ctx.removeVariableCard('card_2');
  assert.deepEqual(plain(node.params), { 阈值: 0.85 });
  assert.deepEqual(plain(h.state.paramLiteralCache), {});
});

test('同一变量还有别的卡片时保留绑定并把连线改指到存活卡片', () => {
  const node = { id: 'task_3', type: 'task', params: { 超时: { ref: 'inputs.超时' } } };
  const raw = documentWith(node, {
    card_1: { name: '超时', scope: 'inputs', x: 0, y: 0 },
    card_2: { name: '超时', scope: 'inputs', x: 200, y: 0 },
  }, { 'task_3:超时': 'card_1' });
  const h = harness(raw);
  h.ctx.removeVariableCard('card_1');
  assert.deepEqual(plain(raw._variableCards), { card_2: { name: '超时', scope: 'inputs', x: 200, y: 0 } });
  assert.equal(raw._variableLinks['task_3:超时'], 'card_2');
  assert.deepEqual(plain(node.params), { 超时: { ref: 'inputs.超时' } });
  assert.deepEqual(h.calls.toasts, ['已删除 1 个变量卡片']);
});

test('实例子输入的变量引用也会随卡片删除一起解除', () => {
  const node = { id: 'inst_1', type: 'instance_parallel', params: {}, runs: [{ inputs: { 模板: { ref: 'inputs.模板' } } }] };
  const raw = documentWith(node, { card_3: { name: '模板', scope: 'inputs', x: 0, y: 0 } }, { 'inst_1:runs.0.inputs.模板': 'card_3' });
  const h = harness(raw);
  h.ctx.removeVariableCard('card_3');
  assert.deepEqual(plain(node.runs[0].inputs), {});
  assert.deepEqual(plain(raw._variableLinks), {});
});

test('删除多张卡片只处理一次，未知卡片不产生副作用', () => {
  const node = { id: 'task_4', type: 'task', params: { 超时: { ref: 'inputs.超时' } } };
  const raw = documentWith(node, { card_4: { name: '超时', scope: 'inputs', x: 0, y: 0 } }, { 'task_4:超时': 'card_4' });
  const h = harness(raw);
  h.ctx.removeVariableCards(['card_4', 'card_4', 'card_missing']);
  assert.deepEqual(plain(raw._variableCards), {});
  assert.deepEqual(h.calls.toasts, ['已删除 1 个变量卡片，并解除 1 处端口引用']);
  h.calls.toasts.length = 0;
  h.ctx.removeVariableCards(['card_missing']);
  assert.deepEqual(h.calls.toasts, []);
  assert.equal(h.calls.renders, 1);
});

test('删除卡片后仍被选择的卡片会从选择里剔除', () => {
  const node = { id: 'task_5', type: 'task', params: {} };
  const raw = documentWith(node, { card_5: { name: '超时', scope: 'inputs', x: 0, y: 0 }, card_6: { name: '阈值', scope: 'inputs', x: 0, y: 30 } }, {});
  const h = harness(raw);
  h.ctx.setVariableCardSelection(['card_5', 'card_6']);
  assert.equal(h.state.selectedVariableCardIds.size, 2);
  h.ctx.removeVariableCard('card_5');
  assert.deepEqual(plain([...h.state.selectedVariableCardIds]), ['card_6']);
});

test('删除变量卡片走 releasePinBinding，端口引用不会残留', () => {
  const moduleSource = fs.readFileSync(path.join(__dirname, '../dist-test-renderer/canvas/state/editor-commands.js'), 'utf8');
  assert.match(moduleSource, /function removeVariableCards\(ids\) \{/);
  assert.match(moduleSource, /releasePinBinding\(item\.key\);/);
  assert.match(moduleSource, /variableLinks\(\)\[item\.key\] = survivor\.id;/);
  assert.match(moduleSource, /function releasePinBinding\(key\) \{/);
});
