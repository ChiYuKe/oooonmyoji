/**
 * 卡片参数行就地编辑：字面量写入、按类型分派（菜单/切换/输入框/详情栏）与浮层生命周期。
 * 画布是纯 SVG，输入框是固定定位的 HTML 浮层，这里用最小 DOM 替身驱动它的真实分支。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.style = { setProperty: () => {} };
    this.events = {};
    this.attrs = {};
    this.className = '';
    this.value = '';
    this.focused = false;
    this.selected = false;
  }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); }
  contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  querySelectorAll(tag) { return this.children.flatMap((child) => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
}

function harness(options = {}) {
  const body = new FakeNode('body');
  const documentListeners = {};
  const windowListeners = {};
  const timers = [];
  globalThis.document = {
    body,
    createElement: (tag) => new FakeNode(tag),
    addEventListener: (type, fn) => { (documentListeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { documentListeners[type] = (documentListeners[type] || []).filter((item) => item !== fn); },
  };
  globalThis.window = {
    addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { windowListeners[type] = (windowListeners[type] || []).filter((item) => item !== fn); },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
  };
  const { createCanvasInlineEditor } = require(path.join('..', 'dist-test-renderer', 'canvas', 'interactions', 'inline-editor.js'));
  const calls = { menus: [], inspectors: [], toasts: [], remembered: [], cleared: [], mutations: 0, assets: [], workflows: [], rois: [] };
  const state = { zoom: 1, panX: 0, panY: 0 };
  const links = {};
  const editor = createCanvasInlineEditor({
    state,
    wrap: { getBoundingClientRect: () => ({ left: 10, top: 20 }) },
    el: (tag, className, text) => { const node = new FakeNode(tag); node.className = className || ''; node.textContent = text || ''; return node; },
    mutate: (fn) => { calls.mutations += 1; fn(); },
    clearParameterLiteralCache: (nodeId, name) => calls.cleared.push([nodeId, name]),
    rememberParameterLiteral: (node, name, value) => calls.remembered.push([node.id, name, value]),
    variableLinks: () => links,
    showMenu: (x, y, items) => calls.menus.push([x, y, items]),
    nodeVariablePinMenuItems: () => ['定位变量卡片', 'separator', '断开变量链接'],
    requestInspector: (selection) => calls.inspectors.push(selection),
    toast: (message, error) => calls.toasts.push([message, Boolean(error)]),
    enumOption: (value) => ({ all: '全部', any: '任意' }[value] || value),
    fieldLabel: (name) => ({ verify_gone: '确认模板消失', random_offset: '随机偏移', template: '模板', roi: '识别区域' }[name] || name),
    openAssetBrowser: options.openAssetBrowser === undefined
      ? (nodeId, key, current, applyValue) => calls.assets.push([nodeId, key, current, applyValue])
      : options.openAssetBrowser,
    openWorkflowBrowser: options.openWorkflowBrowser === undefined
      ? (nodeId, key, current, applyValue) => calls.workflows.push([nodeId, key, current, applyValue])
      : options.openWorkflowBrowser,
    requestRoi: options.requestRoi === undefined
      ? (nodeId, key, mode, roiOptions) => calls.rois.push([nodeId, key, mode, roiOptions])
      : options.requestRoi,
  });
  const flushTimers = () => { while (timers.length) timers.shift()(); };
  const fireDocument = (type, event) => (documentListeners[type] || []).forEach((fn) => fn(event));
  const fireWindow = (type, event) => (windowListeners[type] || []).forEach((fn) => fn(event));
  return { editor, calls, state, links, body, timers, flushTimers, fireDocument, fireWindow, documentListeners, windowListeners };
}

const rect = { x: 100, y: 96 + 3, width: 120, height: 18 };
const request = (node, pin, extra = {}) => ({ node, pin, rect, clientX: 40, clientY: 60, world: { x: 108, y: 108 }, ...extra });

test('setParamLiteral 写入字面量并清理变量链接与缓存', () => {
  const { editor, calls, links } = harness();
  const node = { id: 'tap', params: { random_offset: 11 } };
  links['tap:random_offset'] = 'card_1';
  editor.setParamLiteral(node, 'random_offset', 25);
  assert.equal(node.params.random_offset, 25);
  assert.equal(links['tap:random_offset'], undefined);
  assert.deepEqual(calls.remembered, [['tap', 'random_offset', 25]]);
  assert.equal(calls.cleared.length, 0);
  // undefined = 回到定义默认值：删除参数并清掉缓存里的字面量。
  editor.setParamLiteral(node, 'random_offset', undefined);
  assert.equal('random_offset' in node.params, false);
  assert.deepEqual(calls.cleared, [['tap', 'random_offset']]);
  assert.equal(calls.mutations, 2);
});

test('setParamLiteral 兼容 inputs 参数与损坏的 params 字段', () => {
  const { editor } = harness();
  const nested = { id: 'sub', params: { inputs: { 角色: 'a' } } };
  editor.setParamLiteral(nested, 'inputs.角色', 'b');
  assert.equal(nested.params.inputs.角色, 'b');
  editor.setParamLiteral(nested, 'inputs.角色', undefined);
  assert.equal('角色' in nested.params.inputs, false);
  const broken = { id: 'broken', params: ['x'] };
  editor.setParamLiteral(broken, 'count', 1);
  assert.deepEqual(broken.params, { count: 1 });
  const nestedBroken = { id: 'nb', params: { inputs: 3 } };
  editor.setParamLiteral(nestedBroken, 'inputs.角色', 'c');
  assert.deepEqual(nestedBroken.params.inputs, { 角色: 'c' });
});

test('布尔参数点值即切换，不生成输入框', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'tap', params: { verify_gone: true } };
  editor.openParamEditor(request(node, { param: 'verify_gone', definition: { type: 'boolean', default: false }, configured: true, value: true }));
  assert.equal(node.params.verify_gone, false);
  assert.deepEqual(calls.toasts, [['确认模板消失：已关闭', false]]);
  // 未配置时以定义默认值作为当前值：默认开启 → 点击后写入 false。
  const fresh = { id: 'tap', params: {} };
  editor.openParamEditor(request(fresh, { param: 'verify_gone', definition: { type: 'boolean', default: true }, configured: false }));
  assert.equal(fresh.params.verify_gone, false);
  assert.deepEqual(calls.toasts.at(-1), ['确认模板消失：已关闭', false]);
  assert.equal(body.children.length, 0);
  assert.equal(editor.inlineEditorOpen(), false);
});

test('已绑定变量的参数行走端口菜单', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'tap', params: {} };
  editor.openParamEditor(request(node, { param: 'match', variable: '模板', scope: 'inputs', definition: { type: 'object' } }));
  assert.equal(calls.menus.length, 1);
  assert.deepEqual(calls.menus[0][2], ['定位变量卡片', 'separator', '断开变量链接']);
  assert.equal(calls.menus[0][0], 40);
  assert.equal(body.children.length, 0);
  assert.equal(calls.mutations, 0);
});

test('工作流参数点值区直接打开工作流浏览器', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'run_child', action: 'workflow.run', params: { workflow: 'old.json' } };
  editor.openParamEditor(request(node, {
    param: 'workflow', definition: { type: 'workflow', required: true }, configured: true, value: 'old.json',
  }));
  assert.deepEqual(calls.workflows, [['run_child', 'workflow', 'old.json', undefined]]);
  assert.equal(body.children.length, 0);
  assert.equal(editor.inlineEditorOpen(), false);
});

test('枚举参数弹出选项菜单，支持恢复默认与转详情栏', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'seq', params: { run_mode: 'any' } };
  const pin = { param: 'run_mode', definition: { type: 'string', enum: ['all', 'any'], default: 'all' }, configured: true, value: 'any' };
  editor.openParamEditor(request(node, pin, { clientX: 7, clientY: 8 }));
  assert.equal(body.children.length, 0);
  const items = calls.menus[0][2];
  assert.deepEqual(items.map((item) => (typeof item === 'string' ? item : item.label)), ['全部', '● 任意', 'separator', '恢复默认 all', '在详情栏编辑']);
  items[0].run();
  assert.equal(node.params.run_mode, 'all');
  items[3].run();
  assert.equal('run_mode' in node.params, false);
  items[4].run();
  assert.deepEqual(calls.inspectors, [{ kind: 'node', nodeId: 'seq' }]);
});

test('数值参数生成贴在参数行上的输入框并按 pan/zoom 定位', () => {
  const { editor, calls, state, body } = harness();
  const node = { id: 'tap', params: {} };
  const pin = { param: 'random_offset', definition: { type: 'integer', default: 0, min: 0, max: 40 }, configured: true, value: 11 };
  editor.openParamEditor(request(node, pin));
  assert.equal(editor.inlineEditorOpen(), true);
  const shell = body.children[0];
  const input = shell.children[0];
  assert.equal(shell.className, 'inline-param-editor');
  assert.equal(input.className, 'ui-input inline-param-input');
  assert.equal(input.type, 'number');
  assert.equal(input.step, '1');
  assert.equal(input.min, '0');
  assert.equal(input.max, '40');
  assert.equal(input.value, '11');
  assert.equal(input.spellcheck, false);
  assert.equal(input.attrs['aria-label'], '随机偏移');
  assert.equal(input.focused, true);
  assert.equal(input.selected, true);
  // left = wrap.left + rect.x * zoom + panX；宽高来自行热区（最小 88x18）。
  assert.equal(shell.style.left, '110px');
  assert.equal(shell.style.top, '119px');
  assert.equal(shell.style.width, '120px');
  assert.equal(shell.style.height, '18px');
  state.zoom = 2;
  state.panX = 5;
  state.panY = 5;
  editor.refreshInlineEditor();
  assert.equal(shell.style.left, '215px');
  assert.equal(shell.style.top, '223px');
  assert.equal(shell.style.width, '240px');
  assert.equal(shell.style.height, '36px');
  // 文本参数用 text 类型；未配置时回落到定义默认值。
  editor.openParamEditor(request(node, { param: 'name', definition: { type: 'string', default: '挑战' }, configured: false }));
  assert.equal(body.children.length, 1, '打开新浮层会先收掉旧浮层');
  assert.equal(body.children[0].children[0].type, 'text');
  assert.equal(body.children[0].children[0].value, '挑战');
  assert.equal(calls.mutations, 0);
});

test('输入框提交、取消、非法值与外部点击的行为', () => {
  const { editor, calls, body, fireDocument, fireWindow, flushTimers } = harness();
  const target = { id: 'tap', params: {} };
  const pin = { param: 'random_offset', definition: { type: 'integer', default: 0, min: 0 } };
  editor.openParamEditor(request(target, pin));
  const input = body.children[0].children[0];
  // 非法值：提示错误、不写盘、浮层保留并把焦点交回输入框。
  input.value = 'abc';
  let prevented = false;
  input.events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(target.params, {});
  assert.deepEqual(calls.toasts, [['random_offset：需要整数', true]]);
  assert.equal(editor.inlineEditorOpen(), true);
  assert.equal(input.focused, true);
  // 合法值 + Enter：写盘并收掉浮层。
  input.value = '25';
  input.events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.equal(target.params.random_offset, 25);
  assert.equal(editor.inlineEditorOpen(), false);
  assert.equal(body.children.length, 0);
  assert.equal(calls.mutations, 1);
  // Escape 放弃修改。
  editor.openParamEditor(request(target, pin));
  const escapeInput = body.children[0].children[0];
  escapeInput.value = '99';
  escapeInput.events.keydown[0]({ key: 'Escape', stopPropagation: () => {}, preventDefault: () => {} });
  assert.equal(target.params.random_offset, 25);
  assert.equal(editor.inlineEditorOpen(), false);
  assert.equal(calls.mutations, 1);
  // 点击浮层外部：pointerdown 提交（随后 click 才会打开新行）。
  editor.openParamEditor(request(target, pin));
  const outsideInput = body.children[0].children[0];
  outsideInput.value = '30';
  fireDocument('pointerdown', { target: new (class { })() });
  assert.equal(target.params.random_offset, 30);
  assert.equal(editor.inlineEditorOpen(), false);
  // 浮层内部的 pointerdown 不提交。
  editor.openParamEditor(request(target, pin));
  const shell = body.children[0];
  const insideInput = shell.children[0];
  insideInput.value = '31';
  fireDocument('pointerdown', { target: insideInput });
  assert.equal(editor.inlineEditorOpen(), true);
  assert.equal(target.params.random_offset, 30);
  // 滚轮缩放与窗口失焦直接收掉浮层（不写盘）。
  fireDocument('wheel', {});
  assert.equal(editor.inlineEditorOpen(), false);
  assert.equal(target.params.random_offset, 30);
  editor.openParamEditor(request(target, pin));
  const blurInput = body.children[0].children[0];
  blurInput.value = '41';
  fireWindow('blur', {});
  assert.equal(editor.inlineEditorOpen(), false);
  flushTimers();
  assert.equal(target.params.random_offset, 30, '失焦只是收浮层，不会偷偷提交');
  // Tab 离开（blur 事件）会在下一轮宏任务提交。
  editor.openParamEditor(request(target, pin));
  const tabInput = body.children[0].children[0];
  tabInput.value = '7';
  tabInput.events.blur[0]({});
  flushTimers();
  assert.equal(target.params.random_offset, 7);
  assert.equal(editor.inlineEditorOpen(), false);
});

test('结构体参数不就地编辑，转到详情栏并提示', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'tap', params: {} };
  editor.openParamEditor(request(node, { param: 'match', definition: { type: 'object', required: true } }));
  assert.deepEqual(calls.inspectors, [{ kind: 'node', nodeId: 'tap' }]);
  assert.deepEqual(calls.toasts, [['match 需要在详情栏编辑', false]]);
  assert.equal(body.children.length, 0);
  assert.equal(calls.menus.length, 0);
  editor.openParamEditor(request(node, { param: 'states', definition: { type: 'array' } }));
  assert.deepEqual(calls.inspectors.at(-1), { kind: 'node', nodeId: 'tap' });
  // 资源参数改成卡片内菜单（素材浏览器 / 截图截取），不再跳详情栏。
  editor.openParamEditor(request(node, { param: 'template', definition: { type: 'asset' } }));
  assert.equal(calls.menus.length, 1);
  assert.equal(calls.inspectors.length, 2);
  // 缺少节点或参数名时什么都不做。
  editor.openParamEditor(request(null, { param: 'x' }));
  editor.openParamEditor(request(node, { param: '' }));
  assert.equal(calls.inspectors.length, 2);
  assert.equal(calls.menus.length, 1);
});

test('坐标点参数用 X/Y 双输入，回车提交整点', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'demo', params: {} };
  const pin = { param: 'target', definition: { type: 'point', default: { x: 0, y: 0 } }, configured: true, value: { x: 960, y: 540 } };
  editor.openParamEditor(request(node, pin));
  const shell = body.children[0];
  const inputs = shell.children.filter((child) => child.tag === 'input');
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].value, '960');
  assert.equal(inputs[1].value, '540');
  assert.equal(inputs[0].type, 'number');
  assert.equal(inputs[0].step, '1');
  assert.equal(inputs[0].attrs['aria-label'], 'target X');
  assert.equal(inputs[1].attrs['aria-label'], 'target Y');
  assert.equal(inputs[0].focused, true);
  // 任一分量留空都不写盘。
  inputs[1].value = '';
  inputs[0].events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.deepEqual(calls.toasts, [['target：坐标需要数值', true]]);
  assert.deepEqual(node.params, {});
  assert.equal(editor.inlineEditorOpen(), true);
  // 合法值取整后一次写入整点。
  inputs[1].value = '541.6';
  inputs[1].events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.deepEqual(node.params.target, { x: 960, y: 542 });
  assert.equal(editor.inlineEditorOpen(), false);
  // 未配置时以定义默认值初始化。
  editor.openParamEditor(request({ id: 'demo2', params: {} }, { param: 'target', definition: { type: 'point', default: { x: 12, y: 34 } } }));
  const fresh = body.children[0].children.filter((child) => child.tag === 'input');
  assert.deepEqual(fresh.map((input) => input.value), ['12', '34']);
});

test('时长参数用带秒单位的数值输入，沿用 min/max', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'sleep', params: {} };
  const pin = { param: 'seconds', definition: { type: 'duration', min: 0, max: 30 }, configured: true, value: 1.5 };
  editor.openParamEditor(request(node, pin));
  const shell = body.children[0];
  const input = shell.children[0];
  assert.equal(input.type, 'number');
  assert.equal(input.value, '1.5');
  assert.equal(input.step, 'any');
  assert.equal(input.min, '0');
  assert.equal(input.max, '30');
  assert.equal(shell.children[1].textContent, '秒');
  input.value = '-1';
  input.events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.deepEqual(calls.toasts, [['seconds：不能小于 0', true]]);
  assert.deepEqual(node.params, {});
  input.value = '2.25';
  input.events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.equal(node.params.seconds, 2.25);
  assert.equal(editor.inlineEditorOpen(), false);
});

test('颜色参数带色块取色器，文本必须是 #rrggbb', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'demo', params: {} };
  const pin = { param: 'tint', definition: { type: 'color', default: '#000000' }, configured: true, value: '#FF8C3A' };
  editor.openParamEditor(request(node, pin));
  const shell = body.children[0];
  const swatch = shell.children.find((child) => child.className === 'inline-param-swatch');
  const picker = swatch.children[0];
  const text = shell.children.find((child) => child.tag === 'input' && child.type === 'text');
  assert.equal(picker.type, 'color');
  assert.equal(picker.value, '#FF8C3A');
  assert.equal(swatch.style.background, '#FF8C3A');
  assert.equal(text.value, '#FF8C3A');
  // 取色器改变时文本与色块同步。
  picker.value = '#123456';
  picker.events.input[0]();
  assert.equal(text.value, '#123456');
  assert.equal(swatch.style.background, '#123456');
  // 文本输入合法色值时反向同步取色器。
  text.value = '#abcdef';
  text.events.input[0]();
  assert.equal(picker.value, '#abcdef');
  assert.equal(swatch.style.background, '#abcdef');
  // 非法值不写盘。
  text.value = 'red';
  text.events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.deepEqual(calls.toasts, [['tint：需要 #rrggbb', true]]);
  assert.deepEqual(node.params, {});
  // 合法值统一小写写入。
  text.value = '#ABCDEF';
  text.events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.equal(node.params.tint, '#abcdef');
  assert.equal(editor.inlineEditorOpen(), false);
});

test('按键参数弹出常用按键选择器，仍可自定义令牌', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'key', params: {} };
  const pin = { param: 'keycode', definition: { type: 'key', default: 'BACK', min_length: 1 }, configured: true, value: 'ENTER' };
  editor.openParamEditor(request(node, pin));
  assert.equal(body.children.length, 0, '按键走菜单，不生成输入框');
  const items = calls.menus[0][2];
  const labels = items.map((item) => (typeof item === 'string' ? item : item.label));
  assert.equal(labels[0], 'BACK · 返回');
  assert.ok(labels.includes('● ENTER · 回车'));
  assert.ok(labels.includes('自定义…'));
  assert.ok(labels.includes('恢复默认 BACK'));
  assert.equal(labels.at(-1), '在详情栏编辑');
  // 选择常用按键直接写入参数。
  items[0].run();
  assert.equal(node.params.keycode, 'BACK');
  // 自定义…打开文本输入，可写清单外的令牌。
  items[labels.indexOf('自定义…')].run();
  const input = body.children[0].children[0];
  assert.equal(input.type, 'text');
  assert.equal(input.value, 'ENTER');
  input.value = 'DPAD_UP';
  input.events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.equal(node.params.keycode, 'DPAD_UP');
  // 带空白的令牌被拒绝。
  editor.openParamEditor(request(node, pin));
  items[labels.indexOf('自定义…')].run();
  const retry = body.children[0].children[0];
  retry.value = 'BACK SPACE';
  retry.events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.deepEqual(calls.toasts.at(-1), ['keycode：按键名只能是字母/数字/下划线', true]);
});

test('模板参数在卡片上直接选素材图或从当前画面截取', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'wait', params: {} };
  const pin = { param: 'template', definition: { type: 'asset', required: true }, configured: false };
  editor.openParamEditor(request(node, pin, { clientX: 33, clientY: 44 }));
  assert.equal(body.children.length, 0, '资源参数走菜单，不生成输入框');
  const items = calls.menus[0][2];
  assert.deepEqual(items.map((item) => (typeof item === 'string' ? item : item.label)),
    ['选择模板图…', '从当前画面截取…', 'separator', '在详情栏编辑']);
  assert.deepEqual([calls.menus[0][0], calls.menus[0][1]], [33, 44]);
  // 选素材：打开素材浏览器，选中后由它的 applyValue 写回卡片（弹层自己包 mutate）。
  items[0].run();
  assert.deepEqual(calls.assets.map(([nodeId, key, current]) => [nodeId, key, current]), [['wait', 'template', '']]);
  calls.assets[0][3]('assets/templates/battle.png');
  assert.equal(node.params.template, 'assets/templates/battle.png');
  assert.deepEqual(calls.remembered, [['wait', 'template', 'assets/templates/battle.png']]);
  assert.equal(calls.mutations, 0, '写入由弹层负责，行内不再多包一层历史');
  // 截取：交给 ROI 拾取（asset 模式），回调同样直接写回。
  items[1].run();
  assert.deepEqual(calls.rois.map(([nodeId, key, mode]) => [nodeId, key, mode]), [['wait', 'template', 'asset']]);
  calls.rois[0][3].applyValue('assets/templates/cut.png');
  assert.equal(node.params.template, 'assets/templates/cut.png');
  // 已配置时给出更换与清除入口。
  const configured = { id: 'wait', params: { template: 'assets/templates/old.png' } };
  editor.openParamEditor(request(configured, { ...pin, configured: true, value: 'assets/templates/old.png' }));
  const configuredLabels = calls.menus.at(-1)[2].map((item) => (typeof item === 'string' ? item : item.label));
  assert.deepEqual(configuredLabels, ['更换模板图…', '从当前画面截取…', 'separator', '清除本行取值', 'separator', '在详情栏编辑']);
  calls.menus.at(-1)[2].find((item) => item.label === '更换模板图…').run();
  assert.equal(calls.assets.at(-1)[2], 'assets/templates/old.png');
  calls.menus.at(-1)[2].find((item) => item.label === '清除本行取值').run();
  assert.equal('template' in configured.params, false);
});

test('识别区域参数单击直接编辑四坐标，并聚焦点中的输入格', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'wait', params: {} };
  const pin = { param: 'roi', definition: { type: 'rect' }, configured: true, value: [10, 20, 200, 80] };
  editor.openParamEditor(request(node, pin, { inputIndex: 2 }));
  assert.equal(calls.menus.length, 0, '区域参数不再先弹操作菜单');
  // 单击直接出现 X/Y/宽/高 四个输入框，inputIndex 对应用户实际点中的格子。
  const shell = body.children[0];
  assert.equal(shell.className, 'inline-param-editor');
  const axisLabels = shell.children.filter((child) => child.className === 'inline-param-axis-label').map((child) => child.textContent);
  assert.deepEqual(axisLabels, ['X', 'Y', '宽', '高']);
  const inputs = shell.children.filter((child) => child.tag === 'input');
  assert.deepEqual(inputs.map((input) => input.value), ['10', '20', '200', '80']);
  assert.deepEqual(inputs.map((input) => input.min), [undefined, undefined, '0', '0']);
  assert.equal(inputs[2].focused, true);
  assert.equal(inputs[2].selected, true);
  inputs[2].value = '320';
  inputs[3].value = '96';
  inputs[2].events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.deepEqual(node.params.roi, [10, 20, 320, 96]);
  assert.equal(editor.inlineEditorOpen(), false);
  assert.equal(calls.mutations, 1);
  // 非法输入留在浮层里并提示，不写盘。
  editor.openParamEditor(request(node, pin));
  const bad = body.children[0].children.filter((child) => child.tag === 'input');
  bad[1].value = 'x';
  bad[0].events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.deepEqual(calls.toasts.at(-1), ['roi：区域需要数值', true]);
  assert.deepEqual(node.params.roi, [10, 20, 320, 96]);
  assert.equal(editor.inlineEditorOpen(), true);
  // 负宽高被拒绝。
  bad[1].value = '20';
  bad[2].value = '-5';
  bad[0].events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.deepEqual(calls.toasts.at(-1), ['roi：区域宽高不能为负', true]);
  assert.deepEqual(node.params.roi, [10, 20, 320, 96]);
});

test('卡片声明的 control 覆盖参数类型：数组参数也能用区域控件', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'patrol', params: {} };
  const pin = { param: 'target_rois', control: 'rect', definition: { type: 'array', items: { type: 'number' } }, configured: true, value: [1, 2, 3, 4] };
  editor.openParamEditor(request(node, pin));
  assert.equal(calls.menus.length, 0);
  assert.deepEqual(body.children[0].children.filter((child) => child.tag === 'input').map((input) => input.value), ['1', '2', '3', '4']);
  // control 声明成 inspector 时回到详情栏。
  const forced = harness();
  forced.editor.openParamEditor(request({ id: 'wait', params: {} }, { param: 'match', control: 'inspector', definition: { type: 'object' }, configured: false }));
  assert.deepEqual(forced.calls.menus, []);
  assert.deepEqual(forced.calls.inspectors, [{ kind: 'node', nodeId: 'wait' }]);
  assert.deepEqual(forced.calls.toasts, [['match 需要在详情栏编辑', false]]);
});

test('固定长度数组用并排输入格，回车提交整行', () => {
  const { editor, calls, body } = harness();
  const node = { id: 'tap', params: {} };
  const definition = { type: 'array', items: { type: 'duration', min: 0 }, min_items: 2, max_items: 2, default: [0, 0] };
  const pin = { param: 'random_interval', definition, configured: true, value: [0.2, 0.6] };
  editor.openParamEditor(request(node, pin, { valueAlign: 'left' }));
  const shell = body.children[0];
  assert.equal(shell.className, 'inline-param-editor value-align-left inline-param-tuple');
  const inputs = shell.children.filter((child) => child.tag === 'input');
  assert.deepEqual(inputs.map((input) => input.className), ['ui-input inline-param-input inline-param-tuple-input', 'ui-input inline-param-input inline-param-tuple-input']);
  assert.deepEqual(inputs.map((input) => input.value), ['0.2', '0.6'], '每格显示自己的元素');
  assert.deepEqual(inputs.map((input) => input.type), ['number', 'number']);
  assert.deepEqual(inputs.map((input) => input.min), ['0', '0'], '范围来自 items');
  assert.deepEqual(inputs.map((input) => input.step), ['any', 'any']);
  assert.deepEqual(inputs.map((input) => input.attrs['aria-label']), ['random_interval 第 1 项', 'random_interval 第 2 项']);
  assert.equal(inputs[0].focused, true);
  assert.equal(inputs[0].selected, true);
  // 回车一次提交整个数组（元素按各自类型解析）。
  inputs[1].value = '1.5';
  inputs[0].events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.deepEqual(node.params.random_interval, [0.2, 1.5]);
  assert.equal(editor.inlineEditorOpen(), false);
  assert.equal(calls.mutations, 1);
  // 任一格非法：整行不写入，提示带格子序号。
  editor.openParamEditor(request(node, pin, { valueAlign: 'left' }));
  const retry = body.children[0].children.filter((child) => child.tag === 'input');
  retry[0].value = '-1';
  retry[0].events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.deepEqual(calls.toasts.at(-1), ['random_interval：第 1 项：不能小于 0', true]);
  assert.deepEqual(node.params.random_interval, [0.2, 1.5]);
  assert.equal(editor.inlineEditorOpen(), true);
  retry[0].value = '0.3';
  retry[1].value = 'x';
  retry[0].events.keydown[0]({ key: 'Enter', stopPropagation: () => {}, preventDefault: () => {} });
  assert.deepEqual(calls.toasts.at(-1), ['random_interval：第 2 项：需要数值', true]);
  // 未配置时用定义默认值铺满每一格。
  editor.openParamEditor(request(node, { ...pin, configured: false, value: undefined }));
  assert.deepEqual(body.children[0].children.filter((child) => child.tag === 'input').map((input) => input.value), ['0', '0']);
  // 长度不定的数组仍然走详情栏。
  const loose = harness();
  loose.editor.openParamEditor(request({ id: 'tap', params: {} }, { param: 'states', definition: { type: 'array', items: { type: 'object' } }, configured: false }));
  assert.deepEqual(loose.calls.inspectors, [{ kind: 'node', nodeId: 'tap' }]);
});

test('固定长度数组点击第二个值框时聚焦第二个输入框', () => {
  const { editor, body } = harness();
  const node = { id: 'tap', params: {} };
  const definition = { type: 'array', items: { type: 'duration', min: 0 }, min_items: 2, max_items: 2, default: [0, 0] };
  const pin = { param: 'random_interval', definition, configured: true, value: [0.2, 0.6] };
  editor.openParamEditor(request(node, pin, { valueAlign: 'left', inputIndex: 1 }));
  const inputs = body.children[0].children.filter((child) => child.tag === 'input');
  assert.equal(inputs[0].focused, false);
  assert.equal(inputs[0].selected, false);
  assert.equal(inputs[1].focused, true);
  assert.equal(inputs[1].selected, true);
});

test('布尔行的状态文案跟卡片声明走', () => {
  const { editor, calls } = harness();
  const node = { id: 'wait', params: {} };
  editor.openParamEditor(request(node, {
    param: 'present', definition: { type: 'boolean', default: true }, configured: false,
    onLabel: '等待出现', offLabel: '等待消失',
  }));
  assert.equal(node.params.present, false);
  assert.deepEqual(calls.toasts, [['present：等待消失', false]]);
  editor.openParamEditor(request(node, {
    param: 'present', definition: { type: 'boolean', default: true }, configured: true, value: false,
    onLabel: '等待出现', offLabel: '等待消失',
  }));
  assert.equal(node.params.present, true);
  assert.deepEqual(calls.toasts.at(-1), ['present：等待出现', false]);
  // 没声明状态文案时退回通用说法。
  editor.openParamEditor(request(node, { param: 'present', definition: { type: 'boolean' }, configured: true, value: true }));
  assert.deepEqual(calls.toasts.at(-1), ['present：已关闭', false]);
});
