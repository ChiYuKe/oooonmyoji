// Run via npm test (builds the renderer test output first).
// 注释框模块：纯对象 fake 驱动（与 canvas-viewport 等用例同一套做法），
// 覆盖新建 / 渲染 / 命中 / 删除 / 改文字提交这几条不依赖真实 DOM 的路径。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createCanvasComments } = require('../dist-test-renderer/canvas/canvas/comments.js');
const { estimateCharWidth } = require('../dist-test-renderer/canvas/canvas/text-wrap.js');
const { removeButtonSize } = require('../dist-test-renderer/canvas/canvas/comments.js');

function fakeElement(tag = 'g') {
  const element = {
    tag,
    attributes: {},
    children: [],
    listeners: {},
    isConnected: true,
    firstChild: null,
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return this.attributes[key]; },
    appendChild(child) { this.children.push(child); child.parent = this; if (!this.firstChild) this.firstChild = child; return child; },
    insertBefore(child, before) {
      const index = this.children.indexOf(before);
      this.children.splice(index < 0 ? 0 : index, 0, child);
      child.parent = this;
      if (this.firstChild === before || !this.firstChild) this.firstChild = child;
      return child;
    },
    replaceChildren() { this.children = []; this.firstChild = null; },
    remove() { this.isConnected = false; },
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
    fire(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); },
    querySelector(selector) { return selector === '.graph-world' ? this.world || null : null; },
  };
  return element;
}

function harness(raw) {
  const state = createCanvasState();
  state.raw = raw;
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  const host = fakeElement('svg');
  const world = fakeElement('g');
  host.world = world;
  const calls = {mutated: 0, rendered: 0, dragged: [], editorShell: null};
  const wrap = {
    getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 300}),
    appendChild: () => {},
  };
  const comments = createCanvasComments({
    state,
    host,
    svgEl: (tag, attrs, parent) => {
      const element = fakeElement(tag);
      // 自定义颜色走 group.style.setProperty('--card-tint', …)：替身补一份最小 style。
      element.style = { props: {}, setProperty(prop, value) { this.props[prop] = value; } };
      for (const [key, value] of Object.entries(attrs || {})) {
        if (value !== undefined && value !== null) element.setAttribute(key, String(value));
      }
      if (parent) parent.appendChild(element);
      return element;
    },
    el: (tag, className) => {
      const element = fakeElement(tag);
      element.className = className;
      element.style = {};
      element.appendChild = (child) => { element.input = child; return child; };
      if (className === 'comment-text-editor') calls.editorShell = element;
      return element;
    },
    wrap,
    mutate: (fn) => { calls.mutated += 1; fn(); },
    render: () => { calls.rendered += 1; },
    worldPoint: (event) => ({x: event.worldX || 0, y: event.worldY || 0}),
    startCommentDrag: (event, comment, mode) => calls.dragged.push({id: comment.id, mode}),
  });
  return {state, host, world, comments, calls};
}

test('注释框：新建后进文档、渲染到自己的图层、能命中与删除', () => {
  const h = harness({nodes: [], edges: []});
  h.comments.render();
  const layer = h.world.children.find((child) => child.attributes.class === 'comments');
  assert.ok(layer, '注释图层应该挂在 .graph-world 的最前面');
  assert.equal(h.world.children[0], layer, '注释框画在连线与卡片之下');

  const created = h.comments.create(1000, 640);
  assert.equal(created.id, 'comment_1');
  assert.equal(created.text, '注释');
  assert.deepEqual(created.at, {x: 1000, y: 640});
  assert.deepEqual(created.size, {w: 360, h: 200});
  assert.equal(h.state.raw.comments.length, 1);
  assert.equal(h.calls.mutated, 1, '新建必须走 mutate（一条历史）');

  assert.deepEqual(h.comments.hitTest(1100, 700), created, '框内命中');
  assert.equal(h.comments.hitTest(10, 10), null, '框外不命中');

  h.comments.rename(created.id, '结算页分支');
  assert.equal(h.state.raw.comments[0].text, '结算页分支');

  h.comments.remove(created.id);
  assert.deepEqual(h.state.raw.comments, []);
  assert.equal(h.comments.hitTest(1100, 700), null);
});

