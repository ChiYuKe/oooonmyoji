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
  assert.equal(rows.paramRowKind({ type: 'workflow' }), 'workflow');
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
  // 固定长度标量数组拆成输入格；长度不定、元素是对象/资源、或太长都回详情栏。
  assert.equal(rows.paramRowKind({ type: 'array', items: { type: 'duration' }, min_items: 2, max_items: 2 }), 'tuple');
  assert.equal(rows.paramRowKind({ type: 'array', items: { type: 'number' }, default: [0, 0] }), 'tuple');
  assert.equal(rows.paramRowKind({ type: 'array', items: { type: 'number' } }), 'complex');
  assert.equal(rows.paramRowKind({ type: 'array', items: { type: 'number' }, min_items: 1, max_items: 3 }), 'complex');
  assert.equal(rows.paramRowKind({ type: 'array', items: { type: 'object' }, min_items: 2, max_items: 2 }), 'complex');
  assert.equal(rows.paramRowKind({ type: 'array', items: { type: 'asset' }, min_items: 2, max_items: 2 }), 'complex');
  assert.equal(rows.paramRowKind({ type: 'array', items: { type: 'number' }, min_items: 5, max_items: 5 }), 'complex');
});

test('paramTupleLength 只认固定长度的标量数组', () => {
  assert.equal(rows.paramTupleLength({ type: 'array', items: { type: 'duration' }, min_items: 2, max_items: 2 }), 2);
  assert.equal(rows.paramTupleLength({ type: 'array', items: { type: 'number' }, default: [0, 0, 0] }), 3);
  assert.equal(rows.paramTupleLength({ type: 'array', items: { type: 'number' }, default: [0, 0, 0, 0] }), null);
  assert.equal(rows.paramTupleLength({ type: 'array', items: { type: 'number' } }), null);
  assert.equal(rows.paramTupleLength({ type: 'array', items: { type: 'number' }, min_items: 2 }), null);
  assert.equal(rows.paramTupleLength({ type: 'array', items: { type: 'number' }, min_items: 2, max_items: 3 }), null);
  assert.equal(rows.paramTupleLength({ type: 'array', items: { type: 'string' }, min_items: 0, max_items: 0 }), null);
  assert.equal(rows.paramTupleLength({ type: 'array', items: { type: 'number' }, min_items: 9, max_items: 9 }), null);
  assert.equal(rows.PARAM_TUPLE_MAX, 3);
  assert.equal(rows.paramTupleLength({ type: 'number' }), null);
  assert.equal(rows.paramTupleLength(null), null);
});

test('固定长度数组的值文本与提交：每个元素一个输入格', () => {
  const interval = { type: 'array', items: { type: 'duration', min: 0 }, min_items: 2, max_items: 2, default: [0, 0] };
  assert.equal(rows.paramTupleItemKind(interval), 'duration');
  assert.deepEqual(rows.paramTupleCells(interval, [0.2, 0.6]), [0.2, 0.6]);
  // 缺元素补 undefined，多余的截掉，长度始终等于声明的长度。
  assert.deepEqual(rows.paramTupleCells(interval, [0.2]), [0.2, undefined]);
  assert.deepEqual(rows.paramTupleCells(interval, [0.2, 0.6, 1.5]), [0.2, 0.6]);
  assert.deepEqual(rows.paramTupleCells(interval, undefined), [undefined, undefined]);
  assert.equal(rows.paramTupleElementText('duration', 0.25), '0.25');
  assert.equal(rows.paramTupleElementText('duration', 2), '2');
  assert.equal(rows.paramTupleElementText('integer', 25), '25');
  assert.equal(rows.paramTupleElementText('string', 'abc'), 'abc');
  assert.equal(rows.paramTupleElementText('color', '#ff8c3a'), '#ff8c3a');
  assert.equal(rows.paramTupleElementText('duration', undefined), '');
  // 整行文本：元素逐个显示，缺的给占位符。
  assert.equal(rows.paramTupleText(interval, [0.2, 0.6]), '0.2, 0.6');
  assert.equal(rows.paramTupleText(interval, [0.2]), '0.2, —');
  assert.equal(rows.paramTupleText(interval, undefined), '—, —');
  // 值视图：已配置走字面量，未配置用定义默认值。
  const literal = rows.paramRowValueView({ param: 'random_interval', definition: interval, value: [0.2, 0.6], configured: true }, compact);
  assert.equal(literal.tone, 'literal');
  assert.equal(literal.text, '0.2, 0.6');
  assert.equal(literal.title, 'random_interval = 0.2, 0.6');
  const fallback = rows.paramRowValueView({ param: 'random_interval', definition: interval, configured: false }, compact);
  assert.equal(fallback.tone, 'default');
  assert.equal(fallback.text, '0, 0');
  assert.match(fallback.title, /默认值 0, 0/);
  // 提交：逐格按元素类型校验，范围来自 items（这里 min 0）。
  assert.deepEqual(rows.parseParamTuple(interval, ['0.2', '0.6']), { ok: true, value: [0.2, 0.6] });
  assert.deepEqual(rows.parseParamTuple(interval, ['1', '2']), { ok: true, value: [1, 2] });
  assert.deepEqual(rows.parseParamTuple(interval, ['0.2', '']), { ok: false, error: '第 2 项：需要数值' });
  assert.deepEqual(rows.parseParamTuple(interval, ['-1', '2']), { ok: false, error: '第 1 项：不能小于 0' });
  assert.deepEqual(rows.parseParamTuple({ ...interval, items: { type: 'integer' } }, ['1.5', '2']), { ok: false, error: '第 1 项：需要整数' });
  assert.deepEqual(rows.parseParamTuple(interval, ['0.2']), { ok: false, error: '需要 2 个数值' });
  assert.equal(rows.paramLiteralText('tuple', [0.2, 0.6], interval), '0.2, 0.6');
  // 元素是字符串时不带引号，原样显示。
  const pair = { type: 'array', items: { type: 'string' }, min_items: 2, max_items: 2 };
  assert.deepEqual(rows.parseParamTuple(pair, ['a', 'b c']), { ok: true, value: ['a', 'b c'] });
});

