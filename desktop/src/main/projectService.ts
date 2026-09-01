import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BrowserWindow, dialog, shell } from 'electron';
import type {
  AssetImage,
  BootstrapData,
  RuntimeInstance,
  SaveCanvasRequest,
  SaveTemplateRequest,
  WorkflowDescriptor,
  WorkflowEditorInit,
} from '../shared/contracts';
import { loadActionCatalog } from './core/catalog';
import { collectRefSuggestions, parseWorkflow, validateWorkflow } from './core/workflow';

const IMAGE_MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.bmp', 'image/bmp'],
]);

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function encodeResourcePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]/)
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function workflowTemplate(id: string): Record<string, unknown> {
  return {
    schema_version: 3,
    id,
    version: '3.0.0',
    description: '',
    resolution: [1920, 1080],
    root: 'root',
    limits: { timeout_seconds: 300, max_steps: 1000 },
    blackboard: {},
    nodes: [
      { id: 'root', type: 'root', children: ['capture'] },
      { id: 'capture', type: 'task', action: 'core.capture', params: {} },
    ],
  };
}

export class ProjectService {
  readonly workflowRoot: string;
  readonly assetsRoot: string;

  constructor(readonly projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.workflowRoot = path.join(this.projectRoot, 'workflows');
    this.assetsRoot = path.join(this.projectRoot, 'assets');
  }

  private workflowPath(uri: string): string {
    let candidate: string;
    try {
      candidate = uri.startsWith('file:') ? fileURLToPath(uri) : path.resolve(uri);
    } catch {
      throw new Error('工作流路径无效');
    }
    if (!isPathInside(this.workflowRoot, candidate) || path.extname(candidate).toLowerCase() !== '.json') {
      throw new Error('工作流必须位于项目 workflows 目录内');
    }
    return candidate;
  }

  resolveWorkflowPath(uri: string): string {
    return this.workflowPath(uri);
  }

  workflowReference(uri: string): string {
    return path.relative(this.workflowRoot, this.workflowPath(uri)).split(path.sep).join('/');
  }

  resourceUrl(candidate: string): string {
    const absolutePath = path.resolve(candidate);
    if (!isPathInside(this.projectRoot, absolutePath)) return '';
    const relative = path.relative(this.projectRoot, absolutePath);
    return `onmyoji-resource://project/${encodeResourcePath(relative)}`;
  }

  resolveResourceUrl(rawUrl: string): string | undefined {
    try {
      const resource = new URL(rawUrl);
      if (resource.protocol !== 'onmyoji-resource:' || resource.hostname !== 'project') return undefined;
      const relative = decodeURIComponent(resource.pathname).replace(/^[/\\]+/, '');
      const absolutePath = path.resolve(this.projectRoot, relative);
      return isPathInside(this.projectRoot, absolutePath) ? absolutePath : undefined;
    } catch {
      return undefined;
    }
  }

