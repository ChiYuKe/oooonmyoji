const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');
const { createCanvasReferences } = require('../dist-test-renderer/canvas/model/references.js');
const references = createCanvasReferences({
  state: {}, clone: value => JSON.parse(JSON.stringify(value)), nodes: () => [],
  definitionSchema: () => undefined, compatibleRefType: () => false, appendNestedRefs: () => {},
  variableSystem: { visible: () => true, referenceLabel: ref => ref }, catalogByName: () => null,
});

function modeHarness() {
  return require('../dist-test-renderer/canvas/inspector/detail-inspectors.js')
    .createDetailInspectors({ clone: value => JSON.parse(JSON.stringify(value)), defaultValue: references.defaultValue })
    .changePublicInputMode;
}

/** 详情栏字面量控件的最小 DOM 桩：只验证行为，不验证排版。 */
function literalHarness() {
  const make = (tag) => ({
    tagName: tag, children: [], attrs: {}, className: '', events: {}, style: {}, dataset: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); },
    fire(name) { for (const fn of this.events[name] || []) fn({ target: this }); },
    get textContent() { return this.text || ''; },
    set textContent(value) { this.text = value; this.children = []; },
  });
  globalThis.document = { createElement: make };
  const el = (tag, className, text) => { const node = make(tag); node.className = className || ''; if (text !== undefined) node.textContent = text; return node; };
  const textInput = (value, onChange, options = {}) => {
    const input = make('input');
    input.value = value === undefined || value === null ? '' : String(value);
    input.type = options.type || 'text';
    for (const name of ['min', 'max', 'step']) if (options[name] !== undefined) input.attrs[name] = String(options[name]);
    input.addEventListener('change', () => onChange(input.value));
    return input;
  };
  const mutations = [];
  const inspectors = require('../dist-test-renderer/canvas/inspector/detail-inspectors.js')
    .createDetailInspectors({
      clone: value => JSON.parse(JSON.stringify(value)), defaultValue: references.defaultValue,
      el, textInput, mutate: fn => { mutations.push(fn); fn(); }, UI: {},
    });
  return { literal: inspectors.runInputLiteralControl, mutations };
}

test('运行实例输入的字面量控件覆盖坐标点/颜色/按键/时长', () => {
  const { literal, mutations } = literalHarness();
  const holder = { inputs: {} };
  const point = literal(holder, 'target', { type: 'point' }, 'multi:0');
  assert.equal(point.className, 'rect-control point-control');
  point.children[0].value = '960'; point.children[0].fire('change');
  assert.deepEqual(holder.inputs.target, { x: 960, y: 0 });
  point.children[1].value = '540.6'; point.children[1].fire('change');
  assert.deepEqual(holder.inputs.target, { x: 960, y: 541 });
  const color = literal(holder, 'tint', { type: 'color' }, 'multi:0');
  const picker = color.children[1];
  assert.equal(picker.type, 'color');
  assert.equal(picker.className, 'definition-color-picker');
  picker.value = '#123456'; picker.fire('input');
  assert.equal(holder.inputs.tint, '#123456');
  assert.equal(color.children[0].value, '#123456');
  const key = literal(holder, 'keycode', { type: 'key' }, 'multi:0');
  assert.equal(key.children[1].className, 'ui-select definition-key-picker');
  key.children[1].value = 'DPAD_UP'; key.children[1].fire('change');
  assert.equal(holder.inputs.keycode, 'DPAD_UP');
  const duration = literal(holder, 'seconds', { type: 'duration', min: 0 }, 'multi:0');
  assert.equal(duration.children[0].attrs.min, '0');
  assert.equal(duration.children[1].textContent, '秒');
  duration.children[0].value = '2.5'; duration.children[0].fire('change');
  assert.equal(holder.inputs.seconds, 2.5);
  // 每次修改都走 mutate，保证可以撤销。
  assert.equal(mutations.length, 5);
});

