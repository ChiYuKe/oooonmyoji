/**
 * 符号层：把图文档与行级扫描合成 VSCode 需要的两种视图——
 * 大纲（`DocumentSymbolProvider`）与引脚表（补全 / 悬停用）。
 *
 * 大纲的分组刻意按「工作流 → 节点 / 变量 / 分组 / 注释 / 连线」组织：`.owf` 是文本
 * 格式，连线在文件末尾的 `edges:` 块里，如果大纲也按文件顺序平铺，找节点会很累。
 * 这里按语义分组、组内保持文件顺序（也就是 `nodes` 数组顺序），与桌面端画布一致。
 */
'use strict';

const vscode = require('vscode');

/**
 * @typedef {object} PinInfo
 * @property {string} name 引脚名（边表里 `目标:引脚` 的写法）。
 * @property {string} detail 人类可读说明，例如「参数 · 模板」。
 */

/**
 * 推导一个节点的「可用目标引脚」。
 *
 * 引脚是**参数名或特殊口**（见 docs/workflow-dsl-v6.md「连线表」一节），所以能推导的
 * 只有三类，其余一律不许瞎猜：
 * 1. `in`——执行入参，所有节点都有；
 * 2. `params` 里的键——参数名；
 * 3. 函数节点自己的特殊口（`condition` 节点的 `condition`、`switch` 的 `case.<i>` /
 *    `default`、`sequence` 的 `then.<i>`、`branch` 的 `conditions.<i>`、
 *    `instance_parallel` 的 `runs.<i>.inputs.<键>`、装饰器的 `decorators.<i>.<键>`）。
 *
 * @param {any} node 图文档里的节点对象。
 * @returns {PinInfo[]} 该节点的目标引脚。
 */
function targetPinsOf(node) {
  /** @type {PinInfo[]} */
  const pins = [{ name: 'in', detail: '执行入参' }];
  const params = node && typeof node.params === 'object' && node.params !== null ? node.params : {};
  for (const key of Object.keys(params)) pins.push({ name: key, detail: `参数 · ${key}` });

  const type = node && node.type;
  if (type === 'condition' || type === 'bool_judge') {
    pins.push({ name: 'condition', detail: '条件表达式' });
  }
  if (type === 'repeat_until') pins.push({ name: 'condition', detail: '循环条件表达式' });
  if (type === 'branch') pins.push({ name: 'conditions.0', detail: '条件列表第 0 项' });
  if (type === 'sequence' || type === 'parallel' || type === 'simple_parallel') {
    pins.push({ name: 'then.0', detail: '第 0 个子节点' });
  }
  if (type === 'switch') {
    pins.push({ name: 'default', detail: '默认分支' });
    const cases = Array.isArray(node.cases) ? node.cases : [];
    cases.forEach((_, index) => pins.push({ name: `case.${index}`, detail: `分支取值第 ${index} 项` }));
  }
  if (type === 'instance_parallel') {
    pins.push({ name: 'runs.0.inputs', detail: '第 0 个实例的输入' });
  }
  if (Array.isArray(node.ref) || (node && typeof node.ref === 'string')) {
    pins.push({ name: 'ref', detail: 'break 的结果引用' });
  }
  const decorators = Array.isArray(node && node.decorators) ? node.decorators : [];
  decorators.forEach((decorator, index) => {
    const kind = decorator && decorator.type ? decorator.type : 'decorator';
    pins.push({ name: `decorators.${index}.count`, detail: `第 ${index} 个装饰器（${kind}）` });
  });
  return pins;
}

/**
 * 推导一个节点的「可用源引脚」。
 * @param {any} node 图文档里的节点对象。
 * @returns {PinInfo[]} 该节点的源引脚。
 */
