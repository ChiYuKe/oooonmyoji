import { COMMUNITY_CACHE_TTL_MS, normalizeCommunityEntry } from '../shared/soul-community';
import type { CommunityPage, CommunityQuery } from '../shared/soul-community';

interface CachedPage { endpoint: string; key: string; savedAt: number; page: CommunityPage; stale?: boolean }
interface CacheStore { read(): string | null; write(value: string): void }
const MAX_PAGES = 40, MAX_BYTES = 4_000_000, MAX_AGE = 7 * 24 * 3600_000;
export function validateCommunityPage(value: unknown): CommunityPage {
  const page = value as CommunityPage;
  if (!Array.isArray(page?.entries) || page.entries.length > 50 || !(page.cursor === null || typeof page.cursor === 'string' && page.cursor.length <= 150)) throw Error('社区列表格式无效。');
  return { entries: page.entries.map(normalizeCommunityEntry), cursor: page.cursor, ...(page.filterVersion === 1 ? { filterVersion: 1 as const } : {}) };
}
/** Main-process cache shared by all windows. It stores public pages only. */
export class SoulCommunityCache {
  private pages = new Map<string, CachedPage>();
  private pending = new Map<string, Promise<CommunityPage>>();
  private revisions = new Map<string, number>();
  constructor(private store: CacheStore, private now = Date.now) {
    try {
      const raw = store.read();
      if (!raw || Buffer.byteLength(raw) > MAX_BYTES) return;
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || !Array.isArray(saved.pages)) return;
      for (const row of saved.pages.slice(-MAX_PAGES)) {
        try {
          if (typeof row.key !== 'string' || row.key.length > 2000 || typeof row.endpoint !== 'string' || !this.usable(row.savedAt, MAX_AGE)) continue;
          this.pages.set(row.key, { ...row, page: validateCommunityPage(row.page) });
        } catch { /* Ignore an invalid cached page, without losing other queries. */ }
      }
    } catch { /* Missing or damaged cache is fetched again. */ }
  }
  private usable(savedAt: number, age: number): boolean {
    return Number.isFinite(savedAt) && savedAt <= this.now() && this.now() - savedAt < age;
  }
  private save(): void {
    for (const [key, row] of this.pages) if (!this.usable(row.savedAt, MAX_AGE)) this.pages.delete(key);
    let body = '';
    while (true) {
      body = JSON.stringify({ version: 1, pages: [...this.pages.values()] });
      if (this.pages.size <= MAX_PAGES && Buffer.byteLength(body) <= MAX_BYTES) break;
      this.pages.delete(this.pages.keys().next().value!);
    }
    try { this.store.write(body); } catch { /* Disk errors must not prevent community access. */ }
  }
  invalidate(endpoint: string): void {
    this.revisions.set(endpoint, (this.revisions.get(endpoint) ?? 0) + 1);
    for (const [key, row] of this.pages) if (row.endpoint === endpoint) this.pages.delete(key);
    for (const key of this.pending.keys()) if (key.startsWith(`${endpoint}\n`)) this.pending.delete(key);
    this.save();
  }
  async list(endpoint: string, query: CommunityQuery, fetchPage: () => Promise<CommunityPage>, refresh = false): Promise<CommunityPage> {
    const key = `${endpoint}\n${JSON.stringify(Object.fromEntries(Object.entries({ ...query, order: query.order ?? 'newest' }).sort(([a], [b]) => a.localeCompare(b))))}`;
    const old = this.pages.get(key);
    if (refresh) this.invalidate(endpoint);
    const cached = this.pages.get(key);
    if (cached && this.usable(cached.savedAt, COMMUNITY_CACHE_TTL_MS)) {
      this.pages.delete(key); this.pages.set(key, cached);
      return structuredClone({ ...cached.page, cache: { savedAt: cached.savedAt, stale: cached.stale === true } });
    }
    const pending = this.pending.get(key);
    if (pending) return structuredClone(await pending);
    const revision = this.revisions.get(endpoint) ?? 0;
    const operation = (async (): Promise<CommunityPage> => {
      try {
        const page = validateCommunityPage(await fetchPage());
        if ((this.revisions.get(endpoint) ?? 0) === revision) {
          this.pages.delete(key); this.pages.set(key, { key, endpoint, savedAt: this.now(), page }); this.save();
        }
        return page;
      } catch (error) {
        if (old && this.usable(old.savedAt, MAX_AGE) && (this.revisions.get(endpoint) ?? 0) === revision) {
          // Keep the last known result after a failed explicit refresh, too.
          this.pages.set(key, { ...old, stale: true }); this.save();
          return { ...old.page, cache: { savedAt: old.savedAt, stale: true } };
        }
        throw error;
      }
    })();
    this.pending.set(key, operation);
    try { return structuredClone(await operation); }
    finally { if (this.pending.get(key) === operation) this.pending.delete(key); }
  }
}
