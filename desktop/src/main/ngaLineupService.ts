import { session } from 'electron';
import type { LineupCategoryId, LineupSearchRequest, LineupSearchResult } from '../shared/lineups';
import { plainText, stableSearchId } from './lineupParsing';

export const NGA_BOARD_URL = 'https://bbs.nga.cn/thread.php?fid=538';
const ORIGIN = 'https://bbs.nga.cn';
const BOARD_TTL_MS = 60_000;
let boardCache: { savedAt: number; pages: string[] } | undefined;
let pendingBoard: Promise<string[]> | undefined;

const CATEGORIES: Record<LineupCategoryId, { query: string; aliases: string[] }> = {
  soul: { query: '御魂阵容', aliases: ['御魂副本', '御魂阵容', '魂土', '魂十', '魂十一', '魂王', '悲鸣', '神罚', '日轮', '永生之海', '御灵', '真蛇'] },
  awakening: { query: '觉醒副本', aliases: ['觉醒'] },
  exploration: { query: '探索副本', aliases: ['探索', '狗粮'] },
  boss: { query: '逢魔首领', aliases: ['逢魔', '狩猎战'] },
  secret: { query: '秘闻副本', aliases: ['秘闻'] },
  event: { query: '活动副本 爬塔', aliases: ['活动攻略', '活动阵容', '爬塔', '活动副本'] },
  duel: { query: '斗技', aliases: ['斗技'] },
  barrier: { query: '结界突破', aliases: ['结界', '道馆'] },
  other: { query: '常用阵容', aliases: ['攻略', '阵容', '指南', '心得'] },
};

function decodeEntities(value: string): string {
  for (let depth = 0; depth < 4; depth++) {
    const next = plainText(value, value.length);
    if (next === value) break;
    value = next;
  }
  return value;
}

function ngaText(value: string): string {
  return plainText(value.replace(/\[\/?(?:b|u|i|color|size|font|align|url|tid)(?:=[^\]]*)?\]/gi, ''), 320);
}

/** Only thread/post detail links from the forum; never run page scripts. */
function detailUrl(raw: string): string | null {
  try {
    const url = new URL(decodeEntities(raw), ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || !['bbs.nga.cn', 'nga.cn', 'www.nga.cn', 'nga.178.com', 'ngabbs.com'].includes(url.hostname) || url.username || url.password || url.pathname !== '/read.php') return null;
    const tid = url.searchParams.get('tid'), pid = url.searchParams.get('pid');
    const key = tid && /^[1-9]\d{0,11}$/.test(tid) ? ['tid', tid] : pid && /^[1-9]\d{0,11}$/.test(pid) ? ['pid', pid] : null;
    if (!key) return null;
    const target = new URL('/read.php', ORIGIN);
    target.searchParams.set(key[0], key[1]);
    if (key[0] === 'pid' && url.searchParams.get('opt') === '128') target.searchParams.set('opt', '128');
    return target.href;
  } catch { return null; }
}

function filterFor(request: LineupSearchRequest): { aliases: string[]; terms: string[] } {
  const keyword = request.keyword.replace(/^阴阳师\s*/, '');
  const category = request.categoryId && CATEGORIES[request.categoryId] ? CATEGORIES[request.categoryId] : Object.values(CATEGORIES).find(item => keyword.startsWith(item.query));
  const extra = request.extraKeyword ?? (category ? keyword.slice(category.query.length).trim() : keyword);
  return { aliases: category?.aliases ?? [], terms: extra.toLocaleLowerCase().split(/\s+/).filter(Boolean) };
}