test('注释框：同一个框连点两次新建时取下一个 id，尺寸与坐标贴 8 像素网格', () => {
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: 'x', at: {x: 0, y: 0}}]});
  const created = h.comments.create(1003, 647);
  assert.equal(created.id, 'comment_2');
  assert.deepEqual(created.at, {x: 1000, y: 648});
});

test('注释框：拖拽走 pointer 模块（移动 / 改尺寸两种模式）', () => {
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: 'x', at: {x: 0, y: 0}, size: {w: 360, h: 200}}]});
  h.comments.render();
  const box = h.world.children[0].children[0];
  const titleBar = box.children.find((child) => child.attributes.class === 'comment-title-bar');
  const resize = box.children.find((child) => child.attributes.class === 'comment-resize');
  assert.ok(titleBar && resize, '标题栏与改尺寸把手都要画出来');

  const stop = () => {};
  // 真实 DOM 里事件从子元素冒泡到卡片组，监听器挂在组上；fake 里显式把 target 指过去。
  box.fire('pointerdown', {button: 0, preventDefault: stop, stopPropagation: stop, target: titleBar, worldX: 10, worldY: 10});
  assert.deepEqual(h.calls.dragged, [{id: 'comment_1', mode: 'move'}]);
  // 点一下就选中：面板据此切到注释档（详情面板 → renderInspector → renderCommentInspector）。
  assert.equal(h.state.inspector, 'comment', '按下注释框就要把面板切到注释档');
  assert.equal(h.state.selectedCommentId, 'comment_1');
  box.fire('pointerdown', {button: 0, preventDefault: stop, stopPropagation: stop, target: resize, worldX: 10, worldY: 10});
  assert.deepEqual(h.calls.dragged, [{id: 'comment_1', mode: 'move'}, {id: 'comment_1', mode: 'resize'}]);

  // 把手只有 1.5px 描边，照着角点差几像素就会落到框体上（变成整体移动）：
  // 叠一条透明的加宽命中带，它同样要按「改尺寸」处理。
  const resizeHit = box.children.find((child) => String(child.attributes.class || '').includes('comment-resize-hit'));
  assert.ok(resizeHit, '改尺寸把手要有加宽的透明命中带');
  box.fire('pointerdown', {button: 0, preventDefault: stop, stopPropagation: stop, target: resizeHit, worldX: 10, worldY: 10});
  assert.deepEqual(h.calls.dragged.at(-1), {id: 'comment_1', mode: 'resize'});
  const css = fs.readFileSync(path.join(__dirname, '..', 'public/legacy/workflow-editor.css'), 'utf8');
  assert.match(css, /\.comment-box \.comment-resize-hit \{/, '命中带样式必须在（透明加宽）');
  assert.match(css, /pointer-events: stroke/, '透明描边要能吃到指针事件');
  // 删除按钮同理：透明命中区要能吃到指针，字形本身不吃（点了算在方块上），悬停整块亮。
  assert.match(css, /\.comment-box \.comment-remove-hit \{ fill: transparent; pointer-events: all; \}/, '删除按钮要有方形命中区');
  assert.match(css, /\.comment-box \.comment-remove-button:hover \.comment-remove-hit \{/, '悬停时整块亮一下');
  assert.match(css, /\.comment-box \.comment-remove \{[\s\S]*?pointer-events: none;/, '字形不吃事件，交给命中区');

  // 标题栏右侧的 × 直接删掉这个框：现在是一个方形按钮（透明命中区 + 字形）。
  const removeButton = titleBar.children.find((child) => child.attributes.class === 'comment-remove-button');
  assert.ok(removeButton, '删除按钮挂在标题栏里');
  const removeHit = removeButton.children.find((child) => child.attributes.class === 'comment-remove-hit');
  const removeGlyph = removeButton.children.find((child) => child.attributes.class === 'comment-remove');
  assert.ok(removeHit && removeGlyph, '按钮 = 命中区 + 字形');
  const hitSize = Number(removeHit.attributes.width);
  assert.ok(hitSize >= 24, `命中区要比 glyph 明显大一圈：${hitSize}`);
  assert.equal(removeHit.attributes.height, removeHit.attributes.width, '命中区是方的');
  assert.ok(Number(removeGlyph.attributes['font-size']) >= 16, '× 字形本身也放大');
  assert.ok(Number(removeHit.attributes.x) + hitSize <= Number(box.attributes.width ?? 360), '命中区留在框内');
  box.fire('pointerdown', {button: 0, preventDefault: stop, stopPropagation: stop, target: removeHit});
  assert.deepEqual(h.state.raw.comments, []);
});

/** 就地编辑器用的输入框替身：editText 只用到这几个成员。 */
function fakeInput(tag = 'input') {
  const input = fakeElement(tag);
  input.value = '';
  input.focus = () => {};
  input.select = () => {};
  return input;
}

test('注释框：拖拽期间只改坐标也要重画（内容签名包含坐标）', () => {
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: 'x', at: {x: 0, y: 0}, size: {w: 360, h: 200}}]});
  h.comments.render();
  const box = h.world.children[0].children[0];
  assert.equal(box.attributes.transform, 'translate(0, 0)');

  // pointer 模块在拖拽帧里直接写文档坐标，然后请求一次重绘。
  h.state.raw.comments[0].at = {x: 400, y: 320};
  h.comments.render();
  const moved = h.world.children[0].children[0];
  assert.equal(moved.attributes.transform, 'translate(400, 320)', '坐标变了必须重建到新位置');
});

