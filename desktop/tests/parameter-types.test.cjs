/**
 * 参数类型词汇表与 schema 编译：桌面侧必须和 Python `oooonmyoji.actions.manifest` 逐条对齐。
 * 类型表漂移由 tests/contract_check.py（pytest 包装）拦截，这里锁定值形状与校验规则。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const types = require('../dist-test-renderer/shared/parameter-types.js');
const { PARAMETER_TYPES, parseParameterDefinition, parameterToSchema } = require('../dist-electron/shared/workflow/parameters.js');

test('PARAMETER_TYPES 覆盖全部类型且顺序与 Python 一致', () => {
  assert.deepEqual([...PARAMETER_TYPES], [
    'string', 'number', 'integer', 'boolean', 'rect', 'asset', 'path', 'array', 'object', 'any',
    'point', 'enum', 'key', 'color', 'duration',
  ]);
  // 画布用的无依赖副本必须与主进程副本同源。
  assert.deepEqual([...types.PARAMETER_TYPES], [...PARAMETER_TYPES]);
});

test('每种类型都有中文标签与图标可用的类型名', () => {
  for (const type of PARAMETER_TYPES) {
    assert.equal(typeof types.PARAMETER_TYPE_LABELS[type], 'string', type);
    assert.notEqual(types.PARAMETER_TYPE_LABELS[type], '', type);
  }
  assert.equal(types.parameterTypeLabel('point'), '坐标点');
  assert.equal(types.parameterTypeLabel('enum'), '枚举');
  assert.equal(types.parameterTypeLabel('key'), '按键');
  assert.equal(types.parameterTypeLabel('color'), '颜色');
  assert.equal(types.parameterTypeLabel('duration'), '时长');
  // 未知类型原样返回，缺省回落到「任意」。
  assert.equal(types.parameterTypeLabel('mystery'), 'mystery');
  assert.equal(types.parameterTypeLabel(undefined), '任意');
});

test('按键候选表带中文说明，且都能通过 key 的取值约束', () => {
  const pattern = new RegExp(types.KEY_PATTERN);
  assert.ok(types.KEY_NAMES.length >= 12);
  for (const name of types.KEY_NAMES) {
    assert.ok(pattern.test(name), name);
    assert.equal(typeof types.KEY_LABELS[name], 'string', name);
    assert.equal(types.keyOptionLabel(name), `${name} · ${types.KEY_LABELS[name]}`);
  }
  // 数字键码只给说明，不参与候选列表。
  assert.equal(types.keyOptionLabel('4'), '4 · 返回');
  assert.equal(types.keyOptionLabel('UNKNOWN_KEY'), 'UNKNOWN_KEY');
});

test('新类型编译出的 JSON Schema 与 Python 端一致', () => {
  assert.deepEqual(parameterToSchema({ type: 'point' }), {
    type: 'object',
    properties: { x: { type: 'integer' }, y: { type: 'integer' } },
    required: ['x', 'y'],
    additionalProperties: false,
  });
  assert.deepEqual(parameterToSchema({ type: 'color' }), { type: 'string', pattern: types.COLOR_PATTERN });
  assert.deepEqual(parameterToSchema({ type: 'key', minLength: 1 }), {
    type: 'string', pattern: types.KEY_PATTERN, minLength: 1,
  });
  assert.deepEqual(parameterToSchema({ type: 'duration', min: 0.5, max: 3 }), {
    type: 'number', minimum: 0.5, maximum: 3,
  });
  assert.deepEqual(parameterToSchema({ type: 'enum', enum: ['safe', 'fast'] }), {
    type: 'string', enum: ['safe', 'fast'],
  });
});

test('parseParameterDefinition 接受新类型并校验默认值', () => {
  const point = parseParameterDefinition({ type: 'point', default: { x: 1, y: 2 } }, 'target');
  assert.equal(point.type, 'point');
  assert.deepEqual(point.default, { x: 1, y: 2 });
  assert.equal(parseParameterDefinition({ type: 'color', default: '#0a0b0c' }, 'tint').default, '#0a0b0c');
  assert.equal(parseParameterDefinition({ type: 'key', default: 'BACK' }, 'confirm').default, 'BACK');
  assert.equal(parseParameterDefinition({ type: 'duration', default: 1.5 }, 'settle').default, 1.5);
  assert.deepEqual(parseParameterDefinition({ type: 'enum', enum: ['a'], default: 'a' }, 'mode').enum, ['a']);
  // enum 类型的选项数组会被原样带出，供变量详情与卡片菜单共用。
  assert.deepEqual(parseParameterDefinition({ type: 'enum', enum: ['x', 'y'] }, 'mode').enum, ['x', 'y']);
});

test('parseParameterDefinition 拒绝非法的新类型定义', () => {
  const cases = [
    [{ type: 'enum' }, /enum type requires a non-empty enum list/],
    [{ type: 'enum', enum: [] }, /enum type requires a non-empty enum list/],
    [{ type: 'enum', enum: [1, 2] }, /enum\[0\] must be a string/],
    [{ type: 'point', min: 1 }, /min\/max are only valid for numeric types/],
    [{ type: 'color', min_length: 1 }, /min_length\/max_length are only valid for string types/],
    [{ type: 'color', default: 'red' }, /must match pattern/],
    [{ type: 'point', default: { x: 1 } }, /must have required property 'y'/],
    [{ type: 'key', default: 'BACK SPACE' }, /must match pattern/],
    [{ type: 'duration', default: 'soon' }, /must be number/],
  ];
  for (const [definition, expected] of cases) {
    assert.throws(() => parseParameterDefinition(definition, 'candidate'), expected, JSON.stringify(definition));
  }
});
