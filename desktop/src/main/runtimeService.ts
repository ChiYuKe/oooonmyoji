import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  RoiCaptureRequest,
  RoiCaptureResult,
  RunWorkflowRequest,
  RuntimeDebugSettings,
  DuelScreenCapture,
  DuelScreenRoi,
  DuelScreenRecognition,
  RuntimeInstance,
  RuntimeOutputEvent,
  RuntimeStateEvent,
  TemplateCheckRequest,
  TemplateCheckResult,
} from '../shared/contracts';
import { parseRuntimeInstances, pythonUtf8Environment, resolvePythonRuntime } from './core/runtimeInstances';
import { instanceParallelRuns } from './core/workflow';
import { parseDocument } from '../shared/workflow/graph-dsl';
import { createLiveViewEnvironment, LIVE_VIEW_DEFAULT_INTERVAL_MS } from './liveView';
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
  private activeDuelTools = 0;
  private stopRequested = false;
  private stopGeneration = 0;
  private watchTimer: NodeJS.Timeout | undefined;
  private watchFinishTimer: NodeJS.Timeout | undefined;
  private watchedFiles = new Map<string, { offset: number; instanceId: string; pending: string }>();

  constructor(private readonly project: ProjectService) {
    super();
  }

  get running(): boolean {
    return Boolean(this.activeProcess && this.activeProcess.exitCode === null);
  }

  get recognizingDuelScreen(): boolean {
    return this.activeDuelTools > 0;
  }

  private get pythonPath(): string {
    return resolvePythonRuntime(this.project.projectRoot);
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

  /** 运行时预览帧目录：与 Python ``runtime/live_view.py`` 约定的 artifacts/live。 */
  get liveViewDirectory(): string {
    return path.join(this.artifactDir, 'live');
  }

  /** 当前选定的预览刷新间隔（毫秒），由观看窗口设置。 */
  liveViewIntervalMs = LIVE_VIEW_DEFAULT_INTERVAL_MS;

  private emitOutput(stream: RuntimeOutputEvent['stream'], text: string): void {
    this.emit('output', { stream, text, timestamp: Date.now() });
  }

  private emitState(event: RuntimeStateEvent): void {
    this.emit('state', event);
  }

  private configuredInstances(): RuntimeInstance[] {
    try {
      const raw = readJsonObject(this.configPath);
      if (raw.discover_mumu_instances === true) return [];
      return parseRuntimeInstances(raw);
    } catch {
      // Discovery failures are represented as an empty list instead of a fake device.
    }
    return [];
  }

  getDebugSettings(): RuntimeDebugSettings {
    const raw = readJsonObject(this.configPath);
    const debug = raw.debug && typeof raw.debug === 'object'
      ? raw.debug as Record<string, unknown>
      : {};
    return {
      // 一个总开关管两份输出：配置里任一为真就算开着，界面上不会出现"关了一个还有文件"。
      enabled: debug.enabled === true || raw.save_screenshots === true,
      annotateScreenshots: debug.annotate_screenshots !== false,
    };
  }

  updateDebugSettings(settings: RuntimeDebugSettings): RuntimeDebugSettings {
    const raw = readJsonObject(this.configPath);
    raw.debug = {
      enabled: settings.enabled,
      annotate_screenshots: settings.annotateScreenshots,
    };
    // 总开关同时写这两个键：`save_screenshots` 管 `step-*.png` / `last-frame.png` 与运行日志
    // 缩略图，`debug.enabled` 管 `debug/` 里那份带标注的。只开一个的细粒度组合仍然可以手改配置。
    raw.save_screenshots = settings.enabled;
    fs.writeFileSync(this.configPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    return this.getDebugSettings();
  }

  async listInstances(): Promise<RuntimeInstance[]> {
    const fallback = this.configuredInstances();
    const args = ['-m', 'src.oooonmyoji.cli', '--config', this.configPath, 'list-instances'];
    return new Promise((resolve) => {
      const child = spawn(this.pythonPath, args, {
        cwd: this.project.projectRoot,
        env: pythonUtf8Environment(process.env, this.project.projectRoot),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      let settled = false;
      const finish = (instances?: RuntimeInstance[]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(instances ?? fallback);
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

  private async runDuelTool(args: string[], timeoutMs: number, stdoutLimit: number): Promise<Record<string, unknown>> {
    this.activeDuelTools++;
    try {
      return await new Promise((resolve, reject) => {
      const child = spawn(this.pythonPath, args, {
        cwd: this.project.projectRoot,
        env: pythonUtf8Environment(process.env, this.project.projectRoot),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (error?: Error, result?: Record<string, unknown>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else if (result) resolve(result);
        else reject(new Error('模拟器画面识别没有返回结果'));
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error('读取画面超时，请确认 OCR 模型已安装且模拟器已启动'));
      }, timeoutMs);
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', chunk => { stdout = `${stdout}${String(chunk)}`.slice(-stdoutLimit); });
      child.stderr?.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-12_000); });
      child.once('error', error => finish(new Error(`无法启动画面识别：${error.message}`)));
      child.once('close', code => {
        let response: Record<string, unknown> | undefined;
        for (const line of stdout.trim().split(/\r?\n/).reverse()) {
          try {
            const value = JSON.parse(line) as unknown;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              response = value as Record<string, unknown>;
              break;
            }
          } catch { /* OCR libraries may write progress text to stdout. */ }
        }
        if (!response) return finish(new Error(stderr.trim() || '无法读取画面处理结果'));
        if (code !== 0 || response.ok !== true) {
          return finish(new Error(typeof response.error === 'string' ? response.error : stderr.trim() || '模拟器画面处理失败'));
        }
        finish(undefined, response);
      });
      });
    } finally {
      this.activeDuelTools = Math.max(0, this.activeDuelTools - 1);
    }
  }

  async captureDuelScreen(instanceId: string): Promise<DuelScreenCapture> {
    if (this.running) throw new Error('工作流运行期间不能读取模拟器画面');
    if (typeof instanceId !== 'string' || !instanceId.trim() || instanceId.length > 160) throw new Error('请选择有效的模拟器实例');
    const response = await this.runDuelTool([
      '-m', 'src.oooonmyoji.tools.duel_screen', '--config', this.configPath, '--mode', 'capture', '--instance', instanceId,
    ], 30_000, 24_000_000);
    const dataUrl = response.dataUrl;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 22_000_000) {
      throw new Error('模拟器没有返回有效截图');
    }
    return { width: Number(response.width) || 0, height: Number(response.height) || 0, dataUrl };
  }

  async recognizeDuelScreen(dataUrl: string, roi: DuelScreenRoi): Promise<DuelScreenRecognition> {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 22_000_000) {
      throw new Error('截图无效或过大，请重新读取模拟器画面');
    }
    const values = [roi?.x, roi?.y, roi?.width, roi?.height];
    if (!values.every(value => Number.isInteger(value) && value >= 0) || roi.width < 1 || roi.height < 1) {
      throw new Error('请先框选要识别的画面区域');
    }
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-duel-roi-'));
    const imagePath = path.join(temporaryDirectory, 'capture.png');
    try {
      fs.writeFileSync(imagePath, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
      const response = await this.runDuelTool([
        '-m', 'src.oooonmyoji.tools.duel_screen', '--config', this.configPath, '--mode', 'recognize-image',
        '--image', imagePath, '--roi', String(roi.x), String(roi.y), String(roi.width), String(roi.height),
      ], 90_000, 2_000_000);
        const items = Array.isArray(response.items) ? response.items : [];
        return {
          width: Number(response.width) || 0,
          height: Number(response.height) || 0,
          backend: typeof response.backend === 'string' ? response.backend : 'unknown',
          screenSide: response.screenSide === 'blue' || response.screenSide === 'red' ? response.screenSide : 'unknown',
          items: items.filter(item => item && typeof item === 'object').map(item => {
            const value = item as Record<string, unknown>;
            return {
              text: typeof value.text === 'string' ? value.text : '',
              confidence: Number(value.confidence) || 0,
              box: Array.isArray(value.box) ? value.box as number[][] : [],
            };
          }),
          heroMatches: Array.isArray(response.heroMatches) ? response.heroMatches.map(item => {
            if (!item || typeof item !== 'object') return null;
            const value = item as Record<string, unknown>;
            const x = Number(value.x), heroId = Number(value.heroId), score = Number(value.score);
            const confidenceGap = Number(value.confidenceGap);
            return Number.isFinite(x) && Number.isInteger(heroId) && Number.isFinite(score) && Number.isFinite(confidenceGap)
              ? { x, heroId, score, confidenceGap }
              : null;
          }) : [],
          soulMatches: Array.isArray(response.soulMatches) ? response.soulMatches.map(item => {
            if (!item || typeof item !== 'object') return null;
            const value = item as Record<string, unknown>;
            const x = Number(value.x), suitId = Number(value.suitId), score = Number(value.score);
            const confidenceGap = Number(value.confidenceGap);
            return Number.isFinite(x) && Number.isInteger(suitId) && Number.isFinite(score) && Number.isFinite(confidenceGap)
              ? { x, suitId, score, confidenceGap }
              : null;
          }) : [],
        };
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async runWorkflow(request: RunWorkflowRequest): Promise<void> {
    if (this.recognizingDuelScreen) throw new Error('正在识别模拟器画面，请稍后再运行工作流');
    if (this.activeProcess && this.activeProcess.exitCode === null) throw new Error('已有工作流正在运行，请先停止');
    const launchStopGeneration = this.stopGeneration;
    const workflowPath = this.project.resolveWorkflowPath(request.uri);
    const workflowReference = this.project.workflowReference(request.uri);
    await this.project.saveWorkflow(request.uri, request.text);

    let runs: Array<{ instance: string }> = [];
    try {
      // 磁盘上是 `.owf` 文本：实例并行项的识别统一走共享解析（它会先转成编辑形态）。
      runs = instanceParallelRuns(parseDocument(request.text, path.basename(workflowPath)))
        .filter((run) => typeof run.instance === 'string' && run.instance)
        .map((run) => ({ instance: run.instance }));
    } catch {
      // The engine will provide the detailed parse failure in stderr.
    }
    const availableInstances = await this.listInstances();
    const available = new Set(availableInstances.map((item) => item.id));
    const instanceLabel = (instanceId: string): string => {
      const instance = availableInstances.find((item) => item.id === instanceId);
      return instance?.displayName
        || (instance?.backend === 'mumu' && Number.isInteger(instance.mumuIndex) ? `MuMu ${instance.mumuIndex}` : instanceId);
    };
    if (runs.length > 0) {
      const missing = [...new Set(runs.map((item) => item.instance).filter((id) => !available.has(id)))];
      if (missing.length > 0) throw new Error(`未发现运行实例：${missing.join('、')}`);
    } else if (!request.instanceId || !available.has(request.instanceId)) {
      throw new Error('未发现运行实例，请先启动 MuMu 或连接 Android 设备');
    }

    const runDirectory = path.join(this.artifactDir, 'runs');
    await fs.promises.mkdir(runDirectory, { recursive: true });
    const stamp = Date.now();
    const eventsFile = path.join(runDirectory, `desktop-events-${stamp}.jsonl`);
    const configuredInputs = request.inputs && typeof request.inputs === 'object' && !Array.isArray(request.inputs)
      ? request.inputs
      : undefined;
    const inputsFile = configuredInputs && Object.keys(configuredInputs).length > 0
      ? path.join(runDirectory, `desktop-inputs-${stamp}.json`)
      : undefined;
    if (inputsFile) {
      await fs.promises.writeFile(inputsFile, `${JSON.stringify(configuredInputs, null, 2)}\n`, 'utf8');
    }
    if (launchStopGeneration !== this.stopGeneration) {
      if (inputsFile) await fs.promises.rm(inputsFile, { force: true }).catch(() => undefined);
      this.emitOutput('system', '工作流启动已取消\n');
      this.emitState({ state: 'idle', label: '已停止', workflow: request.uri, instance: request.instanceId });
      return;
    }
    const instance = request.instanceId || runs[0]?.instance || '';
    this.startWatching(runs.length > 0
      ? runs.map((item) => ({
        file: path.join(runDirectory, `desktop-events-${stamp}-${item.instance}.jsonl`),
        instanceId: item.instance,
      }))
      : [{ file: eventsFile, instanceId: instance }]);
    const args = [
      '-m', 'src.oooonmyoji.cli', '--config', this.configPath,
      'run-workflow', workflowReference,
      '--instance', instance,
      '--events-file', eventsFile,
    ];
    if (inputsFile) args.push('--inputs', inputsFile);
    // 预览通道默认关闭：只有 artifacts/live/request.json 存在且新鲜时运行时才写帧，
    // 该文件由主进程在运行开始时登记（见 main.ts）。
    const child = spawn(this.pythonPath, args, {
      cwd: this.project.projectRoot,
      env: {
        ...pythonUtf8Environment(process.env, this.project.projectRoot),
        ...createLiveViewEnvironment(this.liveViewDirectory, this.liveViewIntervalMs),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.activeProcess = child;
    this.stopRequested = false;
    const startedAt = Date.now();
    const label = `${path.basename(workflowPath)} · ${runs.length > 0 ? `${runs.length} 个实例` : instanceLabel(instance)}`;
    const sources = runs.length > 0 ? runs.map((run) => ({
      id: run.instance,
      label: instanceLabel(run.instance),
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
    const cleanupInputsFile = (): void => {
      if (inputsFile) void fs.promises.rm(inputsFile, { force: true }).catch(() => undefined);
    };
    child.once('error', (error) => {
      launchFailed = true;
      cleanupInputsFile();
      this.emitOutput('stderr', `启动失败：${error.message}\n`);
      this.finishWatching();
      if (this.activeProcess === child) this.activeProcess = undefined;
      this.emitState({ state: 'failed', label: '启动失败', workflow: request.uri, instance, exitCode: -1 });
    });
    child.once('close', (code) => {
      cleanupInputsFile();
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
    this.stopGeneration += 1;
    const child = this.activeProcess;
    if (!child || child.exitCode !== null) return;
    this.stopRequested = true;
    this.emitState({ state: 'stopping', label: '正在停止...' });
    this.emitOutput('system', '正在停止工作流...\n');
    await this.terminateProcessTree(child);
  }

  private async terminateProcessTree(child: ChildProcess): Promise<void> {
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
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private startWatching(files: Array<{ file: string; instanceId: string }>): void {
    this.stopWatching();
    this.watchedFiles = new Map(files.map(({ file, instanceId }) => [file, { offset: 0, instanceId, pending: '' }]));
    // Keep canvas run markers responsive; at 350ms short steps could finish
    // before their `running` event reached the renderer.
    this.watchTimer = setInterval(() => this.tickWatcher(), 100);
  }

  private finishWatching(): void {
    this.tickWatcher();
    if (this.watchFinishTimer) clearTimeout(this.watchFinishTimer);
    const watchedFiles = this.watchedFiles;
    this.watchFinishTimer = setTimeout(() => {
      // A previous run's delayed drain must never stop a newer run's watcher.
      if (this.watchedFiles !== watchedFiles) return;
      this.tickWatcher();
      this.stopWatching();
    }, 1400);
  }

  private stopWatching(): void {
    if (this.watchTimer) clearInterval(this.watchTimer);
    if (this.watchFinishTimer) clearTimeout(this.watchFinishTimer);
    this.watchTimer = undefined;
    this.watchFinishTimer = undefined;
    this.watchedFiles.clear();
  }

  private tickWatcher(): void {
    for (const [file, watch] of this.watchedFiles) {
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {
        continue;
      }
      const offset = watch.offset;
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
        // JSONL writers can be observed between writes (especially for events
        // containing screenshots). Keep the trailing fragment and prepend it
        // to the next read instead of advancing past and losing the event.
        const previousPending = size < offset ? '' : watch.pending;
        const lines = `${previousPending}${chunk}`.split('\n');
        const pending = lines.pop() || '';
        this.watchedFiles.set(file, { ...watch, offset: size, pending });
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            // Each parallel instance has its own event file. Bind the file's
            // owner here so events without an instance_id cannot fall back to
            // whichever source tab happens to be active.
            event.log_source = watch.instanceId;
            if (typeof event.instance_id !== 'string' || !event.instance_id) event.instance_id = watch.instanceId;
            if (typeof event.screenshot === 'string') {
              const uri = this.project.resourceUrl(event.screenshot);
              if (uri) event.screenshot = uri;
            }
            this.emit('runEvent', event);
          } catch {
            // A complete JSONL line should parse; malformed lines are isolated
            // so they cannot stop later events from being delivered.
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
        env: pythonUtf8Environment(process.env, this.project.projectRoot),
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
        '--instance', request.instanceId || '',
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
        '--instance', request.instanceId || '',
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

  async dispose(): Promise<void> {
    this.stopWatching();
    await this.stopWorkflow();
  }
}
