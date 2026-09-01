/**
 * Onmyoji Workflow Helper 扩展入口。
 * 提供：工作流 JSON 智能补全/悬停/诊断、可视化流程图编辑器、引擎 CLI 校验。
 */
import * as fs from 'fs';
import { ChildProcess, spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActionCatalog, discoverProjectRoot, loadActionCatalog } from './catalog';
import { WorkflowIntelligence } from './jsonProviders';
import { ReferenceViewerManager } from './referenceViewerManager';
import { RunLogManager } from './runLogManager';
import { WorkflowTreeManager } from './workflowTreeManager';
import { chooseRuntimeInstance, parseRuntimeInstances, pythonUtf8Environment, RuntimeInstanceInfo } from './runtimeInstances';
import { SidebarProvider } from './sidebarProvider';
import { TemplateCheckOptions, TemplateCheckResult, WebviewManager } from './webviewManager';
import { buildPartySoulsRunArguments, buildWorkflowRunArguments, missingWorkflowInstances } from './workflowProcess';

let intelligence: WorkflowIntelligence;
let webviewManager: WebviewManager;
let runLogManager: RunLogManager;
let referenceViewerManager: ReferenceViewerManager;
let sidebarProvider: SidebarProvider;
let catalog: ActionCatalog;
let projectRoot: string;
let extensionContext: vscode.ExtensionContext;
let workflowOutput: vscode.OutputChannel;
let activeWorkflowProcess: ChildProcess | undefined;
let workflowStopRequested = false;

const SELECTED_INSTANCE_KEY = 'onmyoji.selectedInstance';

interface RoiCapture {
  dataUrl: string;
  width: number;
  height: number;
}

function refreshCatalog(): void {
  catalog = loadActionCatalog(projectRoot);
  if (catalog.clashes().length > 0) {
    void vscode.window.showWarningMessage(`自定义 Action 与内置 Action 重名，已忽略自定义版本：${catalog.clashes().join(', ')}`);
  }
}

function getCatalog(): ActionCatalog {
  return catalog;
}

function updateWorkflowFileContext(): void {
  const editor = vscode.window.activeTextEditor;
  const isWorkflowFile = Boolean(editor && intelligence.isWorkflowFile(editor.document.uri));
  void vscode.commands.executeCommand('setContext', 'onmyoji.workflowFile', isWorkflowFile);
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  const configuredRoot = vscode.workspace.getConfiguration('onmyoji').get<string>('projectRoot', '');
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionUri.fsPath;
  if (configuredRoot) {
    projectRoot = path.resolve(configuredRoot);
  } else {
    projectRoot = discoverProjectRoot(workspaceRoot).root;
  }
  refreshCatalog();

  workflowOutput = vscode.window.createOutputChannel('Onmyoji 工作流运行');

  intelligence = new WorkflowIntelligence(getCatalog);
  context.subscriptions.push(intelligence, ...intelligence.registerProviders());

  runLogManager = new RunLogManager(context, () => projectRoot);
  referenceViewerManager = new ReferenceViewerManager(context, () => projectRoot);
  let workflowTreeManager: WorkflowTreeManager | undefined;
  sidebarProvider = new SidebarProvider(context);

  webviewManager = new WebviewManager(
    context,
    intelligence,
    getCatalog,
    () => projectRoot,
    getRuntimeInstanceState,
    rememberRuntimeInstance,
    pickRoi,
    checkTemplate,
    (event) => runLogManager.acceptEvent(event),
    (state) => sidebarProvider.setEditorState(state),
  );
  workflowTreeManager = new WorkflowTreeManager(context, () => projectRoot, webviewManager);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('onmyoji.openWorkflowEditor', (uri?: vscode.Uri) => webviewManager.open(uri)),
    vscode.commands.registerCommand('onmyoji.editorCommand', (command: string, value?: unknown) => webviewManager.executeEditorCommand(command, value)),
    vscode.commands.registerCommand('onmyoji.createWorkflow', () => createWorkflow()),
    vscode.commands.registerCommand('onmyoji.runWorkflow', (uri?: vscode.Uri, instanceId?: string) => runWorkflow(uri, instanceId)),
    vscode.commands.registerCommand('onmyoji.runPartySouls', (rounds?: number) => runPartySouls(rounds)),
    vscode.commands.registerCommand('onmyoji.stopWorkflow', () => stopWorkflow()),
    vscode.commands.registerCommand('onmyoji.openRunLog', () => runLogManager.open()),
    vscode.commands.registerCommand('onmyoji.openWorkflowReferences', (uri?: string) => referenceViewerManager.open(false, uri)),
    vscode.commands.registerCommand('onmyoji.openWorkflowTree', (uri?: string) => workflowTreeManager?.open(false, uri)),
    vscode.commands.registerCommand('onmyoji.validateCurrentWorkflow', () => validateCurrentWorkflow()),
    vscode.commands.registerCommand('onmyoji.reloadActionCatalog', () => {
      refreshCatalog();
      void vscode.window.showInformationMessage(`已重新加载 Action 目录（共 ${catalog.all().length} 个：内置 + 自定义）`);
    }),
    vscode.commands.registerCommand('onmyoji.runEngineValidate', () => runEngineValidate()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      void webviewManager.notifyExternalChange(event.document.uri);
    }),
    vscode.window.onDidChangeActiveTextEditor(() => updateWorkflowFileContext()),
    workflowOutput,
    runLogManager,
    referenceViewerManager,
    { dispose: () => workflowTreeManager?.dispose() },
    { dispose: () => activeWorkflowProcess?.kill() },
  );
  updateWorkflowFileContext();
}

