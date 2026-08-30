/** 工作流引用查看器：展示某个工作流引用了哪些 JSON 脚本，以及自己被谁引用。 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
  WorkflowFileDescriptor,
  collectWorkflowRunReferences,
  resolveWorkflowReference,
} from './workflow';

interface WebviewPayload {
  type: string;
  [key: string]: unknown;
}

/** 一条已解析到文件的引用（来源节点 + 目标/来源文件）。 */
interface EntryPayload {
  nodeId: string;
  nodeName?: string;
  reference: string;
  uri: string;
  name: string;
}

/** 反向引用按引用者文件分组。 */
interface IncomingGroupPayload {
  source: { uri: string; name: string };
  entries: EntryPayload[];
}

/** 解析不到文件的悬空引用（提示用）。 */
interface UnresolvedPayload {
  nodeId: string;
  nodeName?: string;
  reference: string;
}

interface StatePayload {
  workflows: WorkflowFileDescriptor[];
  currentUri: string;
  currentName: string;
  outgoing: EntryPayload[];
  incoming: IncomingGroupPayload[];
  unresolved: UnresolvedPayload[];
}

export class ReferenceViewerManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private currentUri: string | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private getProjectRoot: () => string,
  ) {}

  /** 打开引用查看器；`uri` 指定初始查看的工作流文件（缺省选中第一项）。 */
  async open(preserveFocus = false, uri?: string): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, preserveFocus);
      if (uri) this.currentUri = uri;
      await this.pushState();
      return;
    }
    if (uri) this.currentUri = uri;
    this.panel = vscode.window.createWebviewPanel(
      'onmyojiWorkflowReferences',
      'Onmyoji 工作流引用',
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
      case 'openWorkflow': {
        const uri = String(message.uri ?? '');
        if (!uri) break;
        await vscode.commands.executeCommand('onmyoji.openWorkflowEditor', vscode.Uri.parse(uri));
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
    const pattern = vscode.workspace.getConfiguration('onmyoji').get<string>('workflowFiles', '**/workflows/*.json');
    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 200);
    return files
      .map((f) => ({ uri: f.toString(), name: path.basename(f.fsPath), rel: vscode.workspace.asRelativePath(f) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.rel.localeCompare(b.rel, 'zh-CN'));
  }

  private async readText(fileUri: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(fileUri));
    return Buffer.from(bytes).toString('utf8');
  }

  private async computeState(): Promise<StatePayload> {
    const files = await this.listWorkflowFiles();
    const empty: StatePayload = { workflows: files, currentUri: '', currentName: '', outgoing: [], incoming: [], unresolved: [] };
    const current = files.find((file) => file.uri === this.currentUri) ?? files[0];
    if (!current) return empty;

    // 每个文件只读取/解析一次：正向解析、ID 回退与反向扫描共用。
    const textCache = new Map<string, string>();
    const textOf = async (fileUri: string): Promise<string> => {
      const cached = textCache.get(fileUri);
      if (cached !== undefined) return cached;
      let text = '';
      try {
        text = await this.readText(fileUri);
      } catch {
        text = '';
      }
      textCache.set(fileUri, text);
      return text;
    };
    const rawOf = async (fileUri: string): Promise<unknown> => {
      try {
        return JSON.parse(await textOf(fileUri));
      } catch {
        return null;
      }
    };
    const resolve = (reference: string): Promise<string | undefined> => (
      resolveWorkflowReference(reference, files, (fileUri) => textOf(fileUri))
    );

    const outgoing: EntryPayload[] = [];
    const unresolved: UnresolvedPayload[] = [];
    for (const entry of collectWorkflowRunReferences(await rawOf(current.uri))) {
      const target = await resolve(entry.reference);
      if (!target) {
        unresolved.push({ nodeId: entry.nodeId, nodeName: entry.nodeName, reference: entry.reference });
        continue;
      }
      const targetFile = files.find((file) => file.uri === target);
      outgoing.push({
        nodeId: entry.nodeId,
        nodeName: entry.nodeName,
        reference: entry.reference,
        uri: target,
        name: targetFile ? targetFile.rel : vscode.workspace.asRelativePath(vscode.Uri.parse(target)),
      });
    }

    // 反向引用：扫描其余工作流文件，找出引用本文文件的 workflow.run 节点。
    const bySource = new Map<string, { file: WorkflowFileDescriptor; entries: EntryPayload[] }>();
    for (const file of files) {
      if (file.uri === current.uri) continue;
      const references = collectWorkflowRunReferences(await rawOf(file.uri));
      for (const entry of references) {
        const target = await resolve(entry.reference);
        if (target !== current.uri) continue;
        const group = bySource.get(file.uri) ?? { file, entries: [] };
        group.entries.push({
          nodeId: entry.nodeId,
          nodeName: entry.nodeName,
          reference: entry.reference,
          uri: file.uri,
          name: file.rel,
        });
        bySource.set(file.uri, group);
      }
    }
    const incoming: IncomingGroupPayload[] = [...bySource.values()].map((group) => ({
      source: { uri: group.file.uri, name: group.file.rel },
      entries: group.entries,
    }));

    return {
      workflows: files,
      currentUri: current.uri,
      currentName: current.rel,
      outgoing,
      incoming,
      unresolved,
    };
  }

  private buildHtml(webview: vscode.Webview): string {
    const media = vscode.Uri.file(path.join(this.context.extensionPath, 'media'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'reference-viewer.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'reference-viewer.js'));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<title>Onmyoji 工作流引用</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<header id="topbar">
  <div class="identity"><span class="mark">REF</span><div><div id="workflow-name">尚未选择</div><div id="workflow-path"></div></div></div>
  <label class="picker">
    <select id="workflow-select" aria-label="工作流"></select>
  </label>
  <div class="spacer"></div>
  <button id="btn-refresh" class="icon-button" title="重新扫描引用" aria-label="重新扫描引用">⟳</button>
</header>
<section id="summary">
  <div class="metric"><span>引用脚本</span><strong id="outgoing-count">0</strong><span class="metric-sub" id="outgoing-total"></span></div>
  <div class="metric"><span>被谁引用</span><strong id="incoming-count">0</strong><span class="metric-sub" id="incoming-total"></span></div>
  <div class="metric current"><span>悬空引用</span><strong id="unresolved-count">0</strong></div>
</section>
<main>
  <svg id="graph" xmlns="http://www.w3.org/2000/svg" aria-label="工作流引用图"></svg>
  <div id="empty-state" class="hidden">未找到工作流文件</div>
  <div id="tooltip" class="hidden" role="tooltip"></div>
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

function getNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return value;
}