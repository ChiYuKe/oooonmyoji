import * as path from 'path';
import * as vscode from 'vscode';

type RunState = 'idle' | 'running' | 'stopping' | 'success' | 'error';

interface SidebarMessage {
  type: string;
  command?: unknown;
  value?: unknown;
}

export interface SidebarVariable {
  name: string;
  type: string;
  public: boolean;
}

export interface SidebarNode {
  id: string;
  name: string;
  type: string;
  meta: string;
  children: string[];
}

export interface SidebarEditorState {
  variables: SidebarVariable[];
  selectedVariable: string;
  nodes: SidebarNode[];
  root: string;
  selectedNode: string;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'onmyoji.controlPanel';

  private view: vscode.WebviewView | undefined;
  private state: RunState = 'idle';
  private detail = '就绪';
  private editorState: SidebarEditorState = {
    variables: [],
    selectedVariable: '',
    nodes: [],
    root: '',
    selectedNode: '',
  };

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

  setEditorState(state: SidebarEditorState): void {
    this.editorState = state;
    this.postEditorState();
  }

  private postState(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({ type: 'state', state: this.state, detail: this.detail });
  }

  private postEditorState(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({
      type: 'editorState',
      ...this.editorState,
    });
  }

  private async onMessage(message: SidebarMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.postState();
        this.postEditorState();
        break;
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
  <main id="sidebar-root">
    <section class="dock-pane structure-dock" aria-label="工作流导航">
      <div class="dock-tabs" role="tablist" aria-label="左上面板">
        <button class="dock-tab active" data-sidebar-tab="structure" role="tab" aria-selected="true"><span aria-hidden="true">≣</span><span>结构树</span></button>
        <button class="dock-tab" data-sidebar-tab="controls" role="tab" aria-selected="false"><span aria-hidden="true">☷</span><span>控制板</span></button>
      </div>

      <div id="structure-panel" class="dock-content" role="tabpanel">
        <div class="dock-toolbar">
          <input id="structure-search" type="search" placeholder="搜索节点" aria-label="搜索结构树节点">
          <button id="collapse-tree" class="toolbar-icon" title="收起全部" aria-label="收起全部">⌃</button>
          <button id="expand-tree" class="toolbar-icon" title="展开全部" aria-label="展开全部">⌄</button>
        </div>
        <div id="structure-tree" class="structure-tree" role="tree" aria-label="当前工作流结构树">
          <div class="pane-empty">打开工作流后显示结构</div>
        </div>
      </div>

      <div id="controls-panel" class="dock-content hidden" role="tabpanel">
        <div class="control-scroll">
          <section class="control-section" aria-labelledby="workflow-heading">
            <h2 id="workflow-heading">工作流</h2>
            <button id="open-editor" class="command"><span class="command-icon" aria-hidden="true">◇</span><span>打开工作流编辑器</span></button>
            <button data-editor-command="workflowSettings" class="command"><span class="command-icon" aria-hidden="true">⚙</span><span>工作流设置</span></button>
          </section>
          <section class="control-section" aria-labelledby="search-heading">
            <h2 id="search-heading">查找卡片</h2>
            <div class="node-search-row">
              <input id="node-search" type="search" placeholder="输入卡片 name" aria-label="按 name 查找卡片">
              <button id="find-node" class="primary">查找</button>
            </div>
          </section>
          <section class="control-section" aria-labelledby="node-heading">
            <h2 id="node-heading">添加节点</h2>
            <div class="tool-grid">
              <button data-editor-command="addTask"><span class="node-swatch task" aria-hidden="true"></span><span>Task</span></button>
              <button data-editor-command="addSelector"><span class="node-swatch selector" aria-hidden="true"></span><span>Selector</span></button>
              <button data-editor-command="addSequence"><span class="node-swatch sequence" aria-hidden="true"></span><span>Sequence</span></button>
              <button data-editor-command="addParallel"><span class="node-swatch parallel" aria-hidden="true"></span><span>Parallel</span></button>
              <button data-editor-command="addInstanceParallel"><span class="node-swatch instance-parallel" aria-hidden="true"></span><span>Instances</span></button>
            </div>
          </section>
          <section class="control-section" aria-labelledby="canvas-heading">
            <h2 id="canvas-heading">画布</h2>
            <div class="tool-grid compact-grid">
              <button data-editor-command="autoLayout"><span class="tool-icon" aria-hidden="true">⌘</span><span>自动排列</span></button>
              <button data-editor-command="fitView"><span class="tool-icon" aria-hidden="true">⌂</span><span>适应视口</span></button>
            </div>
            <button data-editor-command="exportImage" class="command"><span class="command-icon" aria-hidden="true">⇩</span><span>导出完整画布</span></button>
          </section>
          <section class="control-section" aria-labelledby="tools-heading">
            <h2 id="tools-heading">工具</h2>
            <div class="run-actions">
              <div id="run-status" class="status idle" role="status"><span class="status-dot"></span><span id="status-text">就绪</span></div>
              <button id="stop" class="icon-button" title="停止当前工作流" aria-label="停止当前工作流">■</button>
            </div>
            <button id="open-log" class="command"><span class="command-icon" aria-hidden="true">☷</span><span>运行日志</span></button>
            <button id="open-tree" class="command"><span class="command-icon" aria-hidden="true">≣</span><span>独立结构树</span></button>
            <button id="open-refs" class="command"><span class="command-icon" aria-hidden="true">⇄</span><span>引用查看</span></button>
            <button id="validate" class="command"><span class="command-icon" aria-hidden="true">✓</span><span>引擎校验</span></button>
          </section>
        </div>
      </div>
    </section>

    <section class="dock-pane variables-dock" aria-label="工作流变量">
      <div class="dock-tabs variable-tabs">
        <div class="dock-tab active static"><span aria-hidden="true">●</span><span>变量</span></div>
        <button id="add-variable" class="dock-action" title="添加变量" aria-label="添加变量">＋</button>
      </div>
      <div class="dock-toolbar">
        <input id="variable-search" type="search" placeholder="搜索变量" aria-label="搜索变量">
      </div>
      <div id="variable-list" class="sidebar-variable-list" role="listbox" aria-label="当前工作流变量">
        <div class="pane-empty">打开工作流后显示变量</div>
      </div>
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
