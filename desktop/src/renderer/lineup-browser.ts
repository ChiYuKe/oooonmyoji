import type { LineupCategoryId, LineupExternalSource, LineupSearchOrder, LineupSearchResult } from '../shared/lineups';
import type { OnmyojiDesktopApi } from '../shared/contracts';
import { LINEUP_CACHE_TTL_MS, lineupCachedResults, lineupCacheUsable, mergeLineupSearch, type LineupSearchCacheEntry } from '../shared/lineup-cache';

type LineupApi = Pick<OnmyojiDesktopApi, 'searchLineups' | 'openLineupPost' | 'openLineupUrl' | 'openLineupSource' | 'readLayout' | 'writeLayout'>;

interface Category {
  id: LineupCategoryId;
  label: string;
  query: string;
}

interface SavedLineup extends LineupSearchResult {
  categoryId: string;
  note: string;
  savedAt: number;
}

const CATEGORIES: Category[] = [
  { id: 'soul', label: '御魂副本', query: '御魂阵容' },
  { id: 'awakening', label: '觉醒材料', query: '觉醒副本' },
  { id: 'exploration', label: '探索副本', query: '探索副本' },
  { id: 'boss', label: '逢魔首领', query: '逢魔首领' },
  { id: 'secret', label: '秘闻副本', query: '秘闻副本' },
  { id: 'event', label: '活动副本', query: '活动副本 爬塔' },
  { id: 'duel', label: '斗技', query: '斗技' },
  { id: 'barrier', label: '结界突破', query: '结界突破' },
  { id: 'other', label: '其他玩法', query: '常用阵容' },
];

const SOURCES: Array<{ id: LineupExternalSource; label: string; badge: string }> = [
  { id: 'bilibili', label: '哔哩哔哩', badge: 'B站' },
  { id: 'netease-community', label: '网易大神', badge: '大神' },
  { id: 'netease-official', label: '网易官网', badge: '官网' },
  { id: 'weibo', label: '微博', badge: '微博' },
  { id: 'nga', label: 'NGA', badge: 'NGA' },
];

const STORAGE_KEY = 'onmyoji-studio.lineup-bookmarks.v1';
// v4 invalidates cached results collected before the Baidu search fallback was added.
const SEARCH_CACHE_KEY = 'onmyoji-studio.lineup-search-cache.v4';
const MAX_BOOKMARKS = 100;
const MAX_SEARCH_CACHE_ENTRIES = 40;
type SearchCacheEntry = LineupSearchCacheEntry;

function numberText(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`;
  return String(value);
}

function dateText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(seconds * 1000));
}

function dateTimeText(milliseconds: number): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(milliseconds));
}

function validResultId(value: unknown): value is string {
  return typeof value === 'string' && (/^BV[0-9A-Za-z]{10}$/.test(value) || /^SRCH-[0-9a-f]{8}$/.test(value));
}

function resultSource(value: unknown): LineupExternalSource {
  return SOURCES.some(source => source.id === value) ? value as LineupExternalSource : 'bilibili';
}

function normalizeResult(item: unknown): LineupSearchResult | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Partial<LineupSearchResult>;
  if (!validResultId(row.bvid) || typeof row.title !== 'string') return null;
  const source = resultSource(row.source);
  const url = typeof row.url === 'string' ? row.url : source === 'bilibili' && /^BV/.test(row.bvid) ? `https://www.bilibili.com/video/${row.bvid}/` : '';
  if (!url) return null;
  return {
    bvid: row.bvid, source, url, title: row.title.slice(0, 180),
    author: typeof row.author === 'string' ? row.author.slice(0, 80) : '',
    description: typeof row.description === 'string' ? row.description.slice(0, 320) : '',
    publishedAt: typeof row.publishedAt === 'number' ? row.publishedAt : 0,
    duration: typeof row.duration === 'string' ? row.duration.slice(0, 20) : '',
    views: typeof row.views === 'number' ? row.views : 0,
    favorites: typeof row.favorites === 'number' ? row.favorites : 0,
    ...(typeof row.replies === 'number' && Number.isFinite(row.replies) && row.replies >= 0 ? { replies: Math.floor(row.replies) } : {}),
  };
}

