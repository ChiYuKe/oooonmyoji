// Run via npm test (builds the renderer test output first).
// 画布 schema 工具已迁到 src/canvas/model/schema.ts：直接验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createEditorSchema } = require('../dist-test-renderer/canvas/model/schema.js');

const schema = createEditorSchema();

test('definitionSchema 按定义类型生成引用兼容 schema', () => {
  assert.deepEqual(schema.definitionSchema({type: 'asset'}), {type: 'string'});
  assert.deepEqual(schema.definitionSchema({type: 'path'}), {type: 'string'});
  // 区域是定长四元组 [x, y, w, h]：带 title 的分量让拆分卡片能排出 X / Y / W / H 四个引脚。
  assert.deepEqual(schema.definitionSchema({type: 'rect'}), {
    type: 'array',
    prefixItems: [
      {type: 'integer', title: 'X'},
      {type: 'integer', title: 'Y'},
      {type: 'integer', title: 'W'},
      {type: 'integer', title: 'H'},
    ],
    minItems: 4,
    maxItems: 4,
  });
  assert.deepEqual(schema.definitionSchema({type: 'any'}), {});
  assert.deepEqual(schema.definitionSchema({type: 'integer'}), {type: 'integer'});
  assert.deepEqual(schema.definitionSchema({type: 'object', properties: {a: {type: 'integer'}, b: {type: 'asset'}}}), {type: 'object', properties: {a: {type: 'integer'}, b: {type: 'string'}}});
  assert.deepEqual(schema.definitionSchema({type: 'array', items: {type: 'number'}}), {type: 'array', items: {type: 'number'}});
  assert.deepEqual(schema.definitionSchema(null), {});
  // 新类型：字符串家族、数值家族与坐标点。
  assert.deepEqual(schema.definitionSchema({type: 'key'}), {type: 'string'});
  assert.deepEqual(schema.definitionSchema({type: 'color'}), {type: 'string'});
  assert.deepEqual(schema.definitionSchema({type: 'enum', enum: ['a', 'b']}), {type: 'string'});
  assert.deepEqual(schema.definitionSchema({type: 'duration'}), {type: 'number'});
  assert.deepEqual(schema.definitionSchema({type: 'point'}), {type: 'object', properties: {x: {type: 'integer'}, y: {type: 'integer'}}});
});

test('compatibleRefType 允许 integer 到 number，拒绝不相关类型', () => {
  assert.equal(schema.compatibleRefType({type: 'number'}, {type: 'integer'}), true);
  assert.equal(schema.compatibleRefType({type: 'string'}, {type: 'integer'}), false);
  assert.equal(schema.compatibleRefType({}, {type: 'integer'}), true);
  assert.equal(schema.compatibleRefType({type: 'string'}, {}), true);
  // 时长按数值参与兼容，颜色/按键/枚举按字符串参与兼容，坐标点按对象参与兼容。
  assert.equal(schema.compatibleRefType(schema.definitionSchema({type: 'duration'}), schema.definitionSchema({type: 'integer'})), true);
  assert.equal(schema.compatibleRefType(schema.definitionSchema({type: 'color'}), schema.definitionSchema({type: 'string'})), true);
  assert.equal(schema.compatibleRefType(schema.definitionSchema({type: 'key'}), schema.definitionSchema({type: 'asset'})), true);
  assert.equal(schema.compatibleRefType(schema.definitionSchema({type: 'point'}), schema.definitionSchema({type: 'object'})), true);
  assert.equal(schema.compatibleRefType(schema.definitionSchema({type: 'point'}), schema.definitionSchema({type: 'string'})), false);
  assert.equal(schema.compatibleRefType(schema.definitionSchema({type: 'duration'}), schema.definitionSchema({type: 'boolean'})), false);
});

test('appendNestedRefs 展开对象与数组成员引用', () => {
  const out = [];
  schema.appendNestedRefs('inputs.a', {type: 'object', properties: {x: {type: 'integer'}, nested: {type: 'object', properties: {y: {type: 'string'}}}}}, out);
  assert.deepEqual(out.map((item) => item.ref), ['inputs.a.x', 'inputs.a.nested', 'inputs.a.nested.y']);
  const list = [];
  schema.appendNestedRefs('nodes.n.output', {type: 'array', items: {type: 'object', properties: {z: {type: 'boolean'}}}}, list);
  assert.deepEqual(list.map((item) => item.ref), ['nodes.n.output.0', 'nodes.n.output.0.z']);
  // 坐标点编译成对象后可以按分量引用（inputs.p.x / inputs.p.y）。
  const point = [];
  schema.appendNestedRefs('inputs.p', schema.definitionSchema({type: 'point'}), point);
  assert.deepEqual(point.map((item) => item.ref), ['inputs.p.x', 'inputs.p.y']);
});