test('public input modes preserve literals and selected references through default mode', () => {
  const change = modeHarness();
  const refs = ['inputs.first', 'inputs.second'];
  for (const value of [6, 0, false, '', null, [1, 2, 30, 40], {nested: [0, false]}]) {
    const holder = {inputs: {value}};
    change(holder, 'value', {type: 'number'}, 'binding', refs);
    holder.inputs.value.ref = refs[1];
    change(holder, 'value', {}, 'default', refs);
    assert.equal(Object.hasOwn(holder.inputs, 'value'), false);
    change(holder, 'value', {}, 'literal', refs);
    assert.deepEqual(holder.inputs.value, value);
    change(holder, 'value', {}, 'binding', refs);
    assert.equal(holder.inputs.value.ref, refs[1]);
    assert.equal(JSON.stringify(holder), '{"inputs":{"value":{"ref":"inputs.second"}}}');
  }
});

test('input caches are isolated by input object and variable; defaults are cloned', () => {
  const change = modeHarness();
  const first = {inputs: {a: 6, b: 9}}, second = {inputs: {a: 42}};
  for (const holder of [first, second]) change(holder, 'a', {}, 'default', []);
  change(first, 'b', {}, 'default', []);
  change(first, 'a', {}, 'literal', []); change(first, 'b', {}, 'literal', []);
  change(second, 'a', {}, 'literal', []);
  assert.deepEqual(first.inputs, {a: 6, b: 9}); assert.equal(second.inputs.a, 42);
  first.inputs = {};
  const definition = {default: [0, false]};
  change(first, 'a', definition, 'literal', []);
  assert.deepEqual(first.inputs.a, definition.default);
  first.inputs.a.push(3); assert.deepEqual(definition.default, [0, false]);
});

test('unavailable references and repeated choices do not reset a value', () => {
  const change = modeHarness(), holder = {inputs: {a: 6}};
  for (const next of ['literal', 'binding', 'invalid']) change(holder, 'a', {}, next, []);
  assert.equal(holder.inputs.a, 6);
  change(holder, 'a', {}, 'binding', ['inputs.old']);
  change(holder, 'a', {}, 'literal', []);
  change(holder, 'a', {}, 'binding', ['inputs.new']);
  assert.equal(holder.inputs.a.ref, 'inputs.new');
});

test('toolbar menus support initial up/down, wrapping, escape and outside dismissal', () => {
  let focused;
  const item = () => ({focus() { focused = this; }});
  const trigger = item(), entries = [item(), item(), item()], events = {}, docEvents = {};
  const menu = {open: false, querySelector: () => trigger, querySelectorAll: () => entries,
    addEventListener: (name, fn) => {events[name] = fn;}, contains: target => target === trigger || entries.includes(target)};
  const document = {querySelectorAll: () => [menu], addEventListener: (name, fn) => {docEvents[name] = fn;}};
  vm.runInNewContext(read('public/workbench/workbench.js'), {document});
  const key = (key, target = trigger) => events.keydown({key, target, preventDefault() {}});
  key('ArrowUp'); assert.equal(focused, entries[2]); assert.equal(menu.open, true);
  key('ArrowDown', focused); assert.equal(focused, entries[0]);
  key('End'); assert.equal(focused, entries[2]); key('Home'); assert.equal(focused, entries[0]);
  key('Escape', focused); assert.equal(menu.open, false); assert.equal(focused, trigger);
  key('ArrowDown'); assert.equal(focused, entries[0]);
  events.focusout({relatedTarget: {}}); assert.equal(menu.open, false);
  menu.open = true; docEvents.pointerdown({target: {}}); assert.equal(menu.open, false);
});

test('toolbar keeps existing commands and shared compositions parse', () => {
  const html = read('src/renderer/index.html');
  const strip = html.slice(html.indexOf('<div class="tool-strip"'), html.indexOf('<div class="dock-workspace-shell"'));
  for (const command of ['addTask','addSequence','addSelector','addParallel','addGenericParallel','addRepeatUntil','addBranch','addSwitch','addInstanceParallel','autoLayout','fitView','exportImage','workflowSettings']) {
    assert.equal(strip.split(`data-editor-command="${command}"`).length - 1, 1, command);
  }
  for (const id of ['run-button','stop-button','save-button','more-button','instance-select']) assert(strip.includes(`id="${id}"`));
  for (const file of ['public/workbench/workbench.css', 'public/legacy/inspector.css']) require('postcss').parse(read(file));
  const palette = read('public/legacy/ui.css') + read('public/theme/theme.css');
  for (const [, token] of read('public/workbench/workbench.css').matchAll(/var\((--ui-[\w-]+)\)/g)) assert(palette.includes(`${token}:`), token);
  assert(read('src/renderer/popout.html').includes('/workbench/workbench.css'));
});

