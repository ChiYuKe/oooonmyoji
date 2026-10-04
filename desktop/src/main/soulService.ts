import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { parseRuntimeInstances, pythonUtf8Environment, resolvePythonRuntime } from './core/runtimeInstances';
import type { RuntimeInstance, SoulInstance } from '../shared/contracts';
import type { SoulSnapshot, SoulFetchProgress } from '../shared/souls';
import { soulIconNames } from './iconResources';

/**
 * 校验落盘或进程返回的御魂快照：实例必须一致、字段必须齐全。
 * 旧版本把原始导出写进同一文件，这里兼容 ``{ result: ... }`` 形态。
 */
export function readSoulSnapshot(value: unknown, instanceId: string): SoulSnapshot | null {
  const candidate = (value && typeof value === 'object' && 'result' in value
    ? (value as { result?: unknown }).result : value) as SoulSnapshot | undefined;
  if (!candidate || typeof candidate !== 'object') return null;
  if (candidate.instanceId !== instanceId || !Array.isArray(candidate.souls)) return null;
  if (typeof candidate.fetchedAt !== 'string' || typeof candidate.total !== 'number') return null;
  if (typeof candidate.failed !== 'number') return null;
  // Legacy exports retain the client's init rows. Repair positions in memory so
  // special/reward item IDs (180xxx) participate without rewriting the snapshot.
  const init = (value as { tables?: { init?: Record<string, { equipType?: unknown } | null> } }).tables?.init;
  if (init && typeof init === 'object') return { ...candidate, souls: candidate.souls.map(soul => {
    const equipType = Number.isSafeInteger(soul.itemId) ? init[String(soul.itemId)]?.equipType : undefined;
    return typeof equipType === 'number' && Number.isInteger(equipType) && equipType >= 11 && equipType <= 16
      ? { ...soul, position: equipType - 10 } : soul;
  }) };
  return candidate;
}

/** Keep the process alive through cancellation so its finally block restores ADB. */
export class SoulService extends EventEmitter<{ progress: [SoulFetchProgress] }> {
  private active: { instanceId: string; child: ChildProcess; finished: Promise<SoulSnapshot | null> } | undefined;
  private knownInstances = new Map<string, RuntimeInstance>();

  constructor(private readonly projectRoot: string, private readonly launch: typeof spawn = spawn) { super(); }

  get running(): boolean { return Boolean(this.active); }

  /** 每个实例一份快照：`artifacts/souls/<实例 id 哈希>/snapshot.json`。 */
  snapshotPath(instanceId: string): string {
    const folder = createHash('sha256').update(instanceId).digest('hex').slice(0, 16);
    return path.join(this.projectRoot, 'artifacts', 'souls', folder, 'snapshot.json');
  }

  private instanceInfo(id: string, value?: RuntimeInstance): RuntimeInstance {
    const match = /^mumu-(\d+)$/.exec(id);
    const info: RuntimeInstance = match ? { id, backend: 'mumu', mumuIndex: Number(match[1]) } : { id };
    if (value?.id !== id) return info;
    for (const field of ['displayName', 'backend', 'adbSerial'] as const) {
      if (typeof value[field] === 'string' && value[field]!.trim()) info[field] = value[field];
    }
    if (Number.isSafeInteger(value.mumuIndex) && value.mumuIndex! >= 0) info.mumuIndex = value.mumuIndex;
    return info;
  }

