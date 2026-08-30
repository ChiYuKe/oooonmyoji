import * as path from 'path';
import * as vscode from 'vscode';

type RunState = 'idle' | 'running' | 'stopping' | 'success' | 'error';

interface SidebarMessage {
  type: string;
  rounds?: unknown;
  command?: unknown;
  value?: unknown;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'onmyoji.controlPanel';

  private view: vscode.WebviewView | undefined;
  private state: RunState = 'idle';
  private detail = '就绪';

  constructor(private context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const webview = view.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))],
    };
    webview.html = this.buildHtml(webview);
    webview.onDidReceiveMessage((message: SidebarMessage) => void this.onMessage(message), undefined, this.context.subscriptions);
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    }, undefined, this.context.subscriptions);
  }

  setRunState(state: RunState, detail: string): void {
    this.state = state;
    this.detail = detail;
    this.postState();
  }

  private postState(): void {
    if (!this.view) return;
    const rounds = vscode.workspace.getConfiguration('onmyoji').get<number>('partySoulsRounds', 9999);
    void this.view.webview.postMessage({ type: 'state', state: this.state, detail: this.detail, rounds });
  }

  private async onMessage(message: SidebarMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.postState();
        break;
      case 'runPartySouls': {
        const rounds = Number(message.rounds);
        await vscode.commands.executeCommand('onmyoji.runPartySouls', rounds === 1 ? 1 : 9999);
        break;
      }
      case 'stopWorkflow':
        await vscode.commands.executeCommand('onmyoji.stopWorkflow');
        break;
      case 'openWorkflowEditor':
        await vscode.commands.executeCommand('onmyoji.openWorkflowEditor');
        break;
      case 'openRunLog':
        await vscode.commands.executeCommand('onmyoji.openRunLog');
        break;
      case 'openWorkflowReferences':
        await vscode.commands.executeCommand('onmyoji.openWorkflowReferences');
        break;
      case 'openWorkflowTree':
        await vscode.commands.executeCommand('onmyoji.openWorkflowTree');
        break;
      case 'runEngineValidate':
        await vscode.commands.executeCommand('onmyoji.runEngineValidate');
        break;
      case 'editorCommand':
        await vscode.commands.executeCommand('onmyoji.editorCommand', String(message.command ?? ''), message.value);
        break;
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const media = vscode.Uri.file(path.join(this.context.extensionPath, 'media'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.js'));
    const nonce = getNonce();
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>Onmyoji 控制台</title>
</head>
<body>
  <main>
    <header class="product-header">
      <span class="product-mark" aria-hidden="true">O</span>
      <div><h1>Onmyoji</h1><div class="subtitle">自动化控制</div></div>
    </header>

    <section aria-labelledby="party-heading">
      <h2 id="party-heading">组队御魂</h2>
      <div class="instance-row"><span>队长</span><strong>mumu-0</strong></div>
      <div class="instance-row"><span>队员</span><strong>mumu-1</strong></div>
      <label class="field" for="rounds"><span>运行场数</span>
        <select id="rounds"><option value="9999">9999 场</option><option value="1">1 场测试</option></select>
      </label>
      <div class="run-actions">
        <button id="run-party" class="primary"><span aria-hidden="true">▶</span><span>运行组队御魂</span></button>
        <button id="stop" class="icon-button" title="停止当前自动化" aria-label="停止当前自动化">■</button>
      </div>
      <div id="run-status" class="status idle" role="status"><span class="status-dot"></span><span id="status-text">就绪</span></div>
    </section>

    <section aria-labelledby="workflow-heading">
      <h2 id="workflow-heading">工作流</h2>
      <button id="open-editor" class="command"><span class="command-icon" aria-hidden="true">◇</span><span>打开工作流编辑器</span></button>
      <div class="tool-grid compact-grid">
        <button data-editor-command="workflowSettings"><span class="tool-icon" aria-hidden="true">⚙</span><span>工作流设置</span></button>
        <button data-editor-command="blackboard"><span class="tool-icon" aria-hidden="true">▦</span><span>黑板参数</span></button>
      </div>
    </section>

    <section aria-labelledby="search-heading">
      <h2 id="search-heading">查找卡片</h2>
      <div class="node-search-row">
        <input id="node-search" type="search" placeholder="输入卡片 name" aria-label="按 name 查找卡片">
        <button id="find-node" class="primary">查找</button>
      </div>
    </section>

    <section aria-labelledby="node-heading">
      <h2 id="node-heading">添加节点</h2>
      <div class="tool-grid">
        <button data-editor-command="addTask"><span class="node-swatch task" aria-hidden="true"></span><span>Task</span></button>
        <button data-editor-command="addSelector"><span class="node-swatch selector" aria-hidden="true"></span><span>Selector</span></button>
        <button data-editor-command="addSequence"><span class="node-swatch sequence" aria-hidden="true"></span><span>Sequence</span></button>
        <button data-editor-command="addParallel"><span class="node-swatch parallel" aria-hidden="true"></span><span>Parallel</span></button>
      </div>
    </section>

    <section aria-labelledby="canvas-heading">
      <h2 id="canvas-heading">画布</h2>
      <div class="tool-grid compact-grid">
        <button data-editor-command="autoLayout"><span class="tool-icon" aria-hidden="true">⌘</span><span>自动排列</span></button>
        <button data-editor-command="fitView"><span class="tool-icon" aria-hidden="true">⌂</span><span>适应视口</span></button>
      </div>
      <button data-editor-command="exportImage" class="command"><span class="command-icon" aria-hidden="true">⇩</span><span>导出完整画布</span></button>
    </section>

    <section aria-labelledby="tools-heading">
      <h2 id="tools-heading">工具</h2>
      <button id="open-log" class="command"><span class="command-icon" aria-hidden="true">☷</span><span>运行日志</span></button>
      <button id="open-tree" class="command"><span class="command-icon" aria-hidden="true">≣</span><span>结构树</span></button>
      <button id="open-refs" class="command"><span class="command-icon" aria-hidden="true">⇄</span><span>引用查看</span></button>
      <button id="validate" class="command"><span class="command-icon" aria-hidden="true">✓</span><span>引擎校验</span></button>
    </section>
  </main>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}
