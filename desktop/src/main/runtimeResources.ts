import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  RuntimeResourceProgress,
  RuntimeResourceStatus,
  RuntimeResourceVariantId,
  RuntimeResourceVariantStatus,
} from '../shared/contracts';

interface RuntimeArtifact {
  url: string;
  sha256: string;
  size: number;
}

interface RuntimeVariantManifest {
  id: RuntimeResourceVariantId;
  label: string;
  description: string;
  accelerator: 'cpu' | 'nvidia';
  version: string;
  artifacts: RuntimeArtifact[];
}

interface RuntimeCatalogManifest {
  schemaVersion: 2;
  platform: 'win32-x64';
  variants: RuntimeVariantManifest[];
}

interface LegacyRuntimeManifest {
  schemaVersion: 1;
  version: string;
  platform: 'win32-x64';
  url: string;
  sha256: string;
  size: number;
}

type ResourceFetcher = (url: string) => Promise<Response>;
type GpuProbe = () => { supported: boolean; message: string };

function validDownload(value: Partial<RuntimeArtifact>): boolean {
  let url: URL | undefined;
  try { url = typeof value.url === 'string' ? new URL(value.url) : undefined; } catch { return false; }
  return Boolean(
    url?.protocol === 'https:' && url.hostname === 'github.com'
    && typeof value.sha256 === 'string' && /^[a-f\d]{64}$/i.test(value.sha256)
    && typeof value.size === 'number' && value.size > 0,
  );
}

function artifactsFor(value: Partial<RuntimeVariantManifest> & Partial<RuntimeArtifact>): RuntimeArtifact[] {
  if (Array.isArray(value.artifacts)) return value.artifacts;
  return validDownload(value) ? [{ url: value.url!, sha256: value.sha256!, size: value.size! }] : [];
}

function readCatalog(filename: string): RuntimeCatalogManifest {
  const parsed = JSON.parse(fs.readFileSync(filename, 'utf8')) as Record<string, unknown>;
  if (parsed.schemaVersion === 1 && parsed.platform === 'win32-x64' && typeof parsed.version === 'string'
    && parsed.version.trim() && validDownload(parsed as Partial<RuntimeArtifact>)) {
    const legacy = parsed as unknown as LegacyRuntimeManifest;
    return {
      schemaVersion: 2,
      platform: 'win32-x64',
      variants: [{
        id: 'cpu',
        label: 'CPU 通用版',
        description: '兼容所有 Windows 电脑，稳定且无需独立显卡。',
        accelerator: 'cpu',
        version: legacy.version, artifacts: [{ url: legacy.url, sha256: legacy.sha256, size: legacy.size }],
      }],
    };
  }
  if (parsed.schemaVersion !== 2 || parsed.platform !== 'win32-x64' || !Array.isArray(parsed.variants)
    || parsed.variants.length === 0) throw new Error('运行资源清单无效');
  const catalog = parsed as unknown as RuntimeCatalogManifest;
  const ids = new Set<string>();
  for (const item of catalog.variants) {
    if (!item || !['cpu', 'gpu'].includes(item.id) || ids.has(item.id)
      || !['cpu', 'nvidia'].includes(item.accelerator)
      || typeof item.version !== 'string' || !item.version.trim()
      || artifactsFor(item).length === 0 || !artifactsFor(item).every(validDownload)
      || typeof item.label !== 'string' || typeof item.description !== 'string') {
      throw new Error('运行资源清单无效');
    }
    ids.add(item.id);
  }
  return { ...catalog, variants: catalog.variants.map((item) => ({ ...item, artifacts: artifactsFor(item) })) };
}

function detectNvidiaGpu(): { supported: boolean; message: string } {
  const result = spawnSync('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'], {
    encoding: 'utf8', windowsHide: true, timeout: 4000,
  });
  const line = typeof result.stdout === 'string' ? result.stdout.trim().split(/\r?\n/)[0] : '';
  return line
    ? { supported: true, message: line }
    : { supported: false, message: '未检测到可用的 NVIDIA 显卡或驱动' };
}

export class RuntimeResourceManager {
  private readonly runtimesRoot: string;
  private readonly selectionPath: string;
  private readonly installing = new Map<RuntimeResourceVariantId, Promise<void>>();
  private gpuSupport: { supported: boolean; message: string } | undefined;

  constructor(
    private readonly projectRoot: string,
    private readonly userDataRoot: string,
    private readonly manifestPath: string,
    private readonly gpuProbe: GpuProbe = detectNvidiaGpu,
  ) {
    this.runtimesRoot = path.join(userDataRoot, 'runtimes');
    this.selectionPath = path.join(userDataRoot, 'runtime-selection.json');
  }

