import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BrowserWindow, dialog, shell } from 'electron';
import type {
  AssetImage,
  BootstrapData,
  ReferenceGraph,
  RuntimeInstance,
  SaveCanvasRequest,
  SaveTemplateRequest,
  MoveContentRequest,
  MoveContentResult,
  CreateContentFolderRequest,
  RenameContentRequest,
  WorkflowDescriptor,
  WorkflowEditorInit,
} from '../shared/contracts';
import { loadActionCatalog } from './core/catalog';
import { buildReferenceGraph } from './core/references';
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
    schema_version: 4,
    id,
    version: '4.0.0',
    description: '',
    resolution: [1920, 1080],
    root: 'root',
    limits: { timeout_seconds: 300, max_steps: 1000 },
    inputs: {},
    variables: {},
    nodes: [
      { id: 'root', type: 'root', children: ['capture'] },
      { id: 'capture', type: 'task', action: 'core.capture', params: {} },
    ],
  };
}

interface ContentFileLocation {
  relative: string;
  absolute: string;
  kind: 'workflow' | 'asset';
}

interface ContentReferenceMapping {
  oldRelative: string;
  newRelative: string;
  kind: 'workflow' | 'asset';
}

interface RewritePlan {
  absolute: string;
  original: string;
  updated: string;
  references: number;
}

function normalizeProjectRelative(raw: string): string {
  const value = String(raw ?? '').replace(/\\/g, '/').trim();
  if (!value || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) throw new Error('文件路径无效');
  const normalized = path.posix.normalize(value).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('文件路径无效');
  }
  return normalized;
}

function normalizeContentName(raw: string): string {
  const name = String(raw ?? '').trim();
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name) || /[<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
    throw new Error('名称无效');
  }
  return name;
}

