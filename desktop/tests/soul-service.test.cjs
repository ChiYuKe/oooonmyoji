const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { SoulService } = require('../dist-electron/main/soulService.js');

function service() {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let launch;
  const value = new SoulService(process.cwd(), (...args) => { launch = args; return child; });
  const event = e => child.stdout.write(JSON.stringify(e) + '\n');
  return { value, child, event, launch: () => launch };
}

test('launches the requested instance and waits for process cleanup before releasing the lock', async () => {
  const { value, child, event, launch } = service(); const events = []; value.on('progress', e => events.push(e));
  const pending = value.fetch('mumu-2');
  assert.ok(launch()[1].includes('mumu-2')); assert.equal(launch()[2].windowsHide, true);
  assert.throws(() => value.fetch('mumu-3'), /正在获取/);
  event({ type: 'progress', instanceId: 'mumu-3', message: 'wrong' });
  event({ type: 'progress', instanceId: 'mumu-2', message: 'reading' });
  event({ type: 'result', result: { instanceId: 'mumu-2', souls: [], total: 0, failed: 0 } });
  assert.equal(value.running, true); child.emit('close', 0);
  assert.equal((await pending).instanceId, 'mumu-2'); assert.equal(value.running, false); assert.equal(events.length, 1);
});

test('cancellation targets only the active instance and waits for its completion', async () => {
  const { value, child, event } = service(); let commands = ''; child.stdin.on('data', data => commands += data);
  const pending = value.fetch('one'); await value.cancel('two'); assert.equal(commands, '');
  const stopping = value.dispose(); assert.equal(commands, 'cancel\n'); assert.equal(value.running, true);
  event({ type: 'cancelled' }); child.emit('close', 0); assert.equal(await pending, null); await stopping;
});

test('rejects malformed or foreign instance data instead of displaying it', async () => {
  const { value, child, event } = service(); const pending = value.fetch('one');
  event({ type: 'result', result: { instanceId: 'two', souls: [], total: 0, failed: 0 } }); child.emit('close', 0);
  await assert.rejects(pending, /不一致/);
});