  get runtimeRoot(): string {
    return this.variantRoot(this.activeVariantId());
  }

  private get catalog(): RuntimeCatalogManifest { return readCatalog(this.manifestPath); }

  private variant(id: RuntimeResourceVariantId): RuntimeVariantManifest {
    const item = this.catalog.variants.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`当前版本未提供${id === 'gpu' ? ' GPU' : ' CPU'}运行资源`);
    return item;
  }

  private variantRoot(id: RuntimeResourceVariantId): string { return path.join(this.runtimesRoot, id); }

  private probeGpu(): { supported: boolean; message: string } {
    this.gpuSupport ??= this.gpuProbe();
    return this.gpuSupport;
  }

  private readInstalledVersion(id: RuntimeResourceVariantId): string | undefined {
    try {
      const ready = JSON.parse(fs.readFileSync(path.join(this.variantRoot(id), '.resource-ready.json'), 'utf8')) as {
        version?: unknown; variant?: unknown;
      };
      if (typeof ready.version === 'string' && (!ready.variant || ready.variant === id)) return ready.version;
    } catch {
      // 未安装或上次初始化未完整结束。
    }
    return undefined;
  }

  private requiredFiles(id: RuntimeResourceVariantId): string[] {
    const root = this.variantRoot(id);
    return [
      path.join(root, 'tools', 'python312-embed', 'python.exe'),
      path.join(root, '.venv', 'Lib', 'site-packages', 'paddle', '__init__.py'),
      path.join(root, '.venv', 'Lib', 'site-packages', 'paddlex', '__init__.py'),
      path.join(root, '.paddlex', 'official_models'),
    ];
  }

  private isReady(item: RuntimeVariantManifest): boolean {
    return this.readInstalledVersion(item.id) === item.version
      && this.requiredFiles(item.id).every((filename) => fs.existsSync(filename));
  }

  private readSelection(): RuntimeResourceVariantId | undefined {
    try {
      const value = JSON.parse(fs.readFileSync(this.selectionPath, 'utf8')) as { activeVariant?: unknown };
      if (value.activeVariant === 'cpu' || value.activeVariant === 'gpu') return value.activeVariant;
    } catch {
      // 第一次启动还没有选择。
    }
    return undefined;
  }

  private activeVariantId(): RuntimeResourceVariantId {
    const catalog = this.catalog;
    const selected = this.readSelection();
    if (selected && catalog.variants.some((item) => item.id === selected)) return selected;
    return catalog.variants.find((item) => this.isReady(item))?.id
      ?? catalog.variants.find((item) => item.id === 'cpu')?.id
      ?? catalog.variants[0].id;
  }

  private migrateLegacyRuntime(): void {
    const legacy = path.join(this.userDataRoot, 'runtime');
    const target = this.variantRoot('cpu');
    if (!fs.existsSync(legacy) || fs.existsSync(target) || !this.catalog.variants.some((item) => item.id === 'cpu')) return;
    fs.mkdirSync(this.runtimesRoot, { recursive: true });
    try { fs.renameSync(legacy, target); } catch { return; }
    fs.writeFileSync(this.selectionPath, `${JSON.stringify({ activeVariant: 'cpu' }, null, 2)}\n`, 'utf8');
  }

  status(): RuntimeResourceStatus {
    this.migrateLegacyRuntime();
    const catalog = this.catalog;
    const activeVariant = this.activeVariantId();
    let gpu: { supported: boolean; message: string } | undefined;
    const variants: RuntimeResourceVariantStatus[] = catalog.variants.map((item) => {
      if (item.accelerator === 'nvidia' && !gpu) gpu = this.probeGpu();
      const support = item.accelerator === 'nvidia' ? gpu! : { supported: true, message: '所有 Windows x64 电脑均可使用' };
      const installedVersion = this.readInstalledVersion(item.id);
      const ready = this.isReady(item);
      return {
        id: item.id, label: item.label, description: item.description, version: item.version,
        installedVersion, downloadBytes: item.artifacts.reduce((sum, artifact) => sum + artifact.size, 0), installed: Boolean(installedVersion), ready,
        supported: support.supported, supportMessage: support.message,
      };
    });
    return { ready: variants.some((item) => item.id === activeVariant && item.ready), activeVariant, variants };
  }

  install(id: RuntimeResourceVariantId, fetcher: ResourceFetcher, notify: (progress: RuntimeResourceProgress) => void): Promise<void> {
    const current = this.installing.get(id);
    if (current) return current;
    const task = this.installOnce(id, fetcher, notify).finally(() => this.installing.delete(id));
    this.installing.set(id, task);
    return task;
  }

  activate(id: RuntimeResourceVariantId): RuntimeResourceStatus {
    const item = this.variant(id);
    if (!this.isReady(item)) throw new Error(`请先安装${item.label}`);
    fs.mkdirSync(this.userDataRoot, { recursive: true });
    fs.writeFileSync(this.selectionPath, `${JSON.stringify({ activeVariant: id }, null, 2)}\n`, 'utf8');
    return this.status();
  }

  remove(id: RuntimeResourceVariantId): RuntimeResourceStatus {
    const item = this.variant(id);
    if (this.activeVariantId() === id && this.isReady(item)) throw new Error('当前正在使用该运行环境，请先切换到另一个版本');
    fs.rmSync(this.variantRoot(id), { recursive: true, force: true });
    return this.status();
  }

  private async installOnce(id: RuntimeResourceVariantId, fetcher: ResourceFetcher, notify: (progress: RuntimeResourceProgress) => void): Promise<void> {
    const manifest = this.variant(id);
    if (manifest.accelerator === 'nvidia') {
      const support = this.probeGpu();
      if (!support.supported) throw new Error(support.message);
    }
    const staging = path.join(this.userDataRoot, `runtime-${id}-staging`);
    const archives = manifest.artifacts.map((_artifact, index) => path.join(this.userDataRoot, `runtime-${id}-${index + 1}-download.zip`));
    const totalBytes = manifest.artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
    fs.mkdirSync(this.userDataRoot, { recursive: true });
    fs.rmSync(staging, { recursive: true, force: true });
    for (const archive of archives) fs.rmSync(archive, { force: true });
    try {
      fs.mkdirSync(staging, { recursive: true });
      let completedBytes = 0;
      for (const [index, artifact] of manifest.artifacts.entries()) {
        const archive = archives[index];
        notify({ variant: id, phase: 'downloading', receivedBytes: completedBytes, totalBytes, message: `正在下载${manifest.label}（${index + 1}/${manifest.artifacts.length}）…` });
        const response = await fetcher(artifact.url);
        if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}）`);
        const hash = createHash('sha256');
        let received = 0;
        let lastUpdate = 0;
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            hash.update(chunk); received += chunk.length;
            const now = Date.now();
            if (now - lastUpdate >= 120 || received === artifact.size) {
              lastUpdate = now;
              notify({ variant: id, phase: 'downloading', receivedBytes: completedBytes + received, totalBytes, message: `正在下载${manifest.label}（${index + 1}/${manifest.artifacts.length}）…` });
            }
            callback(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(archive));
        notify({ variant: id, phase: 'verifying', receivedBytes: completedBytes + received, totalBytes, message: `正在校验资源（${index + 1}/${manifest.artifacts.length}）…` });
        if (hash.digest('hex').toLowerCase() !== artifact.sha256.toLowerCase()) throw new Error('下载文件校验失败，请重试');
        notify({ variant: id, phase: 'extracting', receivedBytes: completedBytes + received, totalBytes, message: `正在安装${manifest.label}（${index + 1}/${manifest.artifacts.length}）…` });
        await this.extract(archive, staging);
        completedBytes += received;
        fs.rmSync(archive, { force: true });
      }
      if (!fs.existsSync(path.join(staging, 'tools', 'python312-embed', 'python.exe'))) throw new Error('资源包缺少 Python 运行环境');
      this.writeProjectPath(staging);
      fs.writeFileSync(path.join(staging, '.resource-ready.json'), `${JSON.stringify({ version: manifest.version, variant: id })}\n`, 'utf8');
      const target = this.variantRoot(id);
      fs.mkdirSync(this.runtimesRoot, { recursive: true });
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(staging, target);
      notify({ variant: id, phase: 'ready', receivedBytes: totalBytes, totalBytes, message: `${manifest.label}安装完成` });
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      for (const archive of archives) fs.rmSync(archive, { force: true });
      const message = error instanceof Error ? error.message : String(error);
      notify({ variant: id, phase: 'failed', receivedBytes: 0, totalBytes, message });
      throw error;
    }
  }

  private extract(archive: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('tar.exe', ['-xf', archive, '-C', destination], { windowsHide: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`资源解压失败（代码 ${code ?? '未知'}）`)));
    });
  }

  private writeProjectPath(root: string): void {
    const filename = path.join(root, 'tools', 'python312-embed', 'python312._pth');
    const current = fs.readFileSync(filename, 'utf8').split(/\r?\n/).filter(Boolean);
    const lines = current.filter((line) => !line.startsWith('# onmyoji-project='));
    lines.splice(Math.max(0, lines.length - 1), 0, this.projectRoot, `# onmyoji-project=${this.projectRoot}`);
    fs.writeFileSync(filename, `${lines.join('\n')}\n`, 'utf8');
  }
}
