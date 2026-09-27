/**
 * 补全：只补「格式里有确定答案」的三种位置，不做语义猜测。
 *
 * 1. 行首 2 空格网格上补结构关键字与常用文档键；
 * 2. 边表里 `->` 之后补节点 id（源与目标都是节点 id）；
 * 3. 边表里 `目标:<引脚>` 补目标引脚、`源:<引脚>` 补源引脚。
 *
 * 引脚名的来源见 `symbols.targetPinsOf`：只给「参数名 + 该节点类型的特殊口」，
 * 拿不准的一律不列——列出错误引脚比不补全更糟。
 */
'use strict';

const vscode = require('vscode');
const { modelFor } = require('../model');

/** 行首结构关键字（按出现频率排序，常用的排前面）。 */
const STRUCTURE_KEYWORDS = [
  { label: 'node', detail: '节点块：node <id> <type> ["显示名"]' },
  { label: 'edges', detail: '顶层边表：源[:引脚] -> 目标[:引脚]' },
  { label: 'var', detail: '变量节点：var <scope>.<key>' },
  { label: 'group', detail: '节点组：group <id> ["标题"]' },
  { label: 'comment', detail: '注释框：comment <id> ["标题"]' },
  { label: 'decorator', detail: '装饰器：decorator <类型>' },
];

/** 文档级键（缩进 2 空格那一层最常用）。 */
const DOCUMENT_KEYS = [
  { label: 'version', detail: '必需，文档版本' },
  { label: 'description', detail: '文档说明' },
  { label: 'resolution', detail: '必需，[宽, 高]' },
  { label: 'root', detail: '必需，根节点 id' },
  { label: 'retry_safe', detail: '可选，true / false' },
  { label: 'limits', detail: '可选块，如 timeout_seconds / max_steps' },
  { label: 'inputs', detail: '输入表' },
  { label: 'variables', detail: '变量表' },
  { label: 'nodeTypes', detail: '自定义节点类型（x-…）' },
];

/** 节点块内的字段关键字。 */
const NODE_KEYS = [
  { label: 'at', detail: '坐标 [x, y]' },
  { label: 'size', detail: '尺寸 [w, h]' },
  { label: 'locked', detail: '锁定位置 true / false' },
  { label: 'comment', detail: '节点备注' },
  { label: 'action', detail: 'task 的动作名' },
  { label: 'params', detail: '参数块' },
  { label: 'expression', detail: '表达式（condition / bool_judge / switch）' },
  { label: 'condition', detail: '表达式（repeat_until）' },
  { label: 'conditions', detail: '表达式列表（branch）' },
  { label: 'cases', detail: '分支取值（switch）' },
  { label: 'runs', detail: '并行实例（instance_parallel）' },
  { label: 'wait_for', detail: 'all / any' },
  { label: 'cancel_on_failure', detail: 'true / false' },
  { label: 'finish_mode', detail: 'abort_background / wait_for_background' },
  { label: 'max_iterations', detail: '最大迭代次数' },
  { label: 'ref', detail: 'break 的结果引用' },
  { label: 'fields', detail: '拆分卡片的字段名' },
];

/**
 * 注册补全提供器。
 * @param {vscode.ExtensionContext} context 扩展上下文。
 * @returns {void}
 */
