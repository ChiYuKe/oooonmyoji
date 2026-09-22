// Run via npm test (builds the renderer test output first).
// 左侧面板已迁到 panels/sidebar.ts：直接用编译产物 + DOM 桩验证，不截取源码。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSidebar } = require('../dist-test-renderer/renderer/panels/sidebar.js');

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {}; this.className = ''; this.scrollTop = 0;
    this.style = {}; this.ownerDocument = globalThis.document;
    this.classList = {
      add: (name) => { if (!this.className.split(' ').includes(name)) this.className += ' ' + name; },
      remove: (name) => { this.className = this.className.split(' ').filter((item) => item !== name).join(' '); },
      toggle: (name, force) => {
        const has = this.className.split(' ').includes(name);
        const next = force === undefined ? !has : Boolean(force);
        if (next && !has) this.className += ' ' + name;
        if (!next && has) this.className = this.className.split(' ').filter((item) => item !== name).join(' ');
        return next;
      },
      contains: (name) => this.className.split(' ').includes(name),
    };
  }
  setAttribute(name, value) { this.attrs[name] = value; }
  append(...nodes) { for (const node of nodes) node.parent = this; this.children.push(...nodes); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren() { this.children = []; }
  replaceWith(node) {
    const parent = this.parent;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children[index] = node;
    node.parent = parent;
  }
  focus() {} select() {}
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((item) => item !== this);
  }
  contains(target) { return target === this || this.children.some((child) => child.contains?.(target)); }
  getBoundingClientRect() { return {width: 156, height: 34, top: 0, bottom: 34}; }
  set innerHTML(html) {
    this.children = [...html.matchAll(/<span class="([^"]+)"><\/span>/g)].map(([, cls]) => {
      const node = new Element('span'); node.className = cls; node.parent = this; return node;
    });
  }
  querySelector(selector) {
    return this.children.find((node) => selector.startsWith('.variable-row[')
      ? selector.includes(`data-variable-name="${node.dataset.variableName}"`) && selector.includes(`data-variable-scope="${node.dataset.variableScope}"`)
      : node.className.split(' ').includes(selector.slice(1)));
  }
  querySelectorAll() { return []; }
  addEventListener(name, fn) { this.events[name] = fn; }
}

const documentEvents = {};
globalThis.document = {
  body: new Element('body'),
  documentElement: {clientWidth: 1280, clientHeight: 720},
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  addEventListener: (name, fn) => { documentEvents[name] = fn; },
  removeEventListener: (name, fn) => { if (documentEvents[name] === fn) delete documentEvents[name]; },
};
globalThis.CSS = { escape: (value) => value };

function harness(variables) {
  const list = new Element('div'), structure = new Element('div'), commands = [], panels = [];
  const sidebar = createSidebar({
    structureView: structure,
    variablesView: list,
    icons: { dummy: [] },
    editorCommand: (...args) => commands.push(args),
    showDetailsPanel: () => panels.push('details'),
    registerEditorDeleteTarget: () => {},
  });
  const state = { selectedVariable: 'shared', selectedVariableScope: 'inputs' };
  const render = () => sidebar.updateFromMessage({
    type: 'sidebarStateChanged',
    nodes: [],
    variables,
    selectedNode: '',
    selectedVariable: state.selectedVariable,
    selectedVariableScope: state.selectedVariableScope,
  });
  render();
  return { sidebar, list, commands, panels, state, render, rows: () => list.children.filter((item) => item.tagName === 'button') };
}

test('variable groups show counts once and rows keep complete names, types and scroll', () => {
  const h = harness([{name: 'shared', scope: 'inputs', type: 'integer'}, {name: '长名称'.repeat(12), scope: 'inputs', type: 'array'}, {name: 'shared', scope: 'variables', type: 'custom<type>'}]);
  h.list.scrollTop = 96; h.render();
  assert.equal(h.list.children.filter((item) => item.tagName === 'h3').length, 0);
  assert.equal(h.rows()[0].querySelector('.variable-flags').textContent, '整数');
  assert.equal(h.rows()[2].querySelector('.variable-flags').textContent, 'custom<type>');
  assert.equal(h.rows()[1].querySelector('.variable-name').textContent, '长名称'.repeat(12));
  assert.equal(h.rows()[1].querySelector('.variable-name').title, '长名称'.repeat(12));
  assert.equal(h.rows()[1].title, '拖到画布创建引用卡片\nF2 重命名\nDelete 删除');
  assert.equal(h.list.scrollTop, 96);
  assert.equal(h.rows()[0].attrs['aria-pressed'], 'true'); assert.equal(h.rows()[2].attrs['aria-pressed'], 'false');
});

test('侧栏给新类型同样的中文标签与类型图标 class', () => {
  const types = ['point', 'enum', 'key', 'color', 'duration'];
  const h = harness(types.map((type, index) => ({name: `v${index}`, scope: 'inputs', type})));
  h.render();
  assert.deepEqual(h.rows().map((row) => row.querySelector('.variable-flags').textContent),
    ['坐标点', '枚举', '按键', '颜色', '时长']);
  types.forEach((type, index) => {
    const icon = h.rows()[index].querySelector('.variable-icon');
    assert.ok(icon.className.split(' ').includes(`type-${type}`), `${type}: ${icon.className}`);
  });
});

