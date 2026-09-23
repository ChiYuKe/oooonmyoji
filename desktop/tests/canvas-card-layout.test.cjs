/**
 * 固定卡片布局：清单 `card.rows` 的规整化、端点顺序、行控件覆盖与标签，
 * 以及模型层端点构造、内置 manifest 的卡片声明契约。
 *
 * 这些契约决定「等待模板」这类任务卡片固定显示哪几个端点、每个端点怎么改。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Layout = require('../dist-test-renderer/canvas/render/card-layout.js');
const Rows = require('../dist-test-renderer/canvas/render/param-rows.js');

const MANIFESTS = path.join(__dirname, '..', '..', 'src', 'oooonmyoji', 'actions', 'manifests');

function readManifests() {
  return fs.readdirSync(MANIFESTS)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(MANIFESTS, file), 'utf8')));
}

/** 模型 harness：与 task-parameter-pins.test.cjs 同一套注入方式。 */
function harness(catalog) {
  const context = { state: { raw: { _inputParams: {} }, catalog } };
  const model = require('../dist-test-renderer/canvas/model/canvas-workflow-model.js').createCanvasWorkflowModel({
    state: context.state, Model: {}, VariableSystem: {}, nodes: () => [], position: () => ({ x: 0, y: 0 }),
    variableCards: () => ({}), compatibleRefType: () => true, definitionSchema: (definition) => definition, nodeHeight: () => 0,
    baseHeight: 96, nodeWidth: 260, decoHeight: 22, variableCardWidth: 168, variableCardHeight: 58,
    variableCardPortY: 29, variablePinX: 10, runCardWidth: 250, runCardBaseHeight: 78, runVariableHeight: 24,
    runCardGapX: 48, runCardGapY: 92,
    catalogByName: (name) => catalog.find((item) => item.name === name),
    fieldLabel: (name) => ({ template: '模板', timeout_seconds: '超时（秒）' }[name] || name),
    workflowNodeInputs: () => [], nextVariableCardId: () => '', workflowReference: () => '',
    nodeRowHeight: () => 30,
  });
  context.paramRowNames = model.paramRowNames;
  context.nodeVariablePins = model.nodeVariablePins;
  context.variablePinPosition = model.variablePinPosition;
  return context;
}

const WAIT_TEMPLATE = {
  name: 'vision.wait_template',
  parameters: {
    template: { type: 'asset', required: true },
    timeout_seconds: { type: 'duration', default: 10, min: 0 },
    present: { type: 'boolean', default: true },
    roi: { type: 'rect', default: [0, 0, 1920, 1080] },
    threshold: { type: 'number', default: 0.85 },
    scale_search: { type: 'boolean', default: false },
  },
  card: [
    { param: 'template', label: '模板' },
    { param: 'timeout_seconds', label: '超时' },
    { param: 'present', label: '存在性', on_label: '等待出现', off_label: '等待消失' },
    { param: 'roi', label: '识别区域' },
    { param: 'threshold', label: '匹配阈值' },
    { param: 'scale_search', label: '多尺度搜索', on_label: '启用', off_label: '关闭' },
  ],
};

test('card-layout 只把声明了 rows 的清单当固定卡片', () => {
  assert.equal(Layout.hasCardLayout(WAIT_TEMPLATE), true);
  assert.equal(Layout.hasCardLayout({ parameters: {} }), false);
  assert.equal(Layout.hasCardLayout({ card: [] }), false);
  assert.equal(Layout.hasCardLayout(null), false);
  assert.equal(Layout.hasCardLayout(undefined), false);
  // 坏行（缺 param）被忽略，不会变成空端点。
  assert.equal(Layout.hasCardLayout({ card: [{ label: '模板' }] }), false);
  assert.deepEqual(Layout.cardRowParams({ card: [{ param: 'a' }, { param: '', label: 'x' }] }), ['a']);
});

test('cardRowParams 保持清单顺序并跳过 hidden 行', () => {
  const spec = { card: [{ param: 'a' }, { param: 'b', hidden: true }, { param: 'c' }] };
  assert.deepEqual(Layout.cardRowParams(spec), ['a', 'c']);
  assert.equal(Layout.cardRowOf(spec, 'b').hidden, true);
  assert.equal(Layout.cardRowOf(spec, 'zzz'), null);
  assert.deepEqual(Layout.cardRowParams(WAIT_TEMPLATE),
    ['template', 'timeout_seconds', 'present', 'roi', 'threshold', 'scale_search']);
});

