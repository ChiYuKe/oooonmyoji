/**
 * 行级符号扫描的验收：扫描结果必须与解析结果**互相印证**，而不是自成一套。
 *
 * 关键不变量：对仓库里每一个 `.owf`，扫描出的节点 id 集合应当与解析器给出的
 * `document.nodes[].id` 集合完全一致（变量节点按派生 id 计）。这条不变量一旦成立，
 * 大纲/跳转/悬停就不会指到不存在的符号上。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scanner = require('../src/scanner');
const parser = require('../src/parser');
const { allWorkflowFiles, readFixture } = require('./helpers/repo.cjs');

test('扫描出的节点 id 与解析结果完全一致（含变量节点的派生 id）', () => {
  for (const file of allWorkflowFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const parsed = parser.parseDocument(text, file);
    const scanned = scanner.scan(text);

    const fromParser = new Set(parsed.nodes.map((node) => node.id));
    const fromScanner = new Set(scanned.nodes.map((node) => node.id));
    // 变量卡节点在解析结果里是 nodes 里的 `variable` 类型，扫描器把它们单列在 variables 里。
    for (const variable of scanned.variables) fromScanner.add(variable.id);

    assert.deepEqual(
      [...fromScanner].sort(),
      [...fromParser].sort(),
      `${path.basename(file)} 的扫描 id 与解析 id 不一致`,
    );
  }
});

test('扫描出的连线与解析结果的连线逐条对应', () => {
  for (const file of allWorkflowFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const parsed = parser.parseDocument(text, file);
    const scanned = scanner.scan(text);

    assert.equal(
      scanned.edges.length,
      parsed.edges.length,
      `${path.basename(file)} 的连线数量不一致：扫描 ${scanned.edges.length} / 解析 ${parsed.edges.length}`,
    );
    parsed.edges.forEach((edge, index) => {
      const hit = scanned.edges[index];
      assert.equal(hit.from, edge.from.node, `${path.basename(file)} 第 ${index} 条边的源不一致`);
      assert.equal(hit.fromPin, edge.from.pin, `${path.basename(file)} 第 ${index} 条边的源引脚不一致`);
      assert.equal(hit.to, edge.to.node, `${path.basename(file)} 第 ${index} 条边的目标不一致`);
      assert.equal(hit.toPin, edge.to.pin, `${path.basename(file)} 第 ${index} 条边的目标引脚不一致`);
    });
  }
});

test('注释、引号与 `|` 文本块不会污染扫描', () => {
  const text = [
    'workflow demo',
    '  version: 5.0.0',
    '  resolution: [1920, 1080]',
    '  root: root',
    '  # node fake_from_comment task 这是注释',
    '  description: "node fake_from_string task"',
    '  node root root 入口',
    '    at: [0, 0]',
    '  node real task',
    '    at: [100, 0]',
    '  edges:',
    '    root -> real',
    '',
  ].join('\n');

  const scanned = scanner.scan(text);
  assert.deepEqual(scanned.nodes.map((node) => node.id), ['root', 'real']);
  assert.equal(scanned.edges.length, 1);
  assert.equal(scanned.edges[0].from, 'root');
  assert.equal(scanned.edges[0].to, 'real');
});

test('变量节点按 `var <scope>.<key>` 派生 id，键里的点归键所有', () => {
  const scanned = scanner.scan([
    'workflow demo',
    '  var inputs.模板',
    '    at: [0, 0]',
    '  var variables.超时_秒.v2',
    '    at: [0, 100]',
    '',
  ].join('\n'));

  assert.deepEqual(scanned.variables.map((variable) => variable.id), [
    'var__inputs__模板',
    'var__variables__超时_秒.v2',
  ]);
  assert.equal(scanned.variables[1].name, '超时_秒.v2', '键里的点应保留在键里');
  assert.equal(scanned.byId.get('var__inputs__模板').scope, 'inputs');
});

test('分组、注释框与通用块条目都能被识别', () => {
  const scanned = scanner.scan(readFixture('kitchen.owf'));
  assert.ok(scanned.groups.length >= 1, 'kitchen.owf 应有节点组');
  assert.ok(scanned.containers.some((entry) => entry.key === 'inputs'), '应识别 inputs 块');
  // 空 `variables: {}` 在文本里写成 `{}`，扫描器按文档键处理而不是容器；
  // 变量节点（`var inputs.…`）单独收进 `scanned.variables`。
  assert.ok(scanned.variables.length >= 1, '应识别 var 变量节点');

  const inputs = scanned.containers.find((entry) => entry.key === 'inputs');
  assert.ok(inputs.entries.length >= 1, 'inputs 块内应有条目');
  assert.ok(inputs.entries.every((entry) => entry.line > 0), '条目应带行号');
});

test('引用只认裸词：引号内的 `nodes.x` 不算引用', () => {
  const text = [
    'workflow demo',
    '  node a condition',
    '    expression: nodes.b.output.state == challenge',
    '  node b task',
    '    params:',
    '      template: "nodes.c.output.x"',
    '',
  ].join('\n');

  const refs = scanner.findReferences(text);
  const texts = refs.map((hit) => hit.text);
  assert.ok(texts.includes('nodes.b.output.state'), '应识别裸词引用');
  assert.ok(!texts.includes('nodes.c.output.x'), '引号内的内容不应被当成引用');
});

test('引用带行号与列区间，可直接用于跳转', () => {
  const text = 'workflow demo\n  node a condition\n    expression: nodes.b.output.state == 1\n';
  const [hit] = scanner.findReferences(text);
  assert.equal(hit.line, 3);
  assert.equal(hit.scope, 'nodes');
  assert.equal(hit.name, 'b.output.state');
  const line = text.split('\n')[2];
  assert.equal(line.slice(hit.start, hit.end), 'nodes.b.output.state');
});