test('variable selection and drag preserve existing scope-aware commands', () => {
  const h = harness([{name: 'shared', scope: 'inputs', type: 'integer'}, {name: 'shared', scope: 'variables', type: 'integer'}]);
  h.rows()[1].events.click(); assert.deepEqual(h.panels, ['details']);
  assert.equal(h.commands[0][0], 'selectVariable'); assert.equal(h.commands[0][1].scope, 'variables');
  let payload;
  const transfer = {setData(type, value) { payload = [type, JSON.parse(value)]; }};
  h.rows()[1].events.dragstart({dataTransfer: transfer});
  assert.deepEqual(payload, ['application/x-onmyoji-variable', {name: 'shared', scope: 'variables'}]); assert.equal(transfer.effectAllowed, 'copy');
  h.state.selectedVariableScope = 'variables'; h.render();
  assert.equal(h.rows()[0].attrs['aria-pressed'], 'false'); assert.equal(h.rows()[1].attrs['aria-pressed'], 'true');
  assert.equal(h.rows()[1].className.includes('selected'), true);
});

test('右键变量可查看引用，并把稳定名称与作用域交给当前画布', () => {
  const h = harness([{name: 'v_10a5', displayName: '运行轮数', scope: 'variables', type: 'integer'}]);
  let prevented = 0; let stopped = 0;
  h.rows()[0].events.contextmenu({
    clientX: 120, clientY: 80,
    preventDefault: () => { prevented += 1; },
    stopPropagation: () => { stopped += 1; },
  });
  assert.equal(prevented, 1); assert.equal(stopped, 1);
  assert.deepEqual(h.commands[0], ['selectVariable', {name: 'v_10a5', scope: 'variables'}]);
  const menu = globalThis.document.body.children.find((item) => item.className === 'sidebar-context-menu');
  assert.ok(menu, '右键后显示变量菜单');
  assert.equal(menu.attrs['aria-label'], '变量操作');
  const entry = menu.children[0];
  assert.equal(entry.children.at(-1).textContent, '查看变量引用');
  entry.events.click();
  assert.deepEqual(h.commands[1], ['showVariableReferences', {name: 'v_10a5', scope: 'variables'}]);
  assert.equal(globalThis.document.body.children.includes(menu), false, '执行后关闭菜单');
});

test('empty variable list skips the redundant heading and explains the single add control', () => {
  const h = harness([]); h.render();
  assert.equal(h.list.children.filter((item) => item.tagName === 'h3').length, 0);
  const empty = h.list.children.filter((item) => item.className === 'variable-group-empty');
  assert(empty[0].textContent.includes('＋ 变量'));
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  assert(new RegExp('id="add-input-button"').test(html) === false);
  assert(/id="add-variable-button"[^>]*>[\s\S]*?<span>变量<\/span><\/button>/.test(html));
});

test('eye toggles public state for both variables and inputs', () => {
  const h = harness([{name: 'v_1', scope: 'variables', type: 'integer', public: false}, {name: 'new_input', scope: 'inputs', type: 'integer', public: true}]);
  const eye = (row) => row.children.find((item) => item.className.includes('variable-eye'));
  assert(eye(h.rows()[0]).className.includes('off'));
  assert(eye(h.rows()[0]).className.includes('toggle'));
  eye(h.rows()[0]).events.click({stopPropagation() {}});
  assert.equal(h.commands[0][0], 'setVariablePublic');
  assert.equal(h.commands[0][1].name, 'v_1'); assert.equal(h.commands[0][1].scope, 'variables'); assert.equal(h.commands[0][1].public, true);
  assert(eye(h.rows()[1]).className.includes('toggle'));
  eye(h.rows()[1]).events.click({stopPropagation() {}});
  assert.deepEqual(h.commands[1], ['setVariablePublic', {name:'new_input',scope:'inputs',public:false}]);
  eye(h.rows()[1]).events.keydown({key:'Enter',preventDefault(){},stopPropagation(){}});
  assert.equal(h.commands.length, 3);
});

test('已连接画布的变量在列表里标记出来，未连接的没有标记', () => {
  const h = harness([{name: '超时', scope: 'inputs', type: 'number', onCard: true}, {name: '未用', scope: 'inputs', type: 'string'}]);
  const nameNode = (row) => row.querySelector('.variable-name');
  const chip = nameNode(h.rows()[0]).children.find((item) => item.className === 'variable-on-card');
  assert(chip, '已连接的变量必须有标记');
  assert.equal(chip.textContent, '已连接');
  assert.equal(chip.title, '画布上的节点端口已经引用该变量');
  assert.equal(h.rows()[0].title, '拖到画布创建引用卡片\nF2 重命名\nDelete 删除');
  assert.equal(nameNode(h.rows()[1]).children.filter((item) => item.className === 'variable-on-card').length, 0);
  assert.equal(h.rows()[1].title, h.rows()[0].title, '悬浮提示不再重复行内已有的状态');
});

