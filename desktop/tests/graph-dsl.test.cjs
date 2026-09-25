// 运行方式：先 `node ./node_modules/typescript/bin/tsc -p tsconfig.electron.json`，再 `node --test tests/graph-dsl.test.cjs`。
// v6 工作流文本格式（.owf）：与 tests/test_workflow_dsl.py 一一对应的验收用例。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DOCUMENT_SCHEMA_VERSION,
  DslError,
  GRAPH_SCHEMA_VERSION,
  SourceLine,
  WORKFLOW_SUFFIX,
  emitDocument,
  emitRuntimeDocument,
  normalizeDocument,
  parseDocument,
  parseExpression,
  readDocumentId,
  renderExpression,
} = require('../dist-electron/shared/workflow/index.js');

const ROOT = path.join(__dirname, '..', '..');
const KITCHEN = path.join(ROOT, 'tests', 'fixtures', 'dsl', 'kitchen.owf');
const GRAPH_RULES = path.join(ROOT, 'tests', 'fixtures', 'graph-rules', 'cases.json');
const WORKFLOW_FILES = ['活动副本.owf', '结界突破_寮突.owf'];

const CASES = JSON.parse(fs.readFileSync(GRAPH_RULES, 'utf8')).cases;

// Python 的 `Path.read_text()` 默认走 universal newlines（CRLF → LF），
// 磁盘上的 .owf 是 CRLF，所以比较「逐字一致」前要先做同样的一次翻译。
const readText = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
const KITCHEN_TEXT = readText(KITCHEN);
const readWorkflow = (name) => readText(path.join(ROOT, 'workflows', name));

// --------------------------------------------------------------------------------------
// 常量与头行
// --------------------------------------------------------------------------------------

test('常量与图文档版本一致', () => {
  assert.equal(WORKFLOW_SUFFIX, '.owf');
  assert.equal(DOCUMENT_SCHEMA_VERSION, 6);
  assert.equal(GRAPH_SCHEMA_VERSION, 6);
  assert.equal(DOCUMENT_SCHEMA_VERSION, GRAPH_SCHEMA_VERSION);
});

test('readDocumentId 只读头行', () => {
  assert.equal(readDocumentId('# 注释\nworkflow activity_loop\n  version: 4.4.0\n'), 'activity_loop');
  assert.equal(readDocumentId('version: 1.0.0\n'), null);
  assert.equal(readDocumentId('workflow a b\n'), null);
  assert.equal(readDocumentId(''), null);
  assert.equal(readDocumentId('workflow "带 空格"\n'), '带 空格');
  assert.equal(readDocumentId('workflow bad:name\n'), null);
});

// --------------------------------------------------------------------------------------
// 真实文档往返
// --------------------------------------------------------------------------------------

for (const name of WORKFLOW_FILES) {
  test(`真实工作流是规范形式：${name}`, () => {
    const text = readWorkflow(name);
    const document = parseDocument(text, name);
    assert.equal(document.schema_version, 6);
    assert.equal(emitDocument(document), text, '仓库里的 .owf 必须已经是规范形式');
    assert.equal(readDocumentId(text), document.id);
  });
}

// --------------------------------------------------------------------------------------
// 全特性夹具
// --------------------------------------------------------------------------------------

test('kitchen 夹具是不动点', () => {
  const document = parseDocument(KITCHEN_TEXT, 'kitchen.owf');
  assert.equal(emitDocument(document), KITCHEN_TEXT);
  assert.equal(document.schema_version, 6);
  assert.equal(document.description, '多行说明：\n第二行');
  assert.deepEqual(document.limits, { timeout_seconds: 600, max_steps: 500 });
  assert.deepEqual(document._inputParams, {});
});

