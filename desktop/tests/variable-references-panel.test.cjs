// Run via npm test (builds the renderer test output first).
// 「变量引用」面板：按节点分组列出谁在引用某个变量，提供搜索 / 类型筛选 / 跳转与直接删除。
const {test} = require('node:test');
const assert = require('node:assert/strict');

class Element {
  constructor(tag) {
    // 真实 DOM 的 tagName 是大写，面板据此判断「焦点是不是在搜索框里」。
    this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this.events = {};
    this.className = ''; this.textContent = ''; this.title = ''; this.value = ''; this.disabled = false;
  }
  setAttribute(name, value) { this.attrs[name] = value; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = undefined;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = undefined;
  }
  focus() { this.focused = true; }
  addEventListener(name, fn) { this.events[name] = fn; }
  removeEventListener(name) { delete this.events[name]; }
  /** 浏览器语义：click 不带 key，键盘事件才带；额外字段（如 target）由调用方覆盖。 */
  fire(name, extra = {}) {
    const base = name === 'keydown'
      ? {key: 'Escape', preventDefault() {}, stopPropagation() {}}
      : {preventDefault() {}, stopPropagation() {}};
    this.events[name]?.({...base, ...extra});
  }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  /** 支持 `.class` 与标签名两种选择器（面板里两种都用到了）。 */
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelector(selector) {
    return this.descendants().find((node) => node.matches(selector)) || null;
  }
  querySelectorAll(selector) {
    return this.descendants().filter((node) => node.matches(selector));
  }
}

const host = new Element('section');
// 面板模块在加载时会取 document，所以桩必须在 require 之前装好。
globalThis.document = {
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  querySelector: () => host,
};
const { createVariableReferences } = require('../dist-test-renderer/renderer/variable-references.js');

function harness() {
  const calls = [];
  let open = false;
  const panel = createVariableReferences({
    // 面板走共享停靠桥：默认与内容浏览器同层叠成标签组，这里只关心开关语义。
    getSharedPanels: () => ({
      surface: () => (open ? 'inner' : undefined),
      show: () => { open = true; },
      close: () => { open = false; },
    }),
    focusNode: (source, nodeId, param) => calls.push(['focusNode', source, nodeId, param]),
    selectVariable: (source, scope, name) => calls.push(['selectVariable', source, scope, name]),
    deleteVariable: (source, scope, name) => calls.push(['deleteVariable', source, scope, name]),
    disconnectReference: (source, entry) => calls.push(['disconnectReference', source, entry]),
    disconnectAllReferences: (source, scope, name) => calls.push(['disconnectAllReferences', source, scope, name]),
    showToast: (message) => calls.push(['toast', message]),
  });
  return {panel, calls, isOpen: () => open};
}

const SC = {commands: []};
const SOURCE = {frame: {id: 'canvas-frame'}, post: (command, value) => SC.commands.push([command, value])};
const DATA = {
  scope: 'inputs',
  name: '等待',
  displayName: '等待',
  type: 'number',
  defaultText: '8',
  entries: [
    {nodeId: 'tap', nodeName: '点击挑战按钮', nodeAction: '点击匹配项', nodeIndex: 2, param: 'timeout_seconds', ref: 'inputs.等待', label: '参数「超时（秒）」', linked: true},
    {nodeId: 'tap', nodeName: '点击挑战按钮', nodeAction: '点击匹配项', nodeIndex: 2, param: 'inputs.重试', ref: 'inputs.等待', label: '参数「重试」', linked: false},
    {nodeId: 'settle', nodeName: '等待结算', nodeAction: '等待', nodeIndex: 5, parentName: '结算流程', param: 'inputs.秒数', ref: 'inputs.等待', label: '参数「秒数」', linked: false},
    {nodeName: '', initializer: true, label: '变量「计数」的初始化输入'},
  ],
};

const rows = () => host.querySelectorAll('.variable-reference-row');
const groups = () => host.querySelectorAll('.variable-reference-group');
const chips = () => host.querySelectorAll('.variable-references-filter');
const chipNamed = (label) => chips().find((chip) => chip.querySelector('.variable-references-filter-label').textContent === label);
const chipCount = (label) => chipNamed(label).querySelector('.variable-references-filter-count').textContent;
const searchBox = () => host.querySelector('.variable-references-search-input');
const typeIntoSearch = (text) => {
  const input = searchBox();
  input.value = text;
  input.fire('input');
};

