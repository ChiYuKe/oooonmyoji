/** 独立工作流结构树窗口：以树状层级展示某个工作流的节点结构，点击节点定位到编辑器。 */

import * as path from 'path';
import * as vscode from 'vscode';
import { TreeNodePayload, WorkflowFileDescriptor, buildTreeNode } from './workflow';
import { WebviewManager } from './webviewManager';

interface WebviewPayload {
  type: string;
  [key: string]: unknown;
}

interface StatePayload {
  workflows: WorkflowFileDescriptor[];
  currentUri: string;
  currentName: string;
  nodes: TreeNodePayload[];
}

export class WorkflowTreeManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private currentUri: string | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private getProjectRoot: () => string,
    private webviewManager: WebviewManager,
  ) {}

  /** 打开结构树窗口；`uri` 指定初始展示的工作流（缺省选中第一项）。 */
  async open(preserveFocus = false, uri?: string): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, preserveFocus);
      if (uri) this.currentUri = uri;
      await this.pushState();
      return;
    }
    if (uri) this.currentUri = uri;
    this.panel = vscode.window.createWebviewPanel(
      'onmyojiWorkflowTree',
      'Onmyoji 工作流结构',
      vscode.ViewColumn.Beside,
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
        this.disposePanelSubscriptions();
      }),
    );
  }

  private async onMessage(message: WebviewPayload): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.pushState();
        break;
      case 'switchWorkflow': {
        const uri = String(message.uri ?? '');
        if (uri) this.currentUri = uri;
        await this.pushState();
        break;
      }
      case 'refresh':
        await this.pushState();
        break;
      case 'focusNode': {
        // 在编辑器里打开（或切换到）该工作流，并定位选中指定节点。
        const uri = String(message.uri ?? '');
        const nodeId = String(message.nodeId ?? '');
        const target = uri ? vscode.Uri.parse(uri) : undefined;
        if (target && this.webviewManager.currentUri?.toString() !== uri) {
          await this.webviewManager.open(target);
        } else if (!target && !this.webviewManager.currentUri) {
          await this.webviewManager.open();
        }
        await this.webviewManager.executeEditorCommand('focusNode', nodeId);
        break;
      }
      default:
        break;
    }
  }

  private async pushState(): Promise<void> {
    if (!this.panel) return;
    const state = await this.computeState();
    await this.panel.webview.postMessage({ type: 'init', ...state });
  }

  /** 枚举项目内所有工作流文件，供工具栏下拉框使用。 */
  private async listWorkflowFiles(): Promise<WorkflowFileDescriptor[]> {
    const pattern = vscode.workspace.getConfiguration('onmyoji').get<string>('workflowFiles', '**/workflows/**/*.json');
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 200);
    return files
      .map((f) => ({ uri: f.toString(), name: path.basename(f.fsPath), rel: vscode.workspace.asRelativePath(f) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.rel.localeCompare(b.rel, 'zh-CN'));
  }

  private async computeState(): Promise<StatePayload> {
    const files = await this.listWorkflowFiles();
    const empty: StatePayload = { workflows: files, currentUri: '', currentName: '', nodes: [] };
    const current = files.find((file) => file.uri === this.currentUri) ?? files[0];
    if (!current) return empty;
    let raw: unknown = null;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(current.uri));
      raw = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      raw = null;
    }
    return { workflows: files, currentUri: current.uri, currentName: current.rel, nodes: buildTreeNode(raw) };
  }

  private buildHtml(webview: vscode.Webview): string {
    const media = vscode.Uri.file(path.join(this.context.extensionPath, 'media'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'workflow-tree.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'workflow-tree.js'));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<title>Onmyoji 工作流结构</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<header id="topbar">
  <div class="identity"><span class="mark">TREE</span><div><div id="workflow-name">尚未选择</div><div id="workflow-path"></div></div></div>
  <label class="picker">
    <select id="workflow-select" aria-label="工作流"></select>
  </label>
  <div class="spacer"></div>
  <button id="btn-collapse" class="icon-button" title="收起全部" aria-label="收起全部"></button>
  <button id="btn-expand" class="icon-button" title="展开全部" aria-label="展开全部"></button>
  <button id="btn-refresh" class="icon-button" title="重新读取结构" aria-label="重新读取结构">⟳</button>
</header>
<main>
  <div id="empty-state" class="hidden">未找到工作流文件</div>
  <div id="tree"></div>
</main>
<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  private disposePanelSubscriptions(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposePanelSubscriptions();
  }
}

/** 把工作流 JSON 递归构建为树；实现见 workflow.buildTreeNode。 */

function getNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return value;
}