test('kitchen 夹具的关键结构', () => {
  const document = parseDocument(KITCHEN_TEXT);
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));

  // 变量节点的 id 由作用域与键派生，文本里不写 id
  assert.equal(nodes.get('var__inputs__运行轮数').scope, 'inputs');
  assert.equal(nodes.get('var__inputs__运行轮数').name, '运行轮数');
  assert.deepEqual(nodes.get('var__inputs__运行轮数').at, { x: -200, y: 100 });

  // 位置 / 尺寸：行内 [x, y] ⇄ {"x": …, "y": …}
  assert.deepEqual(nodes.get('root').at, { x: 0, y: 0 });
  assert.deepEqual(document.comments[0].size, { w: 420, h: 260 });
  assert.deepEqual(document.groups[0].variablesAt, { x: -448, y: 376 });

  // 装饰器、cases、runs 与载荷字段名保持运行时原样
  assert.deepEqual(nodes.get('rounds').decorators, [{ type: 'repeat', count: 3 }]);
  assert.deepEqual(nodes.get('pick').cases, [{ value: 'settlement' }, { value: 2 }]);
  assert.deepEqual(nodes.get('fleet').runs, [
    { instance: 'mumu-0', workflow: 'demo', inputs: { 运行轮数: 2 } },
  ]);
  assert.deepEqual(nodes.get('fleet').fields, { state: '状态' });
  assert.equal(nodes.get('fleet').wait_for, 'any');
  assert.equal(nodes.get('fleet').finish_mode, 'wait_for_background');
  assert.equal(nodes.get('fleet').cancel_on_failure, false);

  // 中缀表达式落到运行时的操作数对象上
  assert.deepEqual(nodes.get('judge').expression, { eq: [null, 'settlement'] });
  assert.deepEqual(nodes.get('pick').expression, { ref: 'nodes.judge.output.value' });
  assert.deepEqual(nodes.get('branch_1').conditions, [
    {
      and: [
        { eq: [{ ref: 'nodes.judge.output.value' }, true] },
        { not: { exists: { ref: 'inputs.运行轮数' } } },
      ],
    },
  ]);

  // 连线：默认口位省略
  const edges = new Map(document.edges.map((edge) => [`${edge.from.node}:${edge.from.pin}`, edge]));
  assert.deepEqual(edges.get('root:then.0').to, { node: 'rounds', pin: 'in' });
  assert.deepEqual(edges.get('judge:out.value').waypoints, [
    { x: 100, y: 80 },
    { x: 120, y: 180 },
  ]);
  assert.deepEqual(edges.get('pick:default').to, { node: 'fleet', pin: 'in' });
  assert.deepEqual(edges.get('var__inputs__运行轮数:out').to, {
    node: 'rounds',
    pin: 'decorators.0.count',
  });
});

test('边表按 edges 数组顺序逐行转写', () => {
  const document = parseDocument(KITCHEN_TEXT);
  const text = emitDocument(document);
  const table = text.split('  edges:\n')[1].split('  group ')[0];
  const lines = table
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('waypoints:'));
  assert.deepEqual(lines.slice(0, 4), [
    'root -> rounds',
    'rounds -> branch_1',
    'rounds:then.1 -> pick',
    'rounds:then.2 -> judge',
  ]);
  assert.deepEqual(lines.slice(-2), [
    'var__inputs__运行轮数:out -> rounds:decorators.0.count',
    'judge:out.value -> branch_1:conditions.0',
  ]);
  assert.ok(table.includes('waypoints: [[100, 80], [120, 180]]'));
  assert.deepEqual(
    document.edges.slice(0, 2).map((edge) => edge.from.node),
    ['root', 'rounds'],
  );
});

// --------------------------------------------------------------------------------------
// graph-rules 契约用例
// --------------------------------------------------------------------------------------

const unwritable = [];

for (const item of CASES) {
  test(`共享图样例：${item.name}`, () => {
    let text = null;
    try {
      text = emitDocument(item.graph);
    } catch (error) {
      if (!(error instanceof DslError)) throw error;
      // 写不出来只允许发生在本来就判定为非法的文档上（缺 scope/name 的变量节点、悬空边……）。
      assert.ok(!item.valid, `合法文档必须能写盘：${error.message}`);
      unwritable.push(item.name);
      return;
    }
    const parsed = parseDocument(text, `${item.name}.owf`);
    assert.deepStrictEqual(parsed, normalizeDocument(item.graph));
    assert.equal(emitDocument(parsed), text, 'emit 产出的文本必须是不动点');
  });
}

test('只有 3 个非法用例写不出来', () => {
  assert.equal(CASES.length, 40);
  assert.deepStrictEqual(
    [...unwritable].sort(),
    ['变量节点必须有作用域', '变量节点必须有键名', '边指向不存在的节点'].sort(),
  );
});

// --------------------------------------------------------------------------------------
// 表达式
// --------------------------------------------------------------------------------------

