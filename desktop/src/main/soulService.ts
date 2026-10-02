import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { pythonUtf8Environment, resolvePythonRuntime } from './core/runtimeInstances';
import type { SoulSnapshot, SoulFetchProgress } from '../shared/souls';

/** Keep the process alive through cancellation so its finally block restores ADB. */
export class SoulService extends EventEmitter<{ progress: [SoulFetchProgress] }> {
  private active: { instanceId: string; child: ChildProcess; finished: Promise<SoulSnapshot | null> } | undefined;

  constructor(private readonly projectRoot: string, private readonly launch: typeof spawn = spawn) { super(); }

  get running(): boolean { return Boolean(this.active); }

  fetch(instanceId: string): Promise<SoulSnapshot | null> {
    if (this.active) throw new Error('正在获取御魂，请等待完成或取消后重试');
    if (!instanceId || instanceId.length > 160) throw new Error('请选择有效的模拟器实例');
    const configured = path.join(this.projectRoot, 'config', 'config.json');
    const config = existsSync(configured) ? configured : path.join(this.projectRoot, 'config', 'config.example.json');
    const folder = createHash('sha256').update(instanceId).digest('hex').slice(0, 16);
    const output = path.join(this.projectRoot, 'artifacts', 'souls', folder, 'snapshot.json');
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
              if (event.result?.instanceId !== instanceId || !Array.isArray(event.result?.souls)
                || event.result?.souls.length + event.result?.failed !== event.result?.total) {
                failure = '返回的御魂数据与所选实例不一致';
              } else { result = event.result as SoulSnapshot; terminal = true; }
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
    return finished;
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
