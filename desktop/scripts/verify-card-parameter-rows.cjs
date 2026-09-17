/**
 * 卡片参数行验收：在无头 Chrome 里加载构建产物，注入一份带清单的夹具，
 * 断言 UE 风格参数行的渲染、就地编辑、布尔切换与折叠箭头；
 * 以及端点右键「提升为变量」后，变量详情给出结构化控件（rect 四坐标、固定长度数组按元素）。
 *
 * 用法：npm run build && node scripts/verify-card-parameter-rows.cjs
 * 截图输出：artifacts/card-parameter-rows-*.png
 * 依赖：本地 Chrome 或 Edge（可用 ONMYOJI_CHROME 指定可执行文件路径）。
 */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist', 'renderer');
const ARTIFACTS = path.join(__dirname, '..', 'artifacts');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };

function findChrome() {
  const candidates = [
    process.env.ONMYOJI_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('未找到 Chrome/Edge，请用 ONMYOJI_CHROME 指定可执行文件路径');
  return found;
}

/** dist/renderer 的静态服务：画布页只有通过 HTTP 才能加载模块与字体。 */
function serveDist() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.logs = [];
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') {
        this.logs.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  async screenshot(file) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  }

  close() { this.socket.close(); }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 夹具：一份最小清单 + 两个节点，展开参数行以覆盖全部七种参数。 */
const FIXTURE = `(() => {
  const editor = window.__btEditor;
  if (!editor) return null;
  editor.state.catalog = [{ name: 'input.tap_match', parameters: {
    match: { type: 'object', required: true }, revalidate: { type: 'boolean', default: true },
    random_offset: { type: 'integer', default: 0, min: 0 }, random_interval: { type: 'array', items: { type: 'number' }, default: [0, 0] },
    verify_gone: { type: 'boolean', default: false }, verify_timeout_seconds: { type: 'number', default: 8, min: 0 },
    hold_ms: { type: 'integer', default: 0, min: 0 } } }];
  editor.state.raw = { schema_version: 4, id: 'verify', name: 'verify', root: 'r', inputs: {}, variables: {}, nodes: [
    { id: 'r', type: 'root', name: '根节点', children: ['t'] },
    { id: 't', type: 'task', name: '点击挑战按钮', action: 'input.tap_match', params: { match: { ref: 'inputs.x' }, revalidate: true, random_offset: 11, verify_gone: true, verify_timeout_seconds: 8 } },
  ], _layout: { r: { x: 40, y: 40 }, t: { x: 360, y: 40 } } };
  editor.state.paramRowsExpanded = new Set(['t']);
  editor.state.zoom = 1; editor.state.panX = 30; editor.state.panY = 30;
  editor.render();
  const group = document.querySelector('.node[data-id="t"]');
  const hits = [...group.querySelectorAll('.param-row-hit')];
  // SVG 文本节点带 <title> 子节点，textContent 会把提示拼进来；这里只取可见文本。
  const own = (node) => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join('');
  return {
    labels: [...group.querySelectorAll('.param-row-label')].map((node) => own(node)),
    values: [...group.querySelectorAll('.param-row-value')].map((node) => [own(node), node.getAttribute('class')]),
    checks: group.querySelectorAll('.param-row-check').length,
    checked: group.querySelectorAll('.param-row-check.checked').length,
    caret: own(group.querySelector('.param-rows-toggle')),
    meta: own(group.querySelector('.node-meta')),
    height: Number(group.querySelector('.card-body').getAttribute('height')),
    rowCount: hits.length,
  };
})()`;

const OPEN_NUMBER_EDITOR = `(() => {
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="random_offset"]');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const input = document.querySelector('.inline-param-editor input');
  return input ? { type: input.type, value: input.value, focused: document.activeElement === input } : null;
})()`;

