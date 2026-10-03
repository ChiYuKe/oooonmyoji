import { isAppearanceTheme, themeColorScheme, themeBackground, type AppearanceTheme } from '../shared/appearance';
import path from 'node:path';
import { AiAssistant } from './aiAssistant';
import { SoulService } from './soulService';
import { searchLineups } from './lineupService';
import { NGA_BOARD_URL } from './ngaLineupService';
import { loadAiImage } from './ai-images';
import { copyPngToClipboard } from './clipboardImage';
import { pathToFileURL } from 'node:url';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import {
  app,
  dialog,
  BrowserWindow,
  ipcMain,
  net,
  nativeImage,
  clipboard,
  safeStorage,
  nativeTheme,
  protocol,
  screen,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import type {
  LiveViewPollResult,
  McpApprovalDecision,
  McpApprovalRequest,
  RoiCaptureRequest,
  RunWorkflowRequest,
  RuntimeDebugSettings,
  RuntimeResourceVariantId,
  SaveCanvasRequest,
  SaveTemplateRequest,
  TemplateCheckRequest,
  VisionCommand,
  VisionStreamEvent,
} from '../shared/contracts';
import type { LineupExternalSource } from '../shared/lineups';
import { chooseRuntimeInstance } from './core/runtimeInstances';
import {
  clampLiveViewInterval,
  createLiveViewEnvironment,
  LIVE_VIEW_DEFAULT_INTERVAL_MS,
  LiveViewRequest,
  readLiveViewFrame,
} from './liveView';
import { MCP_APPROVAL_DIRNAME, McpApprovalBridge } from './mcpApproval';
import { ProjectService } from './projectService';
import { RuntimeService } from './runtimeService';
import { RuntimeResourceManager } from './runtimeResources';
import { VisionStream } from './visionStream';
import { WorkflowTestService } from './workflowTestService';
import type { WorkflowTestInit, WorkflowTestRequest, TestCommand, TestNodeDraft, TestNodeAdded } from '../shared/workflow-testing';
import { validateTestNode } from '../shared/node-test';
import { TestNodeTransfers } from './testNodeTransfer';
import { loadActionCatalog } from './core/catalog';
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  parseWindowState,
  resolveWindowGeometry,
  serializeWindowState,
  type WindowState,
} from './windowState';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'onmyoji-resource',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

let mainWindow: BrowserWindow | undefined;
let setupWindow: BrowserWindow | undefined;
/** 画布性能基准窗口（仅 `ONMYOJI_BENCHMARK=1` 时创建）。 */
let benchmarkWindow: BrowserWindow | undefined;
let project: ProjectService;
let runtime: RuntimeService;
let souls: SoulService | undefined;
let rendererServer: Server | undefined;
let rendererBaseUrl = '';
let visionTestWindow: BrowserWindow | undefined;
let workflowTestWindow: BrowserWindow | undefined;
let workflowTestService: WorkflowTestService | undefined;
let workflowTestInit: WorkflowTestInit | undefined;
const workflowTestImages = new Set<string>();
const testNodeTransfers = new TestNodeTransfers();
let visionTestStream: VisionStream | undefined;
let visionTestInstanceId = '';
let liveViewWindow: BrowserWindow | undefined;
let liveViewInstanceId = '';
let liveViewRequest: LiveViewRequest | undefined;
let liveViewWatching = false;
let liveViewSeq = -1;
let liveViewIntervalMs = LIVE_VIEW_DEFAULT_INTERVAL_MS;
let isQuitting = false;
/** MCP 审批通道：轮询 Python 写下的请求，并把用户的选择写回。 */
let mcpApprovalBridge: McpApprovalBridge | undefined;
/** 请求号 → 等待用户答复的 resolver。 */
const approvalAnswers = new Map<string, (decision: McpApprovalDecision) => void>();
let resourceManager: RuntimeResourceManager | undefined;
let runtimeInitialized = false;
const LAYOUT_STORE_FILENAME = 'onmyoji-layouts.json';
const THEME_STORE_KEY = 'onmyoji-studio.appearance';
const LIVE_VIEW_INTERVAL_STORE_KEY = 'onmyoji-studio.live-view.interval-ms';
/** 主窗口几何（位置/尺寸/最大化）与停靠布局同库存放：都是「用户布局」。 */
const WINDOW_STATE_STORE_KEY = 'onmyoji-studio.window-state.v1';
const DEFAULT_WINDOW_WIDTH = 1560;
const DEFAULT_WINDOW_HEIGHT = 940;
const appIconPath = path.join(
  app.getAppPath(),
  app.isPackaged ? 'dist' : 'src',
  'renderer',
  'assets',
  'onmyoji-icon.png',
);
/** 拖动/缩放时的合并窗口：move 事件很多，逐次同步重写整份布局存储不划算。 */
const WINDOW_STATE_WRITE_DELAY_MS = 300;

if (process.platform === 'win32') app.setAppUserModelId('com.oooonmyoji.studio');