function preservePathStyle(original: string, target: string): string {
  const replacement = target.replace(/\//g, original.includes('\\') ? '\\' : '/');
  return original.trim().startsWith('./') ? `./${replacement}` : replacement;
}

function replaceExactReference(value: string, oldRelative: string, newRelative: string, kind: 'workflow' | 'asset'): string {
  const normalized = value.replace(/\\/g, '/').trim();
  const stripped = normalized.replace(/^\.\//, '');
  const oldPath = oldRelative.toLowerCase();
  const oldWithoutRoot = oldRelative.replace(/^(?:workflows|assets)\//i, '').toLowerCase();
  const candidates = new Set([oldPath, oldWithoutRoot]);
  const matched = candidates.has(stripped.toLowerCase())
    ? stripped.toLowerCase()
    : undefined;
  if (!matched) return value;
  const target = kind === 'workflow' && matched === oldWithoutRoot
    ? newRelative.replace(/^workflows\//i, '')
    : newRelative;
  return preservePathStyle(value, target);
}

function rewriteJsonReferences(value: unknown, oldRelative: string, newRelative: string, kind: 'workflow' | 'asset'): { value: unknown; references: number } {
  if (typeof value === 'string') {
    const replaced = replaceExactReference(value, oldRelative, newRelative, kind);
    return { value: replaced, references: replaced === value ? 0 : 1 };
  }
  if (Array.isArray(value)) {
    let references = 0;
    const rewritten = value.map((item) => {
      const result = rewriteJsonReferences(item, oldRelative, newRelative, kind);
      references += result.references;
      return result.value;
    });
    return { value: rewritten, references };
  }
  if (!value || typeof value !== 'object') return { value, references: 0 };
  let references = 0;
  const rewritten: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const result = rewriteJsonReferences(item, oldRelative, newRelative, kind);
    references += result.references;
    rewritten[key] = result.value;
  }
  return { value: rewritten, references };
}

function rewriteSerializedReferences(original: string, oldRelative: string, newRelative: string, kind: 'workflow' | 'asset'): string {
  const oldRoot = kind === 'workflow' ? 'workflows/' : 'assets/';
  const oldWithoutRoot = oldRelative.replace(new RegExp(`^${oldRoot}`, 'i'), '');
  const newWithoutRoot = newRelative.replace(new RegExp(`^${oldRoot}`, 'i'), '');
  const variants = new Set<string>();
  for (const relative of [oldRelative, oldWithoutRoot]) {
    for (const prefix of ['', './']) {
      for (const separator of ['/', '\\']) {
        variants.add(`${prefix}${relative.replace(/\//g, separator)}`);
      }
    }
  }
  let updated = original;
  for (const variant of variants) {
    const normalized = variant.replace(/\\/g, '/');
    const isRootless = normalized.replace(/^\.\//, '').toLowerCase() === oldWithoutRoot.toLowerCase();
    const replacementPath = kind === 'workflow' && isRootless ? newWithoutRoot : newRelative;
    const replacement = replacementPath.replace(/\//g, variant.includes('\\') ? '\\' : '/');
    const encodedOld = JSON.stringify(variant);
    const encodedNew = JSON.stringify(variant.trim().startsWith('./') ? `./${replacement}` : replacement);
    // A JSON string followed by a comma/closing token is a value (not an object key).
    updated = updated.replace(new RegExp(`${escapeRegExp(encodedOld)}(?=\\s*[,}\\]])`, 'g'), encodedNew);
  }
  return updated;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      let inputs: WorkflowDescriptor['inputs'] = [];
      try {
        const raw = JSON.parse(await fs.promises.readFile(file, 'utf8')) as unknown;
        const parsed = parseWorkflow(raw);
        id = parsed.id ?? '';
        description = parsed.description?.trim() ?? '';
        inputs = Object.entries(parsed.inputs).map(([name, definition]) => ({
          name,
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
        ...(inputs.length ? { inputs } : {}),
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

  private resolveContentLocation(relativePath: string): ContentFileLocation {
    const normalized = normalizeProjectRelative(relativePath);
    const rootName = normalized.split('/')[0]?.toLowerCase();
    const root = rootName === 'workflows' ? this.workflowRoot : rootName === 'assets' ? this.assetsRoot : undefined;
    if (!root) throw new Error('内容必须位于 assets 或 workflows 目录内');
    const absolute = path.resolve(this.projectRoot, ...normalized.split('/'));
    if (!isPathInside(root, absolute)) throw new Error('文件必须位于项目目录内');
    return { relative: normalized, absolute, kind: rootName === 'workflows' ? 'workflow' : 'asset' };
  }

  private async resolveContentEntry(relativePath: string): Promise<ContentFileLocation & { isDirectory: boolean }> {
    const location = this.resolveContentLocation(relativePath);
    const stat = await fs.promises.stat(location.absolute).catch(() => undefined);
    if (!stat) throw new Error('内容不存在');
    if (stat.isDirectory()) return { ...location, isDirectory: true };
    const extension = path.extname(location.absolute).toLowerCase();
    const supported = location.kind === 'workflow' ? extension === '.json' : IMAGE_MIME.has(extension);
    if (!supported) throw new Error('内容浏览器只支持工作流和模板图片');
    return { ...location, isDirectory: false };
  }

  private resolveContentFile(relativePath: string): ContentFileLocation {
    const location = this.resolveContentLocation(relativePath);
    const extension = path.extname(location.absolute).toLowerCase();
    const supported = location.kind === 'workflow' ? extension === '.json' : IMAGE_MIME.has(extension);
    if (!supported) throw new Error('内容浏览器只支持移动工作流和模板图片');
    return location;
  }

  async listContentFolders(): Promise<string[]> {
    const folders = new Set<string>(['assets', 'workflows']);
    const visit = async (root: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(root, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const absolute = path.join(root, entry.name);
        folders.add(path.relative(this.projectRoot, absolute).split(path.sep).join('/'));
        await visit(absolute);
      }
    };
    await Promise.all([visit(this.assetsRoot), visit(this.workflowRoot)]);
    return [...folders].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  }

  async createContentFolder(request: CreateContentFolderRequest): Promise<string> {
    const parent = normalizeProjectRelative(request.parentPath || '');
    const parentLocation = this.resolveContentLocation(parent);
    const parentStat = await fs.promises.stat(parentLocation.absolute).catch(() => undefined);
    if (!parentStat?.isDirectory()) throw new Error('目标文件夹不存在');
    const name = normalizeContentName(request.name);
    const targetRelative = path.posix.join(parentLocation.relative, name);
    const targetAbsolute = path.resolve(this.projectRoot, ...targetRelative.split('/'));
    if (!isPathInside(parentLocation.kind === 'workflow' ? this.workflowRoot : this.assetsRoot, targetAbsolute)) {
      throw new Error('目标文件夹无效');
    }
    if (await fs.promises.stat(targetAbsolute).then(() => true).catch(() => false)) throw new Error('文件夹已存在');
    await fs.promises.mkdir(targetAbsolute);
    return targetRelative;
  }

  private async workflowFiles(): Promise<string[]> {
    const files: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(absolute);
      }
    };
    await visit(this.workflowRoot);
    return files;
  }

  private async contentFiles(root: string, kind: 'workflow' | 'asset'): Promise<ContentFileLocation[]> {
    const files: ContentFileLocation[] = [];
    const visit = async (directory: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(absolute);
          continue;
        }
        const extension = path.extname(entry.name).toLowerCase();
        const supported = kind === 'workflow' ? extension === '.json' : IMAGE_MIME.has(extension);
        if (entry.isFile() && supported) {
          files.push({
            relative: path.relative(this.projectRoot, absolute).split(path.sep).join('/'),
            absolute,
            kind,
          });
        }
      }
    };
    await visit(root);
    return files;
  }

  private async buildFolderRewritePlan(source: ContentFileLocation, targetRelative: string): Promise<RewritePlan[]> {
    const descendants = await this.contentFiles(source.absolute, source.kind);
    const mappings: ContentReferenceMapping[] = descendants.map((file) => ({
      oldRelative: file.relative,
      newRelative: path.posix.join(targetRelative, path.relative(source.absolute, file.absolute).split(path.sep).join('/')),
      kind: source.kind,
    }));
    if (mappings.length === 0) return [];

    const plans: RewritePlan[] = [];
    for (const absolute of await this.workflowFiles()) {
      const original = await fs.promises.readFile(absolute, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(original) as unknown;
      } catch {
        continue;
      }
      let updated = original;
      let references = 0;
      for (const mapping of mappings) {
        const result = rewriteJsonReferences(parsed, mapping.oldRelative, mapping.newRelative, mapping.kind);
        if (result.references === 0) continue;
        const serialized = rewriteSerializedReferences(updated, mapping.oldRelative, mapping.newRelative, mapping.kind);
        updated = serialized === updated ? `${JSON.stringify(result.value, null, 2)}\n` : serialized;
        parsed = result.value;
        references += result.references;
      }
      if (references > 0) plans.push({ absolute, original, updated, references });
    }
    return plans;
  }

  private async buildMoveRewritePlan(source: ContentFileLocation, targetRelative: string): Promise<RewritePlan[]> {
    const plans: RewritePlan[] = [];
    if (source.kind === 'workflow') {
      for (const absolute of await this.workflowFiles()) {
        if (path.resolve(absolute).toLowerCase() === path.resolve(source.absolute).toLowerCase()) continue;
        const original = await fs.promises.readFile(absolute, 'utf8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(original) as unknown;
        } catch {
          continue;
        }
        const result = rewriteJsonReferences(parsed, source.relative, targetRelative, 'workflow');
        if (result.references > 0) {
          const updated = rewriteSerializedReferences(original, source.relative, targetRelative, 'workflow');
          plans.push({ absolute, original, updated: updated === original ? `${JSON.stringify(result.value, null, 2)}\n` : updated, references: result.references });
        }
      }
      return plans;
    }

    for (const absolute of await this.workflowFiles()) {
      const original = await fs.promises.readFile(absolute, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(original) as unknown;
      } catch {
        continue;
      }
      const result = rewriteJsonReferences(parsed, source.relative, targetRelative, 'asset');
      if (result.references > 0) {
        const updated = rewriteSerializedReferences(original, source.relative, targetRelative, 'asset');
        plans.push({ absolute, original, updated: updated === original ? `${JSON.stringify(result.value, null, 2)}\n` : updated, references: result.references });
      }
    }

    // 奖励模板目录使用相对于 catalog.json 的 template 字段，不能只按完整项目路径替换。
    const catalogRelative = 'assets/templates/rewards/catalog.json';
    const catalogAbsolute = path.join(this.projectRoot, ...catalogRelative.split('/'));
    const catalogDir = path.dirname(catalogAbsolute);
    try {
      const original = await fs.promises.readFile(catalogAbsolute, 'utf8');
      const parsed = JSON.parse(original) as unknown;
      const templates = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as { templates?: unknown }).templates
        : undefined;
      let references = 0;
      if (Array.isArray(templates)) {
        const sourceAbsolute = path.resolve(source.absolute);
        const nextRelative = path.relative(catalogDir, path.resolve(this.projectRoot, ...targetRelative.split('/'))).split(path.sep).join('/');
        for (const entry of templates) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
          const template = (entry as { template?: unknown }).template;
          if (typeof template !== 'string') continue;
          const referencedAbsolute = path.resolve(catalogDir, ...template.replace(/\\/g, '/').split('/'));
          if (referencedAbsolute.toLowerCase() !== sourceAbsolute.toLowerCase()) continue;
          (entry as { template: string }).template = nextRelative;
          references += 1;
        }
      }
      if (references > 0) {
        const sourceName = path.basename(source.relative);
        const targetName = path.relative(catalogDir, path.resolve(this.projectRoot, ...targetRelative.split('/'))).split(path.sep).join('/');
        const updated = rewriteSerializedReferences(original, sourceName, targetName, 'asset');
        plans.push({
          absolute: catalogAbsolute,
          original,
          updated: updated === original ? `${JSON.stringify(parsed, null, 2)}\n` : updated,
          references,
        });
      }
    } catch {
      // catalog.json 可选，缺失或无效时不影响普通模板移动。
    }
    return plans;
  }

  private async moveFile(source: ContentFileLocation, targetRelative: string): Promise<MoveContentResult> {
    const targetAbsolute = path.resolve(this.projectRoot, ...targetRelative.split('/'));
    const sourceRoot = source.kind === 'workflow' ? this.workflowRoot : this.assetsRoot;
    if (!isPathInside(sourceRoot, targetAbsolute)) throw new Error('目标位置无效');
    if (source.absolute.toLowerCase() === targetAbsolute.toLowerCase()) throw new Error('文件已经在此文件夹中');
    let targetStat: fs.Stats | undefined;
    try { targetStat = await fs.promises.stat(targetAbsolute); } catch { /* 目标不存在 */ }
    if (targetStat) throw new Error('目标文件夹中已存在同名文件');
    const folderStat = await fs.promises.stat(path.dirname(targetAbsolute)).catch(() => undefined);
    if (!folderStat?.isDirectory()) throw new Error('目标文件夹不存在');
    const sourceStat = await fs.promises.stat(source.absolute).catch(() => undefined);
    if (!sourceStat?.isFile()) throw new Error('源文件不存在');

    const plans = await this.buildMoveRewritePlan(source, targetRelative);
    const written: RewritePlan[] = [];
    let moved = false;
    try {
      await fs.promises.rename(source.absolute, targetAbsolute);
      moved = true;
      for (const plan of plans) {
        await fs.promises.writeFile(plan.absolute, plan.updated, 'utf8');
        written.push(plan);
      }
    } catch (error) {
      for (const plan of written.reverse()) {
        try { await fs.promises.writeFile(plan.absolute, plan.original, 'utf8'); } catch { /* 尽力回滚 */ }
      }
      if (moved) {
        try { await fs.promises.rename(targetAbsolute, source.absolute); } catch { /* 尽力回滚 */ }
      }
      throw error;
    }

    return {
      sourcePath: source.relative,
      targetPath: targetRelative,
      updatedFiles: plans.length,
      updatedReferences: plans.reduce((total, plan) => total + plan.references, 0),
    };
  }

  async moveContent(request: MoveContentRequest): Promise<MoveContentResult> {
    const source = this.resolveContentFile(request.sourcePath);
    const sourceRoot = source.relative.slice(0, source.relative.indexOf('/'));
    const requestedFolder = request.targetFolder ? normalizeProjectRelative(request.targetFolder) : '';
    const targetFolder = requestedFolder || sourceRoot;
    if (targetFolder !== sourceRoot && !targetFolder.startsWith(`${sourceRoot}/`)) {
      throw new Error(`文件只能移动到 ${sourceRoot}/ 目录内`);
    }
    const targetRelative = path.posix.join(targetFolder, path.posix.basename(source.relative));
    const folderStat = await fs.promises.stat(path.resolve(this.projectRoot, ...targetFolder.split('/'))).catch(() => undefined);
    if (!folderStat?.isDirectory()) throw new Error('目标文件夹不存在');
    return this.moveFile(source, targetRelative);
  }

  async renameContent(request: RenameContentRequest): Promise<MoveContentResult> {
    const source = await this.resolveContentEntry(request.sourcePath);
    if (!source.relative.includes('/')) throw new Error('项目根目录不能重命名');
    const newName = normalizeContentName(request.newName);
    const parentRelative = path.posix.dirname(source.relative);
    const targetRelative = path.posix.join(parentRelative, newName);
    const targetAbsolute = path.resolve(this.projectRoot, ...targetRelative.split('/'));
    const sourceRoot = source.kind === 'workflow' ? this.workflowRoot : this.assetsRoot;
    if (!isPathInside(sourceRoot, targetAbsolute)) throw new Error('目标位置无效');
    if (source.absolute.toLowerCase() === targetAbsolute.toLowerCase()) throw new Error('名称没有变化');
    if (await fs.promises.stat(targetAbsolute).then(() => true).catch(() => false)) throw new Error('目标位置已存在同名内容');

    if (!source.isDirectory) {
      const extension = path.extname(source.relative).toLowerCase();
      if (path.extname(newName).toLowerCase() !== extension) throw new Error('不能修改文件类型');
      return this.moveFile(source, targetRelative);
    }

    const plans = await this.buildFolderRewritePlan(source, targetRelative);
    const written: RewritePlan[] = [];
    let moved = false;
    try {
      // 文件仍在旧目录时先改写，目录整体改名后这些文件会一起带着新引用移动。
      for (const plan of plans) {
        await fs.promises.writeFile(plan.absolute, plan.updated, 'utf8');
        written.push(plan);
      }
      await fs.promises.rename(source.absolute, targetAbsolute);
      moved = true;
    } catch (error) {
      if (moved) {
        try { await fs.promises.rename(targetAbsolute, source.absolute); } catch { /* 尽力回滚 */ }
      }
      for (const plan of written.reverse()) {
        try { await fs.promises.writeFile(plan.absolute, plan.original, 'utf8'); } catch { /* 尽力回滚 */ }
      }
      throw error;
    }
    return {
      sourcePath: source.relative,
      targetPath: targetRelative,
      updatedFiles: plans.length,
      updatedReferences: plans.reduce((total, plan) => total + plan.references, 0),
    };
  }

  async deleteContent(relativePath: string): Promise<void> {
    const target = await this.resolveContentEntry(relativePath);
    if (!target.relative.includes('/')) throw new Error('项目根目录不能删除');
    if (target.isDirectory) {
      const entries = await fs.promises.readdir(target.absolute);
      if (entries.length > 0) throw new Error('文件夹不为空，请先处理其中的内容');
      await fs.promises.rmdir(target.absolute);
      return;
    }

    const graph = await this.getReferenceGraph(target.relative);
    if (graph.referencedBy.length > 0) {
      throw new Error(`内容仍被 ${graph.referencedBy.length} 项引用，暂不能删除`);
    }
    await fs.promises.unlink(target.absolute);
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

  /** 构建引用图：给定项目相对路径（工作流或模板图片），返回谁引用了它、它引用了谁。 */
  async getReferenceGraph(target: string): Promise<ReferenceGraph> {
    return buildReferenceGraph(this.projectRoot, target);
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
