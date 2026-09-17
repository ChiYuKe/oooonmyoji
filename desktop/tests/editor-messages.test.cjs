// Run via npm test (builds the desktop output first).
// 编辑器消息契约：边界校验只放行带已知 type 的对象消息。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { parseEditorMessage, EDITOR_MESSAGE_TYPES } = require('../dist-electron/shared/editor-messages.js');

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
