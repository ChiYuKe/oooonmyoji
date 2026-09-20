// Run via npm test (builds the desktop output first).
// 编辑器消息契约：边界校验只放行带已知 type 的对象消息。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { parseEditorMessage, EDITOR_MESSAGE_TYPES, parseCanvasClipboard } = require('../dist-electron/shared/editor-messages.js');

test('已知 type 的消息按联合类型放行', () => {
  for (const type of EDITOR_MESSAGE_TYPES) {
    const message = parseEditorMessage({ type });
    assert.ok(message, type);
    assert.equal(message.type, type);
  }
});

test('未知或畸形的消息被边界拒绝', () => {
  assert.equal(parseEditorMessage(undefined), undefined);
  assert.equal(parseEditorMessage(null), undefined);
  assert.equal(parseEditorMessage('ready'), undefined);
  assert.equal(parseEditorMessage([]), undefined);
  assert.equal(parseEditorMessage({}), undefined);
  assert.equal(parseEditorMessage({ type: '' }), undefined);
  assert.equal(parseEditorMessage({ type: 'unknownMessage' }), undefined);
  assert.equal(parseEditorMessage({ type: 7 }), undefined);
});

test('载荷字段保持原始值，由处理方按需收窄', () => {
  const message = parseEditorMessage({ type: 'documentStateChanged', text: 'body', dirty: false });
  assert.equal(message.text, 'body');
  assert.equal(message.dirty, false);
});

test('画布剪贴板边界：版本与节点数组必需，缺字段补齐、非法条目丢掉', () => {
  assert.equal(parseCanvasClipboard(undefined), undefined);
  assert.equal(parseCanvasClipboard(null), undefined);
  assert.equal(parseCanvasClipboard('clipboard'), undefined);
  assert.equal(parseCanvasClipboard({version: 2, nodes: [{id: 'a'}]}), undefined, '结构版本不认识就不认这份剪贴板');
  assert.equal(parseCanvasClipboard({version: 1, nodes: []}), undefined, '没有节点等于空剪贴板');
  assert.equal(parseCanvasClipboard({version: 1}), undefined);

  const parsed = parseCanvasClipboard({
    version: 1,
    sourceUri: 'file:///w/a.json',
    nodes: [{id: 'a'}, {id: 'b'}],
    layout: {a: {x: 1, y: 2}},
    variables: [
      {scope: 'inputs', name: '运行轮次', definition: {type: 'integer'}},
      {scope: 'nope', name: 'x', definition: {}},
      {scope: 'variables', name: '', definition: {}},
      'junk',
    ],
    cards: [{scope: 'inputs', name: '运行轮次', x: 10, y: 20}, {scope: 'inputs', name: '', x: 0, y: 0}],
  });
  assert.equal(parsed.version, 1);
  assert.equal(parsed.sourceUri, 'file:///w/a.json');
  assert.equal(parsed.nodes.length, 2);
  assert.deepEqual(parsed.layout, {a: {x: 1, y: 2}});
  assert.deepEqual(parsed.variables, [{scope: 'inputs', name: '运行轮次', definition: {type: 'integer'}}]);
  assert.deepEqual(parsed.cards, [{scope: 'inputs', name: '运行轮次', x: 10, y: 20}], '名字为空/坐标非数字的卡片丢掉');

  // 缺 layout / sourceUri / 变量时补成空集合，画布不用自己兜底。
  const minimal = parseCanvasClipboard({version: 1, nodes: [{id: 'a'}]});
  assert.equal(minimal.sourceUri, '');
  assert.deepEqual(minimal.layout, {});
  assert.deepEqual(minimal.variables, []);
  assert.deepEqual(minimal.cards, []);
});
