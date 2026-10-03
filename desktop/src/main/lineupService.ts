import { net } from 'electron';
import type { LineupExternalSource, LineupSearchRequest, LineupSearchResponse, LineupSearchResult } from '../shared/lineups';
import { plainText, stableSearchId } from './lineupParsing';
import { searchNgaLineups } from './ngaLineupService';

const RESULT_LIMIT = 18;
const CACHE_TTL_MS = 45_000;
const cache = new Map<string, { savedAt: number; results: LineupSearchResult[] }>();
const inFlight = new Map<string, Promise<LineupSearchResponse>>();
let bilibiliBlockedUntil = 0;
let bilibiliBlockedMessage = '';

function networkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed.out|abort/i.test(message)) return '请求超时，请稍后重试';
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(message)) return '域名解析失败，请检查网络或代理设置';
  if (/ERR_PROXY|ERR_TUNNEL/i.test(message)) return '代理连接失败，请检查代理设置';
  if (/ERR_CERT|certificate/i.test(message)) return '连接证书验证失败，请检查系统时间或网络设置';
  return '网络连接失败，请检查网络后重试';
}

function limitBilibili(message: string): Error {
  bilibiliBlockedUntil = Date.now() + 60_000;
  bilibiliBlockedMessage = message;
  return new Error(message);
}

function safeCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return 0;
}

function describePlatformError(code: number): string {
  if (code === -352 || code === -412) return '哔哩哔哩暂时限制了搜索请求，请稍后重试，或使用上方来源入口。';
  if (code === -400) return '哔哩哔哩没有接受这次搜索条件，请缩短关键词后重试。';
  return '暂时无法获取哔哩哔哩搜索结果，请稍后重试或使用上方来源入口。';
}

export async function searchBilibiliLineups(request: unknown): Promise<LineupSearchResult[]> {
  if (!request || typeof request !== 'object') throw new Error('搜索条件无效');
  const value = request as Partial<LineupSearchRequest>;
  const keyword = typeof value.keyword === 'string' ? value.keyword.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
  const order = value.order === 'click' ? 'click' : value.order === 'pubdate' ? 'pubdate' : null;
  if (!keyword || !order) throw new Error('请输入玩法关键词并选择排序方式');

  const cacheKey = `${order}:${keyword.toLocaleLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (!value.forceRefresh && cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.results.map(result => ({ ...result }));
  if (Date.now() < bilibiliBlockedUntil) throw new Error(`${bilibiliBlockedMessage} 请等一分钟后重试，避免连续请求。`);

  const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
  url.searchParams.set('search_type', 'video');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('order', order);
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', String(RESULT_LIMIT));

  let response: Response;
  try {
    response = await net.fetch(url.href, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://search.bilibili.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(networkError(error));
  }
  if (!response.ok) {
    if (response.status === 403 || response.status === 412 || response.status === 429) {
      throw limitBilibili(`搜索请求被站点限制（HTTP ${response.status}），可点“B站”在网页中搜索。`);
    }
    throw new Error(`哔哩哔哩搜索服务暂时不可用（HTTP ${response.status}），请稍后重试。`);
  }

  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error('哔哩哔哩返回了无法识别的数据。'); }
  if (!payload || typeof payload !== 'object') throw new Error('哔哩哔哩返回了无法识别的数据。');
  const body = payload as { code?: unknown; message?: unknown; data?: { result?: unknown } };
  if (typeof body.code === 'number' && body.code !== 0) {
    const message = describePlatformError(body.code);
    throw body.code === -352 || body.code === -412 ? limitBilibili(message) : new Error(message);
  }
  if (!Array.isArray(body.data?.result)) throw new Error('哔哩哔哩暂时没有返回搜索结果。');

  const results = body.data.result.flatMap((item: unknown): LineupSearchResult[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const bvid = typeof row.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(row.bvid) ? row.bvid : '';
    const title = plainText(row.title, 180);
    if (!bvid || !title) return [];
    return [{
      bvid,
      source: 'bilibili',
      url: `https://www.bilibili.com/video/${bvid}/`,
      title,
      author: plainText(row.author, 80) || '哔哩哔哩用户',
      description: plainText(row.description, 320),
      publishedAt: safeCount(row.pubdate),
      duration: plainText(row.duration, 20),
      views: safeCount(row.play),
      favorites: safeCount(row.favorites),
    }];
  }).slice(0, RESULT_LIMIT);
  cache.set(cacheKey, { savedAt: Date.now(), results });
  if (cache.size > 80) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt).slice(0, cache.size - 80);
    for (const [key] of oldest) cache.delete(key);
  }
  return results.map(result => ({ ...result }));
}

