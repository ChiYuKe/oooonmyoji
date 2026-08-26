/**
 * 可视化流程图编辑器（Webview）管理：面板生命周期、消息协议、文件读写。
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { ActionCatalog } from './catalog';
import { WorkflowIntelligence } from './jsonProviders';
import { collectRefSuggestions, parseWorkflow, validateWorkflow } from './workflow';

interface WebviewPayload {
  type: string;
  [key: string]: unknown;
}

export class WebviewManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private docUri: vscode.Uri | undefined;
  private dirty = false;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private intelligence: WorkflowIntelligence,
    private getCatalog: () => ActionCatalog,
    private getProjectRoot: () => string,
  ) {}

  async open(preferred?: vscode.Uri): Promise<void> {
    let uri = preferred;
    if (!uri) {
      uri = await this.pickWorkflow();
    }
    if (!uri) return;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'onmyojiWorkflow',
        'Onmyoji 工作流编辑器',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))],
        },
      );
      this.panel.webview.html = this.buildHtml(this.panel.webview);
      this.disposables.push(
        this.panel.webview.onDidReceiveMessage((message: WebviewPayload) => void this.onMessage(message)),
        this.panel.onDidDispose(() => {
          this.panel = undefined;
          this.docUri = undefined;
          this.disposePanelSubscriptions();
        }),
      );
    }
    this.docUri = uri;
    this.dirty = false;
    await this.sendInit();
  }

  private disposePanelSubscriptions(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  /** 工作流文件在磁盘/编辑器中被修改时由 extension 调用。 */
  async notifyExternalChange(uri: vscode.Uri): Promise<void> {
    if (!this.panel || !this.docUri || this.docUri.toString() !== uri.toString()) return;
    if (this.dirty) {
      this.panel.webview.postMessage({ type: 'externalChange', notice: 'JSON 已在外部修改；保存或重新加载以同步' });
      return;
    }
    await this.sendInit();
  }

  private async pickWorkflow(): Promise<vscode.Uri | undefined> {
    const pattern = vscode.workspace.getConfiguration('onmyoji').get<string>('workflowFiles', '**/workflows/*.json');
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 200);
    if (files.length === 0) {
      vscode.window.showInformationMessage('未找到工作流 JSON 文件（默认匹配 **/workflows/*.json）。');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      files.map((f) => ({ label: path.basename(f.fsPath), description: vscode.workspace.asRelativePath(f), uri: f })),
      { placeHolder: '选择要编辑的工作流' },
    );
    return picked?.uri;
  }

  private buildHtml(webview: vscode.Webview): string {
    const media = vscode.Uri.file(path.join(this.context.extensionPath, 'media'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'workflow-editor.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'workflow-editor.js'));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<title>Onmyoji 工作流编辑器</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<header id="topbar">
  <span id="file-label" title=""></span>
  <span id="dirty-badge" class="badge hidden">未保存</span>
  <span id="issue-badge" class="badge"></span>
  <span class="spacer"></span>
  <button id="btn-open" title="在编辑器里打开 JSON 文件">打开 JSON</button>
  <button id="btn-reload" title="丢弃未保存修改，重新从文件加载">重新加载</button>
  <button id="btn-add" class="primary" title="新增一个步骤节点">＋ 新增步骤</button>
  <button id="btn-save" class="primary" title="把当前模型写回 JSON 文件">保存到 JSON</button>
</header>
<div id="external-banner" class="hidden"></div>
<main>
  <section id="canvas-wrap">
    <div id="canvas-scroll">
      <svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg>
    </div>
    <div id="legend">
      <span class="lg lg-ok">成功</span><span class="lg lg-err">失败</span><span class="lg lg-skip">跳过</span><span class="lg lg-fall">默认跳转</span>
      <span class="hint">滚轮缩放 · 拖拽平移 · 拖节点摆位 · 从节点底部 ⚪ 拖到目标连线（默认成功，Shift=失败，Alt=跳过）· 悬停连线点 ✕ 删除</span>
    </div>
  </section>
  <aside id="inspector">
    <div id="inspector-empty">点击左侧节点查看/编辑；或点击「＋ 新增步骤」。</div>
    <div id="inspector-body" class="hidden"></div>
  </aside>
</main>
<div id="toast" class="hidden"></div>
<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private async sendInit(): Promise<void> {
    if (!this.panel || !this.docUri) return;
    const doc = await vscode.workspace.openTextDocument(this.docUri);
    const text = doc.getText();
    const catalog = this.getCatalog();
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
    const info = parseWorkflow(raw);
    const refs = collectRefSuggestions(info, catalog);
    const issues = validateWorkflow(raw, catalog).map((i) => ({ path: i.path, message: i.message, severity: i.severity, code: i.code }));
    await this.panel.webview.postMessage({
      type: 'init',
      document: { uri: this.docUri.toString(), name: path.basename(this.docUri.fsPath), text },
      catalog: catalog.all(),
      refs,
      issues,
      projectRoot: this.getProjectRoot(),
    });
  }

  private async onMessage(message: WebviewPayload): Promise<void> {
    if (!this.panel) return;
    switch (message.type) {
      case 'ready':
        await this.sendInit();
        break;
      case 'reloadRequest':
        this.dirty = false;
        await this.sendInit();
        break;
      case 'save': {
        if (!this.docUri) return;
        const text = String(message.text ?? '');
        await vscode.workspace.fs.writeFile(this.docUri, Buffer.from(text, 'utf8'));
        this.dirty = false;
        const doc = await vscode.workspace.openTextDocument(this.docUri);
        this.intelligence.refreshDocument(doc);
        if (doc.isDirty) {
          // 如果用户在编辑器里打开了同一文件，尝试用工作区文档同步写入
          const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === this.docUri?.toString());
          if (editor) {
            const edit = new vscode.WorkspaceEdit();
            const full = new vscode.Range(0, 0, editor.document.lineCount, 0);
            edit.replace(this.docUri, full, text);
            await vscode.workspace.applyEdit(edit);
          }
        }
        vscode.window.setStatusBarMessage('工作流已保存', 3000);
        break;
      }
      case 'openFile':
        if (this.docUri) {
          const doc = await vscode.workspace.openTextDocument(this.docUri);
          await vscode.window.showTextDocument(doc, { preview: false });
        }
        break;
      case 'error':
        vscode.window.showErrorMessage(`Onmyoji 工作流编辑器：${String(message.message ?? '')}`);
        break;
      default:
        break;
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposePanelSubscriptions();
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
