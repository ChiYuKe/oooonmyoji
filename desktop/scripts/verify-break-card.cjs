/**
 * 拆分卡片（`break`）验收：在无头 Chrome 里加载构建产物，注入一份带输出 schema 的夹具，
 * 断言卡片按 UE Break 的排法渲染——左侧「拆分来源」输入引脚、右缘逐行字段输出引脚、
 * 两边同一套行网格、行内不画参数值——并输出截图。
 *
 * 用法：npm run build && node scripts/verify-break-card.cjs
 * 截图输出：artifacts/break-card-*.png
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

/** 极简 CDP 客户端：只用到 Runtime.evaluate 与 Page.captureScreenshot。 */
class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.logs = [];
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
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

/**
 * 夹具：一张识别卡片（object 输出）+ 一张拆分卡片（绑整体输出）+ 一个消费参数。
 * 断言取的是卡片真实几何：字段引脚 cy 必须落在行网格上，且与左侧输入引脚同一行。
 */
const FIXTURE = `(() => {
  const editor = window.__btEditor;
  if (!editor) return null;
  document.querySelectorAll('.context-menu').forEach((node) => node.remove());
  editor.state.catalog = [{
    name: 'vision.detect_state',
    parameters: { states: { type: 'array', required: true }, allow_ocr: { type: 'boolean', default: true } },
    outputSchema: { type: 'object', properties: {
      state: { type: 'string' }, source: { type: 'string' }, confidence: { type: 'number' },
      match: { type: 'object' }, elapsed_seconds: { type: 'number' } } },
  }];
  editor.state.raw = { schema_version: 4, id: 'verify-break', name: 'verify-break', root: 'r',
    inputs: { 识别区域: { type: 'rect', default: [720, 973, 486, 107] }, 运行中: { type: 'boolean', default: true } }, variables: {}, nodes: [
    { id: 'r', type: 'root', name: '根节点', children: ['seq'] },
    { id: 'seq', type: 'sequence', name: '完成一轮战斗', children: ['detect', 'b1', 'b2', 'bool_1', 'bool_and', 'bool_ref'] },
    { id: 'detect', type: 'task', name: '识别当前页面', action: 'vision.detect_state', params: { states: [{ name: '战斗中' }], allow_ocr: false } },
    // b1 故意不设 name：标题按 UE 派生为 Break + 来源名（K2Node_BreakStruct 的 Break <Struct>），
    // 稳定 ID 只留在悬停提示里。b2 设了 name，用它验证手动显示名仍然优先。
    { id: 'b1', type: 'break', ref: { ref: 'nodes.detect.output' } },
    // 区域是定长四元组：拆出来就是 X / Y / W / H 四个分量。
    { id: 'b2', type: 'break', name: '拆分识别区域', ref: { ref: 'inputs.识别区域' } },
    // 布尔判断卡片：两个操作数引脚各自内联显示值（UE 的引脚默认值），运算符走节点菜单。
    // 同样不设 name：标题就是运算符名（UE 的比较节点标题 Equal / Greater …）。
    { id: 'bool_1', type: 'bool_judge', expression: { gt: [{ ref: 'nodes.b2.output.2' }, 400] } },
    // 嵌套条件：卡面只回读整句（没有操作数格、没有输入引脚），编辑走「嵌套条件（进阶）」浮层。
    { id: 'bool_and', type: 'bool_judge', expression: { and: [
      { eq: [{ ref: 'nodes.detect.output.state' }, '战斗中'] },
      { gt: [{ ref: 'nodes.b2.output.2' }, 400] },
    ] } },
    // 整卡绑定一个 bool 来源：只有一个布尔输入口 + 「← 来源」回读。
    { id: 'bool_ref', type: 'bool_judge', expression: { ref: 'inputs.运行中' } },
  ], _layout: { r: { x: 40, y: 20 }, seq: { x: 40, y: 120 }, detect: { x: 40, y: 220 }, b1: { x: 440, y: 100 }, b2: { x: 440, y: 330 }, bool_1: { x: 820, y: 60 }, bool_and: { x: 820, y: 260 }, bool_ref: { x: 820, y: 430 } } };
  editor.state.paramRowsExpanded = new Set(['detect']);
  editor.state.zoom = 1; editor.state.panX = 20; editor.state.panY = 10;  editor.render();
  const group = document.querySelector('.node[data-id="b1"]');
  if (!group) return null;
  const own = (node) => node ? [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join('') : '';
  const cy = (node) => Number(node.getAttribute('cy'));
  const area = document.querySelector('.node[data-id="b2"]');
  const boolCard = document.querySelector('.node[data-id="bool_1"]');
  const nestedCard = document.querySelector('.node[data-id="bool_and"]');
  const boundCard = document.querySelector('.node[data-id="bool_ref"]');
  const detectCard = document.querySelector('.node[data-id="detect"]');
  const text = (card, selector) => own(card.querySelector(selector));
  const tint = (card) => getComputedStyle(card).getPropertyValue('--card-tint').trim();
  return {
    title: own(group.querySelector('.card-title')),
    // 卡片自己的悬停提示（卡片里还有若干截断提示用的 <title>，按含 ID 行挑出来）。
    tip: [...group.querySelectorAll('title')].map((node) => node.textContent).find((text) => text.includes('ID: ')) || null,
    namedTitle: area ? own(area.querySelector('.card-title')) : null,
    boolTitle: boolCard ? own(boolCard.querySelector('.card-title')) : null,
    // 嵌套条件卡：只有回读行 + 提示，没有操作数格 / 热区 / 输入引脚 / 运算符符号。
    nested: nestedCard ? {
      title: text(nestedCard, '.card-title'),
      readback: text(nestedCard, '.value-card-readback'),
      tip: [...nestedCard.querySelectorAll('title')].map((node) => node.textContent).join('\\n'),
      hint: text(nestedCard, '.value-card-hint'),
      operandBoxes: nestedCard.querySelectorAll('.bool-judge-operand-field').length,
      operandHits: nestedCard.querySelectorAll('.bool-judge-operand-hit').length,
      inputs: nestedCard.querySelectorAll('.bool-judge-input').length,
      operator: text(nestedCard, '.bool-judge-operator'),
      outputLabel: text(nestedCard, '.bool-judge-output-label'),
    } : null,
    // 整卡绑定 bool 来源：一个布尔口（cy 64）+ 「← 来源」回读。
    bound: boundCard ? {
      title: text(boundCard, '.card-title'),
      readback: text(boundCard, '.value-card-readback'),
      inputs: [...boundCard.querySelectorAll('.bool-judge-input')].map((node) => ({ param: node.getAttribute('data-param'), cy: Number(node.getAttribute('cy')) })),
      operandBoxes: boundCard.querySelectorAll('.bool-judge-operand-field').length,
    } : null,
    // 值卡片配色必须与执行流卡片分开（分类色只落在标题带/色条/图标上）。
    tints: {
      bool: boolCard ? tint(boolCard) : null,
      break: tint(group),
      nested: nestedCard ? tint(nestedCard) : null,
      task: detectCard ? tint(detectCard) : null,
    },
    height: Number(group.querySelector('.card-body').getAttribute('height')),
    sourcePinY: cy(group.querySelector('.port-variable')),
    sourceLabel: own(group.querySelector('.param-row-label')),
    fieldPins: [...group.querySelectorAll('.port-out-field')].map((node) => ({ field: node.getAttribute('data-field'), y: cy(node) })),
    fieldLabels: [...group.querySelectorAll('.port-label-field')].map((node) => own(node)),
    valueRows: group.querySelectorAll('.param-row-value').length,
    genericPorts: group.querySelectorAll('.port-out-reference:not(.port-out-field)').length,
    meta: own(group.querySelector('.node-meta')),
    // 区域输入（rect 定长四元组）拆出来的四个分量。
    areaLabels: area ? [...area.querySelectorAll('.port-label-field')].map((node) => own(node)) : null,
    areaHeight: area ? Number(area.querySelector('.card-body').getAttribute('height')) : null,
    areaPins: area ? [...area.querySelectorAll('.port-out-field')].map((node) => node.getAttribute('data-field')) : null,
  };
})()`;

