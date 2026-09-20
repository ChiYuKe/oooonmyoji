const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createCanvasState} = require('../dist-test-renderer/canvas/state/canvas-state.js');
const {createRunEvents} = require('../dist-test-renderer/canvas/state/run-events.js');

function harness(nodes = []) {
  const state = createCanvasState();
  state.raw = {id: 'main', nodes};
  state.instanceId = 'device-1';
  const patched = [];
  const renders = [];
  const events = createRunEvents({
    state,
    nodes: () => nodes,
    nodeById: id => nodes.find(node => node.id === id) || null,
    clone: value => JSON.parse(JSON.stringify(value)),
    render: flags => renders.push(flags),
    patchRunEdgeStates: id => { patched.push(id); return 1; },
    deleteSelection() {},
    removeVariableCards() {},
    removeVariableCard() {},
    removeInstanceRun() {},
    removeVariable() {},
  });
  return {state, patched, renders, events};
}

test('步骤事件立即刷新对应入边，并只请求轻量运行态重绘', () => {
  const h = harness();
  h.events.handleRunEvent({
    type: 'step', step_id: 'task-1', instance_id: 'device-1',
    step: {workflow_id: 'main', status: 'running'},
  });
  assert.equal(h.state.run.get('task-1').status, 'running');
  assert.deepEqual(h.patched, ['task-1']);
  assert.deepEqual(h.renders, [{selection: true, panels: true}]);
});

test('新一轮运行清空全部旧连线状态', () => {
  const h = harness();
  h.state.run.set('old-task', {status: 'succeeded'});
  h.events.handleRunEvent({type: 'run_started', instance_id: 'device-1'});
  assert.equal(h.state.run.size, 0);
  assert.deepEqual(h.patched, [undefined]);
});

test('循环进入当前节点时清掉尚未轮到的后续子树，保留本轮已执行节点', () => {
  const h = harness([
    {id: 'root', children: ['sequence']},
    {id: 'sequence', children: ['before', 'current', 'later']},
    {id: 'before', children: []},
    {id: 'current', children: []},
    {id: 'later', children: ['later-child']},
    {id: 'later-child', children: []},
  ]);
  h.state.run.set('before', {status: 'succeeded'});
  h.state.run.set('current', {status: 'succeeded'});
  h.state.run.set('later', {status: 'succeeded'});
  h.state.run.set('later-child', {status: 'succeeded'});

  h.events.handleRunEvent({
    type: 'step', step_id: 'current', instance_id: 'device-1',
    step: {workflow_id: 'main', status: 'running'},
  });

  assert.equal(h.state.run.get('before').status, 'succeeded', '本轮已经执行的前置节点保留绿色');
  assert.equal(h.state.run.get('current').status, 'running');
  assert.equal(h.state.run.has('later'), false);
  assert.equal(h.state.run.has('later-child'), false);
  assert.deepEqual(h.patched, [undefined], '批量清理时一次刷新全部已挂载连线');
});

test('组合节点重新运行时清掉内部上一轮状态', () => {
  const h = harness([
    {id: 'loop-body', children: ['first', 'second']},
    {id: 'first', children: []},
    {id: 'second', children: []},
  ]);
  h.state.run.set('first', {status: 'succeeded'});
  h.state.run.set('second', {status: 'failed'});
  h.events.handleRunEvent({
    type: 'step', step_id: 'loop-body', instance_id: 'device-1',
    step: {workflow_id: 'main', status: 'running'},
  });
  assert.equal(h.state.run.has('first'), false);
  assert.equal(h.state.run.has('second'), false);
  assert.equal(h.state.run.get('loop-body').status, 'running');
});