async function createWorkflow(): Promise<void> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    void vscode.window.showErrorMessage('请先在 VS Code 中打开 oooonmyoji 项目文件夹。');
    return;
  }

  const name = await vscode.window.showInputBox({
    title: '新建 Onmyoji 工作流',
    prompt: '输入工作流文件名或 ID（无需填写 .json）',
    value: 'new_workflow',
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return '工作流名称不能为空';
      if (trimmed === '.' || trimmed === '..') return '工作流名称无效';
      if (/[\\/:*?"<>|]/.test(trimmed)) return '名称不能包含路径分隔符或 Windows 文件名保留字符';
      if (trimmed.toLowerCase().endsWith('.json') && trimmed.length === 5) return '工作流名称不能为空';
      return undefined;
    },
  });
  if (!name) return;

  const trimmed = name.trim();
  const fileName = trimmed.toLowerCase().endsWith('.json') ? trimmed : `${trimmed}.json`;
  const workflowId = fileName.slice(0, -'.json'.length);
  const workflowsDir = path.join(projectRoot, 'workflows');
  const fileUri = vscode.Uri.file(path.join(workflowsDir, fileName));

  try {
    await vscode.workspace.fs.stat(fileUri);
    void vscode.window.showWarningMessage(`工作流已存在：${path.join('workflows', fileName)}`);
    return;
  } catch {
    // 文件不存在，可以创建。
  }

  const workflow = {
    schema_version: 3,
    id: workflowId,
    version: '3.0.0',
    description: '',
    resolution: [1920, 1080],
    root: 'root',
    limits: { timeout_seconds: 300, max_steps: 1000 },
    blackboard: {},
    nodes: [
      {
        id: 'root',
        type: 'root',
        children: ['capture'],
      },
      {
        id: 'capture',
        type: 'task',
        action: 'core.capture',
        params: {},
      },
    ],
  };

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(workflowsDir));
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(`${JSON.stringify(workflow, null, 2)}\n`, 'utf8'));
  const doc = await vscode.workspace.openTextDocument(fileUri);
  await vscode.window.showTextDocument(doc, { preview: false });
  await webviewManager.open(fileUri);
  void vscode.window.setStatusBarMessage(`已创建工作流：${path.join('workflows', fileName)}`, 3000);
}