const COMMIT_AND_TOGGLE = `(() => {
  const editor = window.__btEditor;
  const node = editor.state.raw.nodes[1];
  const input = document.querySelector('.inline-param-editor input');
  input.value = '25';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const committed = node.params.random_offset;
  const closed = !document.querySelector('.inline-param-editor');
  document.querySelector('.node[data-id="t"] .param-row-hit[data-param="verify_gone"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const toggled = node.params.verify_gone;
  document.querySelector('.node[data-id="t"] .param-rows-toggle').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const collapsedRows = document.querySelectorAll('.node[data-id="t"] .param-row-label').length;
  const caret = document.querySelector('.node[data-id="t"] .param-rows-toggle');
  const collapsedCaret = [...caret.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join('');
  return { committed, closed, toggled, collapsedRows, collapsedCaret, undoDepth: editor.state.undo.length };
})()`;

/** 夹具二：五种新参数类型（坐标点/颜色/枚举/时长/按键）与对应的变量卡片。 */
const NEW_TYPES_FIXTURE = `(() => {
  const editor = window.__btEditor;
  if (!editor) return null;
  editor.state.catalog = [{ name: 'studio.preview_types', parameters: {
    realm_popup_close_point: { type: 'point', default: { x: 960, y: 540 } },
    tint: { type: 'color', default: '#ff8c3a' },
    wait_for: { type: 'enum', enum: ['all', 'any'], default: 'all' },
    stable_seconds: { type: 'duration', default: 1.5, min: 0 },
    keycode: { type: 'key', default: 'BACK' } } }];
  editor.state.raw = { schema_version: 4, id: 'verify-types', name: 'verify-types', root: 'r', inputs: {}, variables: {
    tint: { type: 'color', default: '#ff8c3a' }, target: { type: 'point', default: { x: 960, y: 540 } },
    wait_for: { type: 'enum', enum: ['all', 'any'], default: 'all' }, stable_seconds: { type: 'duration', default: 1.5 },
    keycode: { type: 'key', default: 'BACK' } }, nodes: [
    { id: 'r', type: 'root', name: '根节点', children: ['t'] },
    { id: 't', type: 'task', name: '新类型参数', action: 'studio.preview_types', params: {
      realm_popup_close_point: { x: 960, y: 540 }, tint: '#ff8c3a', wait_for: 'any', stable_seconds: 1.5, keycode: 'BACK' } },
  ], _layout: { r: { x: 30, y: 20 }, t: { x: 30, y: 120 } }, _variableCards: {
    tint: { name: 'tint', scope: 'variables', x: 400, y: 120 }, target: { name: 'target', scope: 'variables', x: 400, y: 200 },
    wait_for: { name: 'wait_for', scope: 'variables', x: 400, y: 280 }, stable_seconds: { name: 'stable_seconds', scope: 'variables', x: 400, y: 360 },
    keycode: { name: 'keycode', scope: 'variables', x: 400, y: 440 } } };
  editor.state.paramRowsExpanded = new Set(['t']);
  editor.state.zoom = 1; editor.state.panX = 24; editor.state.panY = 16;
  editor.render();
  const group = document.querySelector('.node[data-id="t"]');
  const own = (node) => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join('');
  const cardOf = (name) => document.querySelector('.variable-card[data-variable="' + name + '"]');
  return {
    labels: [...group.querySelectorAll('.param-row-label')].map(own),
    values: [...group.querySelectorAll('.param-row-value')].map((node) => [own(node), node.getAttribute('class')]),
    pins: [...group.querySelectorAll('.port-variable')].map((node) => node.getAttribute('class').split(' ').filter((name) => name.startsWith('type-'))[0]),
    swatches: [...group.querySelectorAll('.param-row-swatch')].map((node) => node.getAttribute('fill')),
    height: Number(group.querySelector('.card-body').getAttribute('height')),
    cards: ['tint', 'target', 'wait_for', 'stable_seconds', 'keycode'].map((name) => {
      const node = cardOf(name);
      if (!node) return null;
      const swatch = node.querySelector('.variable-card-swatch');
      return {
        access: own(node.querySelector('.variable-card-access')),
        dot: node.querySelector('.variable-card-dot').getAttribute('class'),
        swatch: swatch ? swatch.getAttribute('fill') : null,
      };
    }),
  };
})()`;

