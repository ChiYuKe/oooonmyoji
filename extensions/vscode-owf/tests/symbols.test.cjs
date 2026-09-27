/**
 * 引脚推导、大纲与结构树的验收。
 *
 * 这一层的价值全在「不瞎猜」上：引脚名必须能从图文档里推导出来（参数名 + 该节点类型的
 * 特殊口），结构树必须以**编译器的顺序**展开（`then.<下标>` 排序）。所以测试的重点是
 * 这两条，而不是「函数被调用过」。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { installVscodeStub, documentOf } = require('./helpers/harness.cjs');
installVscodeStub();

const { modelFor } = require('../src/model');
const symbols = require('../src/symbols');
const structureTree = require('../src/features/structureTree');
const { readWorkflow } = require('./helpers/repo.cjs');

test('目标引脚包含 `in`、参数名与该节点类型的特殊口', () => {
  const condition = { id: 'c', type: 'condition', params: { threshold: 0.8 }, expression: {} };
  const pins = symbols.targetPinsOf(condition).map((pin) => pin.name);
  assert.ok(pins.includes('in'), '所有节点都有执行入参');
  assert.ok(pins.includes('threshold'), 'params 里的键都是可用引脚');
  assert.ok(pins.includes('condition'), 'condition 节点有 condition 口');

  const sequence = { id: 's', type: 'sequence', params: {} };
  assert.ok(symbols.targetPinsOf(sequence).map((pin) => pin.name).includes('then.0'));

  const switcher = { id: 'w', type: 'switch', params: {}, cases: [{ value: 'a' }, { value: 'b' }] };
  const switchPins = symbols.targetPinsOf(switcher).map((pin) => pin.name);
  assert.ok(switchPins.includes('case.0') && switchPins.includes('case.1'), 'switch 的每个分支都是一个口');
  assert.ok(switchPins.includes('default'));

  const decorated = { id: 'd', type: 'task', params: {}, decorators: [{ type: 'retry' }] };
  assert.ok(
    symbols.targetPinsOf(decorated).map((pin) => pin.name).includes('decorators.0.count'),
    '装饰器的参数口按 decorators.<i>.<键> 暴露',
  );
});

test('源引脚：判断口给 true/false，执行口给 then.0', () => {
  const condition = { id: 'c', type: 'condition', params: {} };
  const names = symbols.sourcePinsOf(condition).map((pin) => pin.name);
  assert.deepEqual(names.slice(0, 2), ['true', 'false']);
  assert.ok(names.includes('then.0'));

  const task = { id: 't', type: 'task', params: {} };
  assert.deepEqual(symbols.sourcePinsOf(task).map((pin) => pin.name), ['then.0']);
});

test('大纲按语义分组，节点组内保持文件顺序', () => {
  const text = readWorkflow('活动副本.owf');
  const model = modelFor(documentOf(text, 'E:/项目/workflows/活动副本.owf'));
  assert.equal(model.ok, true, '活动副本.owf 应解析成功');

  const roots = symbols.documentSymbols(model, { showVariables: true });
  assert.equal(roots.length, 1);
  const root = roots[0];
  assert.equal(root.name, 'activity_loop', '根符号名取自工作流头行');
  assert.equal(root.detail, '4.4.0', '详情取自 version');

  const groupNames = root.children.map((child) => child.name.replace(/（\d+）/, ''));
  assert.deepEqual(groupNames, ['节点', '变量', '文档块', '分组 / 注释', '连线']);

  const nodeGroup = root.children[0];
  const scanned = model.scan.nodes.map((node) => node.id);
  assert.deepEqual(nodeGroup.children.map((child) => child.name), scanned, '大纲节点顺序应与文件一致');
  assert.ok(nodeGroup.children.every((child) => child.range.start.line >= 0), '每个节点都应有行号');

  const edgeGroup = root.children[root.children.length - 1];
  assert.equal(edgeGroup.children.length, model.scan.edges.length, '连线组条目数应与边数一致');
});

test('关掉 showVariables 后只留节点与连线', () => {
  const text = readWorkflow('多开御魂.owf');
  const model = modelFor(documentOf(text, 'E:/项目/workflows/多开御魂.owf'));
  const roots = symbols.documentSymbols(model, { showVariables: false });
  assert.deepEqual(roots[0].children.map((child) => child.name.replace(/（\d+）/, '')), ['节点', '连线']);
});

test('模型缓存按版本失效，改一行就重算', () => {
  const first = documentOf('workflow a\n  version: 5.0.0\n', 'E:/项目/workflows/a.owf', 1);
  const modelA = modelFor(first);
  assert.equal(modelA.scan.nodes.length, 0);

  const second = documentOf('workflow a\n  version: 5.0.0\n  node root root\n', 'E:/项目/workflows/a.owf', 2);
  const modelB = modelFor(second);
  assert.equal(modelB.scan.nodes.length, 1, '版本变了应重新扫描');
  assert.notEqual(modelA, modelB);
  assert.equal(modelFor(second), modelB, '同一版本应命中缓存');
});

test('结构树按执行顺序展开，并按 then.<下标> 排序', () => {
  // 手写一份边表顺序被打乱的工作流：sequence 的两个子节点下标是 then.1 与 then.0，
  // 结构树必须按**下标**（编译器口径）而不是按文件顺序展开。
  const text = [
    'workflow order',
    '  version: 5.0.0',
    '  resolution: [1920, 1080]',
    '  root: root',
    '  node root sequence',
    '    at: [0, 0]',
    '  node second task "第二步"',
    '    at: [0, 100]',
    '  node first task "第一步"',
    '    at: [0, 200]',
    '  edges:',
    '    root:then.1 -> second',
    '    root:then.0 -> first',
    '',
  ].join('\n');

  const model = modelFor(documentOf(text, 'E:/项目/workflows/order.owf'));
  assert.equal(model.ok, true, model.ok ? '' : model.failure.message);
  const lines = structureTree.renderTree(model);
  const order = lines.map((line) => line.trim()).filter((line) => line.startsWith('first') || line.startsWith('second'));
  assert.deepEqual(
    order.map((line) => line.split(/\s+/)[0]),
    ['first', 'second'],
    '应按 then.0 → then.1 展开，而不是按文件顺序',
  );
});

test('结构树标出子工作流引用、装饰器与数据边', () => {
  const text = readWorkflow('多开御魂.owf');
  const model = modelFor(documentOf(text, 'E:/项目/workflows/多开御魂.owf'));
  const rendered = structureTree.renderTree(model).join('\n');

  assert.match(rendered, /\[instance_parallel\]/, '应标出节点类型');
  assert.match(rendered, /⇉ mumu-0/, '并行实例名应出现在描述里');
  assert.match(rendered, /\[root\]/, '根节点应有类型标注');
});

test('结构树遇到环不会无限展开', () => {
  const text = [
    'workflow cyc',
    '  version: 5.0.0',
    '  resolution: [1920, 1080]',
    '  root: a',
    '  node a sequence',
    '    at: [0, 0]',
    '  node b sequence',
    '    at: [0, 100]',
    '  edges:',
    '    a:then.0 -> b',
    '    b:then.0 -> a',
    '',
  ].join('\n');

  const model = modelFor(documentOf(text, 'E:/项目/workflows/cyc.owf'));
  const rendered = structureTree.renderTree(model).join('\n');
  assert.match(rendered, /已出现过，可能是环/, '应提示遇到环并停止展开');
});