function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** 解析 artifact 目录：<项目根>/<配置的 artifact_dir，默认 artifacts>。 */
export function resolveArtifactDir(projectRoot: string): string {
  let configPath = vscode.workspace.getConfiguration('onmyoji').get<string>('configPath', 'config/config.json');
  if (!path.isAbsolute(configPath) && !fs.existsSync(path.resolve(projectRoot, configPath))) {
    if (path.normalize(configPath) === path.normalize('config/config.json')) {
      const example = path.join(projectRoot, 'config', 'config.example.json');
      if (fs.existsSync(example)) configPath = 'config/config.example.json';
    }
  }
  const configFile = path.isAbsolute(configPath) ? configPath : path.join(projectRoot, configPath);
  let artifactDir = 'artifacts';
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8')) as { artifact_dir?: unknown };
    if (typeof parsed.artifact_dir === 'string' && parsed.artifact_dir.trim()) artifactDir = parsed.artifact_dir;
  } catch {
    // 配置文件错误由引擎报告；这里使用默认值。
  }
  return path.join(projectRoot, artifactDir);
}

/** 运行事件文件路径：<artifact_dir>/runs/events-latest.jsonl。 */
export function resolveEventsFilePath(projectRoot: string): string {
  return path.join(resolveArtifactDir(projectRoot), 'runs', 'events-latest.jsonl');
}

function resolveRuntimeConfigPath(): string {
  const configured = vscode.workspace.getConfiguration('onmyoji').get<string>('configPath', 'config/config.json');
  if (path.isAbsolute(configured) || fs.existsSync(path.resolve(projectRoot, configured))) return configured;
  if (path.normalize(configured) === path.normalize('config/config.json')) {
    const example = 'config/config.example.json';
    if (fs.existsSync(path.resolve(projectRoot, example))) return example;
  }
  return configured;
}

function resolvePythonExecutable(): string {
  const configured = vscode.workspace.getConfiguration('onmyoji').get<string>('pythonExecutable', '');
  if (configured) return configured;
  const venv = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
  return fs.existsSync(venv) ? venv : 'python';
}

function getRuntimeConfigFile(): string {
  const configPath = resolveRuntimeConfigPath();
  return path.isAbsolute(configPath) ? configPath : path.join(projectRoot, configPath);
}

function getConfiguredRuntimeInstances(): RuntimeInstanceInfo[] {
  try {
    const instances = parseRuntimeInstances(JSON.parse(fs.readFileSync(getRuntimeConfigFile(), 'utf8')));
    if (instances.length > 0) return instances;
  } catch {
    // 配置错误由引擎报告；编辑器保留默认实例，避免工具栏失去运行入口。
  }
  return [{ id: 'mumu-0' }];
}

