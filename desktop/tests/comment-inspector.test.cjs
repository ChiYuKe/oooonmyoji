// Run via npm test (builds the renderer test output first).
// 注释框的详情面板：颜色 / 字号 / 标题文字 / 删除。
// 用最小 DOM 替身记录控件与回调，断言的是「面板把改动交给注释命令，自己不改文档」。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCommentInspector } = require('../dist-test-renderer/canvas/inspector/comment-inspector.js');
const {
  COMMENT_TINTS, COMMENT_TINT_COLORS, DEFAULT_COMMENT_TINT, commentTintColor, commentOpacity,
  MIN_COMMENT_OPACITY, DEFAULT_COMMENT_OPACITY,
  DEFAULT_COMMENT_FONT_SIZE, MIN_COMMENT_FONT_SIZE, MAX_COMMENT_FONT_SIZE,
} = require('../dist-test-renderer/canvas/canvas/comments.js');

function stubElement(tag = 'div') {
  const node = {
    tag, className: '', textContent: '', value: '', placeholder: '', children: [], parent: null,
    listeners: {},
    style: { setProperty(prop, value) { (this._props = this._props || {})[prop] = value; } },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
    fire(type) { const event = { type, stopPropagation() {}, preventDefault() {} }; for (const handler of this.listeners[type] || []) handler(event); },
    setAttribute(name, value) { (this.attrs = this.attrs || {})[name] = String(value); },
  };
  return node;
}

function harness(comment, overrides = {}) {
  const state = Object.assign({
    raw: { comments: comment ? [comment] : [] },
    selectedCommentId: comment ? comment.id : 'gone',
    inspector: 'comment',
  }, overrides);
  const calls = { removed: [], texts: [], tints: [], sizes: [], opacities: [] };
  const controls = {};
  const inspector = createCommentInspector({
    state,
    el: (tag, className, text) => {
      const node = stubElement(tag);
      node.className = className || '';
      if (text !== undefined) node.textContent = text;
      controls[className || tag] = node;
      return node;
    },
    clearInspector: (title) => { controls.title = title; const body = stubElement('div'); controls.body = body; return body; },
    section: (body, title) => { const header = stubElement('h3'); header.textContent = title; body.appendChild(header); return header; },
    field: (body, label) => { const row = stubElement('label'); row.textContent = label; body.appendChild(row); return row; },
    textInput: (value, onChange, options) => {
      const node = stubElement('input');
      node.value = value;
      node.onChange = onChange;
      node.options = options || {};
      controls.fontSize = node;
      return node;
    },
    tints: COMMENT_TINTS,
    tintColors: COMMENT_TINT_COLORS,
    defaultTint: DEFAULT_COMMENT_TINT,
    resolveTint: (tint) => commentTintColor(tint),
    resolveOpacity: (opacity) => commentOpacity(opacity),
    opacityRange: { min: MIN_COMMENT_OPACITY, fallback: DEFAULT_COMMENT_OPACITY },
    fontSizeRange: { min: MIN_COMMENT_FONT_SIZE, max: MAX_COMMENT_FONT_SIZE, fallback: DEFAULT_COMMENT_FONT_SIZE },
    comments: {
      remove: (id) => { calls.removed.push(id); },
      setText: (id, text) => { calls.texts.push([id, text]); },
      setTint: (id, tint) => { calls.tints.push([id, tint]); },
      setFontSize: (id, size) => { calls.sizes.push([id, size]); },
      setOpacity: (id, opacity) => { calls.opacities.push([id, opacity]); },
    },
  });
  return { state, inspector, calls, controls };
}

const comment = () => ({ id: 'comment_1', text: '结算页分支\n第二行', at: { x: 40, y: 40 }, size: { w: 360, h: 200 } });

