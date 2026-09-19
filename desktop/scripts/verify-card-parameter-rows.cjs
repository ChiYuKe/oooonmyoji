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

/** 夹具四：清单声明了固定卡片（等待模板）——端点由清单固定，双行行样式。 */
const FIXED_CARD_FIXTURE = `(() => {
  const editor = window.__btEditor;
  if (!editor) return null;
  // 前面几节留下的菜单/浮层会盖住卡片，先清干净再截图。
  document.querySelectorAll('.context-menu').forEach((node) => node.remove());
  document.querySelector('.inline-param-editor')?.remove();
  editor.state.catalog = [{ name: 'vision.wait_template', parameters: {
    template: { type: 'asset', required: true },
    timeout_seconds: { type: 'duration', required: true, min: 0 },
    present: { type: 'boolean', default: true },
    roi: { type: 'rect' },
    threshold: { type: 'number', default: 0.85, min: 0, max: 1 },
    scale_search: { type: 'boolean', default: false } },
    card: [
      { param: 'template', label: '模板' },
      { param: 'timeout_seconds', label: '超时' },
      { param: 'present', label: '存在性', on_label: '等待出现', off_label: '等待消失' },
      { param: 'roi', label: '识别区域' },
      { param: 'threshold', label: '匹配阈值' },
      { param: 'scale_search', label: '多尺度搜索', on_label: '启用', off_label: '关闭' }] }];
  editor.state.raw = { schema_version: 4, id: 'verify-fixed', name: 'verify-fixed', root: 'r', inputs: {}, variables: {}, nodes: [
    { id: 'r', type: 'root', name: '根节点', children: ['t'] },
    { id: 't', type: 'task', name: '等待战斗结束', action: 'vision.wait_template', params: {
      template: 'assets/templates/battle.png', present: true, roi: [60, 120, 200, 80] } },
  ], _layout: { r: { x: 30, y: 20 }, t: { x: 30, y: 130 } } };
  // 固定卡片不读展开状态：这里故意留一个空的展开集合。
  editor.state.paramRowsExpanded = new Set();
  editor.state.zoom = 1; editor.state.panX = 24; editor.state.panY = 16;
  editor.render();
  const group = document.querySelector('.node[data-id="t"]');
  const own = (node) => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join('');
  const byClass = (name) => [...group.querySelectorAll('.' + name)];
  return {
    labels: byClass('param-row-label').map(own),
    values: byClass('param-row-value').map((node) => [own(node), node.getAttribute('text-anchor'), node.getAttribute('x'), node.getAttribute('y')]),
    labelYs: byClass('param-row-label').map((node) => node.getAttribute('y')),
    checks: byClass('param-row-check').map((node) => node.getAttribute('class').includes('checked')),
    fields: byClass('param-row-field').map((node) => [
      node.getAttribute('x'), node.getAttribute('y'), node.getAttribute('width'), node.getAttribute('height'), node.getAttribute('class'),
    ]),
    carets: byClass('param-row-caret').map((node) => [node.textContent, node.getAttribute('x')]),
    hitParams: byClass('param-row-hit').map((node) => node.getAttribute('data-param')),
    hitBoxes: byClass('param-row-hit').map((node) => [
      node.getAttribute('x'), node.getAttribute('y'), node.getAttribute('width'), node.getAttribute('height'),
      node.getAttribute('class').includes('kind-picker'),
    ]),
    caret: group.querySelectorAll('.param-rows-toggle').length,
    meta: own(group.querySelector('.node-meta')),
    contentXs: {
      kicker: group.querySelector('.card-kicker').getAttribute('x'),
      subtitle: group.querySelector('.card-description').getAttribute('x'),
      meta: group.querySelector('.node-meta').getAttribute('x'),
      title: group.querySelector('.card-title').getAttribute('x'),
      label: group.querySelector('.param-row-label').getAttribute('x'),
    },
    height: Number(group.querySelector('.card-body').getAttribute('height')),
    pins: group.querySelectorAll('.variable-port-hit').length,
  };
})()`;

/** 点数字行的值框：浮层应该贴在同一个矩形上、文字同样左对齐，像「框获得焦点」。 */
const OPEN_TIMEOUT_EDITOR = `(() => {
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="timeout_seconds"]');
  if (!row) return null;
  const box = row.getBoundingClientRect();
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: box.left + 6, clientY: box.top + 6 }));
  const shell = document.querySelector('.inline-param-editor');
  if (!shell) return null;
  const input = shell.querySelector('input');
  const shellRect = shell.getBoundingClientRect();
  return {
    shellClass: shell.className,
    textAlign: getComputedStyle(input).textAlign,
    value: input.value,
    box: [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)],
    shell: [Math.round(shellRect.left), Math.round(shellRect.top), Math.round(shellRect.width), Math.round(shellRect.height)],
    focused: document.activeElement === input,
  };
})()`;

const OPEN_TEMPLATE_MENU = `(() => {
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="template"]');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 60, clientY: 200 }));
  const items = [...document.querySelectorAll('.context-menu-list button')].map((button) => button.textContent);
  return { items, hasEditor: Boolean(document.querySelector('.inline-param-editor')) };
})()`;

const OPEN_ROI_MENU = `(() => {
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="roi"]');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 60, clientY: 320 }));
  const items = [...document.querySelectorAll('.context-menu-list button')].map((button) => button.textContent);
  return { items, hasEditor: Boolean(document.querySelector('.inline-param-editor')) };
})()`;

/** 区域行的「手动输入四坐标…」：X/Y/宽/高 四个输入框，回车一次提交。 */
const COMMIT_ROI_MANUAL = `(() => {
  const editor = window.__btEditor;
  const node = editor.state.raw.nodes[1];
  const button = [...document.querySelectorAll('.context-menu-list button')].find((item) => item.textContent === '手动输入四坐标…');
  if (!button) return { error: '菜单缺少手动输入入口' };
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const shell = document.querySelector('.inline-param-editor');
  const labels = [...shell.querySelectorAll('.inline-param-axis-label')].map((node) => node.textContent);
  const inputs = [...shell.querySelectorAll('input')];
  const initial = inputs.map((input) => input.value);
  inputs[2].value = '560';
  inputs[3].value = '320';
  inputs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return {
    labels, initial, committed: node.params.roi,
    closed: !document.querySelector('.inline-param-editor'),
    height: Number(document.querySelector('.node[data-id="t"] .card-body').getAttribute('height')),
    value: [...document.querySelectorAll('.node[data-id="t"] .param-row-value')]
      .map((item) => [...item.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join(''))
      .find((text) => text.indexOf('560') >= 0),
  };
})()`;

