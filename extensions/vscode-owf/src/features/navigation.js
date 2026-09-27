/**
 * 跳转与悬停：在 `.owf` 里「点一下就能到」的位置，只有两类是有确定答案的。
 *
 * 1. 边表里的节点 id（`源 -> 目标`）→ 跳到 `node <id> …` 那一行；
 * 2. 引用（`nodes.<id>` / `variables.<id>` / `inputs.<键>`）→ 跳到对应声明。
 *
 * 悬停则把「这个 id 是什么」讲清楚：节点给类型/显示名/度数，变量给作用域与派生 id，
 * 引脚给它的来源说明。这些都取自同一次解析结果，所以与画布上的语义一致。
 */
'use strict';

const vscode = require('vscode');
const { modelFor } = require('../model');

/**
 * 注册跳转定义与悬停。
 * @param {vscode.ExtensionContext} context 扩展上下文。
 * @returns {void}
 */
function register(context) {
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider({ language: 'owf' }, {
      /**
       * @param {vscode.TextDocument} document
       * @param {vscode.Position} position
       * @returns {vscode.Location[]}
       */
      provideDefinition(document, position) {
        const model = modelFor(document);
        const target = resolveAt(model, position);
        if (!target) return [];
        const declared = target.symbol && Number.isInteger(target.symbol.line) ? target.symbol.line : 1;
        const line = Math.min(Math.max(declared - 1, 0), Math.max(document.lineCount - 1, 0));
        const text = document.lineAt(line).text;
        return [new vscode.Location(document.uri, new vscode.Range(line, 0, line, Math.max(text.length, 1)))];
      },
    }),

    vscode.languages.registerHoverProvider({ language: 'owf' }, {
      /**
       * @param {vscode.TextDocument} document
       * @param {vscode.Position} position
       * @returns {vscode.Hover|null}
       */
      provideHover(document, position) {
        const model = modelFor(document);
        const target = resolveAt(model, position);
        if (!target) return null;

        const markdown = new vscode.MarkdownString();
        markdown.supportThemeIcons = true;

        if (target.kind === 'pin' && target.pinDetail) {
          markdown.appendMarkdown(`$(symbol-field) 引脚 \`${target.display}\`\n\n`);
          markdown.appendMarkdown(`${target.pinDetail}\n\n`);
          markdown.appendMarkdown(`节点：\`${target.nodeId}\``);
          return new vscode.Hover(markdown, target.range);
        }

        if (target.symbol.kind === 'node') {
          const symbol = target.symbol;
          markdown.appendMarkdown(`$(symbol-function) 节点 \`${symbol.id}\`\n\n`);
          markdown.appendMarkdown(`| 项 | 值 |\n| --- | --- |\n`);
          markdown.appendMarkdown(`| 类型 | \`${symbol.type}\` |\n`);
          if (symbol.label) markdown.appendMarkdown(`| 显示名 | ${escapeMarkdown(symbol.label)} |\n`);
          markdown.appendMarkdown(`| 声明 | 第 ${symbol.line} 行 |\n`);

          const degree = edgeDegree(model, symbol.id);
          if (degree.in || degree.out) {
            markdown.appendMarkdown(`| 连线 | 入 ${degree.in} / 出 ${degree.out} |\n`);
          }
          const pins = model.pinsByNode.get(symbol.id);
          if (pins && pins.targets.length > 1) {
            const names = pins.targets.map((pin) => `\`${pin.name}\``).join('、');
            markdown.appendMarkdown(`\n**可用目标引脚**：${names}`);
          }
          return new vscode.Hover(markdown, target.range);
        }

        if (target.symbol.kind === 'variable') {
          const symbol = target.symbol;
          markdown.appendMarkdown(`$(symbol-variable) 变量 \`${symbol.name}\`\n\n`);
          markdown.appendMarkdown(`| 项 | 值 |\n| --- | --- |\n`);
          markdown.appendMarkdown(`| 作用域 | \`${symbol.scope}\` |\n`);
          markdown.appendMarkdown(`| 派生 id | \`${symbol.id}\` |\n`);
          markdown.appendMarkdown(`| 声明 | 第 ${symbol.line} 行 |\n`);
          return new vscode.Hover(markdown, target.range);
        }

        return null;
      },
    }),
  );
}

/**
 * 判断光标处的标识符指向哪个符号或引脚。
 * @param {import('../model').Model} model 文档模型。
 * @param {vscode.Position} position 光标位置。
 * @returns {Resolved|null} 解析结果。
 */