function sourcePinsOf(node) {
  const type = node && node.type;
  /** @type {PinInfo[]} */
  const pins = [];
  if (type === 'condition' || type === 'bool_judge') {
    pins.push({ name: 'true', detail: '条件成立' }, { name: 'false', detail: '条件不成立' });
  } else if (type === 'switch') {
    pins.push({ name: 'default', detail: '默认分支' });
    const cases = Array.isArray(node.cases) ? node.cases : [];
    cases.forEach((_, index) => pins.push({ name: `case.${index}`, detail: `分支取值第 ${index} 项` }));
  }
  pins.push({ name: 'then.0', detail: '执行出参（省略即此项）' });
  // 数据口：节点声明了输出 schema 时把字段名给出来。
  const output = node && node.output;
  if (output && typeof output === 'object') {
    for (const key of Object.keys(output)) pins.push({ name: `out.${key}`, detail: `输出 · ${key}` });
  }
  return pins;
}

/**
 * 为整份模型建立「节点 id → 引脚」索引。
 * @param {import('../model').Model} model 文档模型。
 * @returns {Map<string, {targets: PinInfo[], sources: PinInfo[]}>} 引脚索引。
 */
function buildPinIndex(model) {
  /** @type {Map<string, {targets: PinInfo[], sources: PinInfo[]}>} */
  const index = new Map();
  if (!model.ok) return index;
  const nodes = Array.isArray(model.document.nodes) ? model.document.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string') continue;
    index.set(node.id, { targets: targetPinsOf(node), sources: sourcePinsOf(node) });
  }
  return index;
}

/**
 * 把模型转成大纲符号树。
 * @param {import('../model').Model} model 文档模型。
 * @param {{showVariables: boolean}} options 展示选项。
 * @returns {vscode.DocumentSymbol[]} 大纲根符号。
 */