  /** Remember the device's human-readable name separately; never rewrite its backpack. */
  private async saveInstanceInfo(info: RuntimeInstance): Promise<void> {
    const file = path.join(path.dirname(this.snapshotPath(info.id)), 'instance.json');
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(this.instanceInfo(info.id, info)) + '\n', 'utf8');
      await fs.rename(temporary, file);
    } catch { /* Metadata persistence must not prevent viewing/acquiring cached souls. */ }
    finally { await fs.unlink(temporary).catch(() => undefined); }
  }

  /** Merge live devices with saved backpacks, leaving workflow device discovery unchanged. */
  async listInstances(live: RuntimeInstance[]): Promise<SoulInstance[]> {
    for (const item of live) this.knownInstances.set(item.id, this.instanceInfo(item.id, item));
    const merged = new Map(live.map(item => [item.id, { ...item, online: true } as SoulInstance]));
    const configured = path.join(this.projectRoot, 'config', 'config.json');
    let config: RuntimeInstance[] = [];
    try { config = parseRuntimeInstances(JSON.parse(await fs.readFile(existsSync(configured) ? configured : path.join(this.projectRoot, 'config', 'config.example.json'), 'utf8'))); } catch { /* Cache names do not depend on configuration availability. */ }
    const directory = path.join(this.projectRoot, 'artifacts', 'souls');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    const cached = await Promise.all(entries.filter(entry => entry.isDirectory() && /^[a-f0-9]{16}$/.test(entry.name)).map(async entry => {
      const file = path.join(directory, entry.name, 'snapshot.json');
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'));
        const payload = raw?.result ?? raw;
        const id = payload?.instanceId;
        if (typeof id !== 'string' || !id || id.length > 160 || this.snapshotPath(id) !== file) return null;
        const snapshot = readSoulSnapshot(raw, id);
        if (!snapshot || !Number.isFinite(Date.parse(snapshot.fetchedAt)) || !Number.isSafeInteger(snapshot.total) || snapshot.total < 0
          || !Number.isSafeInteger(snapshot.failed) || snapshot.failed < 0 || snapshot.souls.length + snapshot.failed !== snapshot.total) return null;
        let stored: RuntimeInstance | undefined;
        try { stored = JSON.parse(await fs.readFile(path.join(directory, entry.name, 'instance.json'), 'utf8')); } catch { /* Legacy snapshots predate instance metadata. */ }
        const info = this.knownInstances.get(id) ?? this.instanceInfo(id, { ...this.instanceInfo(id, stored), ...config.find(item => item.id === id) });
        if (merged.has(id)) await this.saveInstanceInfo(info);
        return { ...info, online: merged.has(id), cachedAt: snapshot.fetchedAt, cachedCount: snapshot.souls.length } as SoulInstance;
      } catch { return null; }
    }));
    const valid = cached.filter((item): item is SoulInstance => item !== null).sort((a, b) => Date.parse(b.cachedAt!) - Date.parse(a.cachedAt!) || a.id.localeCompare(b.id));
    for (const item of valid) merged.set(item.id, item);
    return [...merged.values()];
  }

  /** Icons are shared project assets; older instance snapshots may predate them. */
  private async resolveIcons(snapshot: SoulSnapshot): Promise<SoulSnapshot> {
    const icons = await soulIconNames(this.projectRoot);
    return { ...snapshot, souls: snapshot.souls.map(soul => {
      const available = Number.isSafeInteger(soul.suitId) && (soul.suitId ?? 0) > 0 && icons.has(`${soul.suitId}.png`);
      return { ...soul, iconUrl: available ? `onmyoji-resource://project/assets/soul-icons/${soul.suitId}.png` : null };
    }) };
  }

  /** 读取该实例上次保存的快照；没有或不可用时返回 null。 */
  async load(instanceId: string): Promise<SoulSnapshot | null> {
    if (!instanceId || instanceId.length > 160) throw new Error('请选择有效的模拟器实例');
    const file = this.snapshotPath(instanceId);
    try {
      let snapshot = readSoulSnapshot(JSON.parse(await fs.readFile(file, 'utf8')), instanceId);
      if (snapshot?.souls.some(soul => soul.position == null || !Number.isInteger(soul.position) || soul.position < 1 || soul.position > 6)) {
        try {
          const raw = JSON.parse(await fs.readFile(path.join(path.dirname(file), 'raw.json'), 'utf8'));
          const original = readSoulSnapshot(raw, instanceId);
          if (original?.fetchedAt === snapshot.fetchedAt && original.total === snapshot.total) {
            snapshot = readSoulSnapshot({ result: snapshot, tables: raw.tables }, instanceId) ?? snapshot;
          }
        } catch { /* Missing or damaged raw metadata must not hide the saved backpack. */ }
      }
      return snapshot ? await this.resolveIcons(snapshot) : null;
    } catch { return null; }
  }

  fetch(instanceId: string): Promise<SoulSnapshot | null> {
    if (this.active) throw new Error('正在获取御魂，请等待完成或取消后重试');
    if (!instanceId || instanceId.length > 160) throw new Error('请选择有效的模拟器实例');
    const configured = path.join(this.projectRoot, 'config', 'config.json');
    const config = existsSync(configured) ? configured : path.join(this.projectRoot, 'config', 'config.example.json');
    const output = this.snapshotPath(instanceId);
    const child = this.launch(resolvePythonRuntime(this.projectRoot), [
      '-u', '-m', 'src.oooonmyoji.tools.soul_export', '--config', config,
      '--instance', instanceId, '--output', output,
    ], { cwd: this.projectRoot, env: pythonUtf8Environment(process.env, this.projectRoot), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const finished = new Promise<SoulSnapshot | null>((resolve, reject) => {
      let buffer = '';
      let result: SoulSnapshot | undefined;
      let cancelled = false;
      let failure = '';
      let terminal = false;
      child.stdin?.on('error', () => { /* A completed child may close stdin during cancellation. */ });
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 32_000_000) {
          failure = '御魂数据过大，请检查实例后重试';
          buffer = '';
          child.stdin?.write('cancel\n');
          return;
        }
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (event.type === 'progress' && event.instanceId === instanceId && typeof event.message === 'string') {
              this.emit('progress', event as SoulFetchProgress);
            } else if (event.type === 'result') {
              const snapshot = readSoulSnapshot(event.result, instanceId);
              if (!snapshot || snapshot.souls.length + snapshot.failed !== snapshot.total) {
                failure = '返回的御魂数据与所选实例不一致';
              } else { result = snapshot; terminal = true; }
            } else if (event.type === 'error') { failure = String(event.message); terminal = true; }
            else if (event.type === 'cancelled') { cancelled = true; terminal = true; }
          } catch { failure = '无法读取御魂返回数据'; child.stdin?.write('cancel\n'); }
        }
      });
      child.stderr?.resume();
      child.once('error', () => {
        if (this.active?.child === child) this.active = undefined;
        reject(new Error('无法启动御魂读取，请检查运行环境'));
      });
      child.once('close', (code) => {
        if (this.active?.child === child) this.active = undefined;
        if (failure) reject(new Error(failure));
        else if (code !== 0 || !terminal) reject(new Error('御魂读取意外中断，请检查实例连接后重试'));
        else if (cancelled) resolve(null);
        else if (result) resolve(result);
        else reject(new Error('未返回御魂数据'));
      });
    });
    this.active = { instanceId, child, finished };
    return finished.then(async snapshot => {
      if (!snapshot) return null;
      await this.saveInstanceInfo(this.knownInstances.get(instanceId) ?? this.instanceInfo(instanceId));
      return this.resolveIcons(snapshot);
    });
  }

  async cancel(instanceId: string): Promise<void> {
    const active = this.active;
    if (!active || active.instanceId !== instanceId) return;
    active.child.stdin?.write('cancel\n');
    await active.finished.catch(() => undefined);
  }

  async dispose(): Promise<void> {
    if (this.active) await this.cancel(this.active.instanceId);
  }
}
