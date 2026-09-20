/*
 * 500 节点确定性性能样例：画布基准与性能测试共用同一份生成逻辑。
 *
 * 规模（与验收基线一致）：
 * - 500 个节点、499 条结构边
 * - 250 条数据边（节点输出引用 + 变量绑定）
 * - 100 张变量卡
 *
 * 关键点是**确定性**：同样的输入永远得到同一张图、同一个布局，
 * 于是优化前后的截图对比与帧时间对比才有意义。
 *
 * 用法：
 *   node scripts/canvas-fixture.cjs [输出路径]
 *   node -e "console.log(require('./scripts/canvas-fixture.cjs').buildCanvasFixture().document.nodes.length)"
 */
const fs = require('node:fs');
const path = require('node:path');

const NODE_WIDTH = 260;
const NODE_BASE_HEIGHT = 96;
/** 每个复合节点的任务子节点数。 */
const TASKS_PER_COMPOSITE = 8;
/** 变量卡数量。 */
const VARIABLE_CARD_COUNT = 100;
/** 引用边数量（每一条引用边对应一个 `nodes.<id>.output.<字段>` 参数值）。 */
const REFERENCE_EDGE_COUNT = 250;
/** 额外的变量绑定数量（250 条数据边 = 引用边 + 变量绑定）。 */
const VARIABLE_BINDING_COUNT = 0;

const COLUMN_GAP = 340;
const ROW_GAP = 320;
const COLUMNS = 10;

/** 画布目录快照：只包含样例用到的 Action，形状与宿主下发的清单一致。 */
function canvasCatalog() {
  return [
    {
      name: 'core.log',
      parameters: {
        message: { type: 'string', required: true, description: '日志文本' },
        fields: { type: 'object', description: '附加结构化字段（可选）' },
      },
      card: { rows: [{ param: 'message', label: '日志内容' }, { param: 'fields', label: '附加字段', control: 'inspector' }] },
      outputs: { type: 'object', properties: { message: { type: 'string' } } },
    },
  ];
}

/** 目标规模：500 个节点 / 499 条结构边。 */
const TARGET_NODES = 500;

/**
 * 构造样例工作流文档。
 *
 * 结构：root → main(sequence) → N 个 selector（每个 8 个 task）+ 若干直接挂在 main 下的 task，
 * 合计恰好 500 个节点、499 条结构边。布局按 10 列网格铺开，
 * 每个 grid 单元是「selector 在上、它的任务列在下」，便于验证视口裁剪。
 */
