const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const childProcess = require('node:child_process');
const {RuntimeService} = require('../dist-electron/main/runtimeService.js');

const text = `workflow test
  version: 5.0.0
  resolution: [1920, 1080]
  root: root
  node root root 入口
`;
const parallel = `${text}  node group instance_parallel 并行
    runs:
      - instance: a
        workflow: child.owf
      - instance: b
        workflow: child.owf
    wait_for: all
  edges:
    root -> group
`;

function harness(t, saveWorkflow = async () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-concurrency-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config/config.json'), '{}');
  const processes = [];
  t.mock.method(childProcess, 'spawn', (_command, args) => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.args = args;
    child.finish = (code = 0) => { child.exitCode = code; child.emit('close', code); };
    child.kill = () => child.finish(null);
    processes.push(child);
    return child;
  });
  const workerPrototype = Object.getPrototypeOf(RuntimeService.prototype);
  t.mock.method(workerPrototype, 'listInstances', async () => ['a', 'b', 'c'].map(id => ({id, displayName: id})));
  const runtime = new RuntimeService({
    projectRoot: root, workflowRoot: root, saveWorkflow,
    resolveWorkflowPath: uri => path.resolve(root, uri),
    workflowReference: uri => path.relative(root, uri), resourceUrl: value => value,
  });
  const states = [], events = [];
  runtime.on('state', event => states.push(event));
  runtime.on('runEvent', event => events.push(event));
  t.after(async () => {
    for (const child of processes) if (child.exitCode === null) child.finish();
    await runtime.dispose();
    // Allow the existing tail-drain listeners to complete before removing their files.
    for (const session of workers) session.stopWatching();
    fs.rmSync(root, {recursive: true, force: true});
  });
  const workers = [];
  const run = async (instanceId, extra = {}) => {
    await runtime.runWorkflow({uri: 'test.owf', instanceId, text, ...extra});
    for (const worker of runtime.sessions.keys()) if (!workers.includes(worker)) workers.push(worker);
  };
  return {runtime, processes, states, events, run, workers};
}

test('different instances run concurrently; duplicate instance is rejected without losing logs', async t => {
  const h = harness(t);
  await h.run('a');
  await h.run('b');
  assert.equal(h.processes.length, 2);
  assert.equal(h.runtime.running, true);
  assert.equal(h.states.at(-1).continuing, true);
  assert.equal(h.states.at(-1).sources.length, 2);
  await assert.rejects(h.run('a'), /实例正在运行工作流：a/);
  assert.equal(h.processes.length, 2);
  assert.notEqual(h.processes[0].args.at(-1), h.processes[1].args.at(-1));
  h.processes[0].finish();
  assert.equal(h.runtime.running, true);
  assert.equal(h.states.at(-1).state, 'running');
  h.processes[1].finish();
  assert.equal(h.runtime.running, false);
});

test('reservation blocks double clicks while the first launch is still saving', async t => {
  let release;
  const h = harness(t, () => new Promise(resolve => { release = resolve; }));
  const pending = h.run('a');
  await assert.rejects(h.run('a'), /实例正在运行/);
  release();
  await pending;
  assert.equal(h.processes.length, 1);
});

test('finished parallel child can run independently while its sibling keeps running', async t => {
  const h = harness(t);
  await h.run('a', {text: parallel});
  await assert.rejects(h.run('b'), /实例正在运行/);
  const worker = h.workers[0];
  const files = [...worker.watchedFiles.entries()];
  const [aFile] = files.find(([, watch]) => watch.instanceId === 'a');
  fs.writeFileSync(aFile, '{"type":"run_finished","status":"succeeded"}\n');
  worker.tickWatcher();
  await h.run('a', {text: parallel, instanceRunIndex: 0});
  assert.equal(h.processes.length, 2);
  assert.equal(h.processes[1].args.includes('child.owf'), true);
  assert.equal(h.states.at(-1).sources.length, 3);
  const ids = h.states.at(-1).sources.map(source => source.id);
  assert.equal(new Set(ids).size, 3);
  assert.equal(h.events[0].log_source, ids[0]);
  await assert.rejects(h.run('b'), /实例正在运行/);
  fs.appendFileSync(aFile, '{"type":"step","step_id":"tail"}\n');
  worker.tickWatcher();
  assert.equal(h.events.at(-1).log_source, ids[0]);
});

test('stop cancels every active process and also pending starts', async t => {
  const h = harness(t);
  await h.run('a');
  await h.run('b');
  await h.runtime.stopWorkflow();
  assert.equal(h.runtime.running, false);
  assert.equal(h.states.at(-1).state, 'idle');

  let release;
  const pending = harness(t, () => new Promise(resolve => { release = resolve; }));
  const launch = pending.run('a');
  await pending.runtime.stopWorkflow();
  release();
  await launch;
  assert.equal(pending.processes.length, 0);
  assert.equal(pending.runtime.running, false);
});

test('failed preparation releases its reservation so the user can try again', async t => {
  let fail = true;
  const h = harness(t, async () => { if (fail) throw new Error('save failed'); });
  await assert.rejects(h.run('a'), /save failed/);
  assert.equal(h.runtime.running, false);
  fail = false;
  await h.run('a');
  assert.equal(h.processes.length, 1);
});

test('failed parallel children stay reserved for supervisor retries', async t => {
  const h = harness(t);
  await h.run('a', {text: parallel});
  const worker = h.workers[0];
  const [file] = [...worker.watchedFiles.entries()].find(([, watch]) => watch.instanceId === 'a');
  fs.writeFileSync(file, '{"type":"run_finished","status":"failed"}\n');
  worker.tickWatcher();
  await assert.rejects(h.run('a'), /实例正在运行/);
  await h.run('c');
  assert.equal(h.processes.length, 2);
});