function readTheme(): AppearanceTheme {
  const value = readLayoutStore()[THEME_STORE_KEY];
  return isAppearanceTheme(value) ? value : 'dark';
}

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function startRendererServer(root: string): Promise<string> {
  const resolvedRoot = path.resolve(root);
  const server = createServer(async (request, response) => {
    try {
      const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const decodedPath = decodeURIComponent(requestPath);
      const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
      const filePath = path.resolve(resolvedRoot, relativePath);
      if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('无法启动桌面端本地渲染服务');
  }
  rendererServer = server;
  return `http://127.0.0.1:${address.port}`;
}

function ownerWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner) throw new Error('找不到桌面窗口');
  return owner;
}

function layoutStorePath(): string {
  return path.join(app.getPath('userData'), LAYOUT_STORE_FILENAME);
}

function readLayoutStore(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(layoutStorePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function writeLayout(key: unknown, value: unknown): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > 160 || (value !== null && typeof value !== 'string')) return;
  try {
    const store = readLayoutStore();
    if (value === null) delete store[key];
    else store[key] = value;
    const filename = layoutStorePath();
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, JSON.stringify(store), 'utf8');
  } catch {
    // Layout persistence is best-effort; a renderer failure must not affect the app.
  }
}

/** 上一份主窗口几何；没有（首次运行）或存坏了都按 `undefined` 处理。 */
function readWindowState(): WindowState | undefined {
  return parseWindowState(readLayoutStore()[WINDOW_STATE_STORE_KEY]);
}

function stopVisionTestStream(): void {
  const stream = visionTestStream;
  visionTestStream = undefined;
  if (stream) void stream.stop();
}

function openWorkflowTestWindow(init: WorkflowTestInit): void {
  if (workflowTestWindow && !workflowTestWindow.isDestroyed()) {
    if (workflowTestService?.running) throw new Error('测试台正在运行，请先停止测试再打开另一份流程');
    workflowTestInit = init;
    workflowTestWindow.webContents.send('test:event', { type: 'init', init });
    workflowTestWindow.focus();
    return;
  }
  workflowTestInit = init;
  workflowTestImages.clear();
  const window = new BrowserWindow({
    width: 1450, height: 950, minWidth: 1050, minHeight: 700, show: false,
    icon: appIconPath, title: '节点试验台', backgroundColor: themeBackground(readTheme()),
    frame: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  const service = new WorkflowTestService(project.projectRoot);
  workflowTestWindow = window;
  workflowTestService = service;
  service.on('event', (event) => { if (!window.isDestroyed()) window.webContents.send('test:event', event); });
  void window.loadURL(`${rendererBaseUrl}/workflow-test.html`);
  window.once('ready-to-show', () => window.show());
  window.on('maximize', () => window.webContents.send('window:maximized', true));
  window.on('unmaximize', () => window.webContents.send('window:maximized', false));
  window.once('closed', () => {
    // Keep the service registered until it exits, so another run cannot race its device input.
    if (workflowTestWindow === window) workflowTestWindow = undefined;
    void service.dispose().finally(() => { if (workflowTestService === service) workflowTestService = undefined; });
  });
}

function openVisionTestWindow(instanceId: string): void {
  if (visionTestWindow && !visionTestWindow.isDestroyed()) {
    visionTestWindow.focus();
    return;
  }
  visionTestInstanceId = instanceId || '';
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    frame: false,
    icon: appIconPath,
    title: '模拟器画面测试工具',
    backgroundColor: themeBackground(readTheme()),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  visionTestWindow = window;
  void window.loadURL(`${rendererBaseUrl}/vision-test.html?instance=${encodeURIComponent(visionTestInstanceId)}`);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (visionTestWindow === window) visionTestWindow = undefined;
    stopVisionTestStream();
  });
}

function startVisionTestStream(): void {  if (visionTestStream?.running) return;
  stopVisionTestStream();
  const stream = new VisionStream(project.projectRoot, visionTestInstanceId);
  visionTestStream = stream;
  stream.on('event', (event: VisionStreamEvent) => {
    if (visionTestWindow && !visionTestWindow.isDestroyed()) {
      visionTestWindow.webContents.send('vision:event', event);
    }
  });
  stream.on('exit', ({ code, fatal }) => {
    if (visionTestStream === stream) visionTestStream = undefined;
    if (!visionTestWindow || visionTestWindow.isDestroyed()) return;
    visionTestWindow.webContents.send('vision:event', {
      type: 'stream_exit',
      code,
      message: fatal || '画面推流已停止',
      error: Boolean(fatal),
    });
  });
  void stream.start().catch((error) => {
    if (visionTestWindow && !visionTestWindow.isDestroyed()) {
      visionTestWindow.webContents.send('vision:event', {
        type: 'stream_exit',
        code: null,
        message: `启动画面推流失败：${(error as Error).message}`,
        error: true,
      });
    }
  });
}

