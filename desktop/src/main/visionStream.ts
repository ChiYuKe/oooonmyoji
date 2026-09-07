import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { VisionCommand, VisionStreamEvent } from '../shared/contracts';
import { pythonUtf8Environment } from './core/runtimeInstances';

export interface VisionStreamExit {
  code: number | null;
  fatal: string;
}

/**
 * 长驻的模拟器画面推流服务：spawn 一个 Python 进程，按新行 JSON 协议把
 * 画面帧、匹配结果、点击结果等事件转发给桌面端；桌面端通过 stdin 下发命令。
 */
export class VisionStream extends EventEmitter<{
  event: [VisionStreamEvent];
  exit: [VisionStreamExit];
}> {
  private child: ChildProcess | undefined;
  private stdoutBuffer = '';
  private stderrTail = '';
  private stopped = false;
  private readonly pythonPath: string;
  private readonly configPath: string;

  constructor(
    private readonly projectRoot: string,
    private readonly instanceId: string,
  ) {
    super();
    const venv = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
    this.pythonPath = fs.existsSync(venv) ? venv : 'python';
    const configured = path.join(projectRoot, 'config', 'config.json');
    this.configPath = fs.existsSync(configured) ? configured : path.join(projectRoot, 'config', 'config.example.json');
  }

  get running(): boolean {
    return Boolean(this.child && this.child.exitCode === null);
  }

  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    this.stopped = false;
    this.stderrTail = '';
    const child = spawn(this.pythonPath, [
      '-m', 'src.oooonmyoji.tools.vision_stream',
      '--config', this.configPath,
      '--instance', this.instanceId || 'mumu-0',
    ], {
      cwd: this.projectRoot,
      env: pythonUtf8Environment(process.env),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: Buffer | string) => {
      this.stdoutBuffer += String(chunk);
      let newline: number;
      while ((newline = this.stdoutBuffer.indexOf('\n')) >= 0) {
        const line = this.stdoutBuffer.slice(0, newline).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as unknown;
          if (parsed && typeof parsed === 'object' && typeof (parsed as VisionStreamEvent).type === 'string') {
            this.emit('event', parsed as VisionStreamEvent);
          }
        } catch {
          // 忽略半行或非 JSON 输出（例如 Python 直接打印的告警）。
        }
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: Buffer | string) => {
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-4000);
    });
    child.once('error', (error) => {
      if (this.child === child) this.child = undefined;
      this.emit('exit', { code: null, fatal: error.message });
    });
    child.once('exit', (code) => {
      if (this.child === child) this.child = undefined;
      const fatal = !this.stopped && code !== 0 ? (this.stderrTail.trim() || `推流进程退出（代码 ${code ?? '未知'}）`) : '';
      this.emit('exit', { code, fatal });
    });
    return new Promise((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', reject);
    });
  }

  sendCommand(command: VisionCommand): boolean {
    if (!this.running || !command || typeof command !== 'object') return false;
    this.child?.stdin?.write(`${JSON.stringify(command)}\n`);
    return true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = undefined;
      return;
    }
    try {
      child.stdin?.end();
    } catch {
      // 子进程已退出时写入可能抛错，忽略。
    }
    if (process.platform === 'win32' && child.pid) {
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => {
          child.kill();
          resolve();
        });
        killer.once('close', (code) => {
          if (code !== 0 && child.exitCode === null) child.kill();
          resolve();
        });
      });
    } else {
      child.kill('SIGTERM');
    }
  }
}