const EXPRESSION_CASES = [
  ['a == b', { eq: ['a', 'b'] }],
  ['a != 1', { ne: ['a', 1] }],
  ['a > 1.5', { gt: ['a', 1.5] }],
  ['a >= true', { gte: ['a', true] }],
  ['a < null', { lt: ['a', null] }],
  ['a <= b', { lte: ['a', 'b'] }],
  ['a contains b', { contains: ['a', 'b'] }],
  ['exists nodes.a.output.b', { exists: { ref: 'nodes.a.output.b' } }],
  ['not a', { not: 'a' }],
  ['not not a', { not: { not: 'a' } }],
  ['a and b and c', { and: ['a', 'b', 'c'] }],
  ['a or b', { or: ['a', 'b'] }],
  ['a and b or c', { or: [{ and: ['a', 'b'] }, 'c'] }],
  ['a or b and c', { or: ['a', { and: ['b', 'c'] }] }],
  ['(a or b) and c', { and: [{ or: ['a', 'b'] }, 'c'] }],
  ['not (a and b)', { not: { and: ['a', 'b'] } }],
  ['nodes.a.output.x == inputs.运行轮数', { eq: [{ ref: 'nodes.a.output.x' }, { ref: 'inputs.运行轮数' }] }],
  ['true', true],
  ['nodes.a.output.value', { ref: 'nodes.a.output.value' }],
  ['"and" == x', { eq: ['and', 'x'] }],
];

for (const [text, expected] of EXPRESSION_CASES) {
  test(`中缀解析：${text}`, () => {
    assert.deepStrictEqual(parseExpression(text), expected);
  });
}

const RENDER_CASES = [
  [{ eq: [null, 'settlement'] }, 'null == settlement'],
  [
    { and: [{ eq: [{ ref: 'nodes.a.output.x' }, 1] }, { not: { exists: { ref: 'inputs.运行轮数' } } }] },
    'nodes.a.output.x == 1 and not exists inputs.运行轮数',
  ],
  [{ or: [{ and: ['a', 'b'] }, 'c'] }, 'a and b or c'],
  [{ and: [{ or: ['a', 'b'] }, 'c'] }, '(a or b) and c'],
  [{ contains: [{ ref: 'nodes.a.output.list' }, 'x'] }, 'nodes.a.output.list contains x'],
  [true, 'true'],
  [{ ref: 'nodes.a.output.value' }, 'nodes.a.output.value'],
  [{ and: ['a'] }, null],
  [{ wat: [1, 2] }, null],
  [{ eq: [1, 2, 3] }, null],
];

for (const [node, expected] of RENDER_CASES) {
  test(`中缀渲染：${JSON.stringify(node)}`, () => {
    assert.equal(renderExpression(node), expected);
  });
}

test('表达式渲染回解析是同一棵树', () => {
  const nodes = [
    { eq: [{ ref: 'nodes.a.output.x' }, 'y'] },
    { and: [true, { or: ['a', { not: { exists: { ref: 'inputs.k' } } }] }] },
    { contains: [{ ref: 'variables.v' }, 3] },
    { not: { and: ['a', 'b'] } },
  ];
  for (const node of nodes) {
    const text = renderExpression(node);
    assert.ok(text !== null);
    assert.deepStrictEqual(parseExpression(text), node);
  }
});

const EXPRESSION_ERRORS = [
  ['a < b < c', '链式比较'],
  ['exists a + b', '引用'],
  ['a = b', '=='],
  ['a ==', '没有写完'],
  ['a b', '多余的内容'],
  ['(a and b', '括号'],
  ['a and', '没有写完'],
];

for (const [text, fragment] of EXPRESSION_ERRORS) {
  test(`表达式报错：${text}`, () => {
    assert.throws(
      () => parseExpression(text, new SourceLine('case.owf', 7, text)),
      (error) => {
        assert.ok(error instanceof DslError);
        assert.ok(error.message.includes(fragment), error.message);
        assert.equal(error.line, 7);
        assert.ok(error.render().includes('case.owf:7:'));
        return true;
      },
    );
  });
}

