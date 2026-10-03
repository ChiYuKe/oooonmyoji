import type { LineupExternalSource, LineupSearchResponse, LineupSearchResult } from './lineups';

export const LINEUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PARTIAL_CACHE_TTL_MS = 2 * 60 * 1000;
const SOURCES: LineupExternalSource[] = ['bilibili', 'netease-community', 'netease-official', 'weibo', 'nga'];

export interface LineupSearchCacheEntry extends LineupSearchResponse {
  cachedAt: number;
  sourceUpdatedAt?: Partial<Record<LineupExternalSource, number>>;
}

export function lineupCachedResults(entry: LineupSearchCacheEntry, now: number): LineupSearchResult[] {
  return entry.results.filter(item => {
    const timestamp = entry.sourceUpdatedAt?.[item.source] ?? entry.cachedAt;
    return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < LINEUP_CACHE_TTL_MS;
  });
}

export function lineupCacheUsable(entry: LineupSearchCacheEntry, now: number): boolean {
  if (!Number.isFinite(entry.cachedAt) || entry.cachedAt > now) return false;
  if (entry.unavailableSources.length && !lineupCachedResults(entry, now).length) return false;
  if (entry.unavailableSources.length === SOURCES.length) return false;
  const ttl = entry.unavailableSources.length ? PARTIAL_CACHE_TTL_MS : LINEUP_CACHE_TTL_MS;
  return now - entry.cachedAt < ttl;
}

/** Preserve only failed sources, and never extend the age of their older guides. */
export function mergeLineupSearch(response: LineupSearchResponse, previous: LineupSearchCacheEntry | undefined, now: number): {
  results: LineupSearchResult[];
  retainedSources: LineupExternalSource[];
  cacheEntry?: LineupSearchCacheEntry;
} {
  const failed = new Set(response.unavailableSources);
  const sourceUpdatedAt: Partial<Record<LineupExternalSource, number>> = {};
  for (const source of SOURCES) {
    const timestamp = previous?.sourceUpdatedAt?.[source] ?? previous?.cachedAt;
    if (!failed.has(source)) sourceUpdatedAt[source] = now;
    else if (timestamp !== undefined && Number.isFinite(timestamp) && timestamp <= now && now - timestamp < LINEUP_CACHE_TTL_MS) sourceUpdatedAt[source] = timestamp;
  }
  const retained = (previous?.results ?? []).filter(item => failed.has(item.source) && sourceUpdatedAt[item.source] !== undefined);
  const results = [...response.results];
  const ids = new Set(results.map(item => `${item.source}:${item.bvid}`));
  for (const item of retained) {
    const id = `${item.source}:${item.bvid}`;
    if (!ids.has(id)) { results.push(item); ids.add(id); }
  }
  const retainedSources = [...new Set(retained.map(item => item.source))];
  if (failed.size && !results.length) return { results, retainedSources };
  return {
    results, retainedSources,
    cacheEntry: {
      ...response, results, sourceUpdatedAt,
      cachedAt: failed.size === SOURCES.length ? previous?.cachedAt ?? now : now,
    },
  };
}