const OPEN_POINT_EDITOR = `(() => {
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="realm_popup_close_point"]');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const inputs = [...document.querySelectorAll('.inline-param-editor input')];
  const labels = [...document.querySelectorAll('.inline-param-editor .inline-param-axis-label')].map((node) => node.textContent);
  return { count: inputs.length, values: inputs.map((input) => input.value), types: inputs.map((input) => input.type), labels, focused: document.activeElement === inputs[0] };
})()`;

const OPEN_COLOR_EDITOR = `(() => {
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="tint"]');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const text = document.querySelector('.inline-param-editor input[type="text"]');
  const picker = document.querySelector('.inline-param-editor input[type="color"]');
  const swatch = document.querySelector('.inline-param-editor .inline-param-swatch');
  return { text: text ? text.value : null, picker: picker ? picker.value : null, background: swatch ? swatch.style.background : null };
})()`;

const COMMIT_POINT = `(() => {
  const editor = window.__btEditor;
  const node = editor.state.raw.nodes[1];
  const inputs = [...document.querySelectorAll('.inline-param-editor input')];
  inputs[1].value = '541.6';
  inputs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const committed = node.params.realm_popup_close_point;
  const closed = !document.querySelector('.inline-param-editor');
  return { committed, closed, undoDepth: editor.state.undo.length };
})()`;

const OPEN_KEY_MENU = `(() => {
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="keycode"]');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const items = [...document.querySelectorAll('.context-menu-list button')].map((button) => button.textContent);
  return { items, hasEditor: Boolean(document.querySelector('.inline-param-editor')) };
})()`;

const COMMIT_KEY = `(() => {
  const editor = window.__btEditor;
  const node = editor.state.raw.nodes[1];
  const items = [...document.querySelectorAll('.context-menu-list button')];
  const custom = items.find((button) => button.textContent === '自定义…');
  custom.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const input = document.querySelector('.inline-param-editor input');
  const opened = input ? { type: input.type, value: input.value } : null;
  input.value = 'DPAD_UP';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return { opened, committed: node.params.keycode, closed: !document.querySelector('.inline-param-editor') };
})()`;

const OPEN_DURATION_EDITOR = `(() => {
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="stable_seconds"]');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const input = document.querySelector('.inline-param-editor input');
  const unit = document.querySelector('.inline-param-editor .inline-param-unit');
  return { type: input ? input.type : null, value: input ? input.value : null, unit: unit ? unit.textContent : null, step: input ? input.step : null };
})()`;

/** 夹具三：端点右键提升为变量（数组 / 区域 / 对象），再看变量详情的默认值控件。 */
const PROMOTE_FIXTURE = `(() => {
  const editor = window.__btEditor;
  if (!editor) return null;
  editor.state.catalog = [{ name: 'input.tap_match', parameters: {
    match: { type: 'object', required: true },
    random_interval: { type: 'array', items: { type: 'duration', min: 0 }, min_items: 2, max_items: 2, default: [0, 0] },
    roi: { type: 'rect' } } }];
  editor.state.raw = { schema_version: 4, id: 'verify-promote', name: 'verify-promote', root: 'r', inputs: {}, variables: {}, nodes: [
    { id: 'r', type: 'root', name: '根节点', children: ['t'] },
    { id: 't', type: 'task', name: '点击匹配项', action: 'input.tap_match', params: {
      match: { x: 1, y: 2 }, random_interval: [0.2, 0.6], roi: [10, 20, 30, 40] } },
  ], _layout: { r: { x: 30, y: 20 }, t: { x: 30, y: 120 } } };
  editor.state.paramRowsExpanded = new Set(['t']);
  editor.state.inspector = 'node';
  editor.state.selected = new Set(['t']);
  editor.state.zoom = 1; editor.state.panX = 24; editor.state.panY = 16;
  editor.render();
  return {
    pins: [...document.querySelectorAll('.node[data-id="t"] .variable-port-hit')].map((node) => node.getAttribute('data-param')),
    inputs: Object.keys(editor.state.raw.inputs),
  };
})()`;

