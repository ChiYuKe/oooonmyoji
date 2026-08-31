/* Pure Node smoke test for Action manifests and Behavior Tree v3 logic. */
'use strict';
const assert = require('assert');
const fs = require('fs');
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
const { parseWorkflow, validateWorkflow, buildWorkflowSchema, collectRefSuggestions, matchWorkflowReference, collectWorkflowRunReferences, resolveWorkflowReference, buildTreeNode } = require('../out/workflow');
const { computeLayout } = require('../out/layout');
const { chooseRuntimeInstance, parseRuntimeInstances, pythonUtf8Environment } = require('../out/runtimeInstances');
const { buildPartySoulsRunArguments, buildWorkflowRunArguments, missingWorkflowInstances } = require('../out/workflowProcess');
const extensionManifest = require('../package.json');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = {
  schema_version: 3,
  id: 'fixture_tree',
  version: '3.0.0',
  description: '用于扩展冒烟测试的工作流',
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

  const activityContainers = extensionManifest.contributes.viewsContainers.activitybar;
  const onmyojiViews = extensionManifest.contributes.views.onmyoji;
  check('活动栏注册 Onmyoji 插件入口', activityContainers.some((item) => item.id === 'onmyoji' && item.icon === 'media/onmyoji-activity.svg'));
  check('活动栏入口包含自动化控制 Webview', onmyojiViews.some((item) => item.id === 'onmyoji.controlPanel' && item.type === 'webview'));

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
  check('多实例运行前准确找出未启动实例', JSON.stringify(missingWorkflowInstances(
    [{ instance: 'mumu-0' }, { instance: 'mumu-1' }, { instance: 'mumu-2' }],
    [{ id: 'mumu-0' }, { id: 'mumu-1' }],
  )) === JSON.stringify(['mumu-2']));
  const partyArgs = buildPartySoulsRunArguments('配置/运行.json', 'mumu-0', 'mumu-1', 9999, '日志/队长.jsonl', '日志/队员.jsonl');
  check('组队御魂参数直接启动双实例协调入口', JSON.stringify(partyArgs) === JSON.stringify([
    '-m', 'src.oooonmyoji.cli', '--config', '配置/运行.json', 'run-party-souls',
    '--leader-instance', 'mumu-0', '--member-instance', 'mumu-1', '--rounds', '9999',
    '--leader-events-file', '日志/队长.jsonl', '--member-events-file', '日志/队员.jsonl',
  ]));

  const builtin = loadBuiltinActions(PROJECT_ROOT);
  check('内置 manifest 无错误', builtin.errors.length === 0);
  check('内置 Action 数量为 15', builtin.actions.length === 15);
  const match = builtin.actions.find((action) => action.name === 'vision.match_template');
  check('Action 参数默认值来自 manifest', match && match.parameters.threshold.default === 0.85);
  check('模板匹配 Action 暴露完整参数', match
    && match.parameters.template.type === 'asset'
    && JSON.stringify(Object.keys(match.parameters)) === JSON.stringify(['template', 'roi', 'threshold', 'max_results', 'scale_search']));
  check('模板匹配输出声明匹配对象结构', match
    && match.outputSchema.type === 'array'
    && match.outputSchema.items.type === 'object'
    && match.outputSchema.items.properties.reference.type === 'array'
    && match.outputSchema.items.properties.confidence.type === 'number');
  check('重试安全元数据可用', match && match.retrySafe === true);
  const tap = builtin.actions.find((action) => action.name === 'input.tap');
  check('副作用 Action 不可安全重试', tap && !tap.retrySafe && tap.sideEffect);
  const rewardStats = builtin.actions.find((action) => action.name === 'stats.enqueue_reward');
  check('奖励统计 Action 暴露层号与 ROI', rewardStats
    && rewardStats.parameters.layer.type === 'integer'
    && rewardStats.parameters.roi.type === 'rect'
    && rewardStats.sideEffect
    && !rewardStats.retrySafe);
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
  check('解析工作流描述', info.description === '用于扩展冒烟测试的工作流');
  check('解析有序 children', JSON.stringify(info.nodes.find((node) => node.id === 'main').children) === JSON.stringify(['capture', 'wait', 'choice']));
  check('解析工作流变量', info.blackboardProps.includes('verify_timeout'));
  check('解析装饰器', info.nodes.find((node) => node.id === 'wait').decorators[0].type === 'timeout');
  check('合法 Behavior Tree 无错误', errorsOf(FIXTURE, catalog).length === 0);
  const threeInstance = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'workflows', 'examples', 'three_instance_parallel.json'), 'utf8'));
  const threeInfo = parseWorkflow(threeInstance);
  const threeNode = threeInfo.nodes.find((node) => node.type === 'instance_parallel');
  check('解析 Instance Parallel 节点', !!threeNode && threeNode.runs.length === 3 && threeNode.runs[0].instance === 'mumu-0');
  check('Instance Parallel 示例通过编辑器校验', errorsOf(threeInstance, catalog).length === 0);

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
  const selfRef = clone(FIXTURE); selfRef.nodes.find((node) => node.id === 'tap').params.x = { ref: 'nodes.tap.output.x' };
  check('拒绝节点自引用', errorsOf(selfRef, catalog).some((item) => item.code === 'unavailable-ref'));
  const forwardRef = clone(FIXTURE); forwardRef.nodes.find((node) => node.id === 'wait').params.timeout_seconds = { ref: 'nodes.tap.output.interval_seconds' };
  check('拒绝前向引用', errorsOf(forwardRef, catalog).some((item) => item.code === 'unavailable-ref'));
  const priorRef = clone(FIXTURE); priorRef.nodes.find((node) => node.id === 'tap').params.x = { ref: 'nodes.capture.output.width' };
  check('接受前置 Sequence 输出引用', errorsOf(priorRef, catalog).length === 0);
  const branchRef = clone(FIXTURE);
  const branchSource = branchRef.nodes.find((node) => node.id === 'tap');
  branchSource.action = 'core.log'; branchSource.params = { message: 'first branch' };
  branchRef.nodes.find((node) => node.id === 'log').params.message = { ref: 'nodes.tap.output.message' };
  check('拒绝 Selector 分支间普通参数引用', errorsOf(branchRef, catalog).some((item) => item.code === 'unavailable-ref'));
  const unsafeRetry = clone(FIXTURE); unsafeRetry.nodes.find((node) => node.id === 'tap').decorators.push({ type: 'retry', attempts: 3 });
  check('拒绝副作用 Action 重试', errorsOf(unsafeRetry, catalog).some((item) => item.code === 'unsafe-retry'));
  const doOnce = clone(FIXTURE); doOnce.nodes.find((node) => node.id === 'tap').decorators.push({ type: 'do_once' });
  check('接受 do_once 装饰器', errorsOf(doOnce, catalog).length === 0);
  const duplicateDoOnce = clone(FIXTURE); duplicateDoOnce.nodes.find((node) => node.id === 'tap').decorators.push({ type: 'do_once' }, { type: 'do_once' });
  check('拒绝重复 do_once 装饰器', errorsOf(duplicateDoOnce, catalog).some((item) => item.code === 'duplicate-decorator'));
  const doOnceExtra = clone(FIXTURE); doOnceExtra.nodes.find((node) => node.id === 'tap').decorators.push({ type: 'do_once', seconds: 1 });
  check('拒绝 do_once 未知字段', errorsOf(doOnceExtra, catalog).some((item) => item.code === 'invalid-decorator'));
  const doOnceReset = clone(FIXTURE); doOnceReset.nodes.find((node) => node.id === 'tap').decorators.push({ type: 'do_once', reset_on_failure: true });
  check('接受 do_once reset_on_failure', errorsOf(doOnceReset, catalog).length === 0);
  const doOnceResetBad = clone(FIXTURE); doOnceResetBad.nodes.find((node) => node.id === 'tap').decorators.push({ type: 'do_once', reset_on_failure: 'yes' });
  check('拒绝 do_once 非布尔 reset_on_failure', errorsOf(doOnceResetBad, catalog).some((item) => item.code === 'invalid-decorator'));
  const parallel = clone(FIXTURE); parallel.nodes.find((node) => node.id === 'choice').type = 'simple_parallel'; parallel.nodes.find((node) => node.id === 'choice').children[0] = 'main';
  check('拒绝 Parallel 非 Task 主分支', errorsOf(parallel, catalog).some((item) => item.code === 'parallel-main-task'));
  check('拒绝 schema v2', errorsOf({ ...FIXTURE, schema_version: 2 }, catalog).some((item) => item.code === 'schema-version'));

  const schema = buildWorkflowSchema(info, catalog);
  check('Schema 固定 v3', schema.properties.schema_version.const === 3);
  check('Schema 支持工作流描述', schema.properties.description.type === 'string');
  check('Schema children 使用节点枚举', schema.properties.nodes.items.properties.children.items.enum.includes('tap'));
  const refs = collectRefSuggestions(info, catalog);
  check('工作流变量引用补全', refs.blackboard.includes('blackboard.verify_timeout'));
  check('节点输出引用补全', refs.nodes.includes('nodes.capture.output.width'));
  check('数组输出补全首个匹配对象与字段', refs.nodes.includes('nodes.wait.output.0') && refs.nodes.includes('nodes.wait.output.0.confidence'));
  const matchRefs = collectRefSuggestions(info, catalog, 'tap', { type: 'object' });
  check('对象参数只列出此前可用且类型兼容的匹配对象',
    matchRefs.nodes.includes('nodes.wait.output.0')
    && !matchRefs.nodes.some((ref) => ref.startsWith('nodes.tap.'))
    && !matchRefs.nodes.some((ref) => ref.startsWith('nodes.log.'))
    && !matchRefs.nodes.includes('nodes.capture.output.width'));

  const layout = computeLayout(info);
  check('布局包含 6 条父子边', layout.edges.length === 6);
  check('父节点位于子节点上方', layout.positions.root.y < layout.positions.main.y && layout.positions.main.y < layout.positions.capture.y);
  check('兄弟节点横向展开', layout.positions.capture.x !== layout.positions.wait.x);

  const subFiles = [
    { uri: 'file:///workflows/reward_statistics.json', name: 'reward_statistics.json', rel: 'workflows/reward_statistics.json' },
    { uri: 'file:///workflows/souls/main_loop.json', name: 'main_loop.json', rel: 'workflows/souls/main_loop.json' },
  ];
  check('子流程引用按文件名匹配', matchWorkflowReference('reward_statistics', subFiles) === 'file:///workflows/reward_statistics.json');
  check('子流程引用按带扩展名文件名匹配', matchWorkflowReference('reward_statistics.json', subFiles) === 'file:///workflows/reward_statistics.json');
  check('子流程引用按相对路径匹配', matchWorkflowReference('workflows/souls/main_loop.json', subFiles) === 'file:///workflows/souls/main_loop.json');
  check('子流程引用匹配路径末尾片段', matchWorkflowReference('souls/main_loop', subFiles) === 'file:///workflows/souls/main_loop.json');
  check('未知子流程引用不匹配', matchWorkflowReference('missing_flow', subFiles) === undefined);
  check('空子流程引用不匹配', matchWorkflowReference('', subFiles) === undefined);

  // 引用关系：真实项目文件上的收集与解析（与引用查看器使用同一套共享函数）。
  const workflowsDir = path.join(PROJECT_ROOT, 'workflows');
  const projectFiles = fs.readdirSync(workflowsDir, { recursive: true })
    .filter((name) => String(name).toLowerCase().endsWith('.json'))
    .map((name) => `workflows/${String(name).replace(/\\/g, '/')}`)
    .sort()
    .map((rel) => ({ uri: `file:///${rel}`, name: rel.split('/').pop(), rel }));
  const projectRead = async (uri) => fs.readFileSync(path.join(PROJECT_ROOT, uri.replace('file:///', '')), 'utf8');
  const leaderRaw = JSON.parse(await projectRead('file:///workflows/entrypoints/mumu_0_souls_party_leader.json'));
  const leaderRefs = collectWorkflowRunReferences(leaderRaw);
  check('队长工作流收集 4 处子流程引用且节点 ID 齐全', leaderRefs.length === 4 && leaderRefs.every((entry) => entry.nodeId && entry.reference));
  const leaderResolved = [];
  for (const entry of leaderRefs) leaderResolved.push(await resolveWorkflowReference(entry.reference, projectFiles, projectRead));
  check('队长引用全部解析到文件', leaderResolved.length === 4 && leaderResolved.every(Boolean));
  check('文件名引用解析到回合脚本', leaderResolved.filter((uri) => uri === 'file:///workflows/souls/party/leader_round.json').length === 3);
  check('shared 路径引用解析到公共子流程', leaderResolved.includes('file:///workflows/souls/shared/task_in_souls.json'));

  const backRefs = [];
  const rewardUri = 'file:///workflows/souls/shared/reward_statistics.json';
  for (const file of projectFiles) {
    if (file.uri === rewardUri) continue;
    for (const entry of collectWorkflowRunReferences(JSON.parse(await projectRead(file.uri)))) {
      if ((await resolveWorkflowReference(entry.reference, projectFiles, projectRead)) === rewardUri) {
        backRefs.push({ file: file.rel, nodeId: entry.nodeId });
      }
    }
  }
  check('奖励统计脚本被多个工作流引用（含回合脚本）', backRefs.length >= 3
    && backRefs.some((item) => item.file === 'workflows/souls/party/leader_round.json')
    && backRefs.some((item) => item.file === 'workflows/entrypoints/mumu_1_souls_loop.json'));
  const testRaw = JSON.parse(await projectRead('file:///workflows/examples/test_workflow.json'));
  check('悬空引用在收集层仍是条目、解析层返回 undefined', collectWorkflowRunReferences(testRaw).length > 0
    && (await resolveWorkflowReference('no_such_flow.json', projectFiles, projectRead)) === undefined);

  const idFiles = [{ uri: 'file:///w/renamed.json', name: 'renamed.json', rel: 'w/renamed.json' }];
  const idResolved = await resolveWorkflowReference('fixture_tree', idFiles, async () => JSON.stringify(FIXTURE));
  check('工作流 ID 引用回退到文件内容匹配', idResolved === 'file:///w/renamed.json');
  check('未知 ID 引用不匹配', (await resolveWorkflowReference('no_such_id', idFiles, async () => JSON.stringify(FIXTURE))) === undefined);

  const nonRun = parseWorkflow(FIXTURE);
  check('非 workflow.run 工作流无引用', collectWorkflowRunReferences(nonRun.raw).length === 0);
  check('非对象输入无引用', collectWorkflowRunReferences(null).length === 0 && collectWorkflowRunReferences([1, 2]).length === 0);

  // 结构树：真实项目文件构建层级（与独立结构树窗口同一函数）。
  const flattenTree = (nodes, out = []) => { for (const node of nodes) { out.push(node); flattenTree(node.children, out); } return out; };
  const leaderTree = buildTreeNode(JSON.parse(await projectRead('file:///workflows/entrypoints/mumu_0_souls_party_leader.json')));
  const leaderLeaves = flattenTree(leaderTree);
  check('结构树从 root 构建完整层级', leaderTree.length === 1 && leaderTree[0].type === 'root' && leaderTree[0].id === 'root' && leaderLeaves.length > 10);
  check('结构树标记子流程引用节点', leaderLeaves.some((node) => node.meta.startsWith('⇢ ')));
  check('结构树节点 ID 与类型齐全', leaderLeaves.every((node) => node.id && node.type));
  const roundTree = buildTreeNode(JSON.parse(await projectRead('file:///workflows/souls/party/leader_round.json')));
  check('结构树子流程引用显示目标文件名', flattenTree(roundTree).some((node) => node.meta === '⇢ reward_statistics.json'));
  check('空输入构建空树', buildTreeNode(null).length === 0 && buildTreeNode({ nodes: 'x' }).length === 0);

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