function readLiveViewPoll(): LiveViewPollResult {
  const request = liveViewRequest;
  if (!request) return { status: 'idle', message: '实时视觉监视尚未初始化。' };
  return readLiveViewFrame(request.directory, liveViewInstanceId, liveViewSeq);
}

function openLiveViewWindow(instanceId: string): void {
  const target = instanceId || '';
  // 刷新率是观看偏好：沿用上次的选择，并让运行时的预览通道按它起步。
  liveViewIntervalMs = clampLiveViewInterval(readLayoutStore()[LIVE_VIEW_INTERVAL_STORE_KEY] ?? LIVE_VIEW_DEFAULT_INTERVAL_MS);
  liveViewRequest?.setInterval(liveViewIntervalMs);
  runtime.liveViewIntervalMs = liveViewIntervalMs;
  if (liveViewWindow && !liveViewWindow.isDestroyed()) {
    // 换个实例看时同一个窗口直接切过去，避免开出第二个观看窗口互相抢帧。
    if (target && target !== liveViewInstanceId) {
      liveViewInstanceId = target;
      liveViewSeq = -1;
      void liveViewWindow.loadURL(`${rendererBaseUrl}/live-view.html?instance=${encodeURIComponent(target)}`);
    }
    liveViewWindow.focus();
    return;
  }
  liveViewInstanceId = target;
  liveViewSeq = -1;
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    frame: false,
    icon: appIconPath,
    title: '实时视觉监视',
    backgroundColor: themeBackground(readTheme()),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  liveViewWindow = window;
  void window.loadURL(`${rendererBaseUrl}/live-view.html?instance=${encodeURIComponent(target)}`);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (liveViewWindow === window) liveViewWindow = undefined;
    liveViewWatching = false;
  });
}

