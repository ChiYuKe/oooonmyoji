/* Node 冒烟测试：验证纯逻辑模块 + vscode-json-languageservice 的补全/校验管线。
 * 不依赖 VS Code 宿主，使用内嵌样例数据（hermetic）。
 * 用法：node tests/smoke.js */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { getLanguageService } = require('vscode-json-languageservice');

const { loadActionCatalog, defaultBuiltinActions, buildCatalog } = require('../out/catalog');
const {
  parseWorkflow,
  validateWorkflow,
  buildWorkflowSchema,
  collectRefSuggestions,
  TERMINALS,
} = require('../out/workflow');
const { computeLayout } = require('../out/layout');

// 内嵌样例：一个“截图→保存→等待模板→点击→日志”的线性探索流程
const FIXTURE_EXPLORE = {
  schema_version: 1,
  id: 'fixture_explore',
  version: '1.0.0',
  reference_resolution: [1920, 1080],
  entry: 'capture',
  limits: { timeout_seconds: 180, max_steps: 50 },
  inputs_schema: {
    type: 'object',
    properties: {
      launch_x: { type: 'integer', minimum: 0, default: 1204 },
      enter_y: { type: 'integer', minimum: 0, default: 895 },
      verify_timeout: { type: 'number', minimum: 0.1, default: 10 },
      hold_ms: { type: 'integer', minimum: 0, default: 50 },
    },
    additionalProperties: false,
  },
  steps: [
    { id: 'capture', action: 'core.capture', on_success: 'save' },
    { id: 'save', action: 'core.save_frame', with: { name: '01-before.png' }, on_success: 'wait' },
    {
      id: 'wait',
      action: 'vision.wait_template',
      with: {
        template: 'assets/templates/onmyoji-launcher-icon.png',
        timeout_seconds: { $ref: 'inputs.verify_timeout' },
        roi: [1080, 450, 300, 250],
        threshold: 0.7,
      },
      on_success: 'tap',
    },
    {
      id: 'tap',
      action: 'input.tap',
      when: { and: [{ exists: { $ref: 'inputs.launch_x' } }, { eq: [{ $ref: 'inputs.hold_ms' }, 50] }] },
      with: { x: { $ref: 'inputs.launch_x' }, y: { $ref: 'inputs.enter_y' }, hold_ms: { $ref: 'inputs.hold_ms' } },
      on_success: 'log',
      on_failure: '$failure',
    },
    { id: 'log', action: 'core.log', with: { message: '流程完成' }, on_success: '$success' },
  ],
};

const FIXTURE_DIAGNOSTIC = {
  schema_version: 1,
  id: 'fixture_diagnostic',
  version: '1.0.0',
  reference_resolution: [1920, 1080],
  entry: 'capture',
  inputs_schema: {
    type: 'object',
    properties: {
      template: { type: 'string', minLength: 1 },
      threshold: { type: 'number', minimum: 0, maximum: 1, default: 0.85 },
      roi: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4 },
      ocr: { type: 'boolean', default: true },
      click: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', default: false },
          revalidate: { type: 'boolean', default: true },
          hold_ms: { type: 'integer', minimum: 0, default: 0 },
        },
        additionalProperties: false,
        default: { enabled: false, revalidate: true, hold_ms: 0 },
      },
    },
    additionalProperties: false,
  },
  steps: [
    { id: 'capture', action: 'core.capture', on_success: 'find' },
    {
      id: 'find',
      action: 'vision.match_template',
      when: { exists: { $ref: 'inputs.template' } },
      with: { template: { $ref: 'inputs.template' }, roi: { $ref: 'inputs.roi' }, threshold: { $ref: 'inputs.threshold' } },
      on_success: 'click',
      on_skip: 'ocr',
    },
    {
      id: 'click',
      action: 'input.tap_match',
      when: {
        and: [
          { exists: { $ref: 'inputs.click.enabled' } },
          { eq: [{ $ref: 'inputs.click.enabled' }, true] },
          { exists: { $ref: 'steps.find.output.0' } },
        ],
      },
      with: { match: { $ref: 'steps.find.output.0' }, revalidate: { $ref: 'inputs.click.revalidate' }, hold_ms: { $ref: 'inputs.click.hold_ms' } },
      on_success: 'ocr',
      on_skip: 'ocr',
    },
    {
      id: 'ocr',
      action: 'vision.ocr',
      when: { eq: [{ $ref: 'inputs.ocr' }, true] },
      with: { roi: { $ref: 'inputs.roi' } },
      on_success: '$success',
      on_skip: '$success',
    },
  ],
};

