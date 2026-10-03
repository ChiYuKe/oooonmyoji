import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { pythonUtf8Environment, resolvePythonRuntime } from './core/runtimeInstances';
import { readHeroOwnership, type HeroOwnershipProgress, type HeroOwnershipSnapshot } from '../shared/hero-ownership';
import type { SoulInstance } from '../shared/contracts';

export class HeroOwnershipService extends EventEmitter<{ progress: [HeroOwnershipProgress] }> {
  private active?: { instanceId: string; child: ChildProcess; finished: Promise<HeroOwnershipSnapshot | null> };
  constructor(private readonly projectRoot: string, private readonly launch: typeof spawn = spawn) { super(); }
  get running(): boolean { return Boolean(this.active); }
  snapshotPath(instanceId: string): string {
    return path.join(this.projectRoot, 'artifacts', 'souls', createHash('sha256').update(instanceId).digest('hex').slice(0, 16), 'heroes.json');
  }
  async load(instanceId: string): Promise<HeroOwnershipSnapshot | null> {
    if (!instanceId || instanceId.length > 160) throw new Error('请选择有效的模拟器实例');
    try { return readHeroOwnership(JSON.parse(await fs.readFile(this.snapshotPath(instanceId), 'utf8')), instanceId); }
    catch { return null; }
  }
  async listInstances(instances: SoulInstance[]): Promise<SoulInstance[]> {
    const merged = new Map(instances.map(item => [item.id, item]));
    const directory = path.join(this.projectRoot, 'artifacts', 'souls');
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue;
      try {
        const file = path.join(directory, entry.name, 'heroes.json');
        const data = JSON.parse(await fs.readFile(file, 'utf8'));
        if (typeof data.instanceId !== 'string' || !data.instanceId || data.instanceId.length > 160
          || this.snapshotPath(data.instanceId) !== file || !readHeroOwnership(data, data.instanceId) || merged.has(data.instanceId)) continue;
        let name = data.instanceId.replace(/^mumu-(\d+)$/, 'MuMu $1');
        try {
          const info = JSON.parse(await fs.readFile(path.join(directory, entry.name, 'instance.json'), 'utf8'));
          if (info.id === data.instanceId && typeof info.displayName === 'string') name = info.displayName;
        } catch { /* A legacy cache can use the instance ID. */ }
        merged.set(data.instanceId, { id: data.instanceId, displayName: name, online: false });
      } catch { /* An invalid cache must never imply an empty inventory. */ }
    }
    return [...merged.values()];
  }
  fetch(instanceId: string): Promise<HeroOwnershipSnapshot | null> {
    if (this.active) throw new Error('正在检测仓库，请等待完成或取消后重试');
    if (!instanceId || instanceId.length > 160) throw new Error('请选择有效的模拟器实例');
    const configured = path.join(this.projectRoot, 'config', 'config.json');
    const config = existsSync(configured) ? configured : path.join(this.projectRoot, 'config', 'config.example.json');
    const child = this.launch(resolvePythonRuntime(this.projectRoot), [
      '-u', '-m', 'src.oooonmyoji.tools.hero_export', '--config', config, '--instance', instanceId, '--output', this.snapshotPath(instanceId),
    ], { cwd: this.projectRoot, env: pythonUtf8Environment(process.env, this.projectRoot), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const finished = new Promise<HeroOwnershipSnapshot | null>((resolve, reject) => {
      let buffer = '', failure = '', terminal = false, cancelled = false;
      let result: HeroOwnershipSnapshot | null = null;
      child.stdin?.on('error', () => undefined);
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 32_000_000) { failure = '仓库返回数据过大'; buffer = ''; child.stdin?.write('cancel\n'); return; }
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (event.type === 'progress' && event.instanceId === instanceId && typeof event.message === 'string') this.emit('progress', event);
            else if (event.type === 'result') {
              result = readHeroOwnership(event.result, instanceId); terminal = true;
              if (!result) failure = '返回的式神数据不完整或与所选实例不一致';
            } else if (event.type === 'error') { failure = String(event.message); terminal = true; }
            else if (event.type === 'cancelled') { cancelled = true; terminal = true; }
          } catch { failure = '无法读取仓库返回数据'; child.stdin?.write('cancel\n'); }
        }
      });
      child.stderr?.resume();
      child.once('error', () => { if (this.active?.child === child) this.active = undefined; reject(new Error('无法启动仓库检测，请检查运行环境')); });
      child.once('close', code => {
        if (this.active?.child === child) this.active = undefined;
        if (failure) reject(new Error(failure));
        else if (code !== 0 || !terminal) reject(new Error('仓库检测中断，请检查实例连接后重试'));
        else if (cancelled) resolve(null);
        else if (result) resolve(result);
        else reject(new Error('未返回式神数据'));
      });
    });
    this.active = { instanceId, child, finished }; return finished;
  }
  async cancel(instanceId: string): Promise<void> {
    if (this.active?.instanceId !== instanceId) return;
    const task = this.active; task.child.stdin?.write('cancel\n'); await task.finished.catch(() => undefined);
  }
  async dispose(): Promise<void> { if (this.active) await this.cancel(this.active.instanceId); }
}