function registerIpc(): void {
  ipcMain.on('layout:read', (event, key: unknown) => {
    event.returnValue = typeof key === 'string' ? readLayoutStore()[key] ?? null : null;
  });
  ipcMain.on('layout:write', (_event, key: unknown, value: unknown) => {
    writeLayout(key, value);
  });
  // 用户在 MCP 确认弹窗里的选择：只应答一次，未知请求号直接忽略。
  ipcMain.on('mcp:approval-answer', (_event, requestId: unknown, decision: unknown) => {
    if (typeof requestId !== 'string') return;
    if (decision !== 'allow' && decision !== 'allow_session' && decision !== 'deny') return;
    const resolve = approvalAnswers.get(requestId);
    if (!resolve) return;
    approvalAnswers.delete(requestId);
    resolve(decision);
  });

  ipcMain.handle('project:bootstrap', async () => project.bootstrap(await runtime.listInstances()));
  const ai = new AiAssistant(path.join(app.getPath('userData'), 'ai-settings.json'), {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  }, net.fetch.bind(net), relative => loadAiImage(project.projectRoot, relative, nativeImage.createFromBuffer));
  ipcMain.handle('ai:settings', () => ai.getSettings());
  ipcMain.handle('ai:save-settings', (_event, value) => ai.saveSettings(value));
  ipcMain.handle('ai:test', () => ai.testConnection());
  ipcMain.handle('ai:suggest', (_event, value) => ai.suggest(value));
  ipcMain.handle('project:get-workflow-init', async (_event, uri: string, selectedInstance: string, canGoBack: boolean) => {
    const instances = await runtime.listInstances();
    const selected = chooseRuntimeInstance(instances, selectedInstance);
    const init = await project.getWorkflowInit(uri, selected, canGoBack);
    init.instances = instances;
    init.selectedInstance = selected;
    return init;
  });
  ipcMain.handle('project:save-workflow', (_event, uri: string, text: string) => project.saveWorkflow(uri, text));
  ipcMain.handle('project:get-editing-library', () => project.editingLibrary.list());
  ipcMain.handle('project:update-editing-library', (_event, change) => project.editingLibrary.update(change));
  ipcMain.handle('project:list-workflow-history', (_event, uri: string) => project.listWorkflowHistory(uri));
  ipcMain.handle('project:read-workflow-history', (_event, uri: string, id: string) => project.readWorkflowHistory(uri, id));
  ipcMain.handle('project:create-workflow', (event) => project.createWorkflow(ownerWindow(event)));
  ipcMain.handle('project:create-reusable-function', (_event, name: string, text: string) => project.createReusableFunction(name, text));
  ipcMain.handle('project:open-workflow-file', (_event, uri: string) => project.openWorkflowFile(uri));
  ipcMain.handle('project:open-content-item', (_event, relativePath: string) => project.openContentItem(relativePath));
  ipcMain.handle('project:move-content', (_event, request) => project.moveContent(request));
  ipcMain.handle('project:copy-content', (_event, request) => project.copyContent(request));
  ipcMain.handle('project:list-content-folders', () => project.listContentFolders());
  ipcMain.handle('project:create-content-folder', (_event, request) => project.createContentFolder(request));
  ipcMain.handle('project:rename-content', (_event, request) => project.renameContent(request));
  ipcMain.handle('project:delete-content', (_event, relativePath: string) => project.deleteContent(relativePath));
  ipcMain.handle('project:reference-graph', (_event, target: string) => project.getReferenceGraph(target));
  ipcMain.handle('project:read-content-preview', (_event, relativePath: string) => project.readContentPreview(relativePath));
  ipcMain.handle('project:list-assets', () => project.listAssets());
  ipcMain.handle('project:read-asset-data', (_event, paths: string[]) => project.readAssetData(paths));
  ipcMain.handle('project:save-template', (_event, request: SaveTemplateRequest) => project.saveTemplate(request));
  ipcMain.handle('project:save-canvas', (event, request: SaveCanvasRequest) => project.saveCanvas(ownerWindow(event), request));
  ipcMain.handle('project:copy-image', (event, dataUrl: unknown) => {
    ownerWindow(event);
    return copyPngToClipboard(dataUrl, items => clipboard.write(items), nativeImage.createFromDataURL);
  });

  ipcMain.handle('runtime:list-instances', () => runtime.listInstances());
  ipcMain.handle('souls:list-instances', async () => souls!.listInstances(await runtime.listInstances()));
  ipcMain.handle('lineups:search', (_event, request: unknown) => searchLineups(request));
  ipcMain.handle('lineups:open-post', async (_event, bvid: unknown) => {
    if (typeof bvid !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error('阵容来源链接无效');
    await shell.openExternal(`https://www.bilibili.com/video/${bvid}/`);
  });
  ipcMain.handle('lineups:open-url', async (_event, source: unknown, rawUrl: unknown) => {
    const allowedHosts: Record<LineupExternalSource, string[]> = {
      bilibili: ['www.bilibili.com'],
      'netease-community': ['ds.163.com'],
      'netease-official': ['yys.163.com', 'yys.16163.com'],
      weibo: ['weibo.com', 'www.weibo.com'],
      nga: ['nga.cn', 'www.nga.cn', 'nga.178.com', 'bbs.nga.cn'],
    };
    if (typeof source !== 'string' || !Object.prototype.hasOwnProperty.call(allowedHosts, source) || typeof rawUrl !== 'string') throw new Error('阵容来源链接无效');
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new Error('阵容来源链接无效'); }
    if (url.protocol !== 'https:' || !allowedHosts[source as LineupExternalSource].includes(url.hostname.toLowerCase())) throw new Error('阵容来源链接无效');
    await shell.openExternal(url.href);
  });
  ipcMain.handle('lineups:open-source', async (_event, source: unknown, keyword: unknown) => {
    const sources: LineupExternalSource[] = ['bilibili', 'netease-community', 'netease-official', 'weibo', 'nga'];
    if (typeof source !== 'string' || !sources.includes(source as LineupExternalSource)) throw new Error('阵容来源无效');
    const term = typeof keyword === 'string' ? keyword.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
    const q = `阴阳师 ${term} 阵容`.trim();
    if (source === 'nga') {
      await shell.openExternal(NGA_BOARD_URL);
      return;
    }
    if (source === 'netease-community') {
      await shell.openExternal('https://ds.163.com/topic/%E9%98%B4%E9%98%B3%E5%B8%88/');
      return;
    }
    if (source === 'bilibili') {
      const searchUrl = new URL('https://search.bilibili.com/all');
      searchUrl.searchParams.set('keyword', q);
      searchUrl.searchParams.set('order', 'pubdate');
      await shell.openExternal(searchUrl.toString());
      return;
    }
    if (source === 'weibo') {
      const searchUrl = new URL('https://s.weibo.com/weibo');
      searchUrl.searchParams.set('q', q);
      await shell.openExternal(searchUrl.toString());
      return;
    }
    const url = new URL('https://www.baidu.com/s');
    const sourceQuery = {
      'netease-official': `site:yys.163.com ${q}`,
    };
    url.searchParams.set('wd', sourceQuery[source as keyof typeof sourceQuery]);
    await shell.openExternal(url.toString());
  });
  ipcMain.handle('souls:fetch', async (_event, instanceId: unknown) => {
    if (typeof instanceId !== 'string' || !(await runtime.listInstances()).some((item) => item.id === instanceId)) {
      throw new Error('所选实例已离线，请刷新实例列表');
    }
    return souls!.fetch(instanceId);
  });
  // 载入上次保存的快照：实例可以已经离线，所以这里不校验在线状态。
  ipcMain.handle('souls:load', (_event, instanceId: unknown) => {
    if (typeof instanceId !== 'string' || !instanceId) throw new Error('请选择有效的模拟器实例');
    return souls!.load(instanceId);
  });
  ipcMain.handle('souls:cancel', (_event, instanceId: unknown) => typeof instanceId === 'string' ? souls?.cancel(instanceId) : undefined);
  ipcMain.handle('runtime:run-workflow', (_event, request: RunWorkflowRequest) => {
    if (workflowTestService?.usingDevice) throw new Error('脚本测试正在运行，请先停止测试');
    // 每次用户重新启动工作流时，先清掉日志面板中上次运行的记录。
    _event.sender.send('runtime:log-clear');
    // 先把观看请求登记下去，再 spawn 运行时：否则运行时启动初期的帧会被门控丢掉。
    liveViewRequest?.begin(request.instanceId);
    return runtime.runWorkflow(request);
  });
  ipcMain.handle('runtime:stop-workflow', async () => {
    liveViewRequest?.stop();
    await runtime.stopWorkflow();
  });
  ipcMain.handle('runtime:get-debug-settings', () => runtime.getDebugSettings());
  ipcMain.handle('runtime:update-debug-settings', (_event, settings: RuntimeDebugSettings) => runtime.updateDebugSettings(settings));
  ipcMain.handle('runtime:capture-roi', (_event, request: RoiCaptureRequest) => runtime.captureRoi(request));
  ipcMain.handle('runtime:check-template', (_event, request: TemplateCheckRequest) => runtime.checkTemplate(request));

  ipcMain.handle('test:open', (event, init: WorkflowTestInit) => {
    if (ownerWindow(event) !== mainWindow) throw new Error('请从工作流编辑器打开测试台');
    if (workflowTestService?.running && !workflowTestWindow) throw new Error('正在停止上一次测试，请稍后重试');
    openWorkflowTestWindow(init);
  });
  const testOwner = (event: IpcMainInvokeEvent): void => {
    if (ownerWindow(event) !== workflowTestWindow) throw new Error('请从节点试验台操作');
  };
  ipcMain.handle('test:init', (event) => { testOwner(event); return workflowTestInit; });
  ipcMain.handle('test:images', async (event) => {
    testOwner(event);
    const result = await dialog.showOpenDialog(ownerWindow(event), { title: '选择离线测试截图', properties: ['openFile', 'multiSelections'], filters: [{ name: '截图', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
    for (const file of result.filePaths) workflowTestImages.add(path.resolve(file));
    return result.filePaths;
  });
  ipcMain.handle('test:start', (event, request: WorkflowTestRequest) => {
    testOwner(event);
    if (request.mode === 'live' && (runtime.running || visionTestStream?.running)) throw new Error('请先停止正在运行的脚本或画面测试');
    if (request.images?.some((file) => !workflowTestImages.has(path.resolve(file)))) throw new Error('请通过选择截图按钮重新选择文件');
    return workflowTestService?.start(request);
  });
  ipcMain.handle('test:command', (event, command: TestCommand) => { testOwner(event); workflowTestService?.command(command); });
  ipcMain.handle('test:report', (event) => {
    testOwner(event);
    if (workflowTestService?.reportPath) shell.showItemInFolder(workflowTestService.reportPath);
  });
  ipcMain.handle('test:template', async (event) => {
    testOwner(event);
    const result = await dialog.showOpenDialog(ownerWindow(event), { title: '选择模板图片', properties: ['openFile'], filters: [{ name: '模板图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
    if (result.canceled || !result.filePaths[0]) return undefined;
    const source = path.resolve(result.filePaths[0]);
    const relative = path.relative(project.projectRoot, source);
    if (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) return relative.split(path.sep).join('/');
    const folder = path.join(project.projectRoot, 'assets', 'templates'); mkdirSync(folder, { recursive: true });
    const parsed = path.parse(source); let target = path.join(folder, parsed.base), index = 1;
    while (existsSync(target)) target = path.join(folder, `${parsed.name}-${index++}${parsed.ext}`);
    copyFileSync(source, target);
    return path.relative(project.projectRoot, target).split(path.sep).join('/');
  });
  ipcMain.handle('test:add-node', async (event, draft: TestNodeDraft) => {
    testOwner(event);
    if (!workflowTestInit?.uri || !mainWindow || mainWindow.isDestroyed()) throw new Error('请先打开目标工作流');
    const node = validateTestNode(draft, loadActionCatalog(project.projectRoot).all());
    const id = await testNodeTransfers.add(workflowTestInit.uri, node, request => mainWindow!.webContents.send('test:add-node', request));
    if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
    return id;
  });
  ipcMain.handle('test:node-added', (event, result: TestNodeAdded) => {
    if (ownerWindow(event) !== mainWindow) throw new Error('请从工作流编辑器操作');
    testNodeTransfers.complete(result);
  });

  ipcMain.handle('tools:open-vision-test', (_event, instanceId: string) => {
    if (workflowTestService?.usingDevice) throw new Error('请先停止脚本测试');
    openVisionTestWindow(typeof instanceId === 'string' ? instanceId : '');
  });
  ipcMain.handle('tools:open-live-view', (_event, instanceId: string) => {
    openLiveViewWindow(typeof instanceId === 'string' ? instanceId : '');
  });
  ipcMain.handle('live-view:watch', (event, watching: unknown) => {
    if (ownerWindow(event) !== liveViewWindow) return;
    liveViewWatching = watching === true;
    // 重新开始观看时先取一次最新帧，避免继续显示上次看过的旧序号。
    if (liveViewWatching) liveViewSeq = -1;
  });
  ipcMain.handle('live-view:set-interval', (event, intervalMs: unknown) => {
    if (ownerWindow(event) !== liveViewWindow) return liveViewIntervalMs;
    const applied = liveViewRequest?.setInterval(intervalMs) ?? liveViewIntervalMs;
    liveViewIntervalMs = applied;
    runtime.liveViewIntervalMs = applied;
    // 记住选择：下次打开窗口时运行时按同一个刷新率起步。
    writeLayout(LIVE_VIEW_INTERVAL_STORE_KEY, String(applied));
    return applied;
  });
  ipcMain.handle('live-view:poll', (event) => {
    if (ownerWindow(event) !== liveViewWindow) return { status: 'idle', message: '窗口已关闭。' } satisfies LiveViewPollResult;
    if (!liveViewWatching) return { status: 'idle', message: '未开始观看。' } satisfies LiveViewPollResult;
    const result = readLiveViewPoll();
    if (result.status === 'frame') {
      liveViewSeq = result.frame.seq;
      // 确实取到了新帧，说明有运行在写：续一次观看心跳。
      liveViewRequest?.touch();
    }
    return result;
  });
  ipcMain.handle('help:open-readme', async () => {
    const readmePath = path.join(project.projectRoot, 'README.md');
    const error = await shell.openPath(readmePath);
    if (error) throw new Error(`打开使用说明失败：${error}`);
  });
  ipcMain.handle('vision:start', (event) => {
    if (ownerWindow(event) !== visionTestWindow) return;
    startVisionTestStream();
  });
  ipcMain.handle('vision:command', (event, command: VisionCommand) => {
    if (ownerWindow(event) !== visionTestWindow) return;
    if (!visionTestStream || !visionTestStream.sendCommand(command)) throw new Error('画面推流未连接');
  });
  ipcMain.handle('vision:stop', (event) => {
    if (ownerWindow(event) !== visionTestWindow) return;
    stopVisionTestStream();
  });
}

function registerShellIpc(): void {
  ipcMain.handle('window:minimize', (event) => ownerWindow(event).minimize());
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = ownerWindow(event);
    const wasMaximized = window.isMaximized();
    if (wasMaximized) window.unmaximize();
    else window.maximize();
    return !wasMaximized;
  });
  ipcMain.handle('window:close', (event) => ownerWindow(event).close());
  ipcMain.handle('window:is-maximized', (event) => ownerWindow(event).isMaximized());
  ipcMain.on('appearance:read', (event) => { event.returnValue = readTheme(); });
  ipcMain.on('appearance:write', (event, value: unknown) => {
    if (isAppearanceTheme(value)) writeLayout(THEME_STORE_KEY, value);
    const theme = readTheme();
    nativeTheme.themeSource = themeColorScheme(theme);
    for (const window of BrowserWindow.getAllWindows()) {
      window.setBackgroundColor(themeBackground(theme));
      window.webContents.send('appearance:changed', theme);
    }
    event.returnValue = theme;
  });
}

function isRendererUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(rendererBaseUrl).origin;
  } catch {
    return false;
  }
}

/**
 * 画布性能基准窗口：隐藏的基准宿主页。
 *
 * 只在 `ONMYOJI_BENCHMARK=1` 时创建；窗口不可见、不接收输入，
 * 由 `desktop/scripts/canvas-benchmark.cjs` 通过调试端口读取测量结果。
 * 桌面端设计规则不允许「操控窗口做验证」，所以这里只提供一个可编程入口，不做鼠标模拟。
 */
function createBenchmarkWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1920,
    height: 1080,
    // 不可见 + 不抢焦点：基准不参与正常使用，也不需要鼠标/键盘输入。
    show: false,
    frame: false,
    icon: appIconPath,
    title: 'AutoFlow Studio Canvas Benchmark',
    backgroundColor: '#141414',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      // 基准窗口永远不该被当成「后台标签」节流，否则帧间隔数据不可用。
      backgroundThrottling: false,
    },
  });
  // 隐藏窗口在部分平台上仍然拿不到渲染帧；基准不依赖帧间隔判定，但把窗口
  // 标成不节流 + 允许渲染，能让帧间隔数据在与真实使用接近的条件下产生。
  window.webContents.setBackgroundThrottling(false);
  void window.loadURL(`${rendererBaseUrl}/canvas-benchmark.html`);
  return window;
}