async function main() {
  assert.ok(fs.existsSync(path.join(DIST, 'canvas.html')), '缺少构建产物，请先执行 npm run build');
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const server = await serveDist();
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-break-'));
  const debugPort = 9900 + Math.floor(Math.random() * 400);
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

    let shape = null;
    for (let attempt = 0; attempt < 40 && !shape; attempt += 1) {
      await wait(250);
      shape = await client.evaluate(FIXTURE);
    }
    assert.ok(shape, '画布编辑器未就绪（__btEditor 缺失）');

    // UE Break 的排法：左侧一个输入引脚，右缘逐行字段引脚，两边同一套行网格。
    console.log('PROBE', JSON.stringify(await client.evaluate(`(() => {
      const card = document.querySelector('.node[data-id="bool_and"]');
      const hit = card.querySelector('.value-card-readback-hit');
      const line = card.querySelector('.value-card-readback');
      const style = (node) => node ? { fill: getComputedStyle(node).fill, pointerEvents: getComputedStyle(node).pointerEvents, display: getComputedStyle(node).display, text: node.textContent } : null;
      return { theme: document.documentElement.getAttribute('data-theme'), hit: style(hit), line: style(line), order: [...card.children].map((n) => n.getAttribute('class') || n.tagName).slice(-6) };
    })()`)));
    assert.equal(shape.sourceLabel, '拆分来源', '左侧输入引脚带「拆分来源」行标签');
    // 标题按 UE 派生：`Break <来源名>` / 运算符名；手动 name 仍然优先；稳定 ID 只在悬停提示里。
    assert.equal(shape.title, 'Break 识别当前页面', '值卡片标题由类型派生，不裸露 break_1');
    assert.match(shape.tip, /\nID: b1/, '稳定 ID 留在悬停提示里');    assert.equal(shape.namedTitle, '拆分识别区域', '手动设过的 name 优先于派生标题');
    assert.equal(shape.boolTitle, '大于', '布尔判断卡标题是运算符名（UE 的比较节点标题）');
    // 嵌套条件与整卡绑定不再假装是「两个操作数」的比较节点（幽灵 0 操作数 + 悬空行内编辑器就是这么来的）。
    assert.equal(shape.nested.title, '并且', '嵌套卡标题是根运算符');
    assert.equal(shape.nested.operandBoxes, 0, '嵌套卡不画操作数格');
    assert.equal(shape.nested.operandHits, 0, '嵌套卡没有可编辑热区');
    assert.equal(shape.nested.inputs, 0, '嵌套卡没有输入引脚');
    assert.equal(shape.nested.operator, '', '嵌套卡不画运算符符号');
    assert.equal(shape.nested.outputLabel, 'bool');
    assert.match(shape.nested.readback, /^（识别当前页面/, '卡面回读整句中文（一行放不下就让出 bool 标签并截断）');
    assert.match(shape.nested.tip, /等于 “战斗中” 并且 .*大于 400/, '完整回读留在悬停提示里');
    assert.equal(shape.nested.hint, '点这一行改嵌套条件');
    assert.deepEqual(shape.bound.inputs, [{param: 'condition', cy: 64}], '整卡绑定只有一个布尔口');
    assert.equal(shape.bound.operandBoxes, 0);
    assert.equal(shape.bound.readback, '← 运行中', '绑定卡回读来源名');
    // 值卡片用自己那一档分类色：与执行流卡片（Task）明确分开。
    assert.notEqual(shape.tints.bool, shape.tints.task, '布尔判断卡配色区别于任务卡');
    assert.notEqual(shape.tints.break, shape.tints.task, '拆分卡配色区别于任务卡');
    assert.notEqual(shape.tints.bool, shape.tints.break, '两类值卡片彼此也区分');
    assert.equal(shape.tints.bool, shape.tints.nested, '同一类型的值卡片配色一致');
    assert.equal(shape.sourcePinY, 96 + 12, '输入引脚落在第 1 行中线');
    assert.deepEqual(shape.fieldPins.map((pin) => pin.field), ['state', 'source', 'confidence', 'match', 'elapsed_seconds']);
    assert.deepEqual(shape.fieldPins.map((pin) => pin.y), [108, 132, 156, 180, 204], '字段引脚逐行排在行网格上');
    assert.equal(shape.fieldPins[0].y, shape.sourcePinY, '第 1 个字段引脚与输入引脚同一行');
    // 字段名沿用输出 schema 的字段名（认识的字段给中文标签，其余保持原名）。
    assert.deepEqual(shape.fieldLabels, ['state', 'source', 'confidence', '匹配配置', 'elapsed_seconds']);
    assert.equal(shape.valueRows, 0, '拆分卡片的行不画参数值（右半行留给字段引脚）');
    assert.equal(shape.genericPorts, 0, '有字段引脚时不再画通用输出口');
    assert.equal(shape.height, 96 + 5 * 24, '卡片高度 = 头部 + 5 行（与 nodeHeight 公式一致）');
    assert.equal(shape.meta, '', '拆分卡片不画参数摘要行');
    // 区域 rect（定长四元组）来源：自动拆成 X / Y / W / H 四个分量引脚。
    assert.deepEqual(shape.areaPins, ['0', '1', '2', '3']);
    assert.deepEqual(shape.areaLabels, ['X', 'Y', 'W', 'H']);
    assert.equal(shape.areaHeight, 96 + 4 * 24, '四个分量 → 四行高度');
    await client.screenshot(path.join(ARTIFACTS, 'break-card-dark.png'));

    // UE 的节点菜单：值卡片的设置不在详情面板，而在节点右键菜单里。
    const topButtons = `[...document.querySelector('.context-menu').querySelectorAll('button')].map((child) => child.textContent.replace('▸', '').trim())`;
    const breakMenu = await client.evaluate(`(() => {
      document.querySelectorAll('.context-menu').forEach((node) => node.remove());
      const card = document.querySelector('.node[data-id="b2"] .card-body') || document.querySelector('.node[data-id="b2"]');
      if (!card) return { error: 'no card', html: document.querySelectorAll('.node').length };
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 560, clientY: 420 }));
      const panel = document.querySelector('.context-menu');
      return { buttons: panel ? ${topButtons} : null, card: card.getAttribute('class'), logs: 'see node' };
    })()`);
    if (!breakMenu || !breakMenu.buttons) {
      throw new Error(`节点菜单没打开：${JSON.stringify(breakMenu)} logs=${JSON.stringify(client.logs.slice(-3))}`);
    }
    assert.deepEqual(breakMenu.buttons, ['更改拆分来源', '断开拆分来源', '拆分字段（进阶）…'], 'UE 的结构体选择放在节点菜单里');
    assert.equal(await client.evaluate(`document.getElementById('inspector').classList.contains('hidden')`), true, '值卡片选中/右键都不打开详情面板');
    await wait(200);
    await client.screenshot(path.join(ARTIFACTS, 'break-card-menu-dark.png'));

    // 进阶入口（UE 没有的 fields 映射）：从节点菜单打开，面板里只有进阶内容（无名称/来源输入）。
    const advanced = await client.evaluate(`(() => {
      const button = [...document.querySelector('.context-menu').querySelectorAll('button')].find((child) => child.textContent.includes('拆分字段'));
      if (!button) return null;
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const panel = document.querySelector('.value-card-editor');
      if (!panel) return null;
      const own = (node) => node ? [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join('') : '';
      return {
        kind: own(panel.querySelector('.value-card-editor-kind')),
        title: own(panel.querySelector('.value-card-editor-title')),
        sourceHint: panel.querySelector('.field-hint') ? panel.querySelector('.field-hint').textContent : null,
        section: panel.querySelector('.section-header') ? panel.querySelector('.section-header').textContent : null,
        inputs: panel.querySelectorAll('.value-card-editor-body input').length,
      };
    })()`);
    assert.ok(advanced, '节点菜单的进阶入口应该打开编辑器');
    assert.equal(advanced.kind, '拆分');
    assert.equal(advanced.title, '拆分识别区域');
    assert.equal(advanced.sourceHint, '拆分来源：变量 · 识别区域（右键卡片可更改）', '来源只回读');
    assert.equal(advanced.section, '拆分字段（未设置 · 输出镜像来源）');
    assert.equal(advanced.inputs, 0, '没有名称/来源输入行（都走节点菜单/F2）');
    await wait(200);
    await client.screenshot(path.join(ARTIFACTS, 'break-card-editor-dark.png'));

    const closed = await client.evaluate(`(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      return !document.querySelector('.value-card-editor');
    })()`);
    assert.equal(closed, true, '点浮层外面收起');

    const boolMenu = await client.evaluate(`(() => {
      document.querySelectorAll('.context-menu').forEach((node) => node.remove());
      const card = document.querySelector('.node[data-id="bool_1"] .card-body') || document.querySelector('.node[data-id="bool_1"]');
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 900, clientY: 180 }));
      const panel = document.querySelector('.context-menu');
      return panel ? ${topButtons} : null;
    })()`);
    assert.deepEqual(boolMenu, ['改为', '嵌套条件（进阶）…'], 'UE 的 Convert Operator 放在节点菜单里');

    // 操作数就在引脚上就地编辑（UE 的引脚默认值）：点第 2 个操作数打开行内输入框。
    const operand = await client.evaluate(`(() => {
      document.querySelectorAll('.context-menu').forEach((node) => node.remove());
      const card = document.querySelector('.node[data-id="bool_1"]');
      const labels = [...card.querySelectorAll('.bool-judge-operand-value')].map((node) => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join(''));
      const hits = card.querySelectorAll('.bool-judge-operand-hit');
      if (hits.length < 2) return { labels, opened: false };
      hits[1].dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 890, clientY: 200 }));
      const editor = document.querySelector('.inline-param-editor');
      return { labels, opened: Boolean(editor), value: editor ? editor.querySelector('input')?.value : null };
    })()`);
    assert.equal(operand.labels.length, 2, '两个操作数各自内联显示');
    assert.match(operand.labels[0], /^← /, '引用操作数显示成「← 引用」');
    assert.equal(operand.labels[1], '400', '字面量操作数直接显示值');
    assert.equal(operand.opened, true, '点操作数应该打开行内编辑器');
    assert.equal(operand.value, '400', '行内编辑器带上当前字面量');
    await wait(200);
    await client.screenshot(path.join(ARTIFACTS, 'bool-card-operand-dark.png'));

    await client.evaluate("window.StudioTheme && window.StudioTheme.set('light')");
    await wait(300);
    await client.evaluate(FIXTURE);
    await wait(200);
    await client.screenshot(path.join(ARTIFACTS, 'break-card-light.png'));

    console.log('拆分卡片验收通过：', JSON.stringify(shape));
    console.log(`截图：${path.join(ARTIFACTS, 'break-card-dark.png')} / break-card-light.png`);
  } finally {
    client?.close();
    chrome.kill();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