test('cardRowControl 显式控件优先，否则按参数类型推断', () => {
  assert.equal(Layout.cardRowControl({ param: 'roi' }, { type: 'rect' }), 'rect');
  assert.equal(Layout.cardRowControl({ param: 'x' }, { type: 'asset' }), 'asset');
  assert.equal(Layout.cardRowControl({ param: 'x' }, { type: 'boolean' }), 'boolean');
  assert.equal(Layout.cardRowControl({ param: 'x' }, { type: 'object' }), 'complex');
  // 数组参数用区域框选：控件由声明决定，与参数类型解耦。
  assert.equal(Layout.cardRowControl({ param: 'x', control: 'rect' }, { type: 'array' }), 'rect');
  assert.equal(Layout.cardRowControl({ param: 'x', control: 'inspector' }, { type: 'rect' }), 'complex');
  // 未知 control 不生效，仍按类型推断。
  assert.equal(Layout.cardRowControl({ param: 'x', control: 'nope' }, { type: 'rect' }), 'rect');
});

test('cardRowLabel 与 cardRowToggleLabels 给出行内文案', () => {
  assert.equal(Layout.cardRowLabel({ param: 'template', label: ' 模板 ' }, '模板'), '模板');
  assert.equal(Layout.cardRowLabel({ param: 'roi' }, '识别区域'), '识别区域');
  assert.equal(Layout.cardRowLabel(null, '识别区域'), '识别区域');
  assert.deepEqual(Layout.cardRowToggleLabels({ on_label: '等待出现', off_label: '等待消失' }), { on: '等待出现', off: '等待消失' });
  assert.deepEqual(Layout.cardRowToggleLabels({ on_label: '  ' }), { on: '开', off: '关' });
  assert.deepEqual(Layout.cardRowToggleLabels(null), { on: '开', off: '关' });
});

test('声明卡片的节点按清单顺序给端点，忽略展开状态', () => {
  const context = harness([WAIT_TEMPLATE]);
  const node = { id: 't', type: 'task', action: 'vision.wait_template', params: { template: 'a.png' } };
  // 没有展开集合、可选参数也没配置：声明里的六个端点照样全都在。
  assert.deepEqual(Array.from(context.paramRowNames(node)),
    ['template', 'timeout_seconds', 'present', 'roi', 'threshold', 'scale_search']);
  // 展开集合是默认卡片才用的状态，切换它不影响固定卡片。
  context.state.paramRowsExpanded = new Set(['t']);
  assert.deepEqual(Array.from(context.paramRowNames(node)),
    ['template', 'timeout_seconds', 'present', 'roi', 'threshold', 'scale_search']);
  const pins = Array.from(context.nodeVariablePins(node));
  assert.deepEqual(pins.map((pin) => pin.label), ['模板', '超时', '存在性', '识别区域', '匹配阈值', '多尺度搜索']);
  assert.deepEqual(pins.map((pin) => pin.param),
    ['template', 'timeout_seconds', 'present', 'roi', 'threshold', 'scale_search']);
  assert.deepEqual(pins.map((pin) => pin.type), ['asset', 'duration', 'boolean', 'rect', 'number', 'boolean']);
  // 已配置状态与必填标记仍然来自节点参数，不是卡片声明。
  // 超时现在带默认值（10 秒），所以不再是必填；模板是唯一必填项。
  assert.deepEqual(pins.map((pin) => pin.configured), [true, false, false, false, false, false]);
  assert.deepEqual(pins.map((pin) => pin.required), [true, false, false, false, false, false]);
  // 布尔行的两种状态名跟着声明走，卡片才能显示「等待出现 / 等待消失」。
  const present = pins.find((pin) => pin.param === 'present');
  assert.equal(present.onLabel, '等待出现');
  assert.equal(present.offLabel, '等待消失');
  assert.equal(pins.find((pin) => pin.param === 'template').control, undefined);
});

test('没声明卡片的动作保持「必填 + 已配置」的旧行为', () => {
  const spec = { name: 'core.log', parameters: { message: { type: 'string', required: true }, fields: { type: 'object' } } };
  const context = harness([spec]);
  const node = { id: 't', type: 'task', action: 'core.log', params: {} };
  assert.deepEqual(Array.from(context.paramRowNames(node)), ['message']);
  context.state.paramRowsExpanded = new Set(['t']);
  assert.deepEqual(Array.from(context.paramRowNames(node)), ['message', 'fields']);
  // 端点顺序与固定卡片一致，但标签来自共享字段名；换个节点回到折叠状态。
  assert.deepEqual(Array.from(context.nodeVariablePins({ id: 't2', type: 'task', action: 'core.log', params: {} }), (pin) => pin.param), ['message']);
});