function readSearchCache(api: Pick<OnmyojiDesktopApi, 'readLayout'>): Record<string, SearchCacheEntry> {
  try {
    const raw = api.readLayout(SEARCH_CACHE_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const now = Date.now();
    const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, item]): Array<[string, SearchCacheEntry]> => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Partial<SearchCacheEntry>;
      if (typeof row.cachedAt !== 'number' || !Number.isFinite(row.cachedAt) || row.cachedAt > now || now - row.cachedAt >= LINEUP_CACHE_TTL_MS || !Array.isArray(row.results)) return [];
      const results = row.results.map(normalizeResult).filter((result): result is LineupSearchResult => result !== null).slice(0, 100);
      const unavailableSources = Array.isArray(row.unavailableSources) ? row.unavailableSources.filter((source): source is LineupExternalSource => SOURCES.some(item => item.id === source)) : [];
      // Older versions cached failed empty searches for a day; discard those on read.
      if (!results.length && unavailableSources.length) return [];
      const sourceErrors = Array.isArray(row.sourceErrors) ? row.sourceErrors.flatMap(error => {
        if (!error || !unavailableSources.includes(error.source) || typeof error.message !== 'string') return [];
        return [{ source: error.source, message: error.message.slice(0, 600) }];
      }) : [];
      const sourceUpdatedAt: SearchCacheEntry['sourceUpdatedAt'] = {};
      for (const source of SOURCES) {
        const time = row.sourceUpdatedAt?.[source.id];
        sourceUpdatedAt[source.id] = typeof time === 'number' && Number.isFinite(time) && time <= now ? time : row.cachedAt;
      }
      const entry = { cachedAt: row.cachedAt, results, unavailableSources, sourceErrors, sourceUpdatedAt };
      entry.results = lineupCachedResults(entry, now);
      if (!entry.results.length && unavailableSources.length) return [];
      return [[key.slice(0, 400), entry]];
    }).sort((a, b) => b[1].cachedAt - a[1].cachedAt).slice(0, MAX_SEARCH_CACHE_ENTRIES);
    return Object.fromEntries(entries);
  } catch { return {}; }
}

function readBookmarks(api: Pick<OnmyojiDesktopApi, 'readLayout'>): SavedLineup[] {
  try {
    const raw = api.readLayout(STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: unknown): SavedLineup[] => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Partial<SavedLineup>;
      const normalized = normalizeResult(row);
      if (!normalized) return [];
      return [{
        ...normalized,
        categoryId: CATEGORIES.some(category => category.id === row.categoryId) ? row.categoryId! : 'other',
        note: typeof row.note === 'string' ? row.note.slice(0, 1000) : '',
        savedAt: typeof row.savedAt === 'number' ? row.savedAt : Date.now(),
      }];
    }).slice(0, MAX_BOOKMARKS);
  } catch { return []; }
}