function createWindow(): BrowserWindow {
  // 用户布局：窗口位置、尺寸与最大化状态一并恢复。上一份几何落不到任何显示器
  // 工作区里（换屏/改分辨率）时退回默认窗口，交给系统居中。
  const geometry = resolveWindowGeometry(
    readWindowState(),
    screen.getAllDisplays().map((display) => display.workArea),
    { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT },
  );
  const window = new BrowserWindow({
    width: geometry.width,
    height: geometry.height,
    ...(geometry.x === undefined || geometry.y === undefined ? {} : { x: geometry.x, y: geometry.y }),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    frame: false,
    icon: appIconPath,
    title: 'AutoFlow Studio',
    backgroundColor: themeBackground(readTheme()),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  // 在 show 之前最大化：窗口第一次出现就是最大化状态，不会先闪一个窗口化的尺寸。
  if (geometry.maximized) window.maximize();

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      const base = new URL(rendererBaseUrl);
      const isPopout = parsed.origin === base.origin && parsed.pathname === '/popout.html';
      return isPopout ? {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 720,
          height: 520,
          minWidth: 320,
          minHeight: 220,
          frame: false,
          icon: appIconPath,
          title: 'AutoFlow Studio',
          backgroundColor: themeBackground(readTheme()),
          autoHideMenuBar: true,
          webPreferences: {
            preload: path.join(__dirname, '..', 'preload', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
          },
        },
      } : { action: 'deny' };
    } catch {
      return { action: 'deny' };
    }
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isRendererUrl(url)) event.preventDefault();
  });
  window.webContents.on('did-create-window', (childWindow) => {
    childWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    childWindow.webContents.on('will-navigate', (event, url) => {
      if (!isRendererUrl(url)) event.preventDefault();
    });
  });
  window.once('ready-to-show', () => window.show());
  const sendMaximizedState = (): void => window.webContents.send('window:maximized', window.isMaximized());
  // 拖动/缩放按合并窗口写入，最大化状态与关闭前各补一次；最大化时记的是还原后的
  // 几何（`getNormalBounds`），所以取消最大化仍能回到原来的位置与尺寸。
  const rememberWindowState = (): void => {
    if (window.isDestroyed()) return;
    writeLayout(WINDOW_STATE_STORE_KEY, serializeWindowState({
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
    }));
  };
  let windowStateTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRememberWindowState = (): void => {
    if (windowStateTimer !== undefined) clearTimeout(windowStateTimer);
    windowStateTimer = setTimeout(() => {
      windowStateTimer = undefined;
      rememberWindowState();
    }, WINDOW_STATE_WRITE_DELAY_MS);
  };
  window.on('resize', scheduleRememberWindowState);
  window.on('move', scheduleRememberWindowState);
  window.on('maximize', () => { sendMaximizedState(); scheduleRememberWindowState(); });
  window.on('unmaximize', () => { sendMaximizedState(); scheduleRememberWindowState(); });
  window.on('close', () => {
    if (windowStateTimer !== undefined) {
      clearTimeout(windowStateTimer);
      windowStateTimer = undefined;
    }
    rememberWindowState();
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  const devUrl = process.env.ONMYOJI_DESKTOP_DEV_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadURL(`${rendererBaseUrl}/index.html`);
  return window;
}

function createSetupWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 700,
    height: 460,
    minWidth: 620,
    minHeight: 400,
    show: false,
    frame: false,
    icon: appIconPath,
    title: 'AutoFlow Studio 初始化',
    backgroundColor: '#151515',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { if (setupWindow === window) setupWindow = undefined; });
  void window.loadURL(`${rendererBaseUrl}/setup.html`);
  return window;
}

