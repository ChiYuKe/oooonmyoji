const test = require('node:test');
const assert = require('node:assert/strict');
const { parseParameterDefinition, validateWorkflow } = require('../dist-electron/shared/workflow/index.js');
const { compileSchema } = require('../dist-electron/shared/workflow/schema-validation.js');

test('禁用动态代码执行时仍可校验整数轮数、引用、装饰器与 Action 参数', () => {
  const original = global.Function;
  global.Function = new Proxy(original, {
    construct() { throw new EvalError('Evaluating a string as JavaScript violates CSP'); },
    apply() { throw new EvalError('Evaluating a string as JavaScript violates CSP'); },
  });
  try {
    assert.equal(parseParameterDefinition({ type: 'integer', min: 1, default: 30 }, '运行轮数').default, 30);
    assert.throws(() => parseParameterDefinition({ type: 'integer', min: 1, default: 0 }, '运行轮数'), /must be >= 1/);
    const raw = {
      schema_version: 4, id: 'csp', version: '1.0.0', resolution: [1920, 1080], root: 'root',
      inputs: { rounds: { type: 'integer', min: 1, default: 30 } }, variables: {},
      nodes: [
        { id: 'root', type: 'root', children: ['loop'] },
        { id: 'loop', type: 'sequence', children: ['log'], decorators: [{ type: 'repeat', count: { ref: 'inputs.rounds' } }] },
        { id: 'log', type: 'task', action: 'test.log', params: { message: 'ready' } },
      ],
    };
    const spec = { inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false },
      outputSchema: { type: 'object' }, parameters: {}, retrySafe: true };
    const catalog = { byName: () => spec, names: () => ['test.log'] };
    assert.deepEqual(validateWorkflow(raw, catalog), []);
    raw.nodes[2].params.message = 42;
    assert.ok(validateWorkflow(raw, catalog).some(issue => issue.severity === 'error'));
  } finally {
    global.Function = original;
  }
});

test('参数 schema 解释执行保留元组、对象必填、边界、正则和引用分支约束', () => {
  const schema = { type: 'object', required: ['roi', 'name'], additionalProperties: false, properties: {
    roi: { type: 'array', prefixItems: Array(4).fill({ type: 'integer' }), minItems: 4, maxItems: 4 },
    name: { anyOf: [{ type: 'string', pattern: '^ok$', minLength: 2 }, { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } }, additionalProperties: false }] },
  } };
  const validate = compileSchema(schema);
  assert.equal(validate({ roi: [0, 0, 1920, 1080], name: 'ok' }), true);
  assert.equal(validate({ roi: [0, 0, 1920, 1080], name: { ref: 'inputs.name' } }), true);
  for (const invalid of [{ roi: [0, 0, 1], name: 'ok' }, { roi: [0, 0, 1, 1], name: 'wrong' },
    { roi: [0, 0, 1, 1] }, { roi: [0, 0, 1, 1], name: 'ok', extra: true }]) assert.equal(validate(invalid), false);
  assert.throws(() => compileSchema({ $ref: 'unknown.json' }), /unsupported schema keyword/);
});