const INDEXED_SOURCES: Array<{ id: Exclude<LineupSearchResult['source'], 'bilibili' | 'nga'>; domains: string[]; allowedHosts: string[] }> = [
  { id: 'netease-community', domains: ['ds.163.com'], allowedHosts: ['ds.163.com'] },
  { id: 'netease-official', domains: ['yys.163.com', 'yys.16163.com'], allowedHosts: ['yys.163.com', 'yys.16163.com'] },
  { id: 'weibo', domains: ['weibo.com'], allowedHosts: ['weibo.com', 'www.weibo.com'] },
];

function decodeHtml(value: string): string {
  return plainText(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'), value.length);
}

function isAllowedSourceUrl(rawUrl: string, source: typeof INDEXED_SOURCES[number]): URL | null {
  try {
    const url = new URL(decodeHtml(rawUrl));
    if (!['http:', 'https:'].includes(url.protocol) || !source.allowedHosts.includes(url.hostname.toLowerCase()) || url.username || url.password) return null;
    url.protocol = 'https:';
    return url;
  } catch { return null; }
}

function unwrapSearchUrl(rawUrl: string): URL | null {
  try {
    let url = new URL(decodeHtml(rawUrl));
    if (url.hostname === 'www.bing.com' || url.hostname === 'bing.com') {
      const encoded = url.searchParams.get('u');
      if (encoded?.startsWith('a1')) {
        const decoded = Buffer.from(encoded.slice(2), 'base64').toString('utf8');
        url = new URL(decoded);
      }
    }
    return url;
  } catch { return null; }
}

function parseIndexedResults(html: string, source: typeof INDEXED_SOURCES[number]): LineupSearchResult[] {
  const blocks = html.match(/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][\s\S]*?<\/li>/gi) ?? [];
  const results: LineupSearchResult[] = [];
  for (const block of blocks) {
    const linkMatch = block.match(/<h2\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const url = isAllowedSourceUrl(unwrapSearchUrl(linkMatch[1])?.href ?? '', source);
    if (!url) continue;
    const title = plainText(decodeHtml(linkMatch[2]), 180);
    if (!title) continue;
    const snippetMatch = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    const description = snippetMatch ? plainText(decodeHtml(snippetMatch[1]), 320) : '';
    results.push({
      bvid: stableSearchId(source.id, url.href), source: source.id, url: url.href,
      title, author: source.id === 'netease-community' ? '网易大神' : source.id === 'netease-official' ? '网易官网' : source.id === 'weibo' ? '微博' : 'NGA',
      description, publishedAt: 0, duration: '', views: 0, favorites: 0,
    });
  }
  return results.slice(0, 8);
}

function parseBaiduResults(html: string, source: typeof INDEXED_SOURCES[number]): LineupSearchResult[] {
  const starts: number[] = [];
  const resultStart = /<div\b[^>]*class=["'][^"']*\bresult\b[^"']*["'][^>]*>/gi;
  for (let match = resultStart.exec(html); match; match = resultStart.exec(html)) starts.push(match.index);
  const results: LineupSearchResult[] = [];
  for (let index = 0; index < starts.length; index++) {
    const block = html.slice(starts[index], starts[index + 1] ?? html.length);
    const heading = block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const anchor = heading?.[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const landUrl = block.match(/\bdata-landurl=["']([^"']+)["']/i)?.[1];
    const url = isAllowedSourceUrl(landUrl ?? anchor[1], source);
    if (!url) continue;
    const title = plainText(decodeHtml(anchor[2]), 180);
    if (!title) continue;
    const snippet = block.match(/<(?:div|p)\b[^>]*class=["'][^"']*(?:c-abstract|c-span-last|c-font-normal)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p)>/i)?.[1] ?? '';
    results.push({
      bvid: stableSearchId(source.id, url.href), source: source.id, url: url.href,
      title, author: source.id === 'netease-community' ? '网易大神' : source.id === 'netease-official' ? '网易官网' : source.id === 'weibo' ? '微博' : 'NGA',
      description: plainText(decodeHtml(snippet), 320), publishedAt: 0, duration: '', views: 0, favorites: 0,
    });
  }
  return results.slice(0, 8);
}

async function searchIndexedSource(source: typeof INDEXED_SOURCES[number], keyword: string): Promise<LineupSearchResult[]> {
  // Group alternate sites so the keyword applies to every domain.
  const sites = source.domains.map(domain => `site:${domain}`).join(' OR ');
  const queryText = `${source.domains.length > 1 ? `(${sites})` : sites} ${keyword}`;
  const headers = {
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  };
  const engines = [
    { name: 'Bing', url: `https://www.bing.com/search?${new URLSearchParams({ q: queryText, count: '10', setlang: 'zh-hans', mkt: 'zh-CN' })}`, parse: parseIndexedResults },
    { name: '百度', url: `https://www.baidu.com/s?${new URLSearchParams({ wd: queryText, rn: '10', tn: 'baidu' })}`, parse: parseBaiduResults },
  ];
  const errors: string[] = [];
  let validEmpty = false;
  for (const engine of engines) {
    let response: Response;
    try { response = await net.fetch(engine.url, { headers, signal: AbortSignal.timeout(10_000) }); }
    catch (error) { errors.push(`${engine.name}：${networkError(error)}`); continue; }
    if (!response.ok) { errors.push(`${engine.name}：搜索服务拒绝请求（HTTP ${response.status}）`); continue; }
    let html: string;
    try { html = await response.text(); }
    catch (error) { errors.push(`${engine.name}：${networkError(error)}`); continue; }
    if (/百度安全验证|<title[^>]*>[^<]*(?:captcha|验证)|id=["']b_captcha|class=["'][^"']*captcha/i.test(html)) {
      errors.push(`${engine.name}：需要网页安全验证，请使用来源入口`); continue;
    }
    const results = engine.parse(html, source);
    if (results.length) return results;
    if (/class=["'][^"']*\bb_no\b|class=["'][^"']*\bnors\b|没有找到与[^<]*相关|找不到和[^<]*相符/i.test(html)) {
      validEmpty = true; continue;
    }
    const hasResults = engine.name === 'Bing' ? /\bb_algo\b/i.test(html) : /class=["'][^"']*\bresult\b/i.test(html);
    errors.push(`${engine.name}：${hasResults ? '未返回可用的目标站点链接' : '返回的搜索页面无法识别'}`);
  }
  if (validEmpty) return [];
  throw new Error(errors.join('；'));
}

/** Query Bilibili and the NGA board directly; use public web indexes for other sites. */
async function performSearch(request: LineupSearchRequest): Promise<LineupSearchResponse> {
  const { keyword } = request;
  const jobs: Array<{ source: LineupExternalSource; search: Promise<LineupSearchResult[]> }> = [
    { source: 'bilibili', search: searchBilibiliLineups(request) },
    ...INDEXED_SOURCES.map(source => ({ source: source.id, search: searchIndexedSource(source, keyword) })),
    { source: 'nga', search: searchNgaLineups(request) },
  ];
  const settled = await Promise.allSettled(jobs.map(job => job.search));
  const results: LineupSearchResult[] = [];
  const unavailableSources: LineupExternalSource[] = [];
  const sourceErrors: NonNullable<LineupSearchResponse['sourceErrors']> = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') results.push(...result.value);
    else {
      const source = jobs[index].source;
      unavailableSources.push(source);
      sourceErrors.push({ source, message: result.reason instanceof Error ? result.reason.message : '搜索暂时失败，请稍后重试' });
    }
  });
  return { results, unavailableSources, sourceErrors };
}

export async function searchLineups(request: unknown): Promise<LineupSearchResponse> {
  if (!request || typeof request !== 'object') throw new Error('搜索条件无效');
  const value = request as Partial<LineupSearchRequest>;
  const keyword = typeof value.keyword === 'string' ? value.keyword.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
  const order = value.order === 'click' ? 'click' : value.order === 'pubdate' ? 'pubdate' : null;
  if (!keyword || !order) throw new Error('请输入玩法关键词并选择排序方式');

  const categoryId = typeof value.categoryId === 'string' && /^(soul|awakening|exploration|boss|secret|event|duel|barrier|other)$/.test(value.categoryId) ? value.categoryId : undefined;
  const extraKeyword = typeof value.extraKeyword === 'string' ? value.extraKeyword.trim().replace(/\s+/g, ' ').slice(0, 100) : undefined;
  const key = JSON.stringify([keyword.toLocaleLowerCase(), order, Boolean(value.forceRefresh), categoryId, extraKeyword]);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = performSearch({ keyword, order, forceRefresh: Boolean(value.forceRefresh), categoryId, extraKeyword });
    inFlight.set(key, pending);
  }
  try { return structuredClone(await pending); }
  finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
}