test('面板按节点分组：组头给序号、名称与动作，行里给参数与引用原文', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  assert.equal(h.isOpen(), true);
  const heading = host.querySelector('.variable-references-heading');
  assert.equal(heading.querySelector('strong').textContent, '等待');
  assert.equal(heading.querySelector('small').textContent, '4 处引用 · 2 个节点');
  // 头部把作用域与变量类型标出来，一眼知道在看哪个变量。
  const chipTexts = host.querySelectorAll('.variable-references-chip').map((chip) => chip.textContent);
  assert.deepEqual(chipTexts, ['输入', '数值']);

  const sections = groups();
  assert.equal(sections.length, 3, '两个节点 + 一处初始化输入');
  const heads = sections.map((section) => section.querySelector('.variable-reference-group-head'));
  assert.deepEqual(heads.map((head) => head.querySelector('.variable-reference-group-order').textContent), ['#2', '#5', '—']);
  assert.equal(heads[0].querySelector('.variable-reference-group-name').textContent, '点击挑战按钮');
  assert.equal(heads[0].querySelector('.variable-reference-group-action').textContent, '点击匹配项');
  assert.equal(heads[0].querySelector('.variable-reference-group-count').textContent, '2 处');
  // 第二条引用挂在别的分支里：组头把父节点说出来，省得在画布上乱找。
  assert.equal(heads[1].querySelector('.variable-reference-group-name').textContent, '等待结算');
  assert.equal(heads[1].querySelector('.variable-reference-group-parent').textContent, '在「结算流程」内');

  const rowList = rows();
  assert.equal(rowList.length, 4);
  assert.equal(rowList[0].querySelector('.variable-reference-text').querySelector('strong').textContent, '参数「超时（秒）」');
  assert.equal(rowList[0].querySelector('.variable-reference-ref').textContent, 'inputs.等待');
  assert.equal(rowList[0].querySelector('.variable-reference-badge').textContent, '画布连线');
  assert.equal(rowList[1].querySelector('.variable-reference-badge').textContent, '参数引用');
  assert.equal(rowList[3].querySelector('.variable-reference-badge').textContent, '初始化输入');
  assert.equal(rowList[3].querySelector('.variable-reference-text').querySelector('strong').textContent, '变量「计数」的初始化输入');
});

test('筛选按钮给出各类引用的计数，计数为 0 的类型不可点', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  assert.deepEqual(chips().map((chip) => chip.querySelector('.variable-references-filter-label').textContent),
    ['全部', '画布连线', '组接口', '参数引用', '初始化输入']);
  assert.equal(chipCount('全部'), '4');
  assert.equal(chipCount('画布连线'), '1');
  assert.equal(chipCount('组接口'), '0', '样例里没有组接口引用，计数为 0 且按钮禁用');
  assert.equal(chipCount('参数引用'), '2');
  assert.equal(chipCount('初始化输入'), '1');
  assert.equal(chipNamed('全部').className.includes('active'), true, '默认看全部');
  assert.equal(chipNamed('组接口').disabled, true);
});

test('组接口引用进入「组接口」筛选，行徽标同步标注', () => {
  const h = harness();
  const data = {...DATA, entries: [
    {...DATA.entries[0], nodeId: 'tap', param: 'timeout_seconds', linked: true, groupInterface: true},
    DATA.entries[1],
    DATA.entries[3],
  ]};
  h.panel.open(data, SOURCE);

  assert.equal(chipCount('组接口'), '1');
  assert.equal(chipCount('参数引用'), '1');
  chipNamed('组接口').fire('click');
  assert.equal(rows().length, 1, '筛选后只剩组接口引用');
  assert.equal(rows()[0].querySelector('.variable-reference-badge').textContent, '组接口');
});