test('中缀表达不了的形状走子块逃生舱', () => {
  const document = parseDocument(
    'workflow demo\n' +
      '  version: 1.0.0\n' +
      '  resolution: [1920, 1080]\n' +
      '  root: root\n' +
      '  node root root\n' +
      '  node judge bool_judge\n' +
      '    expression:\n' +
      '      wat:\n' +
      '        - 1\n' +
      '        - two\n' +
      '  edges:\n' +
      '    root -> judge\n',
  );
  const node = document.nodes.find((item) => item.id === 'judge');
  assert.deepStrictEqual(node.expression, { wat: [1, 'two'] });
  assert.ok(emitDocument(document).includes('wat:'));
});

// --------------------------------------------------------------------------------------
// 词法与结构
// --------------------------------------------------------------------------------------

const minimalDocument = () => ({
  schema_version: 6,
  id: 'demo',
  version: '1.0.0',
  description: 'demo',
  resolution: [1920, 1080],
  root: 'root',
  inputs: {},
  variables: {},
  nodes: [
    { id: 'root', type: 'root', at: { x: 0, y: 0 } },
    {
      id: 'tap_1',
      type: 'task',
      name: 'tap',
      at: { x: 0, y: 200 },
      action: 'input.tap',
      params: { x: 10, y: 20, random_interval: [0.2, 0.5], note: '3 seconds' },
      decorators: [],
    },
  ],
  edges: [{ from: { node: 'root', pin: 'then.0' }, to: { node: 'tap_1', pin: 'in' } }],
});

const MINIMAL_TEXT =
  'workflow demo\n' +
  '  version: 1.0.0\n' +
  '  description: demo\n' +
  '  resolution: [1920, 1080]\n' +
  '  root: root\n' +
  '  inputs: {}\n' +
  '  variables: {}\n' +
  '  node root root\n' +
  '    at: [0, 0]\n' +
  '  node tap_1 task tap\n' +
  '    at: [0, 200]\n' +
  '    action: input.tap\n' +
  '    params:\n' +
  '      x: 10\n' +
  '      y: 20\n' +
  '      random_interval: [0.2, 0.5]\n' +
  '      note: "3 seconds"\n' +
  '    decorators: []\n' +
  '  edges:\n' +
  '    root -> tap_1\n';

test('规范文本逐字一致', () => {
  assert.equal(emitDocument(minimalDocument()), MINIMAL_TEXT);
  assert.deepStrictEqual(parseDocument(MINIMAL_TEXT), normalizeDocument(minimalDocument()));
});

test('注释、空行与缩进', () => {
  const text =
    '# 文件头注释\n' +
    'workflow demo\n' +
    '  version: 1.0.0   # 行尾注释\n' +
    '\n' +
    '  resolution: [1920, 1080]\n' +
    '  root: root\n' +
    '  node root root\n' +
    '    # 节点里的注释\n' +
    '    at: [0, 0]\n' +
    '  edges:\n' +
    '    root -> tap_1\n';
  const document = parseDocument(text);
  assert.equal(document.version, '1.0.0');
  assert.deepStrictEqual(document.resolution, [1920, 1080]);
  assert.equal(document.edges[0].to.node, 'tap_1');
});

test('连线写在节点块里要指到顶层 edges 块', () => {
  assert.throws(
    () =>
      parseDocument(
        'workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  node root root\n    -> tap_1\n',
      ),
    (error) => {
      assert.ok(error instanceof DslError);
      assert.ok(error.message.includes('顶层 edges 块'), error.message);
      assert.equal(error.line, 6);
      return true;
    },
  );
});

const PARSE_ERRORS = [
  ['version: 1.0.0\n', '第一行必须写成 workflow', 1],
  ['workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n', '缺少 root', null],
  ['workflow demo\n  version: 1.0.0\n  root: root\n', '缺少 resolution', null],
  ['workflow demo\n  resolution: [1920, 1080]\n  root: root\n', '缺少 version', null],
  [
    'workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  node a task\n      at: [0, 0]\n',
    '缩进跳级',
    6,
  ],
  ['workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  version: 2.0.0\n', '顶层键重复', 5],
  ['workflow demo\n  version 1.0.0\n', '缺少 :', 2],
  ['workflow demo\n\tversion: 1.0.0\n', 'Tab', 2],
  [
    'workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  node a task\n    x: 1\n    x: 2\n',
    '键重复',
    7,
  ],
];

