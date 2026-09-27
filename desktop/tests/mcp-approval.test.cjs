// Run via npm test (builds the electron output first).
// MCP 审批通道的主进程侧：心跳、请求轮询、答复写回与过期处理。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MCP_APPROVAL_HEARTBEAT_FILE,
  MCP_APPROVAL_PENDING_DIRNAME,
  McpApprovalBridge,
  parseApprovalRequest,
} = require('../dist-electron/main/mcpApproval.js');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-mcp-approval-'));
}

function writeRequest(directory, id, dialog) {
  const pending = path.join(directory, MCP_APPROVAL_PENDING_DIRNAME);
  fs.mkdirSync(pending, {recursive: true});
  const file = path.join(pending, `${id}.request.json`);
  fs.writeFileSync(file, `${JSON.stringify({request_id: id, dialog})}\n`, 'utf8');
  return file;
}

function readResult(directory, id) {
  const file = path.join(directory, MCP_APPROVAL_PENDING_DIRNAME, `${id}.result.json`);
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function waitFor(check, message, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

function makeBridge(directory, decision) {
  const seen = [];
  const bridge = new McpApprovalBridge({
    directory,
    ask: async (request) => {
      seen.push(request);
      return decision;
    },
  });
  return {bridge, seen};
}

const DIALOG = {
  title: 'MCP 操作确认 · 执行设备操作',
  summary: '执行 Action input.tap：点击 (960, 540)',
  items: [{label: '影响', detail: '批准后会向模拟器发送真实输入事件。'}],
  preview: '{\n  "x": 960\n}',
  confirmLabel: '允许一次',
  cancelLabel: '拒绝',
  extraLabel: '本会话都允许此类',
  danger: true,
};

test('心跳文件在启动后立刻新鲜，停止后删除', async (t) => {
  const directory = temporaryDirectory();
  const {bridge} = makeBridge(directory, 'deny');
  t.after(() => bridge.stop());

  assert.equal(fs.existsSync(bridge.heartbeatFile), false);
  bridge.start();

  const heartbeat = path.join(directory, MCP_APPROVAL_HEARTBEAT_FILE);
  assert.equal(fs.existsSync(heartbeat), true);
  const payload = JSON.parse(fs.readFileSync(heartbeat, 'utf8'));
  assert.equal(typeof payload.ts, 'number');
  assert.ok(Math.abs(Date.now() / 1000 - payload.ts) < 5, '心跳时间戳应当是当前时间');

  bridge.stop();
  assert.equal(fs.existsSync(heartbeat), false);
});

test('应用把请求交给弹窗后写回答复，并清掉请求文件', async (t) => {
  const directory = temporaryDirectory();
  const {bridge, seen} = makeBridge(directory, 'allow_session');
  t.after(() => bridge.stop());
  bridge.start();

  const requestFile = writeRequest(directory, 'abc123', DIALOG);
  const request = await waitFor(() => seen[0], '桥接没有把请求交给弹窗');
  const result = await waitFor(() => readResult(directory, 'abc123'), '没有写回答复');

  assert.equal(request.id, 'abc123');
  assert.equal(request.dialog.title, DIALOG.title);
  assert.equal(request.dialog.danger, true);
  assert.deepEqual(request.dialog.items, DIALOG.items);
  assert.equal(result.decision, 'allow_session');
  assert.equal(typeof result.decided_at, 'string');
  // 请求文件必须删掉，否则 Python 侧会重复提问。
  assert.equal(fs.existsSync(requestFile), false);
});

test('同一个请求只提问一次', async (t) => {
  const directory = temporaryDirectory();
  const {bridge, seen} = makeBridge(directory, 'allow');
  t.after(() => bridge.stop());
  bridge.start();

  writeRequest(directory, 'once1', DIALOG);
  await waitFor(() => readResult(directory, 'once1'), '第一次没有写回答复');
  // 文件又冒出来（模拟重复投递）也不该再弹一次窗。
  writeRequest(directory, 'once1', DIALOG);
  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.equal(seen.length, 1);
});

test('过期请求直接拒绝，不打扰用户', async (t) => {
  const directory = temporaryDirectory();
  const {bridge, seen} = makeBridge(directory, 'allow');
  t.after(() => bridge.stop());
  bridge.start();

  const file = writeRequest(directory, 'stale1', DIALOG);
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(file, old, old);

  const result = await waitFor(() => readResult(directory, 'stale1'), '过期请求没有写回拒绝');
  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /过期/);
  assert.equal(seen.length, 0);
  assert.equal(fs.existsSync(file), false);
});

test('弹窗抛错时按拒绝收尾，不让 Python 侧等到超时', async (t) => {
  const directory = temporaryDirectory();
  const bridge = new McpApprovalBridge({
    directory,
    ask: async () => {
      throw new Error('renderer exploded');
    },
  });
  t.after(() => bridge.stop());
  bridge.start();

  writeRequest(directory, 'boom1', DIALOG);
  const result = await waitFor(() => readResult(directory, 'boom1'), '异常时没有写回答复');

  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /renderer exploded/);
});

test('磁盘上的文档会被收敛成弹窗需要的形状', () => {
  const parsed = parseApprovalRequest('id1', {dialog: DIALOG});
  assert.deepEqual(parsed, {id: 'id1', dialog: DIALOG});

  // 缺 dialog、类型不对、没有内容的一律丢弃，交由 Python 侧超时拒绝。
  assert.equal(parseApprovalRequest('id2', {}), undefined);
  assert.equal(parseApprovalRequest('id3', {dialog: 'nope'}), undefined);
  assert.equal(parseApprovalRequest('id4', {dialog: {}}), undefined);

  const minimal = parseApprovalRequest('id5', {dialog: {title: 'T', items: 'bad', extraLabel: 5}});
  assert.deepEqual(minimal, {
    id: 'id5',
    dialog: {
      title: 'T',
      summary: '',
      items: undefined,
      preview: undefined,
      confirmLabel: undefined,
      cancelLabel: undefined,
      extraLabel: null,
      danger: false,
    },
  });
});