test('dock panel content keeps quadrant docking for split layouts', () => {
  const docking = read('src/renderer/docking.ts');
  assert.equal(docking.includes('dropPositionResolver:'), false,
    'panel content must use Dockview quadrant docking so top/bottom/left/right splits remain available');
  assert.equal(docking.match(/dndEdges: false/g)?.length, 2,
    'whole-workspace edge overlays stay disabled independently of panel split docking');
});

test('「变量引用」默认叠在内容浏览器旁边（内层/外层都跟着它）', () => {
  const docking = read('src/renderer/docking.ts');
  const sharedPanels = read('src/renderer/docking/shared-panels.ts');
  const section = (start, end, source) => source.slice(source.indexOf(start), source.indexOf(end));
  // 两层都声明「与内容浏览器同组」：内容浏览器默认停在内层，所以内层定义才是默认位置。
  assert.match(
    section('const PANEL_DEFINITIONS', 'const DEFAULT_PANEL_ORDER', docking),
    /variableReferences: \{[\s\S]*?SHARED_PANEL_DEFINITIONS\.variableReferences[\s\S]*?reference: 'contentBrowser',\s*\n\s*direction: 'within',/,
    '内层「变量引用」必须与内容浏览器叠成同一个标签组',
  );
  assert.match(
    section('const WORKBENCH_PANEL_DEFINITIONS', 'const DEFAULT_WORKBENCH_PANEL_ORDER', docking),
    /variableReferences: \{[\s\S]*?reference: 'contentBrowser',\s*\n\s*direction: 'within',/,
    '外层「变量引用」同样叠在内容浏览器旁边',
  );
  // 它是共享面板：内容浏览器被拖到哪一层，它就跟到哪一层。
  assert.match(docking, /export type SharedDockPanelId = 'contentBrowser' \| 'runtime' \| 'variableReferences';/);
  assert.match(sharedPanels, /DEFAULT_SHARED_PANEL_SURFACES[\s\S]*?variableReferences: 'inner',/);
  assert.match(sharedPanels, /COMPANION_SHARED_PANELS[\s\S]*?variableReferences: 'contentBrowser',/);
  // 参照面板不在时不落成独立分组（那正是“跑到右边去了”的样子）。
  assert.match(docking, /definition\.direction === 'within'\s*\n?\s*\?\s*undefined/);
});

test('内容浏览器之外：独立窗口的分组拖回主窗口', () => {
  // 行为：直接实例化编译产物里的真实手势模块（依赖注入的 DockviewApi 桩）。
  const { registerDockBackGesture } = require('../dist-test-renderer/renderer/docking/gestures.js');

  const removed = [];
  const timers = [];
  const listeners = [];
  const docHandlers = new Map();
  const doc = {
    addEventListener: (type, fn) => { (docHandlers.get(type) || docHandlers.set(type, []).get(type)).push(fn); },
    removeEventListener: (type, fn) => { const list = docHandlers.get(type) || []; const index = list.indexOf(fn); if (index >= 0) list.splice(index, 1); },
  };
  const win = {
    document: doc,
    screenX: 400, screenY: 200, outerWidth: 600, outerHeight: 400,
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
  };
  const group = { api: { location: { type: 'popout' } } };
  const api = {
    removeGroup: (item) => removed.push(item),
    getPopouts: () => [{ window: win, group }],
    onDidAddPopoutGroup: (fn) => { listeners.push(fn); return { dispose: () => { listeners.splice(listeners.indexOf(fn), 1); } }; },
  };
  const dispose = registerDockBackGesture(api);
  const fire = (type, event) => (docHandlers.get(type) || []).slice().forEach((fn) => fn(event));
  const flush = () => { while (timers.length) timers.shift()(); };

  // 窗口内的普通点击：不回停靠。
  fire('pointerdown', { screenX: 500, screenY: 300 });
  fire('pointerup', { screenX: 500, screenY: 300 });
  flush();
  assert.deepEqual(removed, [], '窗口内点击不触发');
  // 窗口内的拖拽：不回停靠。
  fire('pointerdown', { screenX: 500, screenY: 300 });
  fire('pointerup', { screenX: 560, screenY: 340 });
  flush();
  assert.deepEqual(removed, [], '窗口内拖拽不触发');
  // 拖到窗口外松手：把分组移回主窗口网格。
  fire('pointerdown', { screenX: 500, screenY: 300 });
  fire('pointerup', { screenX: 1100, screenY: 300 });
  flush();
  assert.deepEqual(removed, [group], '拖出窗口后 removeGroup 让分组回到主窗口');
  // 拖动距离太小（例如贴着窗口边缘误触）：不算拖回来。
  removed.length = 0;
  fire('pointerdown', { screenX: 1000, screenY: 300 });
  fire('pointerup', { screenX: 1006, screenY: 300 });
  flush();
  assert.deepEqual(removed, [], '按下与松开之间没有真实拖拽就不触发');
  // 解绑后不再响应，并且会清掉监听。
  dispose.dispose();
  assert.deepEqual(listeners, []);
  assert.equal((docHandlers.get('pointerup') || []).length, 0);
});

test('content browser keeps item instances, draft editing and flat grid/list rendering', () => {
  const source = read('src/renderer/content-browser.ts');
  const start = source.indexOf('function renderContentBrowser(): void {');
  const js = require('node:module').stripTypeScriptTypes(source.slice(start, source.indexOf('\n}\n', start) + 2));
  const element = () => ({children: [], classList: {toggle() {}}, setAttribute() {}, textContent: '',
    append(...children) {this.children.push(...children);}, appendChild(child) {this.children.push(child);},
    replaceChildren(...children) {this.children = children;}});
  const container = element(), created = [];
  const entries = [{kind:'asset',name:'template',path:'template.png'}, {kind:'workflow',name:'main',path:'main.json'}, {kind:'folder',name:'assets',path:'assets'}];
  const ctx = vm.createContext({contentFolders: () => [''], contentBrowserFolder: '', contentBrowserQuery: '',
    renderContentBrowserTree() {}, renderContentBrowserBreadcrumbs() {}, renderContentBrowserFilters() {},
    contentBrowserEntries: () => [...entries],
    contentFolderDraft: {parentPath:'',name:'新建文件夹'}, contentRenameDraft: null,
    contentBrowserItems:container, contentBrowserView:'grid', selectedContentPath:'',
    createContentItem(item, draft) { const result = {...element(), item, draft}; created.push(result); return result; },
    document: {createElement: element, querySelector: element, querySelectorAll: () => []}, createIconsRef() {}, desktopIconsRef: {}});
  vm.runInContext(js, ctx); ctx.renderContentBrowser();
  // UE 风格：过滤交给左侧类型列，主区直接平铺条目；新建草稿排在最前。
  assert.equal(container.children.length, 4);
  assert.equal(container.children[0], created[0]);
  assert.equal(created[0].draft, true);
  assert.deepEqual(container.children.map(item => item.item.kind), ['folder', 'asset', 'workflow', 'folder']);
  ctx.contentBrowserView = 'list'; ctx.contentFolderDraft = null; created.length = 0;
  ctx.renderContentBrowser(); assert.deepEqual(container.children, created); assert.equal(container.children.length, 3);
  // 行内重命名：目标条目原地进入编辑态。
  ctx.contentRenameDraft = {item: entries[1], name: 'main', busy: false}; created.length = 0;
  ctx.renderContentBrowser();
  assert.equal(container.children.find(el => el.item.path === 'main.json').draft, true);
  assert.equal(container.children.filter(el => el.draft).length, 1);
  // 被筛选/目录藏起来的重命名目标补进网格，保证输入框出现。
  ctx.contentRenameDraft = {item: {kind:'workflow', name:'hidden', path:'workflows/hidden.json'}, name: 'hidden', busy: false};
  created.length = 0;
  ctx.renderContentBrowser();
  assert.equal(container.children.length, 4);
  assert.equal(container.children[0].item.path, 'workflows/hidden.json');
  assert.equal(container.children[0].draft, true);
  ctx.contentRenameDraft = null;
});