test('注释框详情：标题 / 颜色 / 字号三个控件都接上注释命令', () => {
  const h = harness(comment());
  h.inspector.renderCommentInspector();

  // 标题是多行输入（注释可以折行 / 敲换行）。
  const area = h.controls['comment-inspector-text'];
  assert.equal(area.tag, 'textarea', '标题要用 textarea');
  assert.equal(area.value, '结算页分支\n第二行');
  area.value = '改过的标题';
  area.fire('change');
  assert.deepEqual(h.calls.texts, [['comment_1', '改过的标题']]);

  // 颜色：自由取色器（input[type=color]）+「默认」+ 常用色快捷块。
  const picker = h.controls['comment-inspector-color'];
  assert.equal(picker.tag, 'input');
  assert.equal(picker.type, 'color', '颜色要能自由选，不是只有几个预设');
  assert.equal(picker.value, DEFAULT_COMMENT_TINT, '没有分类色时取色器给默认灰蓝');
  picker.value = '#12ab34';
  picker.fire('change');
  assert.deepEqual(h.calls.tints, [['comment_1', '#12ab34']], '取色器给什么就存什么');

  const presets = h.controls['comment-inspector-presets'];
  assert.equal(presets.children.length, COMMENT_TINTS.length - 1, '常用色仍是快捷块（不含默认）');
  presets.children[0].fire('click');
  assert.deepEqual(h.calls.tints.at(-1), ['comment_1', COMMENT_TINTS[1].value], '快捷块写回色名');

  const resetTint = h.controls['ghost comment-inspector-tint-reset'];
  assert.ok(resetTint, '要有「默认」按钮');
  assert.equal(resetTint.textContent, '默认');
  resetTint.fire('click');
  assert.deepEqual(h.calls.tints.at(-1), ['comment_1', ''], '「默认」清掉分类色');

  // 透明度：滑块 + 百分比；拖动只更新数字，松手才写文档（免得刷一屏历史）。
  const opacity = h.controls['comment-inspector-opacity'];
  assert.equal(opacity.tag, 'input');
  assert.equal(opacity.type, 'range');
  assert.equal(opacity.min, String(Math.round(MIN_COMMENT_OPACITY * 100)));
  assert.equal(opacity.max, '100');
  assert.equal(opacity.value, '100', '默认 100%');
  assert.equal(h.controls['comment-inspector-opacity-value'].textContent, '100%');

  opacity.value = '35';
  opacity.fire('input');
  assert.equal(h.controls['comment-inspector-opacity-value'].textContent, '35%', '拖动时数字跟着走');
  assert.deepEqual(h.calls.opacities, [], '拖动过程中不写历史');
  opacity.fire('change');
  assert.deepEqual(h.calls.opacities, [['comment_1', 0.35]], '松手才落一次改动');

  // 字号：数字输入，范围与默认值都写进控件里。
  assert.equal(h.controls.fontSize.value, DEFAULT_COMMENT_FONT_SIZE);
  assert.deepEqual(h.controls.fontSize.options, { type: 'number', min: MIN_COMMENT_FONT_SIZE, max: MAX_COMMENT_FONT_SIZE, step: 1 });
  h.controls.fontSize.onChange('18');
  assert.deepEqual(h.calls.sizes, [['comment_1', 18]]);

  // 位置 / 尺寸只读摘要 + 删除按钮。
  const hint = h.controls.body.children.find((child) => child.className === 'field-hint' && String(child.textContent).includes('位置'));
  assert.ok(hint, '要给出位置与尺寸摘要');
  assert.match(String(hint.textContent), /40, 40/);
  assert.match(String(hint.textContent), /360 × 200/);
  const remove = h.controls['danger full-command'];
  assert.equal(remove.textContent, '删除注释框');
  remove.fire('click');
  assert.deepEqual(h.calls.removed, ['comment_1']);
});

test('注释框详情：分类色与字号取文档里的当前值', () => {
  const h = harness({ ...comment(), tint: 'info', fontSize: 18 });
  h.inspector.renderCommentInspector();
  assert.equal(h.controls['comment-inspector-color'].value, COMMENT_TINT_COLORS.info, '色名要解析成取色器的初始颜色');
  assert.equal(h.controls.fontSize.value, 18);

  // 自定义颜色（#rrggbb）也认。
  const custom = harness({ ...comment(), tint: '#c0ffee' });
  custom.inspector.renderCommentInspector();
  assert.equal(custom.controls['comment-inspector-color'].value, '#c0ffee');
});

test('注释框详情：选中的注释已经不在了就退回空态，不留一个空面板', () => {
  const h = harness(null);
  h.inspector.renderCommentInspector();
  assert.equal(h.state.inspector, 'node', '面板要退回节点档（下一帧就是「选择一个节点」）');
  assert.equal(h.controls['comment-inspector-text'], undefined, '没有注释就不该建控件');
  assert.equal(h.controls.title, '详细信息');
});