/** 右键某个参数端点并点掉菜单里的一项。 */
const promotePin = (param, label) => `(() => {
  const hit = document.querySelector('.node[data-id="t"] .variable-port-hit[data-param="${param}"]');
  if (!hit) return { error: '缺少端点 ' + '${param}' };
  hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 320, clientY: 260 }));
  const items = [...document.querySelectorAll('.context-menu-list button')];
  const target = items.find((button) => button.textContent === '${label}');
  if (!target) return { error: '菜单缺少「${label}」：' + items.map((button) => button.textContent).join(',') };
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const editor = window.__btEditor;
  return { labels: items.map((button) => button.textContent), inputs: JSON.parse(JSON.stringify(editor.state.raw.inputs)) };
})()`;

/** 详情模式：画布页默认是 canvas 模式（隐藏详情栏），截图前切到详情模式。 */
const SHOW_DETAILS = `(() => {
  document.body.classList.remove('desktop-canvas-mode');
  document.body.classList.add('desktop-details-mode');
  const inspector = document.getElementById('inspector');
  return inspector ? getComputedStyle(inspector).display : 'missing';
})()`;

/** 在详情栏里选中某个公开输入，返回默认值控件的结构。 */
const inspectVariable = (name) => `(() => {
  const editor = window.__btEditor;
  editor.state.inspector = 'variables';
  editor.state.selectedVariable = ${JSON.stringify(name)};
  editor.state.selectedVariableScope = 'inputs';
  editor.render();
  const body = document.getElementById('inspector-body');
  if (!body) return null;
  const rows = [...body.querySelectorAll('.field')];
  const labelOf = (row) => { const caption = row.querySelector('.field-label'); return caption ? caption.textContent : ''; };
  const defaultRow = rows.find((row) => labelOf(row) === '默认值');
  const control = defaultRow ? defaultRow.children[1] : null;
  const inputs = control ? [...control.querySelectorAll('input')] : [];
  return {
    title: document.getElementById('inspector-title').textContent,
    controlClass: control ? control.className : null,
    inputs: inputs.map((input) => input.value),
    inputTypes: inputs.map((input) => input.type),
    textareas: body.querySelectorAll('textarea').length,
    buttons: control ? [...control.querySelectorAll('button')].map((button) => button.textContent) : [],
    unit: control && control.querySelector('.definition-unit') ? control.querySelector('.definition-unit').textContent : null,
  };
})()`;