test('端点位置用节点自己的行高，固定卡片不会与连线错位', () => {
  const context = harness([WAIT_TEMPLATE]);
  const node = { id: 't', type: 'task', action: 'vision.wait_template', params: {} };
  // 左右布局的行高为 30；第 3 行中心 = 96 + 2*30 + 15。
  assert.deepEqual(context.variablePinPosition(node, 2), { x: 10, y: 171 });
  assert.deepEqual(context.variablePinPosition(node, 5), { x: 10, y: 261 });
});

test('内置 manifest 的卡片声明引用真实参数并覆盖全部必填参数', () => {
  const manifests = readManifests();
  assert.ok(manifests.length >= 20, `manifest 数量异常：${manifests.length}`);
  let withCard = 0;
  for (const manifest of manifests) {
    const parameters = manifest.parameters || {};
    const rows = manifest.card && Array.isArray(manifest.card.rows) ? manifest.card.rows : [];
    if (!rows.length) {
      // 无参数的 Action（core.capture）无法声明卡片，必须一个参数都没有。
      assert.equal(Object.keys(parameters).length, 0, `${manifest.name} 没有卡片却声明了参数`);
      continue;
    }
    withCard += 1;
    const seen = new Set();
    for (const row of rows) {
      assert.ok(parameters[row.param], `${manifest.name}: 卡片行引用了未声明的参数 ${row.param}`);
      assert.ok(!seen.has(row.param), `${manifest.name}: 卡片行 ${row.param} 重复`);
      seen.add(row.param);
      if (row.control) {
        assert.ok(['asset', 'rect', 'toggle', 'enum', 'number', 'integer', 'duration', 'string', 'key', 'color', 'point', 'inspector'].includes(row.control),
          `${manifest.name}: 未知控件 ${row.control}`);
        // toggle 只能给布尔参数，rect/asset 只能给能装下它们的参数。
        if (row.control === 'toggle') assert.equal(parameters[row.param].type, 'boolean', `${manifest.name}.${row.param}`);
      }
      if (row.on_label || row.off_label) {
        assert.equal(parameters[row.param].type, 'boolean', `${manifest.name}.${row.param} 的 on_label/off_label 只能用在布尔参数上`);
      }
    }
    for (const [name, definition] of Object.entries(parameters)) {
      if (!definition.required) continue;
      assert.ok(seen.has(name), `${manifest.name}: 必填参数 ${name} 不在卡片端点里`);
      assert.notEqual(rows.find((row) => row.param === name).hidden, true, `${manifest.name}: 必填参数 ${name} 不能隐藏`);
    }
  }
  assert.ok(withCard >= 20, `声明卡片的 manifest 太少：${withCard}`);
});

test('等待模板的卡片就是用户指定的六个端点', () => {
  const manifest = readManifests().find((item) => item.name === 'vision.wait_template');
  assert.ok(manifest, '缺少 vision.wait_template manifest');
  assert.deepEqual(manifest.card.rows.map((row) => row.label),
    ['模板', '超时', '存在性', '识别区域', '匹配阈值', '多尺度搜索']);
  assert.deepEqual(manifest.card.rows.map((row) => row.param),
    ['template', 'timeout_seconds', 'present', 'roi', 'threshold', 'scale_search']);
  // 每个端点的值都能在卡片上直接改：控件类型决定点击动作。
  const spec = { name: manifest.name, parameters: manifest.parameters, card: manifest.card.rows };
  const context = harness([spec]);
  const node = { id: 't', type: 'task', action: 'vision.wait_template', params: {} };
  const pins = Array.from(context.nodeVariablePins(node));
  assert.deepEqual(pins.map((pin) => Rows.paramEditorAction(pin)),
    ['asset-menu', 'input', 'toggle', 'roi-menu', 'input', 'toggle']);
  // 值文本按类型给出可读形式；没配置的走清单默认值（超时 10 秒、识别区域整屏）。
  const compact = (value, max = 18) => String(value ?? '').slice(0, max);
  assert.deepEqual(pins.map((pin) => Rows.paramRowValueView(pin, compact).text),
    ['未设置', '10s', 'true', '0,0 1920×1080', '0.85', 'false']);
});
