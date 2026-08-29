/** Dedicated structured run log webview. */

import * as path from 'path';
import * as vscode from 'vscode';

interface WebviewPayload {
  type: string;
  [key: string]: unknown;
}

interface RunDescriptor {
  workflow: string;
  instance: string;
  startedAt: number;
  status: string;
}

export class RunLogManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private events: Record<string, unknown>[] = [];
  private engineOutput = '';
  private descriptor: RunDescriptor | undefined;
  private processResult: { code: number | null; signal: string | null; stopped: boolean } | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private getProjectRoot: () => string,
  ) {}

  async open(preserveFocus = false): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, preserveFocus);
      await this.sendInit();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'onmyojiRunLog',
      'Onmyoji 运行日志',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
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
        this.panel = undefined;
        this.disposePanelSubscriptions();
      }),
    );
  }

  async beginRun(workflow: string, instance: string): Promise<void> {
    this.events = [];
    this.engineOutput = '';
    this.processResult = undefined;
    this.descriptor = { workflow, instance, startedAt: Date.now(), status: 'starting' };
    await this.open(true);
    await this.sendInit();
  }

  acceptEvent(event: Record<string, unknown>): void {
    this.events.push(event);
    if (this.events.length > 5000) this.events.shift();
    if (event.type === 'run_started' && this.descriptor) this.descriptor.status = 'running';
    if (event.type === 'run_finished' && this.descriptor && typeof event.status === 'string') {
      this.descriptor.status = event.status;
    }
    if (this.panel) {
      void this.panel.webview.postMessage({ type: 'runEvent', event: this.convertEvent(event) });
    }
  }

  appendOutput(chunk: string, stream: 'stdout' | 'stderr'): void {
    if (!chunk) return;
    this.engineOutput += chunk;
    if (this.engineOutput.length > 300_000) this.engineOutput = this.engineOutput.slice(-300_000);
    if (this.panel) void this.panel.webview.postMessage({ type: 'engineOutput', chunk, stream });
  }

  finishProcess(code: number | null, signal: string | null, stopped: boolean): void {
    this.processResult = { code, signal, stopped };
    if (this.descriptor && stopped) this.descriptor.status = 'cancelled';
    if (this.panel) {
      void this.panel.webview.postMessage({ type: 'processFinished', code, signal, stopped });
    }
  }

  private async sendInit(): Promise<void> {
    if (!this.panel) return;
    await this.panel.webview.postMessage({
      type: 'init',
      descriptor: this.descriptor,
      events: this.events.map((event) => this.convertEvent(event)),
      engineOutput: this.engineOutput,
      processResult: this.processResult,
    });
  }

  private convertEvent(event: Record<string, unknown>): Record<string, unknown> {
    const converted = { ...event };
    if (typeof event.screenshot === 'string' && this.panel) {
      try {
        converted.screenshot = this.panel.webview.asWebviewUri(vscode.Uri.file(event.screenshot)).toString();
      } catch {
        // Keep the original value when the artifact path cannot be converted.
      }
    }
    return converted;
  }

  private async onMessage(message: WebviewPayload): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.sendInit();
        break;
      case 'stopWorkflow':
        await vscode.commands.executeCommand('onmyoji.stopWorkflow');
        break;
      case 'clear':
        this.events = [];
        this.engineOutput = '';
        this.processResult = undefined;
        if (this.panel) void this.panel.webview.postMessage({ type: 'cleared' });
        break;
      default:
        break;
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const media = vscode.Uri.file(path.join(this.context.extensionPath, 'media'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'run-log.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'run-log.js'));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<title>Onmyoji 运行日志</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<header id="topbar">
  <div class="identity"><span class="mark">RUN</span><div><div id="workflow-name">尚未运行</div><div id="run-meta">等待工作流</div></div></div>
  <div class="spacer"></div>
  <div class="segmented" role="tablist"><button id="tab-steps" class="active" role="tab">步骤</button><button id="tab-engine" role="tab">引擎输出</button></div>
  <label class="auto-scroll"><input id="auto-scroll" type="checkbox" checked> 自动滚动</label>
  <button id="btn-stop" class="icon-button danger" title="停止当前工作流" aria-label="停止当前工作流">■</button>
  <button id="btn-clear" class="icon-button" title="清空日志" aria-label="清空日志">⌫</button>
</header>
<section id="summary">
  <div class="status-block"><span id="status-dot"></span><span id="status-label">待命</span><strong id="elapsed">00:00.0</strong></div>
  <div class="metric"><span>已完成</span><strong id="completed-count">0</strong></div>
  <div class="metric"><span>失败</span><strong id="failed-count">0</strong></div>
  <div class="metric current"><span>当前节点</span><strong id="current-step">-</strong></div>
  <div id="progress"><span></span></div>
</section>
<main>
  <section id="steps-view">
    <div id="filters" class="filterbar"><button data-filter="tasks" class="active">任务</button><button data-filter="all">全部</button><button data-filter="failed">失败</button></div>
    <div id="empty-state">暂无运行记录</div>
    <div id="step-list"></div>
  </section>
  <section id="engine-view" class="hidden"><pre id="engine-output"></pre></section>
</main>
<div id="lightbox" class="hidden"><button id="lightbox-close" class="icon-button" title="关闭">×</button><img id="lightbox-image" alt="运行截图"></div>
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

