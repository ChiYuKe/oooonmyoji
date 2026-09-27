/**
 * 结构树命令：把 `.owf` 按**执行关系**摊开成树，而不是按文件行序。
 *
 * 为什么值得单独做一个命令：`.owf` 的连线集中在文件末尾的 `edges:` 块里，所以「谁接了谁」
 * 在文本上离得很远。这里用解析结果里的 `edges` 从根节点做一次深度优先展开，配合
 * `then.<下标>` 排序（与编译器的排序规则一致），得到的就是运行时会走的顺序。
 *
 * 树里同时标出：节点类型、显示名、折叠图边界卡、装饰器、以及被引用的子工作流。
 * 输出既显示在 `OutputChannel`，也可以一键复制——便于贴进 issue 或对照画布。
 */
'use strict';

const vscode = require('vscode');
const { modelFor } = require('../model');

/** 展开树时的安全上限，防止畸形文档把递归撑爆。 */
const MAX_DEPTH = 64;

/**
 * 注册结构树相关命令。
 * @param {vscode.ExtensionContext} context 扩展上下文。
 * @returns {void}
 */
function register(context) {
  const channel = vscode.window.createOutputChannel('OWF 结构树');
  context.subscriptions.push(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand('owf.showStructureTree', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'owf') {
        vscode.window.showWarningMessage('请先打开一个 .owf 文件。');
        return;
      }
      const model = modelFor(editor.document);
      if (!model.ok) {
        const choice = await vscode.window.showErrorMessage(
          `无法生成结构树：${model.failure.message}`,
          '跳到出错位置',
        );
        if (choice === '跳到出错位置') {
          const line = Math.min(Math.max(model.failure.line - 1, 0), editor.document.lineCount - 1);
          const column = Math.max(model.failure.column - 1, 0);
          const position = new vscode.Position(line, column);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
        return;
      }

      const lines = renderTree(model);
      channel.clear();
      channel.appendLine(`# ${model.fileName}`);
      for (const line of lines) channel.appendLine(line);
      channel.show(true);

      const copy = await vscode.window.showInformationMessage(
        `结构树已生成：${model.scan.nodes.length} 个节点、${model.scan.edges.length} 条连线。`,
        '复制为文本',
      );
      if (copy === '复制为文本') await vscode.env.clipboard.writeText(lines.join('\n'));
    }),

    vscode.commands.registerCommand('owf.copyCanvasLayout', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'owf') {
        vscode.window.showWarningMessage('请先打开一个 .owf 文件。');
        return;
      }
      const model = modelFor(editor.document);
      if (!model.ok) {
        vscode.window.showErrorMessage(`无法读取布局：${model.failure.message}`);
        return;
      }
      const layout = {};
      for (const node of model.document.nodes || []) {
        if (node && typeof node.id === 'string' && node.at) layout[node.id] = { x: node.at.x, y: node.at.y };
      }
      await vscode.env.clipboard.writeText(JSON.stringify(layout, null, 2));
      vscode.window.showInformationMessage(`已复制 ${Object.keys(layout).length} 个节点的坐标。`);
    }),
  );
}

/**
 * 从根节点出发，按执行顺序展开成缩进文本。
 * @param {import('../model').Model} model 文档模型。
 * @returns {string[]} 每一行文本。
 */
