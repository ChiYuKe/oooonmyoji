import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  RoiCaptureRequest,
  RoiCaptureResult,
  RunWorkflowRequest,
  RuntimeInstance,
  RuntimeOutputEvent,
  RuntimeStateEvent,
  TemplateCheckRequest,
  TemplateCheckResult,
} from '../shared/contracts';
import { parseRuntimeInstances, pythonUtf8Environment } from './core/runtimeInstances';
import type { ProjectService } from './projectService';

interface RuntimeEvents {
  output: [RuntimeOutputEvent];
  state: [RuntimeStateEvent];
  runEvent: [Record<string, unknown>];
}

function readJsonObject(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

export class RuntimeService extends EventEmitter<RuntimeEvents> {
  private activeProcess: ChildProcess | undefined;
  private stopRequested = false;
  private watchTimer: NodeJS.Timeout | undefined;
  private watchedFiles = new Map<string, number>();

  constructor(private readonly project: ProjectService) {
    super();
  }

  private get pythonPath(): string {
    const venv = path.join(this.project.projectRoot, '.venv', 'Scripts', 'python.exe');
    return fs.existsSync(venv) ? venv : 'python';
  }

  private get configPath(): string {
    const configured = path.join(this.project.projectRoot, 'config', 'config.json');
    if (fs.existsSync(configured)) return configured;
    return path.join(this.project.projectRoot, 'config', 'config.example.json');
  }

  private get artifactDir(): string {
    let configured = 'artifacts';
    try {
      const raw = readJsonObject(this.configPath);
      if (typeof raw.artifact_dir === 'string' && raw.artifact_dir.trim()) configured = raw.artifact_dir;
    } catch {
      // The engine will report malformed configuration when a run starts.
    }
    return path.resolve(this.project.projectRoot, configured);
  }

  private emitOutput(stream: RuntimeOutputEvent['stream'], text: string): void {
    this.emit('output', { stream, text, timestamp: Date.now() });
  }

  private emitState(event: RuntimeStateEvent): void {
    this.emit('state', event);
  }

  private configuredInstances(): RuntimeInstance[] {
    try {
      const parsed = parseRuntimeInstances(readJsonObject(this.configPath));
      if (parsed.length > 0) return parsed;
    } catch {
      // Keep a usable fallback when configuration is not ready yet.
    }
    return [{ id: 'mumu-0' }];
  }

  async listInstances(): Promise<RuntimeInstance[]> {
    const fallback = this.configuredInstances();
    const args = ['-m', 'src.oooonmyoji.cli', '--config', this.configPath, 'list-instances'];
    return new Promise((resolve) => {
      const child = spawn(this.pythonPath, args, {
        cwd: this.project.projectRoot,
        env: pythonUtf8Environment(process.env),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      let settled = false;
      const finish = (instances?: RuntimeInstance[]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(instances && instances.length > 0 ? instances : fallback);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish();
      }, 6000);
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += String(chunk);
        if (stdout.length > 256_000) stdout = stdout.slice(-256_000);
      });
      child.once('error', () => finish());
      child.once('close', (code) => {
        if (code !== 0) return finish();
        try {
          finish(parseRuntimeInstances(JSON.parse(stdout) as unknown));
        } catch {
          finish();
        }
      });
    });
  }

  async runWorkflow(request: RunWorkflowRequest): Promise<void> {
    if (this.activeProcess && this.activeProcess.exitCode === null) throw new Error('已有工作流正在运行，请先停止');
    const workflowPath = this.project.resolveWorkflowPath(request.uri);
    const workflowReference = this.project.workflowReference(request.uri);
    await fs.promises.writeFile(workflowPath, request.text.endsWith('\n') ? request.text : `${request.text}\n`, 'utf8');

    let runs: Array<{ instance: string }> = [];
    try {
      const raw = JSON.parse(request.text) as { root?: string; nodes?: Array<{ id?: string; type?: string; children?: string[]; runs?: unknown }> };
      const root = raw.nodes?.find((node) => node.id === raw.root && node.type === 'root');
      const child = raw.nodes?.find((node) => node.id === root?.children?.[0]);
      if (child?.type === 'instance_parallel' && Array.isArray(child.runs)) {
        runs = child.runs.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
          const instance = (item as { instance?: unknown }).instance;
          return typeof instance === 'string' && instance ? [{ instance }] : [];
        });
      }
    } catch {
      // The engine will provide the detailed parse failure in stderr.
    }
    if (runs.length > 0) {
      const available = new Set((await this.listInstances()).map((item) => item.id));
      const missing = [...new Set(runs.map((item) => item.instance).filter((id) => !available.has(id)))];
      if (missing.length > 0) throw new Error(`未发现运行实例：${missing.join('、')}`);
    }

    const runDirectory = path.join(this.artifactDir, 'runs');
    await fs.promises.mkdir(runDirectory, { recursive: true });
    const stamp = Date.now();
    const eventsFile = path.join(runDirectory, `desktop-events-${stamp}.jsonl`);
    this.startWatching(runs.length > 0
      ? runs.map((item) => path.join(runDirectory, `desktop-events-${stamp}-${item.instance}.jsonl`))
      : [eventsFile]);
    const instance = request.instanceId || runs[0]?.instance || 'mumu-0';
    const args = [
      '-m', 'src.oooonmyoji.cli', '--config', this.configPath,
      'run-workflow', workflowReference,
      '--instance', instance,
      '--events-file', eventsFile,
    ];
    const child = spawn(this.pythonPath, args, {
      cwd: this.project.projectRoot,
      env: pythonUtf8Environment(process.env),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.activeProcess = child;
    this.stopRequested = false;
    const startedAt = Date.now();
    const label = `${path.basename(workflowPath)} · ${runs.length > 0 ? `${runs.length} 个实例` : instance}`;
    const sources = runs.length > 0 ? runs.map((run) => ({
      id: run.instance,
      label: run.instance,
      workflow: path.basename(workflowPath),
      instance: run.instance,
      startedAt,
      status: 'running',
    })) : undefined;
    this.emitState({ state: 'running', label, workflow: request.uri, instance, startedAt, sources });
    this.emitOutput('system', `启动工作流：${label}\n`);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: Buffer | string) => this.emitOutput('stdout', String(chunk)));
    child.stderr?.on('data', (chunk: Buffer | string) => this.emitOutput('stderr', String(chunk)));
    let launchFailed = false;
    child.once('error', (error) => {
      launchFailed = true;
      this.emitOutput('stderr', `启动失败：${error.message}\n`);
      this.finishWatching();
      if (this.activeProcess === child) this.activeProcess = undefined;
      this.emitState({ state: 'failed', label: '启动失败', workflow: request.uri, instance, exitCode: -1 });
    });
    child.once('close', (code) => {
      if (launchFailed) return;
      const stopped = this.stopRequested;
      this.emitOutput('system', `进程结束：${stopped ? '已停止' : `退出代码 ${code ?? '未知'}`}\n`);
      this.finishWatching();
      if (this.activeProcess === child) this.activeProcess = undefined;
      this.stopRequested = false;
      this.emitState({
        state: stopped ? 'idle' : code === 0 ? 'succeeded' : 'failed',
        label: stopped ? '已停止' : code === 0 ? '执行完成' : `执行失败 · ${code ?? '未知'}`,
        workflow: request.uri,
        instance,
        exitCode: code,
      });
    });
  }

  async stopWorkflow(): Promise<void> {
    const child = this.activeProcess;
    if (!child || child.exitCode !== null) return;
    this.stopRequested = true;
    this.emitState({ state: 'stopping', label: '正在停止...' });
    this.emitOutput('system', '正在停止工作流...\n');
    if (process.platform === 'win32' && child.pid) {
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => {
          child.kill();
          resolve();
        });
        killer.once('close', () => resolve());
      });
    } else {
      child.kill('SIGTERM');
    }
  }

  private startWatching(files: string[]): void {
    this.stopWatching();
    this.watchedFiles = new Map(files.map((file) => [file, 0]));
    this.watchTimer = setInterval(() => this.tickWatcher(), 350);
  }

  private finishWatching(): void {
    this.tickWatcher();
    setTimeout(() => {
      this.tickWatcher();
      this.stopWatching();
    }, 1400);
  }

  private stopWatching(): void {
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = undefined;
    this.watchedFiles.clear();
  }

  private tickWatcher(): void {
    for (const [file, offset] of this.watchedFiles) {
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {
        continue;
      }
      const start = size < offset ? 0 : offset;
      if (size === start) continue;
      try {
        const descriptor = fs.openSync(file, 'r');
        let chunk = '';
        try {
          const buffer = Buffer.alloc(size - start);
          fs.readSync(descriptor, buffer, 0, buffer.length, start);
          chunk = buffer.toString('utf8');
        } finally {
          fs.closeSync(descriptor);
        }
        this.watchedFiles.set(file, size);
        for (const line of chunk.split('\n')) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            if (typeof event.screenshot === 'string') {
              const uri = this.project.resourceUrl(event.screenshot);
              if (uri) event.screenshot = uri;
            }
            this.emit('runEvent', event);
          } catch {
            // Ignore a partial final line; the next poll will carry complete events.
          }
        }
      } catch {
        // A file can be replaced while the engine is appending; retry next poll.
      }
    }
  }

  private async runTool(args: string[], resultFile: string, timeoutMs: number): Promise<Record<string, unknown>> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.pythonPath, args, {
        cwd: this.project.projectRoot,
        env: pythonUtf8Environment(process.env),
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error('设备操作超时'));
      }, timeoutMs);
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
      });
      child.once('error', (error) => finish(error));
      child.once('close', (code) => {
        if (code !== 0 || !fs.existsSync(resultFile)) finish(new Error(stderr.trim() || `工具退出（代码 ${code ?? '未知'}）`));
        else finish();
      });
    });
    return readJsonObject(resultFile);
  }

  async captureRoi(request: RoiCaptureRequest): Promise<RoiCaptureResult> {
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oooonmyoji-desktop-roi-'));
    const resultFile = path.join(temporary, 'capture.json');
    try {
      const args = [
        '-m', 'src.oooonmyoji.tools.roi_editor',
        '--config', this.configPath,
        '--instance', request.instanceId || 'mumu-0',
        '--capture-only',
        '--result-file', resultFile,
        '--reference-width', String(request.referenceResolution[0]),
        '--reference-height', String(request.referenceResolution[1]),
      ];
      const parsed = await this.runTool(args, resultFile, 30_000);
      const imageSize = parsed.image_size;
      if (typeof parsed.image_base64 !== 'string' || !Array.isArray(imageSize) || imageSize.length !== 2) throw new Error('MuMu 截图返回了无效数据');
      return { dataUrl: `data:image/png;base64,${parsed.image_base64}`, width: Number(imageSize[0]), height: Number(imageSize[1]) };
    } finally {
      await fs.promises.rm(temporary, { recursive: true, force: true });
    }
  }

  async checkTemplate(request: TemplateCheckRequest): Promise<TemplateCheckResult> {
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oooonmyoji-desktop-check-'));
    const resultFile = path.join(temporary, 'result.json');
    try {
      const args = [
        '-m', 'src.oooonmyoji.tools.template_check',
        '--config', this.configPath,
        '--project-root', this.project.projectRoot,
        '--instance', request.instanceId || 'mumu-0',
        '--template', request.template,
        '--threshold', String(request.threshold),
        '--max-results', String(request.maxResults),
        '--reference-width', String(request.referenceResolution[0]),
        '--reference-height', String(request.referenceResolution[1]),
        '--result-file', resultFile,
      ];
      if (request.roi) args.push('--roi', ...request.roi.map(String));
      if (request.scaleSearch) args.push('--scale-search');
      const parsed = await this.runTool(args, resultFile, 30_000);
      const imageSize = parsed.image_size;
      const roi = parsed.roi_image;
      if (typeof parsed.image_base64 !== 'string' || !Array.isArray(imageSize) || imageSize.length !== 2
        || !Array.isArray(roi) || roi.length !== 4) throw new Error('模板检查返回了无效画面数据');
      const matches = (Array.isArray(parsed.matches) ? parsed.matches : []).map((value) => {
        const item = value as Record<string, unknown>;
        return {
          x: Number(item.x), y: Number(item.y), width: Number(item.width), height: Number(item.height), confidence: Number(item.confidence),
        };
      });
      return {
        dataUrl: `data:image/png;base64,${parsed.image_base64}`,
        width: Number(imageSize[0]),
        height: Number(imageSize[1]),
        roi: [Number(roi[0]), Number(roi[1]), Number(roi[2]), Number(roi[3])],
        matches,
      };
    } finally {
      await fs.promises.rm(temporary, { recursive: true, force: true });
    }
  }

  dispose(): void {
    this.stopWatching();
    if (this.activeProcess?.exitCode === null) this.activeProcess.kill();
  }
}
