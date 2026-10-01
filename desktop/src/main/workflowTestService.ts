import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { pythonUtf8Environment, resolvePythonRuntime } from './core/runtimeInstances';
import type { WorkflowTestRequest, WorkflowTestEvent, TestCommand } from '../shared/workflow-testing';

/** One isolated test process at a time, with a cooperative debugger command channel. */
export class WorkflowTestService extends EventEmitter<{ event: [WorkflowTestEvent] }> {
  private child: ChildProcess | undefined;
  private stopTimer: NodeJS.Timeout | undefined;
  reportPath = '';
  private live = false;
  private ready = false;
  private pendingCommands: TestCommand[] = [];

  constructor(private readonly projectRoot: string, private readonly launch: typeof spawn = spawn) { super(); }

  get running(): boolean { return Boolean(this.child); }
  get usingDevice(): boolean { return this.running && this.live; }

  start(request: WorkflowTestRequest): Promise<void> {
    if (this.running) throw new Error('测试正在运行，请先停止');
    if (!request || typeof request.text !== 'string' || !request.text.trim()) throw new Error('没有可测试的工作流');
    if (!['live', 'offline'].includes(request.mode)) throw new Error('无效的测试模式');
    if (!Number.isInteger(request.rounds) || request.rounds < 1 || request.rounds > 100) throw new Error('重复次数必须为 1–100');
    this.reportPath = '';
    this.live = request.mode === 'live';
    this.ready = false;
    this.pendingCommands = [];
    const configured = path.join(this.projectRoot, 'config', 'config.json');
    const config = fs.existsSync(configured) ? configured : path.join(this.projectRoot, 'config', 'config.example.json');
    const child = this.launch(resolvePythonRuntime(this.projectRoot), ['-m', 'src.oooonmyoji.tools.workflow_test', '--config', config], {
      cwd: this.projectRoot, env: pythonUtf8Environment(process.env, this.projectRoot),
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    let buffer = '', stderr = '', finished = false;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdin?.on('error', () => {}); // A process can exit while a stop command is in flight.
    child.stdout?.on('data', (chunk: string) => {
      if (this.child !== child) return;
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const event = JSON.parse(line) as WorkflowTestEvent;
          if (!event || typeof event.type !== 'string') continue;
          if (event.type === 'finished') {
            finished = true;
            if (typeof event.report === 'string') this.reportPath = event.report;
          }
          this.emit('event', event);
        } catch { /* Only complete JSON events enter the renderer. */ }
      }
    });
    child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000); });
    const close = (message?: string): void => {
      if (this.child !== child) return;
      this.child = undefined;
      clearTimeout(this.stopTimer); this.stopTimer = undefined;
      if (!finished) this.emit('event', { type: 'finished', error: message || stderr || '测试进程已退出' });
      this.emit('event', { type: 'idle' });
    };
    child.once('error', (error) => close(error.message));
    child.once('close', () => close());
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => {
        child.stdin?.write(`${JSON.stringify(request)}\n`);
        this.ready = true;
        for (const command of this.pendingCommands) child.stdin?.write(`${JSON.stringify({ command })}\n`);
        this.pendingCommands = [];
        resolve();
      });
    });
  }

  command(command: TestCommand): void {
    if (!['pause', 'step', 'continue', 'stop'].includes(command)) throw new Error('无效的调试命令');
    const child = this.child;
    if (!child) return;
    if (this.ready) child.stdin?.write(`${JSON.stringify({ command })}\n`);
    else this.pendingCommands.push(command);
    if (command === 'stop' && !this.stopTimer) {
      this.stopTimer = setTimeout(() => { if (this.child === child) child.kill(); }, 5000);
    }
  }

  async dispose(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.command('stop');
    await new Promise<void>((resolve) => child.once('close', () => resolve()));
  }
}
