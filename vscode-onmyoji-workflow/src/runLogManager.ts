/** Dedicated structured run log webview. */

import * as fs from 'fs';
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
  sources?: RunSourceDescriptor[];
}

export interface RunSourceDescriptor {
  id: string;
  label: string;
  workflow: string;
  instance: string;
  startedAt: number;
  status: string;
}

interface EventFileSource {
  id: string;
  filePath: string;
  offset: number;
  remainder: string;
}

export class RunLogManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private events: Record<string, unknown>[] = [];
  private engineOutput = '';
  private descriptor: RunDescriptor | undefined;
  private processResult: { code: number | null; signal: string | null; stopped: boolean } | undefined;
  private disposables: vscode.Disposable[] = [];
  private eventSources = new Map<string, EventFileSource>();
  private eventSourceTimer: NodeJS.Timeout | undefined;
  private eventSourceStopTimer: NodeJS.Timeout | undefined;

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
    this.stopEventSources();
    this.events = [];
    this.engineOutput = '';
    this.processResult = undefined;
    this.descriptor = { workflow, instance, startedAt: Date.now(), status: 'starting' };
    // 运行开始不自动弹出日志窗口；若用户已手动打开过日志面板，仅刷新其内容。
    if (this.panel) {
      await this.sendInit();
    }
  }

  async beginMultiRun(workflow: string, sources: Array<Omit<RunSourceDescriptor, 'startedAt' | 'status'>>): Promise<void> {
    this.stopEventSources();
    this.events = [];
    this.engineOutput = '';
    this.processResult = undefined;
    const startedAt = Date.now();
    this.descriptor = {
      workflow,
      instance: `${sources.length} 个实例`,
      startedAt,
      status: 'starting',
      sources: sources.map((source) => ({ ...source, startedAt, status: 'starting' })),
    };
    // 运行开始不自动弹出日志窗口；若用户已手动打开过日志面板，仅刷新其内容。
    if (this.panel) {
      await this.sendInit();
    }
  }

  acceptEvent(event: Record<string, unknown>, sourceId?: string): void {
    const tagged = sourceId ? { ...event, log_source: sourceId } : event;
    this.events.push(tagged);
    if (this.events.length > 5000) this.events.shift();
    if (event.type === 'run_started' && this.descriptor) this.updateSourceStatus(sourceId, 'running');
    if (event.type === 'run_finished' && this.descriptor && typeof event.status === 'string') {
      this.updateSourceStatus(sourceId, event.status);
    }
    if (this.panel) {
      void this.panel.webview.postMessage({ type: 'runEvent', event: this.convertEvent(tagged) });
    }
  }

  startEventSources(sources: Array<{ id: string; filePath: string }>): void {
    this.stopEventSources();
    for (const source of sources) {
      this.eventSources.set(source.id, { ...source, offset: 0, remainder: '' });
    }
    this.eventSourceTimer = setInterval(() => this.tickEventSources(), 400);
  }

  finishEventSources(): void {
    if (this.eventSources.size === 0) return;
    this.tickEventSources();
    if (this.eventSourceStopTimer !== undefined) clearTimeout(this.eventSourceStopTimer);
    this.eventSourceStopTimer = setTimeout(() => {
      this.tickEventSources();
      this.stopEventSources();
    }, 1500);
  }

  appendOutput(chunk: string, stream: 'stdout' | 'stderr'): void {
    if (!chunk) return;
    this.engineOutput += chunk;
    if (this.engineOutput.length > 300_000) this.engineOutput = this.engineOutput.slice(-300_000);
    if (this.panel) void this.panel.webview.postMessage({ type: 'engineOutput', chunk, stream });
  }

  finishProcess(code: number | null, signal: string | null, stopped: boolean): void {
    this.processResult = { code, signal, stopped };
    const status = stopped ? 'cancelled' : code === 0 ? 'succeeded' : 'failed';
    if (this.descriptor) {
      this.descriptor.status = status;
      const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
      for (const source of this.descriptor.sources ?? []) {
        if (!terminal.has(source.status)) source.status = status;
      }
    }
    if (this.panel) {
      void this.panel.webview.postMessage({ type: 'processFinished', code, signal, stopped });
    }
  }

  private updateSourceStatus(sourceId: string | undefined, status: string): void {
    if (!this.descriptor) return;
    this.descriptor.status = status;
    const source = this.descriptor.sources?.find((item) => item.id === sourceId);
    if (source) source.status = status;
  }

  private stopEventSources(): void {
    if (this.eventSourceStopTimer !== undefined) {
      clearTimeout(this.eventSourceStopTimer);
      this.eventSourceStopTimer = undefined;
    }
    if (this.eventSourceTimer !== undefined) {
      clearInterval(this.eventSourceTimer);
      this.eventSourceTimer = undefined;
    }
    this.eventSources.clear();
  }

  private tickEventSources(): void {
    for (const source of this.eventSources.values()) {
      let size: number;
      try {
        size = fs.statSync(source.filePath).size;
      } catch {
        continue;
      }
      if (size < source.offset) {
        source.offset = 0;
        source.remainder = '';
      }
      if (size === source.offset) continue;
      let chunk: string;
      try {
        const fd = fs.openSync(source.filePath, 'r');
        try {
          const buffer = Buffer.alloc(size - source.offset);
          fs.readSync(fd, buffer, 0, buffer.length, source.offset);
          chunk = source.remainder + buffer.toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
        source.offset = size;
      } catch {
        continue;
      }
      const lines = chunk.split('\n');
      source.remainder = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.acceptEvent(JSON.parse(line) as Record<string, unknown>, source.id);
        } catch {
          // Ignore incomplete or invalid event lines; the next complete line can still be read.
        }
      }
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
<nav id="source-tabs" class="source-tabs hidden" role="tablist" aria-label="并行实例"></nav>
<section id="summary">
  <div class="status-block"><span id="status-dot"></span><span id="status-label">待命</span><strong id="elapsed">00:00.0</strong></div>
  <div class="metric"><span>已完成</span><strong id="completed-count">0</strong></div>
  <div class="metric"><span>失败</span><strong id="failed-count">0</strong></div>
  <div class="metric current"><span>当前节点</span><strong id="current-step">-</strong></div>
  <div id="progress"><span></span></div>
</section>
<section id="reward-summary" class="hidden" aria-label="本次材料统计">
  <span class="reward-label">本次材料</span>
  <div id="reward-totals"></div>
  <span id="reward-battles">0 局</span>
</section>
<main>
  <section id="steps-view">
    <div id="filters" class="filterbar"><button data-filter="tasks" class="active">任务</button><button data-filter="all">全部</button><button data-filter="failed">失败</button></div>
    <div id="empty-state">暂无运行记录</div>
    <div id="cap-note" class="hidden"></div>
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
    this.stopEventSources();
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
