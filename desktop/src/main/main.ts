import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  type IpcMainInvokeEvent,
} from 'electron';
import type {
  RoiCaptureRequest,
  RunWorkflowRequest,
  SaveCanvasRequest,
  SaveTemplateRequest,
  TemplateCheckRequest,
} from '../shared/contracts';
import { chooseRuntimeInstance } from './core/runtimeInstances';
import { ProjectService } from './projectService';
import { RuntimeService } from './runtimeService';

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
  ipcMain.handle('project:list-assets', () => project.listAssets());
  ipcMain.handle('project:read-asset-data', (_event, paths: string[]) => project.readAssetData(paths));
  ipcMain.handle('project:save-template', (_event, request: SaveTemplateRequest) => project.saveTemplate(request));
  ipcMain.handle('project:save-canvas', (event, request: SaveCanvasRequest) => project.saveCanvas(ownerWindow(event), request));

  ipcMain.handle('runtime:list-instances', () => runtime.listInstances());
  ipcMain.handle('runtime:run-workflow', (_event, request: RunWorkflowRequest) => runtime.runWorkflow(request));
  ipcMain.handle('runtime:stop-workflow', () => runtime.stopWorkflow());
  ipcMain.handle('runtime:capture-roi', (_event, request: RoiCaptureRequest) => runtime.captureRoi(request));
  ipcMain.handle('runtime:check-template', (_event, request: TemplateCheckRequest) => runtime.checkTemplate(request));
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
    backgroundColor: '#111317',
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
          backgroundColor: '#111317',
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
  const configuredRoot = process.env.ONMYOJI_PROJECT_ROOT;
  const projectRoot = configuredRoot ? path.resolve(configuredRoot) : path.resolve(app.getAppPath(), '..');
  project = new ProjectService(projectRoot);
  runtime = new RuntimeService(project);

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

app.on('before-quit', () => {
  runtime?.dispose();
  rendererServer?.close();
  rendererServer = undefined;
});