for (const [text, fragment, line] of PARSE_ERRORS) {
  test(`解析报错带行号：${fragment}`, () => {
    assert.throws(
      () => parseDocument(text, 'demo.owf'),
      (error) => {
        assert.ok(error instanceof DslError);
        assert.ok(error.message.includes(fragment), error.message);
        if (line !== null) assert.equal(error.line, line);
        assert.ok(error.render().includes('demo.owf'));
        return true;
      },
    );
  });
}

test('| 多行文本块', () => {
  const document = parseDocument(
    'workflow demo\n' +
      '  version: 1.0.0\n' +
      '  resolution: [1920, 1080]\n' +
      '  root: root\n' +
      '  description: |\n' +
      '    第一行\n' +
      '      缩进保留\n' +
      '    第三行\n',
  );
  assert.equal(document.description, '第一行\n  缩进保留\n第三行');
  assert.equal(parseDocument(emitDocument(document)).description, document.description);
});

test('看起来像别的值的字符串必须加引号', () => {
  const document = parseDocument(
    'workflow demo\n' +
      '  version: 1.0.0\n' +
      '  resolution: [1920, 1080]\n' +
      '  root: root\n' +
      '  variables:\n' +
      '    "inputs.假的":\n' +
      '      type: string\n' +
      '      default: "inputs.真引用会被解析成引用，所以这里必须加引号"\n' +
      '      display_name: "3"\n',
  );
  const variable = document.variables['inputs.假的'];
  assert.equal(variable.default, 'inputs.真引用会被解析成引用，所以这里必须加引号');
  assert.equal(variable.display_name, '3');
  assert.equal(emitDocument(document).split('"3"').length - 1, 1);
  assert.deepStrictEqual(parseDocument(emitDocument(document)), normalizeDocument(document));
});

test('emit 拒绝写不出来的形状', () => {
  const editForm = {
    schema_version: 4,
    id: 'demo',
    version: '1.0.0',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', children: ['a'] },
      { id: 'a', type: 'sequence' },
    ],
  };
  assert.throws(() => emitDocument(editForm), (error) => {
    assert.ok(error instanceof DslError);
    assert.ok(error.message.includes('编辑形态'), error.message);
    return true;
  });

  const badVariable = minimalDocument();
  badVariable.nodes.push({ id: 'var__inputs__别的', type: 'variable', scope: 'inputs', name: '模板' });
  assert.throws(() => emitDocument(badVariable), (error) => {
    assert.ok(error instanceof DslError);
    assert.ok(error.message.includes('派生 id'), error.message);
    return true;
  });

  const dangling = minimalDocument();
  dangling.edges.push({ from: { node: 'tap_1', pin: 'out' }, to: { node: 'ghost', pin: 'in' } });
  assert.throws(() => emitDocument(dangling), (error) => {
    assert.ok(error instanceof DslError);
    assert.ok(error.message.includes('不存在的节点'), error.message);
    return true;
  });

  assert.throws(() => emitDocument({ schema_version: 5 }), (error) => {
    assert.ok(error instanceof DslError);
    assert.ok(error.message.includes('nodes'), error.message);
    return true;
  });
});

test('then 别名收敛成 then.0', () => {
  const document = minimalDocument();
  document.edges[0].from.pin = 'then';
  const normalized = normalizeDocument(document);
  assert.equal(normalized.edges[0].from.pin, 'then.0');
  assert.equal(parseDocument(emitDocument(document)).edges[0].from.pin, 'then.0');
});

test('空值按 Python 的真值语义处理', () => {
  // `[]` / `{}` 在 JS 里是真的、在 Python 里是假的：写盘行为必须跟 Python 一致
  // （空的 inputs 写成 `inputs: {}`，空的 waypoints 一行都不写）。
  const document = minimalDocument();
  document.inputs = [];
  document.edges[0].waypoints = [];
  const text = emitDocument(document);
  assert.ok(text.includes('  inputs: {}\n'), text);
  assert.ok(!text.includes('waypoints'), text);
  assert.deepStrictEqual(parseDocument(text).edges, [
    { from: { node: 'root', pin: 'then.0' }, to: { node: 'tap_1', pin: 'in' } },
  ]);
});

