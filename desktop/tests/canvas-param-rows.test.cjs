/**
 * 卡片参数行纯函数：类型分类、几何、值文本、字面量解析与命中动作。
 * 这些契约同时决定卡片渲染、就地编辑和 nodeHeight 一致性，坏了会连带连线/命中测试。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist-test-renderer', 'canvas', 'render', 'param-rows.js');
const rows = require(DIST);
const compact = (value, max = 18) => {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

test('paramRowKind 按定义给出就地编辑控件类型', () => {
  assert.equal(rows.paramRowKind({ enum: ['a', 'b'] }), 'enum');
  assert.equal(rows.paramRowKind({ type: 'boolean' }), 'boolean');
  assert.equal(rows.paramRowKind({ type: 'integer' }), 'integer');
  assert.equal(rows.paramRowKind({ type: 'number' }), 'number');
  assert.equal(rows.paramRowKind({ type: 'string' }), 'string');
  assert.equal(rows.paramRowKind({ type: 'asset' }), 'asset');
  assert.equal(rows.paramRowKind({ type: 'path' }), 'asset');
  assert.equal(rows.paramRowKind({ type: 'object', properties: { x: { type: 'number' } } }), 'complex');
  assert.equal(rows.paramRowKind({ type: 'array', items: { type: 'number' } }), 'complex');
  // 空 enum 与缺省定义都不能当成可编辑枚举。
  assert.equal(rows.paramRowKind({ enum: [] }), 'complex');
  assert.equal(rows.paramRowKind(null), 'complex');
  assert.equal(rows.paramRowKind(undefined), 'complex');
  // 新类型各有自己的行内控件（enum 类型即使定义里没有选项列表也走枚举菜单）。
  assert.equal(rows.paramRowKind({ type: 'point' }), 'point');
  assert.equal(rows.paramRowKind({ type: 'color' }), 'color');
  assert.equal(rows.paramRowKind({ type: 'key' }), 'key');
  assert.equal(rows.paramRowKind({ type: 'duration' }), 'duration');
  assert.equal(rows.paramRowKind({ type: 'enum', enum: ['a'] }), 'enum');
});

test('paramRowEditable 只放行标量，资源与结构体仍走详情栏', () => {
  for (const kind of ['enum', 'boolean', 'integer', 'number', 'duration', 'string', 'key', 'color', 'point']) {
    assert.equal(rows.paramRowEditable(kind), true, kind);
  }
  for (const kind of ['asset', 'complex']) assert.equal(rows.paramRowEditable(kind), false, kind);
});

test('paramRowGeometry 与 nodeHeight 的行高对齐，热区落在值区', () => {
  const base = 96;
  const rowHeight = 24;
  const first = rows.paramRowGeometry({ nodeWidth: 240, baseHeight: base, rowHeight, index: 0 });
  const third = rows.paramRowGeometry({ nodeWidth: 240, baseHeight: base, rowHeight, index: 2 });
  assert.equal(first.y, base);
  assert.equal(first.centerY, base + 12);
  assert.equal(third.y, base + 48);
  assert.equal(third.centerY, base + 60);
  // 每行正好一行高，卡片总高 = 首行底 + 行数 * 行高。
  assert.equal(third.y - first.y, 2 * rowHeight);
  assert.equal(first.portX, 10);
  assert.equal(first.labelX, 22);
  assert.equal(first.valueRight, 228);
  assert.equal(first.valueLeft, Math.round(240 * 0.46));
  assert.equal(first.valueWidth, first.valueRight - first.valueLeft);
  assert.equal(first.hit.x, first.valueLeft - 6);
  assert.equal(first.hit.y, base + 3);
  assert.equal(first.hit.height, rowHeight - 6);
  assert.equal(first.hit.width, 240 - first.valueLeft - 4);
  // 热区不越过卡片右边界，也不与引脚重叠。
  assert.ok(first.hit.x + first.hit.width <= 240);
  assert.ok(first.hit.x > first.labelX);
  // 自定义引脚 X 会带动标签起点，标签宽度保持正值。
  const wide = rows.paramRowGeometry({ nodeWidth: 160, baseHeight: base, rowHeight, index: 0, pinX: 24 });
  assert.equal(wide.portX, 24);
  assert.equal(wide.labelX, 36);
  assert.ok(wide.labelWidth >= 24);
  assert.ok(rows.paramRowGeometry({ nodeWidth: 60, baseHeight: base, rowHeight, index: 0 }).valueWidth >= 24);
});

test('paramRowComplexSummary 给结构体与列表一个紧凑摘要', () => {
  assert.equal(rows.paramRowComplexSummary([1, 2, 3]), '[3 项]');
  assert.equal(rows.paramRowComplexSummary([]), '[0 项]');
  assert.equal(rows.paramRowComplexSummary({ x: 1, y: 2 }), '{2 字段}');
  assert.equal(rows.paramRowComplexSummary({}), '{}');
  assert.equal(rows.paramRowComplexSummary('文本'), '文本');
  assert.equal(rows.paramRowComplexSummary(undefined), '');
});

test('paramRowValueView 区分绑定、字面量、默认值与未设置', () => {
  const definition = { type: 'integer', default: 0 };
  const bound = rows.paramRowValueView({ param: 'random_offset', variable: '偏移', scope: 'inputs', definition }, compact);
  assert.equal(bound.tone, 'bound');
  assert.equal(bound.text, '← 偏移');
  assert.match(bound.title, /绑定 inputs\.偏移/);
  // 没有变量显示名时回退到内部名。
  assert.equal(rows.paramRowValueView({ param: 'random_offset', variable: 'offset', definition }, compact).text, '← offset');

  const literal = rows.paramRowValueView({ param: 'random_offset', definition, value: 11, configured: true }, compact);
  assert.equal(literal.tone, 'literal');
  assert.equal(literal.text, '11');
  assert.equal(literal.title, 'random_offset = 11');

  const fallback = rows.paramRowValueView({ param: 'random_offset', definition, configured: false }, compact);
  assert.equal(fallback.tone, 'default');
  assert.equal(fallback.text, '0');
  assert.match(fallback.title, /默认值 0/);

  const unset = rows.paramRowValueView({ param: 'hold_ms', definition: { type: 'integer' }, configured: false }, compact);
  assert.equal(unset.tone, 'unset');
  assert.equal(unset.text, '未设置');

  // 未显式给出 configured 时按「有值即已配置」推断（兼容旧引脚对象）。
  assert.equal(rows.paramRowValueView({ param: 'hold_ms', definition, value: 5 }, compact).tone, 'literal');
});

test('paramRowValueView 把结构体与资源压成摘要并标注详情栏', () => {
  const list = rows.paramRowValueView({ param: 'states', definition: { type: 'array' }, value: [1, 2], configured: true }, compact);
  assert.equal(list.tone, 'complex');
  assert.equal(list.text, '[2 项]');
  assert.match(list.title, /详情栏编辑/);
  const asset = rows.paramRowValueView({ param: 'template', definition: { type: 'asset' }, value: 'resources/a.png', configured: true }, compact);
  assert.equal(asset.tone, 'complex');
  assert.equal(asset.text, 'resources/a.png');
  assert.match(asset.title, /resources\/a\.png/);
  const object = rows.paramRowValueView({ param: 'roi', definition: { type: 'object' }, configured: true, value: { x: 1 } }, compact);
  assert.equal(object.text, '{1 字段}');
  // 默认值同样走摘要，不把整段 JSON 塞进卡片。
  assert.equal(rows.paramRowValueView({ param: 'states', definition: { type: 'array', default: [1, 2, 3] } }, compact).text, '[3 项]');
  // 超出宽度的字面量按 compact 截断。
  const long = rows.paramRowValueView({ param: 'name', definition: { type: 'string' }, value: 'x'.repeat(40), configured: true }, compact);
  assert.ok(long.text.length <= 18);
  assert.ok(long.text.endsWith('…'));
});

test('新类型的值文本：坐标点、时长、颜色、按键', () => {
  const point = rows.paramRowValueView({ param: 'target', definition: { type: 'point' }, value: { x: 960, y: 540 }, configured: true }, compact);
  assert.equal(point.text, '(960, 540)');
  assert.equal(point.tone, 'literal');
  assert.equal(point.title, 'target = (960, 540)');
  // 数组形式与缺字段都容错，不把 undefined 写进卡片。
  assert.equal(rows.paramPointText([12, 34]), '(12, 34)');
  assert.equal(rows.paramPointText({ x: 12 }), '(12, 0)');
  assert.equal(rows.paramPointText(null), '(0, 0)');
  assert.equal(rows.paramPointText({ x: 1.6, y: -2.4 }), '(2, -2)');

  const duration = rows.paramRowValueView({ param: 'settle', definition: { type: 'duration', default: 1.5 } }, compact);
  assert.equal(duration.text, '1.5s');
  assert.equal(duration.tone, 'default');
  assert.match(duration.title, /1\.5s（秒）/);
  assert.equal(rows.paramDurationText(8), '8s');
  assert.equal(rows.paramDurationText(0.25), '0.25s');

  const color = rows.paramRowValueView({ param: 'tint', definition: { type: 'color' }, value: '#ff8c3a', configured: true }, compact);
  assert.equal(color.text, '#ff8c3a');
  assert.equal(rows.paramColorSwatch('#ff8c3a'), '#ff8c3a');
  assert.equal(rows.paramColorSwatch('红色'), null);
  assert.equal(rows.paramColorSwatch(undefined), null);

  const key = rows.paramRowValueView({ param: 'confirm_key', definition: { type: 'key' }, value: 'BACK', configured: true }, compact);
  assert.equal(key.text, 'BACK');
  assert.equal(rows.paramKeyText(' ENTER '), 'ENTER');
  assert.equal(rows.paramKeyText(undefined), '');
});

test('paramLiteralText 给出输入框初值', () => {
  assert.equal(rows.paramLiteralText('integer', 11), '11');
  assert.equal(rows.paramLiteralText('number', 0.5), '0.5');
  assert.equal(rows.paramLiteralText('string', 'abc'), 'abc');
  assert.equal(rows.paramLiteralText('boolean', true), 'true');
  assert.equal(rows.paramLiteralText('boolean', false), 'false');
  assert.equal(rows.paramLiteralText('integer', undefined), '');
  assert.equal(rows.paramLiteralText('integer', null), '');
  assert.equal(rows.paramLiteralText('complex', { x: 1 }), '{"x":1}');
  assert.equal(rows.paramLiteralText('point', { x: 960, y: 540 }), '(960, 540)');
  assert.equal(rows.paramLiteralText('duration', 1.5), '1.5');
  assert.equal(rows.paramLiteralText('color', '#ff8c3a'), '#ff8c3a');
  assert.equal(rows.paramLiteralText('key', 'BACK'), 'BACK');
});

test('parseParamLiteral 校验整数、数值与范围', () => {
  assert.deepEqual(rows.parseParamLiteral('integer', ' 11 ', { type: 'integer' }), { ok: true, value: 11 });
  assert.deepEqual(rows.parseParamLiteral('integer', '-3', { type: 'integer' }), { ok: true, value: -3 });
  assert.deepEqual(rows.parseParamLiteral('integer', '1.5', { type: 'integer' }), { ok: false, error: '需要整数' });
  assert.deepEqual(rows.parseParamLiteral('integer', '', { type: 'integer' }), { ok: false, error: '需要数值' });
  assert.deepEqual(rows.parseParamLiteral('integer', 'abc', { type: 'integer' }), { ok: false, error: '需要整数' });
  assert.deepEqual(rows.parseParamLiteral('number', '0.25', { type: 'number' }), { ok: true, value: 0.25 });
  assert.deepEqual(rows.parseParamLiteral('number', '1e3', { type: 'number' }), { ok: true, value: 1000 });
  assert.deepEqual(rows.parseParamLiteral('number', 'x', { type: 'number' }), { ok: false, error: '需要数值' });
  // 范围：min/max 来自清单定义，越界不写入。
  assert.deepEqual(rows.parseParamLiteral('integer', '0', { min: 1 }), { ok: false, error: '不能小于 1' });
  assert.deepEqual(rows.parseParamLiteral('number', '1.5', { max: 1 }), { ok: false, error: '不能大于 1' });
  assert.deepEqual(rows.parseParamLiteral('integer', '1', { min: 1, max: 1 }), { ok: true, value: 1 });
  // 文本保留原始空格，布尔接受常见写法。
  assert.deepEqual(rows.parseParamLiteral('string', ' a b '), { ok: true, value: ' a b ' });
  assert.deepEqual(rows.parseParamLiteral('boolean', 'true'), { ok: true, value: true });
  assert.deepEqual(rows.parseParamLiteral('boolean', '否'), { ok: true, value: false });
  // 结构与资源不允许在卡片内改。
  assert.deepEqual(rows.parseParamLiteral('complex', '{}'), { ok: false, error: '该参数不支持卡片内编辑' });
  assert.deepEqual(rows.parseParamLiteral('asset', 'a.png'), { ok: false, error: '该参数不支持卡片内编辑' });
});

test('paramEnumOptions 用同一套标签渲染选项', () => {
  const options = rows.paramEnumOptions({ enum: ['all', 'any'] }, (value) => (value === 'all' ? '全部' : '任意'));
  assert.deepEqual(options, [{ value: 'all', label: '全部' }, { value: 'any', label: '任意' }]);
  assert.deepEqual(rows.paramEnumOptions({}, (value) => value), []);
  assert.deepEqual(rows.paramEnumOptions(null, (value) => value), []);
});

test('parseParamLiteral 校验新类型：坐标点、时长、颜色与按键', () => {
  // 坐标点接受逗号/空格/括号写法，并取整。
  assert.deepEqual(rows.parseParamLiteral('point', '100, 200'), { ok: true, value: { x: 100, y: 200 } });
  assert.deepEqual(rows.parseParamLiteral('point', '(12 34)'), { ok: true, value: { x: 12, y: 34 } });
  assert.deepEqual(rows.parseParamLiteral('point', '12.6,-2.4'), { ok: true, value: { x: 13, y: -2 } });
  assert.deepEqual(rows.parseParamLiteral('point', '100'), { ok: false, error: '需要两个数值，如 100, 200' });
  assert.deepEqual(rows.parseParamLiteral('point', 'a, b'), { ok: false, error: '坐标需要数值' });
  // 时长与数值同规则，沿用 min/max。
  assert.deepEqual(rows.parseParamLiteral('duration', '1.5', { type: 'duration' }), { ok: true, value: 1.5 });
  assert.deepEqual(rows.parseParamLiteral('duration', '', { type: 'duration' }), { ok: false, error: '需要数值' });
  assert.deepEqual(rows.parseParamLiteral('duration', '0', { min: 0.1 }), { ok: false, error: '不能小于 0.1' });
  assert.deepEqual(rows.parseParamLiteral('duration', '9', { max: 8 }), { ok: false, error: '不能大于 8' });
  // 颜色必须是 #rrggbb，写入时统一小写。
  assert.deepEqual(rows.parseParamLiteral('color', '#FF8C3A'), { ok: true, value: '#ff8c3a' });
  assert.deepEqual(rows.parseParamLiteral('color', 'ff8c3a'), { ok: false, error: '需要 #rrggbb' });
  assert.deepEqual(rows.parseParamLiteral('color', '#ff8c3'), { ok: false, error: '需要 #rrggbb' });
  assert.deepEqual(rows.parseParamLiteral('color', ''), { ok: false, error: '需要颜色值' });
  // 按键是 Android keyevent 令牌，不能带空白。
  assert.deepEqual(rows.parseParamLiteral('key', ' BACK '), { ok: true, value: 'BACK' });
  assert.deepEqual(rows.parseParamLiteral('key', 'DPAD_UP'), { ok: true, value: 'DPAD_UP' });
  assert.deepEqual(rows.parseParamLiteral('key', '4'), { ok: true, value: '4' });
  assert.deepEqual(rows.parseParamLiteral('key', 'BACK SPACE'), { ok: false, error: '按键名只能是字母/数字/下划线' });
  assert.deepEqual(rows.parseParamLiteral('key', ''), { ok: false, error: '需要按键名' });
});

test('paramEditorAction 决定点击值区后的动作', () => {
  assert.equal(rows.paramEditorAction({ param: 'x', variable: 'v', definition: { type: 'integer' } }), 'binding-menu');
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'boolean' } }), 'toggle');
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { enum: ['a'] } }), 'enum-menu');
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'integer' } }), 'input');
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'number' } }), 'input');
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'string' } }), 'input');
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'asset' } }), 'inspector');
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'object' } }), 'inspector');
  assert.equal(rows.paramEditorAction({ param: 'x' }), 'inspector');
  // 新类型都能在卡片里就地编辑（按键走选择器，坐标点走双栏输入）。
  for (const type of ['point', 'color', 'key', 'duration']) {
    assert.equal(rows.paramEditorAction({ param: 'x', definition: { type } }), 'input', type);
  }
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'enum', enum: ['a'] } }), 'enum-menu');
});

test('paramEditorCurrentValue 已配置优先，其次默认值', () => {
  const definition = { type: 'integer', default: 0 };
  assert.equal(rows.paramEditorCurrentValue({ param: 'x', definition, configured: true, value: 11 }), 11);
  assert.equal(rows.paramEditorCurrentValue({ param: 'x', definition, configured: false }), 0);
  assert.equal(rows.paramEditorCurrentValue({ param: 'x', definition: {} }), undefined);
  assert.equal(rows.paramEditorCurrentValue({ param: 'x' }), undefined);
  // 显式配置成 undefined 时不要偷偷回落成默认值写入。
  assert.equal(rows.paramEditorCurrentValue({ param: 'x', definition, configured: true, value: undefined }), undefined);
});

test('worldRectToScreen 跟随缩放与平移，并给出可用最小尺寸', () => {
  const view = { left: 0, top: 0, zoom: 1, panX: 16, panY: 10 };
  assert.deepEqual(rows.worldRectToScreen({ x: 100, y: 50, width: 120, height: 18 }, view), { left: 116, top: 60, width: 120, height: 18 });
  const zoomed = rows.worldRectToScreen({ x: 100, y: 50, width: 120, height: 18 }, { left: 5, top: 7, zoom: 0.5, panX: 0, panY: 0 });
  assert.deepEqual(zoomed, { left: 55, top: 32, width: 88, height: 18 });
  const tiny = rows.worldRectToScreen({ x: 0, y: 0, width: 10, height: 4 }, { left: 0, top: 0, zoom: 0.2, panX: 0, panY: 0 });
  assert.equal(tiny.width, 88);
  assert.equal(tiny.height, 18);
  // 缩放为 0/NaN 时按 1 处理，避免浮层塌成一条线。
  assert.equal(rows.worldRectToScreen({ x: 10, y: 10, width: 100, height: 20 }, { left: 0, top: 0, zoom: 0, panX: 0, panY: 0 }).left, 10);
  assert.equal(rows.worldRectToScreen({ x: 10, y: 10, width: 100, height: 20 }, { left: 0, top: 0, zoom: NaN, panX: 0, panY: 0 }).width, 100);
});