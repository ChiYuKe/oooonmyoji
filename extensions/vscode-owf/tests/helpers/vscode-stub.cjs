/**
 * 测试用的 `vscode` 模块替身。
 *
 * 扩展源码里只有 `require('vscode')` 这一处外部依赖，而 `vscode` 只能由 VS Code 宿主
 * 注入。这里提供一个**只实现被用到的那几个类**的替身，让「纯逻辑」部分（大纲结构、
 * 引脚推导、引用解析、结构树渲染）能在 `node --test` 里直接验收——不需要启动编辑器，
 * 也不需要 `@vscode/test-electron` 那种重量级夹具。
 *
 * 替身的实现刻意保持「笨」：`Range` 只存四个数，`DocumentSymbol` 只存字段。任何依赖
 * 编辑器真实行为的断言都应该放到集成测试里，而不是在这里假装通过。
 */
'use strict';

/** 与 vscode.Position 同形的最小实现。 */
class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

/** 与 vscode.Range 同形的最小实现。 */
class Range {
  constructor(startLine, startCharacter, endLine, endCharacter) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }
}

/** 与 vscode.DocumentSymbol 同形的最小实现。 */
class DocumentSymbol {
  constructor(name, detail, kind, range, selectionRange) {
    this.name = name;
    this.detail = detail;
    this.kind = kind;
    this.range = range;
    this.selectionRange = selectionRange;
    this.children = [];
  }
}

/** 与 vscode.MarkdownString 同形的最小实现：只累积文本，供断言包含关系。 */
class MarkdownString {
  constructor(value = '') {
    this.value = value;
    this.supportThemeIcons = false;
  }

  appendMarkdown(text) {
    this.value += text;
    return this;
  }
}

/** 与 vscode.Hover 同形的最小实现。 */
class Hover {
  constructor(contents, range) {
    this.contents = contents;
    this.range = range;
  }
}

/** 与 vscode.Location 同形的最小实现。 */
class Location {
  constructor(uri, range) {
    this.uri = uri;
    this.range = range;
  }
}

module.exports = {
  Position,
  Range,
  DocumentSymbol,
  MarkdownString,
  Hover,
  Location,
  SymbolKind: {
    Module: 1,
    Namespace: 2,
    Function: 12,
    Constructor: 9,
    Variable: 13,
    Object: 19,
    Property: 7,
    Constant: 21,
    Class: 5,
    String: 15,
    Event: 24,
    Field: 8,
    Reference: 18,
    Keyword: 14,
  },
  CompletionItemKind: { Field: 5, Reference: 18, Keyword: 14, Property: 10 },
  CompletionItem: class CompletionItem {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
    }
  },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Diagnostic: class Diagnostic {
    constructor(range, message, severity) {
      this.range = range;
      this.message = message;
      this.severity = severity;
    }
  },
  DiagnosticRelatedInformation: class DiagnosticRelatedInformation {
    constructor(location, message) {
      this.location = location;
      this.message = message;
    }
  },
  TextEditorRevealType: { InCenter: 2 },
  Selection: class Selection extends Range {},
  languages: {
    // 记录最后注册的提供器，测试可以像宿主一样直接调用它们（而不是只断言「注册过」）。
    registered: { completion: null, definition: null, hover: null, documentSymbol: null },
    createDiagnosticCollection: () => ({ set() {}, delete() {}, dispose() {} }),
    registerCompletionItemProvider: (_selector, provider) => {
      module.exports.languages.registered.completion = provider;
      return { dispose() {} };
    },
    registerDefinitionProvider: (_selector, provider) => {
      module.exports.languages.registered.definition = provider;
      return { dispose() {} };
    },
    registerHoverProvider: (_selector, provider) => {
      module.exports.languages.registered.hover = provider;
      return { dispose() {} };
    },
    registerDocumentSymbolProvider: (_selector, provider) => {
      module.exports.languages.registered.documentSymbol = provider;
      return { dispose() {} };
    },
  },
  workspace: {
    textDocuments: [],
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    onDidOpenTextDocument: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidSaveTextDocument: () => ({ dispose() {} }),
  },
  window: {
    createOutputChannel: () => ({ appendLine() {}, clear() {}, show() {}, dispose() {} }),
    showWarningMessage: () => Promise.resolve(undefined),
    showErrorMessage: () => Promise.resolve(undefined),
    showInformationMessage: () => Promise.resolve(undefined),
    activeTextEditor: undefined,
  },
  commands: { registerCommand: () => ({ dispose() {} }) },
  env: { clipboard: { writeText: () => Promise.resolve() } },
  Disposable: class Disposable {
    constructor(fn) {
      this.dispose = fn;
    }
  },
  Uri: { file: (path) => ({ fsPath: path, toString: () => `file://${path}` }) },
};
