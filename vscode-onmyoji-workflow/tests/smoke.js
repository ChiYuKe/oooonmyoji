/* Pure Node smoke test for Action manifests and Behavior Tree v3 logic. */
'use strict';
const assert = require('assert');
const path = require('path');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { getLanguageService } = require('vscode-json-languageservice');

const {
  loadActionCatalog,
  loadBuiltinActions,
  parseManifest,
  parameterToSchema,
  applyParameterDefaults,
} = require('../out/catalog');
const { parseWorkflow, validateWorkflow, buildWorkflowSchema, collectRefSuggestions } = require('../out/workflow');
const { computeLayout } = require('../out/layout');
const { chooseRuntimeInstance, parseRuntimeInstances, pythonUtf8Environment } = require('../out/runtimeInstances');
const { buildWorkflowRunArguments } = require('../out/workflowProcess');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = {
  schema_version: 3,
  id: 'fixture_tree',
  version: '3.0.0',
  resolution: [1920, 1080],
  root: 'root',
  limits: { timeout_seconds: 180, max_steps: 100 },
  blackboard: {
    launch_x: { type: 'integer', min: 0, default: 1204 },
    enter_y: { type: 'integer', min: 0, default: 895 },
    verify_timeout: { type: 'number', min: 0.1, default: 10 },
    hold_ms: { type: 'integer', min: 0, default: 50 },
  },
  nodes: [
    { id: 'root', type: 'root', children: ['main'] },
    { id: 'main', type: 'sequence', children: ['capture', 'wait', 'choice'] },
    { id: 'capture', type: 'task', action: 'core.capture', params: {} },
    {
      id: 'wait', type: 'task', action: 'vision.wait_template',
      params: { template: 'assets/templates/start/yys_tubiao.png', timeout_seconds: { ref: 'blackboard.verify_timeout' }, roi: [1080, 450, 300, 250], threshold: 0.7 },
      decorators: [{ type: 'timeout', seconds: 20 }],
    },
    { id: 'choice', type: 'selector', children: ['tap', 'log'] },
    {
      id: 'tap', type: 'task', action: 'input.tap',
      params: { x: { ref: 'blackboard.launch_x' }, y: { ref: 'blackboard.enter_y' }, hold_ms: { ref: 'blackboard.hold_ms' } },
      decorators: [{ type: 'condition', expression: { eq: [{ ref: 'blackboard.hold_ms' }, 50] } }],
    },
    { id: 'log', type: 'task', action: 'core.log', params: { message: 'fallback' } },
  ],
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const errorsOf = (raw, catalog) => validateWorkflow(raw, catalog).filter((item) => item.severity === 'error');

async function main() {
  let passed = 0;
  const check = (name, condition) => { assert(condition, name); passed += 1; };
  const rejects = (name, fn, pattern) => {
    let thrown;
    try { fn(); } catch (error) { thrown = error; }
    check(name, thrown instanceof Error && pattern.test(thrown.message));
  };

  const runtimeInstances = parseRuntimeInstances({ instances: [
    { id: 'mumu-0', backend: 'mumu', mumu_index: 0, adb_serial: '127.0.0.1:16384', display_name: 'primary' },
    { id: 'mumu-1', backend: 'adb', adb_serial: '127.0.0.1:16416' },
    { id: 'mumu-1', backend: 'adb' },
    { id: 'disabled', backend: 'mumu', enabled: false },
    { id: '  ' },
  ] });
  check('运行配置提取并去重实例', runtimeInstances.length === 2 && runtimeInstances[1].adbSerial === '127.0.0.1:16416');
  check('MuMu 发现元数据可供实例选择器显示', runtimeInstances[0].mumuIndex === 0 && runtimeInstances[0].displayName === 'primary');
  const pythonEnvironment = pythonUtf8Environment({ KEEP: 'yes', PYTHONIOENCODING: 'gbk' });
  check('Python 实例发现输出固定为 UTF-8', pythonEnvironment.KEEP === 'yes' && pythonEnvironment.PYTHONIOENCODING === 'utf-8' && pythonEnvironment.PYTHONUTF8 === '1');
  check('显式实例选择优先于工作区记忆', chooseRuntimeInstance(runtimeInstances, 'mumu-1', 'mumu-0') === 'mumu-1');
  check('无效实例回退到工作区记忆', chooseRuntimeInstance(runtimeInstances, 'missing', 'mumu-0') === 'mumu-0');
  const runArgs = buildWorkflowRunArguments('配置/运行.json', 'mumu_1_souls_loop.json', 'mumu-1', '产物/events latest.jsonl');
  check('工作流运行参数不经过 shell 拼接', JSON.stringify(runArgs) === JSON.stringify([
    '-m', 'src.oooonmyoji.cli', '--config', '配置/运行.json', 'run-workflow', 'mumu_1_souls_loop.json',
    '--instance', 'mumu-1', '--events-file', '产物/events latest.jsonl',
  ]));

  const builtin = loadBuiltinActions(PROJECT_ROOT);
  check('内置 manifest 无错误', builtin.errors.length === 0);
  check('内置 Action 数量为 14', builtin.actions.length === 14);
  const match = builtin.actions.find((action) => action.name === 'vision.match_template');
  check('Action 参数默认值来自 manifest', match && match.parameters.threshold.default === 0.85);
  check('模板匹配 Action 暴露完整参数', match
    && match.parameters.template.type === 'asset'
    && JSON.stringify(Object.keys(match.parameters)) === JSON.stringify(['template', 'roi', 'threshold', 'max_results', 'scale_search']));
  check('重试安全元数据可用', match && match.retrySafe === true);
  const tap = builtin.actions.find((action) => action.name === 'input.tap');
  check('副作用 Action 不可安全重试', tap && !tap.retrySafe && tap.sideEffect);
  check('rect 参数编译为四元组', parameterToSchema({ type: 'rect' }).minItems === 4);

  const nested = parseManifest({
    schema_version: 2, name: 'custom.nested', entry: 'action.py:Nested',
    parameters: {
      options: { type: 'object', default: {}, properties: { enabled: { type: 'boolean', required: true, default: true }, items: { type: 'array', default: [{}], items: { type: 'object', properties: { count: { type: 'integer', required: true, default: 2 } } } } } },
      nullable: { type: 'any', default: null },
    },
    outputs: { type: 'object' },
  });
  check('嵌套默认值递归应用', JSON.stringify(applyParameterDefaults(nested.parameters, {})) === JSON.stringify({ options: { enabled: true, items: [{ count: 2 }] }, nullable: null }));
  const invalidManifest = { schema_version: 2, name: 'custom.bad', entry: 'action.py:Bad', parameters: {} };
  rejects('manifest 拒绝旧版本', () => parseManifest({ ...invalidManifest, schema_version: 1 }), /invalid Action manifest/);
  rejects('manifest 拒绝倒置范围', () => parseManifest({ ...invalidManifest, parameters: { count: { type: 'integer', min: 2, max: 1 } } }), /min must be <= max/);

  const catalog = loadActionCatalog(PROJECT_ROOT);
  check('目录按名查找', !!catalog.byName('core.capture'));
  check('目录无重名', catalog.clashes().length === 0);

  const info = parseWorkflow(FIXTURE);
  check('解析 7 个树节点', info.nodes.length === 7);
  check('解析 Root', info.root === 'root' && info.nodes[0].type === 'root');
  check('解析有序 children', JSON.stringify(info.nodes.find((node) => node.id === 'main').children) === JSON.stringify(['capture', 'wait', 'choice']));
  check('解析黑板键', info.blackboardProps.includes('verify_timeout'));
  check('解析装饰器', info.nodes.find((node) => node.id === 'wait').decorators[0].type === 'timeout');
  check('合法 Behavior Tree 无错误', errorsOf(FIXTURE, catalog).length === 0);

  const duplicate = clone(FIXTURE); duplicate.nodes.push(clone(duplicate.nodes[2]));
  check('拒绝重复节点', errorsOf(duplicate, catalog).some((item) => item.code === 'duplicate-node'));
  const unknownAction = clone(FIXTURE); unknownAction.nodes.find((node) => node.id === 'capture').action = 'missing.action';
  check('拒绝未知 Action', errorsOf(unknownAction, catalog).some((item) => item.code === 'unknown-action'));
  const unknownChild = clone(FIXTURE); unknownChild.nodes.find((node) => node.id === 'main').children[0] = 'missing';
  check('拒绝未知 child', errorsOf(unknownChild, catalog).some((item) => item.code === 'unknown-child'));
  const orphan = clone(FIXTURE); orphan.nodes.find((node) => node.id === 'main').children = ['capture', 'wait'];
  check('拒绝孤立节点', errorsOf(orphan, catalog).some((item) => item.code === 'parent-count'));
  const badRef = clone(FIXTURE); badRef.nodes.find((node) => node.id === 'tap').params.x = { ref: 'inputs.launch_x' };
  check('拒绝旧引用命名空间', errorsOf(badRef, catalog).some((item) => item.code === 'invalid-ref'));
  const wrongType = clone(FIXTURE); wrongType.blackboard.name = { type: 'string' }; wrongType.nodes.find((node) => node.id === 'tap').params.x = { ref: 'blackboard.name' };
  check('拒绝绑定类型不兼容', errorsOf(wrongType, catalog).some((item) => item.code === 'binding-type'));
  const unsafeRetry = clone(FIXTURE); unsafeRetry.nodes.find((node) => node.id === 'tap').decorators.push({ type: 'retry', attempts: 3 });
  check('拒绝副作用 Action 重试', errorsOf(unsafeRetry, catalog).some((item) => item.code === 'unsafe-retry'));
  const parallel = clone(FIXTURE); parallel.nodes.find((node) => node.id === 'choice').type = 'simple_parallel'; parallel.nodes.find((node) => node.id === 'choice').children[0] = 'main';
  check('拒绝 Parallel 非 Task 主分支', errorsOf(parallel, catalog).some((item) => item.code === 'parallel-main-task'));
  check('拒绝 schema v2', errorsOf({ ...FIXTURE, schema_version: 2 }, catalog).some((item) => item.code === 'schema-version'));

  const schema = buildWorkflowSchema(info, catalog);
  check('Schema 固定 v3', schema.properties.schema_version.const === 3);
  check('Schema children 使用节点枚举', schema.properties.nodes.items.properties.children.items.enum.includes('tap'));
  const refs = collectRefSuggestions(info, catalog);
  check('黑板引用补全', refs.blackboard.includes('blackboard.verify_timeout'));
  check('节点输出引用补全', refs.nodes.includes('nodes.capture.output.width'));

  const layout = computeLayout(info);
  check('布局包含 6 条父子边', layout.edges.length === 6);
  check('父节点位于子节点上方', layout.positions.root.y < layout.positions.main.y && layout.positions.main.y < layout.positions.capture.y);
  check('兄弟节点横向展开', layout.positions.capture.x !== layout.positions.wait.x);

  const text = JSON.stringify(FIXTURE, null, 2);
  const document = TextDocument.create('file:///workflow.json', 'json', 1, text);
  const service = getLanguageService({ schemaRequestService: async () => JSON.stringify(schema) });
  service.configure({ schemas: [{ uri: 'inmemory://workflow-v3', fileMatch: ['*'], schema }] });
  const jsonDocument = service.parseJSONDocument(document);
  const diagnostics = await service.doValidation(document, jsonDocument);
  check('JSON language service 接受 v3 样例', diagnostics.length === 0);

  console.log(`SMOKE OK (${passed} checks)`);
}

main().catch((error) => { console.error('冒烟测试失败：', error); process.exit(1); });
