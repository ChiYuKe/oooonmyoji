/**
 * 验收打包进来的解析器（`lib/graph-dsl.cjs`）：
 *
 * 1. `--check` 必须通过——产物与 `desktop/src/shared/workflow` 源码一致（改了源码没重建
 *    就会在这里红）；
 * 2. 仓库里**所有** `.owf` 文件都能解析，且 `emit(parse(text))` 是规范形式（再 emit 不变）；
 * 3. 跨语言契约夹具（`tests/fixtures/graph-rules/cases.json`）的 41 个用例，emit 结果与
 *    报错文案（含行列号）与桌面端预编译产物**逐字一致**——这是「不重复实现一套语法」的
 *    硬证据，也是这个插件唯一的正确性来源。
 *
 * 若 `desktop/dist-electron` 不存在（未构建桌面端），第 3 项自动跳过并在输出里说明。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const parser = require('../src/parser');
const { REPO_ROOT, CANONICAL_HEADLESS, allWorkflowFiles, contractCases } = require('./helpers/repo.cjs');

test('打包产物与 desktop/src/shared/workflow 源码一致（--check）', () => {
  const script = path.join(__dirname, '..', 'scripts', 'build-parser.mjs');
  // 直接跑构建脚本的 --check 模式；失败时把 stderr 带进断言信息，便于定位。
  try {
    execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe', encoding: 'utf8' });
  } catch (error) {
    assert.fail(`lib/graph-dsl.cjs 已过期，请运行 npm run build:parser\n${error.stdout || ''}${error.stderr || ''}`);
  }
});

test('仓库内所有 .owf 都能解析，且 emit 是规范形式', () => {
  const files = allWorkflowFiles();
  assert.ok(files.length >= 8, `至少应找到 8 个 .owf，实际 ${files.length}`);

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const result = parser.tryParse(text, file);
    assert.equal(result.ok, true, `${path.basename(file)} 应能解析：${result.ok ? '' : result.rendered}`);

    const emitted = parser.emitDocument(result.document);
    // 规范形式的不动点：emit 的产物再 round-trip 一次必须逐字不变。
    const again = parser.emitDocument(parser.parseDocument(emitted, file));
    assert.equal(again, emitted, `${path.basename(file)} 的 emit 产物不是不动点`);
    assert.ok(result.document.nodes.length > 0, `${path.basename(file)} 应至少有一个节点`);
  }
});

test('契约夹具的 emit 与报错文案与桌面端预编译产物逐字一致', (t) => {
  if (!fs.existsSync(CANONICAL_HEADLESS)) {
    t.skip('desktop/dist-electron 未构建，跳过与桌面端产物的逐字比对');
    return;
  }
  const canonical = require(CANONICAL_HEADLESS);
  const cases = contractCases();
  assert.ok(cases.length >= 40, `契约用例应不少于 40 个，实际 ${cases.length}`);

  for (const item of cases) {
    const mine = capture(() => parser.emitDocument(item.graph));
    const theirs = capture(() => canonical.emitDocument(item.graph));
    assert.equal(mine, theirs, `用例「${item.name}」的结果与桌面端不一致`);
  }
});

test('真实工作流的往返结果与桌面端预编译产物逐字一致', (t) => {
  if (!fs.existsSync(CANONICAL_HEADLESS)) {
    t.skip('desktop/dist-electron 未构建，跳过与桌面端产物的逐字比对');
    return;
  }
  const canonical = require(CANONICAL_HEADLESS);
  for (const file of allWorkflowFiles()) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const mine = capture(() => parser.emitDocument(parser.parseDocument(text, file)));
    const theirs = capture(() => canonical.emitDocument(canonical.parseDocument(text, file)));
    assert.equal(mine, theirs, `${path.basename(file)} 的往返结果与桌面端不一致`);
  }
});

test('解析失败时给出可用的行列定位与原文行', () => {
  // 缩进跳级是最典型的手写错误：第二行比父行深 4 格而不是 2 格。
  const broken = [
    'workflow demo',
    '  version: 5.0.0',
    '  resolution: [1920, 1080]',
    '  root: root',
    '  node root root',
    '      at: [0, 0]',
    '',
  ].join('\n');
  const result = parser.tryParse(broken, 'demo.owf');
  assert.equal(result.ok, false);
  assert.equal(result.line, 6, '应把错误定位到第 6 行');
  assert.ok(result.column >= 1, '应给出列号');
  assert.equal(result.source, '      at: [0, 0]', '应带回原文行');
  assert.match(result.rendered, /demo\.owf:6:\d+/, '渲染文本应含 文件:行:列');
  assert.match(result.rendered, /\^/, '渲染文本应画出插入符');
});

test('只读文档头就能拿到工作流 id', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'workflows', '多开御魂.owf'), 'utf8');
  assert.equal(parser.readDocumentId(text), 'two_souls');
  // 头行缺失时不应抛异常，只返回 null。
  assert.equal(parser.readDocumentId('node a task\n'), null);
});

/** 把「成功结果」或「错误渲染文本」统一成可比较的字符串。 */
function capture(fn) {
  try {
    return `OK:${fn()}`;
  } catch (error) {
    return `ERR:${typeof error.render === 'function' ? error.render() : error.message}`;
  }
}
