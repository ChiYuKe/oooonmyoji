/**
 * 排列预览确认条验收：在无头 Chrome 里加载构建产物，复现桌面画布模式下的层叠关系，
 * 断言确认条整条落在悬浮面包屑（`#workflow-breadcrumb`，桌面模式是 top:0 / 30px / z-index:5 的
 * 悬浮层）下面，并且按钮上沿真的收得到点击。
 *
 * 回归的原始症状：确认条沿用 `top: 12px`，于是整条上沿（含按钮上沿）被面包屑压住——
 * 上边框看不见，点按钮上半截落到面包屑上什么也不发生。
 *
 * 用法：npm run build && node scripts/verify-arrange-preview-bar.cjs
 * 截图输出：desktop/artifacts/arrange-preview-bar-*.png
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

/** 面包屑和确认条都按壳层真实渲染出来的标记（面包屑平时由 shell 消息驱动，这里直接铺 DOM）。 */
const FIXTURE = `(() => {
  const nav = document.querySelector('#workflow-breadcrumb');
  nav.classList.remove('hidden');
  nav.innerHTML = '<span class="workflow-breadcrumb-mark">◆</span>'
    + '<button type="button" class="workflow-crumb current" disabled>souls_party_loop</button>';
  const bar = document.querySelector('#arrange-preview-bar');
  document.querySelector('#arrange-preview-text').textContent = '排列预览 · 全部 · 100 张卡片（尚未应用）';
  bar.classList.remove('hidden');
  const rect = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
  };
  const hit = (x, y) => {
    const node = document.elementFromPoint(x, y);
    if (!node) return null;
    return node.closest('button')?.id || node.id || node.className || node.tagName;
  };
  const button = rect('#btn-arrange-apply');
  return {
    breadcrumb: rect('#workflow-breadcrumb'),
    bar: rect('#arrange-preview-bar'),
    button,
    barTop: getComputedStyle(bar).top,
    // 按钮上沿 3px 处：修复前这一点落在面包屑上，修复后必须落到按钮自己身上。
    hitNearButtonTop: hit(button.left + button.width / 2, button.top + 3),
    hitButtonCenter: hit(button.left + button.width / 2, button.top + button.height / 2),
  };
})()`;

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

/** 极简 CDP 客户端：只用到 Runtime.evaluate、Input.dispatchMouseEvent 与 Page.captureScreenshot。 */
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

  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async screenshot(file) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  }

  close() { this.socket.close(); }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 计算值里的 alpha：`rgba(…)` 取第 4 个分量，`color(srgb … / .72)` 取斜杠后的数。 */
function alphaOf(value) {
  const slash = /\/\s*([\d.]+)\s*\)/.exec(value);
  if (slash) return Number(slash[1]);
  const rgb = /rgba?\(([^)]*)\)/.exec(value);
  if (!rgb) return 1;
  const parts = rgb[1].split(',').map((part) => part.trim());
  return parts.length > 3 ? Number(parts[3]) : 1;
}

/** 在按钮上沿 3px 处点一下真实鼠标事件：修复前这一点属于面包屑，按钮的监听器不会响。 */
const CLICK_AT_BUTTON_TOP = `(() => {
  window.__taps = [];
  document.querySelector('#btn-arrange-apply')
    .addEventListener('click', () => window.__taps.push('apply'), true);
  const box = document.querySelector('#btn-arrange-apply').getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + 3 };
})()`;

async function main() {
  assert.ok(fs.existsSync(path.join(DIST, 'canvas.html')), '缺少构建产物，请先执行 npm run build');
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const server = await serveDist();
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-arrange-bar-'));
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
      shape = await client.evaluate('Boolean(window.__btEditor) && ' + FIXTURE);
    }
    assert.ok(shape, '画布没有就绪');

    // 面包屑是悬浮层：确认条必须整条落在它下面，而不是只让开一点点。
    assert.equal(shape.barTop, '38px', `确认条 top 应为 38px（让开 30px 面包屑），实际 ${shape.barTop}`);
    assert.ok(
      shape.bar.top >= shape.breadcrumb.bottom,
      `确认条上沿 ${shape.bar.top} 必须不高于… 也就是不低于面包屑下沿 ${shape.breadcrumb.bottom}`
    );
    assert.equal(shape.breadcrumb.top, 0, '面包屑条贴画布顶部');
    await client.screenshot(path.join(ARTIFACTS, 'arrange-preview-bar-after.png'));

    // 命中测试：按钮上沿与按钮中心都必须命中按钮自己。
    assert.equal(shape.hitNearButtonTop, 'btn-arrange-apply', '按钮上沿的点击被别的浮层吃掉了');
    assert.equal(shape.hitButtonCenter, 'btn-arrange-apply', '按钮中心的点击被别的浮层吃掉了');

    // 真实鼠标事件也走一遍：确认条按钮的监听器必须收到。
    const point = await client.evaluate(CLICK_AT_BUTTON_TOP);
    await client.click(point.x, point.y);
    await wait(60);
    const taps = await client.evaluate('window.__taps');
    assert.deepEqual(taps, ['apply'], '按钮上沿的真实鼠标点击没有落到按钮上');

    // 面包屑自己是半透明悬浮层：深色调色板曾经写成不透明的 var(--ui-bg)，整条盖死画布。
    const breadcrumbBackground = await client.evaluate(`(() => {
      const root = document.documentElement;
      root.dataset.theme = 'dark';
      root.dataset.palette = 'dark';
      return getComputedStyle(document.querySelector('#workflow-breadcrumb')).backgroundColor;
    })()`);
    assert(alphaOf(breadcrumbBackground) < 1, `面包屑背景 ${breadcrumbBackground} 不是半透明`);

    // 反向证据：把确认条按旧位置（top:12px）塞回面包屑底下，上沿的点击就应当被面包屑吃掉。
    const legacy = await client.evaluate(`(() => {
      const bar = document.querySelector('#arrange-preview-bar');
      bar.style.top = '12px';
      const box = document.querySelector('#btn-arrange-apply').getBoundingClientRect();
      const node = document.elementFromPoint(box.left + box.width / 2, box.top + 3);
      const owner = node ? (node.closest('button')?.id || node.id || node.className) : null;
      bar.style.top = '';
      return { owner, barTop: box.top };
    })()`);
    assert.equal(legacy.owner, 'workflow-breadcrumb', '旧位置（top:12px）本该被面包屑盖住，夹具失效了');

    assert.deepEqual(client.logs, [], `页面报错：${client.logs.join('\n')}`);
    console.log('排列预览确认条：让开面包屑，按钮上沿的点击可达 ✔');
    console.log(`  面包屑 ${shape.breadcrumb.top}~${shape.breadcrumb.bottom}（背景 ${breadcrumbBackground}，alpha ${alphaOf(breadcrumbBackground)}），确认条 ${shape.bar.top}~${shape.bar.bottom}`);
    console.log(`  旧位置（top:12px）按钮上沿命中 ${legacy.owner}（回归证据）`);
    console.log(`  截图：${path.join(ARTIFACTS, 'arrange-preview-bar-after.png')}`);
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
