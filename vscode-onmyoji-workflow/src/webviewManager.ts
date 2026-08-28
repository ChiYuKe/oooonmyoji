/**
 * 可视化流程图编辑器（Webview）管理：面板生命周期、消息协议、文件读写。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActionCatalog } from './catalog';
import { WorkflowIntelligence } from './jsonProviders';
import { RuntimeInstanceInfo } from './runtimeInstances';
import { collectRefSuggestions, parseWorkflow, validateWorkflow } from './workflow';

interface WebviewPayload {
  type: string;
  [key: string]: unknown;
}

interface RoiCapture {
  dataUrl: string;
  width: number;
  height: number;
}

interface RuntimeInstanceState {
  instances: RuntimeInstanceInfo[];
  selectedInstance: string;
}

type RoiPicker = (referenceResolution: [number, number], instanceId?: string) => Promise<RoiCapture | undefined>;
type InstanceSelector = (instanceId: string) => Promise<string>;
type RuntimeInstanceProvider = () => Promise<RuntimeInstanceState>;

export class WebviewManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private docUri: vscode.Uri | undefined;
  private dirty = false;
  private disposables: vscode.Disposable[] = [];
  private runWatcherTimer: NodeJS.Timeout | undefined;
  private runStopTimer: NodeJS.Timeout | undefined;
  private runEventsPath: string | undefined;
  private runWatcherOffset = 0;
  private latestRunEvents: Record<string, unknown>[] = [];
  private instanceRefreshTimer: NodeJS.Timeout | undefined;
  private instanceRefreshPending = false;

  constructor(
    private context: vscode.ExtensionContext,
    private intelligence: WorkflowIntelligence,
    private getCatalog: () => ActionCatalog,
    private getProjectRoot: () => string,
    private getRuntimeInstanceState: RuntimeInstanceProvider,
    private selectRuntimeInstance: InstanceSelector,
    private pickRoi: RoiPicker,
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
          // media 提供编辑器资源；projectRoot 让运行截图等产物可被 webview 加载
          localResourceRoots: [
            vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
            vscode.Uri.file(this.getProjectRoot()),
          ],
        },
      );
      this.panel.webview.html = this.buildHtml(this.panel.webview);
      this.disposables.push(
        this.panel.webview.onDidReceiveMessage((message: WebviewPayload) => void this.onMessage(message)),
        this.panel.onDidDispose(() => {
          this.stopInstanceRefresh();
          this.panel = undefined;
          this.docUri = undefined;
          this.disposePanelSubscriptions();
        }),
      );
    }
    this.startInstanceRefresh();
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
  <span id="brand">Behavior Tree</span>
  <span id="file-label" title=""></span>
  <span id="dirty-badge" class="badge hidden">未保存</span>
  <span id="issue-badge" class="badge"></span>
  <span class="toolbar-separator"></span>
  <button id="btn-add-task" class="primary" title="添加 Task">＋ Task</button>
  <button id="btn-add-selector" title="添加 Selector">＋ Selector</button>
  <button id="btn-add-sequence" title="添加 Sequence">＋ Sequence</button>
  <button id="btn-add-parallel" title="添加 Simple Parallel">＋ Parallel</button>
  <button id="btn-layout" class="icon-button" title="自动排列">⌘</button>
  <button id="btn-fit" class="icon-button" title="适应视口">⌂</button>
  <span class="spacer"></span>
  <button id="btn-workflow" title="工作流设置">设置</button>
  <button id="btn-blackboard" title="黑板参数">黑板</button>
  <select id="instance-select" title="运行实例" aria-label="运行实例"></select>
  <button id="btn-run" class="primary" title="执行当前工作流">▶ 运行</button>
  <button id="btn-save" class="primary" title="保存到 JSON">保存</button>
  <button id="btn-more" class="icon-button" title="更多操作">⋯</button>
</header>
<div id="external-banner" class="hidden"></div>
<main>
  <section id="canvas-wrap">
    <svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg>
    <div id="viewport-tools"><button id="btn-zoom-out" class="icon-button" title="缩小">−</button><span id="zoom-label">100%</span><button id="btn-zoom-in" class="icon-button" title="放大">＋</button></div>
    <svg id="minimap" xmlns="http://www.w3.org/2000/svg"></svg>
  </section>
  <aside id="inspector">
    <div id="inspector-title">详细信息</div>
    <div id="inspector-empty">选择一个节点</div>
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
    const runtime = await this.getRuntimeInstanceState();
    await this.panel.webview.postMessage({
      type: 'init',
      document: { uri: this.docUri.toString(), name: path.basename(this.docUri.fsPath), text },
      catalog: catalog.all(),
      refs,
      issues,
      projectRoot: this.getProjectRoot(),
      instances: runtime.instances,
      selectedInstance: runtime.selectedInstance,
    });
  }

  private startInstanceRefresh(): void {
    if (this.instanceRefreshTimer !== undefined) return;
    this.instanceRefreshTimer = setInterval(() => void this.sendRuntimeInstances(), 4000);
  }

  private stopInstanceRefresh(): void {
    if (this.instanceRefreshTimer !== undefined) {
      clearInterval(this.instanceRefreshTimer);
      this.instanceRefreshTimer = undefined;
    }
  }

  private async sendRuntimeInstances(): Promise<void> {
    if (!this.panel?.visible || this.instanceRefreshPending) return;
    this.instanceRefreshPending = true;
    try {
      const runtime = await this.getRuntimeInstanceState();
      if (this.panel) {
        void this.panel.webview.postMessage({
          type: 'runtimeInstances',
          instances: runtime.instances,
          selectedInstance: runtime.selectedInstance,
        });
      }
    } finally {
      this.instanceRefreshPending = false;
    }
  }

  private async onMessage(message: WebviewPayload): Promise<void> {
    if (!this.panel) return;
    switch (message.type) {
      case 'ready':
        await this.sendInit();
        // 回放最近一次运行的步骤事件（刷新/重开面板后缩略图仍在）
        if (this.latestRunEvents.length > 0) {
          void this.panel.webview.postMessage({ type: 'runReplay', events: this.latestRunEvents.map((e) => this.convertRunEvent(e)) });
        }
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
     case 'newWorkflow':
       await vscode.commands.executeCommand('onmyoji.createWorkflow');
       break;
      case 'runWorkflow': {
        if (!this.docUri) return;
        const instanceId = await this.selectRuntimeInstance(String(message.instanceId ?? ''));
        // 事件文件路径与监听由 extension.runWorkflow 统一处理，
        // 这样命令面板 / 编辑器标题栏等入口也能触发缩略图更新。
        await vscode.commands.executeCommand('onmyoji.runWorkflow', this.docUri, instanceId);
        break;
      }
      case 'selectInstance': {
        const instanceId = await this.selectRuntimeInstance(String(message.instanceId ?? ''));
        void this.panel.webview.postMessage({ type: 'instanceSelected', instanceId });
        break;
      }
      case 'pickRoi': {
        const rawResolution = message.referenceResolution;
        const nodeId = String(message.nodeId ?? message.stepId ?? '');
        const referenceResolution: [number, number] = Array.isArray(rawResolution) && rawResolution.length === 2
          && rawResolution.every((value) => typeof value === 'number' && Number.isInteger(value) && value > 0)
          ? [rawResolution[0] as number, rawResolution[1] as number]
          : [1920, 1080];
        try {
          const instanceId = await this.selectRuntimeInstance(String(message.instanceId ?? ''));
          const capture = await this.pickRoi(referenceResolution, instanceId);
          if (capture && this.panel) {
            void this.panel.webview.postMessage({
              type: 'roiPickerImage',
              requestId: message.requestId,
              nodeId,
              key: message.key,
              dataUrl: capture.dataUrl,
              width: capture.width,
              height: capture.height,
              referenceResolution,
            });
          } else if (this.panel) {
            void this.panel.webview.postMessage({
              type: 'roiPickerCancelled',
              requestId: message.requestId,
            });
          }
        } catch (error) {
          if (this.panel) {
            void this.panel.webview.postMessage({
              type: 'roiPickerError',
              requestId: message.requestId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
        break;
      }
      case 'saveTemplate': {
        const requestId = String(message.requestId ?? '');
        const nodeId = String(message.nodeId ?? message.stepId ?? '');
        const key = String(message.key ?? 'template');
        let filename = String(message.filename ?? 'template.png')
          .replace(/\\/g, '/')
          .replace(/[\x00-\x1f<>:"|?*]/g, '_')
          .replace(/^\/+/, '')
          .trim();
        filename = path.posix.normalize(filename);
        if (!filename || filename === '.' || filename === '..' || filename.startsWith('../') || filename.includes('/../')) filename = 'template.png';
        if (!/\.png$/i.test(filename)) filename += '.png';
        const dataUrl = String(message.dataUrl ?? '');
        const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
        if (!requestId || !nodeId || !match) {
          void this.panel.webview.postMessage({ type: 'roiPickerError', requestId, message: '模板图片数据无效' });
          break;
        }
        try {
          const relativePath = path.posix.join('assets/templates', filename);
          const outputPath = path.resolve(this.getProjectRoot(), relativePath);
          const root = path.resolve(this.getProjectRoot());
          if (outputPath !== root && !outputPath.startsWith(root + path.sep)) throw new Error('模板路径无效');
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(outputPath)));
          await vscode.workspace.fs.writeFile(vscode.Uri.file(outputPath), Buffer.from(match[1], 'base64'));
          void this.panel.webview.postMessage({ type: 'templateSaved', requestId, nodeId, key, path: relativePath });
        } catch (error) {
          void this.panel.webview.postMessage({ type: 'roiPickerError', requestId, message: error instanceof Error ? error.message : String(error) });
        }
        break;
      }
    case 'error':
        vscode.window.showErrorMessage(`Onmyoji 工作流编辑器：${String(message.message ?? '')}`);
        break;
      default:
        break;
    }
  }

  /** 开始监听运行事件文件（引擎写入 JSONL，本方法尾随并转发给 webview）。 */
  startRunWatcher(filePath: string): void {
    this.stopRunWatcher();
    this.runEventsPath = filePath;
    this.runWatcherOffset = 0;
    this.runWatcherTimer = setInterval(() => this.tickRunWatcher(), 400);
  }

  private stopRunWatcher(): void {
    if (this.runStopTimer !== undefined) {
      clearTimeout(this.runStopTimer);
      this.runStopTimer = undefined;
    }
    if (this.runWatcherTimer !== undefined) {
      clearInterval(this.runWatcherTimer);
      this.runWatcherTimer = undefined;
    }
    this.runEventsPath = undefined;
  }

  private tickRunWatcher(): void {
    if (!this.runEventsPath) return;
    let size: number;
    try {
      size = fs.statSync(this.runEventsPath).size;
    } catch {
      return; // 引擎还没创建事件文件
    }
    if (size < this.runWatcherOffset) this.runWatcherOffset = 0; // 新一次运行截断了文件
    if (size === this.runWatcherOffset) return;
    let chunk = '';
    try {
      const fd = fs.openSync(this.runEventsPath, 'r');
      try {
        const buffer = Buffer.alloc(size - this.runWatcherOffset);
        fs.readSync(fd, buffer, 0, buffer.length, this.runWatcherOffset);
        chunk = buffer.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
      this.runWatcherOffset = size;
    } catch {
      return;
    }
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      this.forwardRunEvent(event);
    }
  }

  /** 把引擎事件转发给 webview：截图绝对路径先转成 webview URI。 */
  private convertRunEvent(event: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...event };
    if (event.type === 'step' && typeof event.screenshot === 'string' && this.panel) {
      try {
        out.screenshot = this.panel.webview.asWebviewUri(vscode.Uri.file(event.screenshot)).toString();
      } catch {
        // 保留原路径
      }
    }
    return out;
  }

  private forwardRunEvent(event: Record<string, unknown>): void {
    // 先缓存（即使面板未打开，重开/刷新时也能回放），有面板再转发。
    this.latestRunEvents.push(event);
    if (this.latestRunEvents.length > 5000) this.latestRunEvents.shift();
    if (this.panel) {
      void this.panel.webview.postMessage({ type: 'runEvent', event: this.convertRunEvent(event) });
    }
    if (event.type === 'run_finished') {
      // 执行结束：再等 1.5 秒收尾读余量，然后停止轮询；句柄受管，期间发起新运行不会被误停
      if (this.runStopTimer !== undefined) clearTimeout(this.runStopTimer);
      this.runStopTimer = setTimeout(() => this.stopRunWatcher(), 1500);
    }
  }

  dispose(): void {
    this.stopInstanceRefresh();
    this.stopRunWatcher();
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
