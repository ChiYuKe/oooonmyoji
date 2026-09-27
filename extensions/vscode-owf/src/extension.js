/**
 * 扩展入口：把「文本辅助」这一组能力装到 `.owf` 上。
 *
 * 设计边界（与用户选定的方案一致）：**不做图形视图**。`.owf` 是给人读写的文本格式，
 * 画布在桌面端（`desktop/`）；插件负责让 VS Code 里的文本更好读写——
 * 语义着色、解析诊断、结构大纲、引用跳转/悬停、引脚补全，外加一个把边表摊开成
 * 执行顺序的结构树命令。
 *
 * 解析层直接复用 `desktop/src/shared/workflow/graph-dsl.ts` 的打包产物
 * （`lib/graph-dsl.cjs`），所以诊断口径、表达式规范化、报错文案与桌面端/CLI 逐字一致；
 * 插件里没有任何一份「另一套语法」。
 */
'use strict';

const vscode = require('vscode');
const { modelFor, clear } = require('./model');
const { documentSymbols } = require('./symbols');
const diagnostics = require('./features/diagnostics');
const completions = require('./features/completions');
const navigation = require('./features/navigation');
const structureTree = require('./features/structureTree');

/**
 * 激活扩展。
 * @param {vscode.ExtensionContext} context 扩展上下文。
 * @returns {void}
 */
function activate(context) {
  // 1) 文档大纲（资源管理器里的「大纲」视图 / `Ctrl+Shift+O`）
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(
    { language: 'owf' },
    {
      /**
       * @param {vscode.TextDocument} document
       * @returns {vscode.DocumentSymbol[]}
       */
      provideDocumentSymbols(document) {
        const model = modelFor(document);
        const showVariables = vscode.workspace.getConfiguration('owf').get('outline.showVariables', true);
        return documentSymbols(model, { showVariables });
      },
    },
    { label: 'OWF 工作流' },
  ));

  // 2) 悬停 / 跳转定义 / 补全
  navigation.register(context);
  completions.register(context);

  // 3) 解析诊断（与 CLI 同源）
  diagnostics.register(context);

  // 4) 结构树 / 布局复制命令
  structureTree.register(context);

  // 5) 影响大纲内容的配置变化后丢弃模型缓存，保证下次读取重算
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('owf.outline')) clear();
  }));
}

/** 反激活：无需额外清理（订阅都挂在 context.subscriptions 上）。 */
function deactivate() {
  clear();
}

module.exports = { activate, deactivate };