function resolveAt(model, position) {
  const line = model.scan.lines[position.line] || '';

  // 光标所在的整词：扫出这一行所有标识符词，取包住光标的那一个（词中间也算命中）。
  const wordPattern = /[\w\u4e00-\u9fff.-]+/g;
  let word = '';
  let wordStart = position.character;
  let wordEnd = position.character;
  let token;
  while ((token = wordPattern.exec(line)) !== null) {
    const start = token.index;
    const end = start + token[0].length;
    if (position.character >= start && position.character <= end) {
      word = token[0];
      wordStart = start;
      wordEnd = end;
      break;
    }
  }
  if (!word) return null;
  const range = new vscode.Range(position.line, wordStart, position.line, wordEnd);

  // 1) `节点:引脚` 形态——光标落在冒号右侧就是引脚名。
  const pinMatch = /([\w\u4e00-\u9fff.-]+):([\w.\u4e00-\u9fff-]+)/g;
  let found;
  while ((found = pinMatch.exec(line)) !== null) {
    const pinStart = found.index + found[1].length + 1;
    if (position.character >= pinStart && position.character <= pinStart + found[2].length) {
      const nodeId = found[1];
      const pinName = found[2];
      const pin = findPin(model, nodeId, pinName);
      if (pin) {
        return {
          kind: 'pin',
          symbol: model.scan.byId.get(nodeId) || { kind: 'node', id: nodeId, line: 1 },
          nodeId,
          display: `${nodeId}:${pinName}`,
          pinDetail: pin.detail,
          range,
        };
      }
    }
  }

  // 2) 引用形态：`nodes.foo` / `variables.bar` / `inputs.键`（名字可能带 `.output.state` 尾巴，
  //    逐段回退找最长能命中的声明，这样光标停在 `nodes.a.output.x` 的任意一段都能跳）。
  const refMatch = /(nodes|variables|inputs)\.([\w\u4e00-\u9fff.-]+)/g;
  while ((found = refMatch.exec(line)) !== null) {
    const refStart = found.index;
    const refEnd = refStart + found[0].length;
    if (position.character < refStart || position.character > refEnd) continue;
    const parts = found[2].split('.');
    for (let take = parts.length; take >= 1; take -= 1) {
      const candidate = `${found[1]}.${parts.slice(0, take).join('.')}`;
      const symbol = model.scan.idsByName.get(candidate)
        || model.scan.idsByName.get(parts[0])
        || model.scan.byId.get(parts[0]);
      if (symbol) return { kind: 'reference', symbol, range };
    }
  }

  // 3) 裸节点 id（边表里的源/目标）
  const symbol = model.scan.byId.get(word);
  if (symbol) return { kind: 'identifier', symbol, range };

  return null;
}

/**
 * 在节点的引脚表里找一个引脚（目标口与源口都找）。
 * @param {import('../model').Model} model 文档模型。
 * @param {string} nodeId 节点 id。
 * @param {string} pinName 引脚名。
 * @returns {{detail: string}|null} 命中返回引脚信息。
 */
function findPin(model, nodeId, pinName) {
  const pins = model.pinsByNode.get(nodeId);
  if (!pins) return null;
  const hit = pins.targets.find((pin) => pin.name === pinName)
    || pins.sources.find((pin) => pin.name === pinName);
  return hit || null;
}

/**
 * 统计一个节点在边表里的出入度。
 * @param {import('../model').Model} model 文档模型。
 * @param {string} nodeId 节点 id。
 * @returns {{in: number, out: number}} 出入度。
 */
function edgeDegree(model, nodeId) {
  let incoming = 0;
  let outgoing = 0;
  for (const edge of model.scan.edges) {
    if (edge.from === nodeId) outgoing += 1;
    if (edge.to === nodeId) incoming += 1;
  }
  return { in: incoming, out: outgoing };
}

/** Markdown 表格里的竖线要转义，否则用户写的显示名会把表格切断。 */
function escapeMarkdown(text) {
  return String(text).replace(/([\\|`*_{}[\]()#+\-.!])/g, '\\$1');
}

/**
 * @typedef {object} Resolved
 * @property {'pin'|'reference'|'identifier'} kind 命中的类型。
 * @property {any} symbol 命中的符号。
 * @property {vscode.Range} range 命中的文本区间。
 * @property {string} [nodeId] 引脚所属节点（仅 pin）。
 * @property {string} [display] 引脚显示名（仅 pin）。
 * @property {string} [pinDetail] 引脚说明（仅 pin）。
 */

module.exports = { register, resolveAt };