test('注释框：长标题按框宽自动折行，标题栏跟着变高且不越出框外', () => {
  // 以前标题是一整行 <text>，长句子会横着跑出框外（用户报的就是这个）。
  const text = '结算页分支：先识别当前页面，再按状态分支（含 OCR 兜底）慢慢重试';
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text, at: {x: 0, y: 0}, size: {w: 240, h: 200}}]});
  h.comments.render();
  const box = h.world.children[0].children[0];
  const titleBar = box.children.find((child) => child.attributes.class === 'comment-title-bar');
  const textBlock = titleBar.children.find((child) => child.attributes.class === 'comment-title-lines');
  const lines = textBlock.children.filter((child) => child.attributes.class === 'comment-title');

  assert.ok(lines.length > 1, '长标题必须折成多行');
  assert.equal(lines.map((line) => line.textContent).join(''), text, '折行不丢字符');
  assert.equal(lines[0].attributes.x, '10', '每行从左边距开始');
  for (const line of lines) {
    const used = Array.from(String(line.textContent)).reduce((sum, char) => sum + estimateCharWidth(char, 12), 0);
    // 可用宽度 = 框宽 − 左边距 − 删除按钮方块 − 缝（见 comments.ts 的 titleWidth）。
    assert.ok(used <= 240 - 10 - removeButtonSize(12) - 4, `「${line.textContent}」不该超出可用宽度`);
  }
  // 行数决定标题栏高度；文字裁在框内，行再多也不会画到框体外面。
  const fill = titleBar.children.find((child) => child.attributes.class === 'comment-title-fill');
  const expected = 28 + (lines.length - 1) * 16;
  assert.equal(Number(fill.attributes.height), expected, '标题栏高度跟着行数走');
  assert.equal(textBlock.attributes['clip-path'], 'url(#comment-clip-comment_1)', '文字要裁在框内');

  // 换行符照旧保留成独立的行（DSL 里是 `|` 文本块）。
  const multi = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: '第一行\n第二行', at: {x: 0, y: 0}, size: {w: 240, h: 200}}]});
  multi.comments.render();
  const multiLines = multi.world.children[0].children[0].children
    .find((child) => child.attributes.class === 'comment-title-bar').children
    .find((child) => child.attributes.class === 'comment-title-lines').children
    .filter((child) => child.attributes.class === 'comment-title');
  assert.deepEqual(multiLines.map((line) => line.textContent), ['第一行', '第二行']);

  // 框比文字矮：只画放得下的整行，末尾补省略号（不要把最后一行裁成半个字）。
  const tiny = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text, at: {x: 0, y: 0}, size: {w: 120, h: 80}}]});
  tiny.comments.render();
  const tinyTitle = tiny.world.children[0].children[0].children
    .find((child) => child.attributes.class === 'comment-title-bar');
  const tinyLines = tinyTitle.children
    .find((child) => child.attributes.class === 'comment-title-lines').children
    .filter((child) => child.attributes.class === 'comment-title');
  const capacity = Math.floor((80 - 28) / 16) + 1;
  assert.equal(tinyLines.length, capacity, '只画放得下的行数');
  assert.ok(tinyLines[capacity - 1].textContent.endsWith('…'), '放不下的部分用省略号收尾');
  const tinyFill = tinyTitle.children.find((child) => child.attributes.class === 'comment-title-fill');
  assert.ok(Number(tinyFill.attributes.height) <= 80, '标题栏不超过框高');
});

