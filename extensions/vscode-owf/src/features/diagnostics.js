/**
 * 解析诊断：用**与桌面端/CLI 同一份解析器**校验 `.owf`，把语法错误标进编辑器。
 *
 * 定位口径直接来自解析器的 `DslError`（行、列、原文行、提示），所以插件里看到的位置
 * 与 `python -m src.oooonmyoji.cli validate` 打印的 `文件:行:列` 完全一致。
 *
 * 只报**解析期**的错误：引脚合法性、一父多子、成环这些是图语义错误，由运行时/编译器
 * 负责（见 docs/workflow-dsl-v6.md「错误定位」一节）。插件刻意不重复实现它们，否则
 * 就会多出一份会漂的口径。
 */
'use strict';

const vscode = require('vscode');
const parser = require('../parser');

/** 触发重新校验的配置键。 */
const CONFIG_KEYS = ['owf.diagnostics.enabled', 'owf.diagnostics.debounceMs'];

/**
 * 注册 `.owf` 的解析诊断。
 * @param {vscode.ExtensionContext} context 扩展上下文。
 * @returns {void}
 */
function register(context) {
  const collection = vscode.languages.createDiagnosticCollection('owf');
  context.subscriptions.push(collection);

  /** 每个文档一个定时器，避免大文件每次按键都全量解析。 */
  const timers = new Map();

  /**
   * 立刻校验一个文档。
   * @param {vscode.TextDocument} document 目标文档。
   */
  const validate = (document) => {
    timers.delete(document.uri.toString());
    if (document.languageId !== 'owf') return;
    if (!vscode.workspace.getConfiguration('owf').get('diagnostics.enabled', true)) {
      collection.delete(document.uri);
      return;
    }

    const result = parser.tryParse(document.getText(), document.fileName || '工作流.owf');
    if (result.ok) {
      collection.delete(document.uri);
      return;
    }

    // 解析器给的是 1 基行列；VSCode 的 Position 是 0 基，且行尾要夹在文档范围内。
    const lineIndex = Math.min(Math.max(result.line - 1, 0), Math.max(document.lineCount - 1, 0));
    const lineText = document.lineAt(lineIndex).text;
    const startColumn = Math.min(Math.max(result.column - 1, 0), lineText.length);
    const endColumn = Math.max(lineText.length, startColumn);
    const range = new vscode.Range(lineIndex, startColumn, lineIndex, endColumn);

    const diagnostic = new vscode.Diagnostic(
      range,
      result.hint ? `${result.message}（提示：${result.hint}）` : result.message,
      vscode.DiagnosticSeverity.Error,
    );
    diagnostic.source = 'owf';
    diagnostic.code = 'owf-parse';
    // 原文行与插入符一并放进 relatedInformation，悬停时能与 CLI 输出对照。
    if (result.source !== null) {
      diagnostic.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(document.uri, range),
          `原文：${result.source}`,
        ),
      ];
    }
    collection.set(document.uri, [diagnostic]);
  };

  /**
   * 延迟校验（默认 300ms）；`document` 已关闭时跳过。
   * @param {vscode.TextDocument} document 目标文档。
   */
  const schedule = (document) => {
    const key = document.uri.toString();
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);

    const delay = vscode.workspace.getConfiguration('owf').get('diagnostics.debounceMs', 300);
    if (!delay) {
      validate(document);
      return;
    }
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      // 定时器回调可能在文档关闭后才跑到，这里再确认一次。
      const live = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === key);
      if (live) validate(live);
    }, delay));
  };

  for (const document of vscode.workspace.textDocuments) validate(document);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      const timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key);
      collection.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!CONFIG_KEYS.some((key) => event.affectsConfiguration(key))) return;
      for (const document of vscode.workspace.textDocuments) validate(document);
    }),
    // 保存时立刻复查一次，不等防抖，避免「刚存盘就切窗口」看到旧诊断。
    vscode.workspace.onDidSaveTextDocument(validate),
    new vscode.Disposable(() => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    }),
  );
}

module.exports = { register };
