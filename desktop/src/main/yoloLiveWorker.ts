import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pythonUtf8Environment, resolvePythonRuntime } from './core/runtimeInstances';

export interface YoloLiveDetection {
  classId: number;
  label: string;
  confidence: number;
  box: [number, number, number, number];
}

export interface YoloLiveResult {
  model: string;
  device: string;
  inferenceMs: number;
  detections: YoloLiveDetection[];
}

type PendingRequest = { resolve: (value: YoloLiveResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/** A single long lived Python process keeps the CUDA model warm between live frames. */
export class YoloLiveWorker {
  private child: ChildProcess | undefined;
  private modelPath = '';
  private stdoutBuffer = '';
  private startup: Promise<void> | undefined;
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: Error) => void) | undefined;
  private device = '';
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly projectRoot: string) {}

  async detect(modelPath: string, image: string, confidence: number): Promise<YoloLiveResult> {
    const absoluteModel = path.resolve(this.projectRoot, modelPath);
    if (absoluteModel !== this.modelPath || !this.isRunning()) await this.start(absoluteModel);
    const child = this.child;
    if (!child?.stdin || !this.isRunning()) throw new Error('YOLO 检测进程未就绪。');
    const id = this.nextId++;
    return new Promise<YoloLiveResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('YOLO 检测响应超时。'));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin!.write(`${JSON.stringify({ id, image, confidence })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.startup = undefined;
    this.modelPath = '';
    this.stdoutBuffer = '';
    this.readyResolve = undefined;
    this.readyReject = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('YOLO 实时监测已停止。'));
    }
    this.pending.clear();
    if (!child || child.exitCode !== null) return;
    child.kill();
  }

  private isRunning(): boolean {
    return Boolean(this.child && this.child.exitCode === null);
  }

  private async start(modelPath: string): Promise<void> {
    await this.stop();
    this.modelPath = modelPath;
    const venvPython = path.join(this.projectRoot, '.venv', 'Scripts', 'python.exe');
    const python = fs.existsSync(venvPython) ? venvPython : resolvePythonRuntime(this.projectRoot);
    const child = spawn(python, ['-m', 'src.oooonmyoji.tools.yolo_live_worker', '--model', modelPath], {
      cwd: this.projectRoot,
      env: pythonUtf8Environment(process.env, this.projectRoot),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.stdoutBuffer = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: Buffer | string) => this.consumeOutput(String(chunk)));
    let stderrTail = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: Buffer | string) => { stderrTail = `${stderrTail}${String(chunk)}`.slice(-5000); });
    child.once('error', (error) => this.fail(error));
    child.once('exit', (code) => {
      const error = new Error(stderrTail.trim() || `YOLO 检测进程退出（代码 ${code ?? '未知'}）。`);
      if (this.child === child) this.child = undefined;
      this.readyReject?.(error);
      this.failPending(error);
    });
    this.startup = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error('YOLO 模型加载超时。');
        this.readyReject?.(error);
        child.kill();
        reject(error);
      }, 90_000);
      this.readyResolve = () => { clearTimeout(timer); resolve(); };
      this.readyReject = (error) => { clearTimeout(timer); reject(error); };
      child.once('spawn', () => undefined);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    return this.startup;
  }

  private consumeOutput(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline: number;
    while ((newline = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message: Record<string, unknown>;
      try { message = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      if (message.type === 'ready') {
        this.device = typeof message.device === 'string' ? message.device : 'CUDA';
        this.readyResolve?.();
        this.readyResolve = undefined;
        this.readyReject = undefined;
        return;
      }
      if (message.type === 'fatal') {
        const error = new Error(typeof message.error === 'string' ? message.error : 'YOLO 模型加载失败。');
        this.readyReject?.(error);
        this.readyReject = undefined;
        if (this.child) {
          this.child.kill();
          this.child = undefined;
        }
        return;
      }
      const id = Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (message.type === 'error') {
        pending.reject(new Error(typeof message.error === 'string' ? message.error : 'YOLO 检测失败。'));
      } else {
        pending.resolve({
          model: this.modelPath,
          device: this.device,
          inferenceMs: Number(message.inferenceMs) || 0,
          detections: Array.isArray(message.detections) ? message.detections as YoloLiveDetection[] : [],
        });
      }
    }
  }

  private fail(error: Error): void {
    this.readyReject?.(error);
    this.readyReject = undefined;
    this.failPending(error);
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