async function getRuntimeInstances(): Promise<RuntimeInstanceInfo[]> {
  const fallback = getConfiguredRuntimeInstances();
  const args = [
    '-m',
    'src.oooonmyoji.cli',
    '--config',
    resolveRuntimeConfigPath(),
    'list-instances',
  ];
  return new Promise((resolve) => {
    const child = spawn(resolvePythonExecutable(), args, {
      cwd: projectRoot,
      env: pythonUtf8Environment(process.env),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    let settled = false;
    const finish = (instances?: RuntimeInstanceInfo[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(instances && instances.length > 0 ? instances : fallback);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, 6000);
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
      if (stdout.length > 256_000) stdout = stdout.slice(-256_000);
    });
    child.once('error', () => finish());
    child.once('close', (code) => {
      if (code !== 0) {
        finish();
        return;
      }
      try {
        finish(parseRuntimeInstances(JSON.parse(stdout)));
      } catch {
        finish();
      }
    });
  });
}

async function getRuntimeInstanceState(requested?: string): Promise<{ instances: RuntimeInstanceInfo[]; selectedInstance: string }> {
  const instances = await getRuntimeInstances();
  const persisted = extensionContext.workspaceState.get<string>(SELECTED_INSTANCE_KEY);
  return { instances, selectedInstance: chooseRuntimeInstance(instances, requested, persisted) };
}

async function rememberRuntimeInstance(requested: string): Promise<string> {
  const selected = (await getRuntimeInstanceState(requested)).selectedInstance;
  await extensionContext.workspaceState.update(SELECTED_INSTANCE_KEY, selected);
  return selected;
}

async function pickRoi(_referenceResolution: [number, number], requestedInstance?: string): Promise<RoiCapture | undefined> {
  const configPath = resolveRuntimeConfigPath();
  const pythonPath = resolvePythonExecutable();
  const instance = (await getRuntimeInstanceState(requestedInstance)).selectedInstance;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oooonmyoji-roi-'));
  const resultFile = path.join(tempDir, 'selection.json');
  const args = [
    '-m',
    'src.oooonmyoji.tools.roi_editor',
    '--config',
    configPath,
    '--instance',
    instance,
    '--capture-only',
    '--result-file',
    resultFile,
    '--reference-width',
    String(_referenceResolution[0]),
    '--reference-height',
    String(_referenceResolution[1]),
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pythonPath, args, {
        cwd: projectRoot,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code !== 0 && !fs.existsSync(resultFile)) {
          reject(new Error(stderr.trim() || `ROI 选择器退出（代码 ${code ?? '未知'}）`));
          return;
        }
        resolve();
      });
    });
    if (!fs.existsSync(resultFile)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as {
      image_base64?: unknown;
      image_size?: unknown;
    };
    const imageSize = parsed.image_size;
    if (typeof parsed.image_base64 !== 'string' || !parsed.image_base64
      || !Array.isArray(imageSize) || imageSize.length !== 2
      || !imageSize.every((value) => typeof value === 'number' && Number.isInteger(value) && value > 0)) {
      throw new Error('MuMu 截图返回了无效数据');
    }
    return {
      dataUrl: `data:image/png;base64,${parsed.image_base64}`,
      width: imageSize[0] as number,
      height: imageSize[1] as number,
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不应覆盖已完成的 ROI 选择结果。
    }
  }
}

async function checkTemplate(options: TemplateCheckOptions): Promise<TemplateCheckResult> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oooonmyoji-template-check-'));
  const resultFile = path.join(tempDir, 'result.json');
  const args = [
    '-m',
    'src.oooonmyoji.tools.template_check',
    '--config',
    resolveRuntimeConfigPath(),
    '--project-root',
    projectRoot,
    '--instance',
    options.instanceId ?? 'mumu-0',
    '--template',
    options.template,
    '--threshold',
    String(options.threshold),
    '--max-results',
    String(options.maxResults),
    '--reference-width',
    String(options.referenceResolution[0]),
    '--reference-height',
    String(options.referenceResolution[1]),
    '--result-file',
    resultFile,
  ];
  if (options.roi) args.push('--roi', ...options.roi.map(String));
  if (options.scaleSearch) args.push('--scale-search');

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(resolvePythonExecutable(), args, {
        cwd: projectRoot,
        env: pythonUtf8Environment(process.env),
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error('模板检查超时'));
      }, 30_000);
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
      });
      child.once('error', (error) => finish(error));
      child.once('close', (code) => {
        if (code !== 0 || !fs.existsSync(resultFile)) {
          finish(new Error(stderr.trim() || `模板检查退出（代码 ${code ?? '未知'}）`));
          return;
        }
        finish();
      });
    });

    const parsed = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as {
      image_base64?: unknown;
      image_size?: unknown;
      roi_image?: unknown;
      matches?: unknown;
    };
    const imageSize = parsed.image_size;
    const roi = parsed.roi_image;
    if (typeof parsed.image_base64 !== 'string' || !parsed.image_base64
      || !Array.isArray(imageSize) || imageSize.length !== 2
      || !imageSize.every((value) => typeof value === 'number' && Number.isInteger(value) && value > 0)
      || !Array.isArray(roi) || roi.length !== 4
      || !roi.every((value) => typeof value === 'number' && Number.isInteger(value))) {
      throw new Error('模板检查返回了无效画面数据');
    }
    const rawMatches = Array.isArray(parsed.matches) ? parsed.matches : [];
    const matches = rawMatches.map((value) => {
      if (!value || typeof value !== 'object') throw new Error('模板检查返回了无效匹配数据');
      const item = value as Record<string, unknown>;
      const numbers = ['x', 'y', 'width', 'height', 'confidence'] as const;
      if (!numbers.every((key) => typeof item[key] === 'number' && Number.isFinite(item[key]))) {
        throw new Error('模板检查返回了无效匹配数据');
      }
      return {
        x: item.x as number,
        y: item.y as number,
        width: item.width as number,
        height: item.height as number,
        confidence: item.confidence as number,
      };
    });
    return {
      dataUrl: `data:image/png;base64,${parsed.image_base64}`,
      width: imageSize[0] as number,
      height: imageSize[1] as number,
      roi: [roi[0] as number, roi[1] as number, roi[2] as number, roi[3] as number],
      matches,
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Temporary check results are best-effort cleanup only.
    }
  }
}