/** Parse the board's curated BBCode guide links and matching public thread titles. */
export function parseNgaGuidePage(html: string, request: LineupSearchRequest): LineupSearchResult[] {
  const filter = filterFor(request);
  const results = new Map<string, LineupSearchResult>();
  const add = (raw: string, rawTitle: string, author = 'NGA 阴阳师版块', publishedAt = 0, replies?: number): void => {
    const url = detailUrl(raw), title = ngaText(rawTitle);
    if (!url || !title || /版务|公告|版规|求号|送号|换号|晒卡|翻车集中|许愿|招募/.test(title)) return;
    if (filter.aliases.length && !filter.aliases.some(alias => title.includes(alias))) return;
    const lower = title.toLocaleLowerCase();
    if (!filter.terms.every(term => lower.includes(term))) return;
    const previous = results.get(url);
    if (previous && publishedAt <= previous.publishedAt) return;
    results.set(url, {
      bvid: stableSearchId('nga', url), source: 'nga', url, title, author,
      description: publishedAt ? '来自 NGA 阴阳师版块的近期帖子，按标题匹配；打开原帖查看阵容与御魂说明。' : '来自 NGA 阴阳师版块指引的攻略入口；打开原文查看攻略合集与配置要求。',
      publishedAt, duration: '', views: 0, favorites: 0, ...(replies === undefined ? {} : { replies }),
    });
  };
  const header = html.match(/<span\b[^>]*id=['"]toppedtopic['"][^>]*>([\s\S]*?)<\/span>\s*<\/span>/i)?.[1] ?? '';
  for (const match of header.matchAll(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi)) add(match[1], match[2]);
  for (const match of header.matchAll(/\[tid=(\d+)\]([\s\S]*?)\[\/tid\]/gi)) add(`/read.php?tid=${match[1]}`, match[2]);
  // Also accept already rendered headers, useful when the site changes its template.
  for (const match of header.matchAll(/<a\b[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)) add(match[1], match[2]);
  const rows = html.match(/<tr\b[^>]*class=['"][^'"]*\btopicrow\b[^'"]*['"][\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const anchors = [...row.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
    const link = anchors.find(item => /\bclass=['"][^'"]*\btopic\b[^'"]*['"]/i.test(item[1]));
    const href = link?.[1].match(/\bhref=['"]([^'"]+)['"]/i)?.[1];
    if (!link || !href) continue;
    const title = ngaText(link[2]);
    // Keep lineup/guide threads out of the board's chat, recruitment and exchange posts.
    if (!/攻略|阵容|配队|配速|打法|教学|作业|通关|心得|测评|低配|速刷|挂机|秒/.test(title) || /求助|求推荐|帮打|互换|换现|换金币|集中帖|招募/.test(title)) continue;
    const author = anchors.find(item => /\bclass=['"][^'"]*\bauthor\b[^'"]*['"]/i.test(item[1]));
    const replies = anchors.find(item => /\bclass=['"][^'"]*\breplies\b[^'"]*['"]/i.test(item[1]));
    const date = row.match(/<span\b[^>]*class=['"][^'"]*\bpostdate\b[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i)?.[1];
    const timestamp = Number(plainText(date, 20));
    add(href, link[2], plainText(author?.[2], 80) || 'NGA 用户', Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : 0, replies ? Number(plainText(replies[2], 20)) || 0 : undefined);
  }
  return [...results.values()];
}

async function fetchPage(page: number, signal: AbortSignal): Promise<string> {
  const ngaSession = session.fromPartition('onmyoji-nga-public');
  const url = new URL(NGA_BOARD_URL); url.searchParams.set('page', String(page));
  const headers = { Accept: 'text/html,application/xhtml+xml', Referer: NGA_BOARD_URL };
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try { response = await ngaSession.fetch(url.href, { headers, credentials: 'include', signal }); }
    catch (error) { throw new Error(signal.aborted || /timeout|abort/i.test(String(error)) ? 'NGA 版块读取超时，请稍后重试' : '连接 NGA 版块失败，请检查网络或代理设置'); }
    let html: string;
    try {
      const buffer = await response.arrayBuffer();
      const encoding = response.headers.get('content-type')?.match(/charset=['"]?([\w-]+)/i)?.[1]
        ?? new TextDecoder().decode(buffer.slice(0, 2000)).match(/charset=['"]?([\w-]+)/i)?.[1] ?? 'utf-8';
      html = new TextDecoder(/^(gbk|gb2312|gb18030)$/i.test(encoding) ? 'gb18030' : 'utf-8').decode(buffer);
    } catch { throw new Error('NGA 返回的版块内容无法读取，请稍后重试'); }
    // NGA itself supplies this short-lived public visitor cookie and reloads in a browser.
    // Follow that exact flow once; never synthesize a token or use account cookies.
    const guest = html.includes('访客不能直接访问') && html.match(/document\.cookie\s*=\s*['"]guestJs=([a-zA-Z0-9_-]{1,120});domain=/)?.[1];
    if (attempt === 0 && guest && (response.status === 403 || response.ok)) {
      try { await ngaSession.cookies.set({ url: `${ORIGIN}/`, name: 'guestJs', value: guest, path: '/', secure: true }); }
      catch { throw new Error('NGA 访客会话无法建立，请打开阴阳师版块查看'); }
      url.searchParams.set('rand', String(Math.floor(Math.random() * 1000)));
      continue;
    }
    if (/访客不能直接访问|需要.*登录|<title[^>]*>[^<]*(?:验证|访问受限)/i.test(html)) throw new Error('NGA 需要网页访问确认或登录，请点“打开阴阳师版块”继续');
    if (!response.ok) throw new Error(`NGA 版块暂时无法访问（HTTP ${response.status}），可打开阴阳师版块查看`);
    if (!/<title[^>]*>\s*阴阳师(?:\s|<)/i.test(html) || !/id=['"]topicrows['"]/i.test(html)) throw new Error('NGA 阴阳师版块页面结构无法识别，请打开阴阳师版块查看');
    return html;
  }
  throw new Error('NGA 访客页面尚未完成加载，请打开阴阳师版块查看');
}

async function boardPages(forceRefresh: boolean): Promise<string[]> {
  if (!forceRefresh && boardCache && Date.now() - boardCache.savedAt < BOARD_TTL_MS) return boardCache.pages;
  if (pendingBoard) return pendingBoard;
  const pending = (async (): Promise<string[]> => {
    const signal = AbortSignal.timeout(18_000);
    // Establish the public visitor session before fetching subsequent pages.
    const first = await fetchPage(1, signal);
    const extra = await Promise.allSettled([fetchPage(2, signal), fetchPage(3, signal)]);
    const pages = [first, ...extra.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])];
    boardCache = { savedAt: Date.now(), pages };
    return pages;
  })();
  pendingBoard = pending;
  try { return await pending; }
  finally { if (pendingBoard === pending) pendingBoard = undefined; }
}

export async function searchNgaLineups(request: LineupSearchRequest): Promise<LineupSearchResult[]> {
  const pages = await boardPages(Boolean(request.forceRefresh));
  const results = new Map<string, LineupSearchResult>();
  for (const html of pages) for (const result of parseNgaGuidePage(html, request)) {
    const old = results.get(result.url);
    if (!old || result.publishedAt > old.publishedAt) results.set(result.url, result);
  }
  return [...results.values()].sort((a, b) => request.order === 'click' ? (b.replies ?? 0) - (a.replies ?? 0) || b.publishedAt - a.publishedAt : b.publishedAt - a.publishedAt).slice(0, 12);
}
