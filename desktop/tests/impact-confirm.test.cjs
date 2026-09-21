// Run via npm test (builds the renderer test output first).
// 阶段 8：统一确认弹窗。改名影响范围、保存被拦下、崩溃恢复、外部文件变化都走它。
// 这里用最小 DOM 替身验证交互契约：单次结算、Esc/遮罩取消、Tab 焦点陷阱、焦点归还、第三个动作。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createImpactConfirm} = require('../dist-test-renderer/renderer/impact-confirm.js');

function fakeElement(tag = 'div') {
  const element = {
    tag,
    textContent: '',
    attrs: {},
    children: [],
    classes: new Set(),
    dataset: {},
    focused: false,
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    removeChild(child) { this.children = this.children.filter((item) => item !== child); },
    focus() { document.activeElement = this; this.focused = true; },
    addEventListener(name, handler) { (this.events[name] ||= []).push(handler); },
    events: {},
    classList: {
      add(...names) { for (const name of names) element.classes.add(name); },
      remove(...names) { for (const name of names) element.classes.delete(name); },
      contains(name) { return element.classes.has(name); },
      toggle(name, force) {
        const want = force === undefined ? !element.classes.has(name) : Boolean(force);
        if (want) element.classes.add(name); else element.classes.delete(name);
        return want;
      },
    },
  };
  return element;
}