async function main() {
  assert.ok(fs.existsSync(path.join(DIST, 'canvas.html')), '缺少构建产物，请先执行 npm run build');
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const server = await serveDist();
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-verify-'));
  const debugPort = 9500 + Math.floor(Math.random() * 400);
  const chrome = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore' });

  let client;
  try {
    const page = `http://127.0.0.1:${port}/canvas.html?mode=canvas`;
    let target = null;
    for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
      try {
        target = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(page)}`, { method: 'PUT' }).then((response) => response.json());
      } catch {
        await wait(250);
      }
    }
    assert.ok(target?.webSocketDebuggerUrl, '无法启动无头浏览器调试通道');
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    let rows = null;
    for (let attempt = 0; attempt < 40 && !rows; attempt += 1) {
      await wait(250);
      rows = await client.evaluate(FIXTURE);
    }
    assert.ok(rows, '画布编辑器未就绪（__btEditor 缺失）');
    assert.deepEqual(rows.labels, ['匹配配置', '重新校验', '随机偏移（px）', '随机间隔（秒）', '确认模板消失', '确认消失超时（秒）', '按压时长（毫秒）'], '参数行按清单顺序逐行渲染');
    assert.equal(rows.rowCount, 7, '每行一个值区热区');
    assert.equal(rows.checks, 2, '布尔参数渲染成勾选框');
    assert.equal(rows.checked, 2, '已配置的布尔参数应勾选');
    assert.equal(rows.caret, '▾', '展开状态显示收起箭头');
    assert.equal(rows.meta, '7 项参数 · 点值编辑');
    assert.equal(rows.height, 96 + 7 * 24, '卡片高度必须等于 nodeHeight 公式');
    assert.deepEqual(rows.values.map(([, className]) => className.replace('param-row-value ', '')), ['tone-bound', 'tone-literal', 'tone-default', 'tone-literal', 'tone-default']);
    await client.screenshot(path.join(ARTIFACTS, 'card-parameter-rows-dark.png'));

    const opened = await client.evaluate(OPEN_NUMBER_EDITOR);
    assert.deepEqual(opened, { type: 'number', value: '11', focused: true }, '点击数值行应弹出已聚焦的行内输入框');
    await client.screenshot(path.join(ARTIFACTS, 'card-parameter-rows-editing.png'));

    const committed = await client.evaluate(COMMIT_AND_TOGGLE);
    assert.equal(committed.committed, 25, 'Enter 应写入字面量');
    assert.equal(committed.closed, true, '提交后浮层应收起');
    assert.equal(committed.toggled, false, '点击布尔行应立即切换');
    assert.equal(committed.undoDepth, 2, '两次修改各记一次历史');
    assert.equal(committed.collapsedRows, 5, '折叠后只显示必填与已配置');
    assert.equal(committed.collapsedCaret, '▸ 2', '折叠箭头报出隐藏数量');

    await client.evaluate("window.StudioTheme && window.StudioTheme.set('light')");
    await wait(300);
    await client.evaluate(FIXTURE);
    await client.evaluate(OPEN_NUMBER_EDITOR);
    await wait(300);
    await client.screenshot(path.join(ARTIFACTS, 'card-parameter-rows-light.png'));

    await client.evaluate("window.StudioTheme && window.StudioTheme.set('dark')");
    await wait(200);
    // 收掉上一步留下的行内输入框，避免它出现在新类型截图里。
    await client.evaluate("document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.querySelector('.inline-param-editor')?.remove()");
    let types = null;
    for (let attempt = 0; attempt < 20 && !types; attempt += 1) {
      await wait(150);
      types = await client.evaluate(NEW_TYPES_FIXTURE);
    }
    assert.ok(types, '新类型夹具未渲染');
    assert.deepEqual(types.labels, ['结界弹窗关闭位置', 'tint', '完成条件', '稳定时长（秒）', '按键代码'], '新类型参数行沿用清单标签');
    assert.deepEqual(types.values.map(([text]) => text), ['(960, 540)', '#ff8c3a', 'any', '1.5s', 'BACK'], '新类型值文本');
    assert.deepEqual(types.values.map(([, className]) => className.replace('param-row-value ', '')),
      ['tone-literal', 'tone-literal', 'tone-literal', 'tone-literal', 'tone-literal']);
    assert.deepEqual(types.pins, ['type-point', 'type-color', 'type-enum', 'type-duration', 'type-key'], '引脚类型 class 跟着参数类型');
    assert.deepEqual(types.swatches, ['#ff8c3a'], '颜色参数行在值前画色块');
    assert.equal(types.height, 96 + 5 * 24, '新类型行高与 nodeHeight 一致');
    assert.deepEqual(types.cards.map((card) => card && card.access),
      ['颜色 · 状态', '坐标点 · 状态', '枚举 · 状态', '时长 · 状态', '按键 · 状态'], '变量卡片类型名用中文标签');
    assert.deepEqual(types.cards.map((card) => card && card.dot),
      ['variable-card-dot type-color', 'variable-card-dot type-point', 'variable-card-dot type-enum', 'variable-card-dot type-duration', 'variable-card-dot type-key']);
    assert.deepEqual(types.cards.map((card) => card && card.swatch), ['#ff8c3a', null, null, null, null], '只有颜色变量卡片画色块');
    await client.screenshot(path.join(ARTIFACTS, 'card-parameter-rows-types-dark.png'));

    const point = await client.evaluate(OPEN_POINT_EDITOR);
    assert.deepEqual(point, { count: 2, values: ['960', '540'], types: ['number', 'number'], labels: ['X', 'Y'], focused: true }, '坐标点参数用 X/Y 双输入');
    const pointCommit = await client.evaluate(COMMIT_POINT);
    assert.deepEqual(pointCommit.committed, { x: 960, y: 542 }, '坐标点回车取整写入');
    assert.equal(pointCommit.closed, true);

    const color = await client.evaluate(OPEN_COLOR_EDITOR);
    assert.deepEqual(color, { text: '#ff8c3a', picker: '#ff8c3a', background: 'rgb(255, 140, 58)' }, '颜色参数带同步的取色器与色块');
    await client.screenshot(path.join(ARTIFACTS, 'card-parameter-rows-types-editing.png'));

    const duration = await client.evaluate(OPEN_DURATION_EDITOR);
    assert.deepEqual(duration, { type: 'number', value: '1.5', unit: '秒', step: 'any' }, '时长参数带秒单位');
    await client.evaluate("document.querySelector('.inline-param-editor input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

    const key = await client.evaluate(OPEN_KEY_MENU);
    assert.equal(key.hasEditor, false, '按键参数走菜单而不是输入框');
    assert.ok(key.items.some((label) => label.includes('BACK · 返回')), `按键候选缺少 BACK：${key.items.join(',')}`);
    assert.ok(key.items.includes('自定义…'), '按键菜单应保留自定义入口');
    assert.equal(key.items.at(-1), '在详情栏编辑');
    const keyCommit = await client.evaluate(COMMIT_KEY);
    assert.deepEqual(keyCommit.opened, { type: 'text', value: 'BACK' }, '自定义按键用文本输入');
    assert.equal(keyCommit.committed, 'DPAD_UP');
    assert.equal(keyCommit.closed, true);

    await client.evaluate("window.StudioTheme && window.StudioTheme.set('light')");
    await wait(200);
    await client.evaluate(NEW_TYPES_FIXTURE);
    await client.evaluate(OPEN_KEY_MENU);
    await wait(200);
    await client.screenshot(path.join(ARTIFACTS, 'card-parameter-rows-types-light.png'));
    await client.evaluate("window.StudioTheme && window.StudioTheme.set('dark')");

    // 端点右键「提升为变量」：变量定义要带上结构，详情栏才能给结构化控件。
    await client.evaluate("document.querySelector('.context-menu')?.remove()");
    const promote = await client.evaluate(PROMOTE_FIXTURE);
    assert.ok(promote, '提升为变量夹具未渲染');
    assert.deepEqual(promote.pins, ['match', 'random_interval', 'roi'], '三个参数端点都可右键');

    const intervalPromote = await client.evaluate(promotePin('random_interval', '提升为变量'));
    assert.ok(!intervalPromote.error, intervalPromote.error || '');
    assert.deepEqual(intervalPromote.inputs['随机间隔_秒'], {
      type: 'array', items: { type: 'duration', min: 0 }, min_items: 2, max_items: 2,
      default: [0.2, 0.6], display_name: '随机间隔（秒）',
    }, '随机间隔提升后带上 items / min_items / max_items');

    const intervalView = await client.evaluate(inspectVariable('随机间隔_秒'));
    assert.equal(intervalView.controlClass, 'variable-array-value', '数组默认值用元素控件');
    assert.deepEqual(intervalView.inputs, ['0.2', '0.6'], '固定长度数组正好两个元素输入框');
    assert.equal(intervalView.unit, '秒', '元素沿用 duration 控件');
    assert.deepEqual(intervalView.buttons, [], '固定长度数组不提供增删按钮');
    assert.equal(intervalView.textareas, 0, '详情栏不出现原始 JSON 输入');

    const roiPromote = await client.evaluate(promotePin('roi', '提升为变量'));
    assert.ok(!roiPromote.error, roiPromote.error || '');
    assert.deepEqual(roiPromote.inputs['识别区域'], {
      type: 'rect', default: [10, 20, 30, 40], display_name: '识别区域',
    }, '区域提升为 rect 变量');
    const roiView = await client.evaluate(inspectVariable('识别区域'));
    assert.equal(roiView.controlClass, 'definition-rect-control', 'rect 默认值用四坐标控件');
    assert.deepEqual(roiView.inputs, ['10', '20', '30', '40'], 'rect 变量正好四个坐标输入框');
    assert.equal(roiView.textareas, 0, '详情栏不出现原始 JSON 输入');

    const objectPromote = await client.evaluate(promotePin('match', '提升为变量'));
    assert.ok(!objectPromote.error, objectPromote.error || '');
    assert.deepEqual(objectPromote.inputs['匹配配置'], {
      type: 'object', default: { x: 1, y: 2 }, display_name: '匹配配置',
    }, '对象端点提升后保留对象字面量');
    const objectView = await client.evaluate(inspectVariable('匹配配置'));
    assert.equal(objectView.controlClass, 'variable-map-value', '无字段声明的对象用字段行编辑');
    assert.deepEqual(objectView.inputs, ['x', '1', 'y', '2'], '每个字段一行：字段名 + 值');
    assert.equal(objectView.buttons.filter((label) => label.includes('删除')).length, 2, '字段行可删除');
    assert.ok(objectView.buttons.some((label) => label.includes('添加字段')), '可添加字段');
    assert.equal(objectView.textareas, 0, '详情栏不出现原始 JSON 输入');

    // 截图留证：详情栏里三种提升出来的变量控件。
    assert.notEqual(await client.evaluate(SHOW_DETAILS), 'none', '详情模式应显示详情栏');
    await wait(200);
    for (const [name, file] of [['随机间隔_秒', 'promote-array'], ['识别区域', 'promote-roi'], ['匹配配置', 'promote-map']]) {
      await client.evaluate(inspectVariable(name));
      await wait(150);
      await client.screenshot(path.join(ARTIFACTS, `card-parameter-rows-${file}.png`));
    }

    assert.deepEqual(client.logs, [], `页面出现异常：${client.logs.join(' | ')}`);
    console.log('卡片参数行验收通过');
    console.log(`  行数 ${rows.rowCount} · 卡片高度 ${rows.height}px · 勾选框 ${rows.checked}/${rows.checks}`);
    console.log(`  就地编辑：11 → ${committed.committed}；布尔切换 → ${committed.toggled}；折叠后 ${committed.collapsedRows} 行`);
    console.log(`  新类型：${types.labels.join(' / ')} → ${types.values.map(([text]) => text).join(' / ')}`);
    console.log(`  新类型就地编辑：坐标点 → ${JSON.stringify(pointCommit.committed)}；按键 → ${keyCommit.committed}`);
    console.log(`  提升为变量：随机间隔 → ${JSON.stringify(intervalView.inputs)}（${intervalView.unit}）；区域 → ${JSON.stringify(roiView.inputs)}；对象 → ${JSON.stringify(objectView.inputs)}`);
    console.log(`  截图：${path.relative(process.cwd(), ARTIFACTS)}/card-parameter-rows-*.png`);
  } finally {
    client?.close();
    chrome.kill();
    server.close();
  }
}

main().catch((error) => {
  console.error(`验收失败：${error.message}`);
  process.exitCode = 1;
});