test('注释框：就地改文字时浮层每帧重新贴合（平移/缩放与内容签名无关）', () => {
  // 就地改文字的浮层贴着标题栏：平移、缩放（乃至拖动别的卡片）都只改屏幕位置、
  // 不改注释框内容。贴合若写在内容签名的早退分支后面，输入框就会停原地不动。
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: 'x', at: {x: 100, y: 50}, size: {w: 360, h: 200}}]});
  h.comments.render();
  const previousDocument = global.document;
  const createdTags = [];
  global.document = {createElement: (tag) => { createdTags.push(tag); return fakeInput(tag); }};
  try {
    assert.equal(h.comments.editText('comment_1'), true);
    const shell = h.calls.editorShell;
    assert.ok(shell, '就地编辑器要挂到浮层宿主上');
    assert.ok(createdTags.includes('textarea'), '标题会折行：就地编辑器要用多行输入（textarea）');
    assert.equal(shell.style.left, '100px');
    assert.equal(shell.style.top, '50px');

    h.state.panX = 30;
    h.state.panY = 40;
    h.comments.render();
    assert.equal(shell.style.left, '130px', '平移后输入框必须跟着走');
    assert.equal(shell.style.top, '90px');

    h.state.zoom = 2;
    h.comments.render();
    assert.equal(shell.style.left, '230px', '缩放后输入框必须跟着走');
    assert.equal(shell.style.top, '140px');
    assert.equal(shell.style.width, '720px', '宽度按缩放同步');
    assert.equal(shell.style.height, '56px', '标题栏高度按缩放同步');
    assert.equal(shell.style.lineHeight, '32px', '行高按缩放同步（换行位置要和框里画出来的一致）');

    // 打字把标题写长了：浮层跟着长高（多行输入要看得见）。
    h.state.zoom = 1;
    const input = h.calls.editorShell.input;
    input.value = '结算页分支：先识别当前页面，再按状态分支（含 OCR 兜底）慢慢重试';
    input.fire('input', {});
    assert.ok(parseFloat(shell.style.height) > 28, `多行时浮层要高过一行，实际 ${shell.style.height}`);
  } finally {
    if (previousDocument === undefined) delete global.document; else global.document = previousDocument;
  }
});