test('变量行显示引用数量徽标：有引用才显示，未引用留空', () => {
  const h = harness([
    {name: '被引用', scope: 'inputs', type: 'number', refCount: 3},
    {name: '零引用', scope: 'variables', type: 'string', refCount: 0},
  ]);
  const badge = (row) => row.querySelector('.variable-ref-count');
  assert.equal(badge(h.rows()[0]).textContent, '3 引用');
  assert.equal(badge(h.rows()[0]).title, '变量被 3 处引用，点击行右键可查看详情');
  assert.equal(h.rows()[0].title, '拖到画布创建引用卡片\nF2 重命名\nDelete 删除\n当前被引用 3 处');
  assert.equal(badge(h.rows()[1]).textContent, undefined, '零引用不显示徽标（测试桩里未赋值即 undefined）');
  assert.equal(h.rows()[1].title, '拖到画布创建引用卡片\nF2 重命名\nDelete 删除');
});

test('变量行给类型、引用徽标和公开开关各自保留列，窄侧栏也不会换行错位', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/styles.css'), 'utf8');
  const workbench = fs.readFileSync(path.join(__dirname, '..', 'public/workbench/workbench.css'), 'utf8');
  for (const css of [renderer, workbench]) {
    const rowRule = css.match(/(?:#module-variables )?\.variable-row \{[^}]+\}/)?.[0] || '';
    assert.match(rowRule, /grid-template-columns:\s*14px minmax\(0, 1fr\) 42px max-content 16px/, '五个子元素必须对应五列');
    const badgeRule = css.match(/(?:#module-variables )?\.variable-ref-count \{[^}]+\}/)?.[0] || '';
    assert.match(badgeRule, /white-space:\s*nowrap/, '“N 引用”徽标不得逐字换行');
  }
});

test('F2 在变量行原地改名：行内输入框 + 画布改名命令', () => {
  const h = harness([{name: '运行轮数', scope: 'inputs', type: 'integer'}, {name: '未用', scope: 'variables', type: 'string'}]);
  assert.equal(h.sidebar.isRenaming(), false);
  assert.equal(h.sidebar.startVariableRename('不存在', 'inputs'), undefined);
  assert.equal(h.sidebar.isRenaming(), false, '目标不存在时不得进入改名态');

  h.sidebar.startVariableRename('运行轮数', 'inputs');
  assert.equal(h.sidebar.isRenaming(), true);
  const input = h.rows()[0].querySelector('.row-name-edit');
  assert.ok(input, '名称单元格原地换成输入框');
  assert.equal(input.value, '运行轮数');
  assert.equal(input.attrs['aria-label'], '变量名称');
  assert.equal(h.rows()[0].className.includes('renaming'), true);

  // 输入框里的点击/按键不得冒泡回行（否则会重新选中并重建列表）。
  let stopped = 0;
  input.events.click({stopPropagation: () => { stopped += 1; }});
  input.value = '轮数';
  input.events.keydown({key: 'Enter', preventDefault() {}, stopPropagation() { stopped += 1; }});
  assert.equal(stopped, 2);
  assert.deepEqual(h.commands.at(-1), ['renameVariable', {scope: 'inputs', oldName: '运行轮数', name: '轮数'}]);
  assert.equal(h.sidebar.isRenaming(), false, '提交后退出改名态');

  // Esc 取消：不发命令，退回普通行。
  h.sidebar.startVariableRename('未用', 'variables');
  const cancelled = h.rows()[1].querySelector('.row-name-edit');
  const before = h.commands.length;
  cancelled.events.keydown({key: 'Escape', preventDefault() {}, stopPropagation() {}});
  assert.equal(h.commands.length, before, '取消不得发改名命令');
  assert.equal(h.sidebar.isRenaming(), false);
  assert.equal(h.rows()[1].querySelector('.variable-name').textContent, '未用');

  // 外部取消（Esc 落在壳层时走 cancelRename）。
  h.sidebar.startVariableRename('未用', 'variables');
  h.sidebar.cancelRename();
  assert.equal(h.sidebar.isRenaming(), false);
  assert.equal(h.rows()[1].querySelector('.variable-name').textContent, '未用');
});

test('custom categories collapse without losing rows or drag identity', () => {
  const h = harness([{name: 'a', scope: 'inputs', type: 'integer', group: '战斗'}, {name: 'b', scope: 'inputs', type: 'integer', group: '战斗'}, {name: 'c', scope: 'inputs', type: 'integer'}]);
  let toggle = h.list.children.find((item) => item.className === 'variable-category-toggle');
  assert.equal(toggle.textContent, '▾ 战斗 · 2'); toggle.events.click();
  const rows = h.list.children.filter((item) => item.className.includes('variable-row'));
  assert.equal(rows[0].hidden, true); assert.equal(rows[1].hidden, true); assert.equal(rows[2].hidden, false);
  toggle = h.list.children.find((item) => item.className === 'variable-category-toggle');
  assert.equal(toggle.attrs['aria-expanded'], 'false'); toggle.events.click();
  assert.equal(h.list.children.find((item) => item.dataset.variableName === 'a').hidden, false);
});