async function runWorkflow(preferred?: vscode.Uri, requestedInstance?: string, eventsFilePath?: string): Promise<void> {
  const active = vscode.window.activeTextEditor;
  const uri = preferred ?? (active && intelligence.isWorkflowFile(active.document.uri) ? active.document.uri : undefined);
  if (!uri || !intelligence.isWorkflowFile(uri)) {
    void vscode.window.showInformationMessage('请先打开一个 workflows/**/*.json 文件，或从工作流编辑器中执行。');
    return;
  }

  if (activeWorkflowProcess && activeWorkflowProcess.exitCode === null) {
    await runLogManager.open();
    void vscode.window.showWarningMessage('已有工作流正在运行，请先停止后再启动新的工作流。');
    return;
  }

  const workflowRoot = path.resolve(projectRoot, 'workflows');
  const relative = path.relative(workflowRoot, path.resolve(uri.fsPath));
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    void vscode.window.showErrorMessage('当前文件不在项目的 workflows 目录中，无法执行。');
    return;
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.isDirty) {
    const choice = await vscode.window.showWarningMessage('工作流有未保存修改，执行前需要先保存。', '保存并执行', '取消');
    if (choice !== '保存并执行' || !(await doc.save())) return;
  }

  const configPath = resolveRuntimeConfigPath();
  const pythonPath = resolvePythonExecutable();
  const workflowReference = relative.split(path.sep).join('/');
  let orchestrationRuns: Array<{ instance: string; workflow: string }> = [];
  try {
    const raw = JSON.parse(doc.getText()) as { root?: string; nodes?: Array<{ id?: string; type?: string; children?: string[]; runs?: unknown }> };
    const rootNode = raw.nodes?.find((node) => node.id === raw.root && node.type === 'root');
    const child = rootNode && Array.isArray(raw.nodes) ? raw.nodes.find((node) => node.id === rootNode.children?.[0]) : undefined;
    if (child?.type === 'instance_parallel' && Array.isArray(child.runs)) {
      orchestrationRuns = child.runs.flatMap((run) => {
        if (!run || typeof run !== 'object' || Array.isArray(run)) return [];
        const value = run as { instance?: unknown; workflow?: unknown };
        return typeof value.instance === 'string' && typeof value.workflow === 'string'
          ? [{ instance: value.instance, workflow: value.workflow }]
          : [];
      });
    }
  } catch {
    // JSON diagnostics are shown by the editor/engine; execution will report the parse error.
  }
  const isMultiRun = orchestrationRuns.length > 0;
  const instance = isMultiRun ? orchestrationRuns[0].instance : await rememberRuntimeInstance(requestedInstance ?? '');
  const runSources = orchestrationRuns.map((run, index) => ({
    id: `${run.instance}-${index}`,
    label: run.instance,
    workflow: run.workflow,
    instance: run.instance,
  }));
  if (isMultiRun) {
    const missingInstances = missingWorkflowInstances(orchestrationRuns, await getRuntimeInstances());
    if (missingInstances.length > 0) {
      const message = `无法启动：未发现运行实例 ${missingInstances.join('、')}。请先启动对应 MuMu 实例，或从 Instance Parallel 中删除该运行项。`;
      await runLogManager.beginMultiRun(path.basename(uri.fsPath), runSources);
      runLogManager.appendOutput(`${message}\n`, 'stderr');
      runLogManager.finishProcess(2, null, false);
      await runLogManager.open();
      sidebarProvider.setRunState('error', `缺少实例 · ${missingInstances.join('、')}`);
      void vscode.window.showErrorMessage(message);
      return;
    }
  }
  // 无论从哪个入口执行（面板▶ / 命令面板 / 编辑器标题栏），都写运行事件文件并让编辑器监听
  const eventStamp = Date.now();
  const eventsFile = isMultiRun
    ? eventsFilePath ?? path.join(resolveArtifactDir(projectRoot), 'runs', `events-group-${eventStamp}.jsonl`)
    : eventsFilePath ?? resolveEventsFilePath(projectRoot);
  if (isMultiRun) {
    await runLogManager.beginMultiRun(path.basename(uri.fsPath), runSources);
    runLogManager.startEventSources(orchestrationRuns.map((run, index) => ({
      id: `${run.instance}-${index}`,
      filePath: path.join(path.dirname(eventsFile), `${path.basename(eventsFile, path.extname(eventsFile))}-${run.instance}${path.extname(eventsFile) || '.jsonl'}`),
    })));
  } else {
    await runLogManager.beginRun(path.basename(uri.fsPath), instance);
    webviewManager.startRunWatcher(eventsFile);
  }
  const args = buildWorkflowRunArguments(configPath, workflowReference, instance, eventsFile);
  workflowOutput.clear();
  workflowOutput.appendLine(`启动工作流：${path.basename(uri.fsPath)}`);
  workflowOutput.appendLine(`运行实例：${isMultiRun ? orchestrationRuns.map((run) => run.instance).join(', ') : instance}`);
  workflowOutput.appendLine('');

  const child = spawn(pythonPath, args, {
    cwd: projectRoot,
    env: pythonUtf8Environment(process.env),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeWorkflowProcess = child;
  workflowStopRequested = false;
  sidebarProvider.setRunState('running', `${path.basename(uri.fsPath)} · ${isMultiRun ? `${orchestrationRuns.length} 个实例` : instance}`);
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string | Buffer) => {
    workflowOutput.append(String(chunk));
    runLogManager.appendOutput(String(chunk), 'stdout');
  });
  child.stderr?.on('data', (chunk: string | Buffer) => {
    workflowOutput.append(String(chunk));
    runLogManager.appendOutput(String(chunk), 'stderr');
  });
  let launchFailed = false;
  child.once('error', (error) => {
    launchFailed = true;
    workflowOutput.appendLine(`\n启动失败：${error.message}`);
    runLogManager.appendOutput(`\n启动失败：${error.message}\n`, 'stderr');
    if (isMultiRun) runLogManager.finishEventSources(); else webviewManager.finishRunWatcher();
    runLogManager.finishProcess(-1, null, false);
    if (activeWorkflowProcess === child) activeWorkflowProcess = undefined;
    sidebarProvider.setRunState('error', '启动失败');
    void vscode.window.showErrorMessage(`工作流启动失败：${error.message}`);
  });
  child.once('close', (code, signal) => {
    if (launchFailed) return;
    const stopped = workflowStopRequested;
    workflowOutput.appendLine(`\n进程结束：${stopped ? '已停止' : `退出代码 ${code ?? '未知'}`}${signal ? `，信号 ${signal}` : ''}`);
    if (activeWorkflowProcess === child) activeWorkflowProcess = undefined;
    workflowStopRequested = false;
    if (isMultiRun) runLogManager.finishEventSources(); else webviewManager.finishRunWatcher();
    runLogManager.finishProcess(code, signal, stopped);
    if (stopped) {
      sidebarProvider.setRunState('idle', '已停止');
      void vscode.window.setStatusBarMessage('工作流已停止', 3000);
    } else if (code === 0) {
      sidebarProvider.setRunState('success', '执行完成');
      void vscode.window.setStatusBarMessage(`工作流执行完成：${path.basename(uri.fsPath)}`, 3000);
    } else {
      sidebarProvider.setRunState('error', `失败 · 退出代码 ${code ?? '未知'}`);
      void runLogManager.open();
      void vscode.window.showErrorMessage(`工作流执行失败（退出代码 ${code ?? '未知'}），请查看“Onmyoji 工作流运行”输出。`);
    }
  });
  void vscode.window.setStatusBarMessage(`已启动工作流：${path.basename(uri.fsPath)}（实例：${isMultiRun ? orchestrationRuns.map((run) => run.instance).join('、') : instance}）`, 3000);
}