test('注释框：字号进模型，标题栏高度与属性跟着一起变', () => {
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: '甲乙丙丁', at: {x: 0, y: 0}, size: {w: 240, h: 200}}]});
  h.comments.render();
  const titleBar = () => h.world.children[0].children[0].children
    .find((child) => child.attributes.class === 'comment-title-bar');
  const lines = () => titleBar().children
    .find((child) => child.attributes.class === 'comment-title-lines').children;
  const barHeight = () => Number(titleBar().children
    .find((child) => child.attributes.class === 'comment-title-fill').attributes.height);

  assert.equal(lines()[0].attributes['font-size'], '12', '默认字号 12');
  assert.equal(barHeight(), 28, '单行标题栏高度 = 字号 + 16');

  h.comments.setFontSize('comment_1', 20);
  assert.equal(h.state.raw.comments[0].fontSize, 20, '字号写进文档');
  h.comments.render();
  assert.equal(lines()[0].attributes['font-size'], '20', '字号走属性（CSS 不能盖过它）');
  assert.equal(barHeight(), 36, '标题栏高度跟着字号走');

  // 字号越大，同样的宽度能放的汉字越少：折行结果要跟着变。
  const wide = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: '一二三四五六七八九十', at: {x: 0, y: 0}, size: {w: 120, h: 200}}]});
  wide.comments.render();
  const lineCount = (host) => host.world.children[0].children[0].children
    .find((child) => child.attributes.class === 'comment-title-bar').children
    .find((child) => child.attributes.class === 'comment-title-lines').children.length;
  const before = lineCount(wide);
  wide.comments.setFontSize('comment_1', 24);
  wide.comments.render();
  assert.ok(lineCount(wide) > before, '字号变大后行数应该变多');

  // 回到默认值：不留冗余字段（写盘干净）。
  h.comments.setFontSize('comment_1', 12);
  assert.equal(h.state.raw.comments[0].fontSize, undefined);
  // 越界值夹到允许区间。
  h.comments.setFontSize('comment_1', 999);
  assert.equal(h.state.raw.comments[0].fontSize, 32);
});

test('注释框：分类色进模型并落到框体的 class 上', () => {
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: 'x', at: {x: 0, y: 0}}]});
  h.comments.render();
  const box = () => h.world.children[0].children[0];
  assert.ok(!String(box().attributes.class).includes('tint-'), '默认不带分类色');

  h.comments.setTint('comment_1', 'warning');
  assert.equal(h.state.raw.comments[0].tint, 'warning');
  h.comments.render();
  assert.ok(String(box().attributes.class).includes('tint-warning'));

  h.comments.setTint('comment_1', '');
  assert.equal(h.state.raw.comments[0].tint, undefined, '回到默认要删掉字段');
  h.comments.render();
  assert.ok(!String(box().attributes.class).includes('tint-'));
});

test('注释框：自定义颜色（#rrggbb）走内联 --card-tint，色名仍走 class', () => {
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: 'x', at: {x: 0, y: 0}}]});
  h.comments.render();
  const box = () => h.world.children[0].children[0];

  h.comments.setTint('comment_1', '#c0564f');
  h.comments.render();
  const custom = box();
  assert.equal(h.state.raw.comments[0].tint, '#c0564f');
  assert.equal(custom.style.props['--card-tint'], '#c0564f', '自定义颜色写在框体的 --card-tint 上');
  assert.ok(!String(custom.attributes.class).includes('tint-'), '自定义颜色不该再挂分类色 class');

  // 色名照旧走 class（老文档与快捷块都用它）。
  h.comments.setTint('comment_1', 'warning');
  h.comments.render();
  const named = box();
  assert.ok(String(named.attributes.class).includes('tint-warning'));
  assert.equal(named.style.props['--card-tint'], undefined, '色名不写内联变量');

  // 非法值当默认处理，不影响渲染。
  h.comments.setTint('comment_1', 'not-a-color');
  h.comments.render();
  assert.ok(!String(box().attributes.class).includes('tint-'), '认不出的值按默认色');
});

test('注释框：不透明度进模型并落到框体的 opacity 上（1 时不写字段/属性）', () => {
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: 'x', at: {x: 0, y: 0}}]});
  h.comments.render();
  const box = () => h.world.children[0].children[0];
  assert.equal(box().attributes.opacity, undefined, '默认不透明：不写 opacity 属性');

  h.comments.setOpacity('comment_1', 0.4);
  assert.equal(h.state.raw.comments[0].opacity, 0.4, '不透明度写进文档');
  h.comments.render();
  assert.equal(box().attributes.opacity, '0.4', '整框一起透');

  // 越界夹回区间：太低会点不着，太高就是 1。
  h.comments.setOpacity('comment_1', -3);
  assert.equal(h.state.raw.comments[0].opacity, 0.1);
  h.comments.setOpacity('comment_1', 5);
  assert.equal(h.state.raw.comments[0].opacity, undefined, '回到 1 就删掉字段');
  h.comments.render();
  assert.equal(box().attributes.opacity, undefined);

  // 文档里被手改成非法值时按默认渲染。
  h.state.raw.comments[0].opacity = 'nope';
  h.comments.render();
  assert.equal(box().attributes.opacity, undefined, '认不出的值按不透明处理');
});