/** 布尔行：整行热区点击即切换，值行文字跟着 on_label/off_label 走。 */
const TOGGLE_PRESENT = `(() => {
  const editor = window.__btEditor;
  const node = editor.state.raw.nodes[1];
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="present"]');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const values = [...document.querySelectorAll('.node[data-id="t"] .param-row-value')]
    .map((item) => [...item.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join(''));
  return { value: node.params.present, values, height: Number(document.querySelector('.node[data-id="t"] .card-body').getAttribute('height')) };
})()`;

/** 夹具五：点击匹配项——用户截图里的那张 9 端点卡片（含结构体行的虚线框）。 */
const FIXED_TAP_MATCH_FIXTURE = `(() => {
  const editor = window.__btEditor;
  if (!editor) return null;
  document.querySelectorAll('.context-menu').forEach((node) => node.remove());
  document.querySelector('.inline-param-editor')?.remove();
  editor.state.catalog = [{ name: 'input.tap_match', parameters: {
    match: { type: 'object', required: true },
    revalidate: { type: 'boolean', default: true },
    verify_gone: { type: 'boolean', default: false },
    verify_timeout_seconds: { type: 'duration', default: 8 },
    disappeared_state_timeout_seconds: { type: 'duration', default: 0 },
    hold_ms: { type: 'integer', default: 0 },
    random_offset: { type: 'integer', default: 0 },
    random_interval: { type: 'array', items: { type: 'duration' }, default: [0, 0] },
    disappeared_states: { type: 'array', items: { type: 'object' }, default: [] } },
    card: [
      { param: 'match', label: '匹配配置', control: 'inspector' },
      { param: 'revalidate', label: '重新校验', on_label: '校验', off_label: '跳过' },
      { param: 'verify_gone', label: '确认模板消失', on_label: '校验', off_label: '跳过' },
      { param: 'verify_timeout_seconds', label: '确认消失超时（秒）' },
      { param: 'disappeared_state_timeout_seconds', label: '消失状态超时（秒）' },
      { param: 'hold_ms', label: '按压时长（毫秒）' },
      { param: 'random_offset', label: '随机偏移（px）' },
      { param: 'random_interval', label: '随机间隔（秒）' },
      { param: 'disappeared_states', label: '消失状态列表', control: 'inspector' }] }];
  editor.state.raw = { schema_version: 4, id: 'verify-tap-match', name: 'verify-tap-match', root: 'r', inputs: {}, variables: {}, nodes: [
    { id: 'r', type: 'root', name: '根节点', children: ['t'] },
    { id: 't', type: 'task', name: '点击挑战按钮', action: 'input.tap_match', params: {
      match: { x: 1, y: 2 }, revalidate: true, verify_gone: true, verify_timeout_seconds: 8,
      random_offset: 25, random_interval: [0.2, 0.6] } },
  ], _layout: { r: { x: 30, y: 10 }, t: { x: 30, y: 100 } } };
  editor.state.paramRowsExpanded = new Set();
  editor.state.zoom = 1; editor.state.panX = 24; editor.state.panY = 16;
  editor.render();
  const group = document.querySelector('.node[data-id="t"]');
  const own = (node) => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join('');
  const byClass = (name) => [...group.querySelectorAll('.' + name)];
  return {
    labels: byClass('param-row-label').map(own),
    values: byClass('param-row-value').map(own),
    fields: byClass('param-row-field').map((node) => node.getAttribute('class').replace('param-row-field', '').trim()),
    cells: byClass('param-row-cell').map((node) => [
      node.getAttribute('x'), node.getAttribute('y'), node.getAttribute('width'), node.getAttribute('height'),
    ]),
    cellWidths: {
      match: byClass('param-row-hit')[0].getAttribute('width'),
      revalidate: byClass('param-row-hit')[1].getAttribute('width'),
      verifyGone: byClass('param-row-hit')[2].getAttribute('width'),
      interval: byClass('param-row-cell')[0].getAttribute('width'),
    },
    carets: byClass('param-row-caret').length,
    height: Number(group.querySelector('.card-body').getAttribute('height')),
    meta: own(group.querySelector('.node-meta')),
  };
})()`;

/** 区域行点「手动输入四坐标…」：浮层横跨整行值区，四个坐标输入等分宽度。 */
const OPEN_RECT_INPUTS = `(() => {
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="roi"]');
  if (!row) return null;
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 60, clientY: 320 }));
  const button = [...document.querySelectorAll('.context-menu-list button')].find((item) => item.textContent === '手动输入四坐标…');
  if (!button) return { error: '菜单缺少手动输入入口' };
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const shell = document.querySelector('.inline-param-editor');
  if (!shell) return { error: '没有打开行内编辑器' };
  const inputs = [...shell.querySelectorAll('input')];
  const box = row.getBoundingClientRect();
  const shellRect = shell.getBoundingClientRect();
  return {
    values: inputs.map((input) => input.value),
    widths: inputs.map((input) => Math.round(input.getBoundingClientRect().width)),
    boxWidth: Math.round(box.width),
    shellWidth: Math.round(shellRect.width),
    shellLeft: Math.round(shellRect.left),
    boxLeft: Math.round(box.left),
  };
})()`;

