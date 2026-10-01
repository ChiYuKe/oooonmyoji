const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { WorkflowTestService } = require('../dist-electron/main/workflowTestService.js');
const { testProfileKey } = require('../dist-electron/shared/workflow-testing.js');

test('test cases have stable, short per-document persistence keys', () => {
  assert.equal(testProfileKey('workflow.owf'), testProfileKey('workflow.owf'));
  assert.notEqual(testProfileKey('a.owf'), testProfileKey('b.owf'));
  assert.ok(testProfileKey('长文件名'.repeat(100)).length < 160);
});

test('test service validates requests before spawning', () => {
  const service = new WorkflowTestService('.');
  assert.throws(() => service.start({ text: '', mode: 'live', rounds: 1 }), /工作流/);
  assert.throws(() => service.start({ text: 'workflow test', mode: 'invalid', rounds: 1 }), /模式/);
  assert.throws(() => service.start({ text: 'workflow test', mode: 'offline', rounds: 0 }), /重复次数/);
  assert.throws(() => service.command('delete'), /调试命令/);
});

test('test subprocess streams results, blocks overlapping runs and stops cooperatively', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
  child.stdin = new EventEmitter();
  const writes = [];
  child.stdin.write = (line) => {
    writes.push(JSON.parse(line));
    if (writes.at(-1).command === 'stop') queueMicrotask(() => {
      child.stdout.emit('data', JSON.stringify({type:'finished',report:'test-report.json',stopped:true})+'\n');
      child.emit('close',0);
    });
  };
  let argumentsUsed;
  const service = new WorkflowTestService('.', (...args) => {
    argumentsUsed = args;
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
  const events = [];
  service.on('event', (event) => events.push(event));
  try {
    const starting = service.start({ text: 'workflow test', mode: 'live', rounds: 1, nodeIds: ['task'] });
    service.command('pause');
    await starting;
    assert.equal(argumentsUsed[2].windowsHide,true);
    assert.deepEqual(writes[0].nodeIds,['task']);
    assert.equal(writes[1].command,'pause','commands are sent after the initial request even while spawning');
    child.stdout.emit('data','non-JSON warning\n{"type":"started","ent');
    child.stdout.emit('data','ries":["task"]}\n');
    assert.deepEqual(events[0].entries, ['task']);
    assert.throws(() => service.start({ text: 'workflow another', mode: 'live', rounds: 1 }), /正在运行/);
    await service.dispose();
    assert.equal(service.running, false);
    assert.equal(writes.at(-1).command,'stop');
    assert.ok(events.some((event) => event.type === 'finished' && event.stopped));
    assert.equal(events.at(-1).type, 'idle');
    assert.equal(service.reportPath,'test-report.json');
  } finally {
    await service.dispose();
  }
});