async function runPartySouls(requestedRounds?: number): Promise<void> {
  if (activeWorkflowProcess && activeWorkflowProcess.exitCode === null) {
    void vscode.window.showWarningMessage('已有自动化正在运行，请先停止后再启动组队御魂。');
    return;
  }

  const configPath = resolveRuntimeConfigPath();
  const pythonPath = resolvePythonExecutable();
  const configuredRounds = vscode.workspace.getConfiguration('onmyoji').get<number>('partySoulsRounds', 9999);
  const selectedRounds = requestedRounds === undefined ? configuredRounds : requestedRounds;
  const rounds = selectedRounds === 1 ? 1 : 9999;
  const eventStamp = Date.now();
  const partyEventsDir = path.join(resolveArtifactDir(projectRoot), 'runs');
  const leaderEventsFile = path.join(partyEventsDir, `events-party-${eventStamp}-leader.jsonl`);
  const memberEventsFile = path.join(partyEventsDir, `events-party-${eventStamp}-member.jsonl`);
  const args = buildPartySoulsRunArguments(
    configPath,
    'mumu-0',
    'mumu-1',
    rounds,
    leaderEventsFile,
    memberEventsFile,
  );

  await vscode.workspace.getConfiguration('onmyoji').update('partySoulsRounds', rounds, vscode.ConfigurationTarget.Workspace);
  await runLogManager.beginMultiRun('组队御魂', [
    { id: 'leader', label: '队长', workflow: 'entrypoints/mumu_0_souls_party_leader.json', instance: 'mumu-0' },
    { id: 'member', label: '队员', workflow: 'entrypoints/mumu_1_souls_party_member.json', instance: 'mumu-1' },
  ]);
  runLogManager.startEventSources([
    { id: 'leader', filePath: leaderEventsFile },
    { id: 'member', filePath: memberEventsFile },
  ]);

  workflowOutput.clear();
  workflowOutput.appendLine(`启动组队御魂：${rounds} 场`);
  workflowOutput.appendLine('队长：mumu-0');
  workflowOutput.appendLine('队员：mumu-1');
  workflowOutput.appendLine('');

  const child = spawn(pythonPath, args, {
    cwd: projectRoot,
    env: pythonUtf8Environment(process.env),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeWorkflowProcess = child;
  workflowStopRequested = false;
  sidebarProvider.setRunState('running', `组队御魂 · ${rounds} 场`);
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string | Buffer) => {
    workflowOutput.append(String(chunk));
    runLogManager.appendOutput(String(chunk), 'stdout');
  });
  child.stderr?.on('data', (chunk: string | Buffer) => {
    workflowOutput.append(String(chunk));
    runLogManager.appendOutput(String(chunk), 'stderr');
  });
  let launchFailed = false;
  child.once('error', (error) => {
    launchFailed = true;
    workflowOutput.appendLine(`\n启动失败：${error.message}`);
    runLogManager.appendOutput(`\n启动失败：${error.message}\n`, 'stderr');
    runLogManager.finishEventSources();
    runLogManager.finishProcess(-1, null, false);
    if (activeWorkflowProcess === child) activeWorkflowProcess = undefined;
    sidebarProvider.setRunState('error', '组队御魂启动失败');
    void vscode.window.showErrorMessage(`组队御魂启动失败：${error.message}`);
  });
  child.once('close', (code, signal) => {
    if (launchFailed) return;
    const stopped = workflowStopRequested;
    workflowOutput.appendLine(`\n进程结束：${stopped ? '已停止' : `退出代码 ${code ?? '未知'}`}${signal ? `，信号 ${signal}` : ''}`);
    if (activeWorkflowProcess === child) activeWorkflowProcess = undefined;
    workflowStopRequested = false;
    runLogManager.finishEventSources();
    runLogManager.finishProcess(code, signal, stopped);
    if (stopped) {
      sidebarProvider.setRunState('idle', '组队御魂已停止');
      void vscode.window.setStatusBarMessage('组队御魂已停止', 3000);
    } else if (code === 0) {
      sidebarProvider.setRunState('success', '组队御魂已完成');
      void vscode.window.showInformationMessage('组队御魂已完成。');
    } else {
      sidebarProvider.setRunState('error', `组队失败 · 退出代码 ${code ?? '未知'}`);
      void vscode.window.showErrorMessage(`组队御魂运行失败（退出代码 ${code ?? '未知'}），请查看“Onmyoji 工作流运行”输出。`);
    }
  });
  void vscode.window.setStatusBarMessage(`组队御魂已启动：mumu-0 + mumu-1，共 ${rounds} 场`, 5000);
}