/** 夹具六：两个任务节点——从「识别当前页面状态」右侧输出口拖引用到「等待文字」的 text 参数。 */
const REFERENCE_DRAG_FIXTURE = `(() => {
  const editor = window.__btEditor;
  if (!editor) return null;
  document.querySelectorAll('.context-menu').forEach((node) => node.remove());
  document.querySelector('.inline-param-editor')?.remove();
  editor.state.catalog = [
    { name: 'vision.detect_state', description: '识别页面状态', parameters: {
        states: { type: 'array', items: { type: 'object' }, required: true },
        allow_ocr: { type: 'boolean', default: true } },
      outputSchema: { type: 'object', properties: { state: { type: 'string' }, confidence: { type: 'number' } }, required: ['state'] } },
    { name: 'vision.wait_text', description: '等待文字', parameters: {
        text: { type: 'string', required: true },
        timeout_seconds: { type: 'duration', required: true, min: 0 },
        present: { type: 'boolean', default: true },
        roi: { type: 'rect' },
        min_confidence: { type: 'number', default: 0 },
      },
      card: [
        { param: 'text', label: '文字' },
        { param: 'timeout_seconds', label: '超时' },
        { param: 'present', label: '存在性', on_label: '等待出现', off_label: '等待消失' },
        { param: 'roi', label: '识别区域' },
        { param: 'min_confidence', label: '最小置信度' }] }];
  editor.state.raw = { schema_version: 4, id: 'verify-reference', name: 'verify-reference', root: 'r', inputs: {}, variables: {}, nodes: [
    { id: 'r', type: 'root', name: '根节点', children: ['seq'] },
    { id: 'seq', type: 'sequence', name: '顺序', children: ['detect'] },
    { id: 'detect', type: 'task', name: '识别当前页面状态', action: 'vision.detect_state', params: { states: [{ name: 'a' }] } },
    { id: 'wait', type: 'task', name: '等待结算文字', action: 'vision.wait_text', params: { timeout_seconds: 5 } },
  ], _layout: { r: { x: 30, y: 20 }, seq: { x: 30, y: 130 }, detect: { x: 30, y: 260 }, wait: { x: 420, y: 260 } } };
  editor.state.paramRowsExpanded = new Set();
  editor.state.zoom = 1; editor.state.panX = 20; editor.state.panY = 16;
  editor.render();
  const own = (node) => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join('');
  const center = (node) => {
    const box = node.getBoundingClientRect();
    return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  };
  const detectNode = editor.state.raw.nodes.find((node) => node.id === 'detect');
  const waitNode = editor.state.raw.nodes.find((node) => node.id === 'wait');
  const port = document.querySelector('.node[data-id="detect"] .port-out-reference');
  if (!port) return { error: '缺少输出口' };
  const portBox = port.getBoundingClientRect();
  port.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: portBox.left + portBox.width / 2, clientY: portBox.top + portBox.height / 2 }));
  const dragging = Boolean(editor.state.referenceConnect);
  const preview = document.querySelectorAll('.reference-connection-preview').length;
  // 开始拖拽会重绘画布：之后必须重新查询元素（旧引用已脱离文档，事件不会冒泡到画布）。
  // 目标：第 2 行（超时）的**值框**——离引脚很远，只有按行带判断才会绑对行。
  const aim = (element) => {
    const box = element.getBoundingClientRect();
    return { clientX: box.left + box.width - 12, clientY: box.top + box.height / 2 };
  };
  const valueBox = () => {
    const field = document.querySelectorAll('.node[data-id="wait"] .param-row-field');
    return field[1];
  };
  const target = aim(valueBox());
  valueBox().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: target.clientX, clientY: target.clientY }));
  const hovered = editor.state.referenceConnect && editor.state.referenceConnect.hover ? editor.state.referenceConnect.hover.param : null;
  const hoverCard = document.querySelector('.node[data-id="wait"]');
  const highlight = {
    card: String(hoverCard.getAttribute('class')).includes('connect-hover'),
    row: Array.from(hoverCard.querySelectorAll('.param-row-field')).map((node) => node.getAttribute('class').includes('target')),
  };
  // 落点前再查一次（pointermove 也会重绘）。
  const drop = aim(valueBox());
  valueBox().dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1, clientX: drop.clientX, clientY: drop.clientY }));
  const waitAfter = editor.state.raw.nodes.find((node) => node.id === 'wait');
  const waitCard = document.querySelector('.node[data-id="wait"]');
  return {
    dragging,
    preview,
    hovered,
    highlight,
    fields: editor.referenceFieldsForPin ? editor.referenceFieldsForPin(detectNode, waitNode, 'timeout_seconds').map((item) => item.field) : null,
    textParam: waitAfter.params.text,
    timeoutParam: waitAfter.params.timeout_seconds,
    cleared: editor.state.referenceConnect === null,
    edges: document.querySelectorAll('.reference-edges .reference-edge').length,
    rowValue: own(waitCard.querySelectorAll('.param-row-value')[1] || waitCard.querySelector('.param-row-value')),
    rowTitle: (() => { const node = waitCard.querySelectorAll('.param-row-value')[1]; const title = node && node.querySelector('title'); return title ? title.textContent : ''; })(),
    rowTone: waitCard.querySelectorAll('.param-row-value')[1].getAttribute('class'),
  };
})()`;

/** 输出口右键菜单：菜单要短，数组的每项字段收进子菜单。 */
const OPEN_REFERENCE_PORT_MENU = `(() => {
  const port = document.querySelector('.node[data-id="detect"] .port-out-reference');
  if (!port) return { error: '缺少输出口' };
  const box = port.getBoundingClientRect();
  port.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left + 4, clientY: box.top + 4 }));
  const items = [...document.querySelectorAll('.context-menu-list > button')].map((button) => button.textContent);
  return { items };
})()`;

/** 数组输出的输出口菜单：整体 + 每项，每项的字段收在子菜单里。 */
const OPEN_ARRAY_PORT_MENU = `(() => {
  const port = document.querySelector('.node[data-id="task_1"] .port-out-reference');
  if (!port) return { error: '缺少输出口' };
  const box = port.getBoundingClientRect();
  port.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left + 4, clientY: box.top + 4 }));
  const top = [...document.querySelectorAll('.context-menu-list > button')].map((button) => button.textContent);
  const group = [...document.querySelectorAll('.context-menu-list > button')].find((button) => button.textContent.startsWith('第 1 项'));
  if (!group) return { error: '第 1 项不是子菜单：' + top.join(' / ') };
  group.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  const sub = [...document.querySelectorAll('.context-menu-sub button')].map((button) => button.textContent);
  return { top, sub };
})()`;