/** 最小 document：只提供 impact-confirm 用到的那几个能力。 */
function installDocument() {
  const listeners = [];
  const created = [];
  const document = {
    activeElement: null,
    contains: (element) => Boolean(element) && element.isConnected !== false,
    createElement: (tag) => { const element = fakeElement(tag); created.push(element); return element; },
    addEventListener: (name, handler) => { listeners.push([name, handler]); },
    removeEventListener: (name, handler) => {
      const index = listeners.findIndex(([n, h]) => n === name && h === handler);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  global.document = document;
  return { document, listeners, created, keydown: (event) => { for (const [name, handler] of [...listeners]) if (name === 'keydown') handler(event); } };
}

function harness() {
  const dom = installDocument();
  const modal = fakeElement('div');
  const title = fakeElement('strong');
  const subtitle = fakeElement('span');
  const body = fakeElement('div');
  const ok = fakeElement('button');
  const cancel = fakeElement('button');
  const close = fakeElement('button');
  const extra = fakeElement('button');
  const confirm = createImpactConfirm(modal, title, subtitle, body, ok, cancel, close, extra);
  return { dom, modal, title, subtitle, body, ok, cancel, close, extra, confirm };
}

test('打开时聚焦主操作并显示文案与清单，Esc 取消', async () => {
  const h = harness();
  const promise = h.confirm.open({
    title: '确认改名', summary: '「旧」将改名为「新」', confirmLabel: '确认改名', cancelLabel: '返回修改',
    items: [{ label: '节点「等待」 · 参数「秒数」', detail: 'inputs.等待' }],
  });
  assert.equal(h.confirm.isOpen(), true);
  assert.equal(h.title.textContent, '确认改名');
  assert.equal(h.subtitle.textContent, '「旧」将改名为「新」');
  assert.equal(h.ok.textContent, '确认改名');
  assert.equal(h.cancel.textContent, '返回修改');
  assert.equal(h.dom.document.activeElement, h.ok, '打开即聚焦主操作');
  assert.equal(h.modal.classes.has('hidden'), false);
  assert.equal(h.modal.getAttribute('aria-hidden'), 'false');
  assert.equal(h.body.children.length, 1, '清单渲染成列表');
  assert.equal(h.body.children[0].children.length, 1);
  assert.equal(h.body.children[0].children[0].children.length, 2, '每项带主文字与引用原文');

  h.dom.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(await promise, false);
  assert.equal(h.confirm.isOpen(), false);
  assert.equal(h.modal.classes.has('hidden'), true);
});

test('确认 / 取消 / 关闭 / 点遮罩各自结算一次，Promise 不会二次 settle', async () => {
  for (const [name, trigger] of [
    ['确认', (h) => h.ok.events.click[0]()],
    ['取消', (h) => h.cancel.events.click[0]()],
    ['关闭', (h) => h.close.events.click[0]()],
    ['遮罩', (h) => h.modal.events.pointerdown[0]({ target: h.modal })],
  ]) {
    const h = harness();
    const promise = h.confirm.open({ title: 't', summary: 's' });
    trigger(h);
    const answer = await promise;
    assert.equal(answer, name === '确认', `${name} 的返回值`);
    // 再点一次不会抛（settle 已被清空）。
    h.ok.events.click[0]();
    assert.equal(await promise, answer);
  }
});

test('第三个动作返回它自己的值（外部文件变化的「对比」）', async () => {
  const h = harness();
  const promise = h.confirm.open({
    title: '磁盘文件被外部改写', summary: '本地还有未保存修改',
    confirmLabel: '使用磁盘版本', cancelLabel: '保留本地',
    extra: { label: '对比', value: 'compare' },
    preview: '- 1 磁盘：a\n+ 1 本地：b',
  });
  assert.equal(h.extra.classes.has('hidden'), false);
  assert.equal(h.extra.textContent, '对比');
  assert.equal(h.extra.dataset.value, undefined, 'value 由 finish 读取 dataset，缺省时用 extra');
  assert.equal(h.body.children[0].tag, 'pre', '对比正文用等宽 pre');
  h.extra.events.click[0]();
  assert.equal(await promise, 'extra');
});

test('没有第三个动作时按钮隐藏；没有 preview 时不渲染 pre', async () => {
  const h = harness();
  const promise = h.confirm.open({ title: 't', summary: 's' });
  assert.equal(h.extra.classes.has('hidden'), true);
  assert.equal(h.body.children.length, 0);
  h.ok.events.click[0]();
  await promise;
});

test('Tab 在按钮之间循环（焦点陷阱），关闭后焦点还给打开前的元素', async () => {
  const h = harness();
  const previous = fakeElement('button');
  h.dom.document.activeElement = previous;
  const promise = h.confirm.open({ title: 't', summary: 's' });
  assert.equal(h.dom.document.activeElement, h.ok);

  // 顺序是 取消 → 确认（没有第三个动作时）。
  const tab = (shiftKey) => ({ key: 'Tab', shiftKey, preventDefault() {}, stopPropagation() {} });
  h.dom.keydown(tab(false));
  assert.equal(h.dom.document.activeElement, h.cancel, 'Tab 从确认转到取消');
  h.dom.keydown(tab(false));
  assert.equal(h.dom.document.activeElement, h.ok, '再 Tab 回到确认（循环）');
  h.dom.keydown(tab(true));
  assert.equal(h.dom.document.activeElement, h.cancel, 'Shift+Tab 反向');

  h.cancel.events.click[0]();
  await promise;
  assert.equal(h.dom.document.activeElement, previous, '焦点还给打开前的元素');
});

test('打开时若上一个弹窗还挂着，先按取消结算掉', async () => {
  const h = harness();
  const first = h.confirm.open({ title: '第一个', summary: '' });
  const second = h.confirm.open({ title: '第二个', summary: '' });
  assert.equal(await first, false);
  assert.equal(h.title.textContent, '第二个');
  h.ok.events.click[0]();
  assert.equal(await second, true);
});

test('四个入口共用同一个弹窗组件与样式', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src/renderer/main.ts'), 'utf8');
  // 改名影响范围 / 保存被拦下 → editor-host 经 showImpactConfirm；恢复与外部变化 → main 直接调。
  assert.match(main, /showImpactConfirm: async \(request\) => \(await impactConfirm\.open\(request\)\) === true/);
  assert.match(main, /resolveRecoveryDraft[\s\S]*?impactConfirm\.open\(\{/);
  assert.match(main, /resolveExternalChangeDraft[\s\S]*?impactConfirm\.open\(\{/);
  const host = fs.readFileSync(path.join(root, 'src/renderer/editor-host.ts'), 'utf8');
  assert.match(host, /showImpactConfirm\?\.\(\{/, '改名与保存都走同一个弹窗');
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  assert.match(html, /id="impact-confirm-extra"/, '弹窗支持第三个动作按钮');
  const styles = fs.readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
  assert.match(styles, /\.impact-confirm-preview \{/, '对比正文有样式');
});
