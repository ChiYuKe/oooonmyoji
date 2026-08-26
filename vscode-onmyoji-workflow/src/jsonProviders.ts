/**
 * 智能 JSON 编辑：基于 vscode-json-languageservice 的补全/悬停/诊断，
 * 叠加针对本工作流格式的动态 schema（步骤 ID、Action、跳转目标、$ref、条件）。
 */
import * as vscode from 'vscode';
import { getLanguageService, LanguageService } from 'vscode-json-languageservice';
import * as lsp from 'vscode-languageserver-types';
import { Node, findNodeAtLocation, parseTree } from 'jsonc-parser';
import { ActionCatalog, ActionSpecInfo } from './catalog';
import {
  WorkflowInfo,
  buildWorkflowSchema,
  collectRefSuggestions,
  parseWorkflow,
  validateWorkflow,
} from './workflow';

const DOCUMENT_SCHEMA_URI = 'inmemory://onmyoji/workflow';

function globToRegExp(glob: string): RegExp {
  let pattern = '^';
  for (const part of glob.split('*')) {
    pattern += part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    pattern += '*';
  }
  pattern = pattern.replace(/\*{2,}/g, '.*').replace(/(?<!\.)\*/g, '[^/]*');
  pattern += '$';
  return new RegExp(pattern);
}