/** 在详情栏里切换任务动作：卡片必须立刻换成新动作的端点。 */
const SWITCH_ACTION_FIXTURE = `(() => {
  const editor = window.__btEditor;
  if (!editor) return null;
  document.querySelectorAll('.context-menu').forEach((node) => node.remove());
  document.querySelectorAll('body > .ui-dropdown-list').forEach((node) => node.remove());
  editor.state.catalog = [
    { name: 'core.log', description: '记录日志', parameters: { message: { type: 'string', required: true }, fields: { type: 'object' } } },
    { name: 'input.key', description: '发送按键', parameters: { keycode: { type: 'key', required: true } } },
  ];
  editor.state.raw = { schema_version: 4, id: 'verify-action', name: 'verify-action', root: 'r', inputs: {}, variables: {}, nodes: [
    { id: 'r', type: 'root', name: '根节点', children: ['t'] },
    { id: 't', type: 'task', name: '记录日志', action: 'core.log', params: { message: '你好' } },
  ], _layout: { r: { x: 30, y: 20 }, t: { x: 30, y: 130 } } };
  editor.state.selected = new Set(['t']);
  editor.state.selectedEdge = null;
  editor.state.selectedRun = null;
  editor.state.inspector = 'node';
  editor.state.zoom = 1; editor.state.panX = 24; editor.state.panY = 16;
  editor.render();
  const own = (node) => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join('');
  const rowValues = () => [...document.querySelectorAll('.node[data-id="t"] .param-row-label')].map(own);
  const before = rowValues();
  // 详情栏「动作」区里的下拉：和用户操作走同一条代码路径。
  const trigger = [...document.querySelectorAll('#inspector-body .ui-dropdown-button')]
    .find((button) => button.closest('.field') && /实现|动作/.test(button.closest('.field').textContent));
  if (!trigger) return { error: '找不到动作下拉', body: document.getElementById('inspector-body') ? 'yes' : 'no' };
  trigger.click();
  const items = [...document.querySelectorAll('body > .ui-dropdown-list .ui-dropdown-item')];
  const target = items.find((item) => item.textContent.includes('发送按键'));
  if (!target) return { error: '下拉里没有目标动作：' + items.map((item) => item.textContent).join(' / ') };
  target.click();
  const node = editor.state.raw.nodes.find((item) => item.id === 't');
  const card = document.querySelector('.node[data-id="t"]');
  return {
    before,
    action: node.action,
    after: rowValues(),
    pins: [...card.querySelectorAll('.param-row-hit')].map((hit) => hit.getAttribute('data-param')),
    subtitle: own(card.querySelector('.node-subtitle')),
    height: Number(card.querySelector('.card-body').getAttribute('height')),
  };
})()`;

/** 夹具七：数组输出 → 单个对象参数（vision.wait_template → input.tap_match.match）：落点给「第 N 项」菜单。 */
const ARRAY_REFERENCE_FIXTURE = `(() => {
  const editor = window.__btEditor;
  if (!editor) return null;
  document.querySelectorAll('.context-menu').forEach((node) => node.remove());
  document.querySelector('.inline-param-editor')?.remove();
  const matchProperties = { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' }, confidence: { type: 'number' } };
  editor.state.catalog = [
    { name: 'vision.wait_template', parameters: {
        template: { type: 'asset', required: true },
        timeout_seconds: { type: 'duration', required: true, min: 0 },
        present: { type: 'boolean', default: true },
        roi: { type: 'rect' },
        threshold: { type: 'number', default: 0.85 },
        scale_search: { type: 'boolean', default: false } },
      card: [
        { param: 'template', label: '模板' },
        { param: 'timeout_seconds', label: '超时' },
        { param: 'present', label: '存在性', on_label: '等待出现', off_label: '等待消失' },
        { param: 'roi', label: '识别区域' },
        { param: 'threshold', label: '匹配阈值' },
        { param: 'scale_search', label: '多尺度搜索', on_label: '启用', off_label: '关闭' }],
      outputSchema: { type: 'array', items: { type: 'object', properties: matchProperties } } },
    { name: 'input.tap_match', parameters: {
        match: { type: 'object', required: true },
        revalidate: { type: 'boolean', default: true } },
      card: [
        { param: 'match', label: '匹配配置', control: 'inspector' },
        { param: 'revalidate', label: '重新校验', on_label: '校验', off_label: '跳过' }] }];
  editor.state.raw = { schema_version: 4, id: 'verify-array-ref', name: 'verify-array-ref', root: 'r', inputs: {}, variables: {}, nodes: [
    { id: 'r', type: 'root', name: '根节点', children: ['seq'] },
    { id: 'seq', type: 'sequence', name: '顺序', children: ['task_1'] },
    { id: 'task_1', type: 'task', name: '等待模板', action: 'vision.wait_template', params: { template: 'experience.png', timeout_seconds: 10 } },
    { id: 'task_2', type: 'task', name: '点击匹配项', action: 'input.tap_match', params: { revalidate: true } },
  ], _layout: { r: { x: 30, y: 20 }, seq: { x: 30, y: 130 }, task_1: { x: 30, y: 260 }, task_2: { x: 420, y: 260 } } };
  editor.state.paramRowsExpanded = new Set();
  editor.state.zoom = 1; editor.state.panX = 20; editor.state.panY = 16;
  editor.render();
  const center = (node) => {
    const box = node.getBoundingClientRect();
    return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  };
  const port = document.querySelector('.node[data-id="task_1"] .port-out-reference');
  if (!port) return { error: '缺少输出口' };
  port.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, ...center(port) }));
  // 目标：task_2 的「匹配配置」行（对象参数，数组元素才能进）。
  const field = document.querySelectorAll('.node[data-id="task_2"] .param-row-field')[0];
  if (!field) return { error: '缺少目标行' };
  const box = field.getBoundingClientRect();
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  const move = document.querySelectorAll('.node[data-id="task_2"] .param-row-field')[0];
  move.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: at.clientX, clientY: at.clientY }));
  const hovered = editor.state.referenceConnect && editor.state.referenceConnect.hover ? editor.state.referenceConnect.hover : null;
  const drop = document.querySelectorAll('.node[data-id="task_2"] .param-row-field')[0];
  drop.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1, clientX: at.clientX, clientY: at.clientY }));
  const items = [...document.querySelectorAll('.context-menu-list button')].map((button) => button.textContent);
  const first = [...document.querySelectorAll('.context-menu-list button')][0];
  if (first) first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const task2 = editor.state.raw.nodes.find((node) => node.id === 'task_2');
  const card = document.querySelector('.node[data-id="task_2"]');
  const own = (node) => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join('');
  return {
    hoveredParam: hovered ? hovered.param : null,
    hoveredFields: hovered ? hovered.fields.map((item) => item.field) : null,
    items,
    match: task2.params.match,
    edges: document.querySelectorAll('.reference-edges .reference-edge').length,
    rowValue: own(card.querySelector('.param-row-value')),
    rowTitle: (() => { const title = card.querySelector('.param-row-value').querySelector('title'); return title ? title.textContent : ''; })(),
  };
})()`;

