import { isAppearanceTheme, themeColorScheme, themeBackground, type AppearanceTheme } from '../shared/appearance';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  nativeTheme,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import type {
  LiveViewPollResult,
  RoiCaptureRequest,
  RunWorkflowRequest,
  RuntimeDebugSettings,
  SaveCanvasRequest,
  SaveTemplateRequest,
  TemplateCheckRequest,
  VisionCommand,
  VisionStreamEvent,
} from '../shared/contracts';
import { chooseRuntimeInstance } from './core/runtimeInstances';
import {
  clampLiveViewInterval,
  createLiveViewEnvironment,
  LIVE_VIEW_DEFAULT_INTERVAL_MS,
  LiveViewRequest,
  readLiveViewFrame,
} from './liveView';
import { ProjectService } from './projectService';
import { RuntimeService } from './runtimeService';
import { VisionStream } from './visionStream';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'onmyoji-resource',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

let mainWindow: BrowserWindow | undefined;
let project: ProjectService;
let runtime: RuntimeService;
let rendererServer: Server | undefined;
let rendererBaseUrl = '';
let visionTestWindow: BrowserWindow | undefined;
let visionTestStream: VisionStream | undefined;
let visionTestInstanceId = '';
let liveViewWindow: BrowserWindow | undefined;
let liveViewInstanceId = '';
let liveViewRequest: LiveViewRequest | undefined;
let liveViewWatching = false;
let liveViewSeq = -1;
let liveViewIntervalMs = LIVE_VIEW_DEFAULT_INTERVAL_MS;
let isQuitting = false;
const LAYOUT_STORE_FILENAME = 'onmyoji-layouts.json';
const THEME_STORE_KEY = 'onmyoji-studio.appearance';
const LIVE_VIEW_INTERVAL_STORE_KEY = 'onmyoji-studio.live-view.interval-ms';
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

function stopVisionTestStream(): void {
  const stream = visionTestStream;
  visionTestStream = undefined;
  if (stream) void stream.stop();
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
  ipcMain.on('layout:read', (event, key: unknown) => {
    event.returnValue = typeof key === 'string' ? readLayoutStore()[key] ?? null : null;
  });
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
  ipcMain.on('layout:write', (_event, key: unknown, value: unknown) => {
    writeLayout(key, value);
  });

  ipcMain.handle('project:bootstrap', async () => project.bootstrap(await runtime.listInstances()));
  ipcMain.handle('project:get-workflow-init', async (_event, uri: string, selectedInstance: string, canGoBack: boolean) => {
    const instances = await runtime.listInstances();
    const selected = chooseRuntimeInstance(instances, selectedInstance);
    const init = await project.getWorkflowInit(uri, selected, canGoBack);
    init.instances = instances;
    init.selectedInstance = selected;
    return init;
  });
  ipcMain.handle('project:save-workflow', (_event, uri: string, text: string) => project.saveWorkflow(uri, text));
  ipcMain.handle('project:create-workflow', (event) => project.createWorkflow(ownerWindow(event)));
  ipcMain.handle('project:open-workflow-file', (_event, uri: string) => project.openWorkflowFile(uri));
  ipcMain.handle('project:open-content-item', (_event, relativePath: string) => project.openContentItem(relativePath));
  ipcMain.handle('project:move-content', (_event, request) => project.moveContent(request));
  ipcMain.handle('project:list-content-folders', () => project.listContentFolders());
  ipcMain.handle('project:create-content-folder', (_event, request) => project.createContentFolder(request));
  ipcMain.handle('project:rename-content', (_event, request) => project.renameContent(request));
  ipcMain.handle('project:delete-content', (_event, relativePath: string) => project.deleteContent(relativePath));
  ipcMain.handle('project:reference-graph', (_event, target: string) => project.getReferenceGraph(target));
  ipcMain.handle('project:list-assets', () => project.listAssets());
  ipcMain.handle('project:read-asset-data', (_event, paths: string[]) => project.readAssetData(paths));
  ipcMain.handle('project:save-template', (_event, request: SaveTemplateRequest) => project.saveTemplate(request));
  ipcMain.handle('project:save-canvas', (event, request: SaveCanvasRequest) => project.saveCanvas(ownerWindow(event), request));

  ipcMain.handle('runtime:list-instances', () => runtime.listInstances());
  ipcMain.handle('runtime:run-workflow', (_event, request: RunWorkflowRequest) => {
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

  ipcMain.handle('tools:open-vision-test', (_event, instanceId: string) => {
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

function isRendererUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(rendererBaseUrl).origin;
  } catch {
    return false;
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 880,
    minHeight: 620,
    show: false,
    frame: false,
    title: 'Onmyoji Studio',
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
          title: 'Onmyoji Studio',
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
  window.on('maximize', sendMaximizedState);
  window.on('unmaximize', sendMaximizedState);
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  const devUrl = process.env.ONMYOJI_DESKTOP_DEV_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadURL(`${rendererBaseUrl}/index.html`);
  return window;
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = themeColorScheme(readTheme());
  const configuredRoot = process.env.ONMYOJI_PROJECT_ROOT;
  const projectRoot = configuredRoot ? path.resolve(configuredRoot) : path.resolve(app.getAppPath(), '..');
  project = new ProjectService(projectRoot);
  runtime = new RuntimeService(project);
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
  const devUrl = process.env.ONMYOJI_DESKTOP_DEV_URL;
  rendererBaseUrl = devUrl ? new URL(devUrl).origin : await startRendererServer(path.join(app.getAppPath(), 'dist', 'renderer'));
  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
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
      await runtime?.dispose();
    } finally {
      stopVisionTestStream();
      liveViewRequest?.stop();
      rendererServer?.close();
      rendererServer = undefined;
      app.quit();
    }
  })();
});
