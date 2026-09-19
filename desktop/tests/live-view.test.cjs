// Run via npm test (builds the electron output first).
// 实时视觉监视的主进程侧：观看请求门控 + 运行时快照读取。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  LIVE_VIEW_INDEX_FILE,
  LIVE_VIEW_REQUEST_FILE,
  LiveViewRequest,
  clampLiveViewInterval,
  createLiveViewEnvironment,
  readLiveViewFrame,
} = require('../dist-electron/main/liveView.js');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-live-view-'));
}

function writeSnapshot(directory, {instance = 'mumu-0', seq = 1, override = {}} = {}) {
  const meta = {
    seq,
    ts: 1700000000,
    instance_id: instance,
    step: {step_id: 'step_1', action: 'vision.wait_template', status: 'succeeded'},
    overlay: {
      rois: [{label: 'roi', box: [1, 2, 3, 4]}],
      matches: [{confidence: 0.91, box: [5, 6, 7, 8], template: 'assets/templates/a.png', threshold: 0.85}],
      ocr: [],
      clicks: [],
    },
    frame_width: 960,
    frame_height: 540,
    reference_width: 1920,
    reference_height: 1080,
    ...override,
  };
  fs.writeFileSync(path.join(directory, `live-${instance}.json`), JSON.stringify(meta));
  fs.writeFileSync(path.join(directory, `live-${instance}.jpg`), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(directory, LIVE_VIEW_INDEX_FILE), JSON.stringify({
    instances: {
      [instance]: {meta: `live-${instance}.json`, frame: `live-${instance}.jpg`},
    },
  }));
}

test('watching request writes a fresh marker and stop removes it', () => {
  const directory = temporaryDirectory();
  const request = new LiveViewRequest(directory);

  request.begin('mumu-0');
  const marker = JSON.parse(fs.readFileSync(path.join(directory, LIVE_VIEW_REQUEST_FILE), 'utf8'));
  assert.equal(marker.instance_id, 'mumu-0');
  assert.ok(Math.abs(Date.now() / 1000 - marker.ts) < 5, '时间戳应当是“现在”，否则运行时会判定没人看');
  assert.equal(request.isFresh(), true);

  request.stop();
  assert.equal(fs.existsSync(path.join(directory, LIVE_VIEW_REQUEST_FILE)), false);
  assert.equal(request.isFresh(), false);
  fs.rmSync(directory, {recursive: true, force: true});
});

test('readLiveViewFrame reports idle, frame and unchanged in order', () => {
  const directory = temporaryDirectory();

  const idle = readLiveViewFrame(directory, 'mumu-0', -1);
  assert.equal(idle.status, 'idle');
  assert.match(idle.message, /工作流/);

  writeSnapshot(directory, {seq: 7});
  const first = readLiveViewFrame(directory, 'mumu-0', -1);
  assert.equal(first.status, 'frame');
  assert.equal(first.frame.seq, 7);
  assert.equal(first.frame.image, Buffer.from([1, 2, 3]).toString('base64'));
  assert.equal(first.frame.step.action, 'vision.wait_template');
  assert.equal(first.frame.overlay.matches[0].confidence, 0.91);
  assert.equal(first.frame.reference_width, 1920);

  const repeated = readLiveViewFrame(directory, 'mumu-0', 7);
  assert.deepEqual(repeated, {status: 'unchanged', seq: 7});

  writeSnapshot(directory, {seq: 8});
  assert.equal(readLiveViewFrame(directory, 'mumu-0', 7).frame.seq, 8);
  fs.rmSync(directory, {recursive: true, force: true});
});

test('readLiveViewFrame uses the published index instead of guessing file names', () => {
  const directory = temporaryDirectory();
  // 运行时清洗后的文件名与实例 ID 不同：只能靠 index.json 找到。
  fs.writeFileSync(path.join(directory, 'live-mumu_0.json'), JSON.stringify({
    seq: 3,
    ts: 1,
    instance_id: 'mumu 0',
    step: {},
    overlay: {rois: [], matches: [], ocr: [], clicks: []},
    frame_width: 640,
    frame_height: 360,
    reference_width: 1920,
    reference_height: 1080,
  }));
  fs.writeFileSync(path.join(directory, 'live-mumu_0.jpg'), Buffer.from([9]));
  fs.writeFileSync(path.join(directory, LIVE_VIEW_INDEX_FILE), JSON.stringify({
    instances: {'mumu 0': {meta: 'live-mumu_0.json', frame: 'live-mumu_0.jpg'}},
  }));

  const result = readLiveViewFrame(directory, 'mumu 0', -1);
  assert.equal(result.status, 'frame');
  assert.equal(result.frame.seq, 3);
  assert.equal(result.frame.image, Buffer.from([9]).toString('base64'));
  fs.rmSync(directory, {recursive: true, force: true});
});

test('readLiveViewFrame stays idle while a snapshot is half written', () => {
  const directory = temporaryDirectory();
  writeSnapshot(directory, {seq: 5});
  fs.rmSync(path.join(directory, 'live-mumu-0.jpg'));

  const result = readLiveViewFrame(directory, 'mumu-0', -1);
  assert.equal(result.status, 'idle');
  fs.rmSync(directory, {recursive: true, force: true});
});

test('live view environment points the runtime at the snapshot directory', () => {
  const environment = createLiveViewEnvironment('C:/project/artifacts/live');

  assert.equal(environment.OOONMYOJI_LIVE_VIEW_DIR, 'C:/project/artifacts/live');
  assert.equal(environment.OOONMYOJI_LIVE_VIEW_INTERVAL_MS, '250');
  assert.equal(environment.OOONMYOJI_LIVE_VIEW_MAX_WIDTH, '960');
});

test('refresh rate is clamped and shipped to the runtime with the watch request', () => {
  const directory = temporaryDirectory();
  const request = new LiveViewRequest(directory);

  assert.equal(clampLiveViewInterval(1200), 1200);
  assert.equal(clampLiveViewInterval(5), 50, '低于运行时的下限会被夹住');
  assert.equal(clampLiveViewInterval(60000), 5000);
  assert.equal(clampLiveViewInterval('abc'), 250, '非法值退回默认档');

  request.begin('mumu-0');
  request.setInterval(1000);
  const marker = JSON.parse(fs.readFileSync(path.join(directory, LIVE_VIEW_REQUEST_FILE), 'utf8'));
  assert.equal(marker.interval_ms, 1000, '刷新率必须随观看请求下发，否则运行时不知道');
  assert.equal(request.interval, 1000);

  // 还没开始观看时也要记住档位，等真正运行时按它起步。
  request.stop();
  request.setInterval(150);
  assert.equal(request.interval, 150);
  assert.equal(fs.existsSync(path.join(directory, LIVE_VIEW_REQUEST_FILE)), false);

  // 环境变量用当前档位起步，避免第一帧用错节奏。
  assert.equal(createLiveViewEnvironment(directory, request.interval).OOONMYOJI_LIVE_VIEW_INTERVAL_MS, '150');
  fs.rmSync(directory, {recursive: true, force: true});
});