test('搜索按节点名 / 参数 / 引用原文收窄清单，并同步刷新计数与提示', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  typeIntoSearch('结算');
  assert.equal(rows().length, 1);
  assert.equal(groups().length, 1);
  assert.equal(host.querySelector('.variable-references-hint').textContent, '筛出 1 / 4 处引用。');
  assert.equal(chipCount('全部'), '1');
  assert.equal(chipCount('画布连线'), '0');
  assert.equal(chipNamed('画布连线').disabled, true, '没有命中的类型按钮点不动');
  assert.equal(chipNamed('全部').disabled, false);

  typeIntoSearch('timeout_seconds');
  assert.equal(rows().length, 1, '按参数名也能搜到');

  typeIntoSearch('不存在的引用');
  assert.equal(rows().length, 0);
  assert.equal(host.querySelector('.variable-references-empty').querySelector('strong').textContent, '没有匹配的引用');
});

test('类型筛选与「清除筛选」互不干扰', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  chipNamed('画布连线').fire('click');
  assert.equal(rows().length, 1);
  assert.equal(chipNamed('画布连线').className.includes('active'), true);
  chipNamed('初始化输入').fire('click');
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].querySelector('.variable-reference-badge').textContent, '初始化输入');
  assert.equal(chipNamed('画布连线').className.includes('active'), false, '类型筛选是单选');

  typeIntoSearch('秒数');
  assert.equal(rows().length, 0, '类型筛选与搜索词同时生效');
  host.querySelector('.variable-references-reset').fire('click');
  assert.equal(rows().length, 4, '「清除筛选」把搜索词和类型一起清掉');
  assert.equal(searchBox().value, '');
  assert.equal(chipNamed('全部').className.includes('active'), true);
});

test('点引用把跳转命令发回来源画布（不是当前活动画布），初始化输入改为选中变量', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  const rowButtons = rows();
  rowButtons[0].fire('click');
  rowButtons[1].fire('click');
  // 回调收到的是打开面板时那份来源（带着它的 frame / post），跳转命令据此发回原画布；
  // 定位同时带上参数名，画布会把对应参数端点一起闪一下。
  assert.deepEqual(h.calls, [
    ['focusNode', SOURCE, 'tap', 'timeout_seconds'],
    ['focusNode', SOURCE, 'tap', 'inputs.重试'],
  ]);

  // 初始化输入没有节点可跳：改为选中该变量。
  rowButtons[3].fire('click');
  assert.deepEqual(h.calls[2], ['selectVariable', SOURCE, 'inputs', '等待']);
  assert.equal(h.isOpen(), true, '跳过去之后面板留着，方便继续处理下一条');
});

test('搜索框回车跳到第一条命中的引用', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  typeIntoSearch('秒数');
  searchBox().fire('keydown', {key: 'Enter'});
  assert.deepEqual(h.calls, [['focusNode', SOURCE, 'settle', 'inputs.秒数']]);
});

test('Esc：先清筛选，再按一次才关面板', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  typeIntoSearch('结算');
  const input = searchBox();
  // 真实浏览器里 Esc 从输入框冒泡到面板根节点，根节点上的捕获处理据此判断「在搜索框里」。
  host.querySelector('.variable-references').fire('keydown', {key: 'Escape', target: input});
  assert.equal(h.isOpen(), true, '第一次只清搜索词');
  assert.equal(rows().length, 4);
  assert.equal(input.value, '');

  host.querySelector('.variable-references').fire('keydown', {key: 'Escape', target: input});
  assert.equal(h.isOpen(), false, '没有筛选时 Esc 关闭面板');
});

test('方向键在行之间移动焦点', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  const root = host.querySelector('.variable-references');
  root.fire('keydown', {key: 'ArrowDown'});
  assert.equal(rows()[0].focused, true);
  root.fire('keydown', {key: 'ArrowDown', target: rows()[0]});
  assert.equal(rows()[1].focused, true);
  root.fire('keydown', {key: 'ArrowUp', target: rows()[1]});
  assert.equal(rows()[0].focused, true);
});

test('「刷新」请来源画布重算引用清单', () => {
  const h = harness();
  SC.commands = [];
  h.panel.open(DATA, SOURCE);

  const actions = host.querySelector('.variable-references-actions').querySelectorAll('.panel-action');
  actions[0].fire('click');
  assert.deepEqual(SC.commands, [['showVariableReferences', {scope: 'inputs', name: '等待'}]]);
});