test('注释框：选中写进 state（详情面板据此显示），面板切走时高亮自动撤掉', () => {
  const h = harness({nodes: [{id: 'a'}], edges: [], _layout: {a: {x: 0, y: 0}}, comments: [{id: 'comment_1', text: 'x', at: {x: 0, y: 0}}]});
  h.state.selected.add('a');
  h.comments.setSelected('comment_1');
  assert.equal(h.state.inspector, 'comment', '面板要切到注释框');
  assert.equal(h.state.selectedCommentId, 'comment_1');
  assert.equal(h.state.selected.size, 0, '注释选中要把节点选中让出去（否则 Delete 会删卡片）');

  // 面板切到别的东西（比如点了卡片）：下一帧注释层不再高亮，state 也清干净。
  h.state.inspector = 'node';
  h.comments.render();
  assert.equal(h.comments.selectedId(), '');
  assert.equal(h.state.selectedCommentId, '');
});

test('画布入口：注释框图层挂在帧尾贴合（见 render-entry 的合并帧契约）', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/editor.ts'), 'utf8');
  assert.match(source, /afterRender: \(\) => \{[^}]*Comments\.render\(\)/, '帧尾必须刷新注释框图层');
});

test('画布入口：拖拽收尾同时认 pointerup（注释框在 pointerdown 里起手，收不到兼容 mouseup）', () => {
  // 实测（Electron/Chromium）：在 pointerdown 里 preventDefault() 会让这段交互
  // **连 mouseup 都不再派发**（只派发 pointerup/mousemove）。注释框、折点都是在
  // pointerdown 里起手的，只挂 mouseup 收尾 → state.drag 永远清不掉 → 点一下注释框
  // 它就一直跟着鼠标走。这里守住「graph 与 window 两侧都要认 pointerup」。
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/editor.ts'), 'utf8');
  const graphUp = source.match(/graph\.addEventListener\('pointerup'[^\n]*/);
  assert.ok(graphUp, 'graph 上要有 pointerup');
  assert.match(graphUp[0], /state\.drag \|\|/, 'graph 的 pointerup 必须在拖拽中也收尾（不只是连线）');
  const windowUp = source.match(/window\.addEventListener\('pointerup'[^\n]*/);
  assert.ok(windowUp, 'window 上要有 pointerup（指针在画布外抬起）');
  assert.match(windowUp[0], /state\.drag \|\|/, 'window 的 pointerup 同样要覆盖拖拽');
});

test('画布入口：pointerdown 起手的拖拽必须由 pointer 事件驱动（否则拖不动）', () => {
  // 同一段交互既然收不到兼容 mouse 事件，移动也只能走 pointermove：
  // 只认 mousemove 的话注释框按住根本不动（「没法像卡片那样拖」）。
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/canvas/editor.ts'), 'utf8');
  assert.match(source, /const pointerDrivenDrag = \(\): boolean => Boolean\(state\.drag && state\.drag\.fromPointer\)/,
    '入口要按 fromPointer 认出这类拖拽');
  const graphMove = source.match(/graph\.addEventListener\('pointermove'[^\n]*/);
  assert.ok(graphMove, 'graph 上要有 pointermove');
  assert.match(graphMove[0], /pointerDrivenDrag\(\)/, 'graph 的 pointermove 要驱动这类拖拽');
  const windowMove = source.match(/window\.addEventListener\('pointermove'[^\n]*/);
  assert.ok(windowMove, 'window 上要有 pointermove（指针拖到侧栏上也要跟手）');
  assert.match(windowMove[0], /pointerDrivenDrag\(\)/, 'window 的 pointermove 要驱动这类拖拽');
});

