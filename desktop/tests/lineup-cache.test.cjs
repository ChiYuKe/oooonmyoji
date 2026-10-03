const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeLineupSearch, lineupCachedResults, lineupCacheUsable, LINEUP_CACHE_TTL_MS } = require('../dist-electron/shared/lineup-cache.js');
const allSources = ['bilibili', 'netease-community', 'netease-official', 'weibo', 'nga'];
const now = Date.now();
const guide = (source, bvid) => ({ source, bvid, title: '攻略', url: 'https://example.com' });

test('failed empty responses and legacy poisoned cache are never reusable', () => {
  const response = { results: [], unavailableSources: allSources };
  assert.equal(mergeLineupSearch(response, undefined, now).cacheEntry, undefined);
  assert.equal(lineupCacheUsable({ ...response, cachedAt: now }, now), false);
});

test('complete refresh failure preserves guides and their original age', () => {
  const previous = { cachedAt: now - 5000, results: [guide('bilibili', 'BVold')], unavailableSources: [] };
  const merged = mergeLineupSearch({ results: [], unavailableSources: allSources }, previous, now);
  assert.deepEqual(merged.results, previous.results);
  assert.equal(merged.cacheEntry.cachedAt, previous.cachedAt);
  assert.equal(merged.cacheEntry.sourceUpdatedAt.bilibili, previous.cachedAt);
  assert.equal(lineupCacheUsable(merged.cacheEntry, now), false);
});

test('partial success replaces successful sources and keeps only failed sources', () => {
  const previous = { cachedAt: now - 5000, results: [guide('bilibili', 'BVold'), guide('nga', 'old'), guide('weibo', 'old-weibo')], unavailableSources: [] };
  const merged = mergeLineupSearch({ results: [guide('nga', 'new')], unavailableSources: ['bilibili'] }, previous, now);
  assert.deepEqual(merged.results.map(item => item.bvid), ['new', 'BVold']);
  assert.deepEqual(merged.retainedSources, ['bilibili']);
  assert.equal(merged.cacheEntry.sourceUpdatedAt.bilibili, previous.cachedAt);
  assert.equal(merged.cacheEntry.sourceUpdatedAt.nga, now);
  assert.equal(lineupCacheUsable(merged.cacheEntry, now + 119_999), true);
  assert.equal(lineupCacheUsable(merged.cacheEntry, now + 120_000), false);
});

test('repeated partial successes never extend older failed source guides beyond a day', () => {
  const previous = { cachedAt: now - 1000, sourceUpdatedAt: { bilibili: now - LINEUP_CACHE_TTL_MS }, results: [guide('bilibili', 'BVold')], unavailableSources: ['bilibili'] };
  const merged = mergeLineupSearch({ results: [guide('nga', 'new')], unavailableSources: ['bilibili'] }, previous, now);
  assert.deepEqual(merged.results.map(item => item.bvid), ['new']);
  assert.deepEqual(merged.retainedSources, []);
});

test('a successful empty search replaces stale guides and can be cached', () => {
  const merged = mergeLineupSearch({ results: [], unavailableSources: [] }, { cachedAt: now - 1, results: [guide('nga', 'old')], unavailableSources: [] }, now);
  assert.deepEqual(merged.results, []);
  assert.equal(lineupCacheUsable(merged.cacheEntry, now + LINEUP_CACHE_TTL_MS - 1), true);
  assert.equal(lineupCacheUsable(merged.cacheEntry, now + LINEUP_CACHE_TTL_MS), false);
});

test('fresh partial cache stops displaying a failed source as soon as its original data expires', () => {
  const entry = { cachedAt: now, sourceUpdatedAt: { bilibili: now - LINEUP_CACHE_TTL_MS + 1 }, results: [guide('bilibili', 'BVold')], unavailableSources: ['bilibili'] };
  assert.equal(lineupCacheUsable(entry, now), true);
  assert.equal(lineupCacheUsable(entry, now + 1), false);
  assert.deepEqual(lineupCachedResults(entry, now + 1), []);
});
