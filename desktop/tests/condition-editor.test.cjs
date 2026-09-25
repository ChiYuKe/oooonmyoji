/**
 * 条件编辑器：装饰器条件必须和参数条件共用同一套结构化控件。
 *
 * 这条契约的由来：装饰器条件曾经在 and/or/not 时退化成一个裸 JSON 文本框，
 * 新手看到的是 `{"or":[{"eq":[{"ref":"nodes.classify.output.state"},...]}]}`。
 * 下面同时钉住三件事：不再出现 JSON 文本框、嵌套结构可以增删、以及中文回读。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist-test-renderer');
const { createParameterControls } = require(path.join(DIST, 'canvas/inspector/parameter-controls.js'));
const { createSubworkflowHelpers } = require(path.join(DIST, 'canvas/model/subworkflow.js'));
const { createCanvasReferences } = require(path.join(DIST, 'canvas/model/references.js'));

function element(tag, className = '', textContent = '') {
  const node = {
    tag, className, textContent, children: [], events: {}, attrs: {}, dataset: {}, style: {}, disabled: false,
    setAttribute(name, value) { this.attrs[name] = String(value); },
    appendChild(child) { this.children.push(child); return child; },
    prepend(child) { this.children.unshift(child); return child; },
    querySelector(selector) {
      const cls = selector.replace(/^\./, '');
      return this.children.find((child) => String(child.className || '').split(' ').includes(cls)) || null;
    },
    addEventListener(name, fn) { this.events[name] = fn; },
  };
  const has = (name) => String(node.className || '').split(' ').includes(name);
  node.classList = {
    add(name) { if (!has(name)) node.className = `${node.className} ${name}`.trim(); },
    remove(name) { node.className = String(node.className || '').split(' ').filter((item) => item !== name).join(' '); },
    toggle(name, force) { const on = force === undefined ? !has(name) : Boolean(force); if (on) this.add(name); else this.remove(name); return on; },
    contains(name) { return has(name); },
  };
  return node;
}

/** 把控件树拍平成 class 列表，用来断言「某类控件在不在」。 */
function walk(node, out = []) {
  out.push(node);
  for (const child of node.children || []) if (child && typeof child === 'object') walk(child, out);
  return out;
}
const classNames = (node) => walk(node).flatMap((item) => String(item.className || '').split(' ').filter(Boolean));

function controls() {
  const state = { catalog: [], raw: { inputs: {}, variables: {} } };
  const deps = {
    state, mutate: (fn) => fn(), clone: (value) => JSON.parse(JSON.stringify(value)),
    defaultValue: () => undefined, fieldLabel: (name) => name, enumOption: (value) => value,
    actionLabel: (name) => name, ACTION_LABELS: {}, VariableSystem: { visible: () => true, defaultAt: () => undefined },
    allRefs: () => ['nodes.classify.output.state'],
    referenceLabel: (ref) => (ref === 'nodes.classify.output.state' ? '识别结果 › 状态' : ref),
    el: element,
    selectInput: (value, options, onChange, className = '') => Object.assign(element('select', className), { value, options, onChange }),
    textInput: (value, onChange, options = {}) => Object.assign(element('input', options.className || ''), { value, onChange }),
    checkbox: (checked, onChange) => Object.assign(element('input', 'ui-checkbox'), { checked, onChange }),
    segmentedInput: () => element('div', 'ui-segmented'),
    field: (body, label) => { const node = element('div', 'field', label); body.appendChild(node); return node; },
    $: () => element('div'), toast: () => {},
    bindAssetPreview: () => {}, assetPreviewForPath: () => null, assetPathStatus: () => null,
    openAssetBrowser: () => {}, requestRoi: () => {}, inputParameterMetadata: () => ({}),
    requestTemplateCheck: () => {}, requestTemplateReplacement: () => {}, appendMissingAssetAction: () => {},
    openWorkflowBrowser: () => {}, renderInspector: () => {},
    variableLinks: () => ({}), variableDisplayNameOf: (_scope, name) => name,
    UI: { ICON_SVG: {}, icon: () => element('i'), button: (options) => element('button', '', options.label) },
  };
  return createParameterControls(deps);
}