/** 夹具八：必填参数留空 → 该行当场标红（本地校验，不用等宿主推送问题）。 */
const INVALID_ROW_FIXTURE = `(() => {
  const editor = window.__btEditor;
  if (!editor) return null;
  document.querySelectorAll('.context-menu').forEach((node) => node.remove());
  editor.state.catalog = [{ name: 'vision.wait_template', description: '等待模板', parameters: {
      template: { type: 'asset', required: true },
      timeout_seconds: { type: 'duration', required: true, min: 0 },
      present: { type: 'boolean', default: true },
      threshold: { type: 'number', default: 0.85 } },
    inputSchema: { type: 'object', additionalProperties: false, required: ['template', 'timeout_seconds'], properties: {
      template: { type: 'string' },
      timeout_seconds: { type: 'number', minimum: 0 },
      present: { type: 'boolean' },
      threshold: { type: 'number', minimum: 0, maximum: 1 } } },
    card: [
      { param: 'template', label: '模板' },
      { param: 'timeout_seconds', label: '超时' },
      { param: 'present', label: '存在性', on_label: '等待出现', off_label: '等待消失' },
      { param: 'threshold', label: '匹配阈值' }] }];
  editor.state.raw = { schema_version: 4, id: 'verify-invalid', name: 'verify-invalid', root: 'r', inputs: {}, variables: {}, nodes: [
    { id: 'r', type: 'root', name: '根节点', children: ['t'] },
    { id: 't', type: 'task', name: '等待模板', action: 'vision.wait_template', params: { template: 'experience.png' } },
  ], _layout: { r: { x: 30, y: 20 }, t: { x: 30, y: 130 } } };
  editor.state.selected = new Set(['t']);
  editor.state.inspector = 'node';
  editor.state.zoom = 1; editor.state.panX = 24; editor.state.panY = 16;
  editor.state.issues = [];
  editor.render();
  const read = () => {
    const card = document.querySelector('.node[data-id="t"]');
    const rowClass = (name) => [...card.querySelectorAll('.' + name)].map((node) => node.getAttribute('class'));
    return {
      labels: rowClass('param-row-label'),
      fields: rowClass('param-row-field'),
      hits: rowClass('param-row-hit'),
      ports: rowClass('port-variable'),
      card: card.getAttribute('class'),
      badge: document.getElementById('issue-badge').textContent,
    };
  };
  const before = read();
  return {
    before: {
      labelError: before.labels.map((value) => value.includes('error')),
      fieldError: before.fields.map((value) => value.includes('error')),
      hitInvalid: before.hits.map((value) => value.includes('invalid')),
      portInvalid: before.ports.map((value) => value.includes('invalid')),
      cardInvalid: before.card.includes('node-invalid'),
      badge: before.badge,
    },
  };
})()`;

/** 接上一步：走真实的卡片就地编辑把「超时」填上，红色标记与问题计数应该当场消失。 */
const INVALID_ROW_FIXED = `(() => {
  const read = () => {
    const card = document.querySelector('.node[data-id="t"]');
    const rowClass = (name) => [...card.querySelectorAll('.' + name)].map((node) => node.getAttribute('class'));
    return {
      labels: rowClass('param-row-label'),
      badge: document.getElementById('issue-badge').textContent,
    };
  };
  document.querySelector('.node[data-id="t"] .param-row-hit[data-param="timeout_seconds"]')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const input = document.querySelector('.inline-param-editor input');
  if (!input) return { error: '没有打开「超时」的就地编辑器' };
  input.value = '10';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const after = read();
  return { labelError: after.labels.map((value) => value.includes('error')), badge: after.badge };
})()`;

/** 夹具九：同一个变量连到两个节点，详情栏说明必须一致（连线映射缺项也不该有两种说法）。 */
const VARIABLE_NOTE_FIXTURE = `(() => {
  const editor = window.__btEditor;
  if (!editor) return null;
  document.querySelectorAll('.context-menu').forEach((node) => node.remove());
  editor.state.catalog = [
    { name: 'core.sleep', parameters: { seconds: { type: 'duration', required: true, min: 0 } },
      inputSchema: { type: 'object', required: ['seconds'], properties: { seconds: { type: 'number' } } },
      card: [{ param: 'seconds', label: '等待时长（秒）' }] },
  ];
  editor.state.raw = { schema_version: 4, id: 'verify-note', name: 'verify-note', root: 'r',
    inputs: {}, variables: { 时长: { type: 'number', default: 1, display_name: '时长（秒）' } },
    _variableCards: { card_1: { name: '时长', scope: 'variables', x: 20, y: 300 } },
    // tap 有连线项（还指向了已删卡片 card_9），tap_1 完全没有——两种情况都得说同一句话。
    _variableLinks: { 'tap:seconds': 'card_9' },
    nodes: [
      { id: 'r', type: 'root', name: '根节点', children: ['seq'] },
      { id: 'seq', type: 'sequence', name: '顺序', children: ['tap', 'tap_1'] },
      { id: 'tap', type: 'task', name: '点击挑战按钮', action: 'core.sleep', params: { seconds: { ref: 'variables.时长' } } },
      { id: 'tap_1', type: 'task', name: '点击挑战按钮', action: 'core.sleep', params: { seconds: { ref: 'variables.时长' } } },
    ], _layout: { r: { x: 30, y: 20 }, seq: { x: 30, y: 120 }, tap: { x: 30, y: 240 }, tap_1: { x: 380, y: 240 } } };
  editor.state.paramRowsExpanded = new Set();
  editor.state.zoom = 1; editor.state.panX = 20; editor.state.panY = 16;
  editor.state.inspector = 'node';
  const noteFor = (id) => {
    editor.state.selected = new Set([id]);
    editor.render();
    const note = document.querySelector('#inspector-body .parameter-bound-note');
    return note ? { text: note.textContent, title: note.title } : null;
  };
  const first = noteFor('tap');
  // 真实的复制粘贴：粘贴出来的节点带着变量引用，但连线项是按节点 id 记的——
  // 不补上的话它只会显示「已连接引用」，和原节点说法不一样。
  editor.state.selected = new Set(['tap']);
  editor.copySelection();
  editor.pasteClipboard({ x: 380, y: 240 });
  const pasted = editor.state.raw.nodes.find((node) => node.id !== 'tap' && node.id.startsWith('tap_'));
  const second = noteFor(pasted.id);
  const own = (node) => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join('');
  return {
    first,
    second,
    pastedId: pasted.id,
    link: editor.state.raw._variableLinks[pasted.id + ':seconds'] || '',
    rows: own(document.querySelector('.node[data-id="' + pasted.id + '"] .param-row-value')),
  };
})()`;

const OPEN_NUMBER_EDITOR = `(() => {
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="random_offset"]');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const input = document.querySelector('.inline-param-editor input');
  return input ? { type: input.type, value: input.value, focused: document.activeElement === input } : null;
})()`;