test('paramRowEditable 放行标量、资源、区域与固定长度数组，只有结构体回详情栏', () => {
  for (const kind of ['enum', 'boolean', 'integer', 'number', 'duration', 'string', 'workflow', 'key', 'color', 'point', 'asset', 'rect', 'tuple']) {
    assert.equal(rows.paramRowEditable(kind), true, kind);
  }
  for (const kind of ['complex']) assert.equal(rows.paramRowEditable(kind), false, kind);
});

test('固定卡片的标签与值框在同一行，端点居中', () => {
  const first = rows.paramRowGeometry({ nodeWidth: 260, baseHeight: 96, rowHeight: 30, index: 0, boxedInline: true });
  const second = rows.paramRowGeometry({ nodeWidth: 260, baseHeight: 96, rowHeight: 30, index: 1, boxedInline: true });
  assert.equal(first.labelY, first.valueY);
  assert.equal(first.centerY, 111);
  assert.equal(first.labelX, 22);
  assert.equal(first.labelWidth, 123);
  assert.deepEqual(first.hit, { x: 151, y: 101, width: 97, height: 20 });
  assert.equal(second.centerY - first.centerY, 30);
  assert.equal(first.hit.x + first.hit.width, first.valueRight);
});

test('paramRowGeometry 支持旧卡片的双行行样式', () => {
  const base = 96;
  const rowHeight = 40;
  const first = rows.paramRowGeometry({ nodeWidth: 260, baseHeight: base, rowHeight, index: 0, twoLine: true });
  const fourth = rows.paramRowGeometry({ nodeWidth: 260, baseHeight: base, rowHeight, index: 3, twoLine: true });
  assert.equal(first.y, base);
  assert.equal(first.centerY, base + 20);
  assert.equal(fourth.y, base + 120);
  // 标签在自己的带内居中，值文字居中在输入框里。
  assert.equal(first.labelY, base + 13);
  assert.equal(first.valueY, base + 31);
  assert.equal(fourth.valueY, base + 151);
  assert.ok(first.labelY < first.valueY && first.valueY <= first.y + rowHeight);
  // 值区从标签起点铺到卡片右边，比单行样式的值区宽得多。
  assert.equal(first.valueLeft, first.labelX);
  assert.equal(first.valueRight, 260 - 12);
  assert.equal(first.valueWidth, first.valueRight - first.valueLeft);
  assert.ok(first.valueWidth > rows.paramRowGeometry({ nodeWidth: 260, baseHeight: base, rowHeight: 24, index: 0 }).valueWidth);
  // 热区就是值行的可见输入框：贴在同一矩形上，行内浮层点开后不会跳位。
  assert.equal(first.hit.x, first.labelX);
  assert.equal(first.hit.y, base + 19);
  assert.equal(first.hit.height, 18);
  assert.ok(first.hit.y > first.labelY && first.hit.y + first.hit.height >= first.valueY);
  assert.ok(first.hit.x > first.portX + 5.5);
  assert.equal(rows.PARAM_FIELD_PADDING, 9);
  // 值行框与浮层内边距对齐：文字起点 = 框左边 + 内边距。
  assert.equal(first.hit.x + rows.PARAM_FIELD_PADDING, first.labelX + 9);
  // 值区是一套固定网格：单个值占一格（半行），数组在**自己这一格**里再均分，不取整。
  assert.equal(rows.PARAM_FIELD_COLUMNS, 2);
  assert.equal(rows.paramFieldWidth(226), 111);
  assert.equal(rows.paramFieldWidth(226, 2), 111);
  assert.equal(rows.paramFieldWidth(226, 3), 218 / 3);
  assert.equal(rows.paramFieldWidth(226, 4), 53.5);
  // 一格（111）里放两个小格：每格 53.5，加上 4px 间距正好用满一格、不越界。
  assert.equal(rows.paramFieldWidth(111, 2), 53.5);
  assert.equal(53.5 * 2 + rows.PARAM_FIELD_GAP, 111);
  assert.equal(rows.paramFieldWidth(20), 24);
  assert.equal(first.hit.width, 111, '双行行样式的值框固定占一格');
  assert.equal(first.hit.width, rows.paramFieldWidth(first.valueWidth));
});