test('emitRuntimeDocument 把 v4 编辑形态升级后写盘', () => {
  const canvas = {
    schema_version: 4,
    id: 'demo',
    version: '1.0.0',
    description: 'demo',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', children: ['tap_1'] },
      { id: 'tap_1', type: 'task', name: 'tap', action: 'input.tap', params: { x: 10 } },
    ],
    _layout: { root: { x: 0, y: 0 }, tap_1: { x: 0, y: 200 } },
  };
  const text = emitRuntimeDocument(canvas);
  assert.ok(text.includes('node tap_1 task tap'), text);
  assert.ok(text.includes('root -> tap_1'), text);
  assert.deepStrictEqual(parseDocument(text).edges, [
    { from: { node: 'root', pin: 'then.0' }, to: { node: 'tap_1', pin: 'in' } },
  ]);
  // 图文档直接写盘，不再过一遍转换
  assert.equal(emitRuntimeDocument(parseDocument(text)), text);
});

// --------------------------------------------------------------------------------------
// 回归：与 Python 实现对齐时发现的缺陷（两端口径必须一致）
// --------------------------------------------------------------------------------------

function regressionDocument() {
  return {
    schema_version: GRAPH_SCHEMA_VERSION,
    id: 'demo',
    version: '1.0.0',
    description: 'demo',
    resolution: [1920, 1080],
    root: 'root',
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', at: { x: 0, y: 0 } },
      { id: 'tap_1', type: 'task', name: 'tap', at: { x: 0, y: 200 }, action: 'input.tap', params: {}, decorators: [] },
    ],
    edges: [{ from: { node: 'root', pin: 'then.0' }, to: { node: 'tap_1', pin: 'in' } }],
  };
}

test('极端浮点原样往返：1e-20 不能被写成 0.0', () => {
  const document = regressionDocument();
  document.nodes[1].params = { tiny: 1e-20, micro: 1.2345678901234567e-5, huge: 1e20, plain: 0.5 };
  const text = emitDocument(document);
  // 极小值必须写成指数形式（早先会被展开成 0.0，那是静默丢数据）。
  assert.ok(text.includes('tiny: 1e-20'), text);
  const params = parseDocument(text).nodes[1].params;
  assert.equal(params.tiny, 1e-20);
  assert.equal(params.micro, 1.2345678901234567e-5);
  assert.equal(params.huge, 1e20);
  assert.equal(params.plain, 0.5);
  // 注意：JS 只有一种 number，`1e20` 这类**整数值浮点**会写成整数字面量（Python 写 `1e+20`）——
  // 两端的数值往返都精确，但文本形式可能不同，见规范里的「平台差异」。
});

test('条件列表缺少右括号要报错，不能静默丢字符', () => {
  assert.throws(
    () => parseDocument('workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  node branch_1 branch\n    conditions: [a == 1, b == 2\n'),
    (error) => error instanceof DslError && error.message.includes('缺少右括号'),
  );
});

test('顶层键重复与 schema_version 都要报错', () => {
  assert.throws(
    () => parseDocument('workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  inputs:\n    a:\n      type: integer\n  inputs:\n    b:\n      type: integer\n'),
    (error) => error instanceof DslError && error.message.includes('顶层键重复'),
  );
  assert.throws(
    () => parseDocument('workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  schema_version: 6\n'),
    (error) => error instanceof DslError && error.message.includes('schema_version'),
  );
});

test('节点 id 含冒号时写出去要能读回来', () => {
  const document = regressionDocument();
  document.nodes[1].id = 'tap:1';
  document.edges[0].to.node = 'tap:1';
  const text = emitDocument(document);
  assert.ok(text.includes('node "tap:1" task'), text);
  const parsed = parseDocument(text);
  assert.equal(parsed.nodes[1].id, 'tap:1');
  assert.equal(parsed.edges[0].to.node, 'tap:1');
  assert.deepStrictEqual(parsed, normalizeDocument(document));
});

test('缺头字段的文档写盘要报错（写出去是解析不回来的文本）', () => {
  const missing = { schema_version: 4, id: 'x', inputs: {}, variables: {}, nodes: [{ id: 'root', type: 'root' }] };
  assert.throws(
    () => emitRuntimeDocument(missing),
    (error) => error instanceof DslError && error.message.includes('version'),
  );
});

test('inputs 非对象时规范化与 emit 口径一致', () => {
  const document = regressionDocument();
  document.inputs = [];
  document.variables = null;
  const normalized = normalizeDocument(document);
  assert.deepStrictEqual(normalized.inputs, {});
  assert.deepStrictEqual(normalized.variables, {});
  assert.deepStrictEqual(parseDocument(emitDocument(document)), normalized);
});