test('同一个变量刷新时保留筛选，换成别的变量则清空', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  typeIntoSearch('结算');
  assert.equal(rows().length, 1);
  h.panel.open({...DATA, entries: DATA.entries}, SOURCE);
  assert.equal(rows().length, 1, '刷新后搜索词还在');
  assert.equal(searchBox().value, '结算');

  h.panel.open({...DATA, name: '秒表', displayName: '秒表'}, SOURCE);
  assert.equal(rows().length, 4, '换了变量就重新看全量');
  assert.equal(searchBox().value, '');
});

test('「直接删除变量」把删除命令发回来源画布并关闭面板', () => {
  const h = harness();
  h.panel.open(DATA, SOURCE);

  const remove = host.querySelector('.variable-references-footer').querySelectorAll('.panel-action')
    .find((node) => node.className.includes('danger'));
  assert.equal(remove.querySelector('span').textContent, '直接删除变量');
  // 删除提示带上变量默认值：用户知道这些引用会回落成什么。
  assert.match(remove.title, /当前默认值 8/);
  remove.fire('click');

  assert.deepEqual(h.calls[0], ['deleteVariable', SOURCE, 'inputs', '等待']);
  // 提示语带上了引用处数，且面板自己关掉。
  assert.match(h.calls.find(([kind]) => kind === 'toast')[1], /4 处引用/);
  assert.equal(h.isOpen(), false);
});

test('没有引用时显示明确空状态，不出现搜索与筛选，仍可直接删除变量', () => {
  const h = harness();
  h.panel.open({...DATA, entries: []}, SOURCE);

  assert.equal(rows().length, 0);
  assert.equal(host.querySelectorAll('.variable-references-filter').length, 0, '没有引用就不摆筛选控件');
  const empty = host.querySelector('.variable-references-empty');
  assert.equal(empty.querySelector('strong').textContent, '当前没有其他位置引用这个变量');
  assert.equal(empty.querySelector('.variable-references-empty-note').textContent, '可以直接删除变量。');
  assert.equal(host.querySelector('.variable-references-hint').textContent, '没有引用，可以直接删除变量。');
});

test('每条引用带独立的「断开」：解除单条引用并请画布重算清单', () => {
  const h = harness();
  SC.commands = [];
  h.panel.open(DATA, SOURCE);

  const unlinkButtons = host.querySelectorAll('.variable-reference-unlink');
  assert.equal(unlinkButtons.length, 4, '每条引用都有一枚断开按钮');
  assert.equal(unlinkButtons[1].title, '断开参数「inputs.重试」上的这条引用');
  unlinkButtons[0].fire('click');

  // 单条断开发回来源画布，再刷新清单（面板不自己改数据）。
  assert.deepEqual(h.calls[0], ['disconnectReference', SOURCE, DATA.entries[0]]);
  assert.deepEqual(SC.commands, [['showVariableReferences', {scope: 'inputs', name: '等待'}]]);
  // 提示语说明断开的位置。
  assert.match(h.calls.find(([kind]) => kind === 'toast')[1], /节点「点击挑战按钮」上的引用/);
  assert.equal(h.isOpen(), true, '断开后面板留着，方便继续处理下一条');
});

test('「断开全部引用」一次性发回全部处数，并刷新清单', () => {
  const h = harness();
  SC.commands = [];
  h.panel.open(DATA, SOURCE);

  const footer = host.querySelector('.variable-references-footer');
  const batch = footer.querySelectorAll('.panel-action').find((node) => node.className.includes('panel-action') && !node.className.includes('danger'));
  assert.equal(batch.querySelector('span').textContent, '断开全部引用（4 处）');
  assert.match(batch.title, /合并为一次历史记录/);
  batch.fire('click');

  assert.deepEqual(h.calls[0], ['disconnectAllReferences', SOURCE, 'inputs', '等待']);
  assert.deepEqual(SC.commands, [['showVariableReferences', {scope: 'inputs', name: '等待'}]], '断开后刷新清单');
  assert.match(h.calls.find(([kind]) => kind === 'toast')[1], /4 处引用/);
  assert.match(h.calls.find(([kind]) => kind === 'toast')[1], /可撤销/);
});

test('没有引用时「断开全部引用」不可点', () => {
  const h = harness();
  h.panel.open({...DATA, entries: []}, SOURCE);
  const batch = host.querySelector('.variable-references-footer').querySelectorAll('.panel-action')
    .find((node) => node.className.includes('panel-action') && !node.className.includes('danger'));
  assert.equal(batch.disabled, true);
});