const SCREENSHOT_EXPRESSION = {
  or: [
    { eq: [{ ref: 'nodes.classify.output.state' }, 'target_lit'] },
    { eq: [{ ref: 'nodes.classify.output.state' }, 'target_dim'] },
  ],
};

test('装饰器条件不再退化成 JSON 文本框，而是就地展开嵌套子条件', () => {
  const { conditionControl } = controls();
  let next;
  const wrap = conditionControl(SCREENSHOT_EXPRESSION, (value) => { next = value; }, { node: { id: 'n1' }, allowLiteral: true });
  const classes = classNames(wrap);

  // 关键回归：整棵树里不能出现 json-value 文本区。
  assert.equal(walk(wrap).some((item) => item.tag === 'textarea'), false, '条件编辑器不应出现 textarea');
  assert.equal(classes.includes('json-value'), false, '条件编辑器不应出现 json-value');

  // 「任一满足」下面每个子条件都是一行，并且可以单独删掉。
  const nested = walk(wrap).filter((item) => String(item.className).includes('condition-nested-row'));
  assert.equal(nested.length, 2);
  assert.equal(nested[0].children[0].className.includes('condition-control'), true);
  assert.equal(nested[0].children[1].dataset.tip, '删除该条件');

  // 还能继续往里加子条件。
  const add = walk(wrap).find((item) => String(item.className).includes('structured-add'));
  assert.ok(add, '缺少「添加子条件」按钮');
  assert.equal(add.children[1].textContent, '添加子条件');
  add.events.click();
  assert.deepEqual(next, { or: [...SCREENSHOT_EXPRESSION.or, { eq: [1, 1] }] });
});

test('装饰器条件保留「固定条件」，参数条件保留真假值入口', () => {
  const { conditionControl } = controls();

  let next;
  const decorator = conditionControl(true, (value) => { next = value; }, { node: { id: 'n1' }, allowLiteral: true });
  const selector = walk(decorator).find((item) => item.tag === 'select');
  assert.deepEqual(selector.options.map((item) => item.value), ['literal', 'exists', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'and', 'or', 'not']);
  assert.equal(selector.options[0].label, '固定条件');
  assert.ok(classNames(decorator).includes('condition-literal'), '固定条件应带上 condition-literal 以复用排版');

  // 切到比较操作符时给出可直接编辑的默认结构。
  selector.onChange('eq');
  assert.deepEqual(next, { eq: ['', ''] });

  // 参数区不带 allowLiteral：布尔值仍是「真 / 假 + ƒ」，不接受「固定条件」。
  const parameter = conditionControl(false, () => {}, { node: { id: 'n1' } });
  const values = walk(parameter).filter((item) => item.tag === 'select').map((item) => item.value);
  assert.deepEqual(values, ['false']);
  assert.equal(classNames(parameter).includes('condition-literal'), false);
});

test('操作符下拉用的是中文友好名，不再是裸 and/or', () => {
  const { conditionControl, conditionOperatorLabel } = controls();
  assert.equal(conditionOperatorLabel('and'), '全部满足 (and)');
  assert.equal(conditionOperatorLabel('or'), '任一满足 (or)');
  assert.equal(conditionOperatorLabel('not'), '取反 (not)');
  assert.equal(conditionOperatorLabel('exists'), '存在 (exists)');

  const wrap = conditionControl({ or: [] }, () => {}, { node: { id: 'n1' } });
  const selector = walk(wrap).find((item) => item.tag === 'select');
  assert.equal(selector.options.find((item) => item.value === 'and').label, '全部满足 (and)');
});

test('条件回读把截图里的表达式读成一句中文', () => {
  const conditionSentence = sentenceHelper();
  assert.equal(
    conditionSentence(SCREENSHOT_EXPRESSION),
    '当 （识别结果 › 状态 等于 “target_lit” 或者 识别结果 › 状态 等于 “target_dim”） 时执行',
  );
});

