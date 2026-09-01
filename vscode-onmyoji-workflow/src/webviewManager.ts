/**
 * 可视化流程图编辑器（Webview）管理：面板生命周期、消息协议、文件读写。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActionCatalog } from './catalog';
import { WorkflowIntelligence } from './jsonProviders';
import { RuntimeInstanceInfo } from './runtimeInstances';
import type { SidebarEditorState } from './sidebarProvider';
import { WorkflowFileDescriptor, collectRefSuggestions, parseWorkflow, resolveWorkflowReference, validateWorkflow } from './workflow';

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

interface AssetImageInfo {
  path: string;
  uri: string;
}

export interface TemplateCheckOptions {
  template: string;
  roi?: [number, number, number, number];
  threshold: number;
  maxResults: number;
  scaleSearch: boolean;
  referenceResolution: [number, number];
  instanceId?: string;
}

export interface TemplateCheckResult {
  dataUrl: string;
  width: number;
  height: number;
  roi: [number, number, number, number];
  matches: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  }>;
}

type RoiPicker = (referenceResolution: [number, number], instanceId?: string) => Promise<RoiCapture | undefined>;
type TemplateChecker = (options: TemplateCheckOptions) => Promise<TemplateCheckResult>;
type InstanceSelector = (instanceId: string) => Promise<string>;
type RuntimeInstanceProvider = () => Promise<RuntimeInstanceState>;
type RunEventListener = (event: Record<string, unknown>) => void;
type SidebarStateListener = (state: SidebarEditorState) => void;

interface EditorCommandPayload {
  command: string;
  value?: unknown;
}

const editorCommands = new Set([
  'addTask',
  'addSelector',
  'addSequence',
  'addParallel',
  'addInstanceParallel',
  'autoLayout',
  'fitView',
  'exportImage',
  'workflowSettings',
  'variables',
  'selectVariable',
  'addVariable',
  'searchNodeByName',
  'focusNode',
]);

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
  private editorReady = false;
  private pendingEditorCommands: EditorCommandPayload[] = [];
  /** 进入子工作流视图时记录上级工作流 URI（支持多级嵌套返回）。 */
  private workflowBackStack: string[] = [];

  /** 编辑器当前打开的工作流文件（供结构树等面板判断是否需要切换）。 */
  get currentUri(): vscode.Uri | undefined {
    return this.docUri;
  }

  constructor(
    private context: vscode.ExtensionContext,
    private intelligence: WorkflowIntelligence,
    private getCatalog: () => ActionCatalog,
    private getProjectRoot: () => string,
    private getRuntimeInstanceState: RuntimeInstanceProvider,
    private selectRuntimeInstance: InstanceSelector,
    private pickRoi: RoiPicker,
    private checkTemplate: TemplateChecker,
    private onRunEvent: RunEventListener,
    private onSidebarState: SidebarStateListener,
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
      this.editorReady = false;
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
          this.editorReady = false;
          this.pendingEditorCommands = [];
          this.onSidebarState({ variables: [], selectedVariable: '', nodes: [], root: '', selectedNode: '' });
          this.disposePanelSubscriptions();
        }),
      );
    }
    this.startInstanceRefresh();
    this.docUri = uri;
    this.dirty = false;
    await this.sendInit();
  }

  /** 从活动栏侧边面板调用画布编辑命令。 */
  async executeEditorCommand(command: string, value?: unknown): Promise<void> {
    if (!editorCommands.has(command)) return;
    const payload: EditorCommandPayload = { command, value };
    const queued = !this.panel || !this.editorReady;
    if (queued) this.pendingEditorCommands.push(payload);
    if (!this.panel) await this.open();
    if (!this.panel) {
      this.pendingEditorCommands = this.pendingEditorCommands.filter((item) => item !== payload);
      return;
    }
    this.panel.reveal(vscode.ViewColumn.One);
    if (this.editorReady) {
      const index = this.pendingEditorCommands.indexOf(payload);
      if (index >= 0) {
        this.pendingEditorCommands.splice(index, 1);
        void this.panel.webview.postMessage({ type: 'editorCommand', ...payload });
      } else if (!queued) {
        void this.panel.webview.postMessage({ type: 'editorCommand', ...payload });
      }
    }
  }

  private flushEditorCommands(): void {
    if (!this.panel || !this.editorReady) return;
    const commands = this.pendingEditorCommands.splice(0);
    for (const command of commands) {
      void this.panel.webview.postMessage({ type: 'editorCommand', ...command });
    }
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
    const files = await this.listWorkflowFiles();
    if (files.length === 0) {
      vscode.window.showInformationMessage('未找到工作流 JSON 文件（默认匹配 **/workflows/**/*.json）。');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      files.map((f) => ({ label: f.name, description: f.rel, detail: f.description || undefined, uri: vscode.Uri.parse(f.uri) })),
      { placeHolder: '选择要编辑的工作流' },
    );
    return picked?.uri;
  }

  /** 枚举项目内所有工作流文件，供工具栏下拉框与打开对话框使用。 */
  private async listWorkflowFiles(): Promise<WorkflowFileDescriptor[]> {
    const pattern = vscode.workspace.getConfiguration('onmyoji').get<string>('workflowFiles', '**/workflows/**/*.json');
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 200);
    const descriptors = await Promise.all(files.map(async (file): Promise<WorkflowFileDescriptor> => {
      let description = '';
      let workflowId = '';
      let variables: NonNullable<WorkflowFileDescriptor['variables']> = [];
      try {
        const contents = await vscode.workspace.fs.readFile(file);
        const raw: unknown = JSON.parse(Buffer.from(contents).toString('utf8'));
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const parsed = parseWorkflow(raw);
          workflowId = parsed.id ?? '';
          description = parsed.description?.trim() ?? '';
          variables = Object.entries(parsed.blackboard).map(([name, definition]) => ({
            name,
            public: definition.public !== false,
            definition,
          }));
        }
      } catch {
        // 无法解析的脚本仍列出，只是不显示描述。
      }
      return {
        uri: file.toString(),
        name: path.basename(file.fsPath),
        rel: vscode.workspace.asRelativePath(file),
        ...(workflowId ? { id: workflowId } : {}),
        ...(description ? { description } : {}),
        ...(variables.length ? { variables } : {}),
      };
    }));
    return descriptors.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.rel.localeCompare(b.rel, 'zh-CN'));
  }

  /** 把 webview 传来的工作流文本写入当前文件，并同步开放文本编辑器与智能提示。 */
  private async saveCurrentText(text: string): Promise<void> {
    if (!this.docUri) return;
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
  <button id="btn-back" class="icon-button hidden" title="返回上一级工作流（从子工作流视图返回）" aria-label="返回上一级">←</button>
  <select id="workflow-select" title="切换工作流（无需重新打开）" aria-label="切换工作流"></select>
  <span id="dirty-badge" class="badge hidden">未保存</span>
  <span id="issue-badge" class="badge"></span>
  <span class="spacer"></span>
  <select id="instance-select" title="运行实例" aria-label="运行实例"></select>
  <button id="btn-run" class="primary" title="执行当前工作流">▶ 运行</button>
  <button id="btn-stop" class="icon-button" title="停止当前工作流" aria-label="停止当前工作流">■</button>
  <button id="btn-save" class="primary" title="保存到 JSON">保存</button>
  <button id="btn-more" class="icon-button" title="更多操作">⋯</button>
</header>
<div id="external-banner" class="hidden"></div>
<main id="editor-main">
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
    const assetsBaseUri = this.panel.webview
      .asWebviewUri(vscode.Uri.file(path.join(this.getProjectRoot(), 'assets')))
      .toString()
      .replace(/\/?$/, '/');
    await this.panel.webview.postMessage({
      type: 'init',
      document: { uri: this.docUri.toString(), name: path.basename(this.docUri.fsPath), text },
      workflows: await this.listWorkflowFiles(),
      canGoBack: this.workflowBackStack.length > 0,
      catalog: catalog.all(),
      refs,
      issues,
      projectRoot: this.getProjectRoot(),
      assetsBaseUri,
      instances: runtime.instances,
      selectedInstance: runtime.selectedInstance,
    });
  }

  /** 回放最近一次运行的步骤事件（刷新面板、切换工作流后运行状态仍可见）。 */
  private replayRunEvents(): void {
    if (this.panel && this.latestRunEvents.length > 0) {
      void this.panel.webview.postMessage({ type: 'runReplay', events: this.latestRunEvents.map((e) => this.convertRunEvent(e)) });
    }
  }

  /**
   * 解析 workflow.run 的子工作流引用（ID、JSON 文件名或 workflows/ 下路径）到文件 URI。
   * 先按文件名/路径匹配，再读取各工作流文件按 id 匹配。
   */
  private async resolveSubWorkflowUri(reference: string): Promise<vscode.Uri | undefined> {
    const files = await this.listWorkflowFiles();
    const uri = await resolveWorkflowReference(reference, files, async (fileUri) => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(fileUri));
      return doc.getText();
    });
    return uri ? vscode.Uri.parse(uri) : undefined;
  }

  /** 从当前工作流 JSON 中读取指定节点的 workflow.run 子工作流引用。 */
  private subWorkflowReferenceOf(nodeId: string): string {
    if (!this.docUri) return '';
    try {
      const rawText = fs.readFileSync(this.docUri.fsPath, 'utf8');
      const raw = JSON.parse(rawText) as { nodes?: Array<{ id?: string; type?: string; action?: string; params?: Record<string, unknown> }> };
      const node = (raw.nodes ?? []).find((n) => n.id === nodeId && n.type === 'task');
      if (node && node.action === 'workflow.run' && typeof node.params?.workflow === 'string') {
        return node.params.workflow;
      }
    } catch {
      // 忽略读取/解析失败
    }
    return '';
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
        this.editorReady = true;
        await this.sendInit();
        // 回放最近一次运行的步骤事件（刷新/重开面板后缩略图仍在）
        this.replayRunEvents();
        this.flushEditorCommands();
        break;
      case 'sidebarStateChanged': {
        const variables = Array.isArray(message.variables)
          ? message.variables.flatMap((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
            const value = item as Record<string, unknown>;
            const name = typeof value.name === 'string' ? value.name.trim() : '';
            if (!name) return [];
            return [{
              name,
              type: typeof value.type === 'string' && value.type ? value.type : 'any',
              public: value.public !== false,
            }];
          })
          : [];
        const selectedVariable = typeof message.selectedVariable === 'string' ? message.selectedVariable : '';
        const nodes = Array.isArray(message.nodes)
          ? message.nodes.flatMap((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
            const value = item as Record<string, unknown>;
            const id = typeof value.id === 'string' ? value.id.trim() : '';
            if (!id) return [];
            return [{
              id,
              name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : id,
              type: typeof value.type === 'string' && value.type ? value.type : 'task',
              meta: typeof value.meta === 'string' ? value.meta : '',
              children: Array.isArray(value.children) ? value.children.map((child) => String(child)).filter(Boolean) : [],
            }];
          })
          : [];
        this.onSidebarState({
          variables,
          selectedVariable,
          nodes,
          root: typeof message.root === 'string' ? message.root : '',
          selectedNode: typeof message.selectedNode === 'string' ? message.selectedNode : '',
        });
        break;
      }
      case 'reloadRequest':
        this.dirty = false;
        await this.sendInit();
        break;
      case 'save': {
        const text = String(message.text ?? '');
        if (!this.docUri) return;
        await this.saveCurrentText(text);
        break;
      }
      case 'switchWorkflow': {
        const uri = String(message.uri ?? '');
        if (!uri || !this.docUri) break;
        // 前端在脏状态时先确认保存；这里统一保存当前文件后切换到目标工作流。
        const saveText = typeof message.saveText === 'string' ? message.saveText : undefined;
        if (saveText !== undefined) await this.saveCurrentText(saveText);
        this.docUri = vscode.Uri.parse(uri);
        this.dirty = false;
        await this.sendInit();
        // 切换后回放最近运行事件，让子工作流视图也能看到运行情况
        this.replayRunEvents();
        break;
      }
      case 'openWorkflowPicker': {
        const uri = await this.pickWorkflow();
        if (uri && this.docUri) {
          this.docUri = uri;
          this.dirty = false;
          await this.sendInit();
          this.replayRunEvents();
        }
        break;
      }
      case 'openSubWorkflow': {
        // 普通 workflow.run 按节点解析；实例运行卡片可直接携带 runs[].workflow 引用。
        if (!this.docUri) break;
        const saveText = typeof message.saveText === 'string' ? message.saveText : undefined;
        if (saveText !== undefined) await this.saveCurrentText(saveText);
        const directReference = typeof message.reference === 'string' ? message.reference.trim() : '';
        const reference = directReference || this.subWorkflowReferenceOf(String(message.nodeId ?? ''));
        if (!reference) {
          vscode.window.showWarningMessage('该卡片没有配置子工作流。');
          break;
        }
        const target = await this.resolveSubWorkflowUri(reference);
        if (!target) {
          vscode.window.showWarningMessage(`未找到子工作流：${reference}`);
          break;
        }
        // 记录上级工作流，供「返回上一级」使用（目标与当前相同则不重复压栈）
        if (target.toString() !== this.docUri.toString()) {
          this.workflowBackStack.push(this.docUri.toString());
        }
        this.docUri = target;
        this.dirty = false;
        await this.sendInit();
        // 回放最近运行事件，子工作流步骤（workflow_id 匹配）会显示在画布上
        this.replayRunEvents();
        break;
      }
      case 'goBackWorkflow': {
        // 返回上一级工作流视图；栈为空时提示。
        const previous = this.workflowBackStack.pop();
        if (!previous || !this.docUri) {
          vscode.window.showInformationMessage('已在最顶层工作流，没有可返回的上级。');
          break;
        }
        const saveText = typeof message.saveText === 'string' ? message.saveText : undefined;
        if (saveText !== undefined) await this.saveCurrentText(saveText);
        this.docUri = vscode.Uri.parse(previous);
        this.dirty = false;
        await this.sendInit();
        this.replayRunEvents();
        break;
      }
     case 'openFile':
       if (this.docUri) {
         const doc = await vscode.workspace.openTextDocument(this.docUri);
         await vscode.window.showTextDocument(doc, { preview: false });
       }
       break;
     case 'openReferences':
       await vscode.commands.executeCommand('onmyoji.openWorkflowReferences', this.docUri?.toString());
       break;
     case 'openWorkflowTree':
       await vscode.commands.executeCommand('onmyoji.openWorkflowTree', this.docUri?.toString());
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
      case 'runPartySouls':
        await vscode.commands.executeCommand('onmyoji.runPartySouls');
        break;
      case 'stopWorkflow':
        await vscode.commands.executeCommand('onmyoji.stopWorkflow');
        break;
      case 'openRunLog':
        await vscode.commands.executeCommand('onmyoji.openRunLog');
        break;
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
      case 'checkTemplate': {
        const requestId = String(message.requestId ?? '');
        try {
          const template = String(message.template ?? '').trim();
          if (!template) throw new Error('请先选择模板图片');
          const rawResolution = message.referenceResolution;
          const referenceResolution: [number, number] = Array.isArray(rawResolution) && rawResolution.length === 2
            && rawResolution.every((value) => typeof value === 'number' && Number.isInteger(value) && value > 0)
            ? [rawResolution[0] as number, rawResolution[1] as number]
            : [1920, 1080];
          const rawRoi = message.roi;
          let roi: [number, number, number, number] | undefined;
          if (rawRoi !== undefined && rawRoi !== null) {
            if (!Array.isArray(rawRoi) || rawRoi.length !== 4
              || !rawRoi.every((value) => typeof value === 'number' && Number.isInteger(value))) {
              throw new Error('ROI 必须是 [x, y, width, height]');
            }
            roi = [rawRoi[0] as number, rawRoi[1] as number, rawRoi[2] as number, rawRoi[3] as number];
          }
          const threshold = Number(message.threshold ?? 0.85);
          if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('匹配阈值必须在 0 到 1 之间');
          const maxResults = Number(message.maxResults ?? 20);
          if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) throw new Error('最大匹配数必须在 1 到 100 之间');
          const instanceId = await this.selectRuntimeInstance(String(message.instanceId ?? ''));
          const result = await this.checkTemplate({
            template,
            roi,
            threshold,
            maxResults,
            scaleSearch: Boolean(message.scaleSearch),
            referenceResolution,
            instanceId,
          });
          if (this.panel) void this.panel.webview.postMessage({ type: 'templateCheckResult', requestId, ...result });
        } catch (error) {
          if (this.panel) void this.panel.webview.postMessage({
            type: 'templateCheckError',
            requestId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
      case 'listAssetImages': {
        const requestId = String(message.requestId ?? '');
        try {
          const images = await this.listAssetImages(this.panel.webview);
          void this.panel.webview.postMessage({ type: 'assetImages', requestId, images });
        } catch (error) {
          void this.panel.webview.postMessage({
            type: 'assetImagesError',
            requestId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
      case 'requestAssetData': {
        const requestId = String(message.requestId ?? '');
        const paths = Array.isArray(message.paths) ? message.paths.map((item) => String(item)) : [];
        try {
          const items = await this.readAssetDataUrls(paths);
          void this.panel.webview.postMessage({ type: 'assetData', requestId, items });
        } catch (error) {
          void this.panel.webview.postMessage({
            type: 'assetDataError',
            requestId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
      case 'saveTemplate': {
        const requestId = String(message.requestId ?? '');
        const nodeId = String(message.nodeId ?? message.stepId ?? '');
        const key = String(message.key ?? 'template');
        const requestedTarget = String(message.targetPath ?? '').replace(/\\/g, '/').trim();
        let filename = String(message.filename ?? 'template.png')
          .replace(/\\/g, '/')
          .replace(/[\x00-\x1f<>:"|?*]/g, '_')
          .replace(/^\/+/, '')
          .trim();
        filename = path.posix.normalize(filename);
        if (!filename || filename === '.' || filename === '..' || filename.startsWith('../') || filename.includes('/../')) filename = 'template.png';
        if (!/\.png$/i.test(filename)) filename += '.png';
        const dataUrl = String(message.dataUrl ?? '');
        const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
        if (!requestId || !nodeId || !match) {
          void this.panel.webview.postMessage({ type: 'roiPickerError', requestId, message: '模板图片数据无效' });
          break;
        }
        try {
          let relativePath = path.posix.join('assets/templates', filename);
          if (requestedTarget) {
            const normalizedTarget = path.posix.normalize(requestedTarget);
            if (/^[\/]|[\x00-\x1f<>:"|?*]/.test(requestedTarget)
              || normalizedTarget === 'assets'
              || !normalizedTarget.startsWith('assets/')) {
              throw new Error('模板覆盖路径无效');
            }
            const extension = path.posix.extname(normalizedTarget).toLocaleLowerCase();
            const expectedMime = extension === '.png' ? 'png'
              : extension === '.jpg' || extension === '.jpeg' ? 'jpeg'
                : extension === '.webp' ? 'webp' : '';
            if (!expectedMime || expectedMime !== match[1]) throw new Error('模板图片格式与原文件扩展名不一致');
            relativePath = normalizedTarget;
          } else if (match[1] !== 'png') {
            throw new Error('新模板必须使用 PNG 格式');
          }
          const outputPath = path.resolve(this.getProjectRoot(), relativePath);
          const root = path.resolve(this.getProjectRoot());
          if (outputPath !== root && !outputPath.startsWith(root + path.sep)) throw new Error('模板路径无效');
          await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(outputPath)));
          await vscode.workspace.fs.writeFile(vscode.Uri.file(outputPath), Buffer.from(match[2], 'base64'));
          void this.panel.webview.postMessage({ type: 'templateSaved', requestId, nodeId, key, path: relativePath });
        } catch (error) {
          void this.panel.webview.postMessage({ type: 'roiPickerError', requestId, message: error instanceof Error ? error.message : String(error) });
        }
        break;
      }
      case 'saveCanvasImage': {
        const dataUrl = String(message.dataUrl ?? '');
        const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
        if (!match) {
          void this.panel.webview.postMessage({ type: 'canvasImageError', message: '画布图片数据无效' });
          break;
        }
        let filename = String(message.filename ?? 'workflow-layout.png')
          .replace(/[\\/\x00-\x1f<>:"|?*]/g, '_')
          .trim();
        if (!filename || filename === '.' || filename === '..') filename = 'workflow-layout.png';
        if (!/\.png$/i.test(filename)) filename += '.png';
        const defaultDirectory = this.docUri ? path.dirname(this.docUri.fsPath) : this.getProjectRoot();
        const destination = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(defaultDirectory, filename)),
          filters: { 'PNG 图片': ['png'] },
          saveLabel: '保存画布图片',
          title: '导出完整工作流画布',
        });
        if (!destination) {
          void this.panel.webview.postMessage({ type: 'canvasImageCancelled' });
          break;
        }
        try {
          await vscode.workspace.fs.writeFile(destination, Buffer.from(match[1], 'base64'));
          void this.panel.webview.postMessage({ type: 'canvasImageSaved', path: destination.fsPath });
          vscode.window.setStatusBarMessage(`工作流完整画布已导出：${path.basename(destination.fsPath)}`, 4000);
        } catch (error) {
          void this.panel.webview.postMessage({
            type: 'canvasImageError',
            message: error instanceof Error ? error.message : String(error),
          });
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

  private async listAssetImages(webview: vscode.Webview): Promise<AssetImageInfo[]> {
    const projectRoot = path.resolve(this.getProjectRoot());
    const assetsRoot = path.join(projectRoot, 'assets');
    const supported = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
    const images: AssetImageInfo[] = [];

    const visit = async (directory: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && directory === assetsRoot) return;
        throw error;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
      for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(absolutePath);
        } else if (entry.isFile() && supported.has(path.extname(entry.name).toLowerCase())) {
          images.push({
            path: path.relative(projectRoot, absolutePath).split(path.sep).join('/'),
            uri: webview.asWebviewUri(vscode.Uri.file(absolutePath)).toString(),
          });
        }
      }
    };

    await visit(assetsRoot);
    return images;
  }

  /** 读取项目内 assets 图片并返回 base64 data URL，供完整画布导出内嵌缩略图。 */
  private async readAssetDataUrls(paths: string[]): Promise<Array<{ path: string; dataUrl: string }>> {
    const projectRoot = path.resolve(this.getProjectRoot());
    const assetsRoot = path.join(projectRoot, 'assets');
    const supported = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
    const mimeByExtension = new Map([
      ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
      ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.bmp', 'image/bmp'],
    ]);
    const items: Array<{ path: string; dataUrl: string }> = [];
    for (const raw of paths.slice(0, 64)) {
      const relative = raw.replace(/\\/g, '/').trim();
      if (!relative.startsWith('assets/') || relative.includes('..')) continue;
      const absolutePath = path.resolve(projectRoot, relative);
      if (!absolutePath.startsWith(assetsRoot + path.sep)) continue;
      const extension = path.extname(absolutePath).toLowerCase();
      if (!supported.has(extension)) continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
        if (bytes.byteLength > 8 * 1024 * 1024) continue;
        const dataUrl = `data:${mimeByExtension.get(extension)};base64,${Buffer.from(bytes).toString('base64')}`;
        items.push({ path: relative, dataUrl });
      } catch {
        // 单个文件读取失败只跳过该缩略图，不阻断整次导出。
      }
    }
    return items;
  }

  /** 开始监听运行事件文件（引擎写入 JSONL，本方法尾随并转发给 webview）。 */
  startRunWatcher(filePath: string): void {
    this.stopRunWatcher();
    this.runEventsPath = filePath;
    this.runWatcherOffset = 0;
    this.runWatcherTimer = setInterval(() => this.tickRunWatcher(), 400);
  }

  /** 引擎进程退出前会等待后台奖励统计；退出后读完尾部事件再停止监听。 */
  finishRunWatcher(): void {
    if (!this.runEventsPath) return;
    this.tickRunWatcher();
    if (this.runStopTimer !== undefined) clearTimeout(this.runStopTimer);
    this.runStopTimer = setTimeout(() => {
      this.tickRunWatcher();
      this.stopRunWatcher();
    }, 1500);
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
    if ((event.type === 'step' || event.type === 'reward_stats') && typeof event.screenshot === 'string' && this.panel) {
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
    this.onRunEvent(event);
    if (this.panel) {
      void this.panel.webview.postMessage({ type: 'runEvent', event: this.convertRunEvent(event) });
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