function buildCanvasFixture(options = {}) {
  const taskAction = options.taskAction || 'core.log';
  const tasksPerComposite = options.tasksPerComposite || TASKS_PER_COMPOSITE;
  const compositeCount = options.compositeCount ?? 51;
  const directTasks = options.directTasks ?? (TARGET_NODES - 2 - compositeCount * (1 + tasksPerComposite));

  if (directTasks < 0) throw new Error('样例规模参数无法凑出 500 个节点');
  const expectedNodes = 2 + compositeCount * (1 + tasksPerComposite) + directTasks;
  if (expectedNodes !== TARGET_NODES) {
    throw new Error(`样例必须正好 ${TARGET_NODES} 个节点，当前 ${expectedNodes} 个`);
  }

  const nodes = [];
  const layout = {};
  const inputs = {};
  const variables = {};
  const variableCards = {};
  const variableLinks = {};

  const rootId = 'root';
  const mainId = 'main';
  nodes.push({ id: rootId, type: 'root', children: [mainId] });

  const mainChildren = [];
  for (let index = 0; index < compositeCount; index += 1) mainChildren.push(`sel_${index}`);
  for (let index = 0; index < directTasks; index += 1) mainChildren.push(`task_direct_${index}`);
  nodes.push({ id: mainId, type: 'sequence', children: mainChildren });

  /** 所有 task 节点按「结构顺序」收集，引用边沿这个顺序成链。 */
  const taskIds = [];

  for (let index = 0; index < compositeCount; index += 1) {
    const children = [];
    for (let child = 0; child < tasksPerComposite; child += 1) {
      const id = `task_${index}_${child}`;
      children.push(id);
      taskIds.push(id);
    }
    nodes.push({ id: `sel_${index}`, type: 'selector', children });
  }
  for (let index = 0; index < directTasks; index += 1) taskIds.push(`task_direct_${index}`);

  // 每个任务节点一条可见参数（字面量），保证卡片上有参数行。
  const taskIndex = new Map(taskIds.map((id, index) => [id, index]));
  for (const id of taskIds) {
    nodes.push({ id, type: 'task', action: taskAction, params: { message: `第 ${taskIndex.get(id)} 步` } });
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // 引用边：taskIds[i] 的 message 引用 taskIds[i-1] 的 output.message（成链，不嵌套）。
  const referenceCount = Math.min(options.referenceEdges ?? REFERENCE_EDGE_COUNT, Math.max(0, taskIds.length - 1));
  for (let index = 1; index <= referenceCount; index += 1) {
    const target = byId.get(taskIds[index]);
    const source = taskIds[index - 1];
    target.params.message = { ref: `nodes.${source}.output.message` };
  }

  // 变量卡：inputs / variables 各一半，值都写死，避免依赖真实宿主。
  for (let index = 0; index < VARIABLE_CARD_COUNT; index += 1) {
    const scope = index % 2 === 0 ? 'inputs' : 'variables';
    const name = `变量_${String(index).padStart(3, '0')}`;
    const definition = { type: index % 3 === 0 ? 'number' : 'string', default: index % 3 === 0 ? index : `值 ${index}` };
    if (scope === 'inputs') inputs[name] = definition; else variables[name] = definition;
    variableCards[`card_${index}`] = {
      name,
      scope,
      x: Math.round(-460),
      y: Math.round(index * 72),
    };
  }

  // 变量绑定：把剩下的数据边补齐到 250 条（任务参数指向变量卡）。
  const bindingCount = Math.max(0, (options.variableBindings ?? VARIABLE_BINDING_COUNT));
  for (let index = 0; index < bindingCount; index += 1) {
    const id = taskIds[taskIds.length - 1 - (index % taskIds.length)];
    const cardIndex = index % VARIABLE_CARD_COUNT;
    const card = variableCards[`card_${cardIndex}`];
    const node = byId.get(id);
    node.params.message = { ref: `${card.scope}.${card.name}` };
    variableLinks[`${id}:message`] = `card_${cardIndex}`;
  }

  // 布局：selector 按 10 列网格铺开，每个 selector 的 8 个任务竖直排在它下方。
  // 直接挂在 main 下的任务再往后叠一行，于是整张图是规整的网格，视口只能覆盖其中一角。
  layout[rootId] = { x: 0, y: -ROW_GAP * 2 };
  layout[mainId] = { x: 0, y: -ROW_GAP };
  /** 每个 selector 占用的任务列高度（世界坐标）。 */
  const taskColumnHeight = tasksPerComposite * (NODE_BASE_HEIGHT + 150);
  for (let index = 0; index < compositeCount; index += 1) {
    const id = `sel_${index}`;
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const x = column * COLUMN_GAP;
    const y = row * (taskColumnHeight + ROW_GAP);
    layout[id] = { x, y };
    const node = byId.get(id);
    for (const [order, childId] of node.children.entries()) {
      layout[childId] = { x, y: y + NODE_BASE_HEIGHT + 60 + order * (NODE_BASE_HEIGHT + 150) };
    }
  }
  const directStartY = Math.ceil(compositeCount / COLUMNS) * (taskColumnHeight + ROW_GAP);
  for (let index = 0; index < directTasks; index += 1) {
    layout[`task_direct_${index}`] = {
      x: (index % COLUMNS) * COLUMN_GAP,
      y: directStartY + Math.floor(index / COLUMNS) * (NODE_BASE_HEIGHT + 150),
    };
  }

  const document = {
    schema_version: 4,
    id: 'canvas_500',
    version: '4.0.0',
    description: '500 节点画布性能样例（确定性生成）',
    resolution: [1920, 1080],
    root: rootId,
    inputs,
    variables,
    nodes,
    _layout: layout,
    _variableCards: variableCards,
    _variableLinks: variableLinks,
  };

  return {
    document,
    catalog: canvasCatalog(),
    metrics: {
      nodes: nodes.length,
      structuralEdges: nodes.reduce((count, node) => count + (Array.isArray(node.children) ? node.children.length : 0), 0),
      referenceEdges: referenceCount,
      variableBindings: bindingCount,
      dataEdges: referenceCount + bindingCount,
      variableCards: VARIABLE_CARD_COUNT,
    },
  };
}

if (require.main === module) {
  // 默认同时写两份：测试夹具（随仓库提交）+ 画布基准页可直接 fetch 的静态副本。
  const targets = process.argv[2]
    ? [process.argv[2]]
    : [
      path.join(__dirname, '..', 'tests', 'fixtures', 'canvas-500.json'),
      path.join(__dirname, '..', 'public', 'benchmark', 'canvas-500.json'),
    ];
  const fixture = buildCanvasFixture();
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    process.stdout.write(`${target}\n`);
  }
  process.stdout.write(`${JSON.stringify(fixture.metrics)}\n`);
}

module.exports = { buildCanvasFixture, canvasCatalog, NODE_BASE_HEIGHT, NODE_WIDTH };
