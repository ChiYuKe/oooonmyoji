/**
 * 编辑器侧行为的验收：把 `vscode` 替身里记录下来的提供器**当成宿主直接调用**，
 * 断言返回内容的正确性（而不是只断言「注册过」）。
 *
 * 覆盖两条最容易出错、也最有价值的路径：
 * - 边表里的节点 id 是否真的能跳回声明行；
 * - `节点:引脚` 的补全是否只给出「推得出来」的引脚（列出不存在的引脚比不补全更糟）。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const stub = require('./helpers/harness.cjs').installVscodeStub();
const { documentOf } = require('./helpers/harness.cjs');

const navigation = require('../src/features/navigation');
const completions = require('../src/features/completions');
const diagnostics = require('../src/features/diagnostics');
const structureTree = require('../src/features/structureTree');
const extension = require('../src/extension');

/** 激活一次扩展，让所有提供器都注册到替身上。 */
function activateOnce() {
  extension.activate({ subscriptions: [] });
}

const SAMPLE = [
  'workflow demo',                        // 1
  '  version: 5.0.0',                     // 2
  '  resolution: [1920, 1080]',           // 3
  '  root: root',                         // 4
  '  node root sequence',                 // 5
  '    at: [0, 0]',                       // 6
  '  node judge condition "判断"',         // 7
  '    at: [0, 100]',                     // 8
  '    expression: nodes.wait.output.state == challenge', // 9
  '  node wait task',                     // 10
  '    at: [0, 200]',                     // 11
  '  node tap task "点一下"',              // 12
  '    at: [0, 300]',                     // 13
  '  edges:',                             // 14
  '    root:then.0 -> judge',             // 15
  '    judge:true -> tap',                // 16
  '    wait:out.state -> judge:condition', // 17
  '',                                     // 18
].join('\n');

test('边表里的节点 id 能跳到 `node …` 声明行', async () => {
  activateOnce();
  const document = documentOf(SAMPLE, 'E:/项目/workflows/demo.owf');

  // 第 15 行 `    root:then.0 -> judge`：`judge` 从第 19 列（0 基）起。
  const edgeLine = SAMPLE.split('\n')[14];
  const column = edgeLine.indexOf('judge') + 2;
  assert.equal(edgeLine.slice(column - 2, column + 3), 'judge', '前置断言：列号要落在 judge 上');

  const target = await stub.languages.registered.definition.provideDefinition(
    document,
    new stub.Position(14, column),
  );
  assert.equal(target.length, 1, '应给出一个定义位置');
  assert.equal(target[0].range.start.line, 6, 'judge 在第 7 行（0 基 6）声明');
});

test('`nodes.<id>` 引用能跳到节点声明', async () => {
  activateOnce();
  const document = documentOf(SAMPLE, 'E:/项目/workflows/demo.owf');
  // 第 9 行 `expression: nodes.wait.output.state == challenge` 里的 wait 名字段
  const column = SAMPLE.split('\n')[8].indexOf('wait') + 1;
  const target = await stub.languages.registered.definition.provideDefinition(
    document,
    new stub.Position(8, column),
  );
  assert.equal(target.length, 1);
  assert.equal(target[0].range.start.line, 9, 'wait 在第 10 行（0 基 9）声明');
});

test('悬停在节点 id 上给出类型、显示名与连线度数', async () => {
  activateOnce();
  const document = documentOf(SAMPLE, 'E:/项目/workflows/demo.owf');
  const edgeLine = SAMPLE.split('\n')[14];
  const hover = await stub.languages.registered.hover.provideHover(
    document,
    new stub.Position(14, edgeLine.indexOf('judge') + 2),
  );
  assert.ok(hover, '边表里的节点 id 应有悬停');
  const text = hover.contents.value;
  assert.match(text, /节点/);
  assert.match(text, /condition/, '应写出节点类型');
  assert.match(text, /判断/, '应写出显示名');
  assert.match(text, /入 2 \/ 出 1/, '应统计出入度（judge 有 2 条入边、1 条出边）');
});

