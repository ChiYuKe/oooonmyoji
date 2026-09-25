/**
 * UE 风格的节点标题：值卡片（布尔判断 / 拆分）的标题由类型派生。
 * 普通卡片：手动 name > 类型派生 > 节点 ID；值卡片例外——忽略自定义 name，
 * 标题永远是可读的类型语义（`等于` / `Break`），实例名留在条件回读与改名框占位里。
 */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
  OPERATOR_LABELS, boolJudgeTitle, breakTitle, derivedNodeTitle, nodeDisplayTitle,
} = require('../dist-test-renderer/canvas/model/node-title.js');

test('布尔判断卡片标题 = UE 的比较节点标题（运算符名）', () => {
  assert.equal(boolJudgeTitle({eq: [0, 0]}), '等于');
  assert.equal(boolJudgeTitle({ne: ['a', 'b']}), '不等于');
  assert.equal(boolJudgeTitle({gt: [2, 1]}), '大于');
  assert.equal(boolJudgeTitle({gte: [2, 1]}), '大于等于');
  assert.equal(boolJudgeTitle({lt: [1, 2]}), '小于');
  assert.equal(boolJudgeTitle({lte: [1, 2]}), '小于等于');
  assert.equal(boolJudgeTitle({contains: ['散华', '华']}), '包含');
  // 复合条件：标题只说最外层那个运算符，整句回读留给卡片副标题。
  assert.equal(boolJudgeTitle({and: [{eq: [1, 1]}, {gt: [2, 1]}]}), '并且');
  assert.equal(boolJudgeTitle({or: [{eq: [1, 1]}]}), '或者');
  assert.equal(boolJudgeTitle({not: {eq: [1, 1]}}), '不是');
  assert.equal(boolJudgeTitle({exists: {ref: 'inputs.flag'}}), '存在');
  assert.equal(boolJudgeTitle(true), '始终满足');
  assert.equal(boolJudgeTitle(false), '始终不满足');
  // 认不出的表达式（整卡引用另一个 bool、数组、缺字段）退回类型名，绝不裸露节点 ID。
  assert.equal(boolJudgeTitle({ref: 'nodes.bool_1.output.value'}), '布尔判断');
  assert.equal(boolJudgeTitle([1, 2]), '布尔判断');
  assert.equal(boolJudgeTitle(undefined), '布尔判断');
});

test('拆分卡片标题 = UE 的 `Break <Struct>`，来源用引用短名', () => {
  const deps = {referenceTitle: (ref) => (ref === 'nodes.classify.output' ? '识别结果' : ref)};
  assert.equal(breakTitle({type: 'break', ref: {ref: 'nodes.classify.output'}}, deps), 'Break 识别结果');
  // 字段引用给完整短名（UE 也是照结构体命名，不区分取的是哪个字段）。
  assert.equal(breakTitle({type: 'break', ref: {ref: 'nodes.wait.output.0'}}, deps), 'Break nodes.wait.output.0');
  // 输入/变量作来源时用变量显示名。
  assert.equal(breakTitle({type: 'break', ref: {ref: 'inputs.区域'}}, {referenceTitle: () => '识别区域'}), 'Break 识别区域');
  // 没绑来源时只说类型。
  assert.equal(breakTitle({type: 'break'}, deps), 'Break');
  assert.equal(breakTitle({type: 'break', ref: {}}, deps), 'Break');
  // 没有译名解析器时保留原始引用文本，绝不返回空标题。
  assert.equal(breakTitle({type: 'break', ref: {ref: 'nodes.classify.output'}}), 'Break nodes.classify.output');
});

test('三层优先级：手动 name > 类型派生标题 > 节点 ID（值卡片例外，见下一条）', () => {
  const deps = {referenceTitle: () => '识别结果'};
  // 普通卡片：手动 name 优先，没设过才用派生标题，最后才回退到 ID。
  assert.equal(nodeDisplayTitle({id: 'task_1', type: 'task'}, deps), 'task_1');
  assert.equal(nodeDisplayTitle({id: 'task_1', type: 'task', name: '点击挑战'}, deps), '点击挑战');
  assert.equal(derivedNodeTitle({id: 'task_1', type: 'task'}, deps), '');
  assert.equal(nodeDisplayTitle(null), '');
});

test('值卡片例外：忽略自定义 name，标题保持 UE 的类型语义', () => {
  const deps = {referenceTitle: () => '识别结果'};
  // 拆分卡：卡面标题固定是 `Break`（来源短名不挤进标题，实例名也不显示）。
  // 「Break <来源>」留给 F2 改名框的占位提示（`derivedNodeTitle`）。
  assert.equal(nodeDisplayTitle({id: 'break_1', type: 'break', name: '拆战斗结果', ref: {ref: 'nodes.classify.output'}}, deps), 'Break');
  assert.equal(nodeDisplayTitle({id: 'break_1', type: 'break', ref: {ref: 'nodes.classify.output'}}, deps), 'Break');
  assert.equal(derivedNodeTitle({id: 'break_1', type: 'break', ref: {ref: 'nodes.classify.output'}}, deps), 'Break 识别结果');
  // 布尔判断卡：标题就是运算符名，实例名同样不进标题。
  assert.equal(nodeDisplayTitle({id: 'bool_1', type: 'bool_judge', expression: {eq: [0, 0]}}, deps), '等于');
  assert.equal(nodeDisplayTitle({id: 'bool_1', type: 'bool_judge', name: '结界未结算', expression: {eq: [0, 0]}}, deps), '等于');
  // 只有空白的 name 不算设过。
  assert.equal(nodeDisplayTitle({id: 'bool_1', type: 'bool_judge', name: '   ', expression: {eq: [0, 0]}}, deps), '等于');
});

test('运算符表是卡片标题与条件回读共用的那一份', () => {
  for (const [key, label] of Object.entries({
    eq: '等于', ne: '不等于', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于', contains: '包含',
  })) {
    assert.equal(OPERATOR_LABELS[key], label);
  }
});