function documentSymbols(model, options) {
  /** @type {vscode.DocumentSymbol[]} */
  const roots = [];
  const lineOf = (line) => Math.min(Math.max(line - 1, 0), Math.max(model.scan.lines.length - 1, 0));
  const rangeAt = (line, length) => new vscode.Range(lineOf(line), 0, lineOf(line), Math.max(length, 1));

  const escaped = model.text.split(/\r\n|\n|\r/);
  const widthAt = (line) => (escaped[line - 1] || '').length;

  // 工作流根符号：头行（`workflow <id>`）或第一行。
  const workflowKey = model.scan.documentKeys.find((entry) => entry.key === 'workflow');
  const workflowId = workflowKey ? workflowKey.value : (model.ok ? model.document.id : '');
  const workflowLine = workflowKey ? workflowKey.line : 1;
  const root = new vscode.DocumentSymbol(
    workflowId || '工作流',
    model.scan.documentKeys.find((entry) => entry.key === 'version')?.value || '',
    vscode.SymbolKind.Module,
    rangeAt(1, widthAt(1)),
    rangeAt(workflowLine, widthAt(workflowLine)),
  );

  // 1) 节点
  const nodeGroup = new vscode.DocumentSymbol(
    `节点（${model.scan.nodes.length}）`,
    '',
    vscode.SymbolKind.Namespace,
    rangeAt(1, 1),
    rangeAt(1, 1),
  );
  for (const symbol of model.scan.nodes) {
    const detail = symbol.label ? `${symbol.type} · ${symbol.label}` : symbol.type;
    nodeGroup.children.push(new vscode.DocumentSymbol(
      symbol.id,
      detail,
      symbol.type === 'root' ? vscode.SymbolKind.Constructor : vscode.SymbolKind.Function,
      rangeAt(symbol.line, widthAt(symbol.line)),
      rangeAt(symbol.line, widthAt(symbol.line)),
    ));
  }
  if (nodeGroup.children.length) root.children.push(nodeGroup);

  if (options.showVariables) {
    // 2) 变量节点（画布里的变量卡）
    if (model.scan.variables.length) {
      const variableGroup = new vscode.DocumentSymbol(
        `变量（${model.scan.variables.length}）`,
        '',
        vscode.SymbolKind.Namespace,
        rangeAt(1, 1),
        rangeAt(1, 1),
      );
      for (const symbol of model.scan.variables) {
        variableGroup.children.push(new vscode.DocumentSymbol(
          symbol.name,
          `${symbol.scope} · ${symbol.id}`,
          vscode.SymbolKind.Variable,
          rangeAt(symbol.line, widthAt(symbol.line)),
          rangeAt(symbol.line, widthAt(symbol.line)),
        ));
      }
      root.children.push(variableGroup);
    }

    // 3) 通用块：inputs / variables / nodeTypes / limits / _inputParams…
    const containerGroup = new vscode.DocumentSymbol(
      `文档块（${model.scan.containers.length}）`,
      '',
      vscode.SymbolKind.Namespace,
      rangeAt(1, 1),
      rangeAt(1, 1),
    );
    for (const container of model.scan.containers) {
      const symbol = new vscode.DocumentSymbol(
        container.key,
        container.entries ? `${container.entries.length} 项` : '',
        vscode.SymbolKind.Object,
        rangeAt(container.line, widthAt(container.line)),
        rangeAt(container.line, widthAt(container.line)),
      );
      for (const entry of container.entries || []) {
        const label = entry.value ? `${entry.key} = ${truncate(entry.value, 40)}` : entry.key;
        symbol.children.push(new vscode.DocumentSymbol(
          label,
          '',
          vscode.SymbolKind.Property,
          rangeAt(entry.line, widthAt(entry.line)),
          rangeAt(entry.line, widthAt(entry.line)),
        ));
      }
      containerGroup.children.push(symbol);
    }
    const scalarKeys = model.scan.documentKeys.filter((entry) => entry.key !== 'workflow');
    for (const entry of scalarKeys) {
      containerGroup.children.push(new vscode.DocumentSymbol(
        entry.value ? `${entry.key} = ${truncate(entry.value, 40)}` : entry.key,
        '',
        vscode.SymbolKind.Constant,
        rangeAt(entry.line, widthAt(entry.line)),
        rangeAt(entry.line, widthAt(entry.line)),
      ));
    }
    if (containerGroup.children.length) root.children.push(containerGroup);

    // 4) 分组与注释框
    if (model.scan.groups.length || model.scan.comments.length) {
      const annotationGroup = new vscode.DocumentSymbol(
        `分组 / 注释（${model.scan.groups.length + model.scan.comments.length}）`,
        '',
        vscode.SymbolKind.Namespace,
        rangeAt(1, 1),
        rangeAt(1, 1),
      );
      for (const symbol of model.scan.groups) {
        annotationGroup.children.push(new vscode.DocumentSymbol(
          symbol.id,
          symbol.label || '节点组',
          vscode.SymbolKind.Class,
          rangeAt(symbol.line, widthAt(symbol.line)),
          rangeAt(symbol.line, widthAt(symbol.line)),
        ));
      }
      for (const symbol of model.scan.comments) {
        annotationGroup.children.push(new vscode.DocumentSymbol(
          symbol.id,
          symbol.label || '注释框',
          vscode.SymbolKind.String,
          rangeAt(symbol.line, widthAt(symbol.line)),
          rangeAt(symbol.line, widthAt(symbol.line)),
        ));
      }
      root.children.push(annotationGroup);
    }
  }

  // 5) 连线：按源节点分组，行的先后就是 `edges` 数组顺序。
  if (model.scan.edges.length) {
    const edgeGroup = new vscode.DocumentSymbol(
      `连线（${model.scan.edges.length}）`,
      '',
      vscode.SymbolKind.Namespace,
      rangeAt(1, 1),
      rangeAt(1, 1),
    );
    for (const edge of model.scan.edges) {
      const label = `${edge.from}:${edge.fromPin} → ${edge.to}:${edge.toPin}`;
      edgeGroup.children.push(new vscode.DocumentSymbol(
        label,
        '',
        vscode.SymbolKind.Event,
        rangeAt(edge.line, widthAt(edge.line)),
        rangeAt(edge.line, widthAt(edge.line)),
      ));
    }
    root.children.push(edgeGroup);
  }

  roots.push(root);
  return roots;
}

/** 截断长值，避免大纲条目被一段文档描述撑爆。 */
function truncate(text, limit) {
  const oneLine = String(text).replace(/\s+/g, ' ');
  return oneLine.length > limit ? `${oneLine.slice(0, limit - 1)}…` : oneLine;
}

module.exports = { buildPinIndex, documentSymbols, sourcePinsOf, targetPinsOf, truncate };