test('悬停在引脚上说明它是哪种口', async () => {
  activateOnce();
  const document = documentOf(SAMPLE, 'E:/项目/workflows/demo.owf');
  // 第 17 行 `wait:out.state -> judge:condition` 里的 `condition`
  const line = SAMPLE.split('\n')[16];
  const hover = await stub.languages.registered.hover.provideHover(
    document,
    new stub.Position(16, line.indexOf('condition') + 2),
  );
  assert.ok(hover, '引脚上应有悬停');
  assert.match(hover.contents.value, /condition/, '应给出引脚名');
});

test('边表源引脚补全给出 true/false，目标引脚补全给出参数名', async () => {
  activateOnce();
  // 源引脚：第 16 行 `    judge:true -> tap`，光标停在 `judge:` 之后（第 10 列）
  const sourceLine = SAMPLE.split('\n')[15];
  const sourceColon = sourceLine.indexOf('judge:') + 'judge:'.length;
  assert.ok(
    sourceColon < sourceLine.indexOf('->'),
    '前置断言：光标要在 `->` 左边，否则会被当成目标引脚',
  );
  const sourceDoc = documentOf(SAMPLE, 'E:/项目/workflows/demo.owf');
  const sourceItems = await stub.languages.registered.completion.provideCompletionItems(
    sourceDoc,
    new stub.Position(15, sourceColon),
  );
  const sourceLabels = sourceItems.map((item) => item.label);
  assert.ok(sourceLabels.includes('true') && sourceLabels.includes('false'), `condition 节点应有 true/false，实际 ${sourceLabels}`);

  // 目标引脚：第 17 行 `    wait:out.state -> judge:condition`，光标停在行尾
  const targetDoc = documentOf(SAMPLE, 'E:/项目/workflows/demo.owf');
  const targetLine = SAMPLE.split('\n')[16];
  const targetItems = await stub.languages.registered.completion.provideCompletionItems(
    targetDoc,
    new stub.Position(16, targetLine.length),
  );
  const targetLabels = targetItems.map((item) => item.label);
  assert.ok(targetLabels.includes('condition'), `judge 的 condition 口应被补全，实际 ${targetLabels}`);
  assert.ok(targetLabels.includes('in'), '执行入参 in 应被补全');
});

test('`->` 之后补全节点 id', async () => {
  activateOnce();
  const document = documentOf(SAMPLE, 'E:/项目/workflows/demo.owf');
  const items = await stub.languages.registered.completion.provideCompletionItems(
    document,
    new stub.Position(14, '    root:then.0 -> '.length),
  );
  const labels = items.map((item) => item.label);
  assert.ok(labels.includes('judge') && labels.includes('tap') && labels.includes('wait'));
});

test('行首补全结构关键字，节点块内补全字段名', async () => {
  activateOnce();
  const document = documentOf(SAMPLE, 'E:/项目/workflows/demo.owf');
  const top = await stub.languages.registered.completion.provideCompletionItems(document, new stub.Position(12, 0));
  assert.ok(top.map((item) => item.label).includes('node'), '顶格应能补 node');

  const doc2 = documentOf(SAMPLE, 'E:/项目/workflows/demo.owf');
  const inside = await stub.languages.registered.completion.provideCompletionItems(doc2, new stub.Position(12, 4));
  assert.ok(inside.map((item) => item.label).includes('params'), '节点块内应能补 params');
});

test('注册的文档大纲提供器返回我们构造的分组结构', async () => {
  activateOnce();
  const document = documentOf(SAMPLE, 'E:/项目/workflows/demo.owf');
  const symbols = await stub.languages.registered.documentSymbol.provideDocumentSymbols(document);
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].name, 'demo');
  assert.ok(symbols[0].children.some((child) => child.name.startsWith('节点')));
});

test('激活扩展会注册全部提供器（不抛异常）', () => {
  const context = { subscriptions: [] };
  assert.doesNotThrow(() => {
    extension.activate(context);
    diagnostics.register(context);
    structureTree.register(context);
    navigation.register(context);
    completions.register(context);
  });
  assert.ok(context.subscriptions.length >= 3, '订阅应挂到 context 上以便反激活时释放');
  assert.doesNotThrow(() => extension.deactivate());
});