function readFixtureOrDisk(name) {
  // 优先读真实项目文件（在用户真实机器上有效）；读不到时退回内嵌样例
  try {
    const p = path.join(path.resolve(__dirname, '..', '..'), 'workflows', name);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    // ignore
  }
  if (name === 'onmyoji_explore_verified.json') return FIXTURE_EXPLORE;
  if (name === 'diagnostic.json') return FIXTURE_DIAGNOSTIC;
  return FIXTURE_EXPLORE;
}

let passed = 0;
async function check(label, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + label);
  } catch (e) {
    console.error('  ✗ ' + label + '\n    ' + (e && e.message));
    process.exitCode = 1;
    throw e;
  }
}

async function main() {
  console.log('== 1. Action 目录 ==');
  const projectRoot = path.resolve(__dirname, '..', '..');
  const catalog = loadActionCatalog(projectRoot);
  await check('内置 Action 全部注册', () => {
    const names = catalog.names();
    for (const n of ['core.capture', 'core.save_frame', 'core.sleep', 'core.log', 'core.assert', 'vision.match_template', 'vision.ocr', 'vision.wait_template', 'input.tap', 'input.tap_match']) {
      assert(names.includes(n), 'missing ' + n);
    }
  });
  await check('plugins/actions 为空时也不报错（自定义扫描容错）', () => catalog.all().length >= 10);

  console.log('== 2. 工作流语义校验（合法样例应零错误） ==');
  for (const file of ['onmyoji_explore_verified.json', 'diagnostic.json']) {
    const raw = readFixtureOrDisk(file);
    const issues = validateWorkflow(raw, catalog);
    const errors = issues.filter((i) => i.severity === 'error');
    await check(`${file} 无错误`, () => {
      assert.deepStrictEqual(errors.map((e) => e.message), [], 'errors: ' + JSON.stringify(errors));
    });
  }

  console.log('== 3. 语义校验能发现错误 ==');
  await check('未知 Action / 未知跳转 / 重复 ID / 非法重试 / 非法 $ref / 非法条件', () => {
    const raw = {
      schema_version: 1,
      id: 'bad',
      version: '1.0.0',
      reference_resolution: [1920, 1080],
      entry: 'a',
      inputs_schema: { type: 'object', properties: { x: { type: 'integer' } }, additionalProperties: false },
      steps: [
        { id: 'a', action: 'core.capture', on_success: 'b' },
        { id: 'b', action: 'no.such.action', on_failure: 'c', when: { nope: true } },
        { id: 'c', action: 'input.tap', retry: 3, with: { x: 1, y: 2, nope: 3 } },
        { id: 'a', action: 'core.log', with: { message: { $ref: 'inputs.missing' }, fields: { $ref: 'steps.bogus.output.0' } } },
        { id: 'd', action: 'core.capture', on_failure: 'ghost', when: { exists: true } },
      ],
    };
    const issues = validateWorkflow(raw, catalog);
    const msgs = issues.map((i) => i.code + ': ' + i.message).join('\n');
    const assertCode = (code) => assert(issues.some((i) => i.code === code), '期望出现 ' + code + '\n' + msgs);
    assertCode('action.unknown');
    assertCode('step.dup');
    assertCode('retry.unsafe');
    assertCode('with.unknown');
    assertCode('ref.invalid');
    assertCode('when.operator'); // when: {nope:true} 不支持该运算符
    assertCode('ref.shape'); // when: {exists:true} 的 exists 需要 $ref 对象
    assertCode('target.unknown');
  });

  await check('不可达步骤按引擎规则报告为错误（validator.py 为 ConfigError）', () => {
    const raw = {
      schema_version: 1,
      id: 'unreach',
      version: '1.0.0',
      reference_resolution: [1920, 1080],
      entry: 'a',
      steps: [
        // orphan 在 entry 之前，且没有任何边指向它 → 真正不可达
        { id: 'orphan', action: 'core.capture', on_success: '$success' },
        { id: 'a', action: 'core.capture', on_success: '$success' },
      ],
    };
    const issues = validateWorkflow(raw, catalog);
    const unreach = issues.find((i) => i.code === 'graph.unreachable');
    assert(unreach, '应报告不可达步骤: ' + JSON.stringify(issues));
    assert.strictEqual(unreach.severity, 'error', '不可达应与引擎一致为错误级别');
  });

  await check('when 二元操作数允许嵌套结构（引擎运行时递归解析 $ref）', () => {
    const raw = {
      ...FIXTURE_EXPLORE,
      steps: [
        { id: 'capture', action: 'core.capture', when: { eq: [{ a: { $ref: 'inputs.launch_x' } }, { a: 5 }] }, on_success: '$success' },
      ],
    };
    const issues = validateWorkflow(raw, catalog);
    assert.deepStrictEqual(
      issues.filter((i) => i.severity === 'error').map((i) => i.code + ': ' + i.message),
      [],
      '不应报错: ' + JSON.stringify(issues),
    );
  });

  await check('空 schema 的 Action（core.capture）拒绝任何参数（与引擎 additionalProperties:false 一致）', () => {
    const raw = {
      ...FIXTURE_EXPLORE,
      steps: [
        { id: 'capture', action: 'core.capture', with: { nope: 1 }, on_success: '$success' },
      ],
    };
    const issues = validateWorkflow(raw, catalog);
    assert(issues.some((i) => i.code === 'with.unknown'), '应拒绝未知参数: ' + JSON.stringify(issues));
  });

  await check('when 直接 $ref 会被明确标记（引擎静态放过但运行时会炸）', () => {
    const raw = {
      ...FIXTURE_EXPLORE,
      steps: [
        { id: 'capture', action: 'core.capture', when: { $ref: 'inputs.launch_x' }, on_success: '$success' },
      ],
    };
    const issues = validateWorkflow(raw, catalog);
    assert(issues.some((i) => i.code === 'when.ref'), '应报 when.ref: ' + JSON.stringify(issues));
  });

  console.log('== 4. 动态 schema 可用于语言服务（补全 + 校验） ==');
  const info = parseWorkflow(FIXTURE_EXPLORE);
  const schema = buildWorkflowSchema(info, catalog);
  const text = JSON.stringify(FIXTURE_EXPLORE, null, 2);
  const doc = TextDocument.create('file:///workflows/explore.json', 'json', 1, text);
  const service = getLanguageService({});
  service.configure({ schemas: [{ uri: 'inmemory://onmyoji/workflow', fileMatch: ['file:///workflows/explore.json'], schema }] });

  await check('语言服务校验通过（合法样例无 schema 错误）', async () => {
    const jsonDoc = service.parseJSONDocument(doc);
    const diags = await service.doValidation(doc, jsonDoc, undefined, schema);
    const errors = diags.filter((d) => d.severity === 1);
    assert.deepStrictEqual(errors.map((e) => e.message), []);
  });

  await check('在 action 字符串处补全出 Action 名称', async () => {
    const marker = '"action": "';
    const idx = text.indexOf(marker);
    assert(idx >= 0, 'marker not found');
    const pos = doc.positionAt(idx + marker.length);
    const jsonDoc = service.parseJSONDocument(doc);
    const result = await service.doComplete(doc, pos, jsonDoc);
    const labels = (result ? result.items : []).map((i) => i.label.replace(/"/g, ''));
    assert(labels.includes('core.capture'), 'labels: ' + labels.join(','));
    assert(labels.includes('vision.wait_template'), 'labels: ' + labels.join(','));
  });

  await check('on_success 补全包含步骤 ID 与终点', async () => {
    const marker = '"on_success": "';
    const idx = text.indexOf(marker);
    const pos = doc.positionAt(idx + marker.length);
    const jsonDoc = service.parseJSONDocument(doc);
    const result = await service.doComplete(doc, pos, jsonDoc);
    const labels = (result ? result.items : []).map((i) => i.label.replace(/"/g, ''));
    assert(labels.includes('capture'), 'labels: ' + labels.join(','));
    assert(labels.includes('$success'), 'labels: ' + labels.join(','));
  });

  await check('语言服务能对非法目标/未知参数产生 schema 诊断', async () => {
    const bad = JSON.parse(JSON.stringify(FIXTURE_EXPLORE));
    bad.steps[1].on_success = 'no_such_step';
    bad.steps[2].with = { template: 'x.png', timeout_seconds: 10, weird_key: 1 };
    const badInfo = parseWorkflow(bad);
    const badSchema = buildWorkflowSchema(badInfo, catalog);
    const badText = JSON.stringify(bad, null, 2);
    const badDoc = TextDocument.create('file:///workflows/explore.json', 'json', 1, badText);
    const jsonDoc = service.parseJSONDocument(badDoc);
    const diags = await service.doValidation(badDoc, jsonDoc, undefined, badSchema);
    const msgs = diags.map((d) => (typeof d.message === 'string' ? d.message : d.message.value)).join('\n');
    assert(/not accepted|Valid values/i.test(msgs), '应报告未知跳转目标\n' + msgs);
    assert(msgs.toLowerCase().includes('weird_key'), '应报告未知参数\n' + msgs);
    // 合法的 $ref 参数不应报类型错误
    const msgsNoRef = diags
      .filter((d) => !/not accepted|weird_key/i.test(typeof d.message === 'string' ? d.message : d.message.value))
      .map((d) => (typeof d.message === 'string' ? d.message : d.message.value))
      .join('\n');
    assert(!/Incorrect type/i.test(msgsNoRef), '不应把 $ref 参数误报为类型错误\n' + msgsNoRef);
  });

  console.log('== 5. $ref 补全建议 ==');
  await check('collectRefSuggestions 覆盖 inputs 与步骤输出', () => {
    const refs = collectRefSuggestions(info, catalog);
    assert(refs.inputs.includes('inputs.launch_x'), 'inputs: ' + refs.inputs.join(','));
    assert(refs.steps.some((s) => s === 'steps.capture.output.width'), 'steps: ' + refs.steps.join(','));
    assert(refs.steps.some((s) => s === 'steps.tap.output.x'), 'steps: ' + refs.steps.join(','));
  });

  console.log('== 6. 图布局 ==');
  await check('computeLayout 输出节点/边/坐标，步骤自上而下', () => {
    const layout = computeLayout(info);
    assert(layout.nodes.length >= info.stepIds.length + TERMINALS.length);
    assert(layout.edges.length > 0);
    assert(layout.positions['capture']);
    assert(layout.positions['$success']);
    for (let i = 1; i < info.steps.length; i++) {
      assert(layout.positions[info.steps[i].id].y > layout.positions[info.steps[i - 1].id].y);
    }
    // 成功(显式)、失败(默认)、跳过(默认) 边都存在于布局语义中
    const kinds = new Set(layout.edges.map((e) => e.kind));
    assert(kinds.has('on_success'));
    assert(kinds.has('on_failure'));
    assert(kinds.has('fallthrough') || kinds.has('on_skip'));
    const defaultFailureEdges = layout.edges.filter((e) => e.kind === 'on_failure' && !e.explicit);
    assert(defaultFailureEdges.length > 0 && defaultFailureEdges.every((e) => e.visible === false), '默认失败终点边应保留语义但标记为隐藏');
    const defaultSkipEdges = layout.edges.filter((e) => e.kind === 'on_skip' && !e.explicit);
    assert(defaultSkipEdges.length > 0 && defaultSkipEdges.every((e) => e.visible === false), '默认跳过边应保留语义但标记为隐藏');
  });

  console.log('== 7. 自定义 Action 合并 ==');
  await check('自定义 Action 进入目录、参数并入 with schema、输出字段可引用', () => {
    const custom = [{
      name: 'custom.hello',
      version: '1.0.0',
      inputSchema: { type: 'object', required: ['who'], properties: { who: { type: 'string' } }, additionalProperties: false },
      outputSchema: { type: 'object', properties: { reply: { type: 'string' } } },
      retrySafe: true,
      sideEffect: false,
      source: 'tests/fake',
      description: '测试自定义 Action',
      outputFields: ['reply'],
    }];
    const cat = buildCatalog(defaultBuiltinActions(), custom);
    assert(cat.byName('custom.hello'));
    const info2 = parseWorkflow({ ...FIXTURE_EXPLORE, steps: [...FIXTURE_EXPLORE.steps, { id: 'hello', action: 'custom.hello', with: { who: 'x' } }] });
    const schema2 = buildWorkflowSchema(info2, cat);
    const withProps = schema2.properties.steps.items.properties.with.properties;
    assert(withProps && withProps.who, '自定义参数 who 应进入 with schema');
    const refs2 = collectRefSuggestions(info2, cat);
    assert(refs2.steps.includes('steps.hello.output.reply'), '自定义输出字段应可引用');
    assert(validateWorkflow(info2.raw, cat).filter((i) => i.severity === 'error').length === 0, '含自定义 Action 的工作流应无错误');
  });

  console.log('\n全部通过：' + passed + ' 项');
}

main().catch((e) => {
  console.error('\n冒烟测试失败：', e);
  process.exit(1);
});