function toVscodeRange(range: lsp.Range): vscode.Range {
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

function toVscodeSeverity(severity: lsp.DiagnosticSeverity | undefined): vscode.DiagnosticSeverity {
  switch (severity) {
    case lsp.DiagnosticSeverity.Error:
      return vscode.DiagnosticSeverity.Error;
    case lsp.DiagnosticSeverity.Warning:
      return vscode.DiagnosticSeverity.Warning;
    case lsp.DiagnosticSeverity.Information:
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

/** vscode.TextDocument 与语言服务期望的 TextDocument 接口之间的适配器。 */
interface ServiceTextDocument {
  readonly uri: string;
  readonly languageId: string;
  readonly version: number;
  readonly lineCount: number;
  getText(range?: lsp.Range): string;
  positionAt(offset: number): lsp.Position;
  offsetAt(position: lsp.Position): number;
  getLineRange(line: number): lsp.Range;
  getEOLCharacters(line: number): string;
}

function toServiceDocument(doc: vscode.TextDocument): ServiceTextDocument {
  return {
    uri: doc.uri.toString(),
    languageId: doc.languageId,
    version: doc.version,
    lineCount: doc.lineCount,
    getText: (range) =>
      range ? doc.getText(new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character)) : doc.getText(),
    positionAt: (offset) => {
      const p = doc.positionAt(offset);
      return { line: p.line, character: p.character };
    },
    offsetAt: (position) => doc.offsetAt(new vscode.Position(position.line, position.character)),
    getLineRange: (line) => {
      const clamped = Math.max(0, Math.min(line, doc.lineCount - 1));
      return { start: { line, character: 0 }, end: { line, character: doc.lineAt(clamped).text.length } };
    },
    getEOLCharacters: (line) => (line < doc.lineCount ? (doc.eol === vscode.EndOfLine.LF ? '\n' : '\r\n') : ''),
  };
}

function toVscodeItem(item: lsp.CompletionItem): vscode.CompletionItem {
  const out = new vscode.CompletionItem(item.label, item.kind as vscode.CompletionItemKind);
  if (item.detail) out.detail = item.detail;
  if (item.sortText) out.sortText = item.sortText;
  if (item.filterText) out.filterText = item.filterText;
  if (item.preselect) out.preselect = true;
  if (item.documentation) {
    if (typeof item.documentation === 'string') {
      out.documentation = new vscode.MarkdownString(item.documentation);
    } else {
      out.documentation = new vscode.MarkdownString(item.documentation.value);
    }
  }
  if (item.textEdit) {
    if ('insert' in item.textEdit) {
      out.insertText = item.textEdit.newText;
      out.range = toVscodeRange(item.textEdit.insert);
    } else {
      out.insertText = item.textEdit.newText;
      out.range = toVscodeRange(item.textEdit.range);
    }
  } else if (typeof item.insertText === 'string') {
    out.insertText = item.insertText;
  }
  return out;
}

function deepestNode(node: Node, offset: number): Node | null {
  if (offset < node.offset || offset > node.offset + node.length) return null;
  let best: Node | null = node;
  for (const child of node.children ?? []) {
    const found = deepestNode(child, offset);
    if (found) best = found;
  }
  return best;
}

function nodeValue(node: Node): string {
  return typeof (node as { value?: string }).value === 'string' ? String((node as { value?: string }).value) : '';
}

function paramList(spec: ActionSpecInfo): string {
  const props = (spec.inputSchema.properties ?? {}) as Record<string, unknown>;
  const keys = Object.keys(props);
  if (keys.length === 0) return '无参数';
  const required = new Set<string>((spec.inputSchema.required as string[] | undefined) ?? []);
  return keys.map((k) => `${k}${required.has(k) ? '*' : ''}`).join(', ');
}

class DocumentSession {
  readonly service: LanguageService;
  private lastKey = '';

  constructor(readonly uri: string) {
    this.service = getLanguageService({});
  }

  configure(schema: Record<string, unknown>): void {
    const key = JSON.stringify(schema);
    if (key === this.lastKey) return;
    this.service.configure({
      schemas: [
        {
          uri: DOCUMENT_SCHEMA_URI,
          fileMatch: [this.uri],
          schema,
        },
      ],
    });
    this.lastKey = key;
  }
}

export class WorkflowIntelligence implements vscode.Disposable {
  private sessions = new Map<string, DocumentSession>();
  private diag = vscode.languages.createDiagnosticCollection('onmyoji');
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(private getCatalog: () => ActionCatalog) {
    this.disposables.push(this.diag);
  }

  private session(uri: string): DocumentSession {
    let existing = this.sessions.get(uri);
    if (!existing) {
      existing = new DocumentSession(uri);
      this.sessions.set(uri, existing);
    }
    return existing;
  }

  isWorkflowFile(uri: vscode.Uri): boolean {
    if (uri.scheme !== 'file') return false;
    const config = vscode.workspace.getConfiguration('onmyoji').get<string>('workflowFiles', '**/workflows/*.json');
    const path = uri.path;
    const defaultMatch = /\/workflows\/[^/]+\.json$/i.test(path);
    if (config === '**/workflows/*.json') return defaultMatch;
    return globToRegExp(config).test(path);
  }

  schemaFor(doc: vscode.TextDocument): { schema: Record<string, unknown>; info: WorkflowInfo; catalog: ActionCatalog } {
    const catalog = this.getCatalog();
    let raw: unknown = null;
    try {
      raw = JSON.parse(doc.getText());
    } catch {
      raw = null;
    }
    const info = parseWorkflow(raw);
    return { schema: buildWorkflowSchema(info, catalog), info, catalog };
  }

  registerProviders(): vscode.Disposable[] {
    const selector: vscode.DocumentSelector = { language: 'json', scheme: 'file' };
    return [
      vscode.languages.registerCompletionItemProvider(
        selector,
        {
          provideCompletionItems: async (document, position) => this.provideCompletion(document, position),
        },
        '"',
        ':',
        '{',
        '[',
      ),
      vscode.languages.registerHoverProvider(selector, {
        provideHover: (document, position) => this.provideHover(document, position),
      }),
      vscode.workspace.onDidChangeTextDocument((event) => this.scheduleRefresh(event.document)),
      vscode.workspace.onDidSaveTextDocument((document) => this.refreshDocument(document)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.sessions.delete(document.uri.toString());
        this.diag.delete(document.uri);
      }),
    ];
  }

  private async provideCompletion(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionList> {
    if (!this.isWorkflowFile(document.uri)) {
      return new vscode.CompletionList([], true);
    }
    const { schema, info, catalog } = this.schemaFor(document);
    const session = this.session(document.uri.toString());
    session.configure(schema);
    const serviceDoc = toServiceDocument(document);
    const jsonDoc = session.service.parseJSONDocument(serviceDoc);
    const result = await session.service.doComplete(serviceDoc, position, jsonDoc);
    const items: vscode.CompletionItem[] = [];
    if (result) {
      for (const item of result.items) {
        items.push(toVscodeItem(item));
      }
    }
    // $ref 路径补全：当正在输入 "$ref": "..." 时
    const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const match = /"\$ref"\s*:\s*"([^"]*)$/.exec(prefix);
    if (match) {
      const typed = match[1];
      const valueStartOffset = match.index + match[0].length - typed.length;
      const valueStart = document.positionAt(valueStartOffset);
      const replaceRange = new vscode.Range(valueStart, position);
      const suggestions = collectRefSuggestions(info, catalog);
      for (const refPath of [...suggestions.inputs, ...suggestions.steps]) {
        if (typed && !refPath.toLowerCase().includes(typed.toLowerCase())) continue;
        const item = new vscode.CompletionItem(refPath, vscode.CompletionItemKind.Reference);
        item.range = replaceRange;
        item.insertText = refPath;
        item.filterText = refPath;
        item.detail = refPath.startsWith('inputs.') ? '输入参数引用' : '步骤输出引用';
        item.documentation = new vscode.MarkdownString('结构化引用，引擎仅支持 `inputs.<字段>` 与 `steps.<步骤id>.output.<字段>`');
        items.push(item);
      }
    }
    return new vscode.CompletionList(items, result?.isIncomplete ?? false);
  }

  private async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    if (!this.isWorkflowFile(document.uri)) {
      return undefined;
    }
    const { schema, info, catalog } = this.schemaFor(document);
    const session = this.session(document.uri.toString());
    session.configure(schema);
    const offset = document.offsetAt(position);
    const tree = parseTree(document.getText());
    const node = tree ? deepestNode(tree, offset) : undefined;
    const custom = node ? customHover(node, catalog, info) : undefined;
    if (custom) return custom;
    const serviceDoc = toServiceDocument(document);
    const jsonDoc = session.service.parseJSONDocument(serviceDoc);
    const hover = await session.service.doHover(serviceDoc, position, jsonDoc);
    if (!hover) return undefined;
    const contents: vscode.MarkdownString[] = [];
    for (const content of hover.contents as lsp.MarkedString[]) {
      if (typeof content === 'string') {
        contents.push(new vscode.MarkdownString(content));
      } else if (content && typeof content === 'object' && 'value' in content) {
        contents.push(new vscode.MarkdownString(String((content as { value: string }).value)));
      }
    }
    return new vscode.Hover(contents, hover.range ? toVscodeRange(hover.range) : undefined);
  }

  refreshDocument(document: vscode.TextDocument): Promise<void> {
    if (!this.isWorkflowFile(document.uri)) return Promise.resolve();
    return this.computeDiagnostics(document);
  }

  private scheduleRefresh(document: vscode.TextDocument): void {
    if (!this.isWorkflowFile(document.uri)) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshDocument(document), 350);
  }

  private async computeDiagnostics(document: vscode.TextDocument): Promise<void> {
    const { schema, catalog } = this.schemaFor(document);
    const session = this.session(document.uri.toString());
    session.configure(schema);
    const serviceDoc = toServiceDocument(document);
    const jsonDoc = session.service.parseJSONDocument(serviceDoc);
    const text = document.getText();
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
    const [lsDiags, semantic] = await Promise.all([
      session.service.doValidation(serviceDoc, jsonDoc, undefined, schema),
      Promise.resolve(validateWorkflow(raw, catalog)),
    ]);
    const tree = parseTree(text);
    const out: vscode.Diagnostic[] = [];
    for (const d of lsDiags) {
      const message = typeof d.message === 'string' ? d.message : d.message.value;
      const diag = new vscode.Diagnostic(toVscodeRange(d.range), message, toVscodeSeverity(d.severity));
      diag.source = 'onmyoji';
      if (typeof d.code === 'string' || typeof d.code === 'number') diag.code = String(d.code);
      out.push(diag);
    }
    for (const issue of semantic) {
      const node = issue.path.length > 0 && tree ? findNodeAtLocation(tree, issue.path) : tree;
      const range = node
        ? new vscode.Range(document.positionAt(node.offset), document.positionAt(node.offset + node.length))
        : new vscode.Range(0, 0, 0, 1);
      const diag = new vscode.Diagnostic(
        range,
        issue.message,
        issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
      );
      diag.source = 'onmyoji';
      diag.code = issue.code;
      out.push(diag);
    }
    this.diag.set(document.uri, out);
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const d of this.disposables) d.dispose();
    this.sessions.clear();
  }
}

