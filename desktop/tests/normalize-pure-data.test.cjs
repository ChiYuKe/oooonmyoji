const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRaw } = require('../dist-test-renderer/canvas/state/normalize.js');

test('normalize removes legacy execution edges into pure data nodes', () => {
  const raw = { nodes: [
    { id:'root', type:'root', children:['seq'] },
    { id:'seq', type:'sequence', children:['break','judge','task'] },
    { id:'break', type:'break', ref:{ref:'nodes.source.output'} },
    { id:'judge', type:'bool_judge', expression:{eq:[0,0]} },
    { id:'task', type:'task', action:'core.capture', params:{} },
  ], inputs:{}, variables:{} };
  const result = normalizeRaw(raw);
  assert.deepEqual(result.nodes.find((node) => node.id === 'seq').children, ['task']);
});
