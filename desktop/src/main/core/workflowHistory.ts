import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { WorkflowHistoryEntry } from '../../shared/contracts';

interface Snapshot extends WorkflowHistoryEntry { text: string }
const SNAPSHOT_ID = /^\d{13,}-[a-f0-9-]{36}$/;

/** Recent edits plus hourly and daily checkpoints keep autosave from crowding out older versions. */
export function retainedHistoryIds(entries: WorkflowHistoryEntry[], now = Date.now()): Set<string> {
  const ordered = [...entries].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  const keep = new Set(ordered.slice(0, 20).map((entry) => entry.id));
  const buckets = new Set<string>();
  let daily = 0;
  for (const entry of ordered.slice(20)) {
    const hourly = now - entry.at < 48 * 60 * 60 * 1000;
    const bucket = `${hourly ? 'hour' : 'day'}:${Math.floor(entry.at / (hourly ? 3_600_000 : 86_400_000))}`;
    if (buckets.has(bucket) || (!hourly && daily >= 30)) continue;
    buckets.add(bucket);
    if (!hourly) daily++;
    keep.add(entry.id);
  }
  return keep;
}

export class WorkflowHistory {
  private readonly entriesCache = new Map<string, WorkflowHistoryEntry[]>();
  constructor(private readonly projectRoot: string) {}

  private directory(file: string): string {
    const key = createHash('sha256').update(path.relative(this.projectRoot, file).toLowerCase()).digest('hex');
    return path.join(this.projectRoot, 'artifacts', 'workflow-history', key);
  }

  async read(file: string, id: string): Promise<Snapshot> {
    if (typeof id !== 'string' || !SNAPSHOT_ID.test(id)) throw new Error('历史版本标识无效');
    const value = JSON.parse(await fs.readFile(path.join(this.directory(file), `${id}.json`), 'utf8')) as Snapshot;
    if (value.id !== id || typeof value.text !== 'string' || !Number.isFinite(value.at)) throw new Error('历史版本损坏');
    return { id, text: value.text, at: value.at, bytes: Buffer.byteLength(value.text, 'utf8') };
  }

  async list(file: string): Promise<WorkflowHistoryEntry[]> {
    let names: string[];
    try { names = await fs.readdir(this.directory(file)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const entries: WorkflowHistoryEntry[] = [];
    for (const name of names) {
      if (!name.endsWith('.json') || !SNAPSHOT_ID.test(name.slice(0, -5))) continue;
      try {
        const { text: _text, ...entry } = await this.read(file, name.slice(0, -5));
        entries.push(entry);
      } catch { /* A damaged individual snapshot must not hide intact versions. */ }
    }
    return entries.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  }

  async record(file: string, text: string): Promise<void> {
    const directory = this.directory(file);
    const entries = this.entriesCache.get(directory) || await this.list(file);
    if (entries[0] && (await this.read(file, entries[0].id)).text === text) return;
    const at = Math.max(Date.now(), (entries[0]?.at || 0) + 1);
    const id = `${at}-${randomUUID()}`;
    const snapshot: Snapshot = { id, at, bytes: Buffer.byteLength(text, 'utf8'), text };
    await fs.mkdir(directory, { recursive: true });
    const temp = path.join(directory, `${id}.tmp`);
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot), { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temp, path.join(directory, `${id}.json`));
    } finally { await fs.rm(temp, { force: true }); }
    const all = [snapshot, ...entries];
    const keep = retainedHistoryIds(all, at);
    for (const entry of all) if (!keep.has(entry.id)) await fs.rm(path.join(directory, `${entry.id}.json`), { force: true });
    this.entriesCache.set(directory, all.filter((entry) => keep.has(entry.id)).map(({ id, at, bytes }) => ({ id, at, bytes })));
  }
}