function customHover(node: Node, catalog: ActionCatalog, info: WorkflowInfo): vscode.Hover | undefined {
  if (node.type !== 'string') return undefined;
  const value = nodeValue(node);
  if (!value) return undefined;
  const parent = node.parent;
  const keyOfParent = parent && parent.type === 'property' ? String((parent.children?.[0] as { value?: string } | undefined)?.value ?? '') : '';

  if (keyOfParent === 'action') {
    const spec = catalog.byName(value);
    if (!spec) return undefined;
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${spec.name}** · v${spec.version} · ${spec.source === 'builtin' ? '内置' : '自定义'}\n\n`);
    md.appendMarkdown(`${spec.description}\n\n`);
    md.appendMarkdown(`- 重试安全: ${spec.retrySafe ? '是' : '否'}，有副作用: ${spec.sideEffect ? '是' : '否'}\n`);
    md.appendMarkdown(`- 参数: \`${paramList(spec)}\``);
    return new vscode.Hover(md);
  }

  if (keyOfParent === '$ref' || value.startsWith('inputs.') || value.startsWith('steps.')) {
    const parts = value.split('.');
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**结构化引用** \`${value}\`\n\n`);
    if (parts[0] === 'inputs') {
      const propName = parts[1] ?? '';
      const props = (info.inputsSchema?.properties ?? {}) as Record<string, unknown>;
      const prop = props[propName] as Record<string, unknown> | undefined;
      if (prop) {
        const type = String(prop.type ?? 'any');
        const def = prop.default !== undefined ? JSON.stringify(prop.default) : undefined;
        const desc = typeof prop.description === 'string' ? prop.description : undefined;
        md.appendMarkdown(`输入参数 \`${propName}\`（${type}${def !== undefined ? `，默认 ${def}` : ''}）`);
        if (desc) md.appendMarkdown(`\n\n${desc}`);
      } else {
        md.appendMarkdown('引用 `inputs_schema` 中未声明的字段（引擎仍允许，但建议补全声明）');
      }
    } else if (parts[0] === 'steps' && parts[2] === 'output') {
      const stepId = parts[1] ?? '';
      const step = info.steps.find((s) => s.id === stepId);
      if (step) {
        const spec = step.action ? catalog.byName(step.action) : undefined;
        md.appendMarkdown(`步骤 \`${stepId}\` 的输出（Action: \`${step.action}\`）`);
        if (spec && spec.outputFields.length > 0) {
          md.appendMarkdown(`\n\n可用输出字段: \`${spec.outputFields.join('`、`')}\``);
        }
      } else {
        md.appendMarkdown(`未知步骤 \`${stepId}\``);
      }
    }
    return new vscode.Hover(md);
  }

  return undefined;
}