async function initializeRuntimeServices(projectRoot: string): Promise<void> {
  if (runtimeInitialized) return;
  runtimeInitialized = true;
  project = new ProjectService(projectRoot);
  runtime = new RuntimeService(project);
  souls = new SoulService(projectRoot);
  souls.on('progress', (progress) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('souls:progress', progress);
    }
  });
  liveViewRequest = new LiveViewRequest(runtime.liveViewDirectory);
  await protocol.handle('onmyoji-resource', (request) => {
    const file = project.resolveResourceUrl(request.url);
    if (!file) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  registerIpc();
  runtime.on('output', (event) => mainWindow?.webContents.send('runtime:output', event));
  runtime.on('state', (event) => mainWindow?.webContents.send('runtime:state', event));
  runtime.on('runEvent', (event) => mainWindow?.webContents.send('runtime:run-event', event));
  startMcpApprovalBridge(projectRoot);
}

/**
 * MCP 门控操作的确认弹窗：Python 侧把请求写进 `artifacts/mcp-approvals/pending/`，
 * 这里把它交给渲染层已有的确认弹窗，再把用户的答案写回文件。
 *
 * 回答集合按请求号保存，`mcp:approval-answer` 只应答一次；窗口没了就按拒绝回答，
 * 免得 Python 侧一直等到超时。
 */
function startMcpApprovalBridge(projectRoot: string): void {
  if (mcpApprovalBridge) return;
  mcpApprovalBridge = new McpApprovalBridge({
    directory: path.join(projectRoot, 'artifacts', MCP_APPROVAL_DIRNAME),
    ask: (request) => askRendererForApproval(request),
  });
  mcpApprovalBridge.start();
}

function askRendererForApproval(request: McpApprovalRequest): Promise<McpApprovalDecision> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return Promise.resolve('deny');
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  // 任务栏闪一下：弹窗在后台窗口里，用户不一定马上看到。
  window.flashFrame(true);
  return new Promise<McpApprovalDecision>((resolve) => {
    approvalAnswers.set(request.id, (decision) => {
      if (!window.isDestroyed()) window.flashFrame(false);
      resolve(decision);
    });
    window.webContents.send('mcp:approval-request', request);
  });
}