  async listWorkflows(): Promise<WorkflowDescriptor[]> {
    const files: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
      for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolutePath);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(absolutePath);
      }
    };
    await visit(this.workflowRoot);

    const descriptors = await Promise.all(files.slice(0, 500).map(async (file): Promise<WorkflowDescriptor> => {
      let id = '';
      let description = '';
      let variables: WorkflowDescriptor['variables'] = [];
      try {
        const raw = JSON.parse(await fs.promises.readFile(file, 'utf8')) as unknown;
        const parsed = parseWorkflow(raw);
        id = parsed.id ?? '';
        description = parsed.description?.trim() ?? '';
        variables = Object.entries(parsed.blackboard).map(([name, definition]) => ({
          name,
          public: definition.public !== false,
          definition,
        }));
      } catch {
        // Invalid JSON remains visible so the user can repair it in the editor.
      }
      return {
        uri: pathToFileURL(file).toString(),
        name: path.basename(file),
        rel: path.relative(this.projectRoot, file).split(path.sep).join('/'),
        ...(id ? { id } : {}),
        ...(description ? { description } : {}),
        ...(variables.length ? { variables } : {}),
      };
    }));
    return descriptors.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN') || left.rel.localeCompare(right.rel, 'zh-CN'));
  }

  async bootstrap(instances: RuntimeInstance[]): Promise<BootstrapData> {
    const workflows = await this.listWorkflows();
    const preferred = workflows.find((item) => item.rel.endsWith('/three_mumu_souls_parallel.json'))
      ?? workflows.find((item) => item.rel.includes('/entrypoints/'))
      ?? workflows[0];
    return {
      projectRoot: this.projectRoot,
      workflows,
      instances,
      catalog: loadActionCatalog(this.projectRoot).all(),
      defaultWorkflow: preferred?.uri,
    };
  }

  async getWorkflowInit(uri: string, selectedInstance: string, canGoBack: boolean): Promise<WorkflowEditorInit> {
    const file = this.workflowPath(uri);
    const text = await fs.promises.readFile(file, 'utf8');
    const catalog = loadActionCatalog(this.projectRoot);
    let raw: unknown = null;
    let parseIssue: WorkflowEditorInit['issues'] = [];
    try {
      raw = JSON.parse(text) as unknown;
    } catch (error) {
      parseIssue = [{ path: [], message: `JSON 解析失败：${(error as Error).message}`, severity: 'error', code: 'invalid-json' }];
    }
    const info = parseWorkflow(raw);
    const refs = collectRefSuggestions(info, catalog);
    const issues = parseIssue.length > 0 ? parseIssue : validateWorkflow(raw, catalog);
    return {
      type: 'init',
      document: { uri: pathToFileURL(file).toString(), name: path.basename(file), text },
      workflows: await this.listWorkflows(),
      canGoBack,
      catalog: catalog.all(),
      refs,
      issues,
      projectRoot: this.projectRoot,
      assetsBaseUri: `${this.resourceUrl(this.assetsRoot).replace(/\/?$/, '/')}`,
      instances: [],
      selectedInstance,
    };
  }

  async saveWorkflow(uri: string, text: string): Promise<void> {
    const file = this.workflowPath(uri);
    JSON.parse(text) as unknown;
    await fs.promises.writeFile(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  }

  async createWorkflow(owner: BrowserWindow): Promise<string | undefined> {
    await fs.promises.mkdir(path.join(this.workflowRoot, 'entrypoints'), { recursive: true });
    const result = await dialog.showSaveDialog(owner, {
      title: '新建工作流',
      defaultPath: path.join(this.workflowRoot, 'entrypoints', 'new_workflow.json'),
      buttonLabel: '创建',
      filters: [{ name: '工作流 JSON', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return undefined;
    const file = this.workflowPath(result.filePath);
    const id = path.basename(file, path.extname(file)).replace(/[^A-Za-z0-9_-]+/g, '_') || 'new_workflow';
    await fs.promises.writeFile(file, `${JSON.stringify(workflowTemplate(id), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return pathToFileURL(file).toString();
  }

  async openWorkflowFile(uri: string): Promise<void> {
    const error = await shell.openPath(this.workflowPath(uri));
    if (error) throw new Error(error);
  }

  async openContentItem(relativePath: string): Promise<void> {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    const absolutePath = path.resolve(this.projectRoot, normalized);
    const extension = path.extname(absolutePath).toLowerCase();
    const isWorkflow = normalized.startsWith('workflows/')
      && isPathInside(this.workflowRoot, absolutePath)
      && extension === '.json';
    const isAsset = normalized.startsWith('assets/')
      && isPathInside(this.assetsRoot, absolutePath)
      && IMAGE_MIME.has(extension);
    if (!isWorkflow && !isAsset) throw new Error('内容浏览器不允许打开此文件');
    const error = await shell.openPath(absolutePath);
    if (error) throw new Error(error);
  }

  async listAssets(): Promise<AssetImage[]> {
    const images: AssetImage[] = [];
    const visit = async (directory: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
      for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolutePath);
        else if (entry.isFile() && IMAGE_MIME.has(path.extname(entry.name).toLowerCase())) {
          images.push({
            path: path.relative(this.projectRoot, absolutePath).split(path.sep).join('/'),
            uri: this.resourceUrl(absolutePath),
          });
        }
      }
    };
    await visit(this.assetsRoot);
    return images;
  }

  async readAssetData(paths: string[]): Promise<Array<{ path: string; dataUrl: string }>> {
    const items: Array<{ path: string; dataUrl: string }> = [];
    for (const raw of paths.slice(0, 64)) {
      const relative = raw.replace(/\\/g, '/').trim();
      const absolutePath = path.resolve(this.projectRoot, relative);
      const extension = path.extname(absolutePath).toLowerCase();
      if (!relative.startsWith('assets/') || !isPathInside(this.assetsRoot, absolutePath) || !IMAGE_MIME.has(extension)) continue;
      try {
        const stat = await fs.promises.stat(absolutePath);
        if (stat.size > 8 * 1024 * 1024) continue;
        const bytes = await fs.promises.readFile(absolutePath);
        items.push({ path: relative, dataUrl: `data:${IMAGE_MIME.get(extension)};base64,${bytes.toString('base64')}` });
      } catch {
        // A missing thumbnail should not fail the complete canvas export.
      }
    }
    return items;
  }

  async saveTemplate(request: SaveTemplateRequest): Promise<string> {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(request.dataUrl);
    if (!match) throw new Error('模板图片数据无效');
    const requestedTarget = request.targetPath?.replace(/\\/g, '/').trim();
    let filename = request.filename
      .replace(/\\/g, '/')
      .replace(/[\x00-\x1f<>:"|?*]/g, '_')
      .replace(/^\/+/, '')
      .trim();
    filename = path.posix.normalize(filename);
    if (!filename || filename === '.' || filename === '..' || filename.startsWith('../') || filename.includes('/../')) filename = 'template.png';
    if (!/\.png$/i.test(filename)) filename += '.png';

    let relativePath = path.posix.join('assets/templates', filename);
    if (requestedTarget) {
      const normalized = path.posix.normalize(requestedTarget);
      if (!normalized.startsWith('assets/') || normalized.includes('..')) throw new Error('模板覆盖路径无效');
      const expectedMime = new Map([['.png', 'png'], ['.jpg', 'jpeg'], ['.jpeg', 'jpeg'], ['.webp', 'webp']]).get(path.posix.extname(normalized).toLowerCase());
      if (!expectedMime || expectedMime !== match[1]) throw new Error('模板图片格式与原文件扩展名不一致');
      relativePath = normalized;
    } else if (match[1] !== 'png') {
      throw new Error('新模板必须使用 PNG 格式');
    }
    const outputPath = path.resolve(this.projectRoot, relativePath);
    if (!isPathInside(this.assetsRoot, outputPath)) throw new Error('模板路径无效');
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, Buffer.from(match[2], 'base64'));
    return relativePath;
  }

  async saveCanvas(owner: BrowserWindow, request: SaveCanvasRequest): Promise<string | undefined> {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(request.dataUrl);
    if (!match) throw new Error('画布图片数据无效');
    let filename = request.filename.replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').trim();
    if (!filename || filename === '.' || filename === '..') filename = 'workflow-layout.png';
    if (!/\.png$/i.test(filename)) filename += '.png';
    const result = await dialog.showSaveDialog(owner, {
      title: '导出完整工作流画布',
      defaultPath: path.join(this.workflowRoot, filename),
      buttonLabel: '导出',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return undefined;
    await fs.promises.writeFile(result.filePath, Buffer.from(match[1], 'base64'));
    return result.filePath;
  }
}