async function stopWorkflow(): Promise<void> {
  const child = activeWorkflowProcess;
  if (!child || child.exitCode !== null) {
    void vscode.window.showInformationMessage('当前没有正在运行的工作流。');
    return;
  }
  workflowStopRequested = true;
  sidebarProvider.setRunState('stopping', '正在停止...');
  workflowOutput.appendLine('\n正在停止工作流...');
  if (process.platform === 'win32' && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
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

function validateCurrentWorkflow(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !intelligence.isWorkflowFile(editor.document.uri)) {
    void vscode.window.showInformationMessage('请先打开一个 workflows/**/*.json 文件');
    return;
  }
  void (async () => {
    await intelligence.refreshDocument(editor.document);
    const doc = editor.document;
    const diags = vscode.languages.getDiagnostics(doc.uri);
    const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
    const warnings = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning);
    const messages = [`校验完成：${errors.length} 个错误，${warnings.length} 个警告。`];
    for (const d of [...errors, ...warnings].slice(0, 5)) {
      messages.push(`${d.severity === vscode.DiagnosticSeverity.Error ? '错误' : '警告'}：${d.message}`);
    }
    void vscode.window.showInformationMessage(messages.join('\n'));
    if (errors.length > 0) {
      void vscode.commands.executeCommand('workbench.actions.view.problems');
    }
  })();
}

async function runEngineValidate(): Promise<void> {
  const config = vscode.workspace.getConfiguration('onmyoji');
  let python = config.get<string>('pythonExecutable', '');
  const configPath = resolveRuntimeConfigPath();
  if (!python) {
    const venv = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
    python = fs.existsSync(venv) ? venv : 'python';
  }
  const cli = path.join('src', 'oooonmyoji', 'cli.py');
  if (!fs.existsSync(path.join(projectRoot, cli))) {
    void vscode.window.showErrorMessage(`未找到引擎 CLI：${path.join(projectRoot, cli)}`);
    return;
  }
  const terminal = vscode.window.createTerminal({ name: 'Onmyoji 引擎校验', cwd: projectRoot });
  terminal.show();
  terminal.sendText(`& ${quotePowerShellArg(python)} -m src.oooonmyoji.cli --config ${quotePowerShellArg(configPath)} validate`);
}

export function deactivate(): void {
  // nothing persistent to clean up; subscriptions are disposed by VS Code
}