function registerResourceIpc(projectRoot: string): void {
  ipcMain.handle('resources:status', () => resourceManager?.status() ?? {
    ready: true,
    activeVariant: 'cpu',
    variants: [{
      id: 'cpu', label: '内置运行环境', description: '此版本已内置运行资源。', version: app.getVersion(),
      installedVersion: app.getVersion(), downloadBytes: 0, installed: true, ready: true,
      supported: true, supportMessage: '已内置',
    }],
  });
  const variantId = (value: unknown): RuntimeResourceVariantId => {
    if (value !== 'cpu' && value !== 'gpu') throw new Error('未知的运行环境类型');
    return value;
  };
  ipcMain.handle('resources:install', async (event, value: unknown) => {
    if (!resourceManager) return;
    const id = variantId(value);
    await resourceManager.install(
      id,
      (url) => net.fetch(url),
      (progress) => event.sender.send('resources:progress', progress),
    );
  });
  ipcMain.handle('resources:activate', async (_event, value: unknown) => {
    if (!resourceManager) throw new Error('当前版本使用内置运行环境，无法切换');
    if (runtime?.running || visionTestStream?.running || workflowTestService?.running) throw new Error('有任务或测试正在运行，请先停止后再切换');
    const result = resourceManager.activate(variantId(value));
    process.env.ONMYOJI_RUNTIME_ROOT = resourceManager.runtimeRoot;
    process.env.ONMYOJI_OCR_USE_GPU = result.activeVariant === 'gpu' ? '1' : '0';
    await initializeRuntimeServices(projectRoot);
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
    setupWindow?.close();
    return result;
  });
  ipcMain.handle('resources:remove', (_event, value: unknown) => {
    if (!resourceManager) throw new Error('当前版本使用内置运行环境，无法删除');
    if (runtime?.running || visionTestStream?.running || workflowTestService?.running) throw new Error('有任务或测试正在运行，请先停止后再管理运行环境');
    return resourceManager.remove(variantId(value));
  });
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = themeColorScheme(readTheme());
  const configuredRoot = process.env.ONMYOJI_PROJECT_ROOT;
  const projectRoot = configuredRoot ? path.resolve(configuredRoot) : path.resolve(app.getAppPath(), '..');
  const devUrl = process.env.ONMYOJI_DESKTOP_DEV_URL;
  rendererBaseUrl = devUrl ? new URL(devUrl).origin : await startRendererServer(path.join(app.getAppPath(), 'dist', 'renderer'));
  registerShellIpc();
  const manifestPath = path.join(projectRoot, 'runtime-manifest.json');
  const bundledPython = path.join(projectRoot, 'tools', 'python312-embed', 'python.exe');
  if (!existsSync(bundledPython) && existsSync(manifestPath)) {
    resourceManager = new RuntimeResourceManager(projectRoot, app.getPath('userData'), manifestPath);
  }
  registerResourceIpc(projectRoot);
  const resourceStatus = resourceManager?.status();
  if (resourceStatus?.ready && resourceManager) {
    process.env.ONMYOJI_RUNTIME_ROOT = resourceManager.runtimeRoot;
    process.env.ONMYOJI_OCR_USE_GPU = resourceStatus.activeVariant === 'gpu' ? '1' : '0';
  }
  if (!resourceManager || resourceManager.status().ready) await initializeRuntimeServices(projectRoot);
  // 画布性能基准：只加载基准宿主页（隐藏窗口），不创建主工作台窗口。
  // 由 desktop/scripts/canvas-benchmark.cjs 通过调试端口驱动，不参与正常使用。
  if (process.env.ONMYOJI_BENCHMARK === '1') {
    benchmarkWindow = createBenchmarkWindow();
  } else if (runtimeInitialized) {
    mainWindow = createWindow();
  } else {
    setupWindow = createSetupWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (runtimeInitialized) mainWindow = createWindow();
      else setupWindow = createSetupWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  void (async () => {
    try {
      await souls?.dispose();
      await runtime?.dispose();
      await workflowTestService?.dispose();
    } finally {
      stopVisionTestStream();
      liveViewRequest?.stop();
      mcpApprovalBridge?.stop();
      // 还没答复的审批请求一律按拒绝收尾，避免 Python 侧等到超时。
      for (const [requestId, resolve] of approvalAnswers) {
        approvalAnswers.delete(requestId);
        resolve('deny');
      }
      rendererServer?.close();
      rendererServer = undefined;
      app.quit();
    }
  })();
});