/** Find current public lineup guides and keep personal references in local storage. */
export function installLineupBrowser(root: HTMLElement, api: LineupApi): { dispose: () => void; load: () => void } {
  root.innerHTML = `<form class="lineup-toolbar" data-lineup="form">
      <label class="lineup-search"><span aria-hidden="true">⌕</span><input data-lineup="search" type="search" placeholder="补充关键词，例如：魂土 15 秒、低配" aria-label="补充阵容搜索词"></label>
      <button class="lineup-action lineup-search-submit" type="submit">搜索阵容</button>
      <div class="lineup-toolbar-spacer"></div>
      <div class="lineup-sort" role="group" aria-label="阵容排序">
        <button type="button" data-lineup-order="pubdate" aria-pressed="true">最新发布</button>
        <button type="button" data-lineup-order="click" aria-pressed="false">热门</button>
      </div>
      <button class="lineup-action" type="button" data-lineup="bookmarks" aria-pressed="false">我的收藏 <span data-lineup="bookmark-count">0</span></button>
      <button class="lineup-action lineup-refresh" type="button" data-lineup="refresh" title="刷新当前玩法"><span aria-hidden="true">↻</span> 刷新</button>
    </form>
    <nav class="lineup-categories" aria-label="按玩法筛选" data-lineup="categories"></nav>
    <div class="lineup-sources" role="group" aria-label="其他攻略来源">
      <span>更多来源</span>
      <small>大神按钮直达阴阳师专题，应用内大神结果仍来自公开网页索引；NGA 读取版块指引与最多三页近期帖子。</small>
      <div data-lineup="sources"></div>
    </div>
    <div class="lineup-status" data-lineup="status" role="status" aria-live="polite">选择玩法后会自动汇总各站公开攻略。原文和御魂说明以发布者内容为准。</div>
    <div class="lineup-source-errors" data-lineup="errors" aria-label="来源查询情况" hidden></div>
    <div class="lineup-results" data-lineup="results" aria-live="polite"></div>`;

  const find = <T extends HTMLElement>(name: string): T => root.querySelector<T>(`[data-lineup="${name}"]`)!;
  const form = find<HTMLFormElement>('form');
  const search = find<HTMLInputElement>('search');
  const resultsNode = find<HTMLElement>('results');
  const status = find<HTMLElement>('status');
  const errorsNode = find<HTMLElement>('errors');
  let category = CATEGORIES[0];
  let order: LineupSearchOrder = 'pubdate';
  let bookmarks = readBookmarks(api);
  let searchCache = readSearchCache(api);
  let showBookmarks = false;
  let loaded = false;
  let loading = false;
  let requestNumber = 0;
  let currentResults: LineupSearchResult[] = [];
  let retainedSources: LineupExternalSource[] = [];
  let searchError = '';

  const errorText = (error: unknown): string => {
    const message = error instanceof Error ? error.message : '搜索暂时失败，请稍后重试。';
    return message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '');
  };

  const setStatus = (message: string, state = ''): void => {
    status.textContent = message;
    status.dataset.state = state;
  };
  const persist = (): void => {
    try { api.writeLayout(STORAGE_KEY, JSON.stringify(bookmarks.slice(0, MAX_BOOKMARKS))); } catch { /* Browsing still works if storage is unavailable. */ }
    find<HTMLElement>('bookmark-count').textContent = String(bookmarks.length);
  };
  const persistSearchCache = (): void => {
    searchCache = Object.fromEntries(Object.entries(searchCache).sort((a, b) => b[1].cachedAt - a[1].cachedAt).slice(0, MAX_SEARCH_CACHE_ENTRIES));
    try { api.writeLayout(SEARCH_CACHE_KEY, JSON.stringify(searchCache)); } catch { /* Browsing still works if storage is unavailable. */ }
  };
  const selectedBookmark = (bvid: string): SavedLineup | undefined => bookmarks.find(item => item.bvid === bvid);
  const currentKeyword = (): string => `阴阳师 ${category.query} ${search.value.trim()}`.trim();
  const sourceNames = (sources: LineupExternalSource[]): string => sources.map(source => SOURCES.find(item => item.id === source)?.label ?? source).join('、');
  const showSourceErrors = (sources: LineupExternalSource[], errors: SearchCacheEntry['sourceErrors'] = []): void => {
    errorsNode.replaceChildren();
    errorsNode.hidden = showBookmarks || !sources.length;
    for (const source of sources) {
      const row = root.ownerDocument.createElement('div');
      const reason = root.ownerDocument.createElement('span');
      reason.textContent = `${sourceNames([source])}：${errors?.find(item => item.source === source)?.message ?? '暂时无法获取攻略，可在网页中继续搜索。'}`;
      row.append(reason);
      const open = root.ownerDocument.createElement('button');
      open.type = 'button'; open.className = 'lineup-action'; open.textContent = source === 'nga' ? '打开阴阳师版块' : source === 'netease-community' ? '打开阴阳师专题' : '去网页搜索';
      open.addEventListener('click', () => { void api.openLineupSource(source, `${category.query} ${search.value.trim()}`).catch(error => setStatus(errorText(error), 'error')); });
      row.append(open); errorsNode.append(row);
    }
  };
  const activeItems = (): Array<LineupSearchResult | SavedLineup> => {
    const term = search.value.trim().toLocaleLowerCase();
    if (showBookmarks) return bookmarks.filter(item => item.categoryId === category.id && (!term || `${item.title} ${item.author} ${item.description} ${item.note}`.toLocaleLowerCase().includes(term)));
    // Online keywords have already been submitted to the search service.
    return currentResults;
  };

  const renderResults = (): void => {
    const items = activeItems();
    resultsNode.replaceChildren();
    if (!items.length) {
      const empty = root.ownerDocument.createElement('div');
      empty.className = 'lineup-empty';
      empty.dataset.state = searchError && !showBookmarks ? 'error' : '';
      empty.textContent = showBookmarks ? `“${category.label}”还没有收藏的攻略。` : loading ? '正在查找攻略…' : searchError ? '暂时无法获取攻略。请查看上方提示，或点来源按钮在网页中搜索。' : loaded ? '没有找到相关攻略，试试缩短关键词或切换到“热门”。' : '正在准备搜索…';
      resultsNode.append(empty);
      return;
    }
    const fragment = root.ownerDocument.createDocumentFragment();
    for (const item of items) {
      const saved = selectedBookmark(item.bvid);
      const card = root.ownerDocument.createElement('article'); card.className = 'lineup-card';
      const top = root.ownerDocument.createElement('div'); top.className = 'lineup-card-top';
      const badge = root.ownerDocument.createElement('span'); badge.className = 'lineup-badge'; badge.textContent = SOURCES.find(source => source.id === item.source)?.label ?? '攻略'; top.append(badge);
      const meta = root.ownerDocument.createElement('span'); meta.className = 'lineup-meta';
      meta.textContent = `${item.author} · ${dateText(item.publishedAt)}${!showBookmarks && retainedSources.includes(item.source) ? ' · 缓存攻略' : ''}`; top.append(meta); card.append(top);
      const title = root.ownerDocument.createElement('h3'); title.textContent = item.title; card.append(title);
      const desc = root.ownerDocument.createElement('p'); desc.className = 'lineup-description'; desc.textContent = item.description || `打开${item.source === 'bilibili' ? '原视频' : '原文'}查看阵容成员、御魂搭配和速度要求。`; card.append(desc);
      const metrics = root.ownerDocument.createElement('div'); metrics.className = 'lineup-metrics';
      metrics.textContent = item.source === 'bilibili' ? [item.duration ? `时长 ${item.duration}` : '', `播放 ${numberText(item.views)}`, `收藏 ${numberText(item.favorites)}`].filter(Boolean).join('　·　') : item.source === 'nga' ? `NGA 阴阳师版块 · ${item.replies === undefined ? '攻略入口' : `回复 ${numberText(item.replies)}`}` : '公开网页索引结果 · 打开原文查看详情'; card.append(metrics);
      const actions = root.ownerDocument.createElement('div'); actions.className = 'lineup-card-actions';
      const open = root.ownerDocument.createElement('button'); open.type = 'button'; open.className = 'lineup-action lineup-open'; open.dataset.action = 'open'; open.dataset.bvid = item.bvid; open.dataset.source = item.source; open.dataset.url = item.url; open.textContent = item.source === 'bilibili' ? '查看原视频' : '查看原文'; actions.append(open);
      const bookmark = root.ownerDocument.createElement('button'); bookmark.type = 'button'; bookmark.className = 'lineup-action'; bookmark.dataset.action = saved ? 'remove' : 'save'; bookmark.dataset.bvid = item.bvid; bookmark.textContent = saved ? '已收藏' : '收藏攻略'; actions.append(bookmark); card.append(actions);
      if (showBookmarks && saved) {
        const note = root.ownerDocument.createElement('textarea'); note.className = 'lineup-note'; note.dataset.action = 'note'; note.dataset.bvid = item.bvid; note.maxLength = 1000; note.rows = 2;
        note.placeholder = '记下阵容成员、御魂套装、速度要求或适用场景'; note.setAttribute('aria-label', `为${item.title}添加配队备注`); note.value = saved.note; card.append(note);
      }
      fragment.append(card);
    }
    resultsNode.append(fragment);
  };

  const saveBookmark = (item: LineupSearchResult): void => {
    const existing = selectedBookmark(item.bvid);
    if (existing) bookmarks = bookmarks.filter(entry => entry.bvid !== item.bvid);
    else {
      if (bookmarks.length >= MAX_BOOKMARKS) { setStatus(`最多保存 ${MAX_BOOKMARKS} 条攻略，请先移除一些收藏。`, 'error'); return; }
      bookmarks.unshift({ ...item, categoryId: category.id, note: '', savedAt: Date.now() });
    }
    bookmarks = bookmarks.slice(0, MAX_BOOKMARKS);
    persist(); renderResults();
  };

  const searchCurrent = async (forceRefresh = false): Promise<void> => {
    const myRequest = ++requestNumber;
    const keyword = currentKeyword();
    const cacheKey = JSON.stringify([keyword.toLocaleLowerCase(), order]);
    const cached = searchCache[cacheKey];
    if (!forceRefresh && cached && lineupCacheUsable(cached, Date.now())) {
      loading = false;
      find<HTMLButtonElement>('refresh').disabled = false;
      form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = false;
      currentResults = lineupCachedResults(cached, Date.now());
      retainedSources = [...new Set(currentResults.filter(item => cached.unavailableSources.includes(item.source)).map(item => item.source))];
      showSourceErrors(cached.unavailableSources, cached.sourceErrors);
      loaded = true;
      searchError = cached.unavailableSources.length ? `暂不可用：${sourceNames(cached.unavailableSources)}` : '';
      const mode = order === 'pubdate' ? '最新发布' : '热门';
      const warning = cached.unavailableSources.length ? ` 部分来源暂不可用：${sourceNames(cached.unavailableSources)}。` : '';
      setStatus(`使用本机缓存 · ${category.label} · ${mode} · ${currentResults.length} 条 · 缓存于 ${dateTimeText(cached.cachedAt)}。${warning}点“刷新”获取最新结果。`, cached.unavailableSources.length ? 'warning' : 'ready');
      renderResults();
      return;
    }
    loading = true;
    find<HTMLButtonElement>('refresh').disabled = true;
    find<HTMLFormElement>('form').querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = true;
    const mode = order === 'pubdate' ? '最新发布' : '热门';
    searchError = '';
    // A different query must never show results from the previous category.
    currentResults = cached ? lineupCachedResults(cached, Date.now()) : [];
    retainedSources = [...new Set(currentResults.map(item => item.source))];
    showSourceErrors([]);
    setStatus(`${forceRefresh ? '正在刷新' : '正在查找'}公开来源 ${category.label} · ${mode}…`, 'loading');
    renderResults();
    try {
      const response = await api.searchLineups({ keyword, order, forceRefresh, categoryId: category.id, extraKeyword: search.value.trim() });
      if (myRequest !== requestNumber) return;
      const now = Date.now();
      const merged = mergeLineupSearch(response, cached, now);
      currentResults = merged.results;
      retainedSources = merged.retainedSources;
      if (merged.cacheEntry) searchCache[cacheKey] = merged.cacheEntry;
      else delete searchCache[cacheKey];
      persistSearchCache();
      loaded = true;
      loading = false;
      searchError = response.unavailableSources.length ? `暂不可用：${sourceNames(response.unavailableSources)}` : '';
      showSourceErrors(response.unavailableSources, response.sourceErrors);
      const allFailed = response.unavailableSources.length === SOURCES.length;
      const retainedNote = retainedSources.length ? ` 保留了${sourceNames(retainedSources)}的缓存攻略。` : '';
      const cacheNote = allFailed ? '本次查询失败，未缓存空结果；可稍后刷新或在网页中搜索。' : response.unavailableSources.length ? merged.cacheEntry ? '部分来源失败，2 分钟后可重新查询，也可点“刷新”。' : '部分来源失败，本次空结果未缓存；可稍后刷新或在网页中搜索。' : '24 小时内使用缓存，点“刷新”获取最新结果。';
      setStatus(`${allFailed ? '各来源暂时无法查询' : '阵容搜索结果'} · ${currentResults.length} 条 · 查询于 ${dateTimeText(now)}。${retainedNote}${cacheNote}`, allFailed && !currentResults.length ? 'error' : response.unavailableSources.length ? 'warning' : 'ready');
      renderResults();
    } catch (error) {
      if (myRequest !== requestNumber) return;
      loaded = true;
      loading = false;
      searchError = errorText(error);
      setStatus(`${searchError}${currentResults.length ? ' 已保留上次获取的攻略，可稍后刷新。' : ''}`, 'error');
      renderResults();
    } finally {
      if (myRequest === requestNumber) {
        loading = false;
        find<HTMLButtonElement>('refresh').disabled = false;
        find<HTMLFormElement>('form').querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = false;
      }
    }
  };

  const selectCategory = (next: Category): void => {
    if (category.id === next.id) return;
    requestNumber++;
    loading = false;
    find<HTMLButtonElement>('refresh').disabled = false;
    find<HTMLFormElement>('form').querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = false;
    category = next;
    for (const button of find<HTMLElement>('categories').querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.category === category.id));
    if (showBookmarks) { setStatus(`本机收藏 · ${category.label}`, 'ready'); renderResults(); }
    else { void searchCurrent(); }
  };

  for (const item of CATEGORIES) {
    const button = root.ownerDocument.createElement('button'); button.type = 'button'; button.dataset.category = item.id; button.setAttribute('aria-pressed', String(item.id === category.id)); button.textContent = item.label;
    button.addEventListener('click', () => {
      for (const source of find<HTMLElement>('sources').querySelectorAll<HTMLButtonElement>('[data-source]')) source.title = source.dataset.source === 'nga' ? '打开 NGA 阴阳师版块（fid=538）' : source.dataset.source === 'netease-community' ? '打开网易大神阴阳师专题（进入网页后查找攻略）' : `在${SOURCES.find(entry => entry.id === source.dataset.source)?.label ?? '来源'}查找“${item.label}”阵容`;
      selectCategory(item);
    }); find<HTMLElement>('categories').append(button);
  }
  for (const item of SOURCES) {
    const button = root.ownerDocument.createElement('button'); button.type = 'button'; button.className = 'lineup-source-button'; button.dataset.source = item.id; button.title = item.id === 'nga' ? '打开 NGA 阴阳师版块（fid=538）' : item.id === 'netease-community' ? '打开网易大神阴阳师专题（进入网页后查找攻略）' : `在${item.label}查找“${category.label}”阵容`;
    const badge = root.ownerDocument.createElement('span'); badge.textContent = item.badge; button.append(badge); button.append(root.ownerDocument.createTextNode(item.label));
    button.addEventListener('click', () => { void api.openLineupSource(item.id, `${category.query} ${search.value.trim()}`).catch(error => setStatus(errorText(error), 'error')); });
    find<HTMLElement>('sources').append(button);
  }

  const onSubmit = (event: SubmitEvent): void => { event.preventDefault(); showBookmarks = false; find<HTMLButtonElement>('bookmarks').setAttribute('aria-pressed', 'false'); void searchCurrent(); };
  const onClick = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-lineup-order], [data-lineup="bookmarks"], [data-lineup="refresh"], [data-action="open"], [data-action="save"], [data-action="remove"]');
    if (!target || !root.contains(target)) return;
    if (target.hasAttribute('data-lineup-order')) {
      order = target.dataset.lineupOrder === 'click' ? 'click' : 'pubdate';
      for (const item of root.querySelectorAll<HTMLButtonElement>('[data-lineup-order]')) item.setAttribute('aria-pressed', String(item === target));
      showBookmarks = false; find<HTMLButtonElement>('bookmarks').setAttribute('aria-pressed', 'false'); void searchCurrent(); return;
    }
    if (target.dataset.lineup === 'bookmarks') {
      requestNumber++;
      loading = false;
      find<HTMLButtonElement>('refresh').disabled = false;
      form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = false;
      showBookmarks = !showBookmarks; target.setAttribute('aria-pressed', String(showBookmarks));
      errorsNode.hidden = showBookmarks || !errorsNode.children.length;
      setStatus(showBookmarks ? `本机收藏 · ${bookmarks.length} 条 · 按玩法分类查看，可为攻略添加配队备注。` : `阵容搜索结果 · ${currentResults.length} 条`, 'ready'); renderResults();
      if (!showBookmarks) void searchCurrent(); return;
    }
    if (target.dataset.lineup === 'refresh') { if (!showBookmarks) void searchCurrent(true); return; }
    const bvid = target.dataset.bvid;
    if (!bvid) return;
    if (target.dataset.action === 'open') {
      const source = resultSource(target.dataset.source);
      const opening = source === 'bilibili' ? api.openLineupPost(bvid) : api.openLineupUrl(source, target.dataset.url ?? '');
      void opening.catch(error => setStatus(errorText(error), 'error')); return;
    }
    const item = currentResults.find(result => result.bvid === bvid) ?? bookmarks.find(result => result.bvid === bvid);
    if (!item) return;
    if (target.dataset.action === 'save') saveBookmark(item);
    else if (target.dataset.action === 'remove') saveBookmark(item);
  };
  const onInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.dataset.action !== 'note') return;
    const saved = selectedBookmark(target.dataset.bvid ?? '');
    if (saved) { saved.note = target.value.slice(0, 1000); persist(); }
  };
  const onOrderClick = (event: Event): void => onClick(event as MouseEvent);
  for (const button of root.querySelectorAll('[data-lineup-order]')) button.addEventListener('click', onOrderClick);
  find<HTMLButtonElement>('bookmarks').addEventListener('click', onOrderClick);
  find<HTMLButtonElement>('refresh').addEventListener('click', onOrderClick);
  resultsNode.addEventListener('click', onClick);
  resultsNode.addEventListener('input', onInput);
  form.addEventListener('submit', onSubmit);
  search.addEventListener('input', renderResults);
  persist(); renderResults();

  return {
    load: () => { if (!loaded && !loading && !showBookmarks) void searchCurrent(); },
    dispose: () => {
      requestNumber++;
      for (const button of root.querySelectorAll('[data-lineup-order], [data-lineup="bookmarks"], [data-lineup="refresh"]')) button.removeEventListener('click', onOrderClick);
      resultsNode.removeEventListener('click', onClick); resultsNode.removeEventListener('input', onInput);
      form.removeEventListener('submit', onSubmit); root.replaceChildren();
    },
  };
}