test('paramRowOpensPicker 标记需要在卡片上展开选择器的行', () => {
  for (const kind of ['asset', 'rect', 'enum', 'key', 'color', 'point', 'complex']) {
    assert.equal(rows.paramRowOpensPicker(kind), true, kind);
  }
  for (const kind of ['string', 'integer', 'number', 'duration', 'boolean', 'tuple']) {
    assert.equal(rows.paramRowOpensPicker(kind), false, kind);
  }
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

test('paramRowValueView 把结构体压成摘要，资源显示文件名', () => {
  const list = rows.paramRowValueView({ param: 'states', definition: { type: 'array' }, value: [1, 2], configured: true }, compact);
  assert.equal(list.tone, 'complex');
  assert.equal(list.text, '[2 项]');
  assert.match(list.title, /详情栏编辑/);
  const asset = rows.paramRowValueView({ param: 'template', definition: { type: 'asset' }, value: 'resources/a.png', configured: true }, compact);
  assert.equal(asset.tone, 'complex');
  assert.equal(asset.text, 'a.png');
  assert.match(asset.title, /resources\/a\.png/);
  assert.equal(rows.paramAssetName('assets\\templates\\battle.png'), 'battle.png');
  const object = rows.paramRowValueView({ param: 'roi', definition: { type: 'object' }, configured: true, value: { x: 1 } }, compact);
  assert.equal(object.text, '{1 字段}');
  // 默认值同样走摘要，不把整段 JSON 塞进卡片。
  assert.equal(rows.paramRowValueView({ param: 'states', definition: { type: 'array', default: [1, 2, 3] } }, compact).text, '[3 项]');
  // 超出宽度的字面量按 compact 截断。
  const long = rows.paramRowValueView({ param: 'name', definition: { type: 'string' }, value: 'x'.repeat(40), configured: true }, compact);
  assert.ok(long.text.length <= 18);
  assert.ok(long.text.endsWith('…'));
});

test('区域值文本与解析：卡片上直接改识别区域', () => {
  const rect = { param: 'roi', definition: { type: 'rect' }, value: [10, 20, 200, 80], configured: true };
  const view = rows.paramRowValueView(rect, compact);
  assert.equal(view.tone, 'literal');
  assert.equal(view.text, '10,20 200×80');
  assert.equal(view.title, 'roi = 10, 20 200×80');
  assert.equal(rows.paramRectText([0, 0, 0, 0]), '0,0 0×0');
  assert.equal(rows.paramRectText([1, 2]), '');
  assert.equal(rows.paramRectText('x'), '');
  // 未配置时用定义里的默认区域。
  const fallback = rows.paramRowValueView({ param: 'roi', definition: { type: 'rect', default: [0, 0, 1920, 1080] }, configured: false }, compact);
  assert.equal(fallback.tone, 'default');
  assert.equal(fallback.text, '0,0 1920×1080');
  // 非四元组的旧数据只做摘要，不假装成合法区域。
  const broken = rows.paramRowValueView({ param: 'roi', definition: { type: 'rect' }, value: { x: 1 }, configured: true }, compact);
  assert.equal(broken.tone, 'complex');
  assert.match(broken.title, /框选或手输四坐标/);

  assert.equal(rows.paramLiteralText('rect', [10, 20, 200, 80]), '10, 20, 200, 80');
  assert.deepEqual(rows.parseParamLiteral('rect', '10, 20, 200, 80'), { ok: true, value: [10, 20, 200, 80] });
  assert.deepEqual(rows.parseParamLiteral('rect', '[12.4, 8.6, 100, 50]'), { ok: true, value: [12, 9, 100, 50] });
  assert.deepEqual(rows.parseParamLiteral('rect', '10 20 200×80'), { ok: true, value: [10, 20, 200, 80] });
  assert.deepEqual(rows.parseParamLiteral('rect', '10, 20, 200'), { ok: false, error: '需要四个数值：x, y, 宽, 高' });
  assert.deepEqual(rows.parseParamLiteral('rect', '10, 20, 200, x'), { ok: false, error: '区域需要数值' });
  assert.deepEqual(rows.parseParamLiteral('rect', '10, 20, -5, 80'), { ok: false, error: '区域宽高不能为负' });
});

test('行控件可被卡片声明的 control 覆盖（数组参数用区域框选）', () => {
  const arrayDefinition = { type: 'array', items: { type: 'number' } };
  assert.equal(rows.paramRowKind(arrayDefinition), 'complex');
  assert.equal(rows.paramRowKindFromControl('rect'), 'rect');
  assert.equal(rows.paramRowKindFromControl('toggle'), 'boolean');
  assert.equal(rows.paramRowKindFromControl('inspector'), 'complex');
  assert.equal(rows.paramRowKindFromControl('nope'), null);
  assert.equal(rows.paramRowKindFromControl(undefined), null);
  // control 决定值文本与点击动作，参数类型仍用于兼容性检查。
  const row = { param: 'target_rois', control: 'rect', definition: arrayDefinition, value: [1, 2, 3, 4], configured: true };
  assert.equal(rows.paramRowKindOf(row, arrayDefinition), 'rect');
  assert.equal(rows.paramRowValueView(row, compact).text, '1,2 3×4');
  assert.equal(rows.paramEditorAction(row), 'roi-menu');
  const forced = { param: 'match', control: 'inspector', definition: { type: 'object' }, configured: true };
  assert.equal(rows.paramRowKindOf(forced, { type: 'object' }), 'complex');
  assert.equal(rows.paramEditorAction(forced), 'inspector');
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
  // 结构与资源不允许在卡片内改字面量：结构体回详情栏，资源走素材菜单。
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
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'workflow' } }), 'workflow-menu');
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'asset' } }), 'asset-menu');
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'rect' } }), 'roi-menu');
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'array', items: { type: 'duration' }, min_items: 2, max_items: 2 } }), 'input');
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'object' } }), 'inspector');
  assert.equal(rows.paramEditorAction({ param: 'x' }), 'inspector');
  // 新类型都能在卡片里就地编辑（按键走选择器，坐标点走双栏输入）。
  for (const type of ['point', 'color', 'key', 'duration']) {
    assert.equal(rows.paramEditorAction({ param: 'x', definition: { type } }), 'input', type);
  }
  assert.equal(rows.paramEditorAction({ param: 'x', definition: { type: 'enum', enum: ['a'] } }), 'enum-menu');
  // 卡片声明的 control 覆盖参数类型给出的默认动作。
  assert.equal(rows.paramEditorAction({ param: 'x', control: 'rect', definition: { type: 'array' } }), 'roi-menu');
  assert.equal(rows.paramEditorAction({ param: 'x', control: 'asset', definition: { type: 'string' } }), 'asset-menu');
  assert.equal(rows.paramEditorAction({ param: 'x', control: 'toggle', definition: { type: 'string' } }), 'toggle');
  // 已绑定变量时仍然优先给绑定菜单。
  assert.equal(rows.paramEditorAction({ param: 'x', variable: 'v', control: 'rect', definition: { type: 'array' } }), 'binding-menu');
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
