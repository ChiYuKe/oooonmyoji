const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {RuntimeService} = require('../dist-electron/main/runtimeService.js');

function harness(t) {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-event-watcher-'));
  const runtime = new RuntimeService({resourceUrl: value => value});
  const events = [];
  runtime.on('runEvent', event => events.push(event));
  t.after(() => {
    runtime.stopWatching();
    fs.rmSync(root, {recursive: true, force: true});
  });
  const file = name => path.join(root, `${name}.jsonl`);
  const append = (target, stepId) => fs.appendFileSync(target, `${JSON.stringify({type: 'step', step_id: stepId})}\n`);
  return {runtime, events, file, append};
}

test('快速重启后，上一轮延迟收尾不能关闭新一轮的日志监听', t => {
  const h = harness(t);
  h.runtime.startWatching([{file: h.file('old'), instanceId: 'a'}]);
  h.runtime.finishWatching();
  t.mock.timers.tick(100);
  const next = h.file('next');
  h.runtime.startWatching([{file: next, instanceId: 'a'}]);
  // The new engine may not create its event file until after the old drain expires.
  t.mock.timers.tick(1500);
  h.append(next, 'first');
  t.mock.timers.tick(350);
  h.append(next, 'second');
  t.mock.timers.tick(350);
  assert.deepEqual(h.events.map(event => event.step_id), ['first', 'second']);
});

test('快速重启的并行运行持续接收各实例日志，并保持来源归属', t => {
  const h = harness(t);
  h.runtime.startWatching([{file: h.file('old'), instanceId: 'a'}]);
  h.runtime.finishWatching();
  const a = h.file('next-a'), b = h.file('next-b');
  h.runtime.startWatching([{file: a, instanceId: 'a'}, {file: b, instanceId: 'b'}]);
  h.append(a, 'a-before');
  h.append(b, 'b-before');
  t.mock.timers.tick(1500);
  h.append(a, 'a-after');
  h.append(b, 'b-after');
  t.mock.timers.tick(350);
  assert.deepEqual(h.events.map(event => [event.step_id, event.log_source, event.instance_id]), [
    ['a-before', 'a', 'a'], ['b-before', 'b', 'b'],
    ['a-after', 'a', 'a'], ['b-after', 'b', 'b'],
  ]);
});

test('正常结束仍补读尾部事件，收尾后停止监听', t => {
  const h = harness(t);
  const target = h.file('run');
  h.runtime.startWatching([{file: target, instanceId: 'a'}]);
  fs.writeFileSync(target, '{"type":"run_finished"');
  h.runtime.finishWatching();
  fs.appendFileSync(target, ',"status":"succeeded"}\n');
  t.mock.timers.tick(1400);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].type, 'run_finished');
  assert.equal(h.events[0].status, 'succeeded');
  assert.equal(h.runtime.watchTimer, undefined);
  h.append(target, 'late');
  t.mock.timers.tick(2000);
  assert.equal(h.events.length, 1);
});