function renderTree(model) {
  const nodes = new Map();
  for (const node of model.document.nodes || []) {
    if (node && typeof node.id === 'string') nodes.set(node.id, node);
  }
  const byFrom = new Map();
  for (const edge of model.document.edges || []) {
    const from = edge && edge.from ? edge.from.node : null;
    if (!from) continue;
    if (!byFrom.has(from)) byFrom.set(from, []);
    byFrom.get(from).push(edge);
  }

  const rootId = typeof model.document.root === 'string' && nodes.has(model.document.root)
    ? model.document.root
    : (model.document.nodes || []).find((node) => node && node.type === 'root')?.id;
  const lines = [];
  if (rootId) {
    walk(rootId, 0, []);
  } else {
    // 没有根节点（文档非法但能解析）时，把所有无入边的节点都列出来。
    const targets = new Set((model.document.edges || []).map((edge) => edge && edge.to && edge.to.node));
    for (const id of nodes.keys()) if (!targets.has(id)) walk(id, 0, []);
  }
  return lines;

  /**
   * @param {string} nodeId 当前节点 id。
   * @param {number} depth 缩进层级。
   * @param {string[]} trail 祖先链，用于检测成环。
   */
  function walk(nodeId, depth, trail) {
    if (depth > MAX_DEPTH) return;
    const indent = '  '.repeat(depth);
    if (trail.includes(nodeId)) {
      lines.push(`${indent}↻ ${nodeId}（已出现过，可能是环）`);
      return;
    }
    const node = nodes.get(nodeId);
    if (!node) {
      lines.push(`${indent}✗ ${nodeId}（边指向了不存在的节点）`);
      return;
    }

    lines.push(`${indent}${describe(node)}`);

    // 执行出边按引脚下标排序，与编译器 sortChildren 的口径一致。
    const outgoing = (byFrom.get(nodeId) || [])
      .filter((edge) => isExecPin(edge.from.pin))
      .sort((a, b) => pinIndex(a.from.pin) - pinIndex(b.from.pin));
    for (const edge of outgoing) {
      const label = edge.from.pin && !isDefaultExecPin(edge.from.pin) ? `  ⟨${edge.from.pin}⟩` : '';
      if (label) lines.push(`${indent}  ${label.trim()}`);
      walk(edge.to.node, depth + 1, [...trail, nodeId]);
    }

    // 数据边（`out.*` / 变量口）不参与执行顺序，单独列一行说明。
    const dataEdges = (byFrom.get(nodeId) || []).filter((edge) => !isExecPin(edge.from.pin));
    if (dataEdges.length) {
      const summary = dataEdges
        .map((edge) => `${edge.from.pin} → ${edge.to.node}:${edge.to.pin}`)
        .join('、');
      lines.push(`${indent}  ⤳ 数据：${summary}`);
    }
  }
}

/**
 * 渲染单个节点的单行描述：`id  [类型]  显示名  ⇢ 子工作流`。
 * @param {any} node 图文档节点。
 * @returns {string} 描述行。
 */
function describe(node) {
  const parts = [node.id, `[${node.type || 'task'}]`];
  if (typeof node.name === 'string' && node.name.trim()) parts.push(node.name.trim());

  if (node.type === 'task' && node.action) parts.push(`action=${node.action}`);
  const params = node.params && typeof node.params === 'object' ? node.params : {};
  if (typeof params.workflow === 'string') {
    parts.push(`⇢ ${String(params.workflow).split(/[\\/]/).pop()}`);
  }
  if (node.type === 'instance_parallel' && Array.isArray(node.runs)) {
    const names = node.runs
      .map((run) => (run && run.instance ? run.instance : '?'))
      .join('、');
    parts.push(`⇉ ${names}`);
  }
  if (Array.isArray(node.decorators) && node.decorators.length) {
    parts.push(`+${node.decorators.map((item) => (item && item.type) || '?').join(',')}`);
  }
  return parts.join('  ');
}

/** 执行口：`then` / `then.<i>` / `true` / `false` / `case.<i>` / `default`（数据口一律 `out.*` 或变量口）。 */
function isExecPin(pin) {
  if (typeof pin !== 'string') return true;
  return !pin.startsWith('out');
}

/** 默认执行口 `then.0`（边表里省略不写）。 */
function isDefaultExecPin(pin) {
  return pin === 'then.0' || pin === 'then' || !pin;
}

/** 取出 `then.<i>` / `case.<i>` / `conditions.<i>` 的下标，用于与编译器同序。 */
function pinIndex(pin) {
  if (typeof pin !== 'string') return 0;
  const match = /\.(\d+)$/.exec(pin);
  return match ? Number(match[1]) : 0;
}

module.exports = { register, renderTree };