function register(context) {
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
    { language: 'owf' },
    {
      /**
       * @param {vscode.TextDocument} document
       * @param {vscode.Position} position
       * @returns {vscode.CompletionItem[]}
       */
      provideCompletionItems(document, position) {
        const model = modelFor(document);
        const lineText = document.lineAt(position.line).text;
        const before = lineText.slice(0, position.character);

        // 位置 3：边表引脚——`节点:引脚`。
        // 两个分支的区别是「行首」与「空白之后」：`^` 不消耗字符，所以要用
        // `match[0]` 的**内容**（节点名 + 冒号 + 已输入引脚）来算引脚的真实位置，
        // 不能假设匹配串前面一定有一个空格。
        const afterColon = /(?:^|\s)([\w\u4e00-\u9fff.-]+):([\w.\u4e00-\u9fff-]*)$/.exec(lineText.slice(0, position.character));
        if (afterColon && isEdgeContext(document, position.line)) {
          const nodeId = afterColon[1];
          const pins = model.pinsByNode.get(nodeId);
          if (pins) {
            // 引脚在 `->` 左边就是源引脚，在右边就是目标引脚；还没写 `->` 时按目标补。
            // 这里必须拿**整行**找 `->`：光标可能停在 `->` 左边（正在写源引脚），
            // 只看光标之前的文本会找不到箭头，于是把源引脚错当成目标引脚。
            const pinAt = position.character - afterColon[2].length;
            const arrowIndex = lineText.indexOf('->');
            const isSourcePin = arrowIndex >= 0 && pinAt < arrowIndex;
            const list = isSourcePin ? pins.sources : pins.targets;
            return list.map((pin) => {
              const item = new vscode.CompletionItem(pin.name, vscode.CompletionItemKind.Field);
              item.detail = pin.detail;
              item.documentation = new vscode.MarkdownString(`引脚 \`${nodeId}:${pin.name}\``);
              return item;
            });
          }
        }

        // 位置 2：`->` 之后补节点 id（源与目标都可能是节点）
        if (/->\s*[\w\u4e00-\u9fff.-]*$/.test(before)) {
          return model.scan.nodes.map((node) => {
            const item = new vscode.CompletionItem(node.id, vscode.CompletionItemKind.Reference);
            item.detail = node.label ? `${node.type} · ${node.label}` : node.type;
            item.documentation = new vscode.MarkdownString(`第 ${node.line} 行的 \`${node.type}\` 节点`);
            return item;
          });
        }

        const indent = /^[ \t]*/.exec(before)[0].length;
        const body = before.trim();

        // 位置 1：行首结构关键字 / 文档键 / 节点字段（只在这三种「键位」补全）
        if (body === '' || /^[A-Za-z_\u4e00-\u9fff-]*$/.test(body)) {
          const items = [];
          if (indent === 0 && !/:\s*$/.test(lineText)) {
            items.push(...toItems(STRUCTURE_KEYWORDS, vscode.CompletionItemKind.Keyword));
          }
          if (indent === 2) {
            items.push(...toItems(DOCUMENT_KEYS, vscode.CompletionItemKind.Property));
          }
          if (indent >= 4) {
            items.push(...toItems(NODE_KEYS, vscode.CompletionItemKind.Property));
          }
          return items;
        }

        return [];
      },
    },
    '>', ':', ' ', '\n',
  ));
}

/**
 * 判断某行是不是边表行（在 `edges:` 块内，或本身就是 `a -> b` 形态）。
 * @param {vscode.TextDocument} document 文档。
 * @param {number} line 0 基行号。
 * @returns {boolean} 是边表行返回 true。
 */
function isEdgeContext(document, line) {
  const current = document.lineAt(line).text;
  if (/->/.test(current)) return true;
  // 往上找第一条非空、非注释行；若它是边表行或 `edges:` 块头，说明我们在边表里。
  for (let index = line - 1; index >= 0; index -= 1) {
    const text = document.lineAt(index).text;
    if (/^\s*(?:#.*)?$/.test(text)) continue;
    if (/^\s*edges\s*:/.test(text)) return true;
    return /->/.test(text);
  }
  return false;
}

/**
 * 把补全描述转成 `CompletionItem`。
 * @param {Array<{label: string, detail: string}>} entries 描述表。
 * @param {vscode.CompletionItemKind} kind 补全种类。
 * @returns {vscode.CompletionItem[]} 补全项。
 */
function toItems(entries, kind) {
  return entries.map((entry) => {
    const item = new vscode.CompletionItem(entry.label, kind);
    item.detail = entry.detail;
    return item;
  });
}

module.exports = { register };