test('条件回读覆盖存在/取反/数值比较，认不出来的结构返回空串', () => {
  const conditionSentence = sentenceHelper();
  assert.equal(conditionSentence(true), '当 始终满足 时执行');
  assert.equal(conditionSentence({ exists: { ref: 'nodes.classify.output.state' } }), '当 识别结果 › 状态 存在 时执行');
  assert.equal(conditionSentence({ not: { eq: [{ ref: 'nodes.classify.output.state' }, 'settlement'] } }), '当 不是（识别结果 › 状态 等于 “settlement”） 时执行');
  assert.equal(conditionSentence({ gte: [{ ref: 'nodes.n1.output.confidence' }, 0.9] }), '当 nodes.n1.output.confidence 大于等于 0.9 时执行');
  assert.equal(conditionSentence({ and: [{ eq: [1, 1] }] }), '当 1 等于 1 时执行');

  // 认不出来就说不知道，而不是编一句错的。
  assert.equal(conditionSentence(undefined), '');
  assert.equal(conditionSentence({ 未知操作符: [1, 2] }), '');
  assert.equal(conditionSentence({ eq: [1] }), '');
});

function sentenceHelper() {
  const helpers = createSubworkflowHelpers({
    state: { raw: {}, dirty: false },
    vscode: { postMessage: () => {} },
    nodeById: () => null,
    $: () => ({ getBoundingClientRect: () => ({ left: 0, bottom: 0 }) }),
    showMenu: () => {},
    compactValue: String,
    referenceLabel: (ref) => (ref === 'nodes.classify.output.state' ? '识别结果 › 状态' : ref),
  });
  return helpers.conditionSentence;
}

test('节点输出引用渲染成「节点名 › 字段名」，不再是裸路径', () => {
  const nodes = [
    { id: 'classify', name: '识别页面状态', action: 'vision.detect_state' },
    { id: 'detect', action: 'vision.detect_state' },
    { id: 'wait', type: 'task', action: 'vision.wait_template' },
  ];
  const references = createCanvasReferences({
    state: {}, clone: (value) => JSON.parse(JSON.stringify(value)), nodes: () => nodes,
    definitionSchema: () => undefined, compatibleRefType: () => true, appendNestedRefs: () => {},
    variableSystem: { visible: () => true, referenceLabel: (raw, ref) => `变量 · ${ref}` },
    catalogByName: () => null,
  });

  assert.equal(references.referenceLabel('nodes.classify.output.state'), '识别页面状态 › 状态');
  // 没起名字时用动作中文名兜底。
  assert.equal(references.referenceLabel('nodes.detect.output.confidence'), '识别页面状态 › 置信度');
  // 数组输出给出「第 N 项」，并继续往下翻译字段。
  assert.equal(references.referenceLabel('nodes.wait.output.0.confidence'), '等待模板 › 第 1 项 › 置信度');
  assert.equal(references.referenceLabel('nodes.wait.output'), '等待模板 › 输出');
  // 节点已被删除时至少还能认出 id，绝不返回看不懂的路径。
  assert.equal(references.referenceLabel('nodes.ghost.output.state'), 'ghost › 状态');
  // 变量与输入沿用原有译名。
  assert.equal(references.referenceLabel('variables.时长'), '变量 · variables.时长');
  assert.equal(references.referenceLabel(''), '无可用引用');

  // 标题用的短名：裸整体输出去掉「› 输出」尾缀（UE 的 `Break <Struct>` 要的就是来源名），
  // 字段引用与译名规则和回读完全一致。
  assert.equal(references.referenceTitle('nodes.classify.output'), '识别页面状态');
  assert.equal(references.referenceTitle('nodes.wait.output'), '等待模板');
  assert.equal(references.referenceTitle('nodes.classify.output.state'), '识别页面状态 › 状态');
  assert.equal(references.referenceTitle('nodes.wait.output.0.confidence'), '等待模板 › 第 1 项 › 置信度');
  assert.equal(references.referenceTitle('nodes.ghost.output'), 'ghost');
  assert.equal(references.referenceTitle('variables.时长'), '变量 · variables.时长');
  assert.equal(references.referenceTitle(''), '无可用引用');
});