/** 点固定长度数组那一行：浮层里应该是并排的两个输入格，逐格与卡片上的格子重合。 */
const OPEN_TUPLE_EDITOR = `(() => {
  const row = document.querySelector('.node[data-id="t"] .param-row-hit[data-param="random_interval"]');
  if (!row) return null;
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 600 }));
  const shell = document.querySelector('.inline-param-editor');
  if (!shell) return null;
  const inputs = [...shell.querySelectorAll('input')];
  const cells = [...document.querySelectorAll('.node[data-id="t"] .param-row-cell')];
  const rects = (nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)];
  });
  return {
    shellClass: shell.className,
    values: inputs.map((input) => input.value),
    types: inputs.map((input) => input.type),
    textAlign: inputs.map((input) => getComputedStyle(input).textAlign),
    inputs: rects(inputs),
    cells: rects(cells),
    focused: document.activeElement === inputs[0],
  };
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

    // 固定卡片：清单声明 card.rows 后，卡片端点固定、双行行样式、整行可点。
    let fixed = null;
    for (let attempt = 0; attempt < 20 && !fixed; attempt += 1) {
      await wait(150);
      fixed = await client.evaluate(FIXED_CARD_FIXTURE);
    }
    assert.ok(fixed, '固定卡片夹具未渲染');
    assert.deepEqual(fixed.labels, ['模板', '超时', '存在性', '识别区域', '匹配阈值', '多尺度搜索'], '固定卡片按清单顺序显示六个端点');
    assert.equal(fixed.hitParams.join(','), 'template,timeout_seconds,present,roi,threshold,scale_search', '每个端点一个行热区');
    assert.equal(fixed.pins, 6, '每个端点仍是变量端点');
    assert.equal(fixed.height, 96 + 6 * 40, '固定卡片用双行行高：96 + 6 * 40');
    assert.equal(fixed.caret, 0, '固定卡片没有折叠箭头');
    assert.equal(fixed.meta, '6 项端点 · 卡片直接设置');
    assert.deepEqual(fixed.values.map(([text]) => text), ['battle.png', '未设置', '等待出现', '60,120 200×80', '0.85', '关闭'], '固定卡片的值文本');
    assert.deepEqual(fixed.values.map(([, anchor, x]) => [anchor, x]),
      [['start', '31'], ['start', '31'], ['start', '48'], ['start', '31'], ['start', '31'], ['start', '48']],
      '值文字在框内 9px 内边距处左对齐（布尔行的状态文字跟在勾选框后）');
    assert.deepEqual(fixed.labelYs, ['109', '149', '189', '229', '269', '309'], '标签行逐行下移 40，并在自己的带内居中');
    assert.deepEqual(fixed.values.map(([, , , y]) => y), ['127', '167', '207', '247', '287', '327'], '值行贴着标签下方');
    assert.deepEqual(fixed.checks, [true, false], '两个布尔行的勾选状态');
    // 视觉对齐：表头说明行、端点标签、值行输入框同在 x=22 那条线上，标题跟在图标后（39）。
    assert.deepEqual(fixed.contentXs, { kicker: '22', subtitle: '22', meta: '22', title: '39', label: '22' }, '卡片文字列对齐');
    // 值行是可见的输入框/控件：每行一个框，几何与热区完全重合。
    assert.equal(fixed.fields.length, 6, '每个端点都有值行输入框');
    assert.deepEqual(fixed.fields.map(([x, y, width, height]) => [x, y, width, height]),
      [['22', '115', '111', '18'], ['22', '155', '111', '18'], ['22', '195', '111', '18'],
        ['22', '235', '111', '18'], ['22', '275', '111', '18'], ['22', '315', '111', '18']], '值行输入框统一占一格（111）');
    assert.deepEqual(fixed.fields.map(([, , , , className]) => className.replace('param-row-field', '').trim()),
      ['opens-picker', '', '', 'opens-picker', '', ''],
      '留在卡片上改的行用实线框，需要弹选择器的行标 opens-picker');
    assert.deepEqual(fixed.hitBoxes.map(([x, y, width, height]) => [x, y, width, height]),
      fixed.fields.map(([x, y, width, height]) => [x, y, width, height]), '点击热区与输入框同矩形');
    assert.deepEqual(fixed.hitBoxes.map(([, , , , picker]) => picker), [true, false, false, true, false, false], '需要弹选择器的行是手型光标');
    assert.deepEqual(fixed.carets, [['›', '124'], ['›', '124']], '模板与识别区域给出 › 提示（贴在一格值框右缘）');
    await client.screenshot(path.join(ARTIFACTS, 'card-fixed-layout-dark.png'));

    // 点值框：行内浮层落在同一个矩形上、文字同样左对齐，读起来像框本身获得焦点。
    const editing = await client.evaluate(OPEN_TIMEOUT_EDITOR);
    assert.ok(editing, '数字行的值框没有打开行内编辑器');
    assert.equal(editing.shellClass, 'inline-param-editor value-align-left');
    assert.equal(editing.textAlign, 'left', '浮层文字与卡片上的值同样左对齐');
    assert.equal(editing.value, '', '超时未设置时初值为空');
    assert.equal(editing.focused, true);
    assert.deepEqual(editing.shell, editing.box, '浮层贴在值框的同一个矩形上');
    await client.screenshot(path.join(ARTIFACTS, 'card-fixed-editing-dark.png'));
    await client.evaluate("document.querySelector('.inline-param-editor input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

    const templateMenu = await client.evaluate(OPEN_TEMPLATE_MENU);
    assert.equal(templateMenu.hasEditor, false, '模板行走菜单，不生成输入框');
    assert.deepEqual(templateMenu.items, ['更换模板图…', '从当前画面截取…', '清除本行取值', '在详情栏编辑'], '模板行菜单：卡片上直接选图或截图截取');
    await client.screenshot(path.join(ARTIFACTS, 'card-fixed-template-menu-dark.png'));

    const roiMenu = await client.evaluate(OPEN_ROI_MENU);
    assert.deepEqual(roiMenu.items, ['在当前画面上框选…', '手动输入四坐标…', '清除本行取值', '在详情栏编辑'], '区域行菜单：卡片上直接框选或手输');
    await client.screenshot(path.join(ARTIFACTS, 'card-fixed-roi-menu-dark.png'));

    const roiCommit = await client.evaluate(COMMIT_ROI_MANUAL);
    assert.ok(!roiCommit.error, roiCommit.error || '');
    assert.deepEqual(roiCommit.labels, ['X', 'Y', '宽', '高'], '区域手输用四个坐标输入框');
    assert.deepEqual(roiCommit.initial, ['60', '120', '200', '80'], '初值来自当前区域');
    assert.deepEqual(roiCommit.committed, [60, 120, 560, 320], '回车一次提交整个区域');
    assert.equal(roiCommit.closed, true, '提交后浮层收起');
    assert.equal(roiCommit.value, '60,120 560×320', '卡片上的区域值同步更新');
    assert.equal(roiCommit.height, 96 + 6 * 40, '改值不改变卡片高度');

    const toggled = await client.evaluate(TOGGLE_PRESENT);
    assert.equal(toggled.value, false, '点击布尔行立即切换');
    assert.equal(toggled.values[2], '等待消失', '布尔值文本跟 on_label/off_label 走');
    assert.equal(toggled.height, 96 + 6 * 40, '切换不改变卡片高度');

    // 区域行：框只有一格宽，四个坐标输入的浮层要横跨整行值区，输入等分宽度。
    const rectInputs = await client.evaluate(OPEN_RECT_INPUTS);
    assert.ok(!rectInputs.error, rectInputs.error || '');
    assert.deepEqual(rectInputs.values, ['60', '120', '560', '320']);
    assert.equal(rectInputs.shellLeft, rectInputs.boxLeft, '浮层左缘仍贴在值框上');
    assert.equal(rectInputs.shellWidth, rectInputs.boxWidth * 2 + 4, '浮层横跨整行值区（两格 + 间距）');
    assert.ok(rectInputs.widths.every((width) => width > 24), `四个坐标输入都要能输入：${rectInputs.widths.join(',')}`);
    await client.screenshot(path.join(ARTIFACTS, 'card-fixed-rect-editing-dark.png'));
    await client.evaluate("document.querySelector('.inline-param-editor input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

    await client.evaluate("window.StudioTheme && window.StudioTheme.set('light')");
    await wait(250);
    await client.evaluate(FIXED_CARD_FIXTURE);
    await wait(150);
    await client.screenshot(path.join(ARTIFACTS, 'card-fixed-layout-light.png'));
    await client.evaluate("window.StudioTheme && window.StudioTheme.set('dark')");
    await client.evaluate("document.querySelector('.context-menu')?.remove()");

    // 点击匹配项：9 个端点全部是可见输入框，对象/数组行用虚线框提示要去详情栏。
    let tapMatch = null;
    for (let attempt = 0; attempt < 20 && !tapMatch; attempt += 1) {
      await wait(150);
      tapMatch = await client.evaluate(FIXED_TAP_MATCH_FIXTURE);
    }
    assert.ok(tapMatch, '点击匹配项夹具未渲染');
    assert.deepEqual(tapMatch.labels, ['匹配配置', '重新校验', '确认模板消失', '确认消失超时（秒）', '消失状态超时（秒）', '按压时长（毫秒）', '随机偏移（px）', '随机间隔（秒）', '消失状态列表']);
    assert.deepEqual(tapMatch.values, ['{2 字段}', '校验', '校验', '8s', '0s', '0', '25', '0.2', '0.6', '[0 项]'], '随机间隔拆成两个输入格，各显示自己的元素');
    assert.deepEqual(tapMatch.cells.map(([x, , width, height]) => [x, width, height]),
      [['22', '53.5', '18'], ['79.5', '53.5', '18']], '两个小格挤在一个值框里，中间 4px 间隔');
    assert.equal(tapMatch.cells[0][1], tapMatch.cells[1][1], '两个输入格在同一行');
    assert.equal(Number(tapMatch.cells[0][0]) + 53.5 * 2 + 4, 22 + 111, '两个小格的总宽度不超过一个值框');
    // 所有单值框都是同一格宽；数组的小格只在那一格里再分。
    assert.deepEqual(tapMatch.cellWidths, { match: '111', revalidate: '111', verifyGone: '111', interval: '53.5' }, '单值框同宽，数组小格在一格内再分');
    assert.deepEqual(tapMatch.fields,
      ['goes-inspector opens-picker', '', '', '', '', '', '', 'param-row-cell', 'param-row-cell', 'goes-inspector opens-picker'],
      '对象/数组行虚线框，布尔与数值行实线框，固定长度数组两个格子');
    assert.equal(tapMatch.carets, 2, '需要弹菜单/详情栏的行都有 ›（输入格不画）');
    assert.equal(tapMatch.height, 96 + 9 * 40, '9 个端点：96 + 9 * 40');
    assert.equal(tapMatch.meta, '9 项端点 · 卡片直接设置');
    await client.screenshot(path.join(ARTIFACTS, 'card-fixed-tap-match-dark.png'));
    // 固定长度数组（随机间隔）：点行开两个输入格，逐格与卡片上的格子重合。
    const tuple = await client.evaluate(OPEN_TUPLE_EDITOR);
    assert.ok(tuple, '固定长度数组没有打开行内编辑器');
    assert.equal(tuple.shellClass, 'inline-param-editor value-align-left inline-param-tuple');
    assert.deepEqual(tuple.values, ['0.2', '0.6'], '每格显示自己的元素');
    assert.deepEqual(tuple.types, ['number', 'number']);
    assert.deepEqual(tuple.textAlign, ['left', 'left']);
    assert.equal(tuple.focused, true);
    assert.deepEqual(tuple.inputs, tuple.cells, '浮层输入格与卡片输入格逐格重合');
    await client.screenshot(path.join(ARTIFACTS, 'card-fixed-tuple-editing-dark.png'));
    await client.evaluate("document.querySelector('.inline-param-editor input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await client.evaluate("window.StudioTheme && window.StudioTheme.set('light')");
    await wait(250);
    await client.evaluate(FIXED_TAP_MATCH_FIXTURE);
    await wait(150);
    await client.screenshot(path.join(ARTIFACTS, 'card-fixed-tap-match-light.png'));
    await client.evaluate("window.StudioTheme && window.StudioTheme.set('dark')");

    // 节点输出引用：从任务卡右侧输出口拖到另一个节点的参数行。
    let reference = null;
    for (let attempt = 0; attempt < 20 && !reference; attempt += 1) {
      await wait(150);
      reference = await client.evaluate(REFERENCE_DRAG_FIXTURE);
    }
    assert.ok(reference, '节点输出引用夹具未渲染');
    assert.ok(!reference.error, reference.error || '');
    assert.equal(reference.dragging, true, '按下输出口即进入引用拖拽');
    assert.equal(reference.preview, 1, '拖拽中画虚线预览');
    assert.equal(reference.hovered, 'timeout_seconds', '按行带命中光标所在的那一行（不是最近的引脚）');
    assert.deepEqual(reference.fields, ['confidence'], '该行只接受 confidence');
    assert.deepEqual(reference.highlight, { card: true, row: [false, true, false, false, false] }, '拖拽中卡片亮起、落点行也亮起');
    assert.equal(reference.textParam, undefined, '不能乱吸到第 1 行（text）');
    assert.deepEqual(reference.timeoutParam, { ref: 'nodes.detect.output.confidence' }, '落点写入该行的引用');
    assert.equal(reference.cleared, true, '落点后清掉拖拽状态');
    assert.equal(reference.edges, 1, '引用边渲染成虚线');
    assert.match(reference.rowValue, /^← 识别当前页面/, '参数行显示源节点名');
    assert.match(reference.rowTitle, /识别当前页面状态\.confidence（nodes\.detect\.output\.confidence）/, '悬停提示给出显示名与完整引用');
    assert.equal(reference.rowTone.includes('tone-bound'), true);
    // 输出口右键：列出输出字段的引用，并提供一次性断开全部引用。
    const portMenu = await client.evaluate(OPEN_REFERENCE_PORT_MENU);
    assert.deepEqual(portMenu.items, [
      '从这里开始连线（绑定到参数）',
      '复制引用：nodes.detect.output.state',
      '复制引用：nodes.detect.output.confidence',
      '断开全部输出引用（1 处）',
    ], '输出口菜单列出输出字段引用');
    await client.evaluate("document.querySelector('.context-menu')?.remove()");
    await client.screenshot(path.join(ARTIFACTS, 'card-reference-port-dark.png'));
    await client.evaluate("window.StudioTheme && window.StudioTheme.set('light')");
    await wait(250);
    await client.evaluate(REFERENCE_DRAG_FIXTURE);
    await wait(150);
    await client.screenshot(path.join(ARTIFACTS, 'card-reference-port-light.png'));
    await client.evaluate("window.StudioTheme && window.StudioTheme.set('dark')");

    // 数组输出 → 单个对象参数：不再「连不上」，而是给出「第 N 项」让你挑。
    let arrayRef = null;
    for (let attempt = 0; attempt < 20 && !arrayRef; attempt += 1) {
      await wait(150);
      arrayRef = await client.evaluate(ARRAY_REFERENCE_FIXTURE);
    }
    assert.ok(arrayRef, '数组引用夹具未渲染');
    assert.ok(!arrayRef.error, arrayRef.error || '');
    assert.equal(arrayRef.hoveredParam, 'match', '落在「匹配配置」这一行上');
    assert.deepEqual(arrayRef.hoveredFields, ['0', '1', '2', '3'], '数组输出给出前四项候选');
    assert.deepEqual(arrayRef.items, [
      '第 1 项（nodes.task_1.output.0）',
      '第 2 项（nodes.task_1.output.1）',
      '第 3 项（nodes.task_1.output.2）',
      '第 4 项（nodes.task_1.output.3）',
    ], '落点多候选项时弹菜单让用户挑第几项');
    assert.deepEqual(arrayRef.match, { ref: 'nodes.task_1.output.0' }, '选第 1 项后写入下标引用');
    assert.equal(arrayRef.edges, 1, '引用边照样渲染');
    assert.match(arrayRef.rowValue, /^← 等待模板\[0\]/, '参数行显示「节点名[下标]」');
    assert.match(arrayRef.rowTitle, /nodes\.task_1\.output\.0/, '悬停提示给出完整引用');
    await client.screenshot(path.join(ARTIFACTS, 'card-reference-array-dark.png'));
    await client.evaluate("document.querySelector('.context-menu')?.remove()");

    // 必填参数留空 → 出错的那一行当场标红；填上后错误消失、徽标归零。
    let invalid = null;
    for (let attempt = 0; attempt < 20 && !invalid; attempt += 1) {
      await wait(150);
      invalid = await client.evaluate(INVALID_ROW_FIXTURE);
    }
    assert.ok(invalid, '错误标记夹具未渲染');
    assert.deepEqual(invalid.before.labelError, [false, true, false, false], '只有「超时」这一行的标签标红');
    assert.deepEqual(invalid.before.fieldError, [false, true, false, false], '值框跟着标红');
    assert.deepEqual(invalid.before.hitInvalid, [false, true, false, false], '热区跟着标红');
    assert.deepEqual(invalid.before.portInvalid, [false, true, false, false], '引脚跟着标红');
    assert.equal(invalid.before.badge, '1 个问题', '本地校验计入问题徽标');
    await client.screenshot(path.join(ARTIFACTS, 'card-invalid-row-dark.png'));
    const repaired = await client.evaluate(INVALID_ROW_FIXED);
    assert.ok(!repaired.error, repaired.error || '');
    assert.deepEqual(repaired.labelError, [false, false, false, false], '补上必填后不再标红');
    assert.equal(repaired.badge, '结构有效');

    // 同一个变量的两种绑定写法（有连线项/没连线项、指向已删卡片）：说明必须一致。
    let note = null;
    for (let attempt = 0; attempt < 20 && !note; attempt += 1) {
      await wait(150);
      note = await client.evaluate(VARIABLE_NOTE_FIXTURE);
    }
    assert.ok(note, '变量说明夹具未渲染');
    assert.equal(note.first.text, note.second.text, '复制出来的节点与前一个节点的绑定说明必须一致');
    assert.match(note.first.text, /^已连接变量 时长（秒）（在画布上管理）$/, '说明用变量显示名，不显示卡片 id');
    assert.equal(note.first.title, 'variables.时长', '悬停给出引用原文');
    assert.ok(!/card_/.test(note.first.text), '不把卡片 id 写进说明');
    assert.equal(note.link, 'card_1', '粘贴节点补上连线项');
    assert.equal(note.rows, '← 时长（秒）', '参数行也显示变量名');
    await client.screenshot(path.join(ARTIFACTS, 'card-variable-note-dark.png'));

    // 端点右键「提升为变量」：变量定义要带上结构，详情栏才能给结构化控件。
    await client.evaluate("document.querySelector('.context-menu')?.remove()");

    // 切换任务动作：卡片要当场换成新动作的端点（不等下一次重绘）。
    let switched = null;
    for (let attempt = 0; attempt < 20 && !switched; attempt += 1) {
      await wait(150);
      switched = await client.evaluate(SWITCH_ACTION_FIXTURE);
    }
    assert.ok(switched, '切换动作夹具未渲染');
    assert.ok(!switched.error, switched.error || '');


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
    console.log(`  固定卡片：${fixed.labels.join(' / ')} → ${fixed.values.map(([text]) => text).join(' / ')}`);
    console.log(`  固定卡片就地编辑：区域手动输入 → ${JSON.stringify(roiCommit.committed)}；存在性切换 → ${toggled.value}；值框聚焦对齐 → ${editing.shell.join(',')}`);
    console.log(`  点击匹配项（9 端点）：${tapMatch.labels.join(' / ')}`);
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