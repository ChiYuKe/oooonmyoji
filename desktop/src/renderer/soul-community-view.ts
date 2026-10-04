import { COMMUNITY_DEFAULT_ENDPOINT, COMMUNITY_CACHE_TTL_MS, communityBuildTitle, compareCommunityBuild, createCommunityBuild, normalizeCommunityEndpoint, normalizeCommunityEntry, normalizeCommunityQuery, matchesCommunityFilters } from '../shared/soul-community';
import type { CommunityApi, CommunityComparison, CommunityEntry, CommunityQuery, CommunityFilters, CommunityAccountState } from '../shared/soul-community';
import { evaluatePlan, formatPlanScore, PANEL_LABELS, OPTIMIZATION_OBJECTIVES } from '../shared/soul-optimizer';
import type { HeroProfile, OptimizationOptions, PanelKey, SoulPlan, SuitProfile } from '../shared/soul-optimizer';
import type { SoulRecord } from '../shared/souls';
import { SOUL_MAIN_ATTRIBUTE_LABELS, SOUL_SLOT_MAIN_ATTRIBUTES } from '../shared/soul-slots';
import { createSoulPositionPortrait } from './soul-position-portrait';

export interface CommunityContext {
  hero: HeroProfile; plan: SoulPlan; inventory: readonly SoulRecord[]; options: OptimizationOptions; target?: { min?: number; max?: number };
}
interface ViewApi extends Partial<CommunityApi> { readLayout(key: string): string | null; writeLayout(key: string, value: string | null): void }
interface Preferences { endpoint: string; author: string; deleteToken: string }
const PREF_KEY = 'onmyoji-studio.souls.community';
const empty = (): Preferences => ({ endpoint: COMMUNITY_DEFAULT_ENDPOINT, author: '', deleteToken: '' });
const percent = new Set(['crit', 'critDamage', 'hit', 'resist']);
const flat = new Set(['attackAdditionVal', 'defenseAdditionVal', 'maxHpAdditionVal', 'speedAdditionVal']);
const stat = (name: string, amount: number): string => flat.has(name) ? amount.toFixed(2) : `${(amount * 100).toFixed(2)}%`;
export interface SoulCommunityPanels {
  update(context?: CommunityContext): void;
  show(trigger: HTMLElement, upload?: boolean): void;
  dispose(): void;
}
export function installSoulCommunityPanels(comparisonHost: HTMLElement, uploadHost: HTMLElement, api: ViewApi, catalog: SuitProfile[], open: (upload: boolean) => void, accountButton?: HTMLButtonElement): SoulCommunityPanels {
  const doc = comparisonHost.ownerDocument, comparison = doc.createElement('section'), upload = doc.createElement('section');
  comparisonHost.append(comparison); uploadHost.append(upload);
  const view = installSoulCommunity(comparison, api, catalog, upload, accountButton ? (account, loggingIn) => {
    const label = account.user?.author || (loggingIn ? '登录中…' : '用户登录');
    (accountButton.querySelector('.titlebar-account-label') ?? accountButton).textContent = label;
    accountButton.dataset.state = loggingIn ? 'loading' : account.user ? (account.offline ? 'offline' : 'signed-in') : 'guest';
    accountButton.setAttribute('aria-label', account.user ? `${label}，管理账号${account.offline ? '，当前离线' : ''}` : loggingIn ? '正在登录，查看登录进度' : '用户登录');
    accountButton.setAttribute('aria-busy', String(loggingIn));
    accountButton.title = account.user ? `GitHub：${account.user.login} · 点击管理账号${account.offline ? '（离线）' : ''}` : '使用 GitHub 登录';
  } : undefined);
  let accountDialog: HTMLDialogElement | undefined;
  const showAccountDialog = (): void => {
    if (!accountDialog || accountDialog.open) return;
    accountDialog.showModal();
    accountDialog.querySelector<HTMLButtonElement>('[data-community="login"]:not([hidden]), [data-community="logout"]:not([hidden])')?.focus();
  };
  if (accountButton) {
    accountDialog = doc.createElement('dialog');
    accountDialog.className = 'soul-account-dialog soul-community';
    accountDialog.setAttribute('aria-label', '用户账号');
    const heading = doc.createElement('div'); heading.className = 'soul-community-heading';
    const title = doc.createElement('div');
    const name = doc.createElement('h3'); name.textContent = '用户账号';
    const subtitle = doc.createElement('p'); subtitle.textContent = '管理社区身份与登录状态'; title.append(name, subtitle);
    const close = doc.createElement('button'); close.type = 'button'; close.className = 'soul-account-close'; close.textContent = '×'; close.setAttribute('aria-label', '关闭账号窗口');
    close.addEventListener('click', () => accountDialog?.close());
    heading.append(title, close); accountDialog.append(heading, upload.querySelector<HTMLElement>('[data-community="account"]')!);
    doc.body.append(accountDialog);
    accountButton.addEventListener('click', showAccountDialog);
    const manage = doc.createElement('button'); manage.type = 'button'; manage.textContent = '登录与账号管理…';
    manage.className = 'soul-upload-account-button'; manage.addEventListener('click', showAccountDialog); upload.prepend(manage);
  }
  comparison.classList.add('soul-community-panel'); upload.classList.add('soul-community-panel');
  let context: CommunityContext | undefined, comparisonVisible = false, disposed = false;
  const visibility = new IntersectionObserver(entries => {
    if (disposed) return;
    comparisonVisible = entries.some(entry => entry.isIntersecting);
    view.update(context, comparisonVisible);
  });
  visibility.observe(comparisonHost);
  return {
    update(next): void { context = next; view.update(next, comparisonVisible); },
    show(_button, uploading = false): void {
      if (disposed) return;
      open(uploading);
      if (!uploading) comparisonVisible = true;
      view.update(context, comparisonVisible);
      if (uploading) upload.querySelector<HTMLInputElement>('[data-community="author"]')!.focus();
    },
    dispose(): void { disposed = true; visibility.disconnect(); accountButton?.removeEventListener('click', showAccountDialog); accountDialog?.close(); view.dispose(); accountDialog?.remove(); comparison.remove(); upload.remove(); },
  };
}
export function installSoulCommunity(host: HTMLElement, api: ViewApi, catalog: SuitProfile[], uploadHost: HTMLElement, onAccountChange?: (account: CommunityAccountState, loggingIn: boolean) => void): { update(context?: CommunityContext, comparisonActive?: boolean): void; dispose(): void } {
  const doc = host.ownerDocument;
  host.className = 'soul-community';
  host.innerHTML = `<div class="soul-community-heading"><div><h3>社区方案比对</h3><p>用当前式神基础面板和评分条件重新计算，比较其他用户的六件御魂。</p></div><button type="button" data-community="refresh">刷新</button></div>
    <form data-community="filters" class="soul-community-filters" aria-label="社区方案筛选">
      <div class="soul-community-filter-grid">
        <label class="soul-community-search">搜索方案<input type="search" data-community="search" maxlength="60" placeholder="方案名称 / 套装名称 / 署名"></label>
        <label>分享者<input data-community="filter-author" maxlength="30" placeholder="按署名查找"></label>
        <label>四件套<select data-community="suit4"></select></label><label>两件套<select data-community="suit2"></select></label>
        ${[2, 4, 6].map(p => `<label>${p} 号位主属性<select data-community="main${p}"></select></label>`).join('')}
        <label>当前条件<select data-community="match"><option value="all">全部方案</option><option value="compatible">符合配装条件</option><option value="target">符合条件且达到目标</option><option value="better">符合条件且评分更高</option><option value="incompatible">未满足配装条件</option></select></label>
        <label>查看范围<select data-community="scope"><option value="all">全部分享</option><option value="mine">我的上传</option><option value="favorites">我的收藏</option></select></label>
        <label>排序<select data-community="sort"><option value="recommended">推荐：达标优先、评分接近</option><option value="score-desc">当前评分从高到低</option><option value="score-asc">当前评分从低到高</option><option value="closest">与我的评分最接近</option><option value="newest">最新上传</option><option value="oldest">最早上传</option></select></label>
      </div>
      <details data-community="advanced"><summary>高级筛选 · 上传时间 / 评分范围 / 面板范围</summary>
        <div class="soul-community-filter-grid">
          <label>上传开始日期（北京时间）<input type="date" data-community="after"></label><label>上传结束日期（含当天）<input type="date" data-community="before"></label>
          <label><span data-community="score-label">社区评分范围</span><span class="soul-community-filter-range"><input type="number" min="0" step="any" data-community="score-min" placeholder="最低" aria-label="最低社区评分"><span>至</span><input type="number" min="0" step="any" data-community="score-max" placeholder="最高" aria-label="最高社区评分"></span></label>
          <label><span data-community="delta-label">比我的评分高出</span><span class="soul-community-filter-range"><input type="number" step="any" data-community="delta-min" placeholder="最低差值" aria-label="最低评分差值"><span>至</span><input type="number" step="any" data-community="delta-max" placeholder="最高差值" aria-label="最高评分差值"></span></label>
          ${Object.entries(PANEL_LABELS).map(([key, label]) => `<label>${label}${percent.has(key) ? '（%）' : ''}<span class="soul-community-filter-range"><input type="number" min="0" step="any" data-community="panel-${key}-min" placeholder="最低" aria-label="最低${label}"><span>至</span><input type="number" min="0" step="any" data-community="panel-${key}-max" placeholder="最高" aria-label="最高${label}"></span></label>`).join('')}
        </div>
      </details>
      <div class="soul-community-filter-actions"><button type="submit" data-community="apply">应用筛选</button><button type="button" data-community="reset">重置全部</button><span data-community="filter-hint" role="status" aria-live="polite"></span></div>
      <p class="soul-community-filter-note">搜索、套装、主属性及日期修改后点击应用；评分、面板及当前条件即时筛选。收藏保存在本机；登录后可同步自己的上传记录。</p><p data-community="active-filters"></p>
    </form>
    <p data-community="status" role="status" aria-live="polite"></p><p data-community="summary" role="status" aria-live="polite"></p><div data-community="results" class="soul-community-results"></div>
    <div class="soul-community-pagination"><button type="button" data-community="prev">上一页</button><span data-community="page"></span><button type="button" data-community="next">下一页</button><label>每页<select data-community="page-size"><option value="12">12 个</option><option value="24">24 个</option><option value="48">48 个</option></select></label><button type="button" data-community="more" hidden>继续加载社区方案</button></div><div data-community="comparison"></div>`;
  uploadHost.className = 'soul-community';
  const accountMarkup = `<div class="soul-community-account" data-community="account">
    <div class="soul-account-profile"><div class="soul-account-avatar" data-community="account-avatar" aria-hidden="true">GH</div><div class="soul-account-identity"><h4 data-community="account-name">社区账号</h4><p data-community="account-login">使用 GitHub 安全登录</p></div><span class="soul-account-badge" data-community="account-badge">未登录</span></div>
    <p class="soul-account-status" data-community="account-status" role="status" aria-live="polite">正在读取登录状态…</p>
    <div class="soul-account-login-actions" data-community="login-actions"><button type="button" data-community="login">使用 GitHub 登录</button></div>
    <div class="soul-account-authorization" data-community="login-prompt" hidden><h4>确认 GitHub 授权</h4><p>在 GitHub 授权页面输入下方代码，确认后将自动完成登录。</p><input data-community="login-code" readonly aria-label="GitHub 授权码"><div class="soul-community-filter-actions"><button type="button" data-community="login-open">打开授权页面</button><button type="button" data-community="login-cancel">取消登录</button></div></div>
    <div class="soul-account-rename" data-community="rename-fields" hidden><label for="community-account-author">社区署名</label><p>显示在你分享的方案中，修改后会同步更新已有方案。</p><div class="soul-account-rename-row"><input id="community-account-author" data-community="rename-author" maxlength="30" placeholder="1 至 30 个字符"><button type="button" data-community="rename-save">保存署名</button></div><small>署名需保持唯一。</small></div>
    <div class="soul-account-footer"><p>浏览与比对无需登录。登录后可同步自己的上传记录，本机原有上传会归入首次绑定的账号。</p><button type="button" data-community="logout" hidden>退出登录</button></div>
  </div>`;
  uploadHost.innerHTML = `${accountMarkup}<div class="soul-community-fields"><label>分享署名（自动保存）<input data-community="author" maxlength="30" placeholder="自动生成唯一署名"></label><label>方案名称（自动生成）<input data-community="title" readonly aria-readonly="true"></label></div><p>上传会公开所选方案的六件御魂属性、式神和评分条件。支持完整的六星 +15 方案，评分不限。署名跟随账号，上传时检查重名。</p><button type="button" data-community="upload">上传当前配置</button><p data-community="upload-hint"></p><p data-community="upload-status" role="status" aria-live="polite"></p><h4>我的上传</h4><div class="soul-community-filter-actions"><button type="button" data-community="owned-refresh" hidden>同步我的上传</button><button type="button" data-community="owned-more" hidden>继续加载我的上传</button></div><p data-community="owned-status" role="status" aria-live="polite"></p><div data-community="owned"></div><details data-community="settings"><summary>社区连接设置</summary><div class="soul-community-fields"><label>社区服务地址<input type="url" data-community="endpoint" placeholder="https://你的社区服务域名" aria-label="社区服务地址"></label><button type="button" data-community="connect">保存并连接</button></div></details>`;
  const uploadFields = new Set(['account-status', 'login', 'logout', 'login-prompt', 'login-code', 'login-open', 'login-cancel', 'owned-refresh', 'owned-more', 'owned-status', 'author', 'title', 'upload', 'upload-hint', 'upload-status', 'owned', 'settings', 'endpoint', 'connect']);
  // Keep one set of login controls when the account section moves into the titlebar dialog.
  const accountHost = uploadHost.querySelector<HTMLElement>('[data-community="account"]')!;
  const accountFields = new Set(['account-avatar', 'account-name', 'account-login', 'account-badge', 'account-status', 'login-actions', 'login', 'logout', 'login-prompt', 'login-code', 'login-open', 'login-cancel', 'rename-fields', 'rename-author', 'rename-save']);
  const el = <T extends HTMLElement = HTMLElement>(name: string): T => (accountFields.has(name) ? accountHost : uploadFields.has(name) ? uploadHost : host).querySelector<T>(`[data-community="${name}"]`)!;
  const input = (name: string): HTMLInputElement => el(name);
  const button = (name: string): HTMLButtonElement => el(name);
  const text = (parent: HTMLElement, tag: string, value: string, className = ''): HTMLElement => {
    const node = doc.createElement(tag); node.textContent = value; node.className = className; parent.append(node); return node;
  };
  const deltaCell = (parent: HTMLElement, tag: string, delta: number, value: string): HTMLElement => {
    const node = text(parent, tag, value); node.dataset.delta = Math.abs(delta) < 1e-9 ? 'equal' : delta > 0 ? 'positive' : 'negative'; return node;
  };
  const select = (name: string): HTMLSelectElement => el(name);
  const option = (name: string, value: string, label: string): void => { const node = doc.createElement('option'); node.value = value; node.textContent = label; select(name).append(node); };
  for (const name of ['suit4', 'suit2']) {
    option(name, '', '不限套装');
    for (const suit of [...catalog].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) option(name, String(suit.id), suit.name);
  }
  for (const position of [2, 4, 6]) { option(`main${position}`, '', '不限主属性'); for (const name of SOUL_SLOT_MAIN_ATTRIBUTES[position]) option(`main${position}`, name, SOUL_MAIN_ATTRIBUTE_LABELS[name]); }
  const comparisonTable = (parent: HTMLElement, firstLabel: string): HTMLTableSectionElement => {
    const wrap = text(parent, 'div', '', 'soul-community-table-wrap'), table = doc.createElement('table'); table.className = 'soul-community-table'; wrap.append(table);
    const head = doc.createElement('thead'), row = doc.createElement('tr'); head.append(row); table.append(head);
    for (const label of [firstLabel, '我的方案', '社区配置', '差值']) text(row, 'th', label).setAttribute('scope', 'col');
    const body = doc.createElement('tbody'); table.append(body); return body;
  };
  let preferences = empty();
  try { const stored = JSON.parse(api.readLayout(PREF_KEY) ?? '{}'); preferences = { endpoint: typeof stored.endpoint === 'string' && !['undefined', 'null'].includes(stored.endpoint.trim()) ? stored.endpoint : '', author: typeof stored.author === 'string' ? stored.author.slice(0, 30) : '', deleteToken: /^[a-f0-9]{64}$/.test(stored.deleteToken ?? '') ? stored.deleteToken : '' }; } catch { /* Damaged preferences can be replaced. */ }
  preferences.endpoint ||= COMMUNITY_DEFAULT_ENDPOINT;
  input('endpoint').value = preferences.endpoint; input('author').value = preferences.author;
  el<HTMLDetailsElement>('settings').open = !preferences.endpoint;
  let context: CommunityContext | undefined, entries: CommunityEntry[] = [], cursor: string | null = null, key = '', generation = 0, sourceGeneration = 0;
  let selected = '', loading = false, uploading = false, disposed = false, comparisonActive = false, comparisonDirty = false;
  let loadedAt = 0;
  let account: CommunityAccountState = { user: null, persistent: true }, accountGeneration = 0, loggingIn = false, ownedLoading = false, ownedCursor: string | null = null;
  let loginTimer: ReturnType<typeof setTimeout> | undefined;
  let renaming = false;
  let filters: CommunityFilters = {}, remoteOrder: CommunityQuery['order'] = 'newest', pageNumber = 1, serverFilters = false;
  let cachedComparisons: CommunityComparison[] | undefined, skipped = 0;
  const filterNames = ['search', 'filter-author', 'suit4', 'suit2', 'main2', 'main4', 'main6', 'after', 'before', 'match', 'scope', 'sort', 'score-min', 'score-max', 'delta-min', 'delta-max', 'page-size', ...Object.keys(PANEL_LABELS).flatMap(key => [`panel-${key}-min`, `panel-${key}-max`])];
  const defaults: Record<string, string> = { match: 'all', scope: 'all', sort: 'recommended', 'page-size': '12' };
  const filterKey = (): string => `${PREF_KEY}.filters.${context?.hero.id}.${context?.options.objective}`;
  const favoritesKey = (): string => `${PREF_KEY}.favorites.${preferences.endpoint}`;
  const favorites = (): string[] => { try { const value = JSON.parse(api.readLayout(favoritesKey()) ?? '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) : []; } catch { return []; } };
  const saveFilters = (): void => { if (context) api.writeLayout(filterKey(), JSON.stringify(Object.fromEntries(filterNames.map(name => [name, input(name).value])))); };
  const resetFields = (): void => { for (const name of filterNames) input(name).value = defaults[name] ?? ''; };
  const readRemoteFilters = (): CommunityQuery => {
    const values: Record<string, unknown> = { heroId: context!.hero.id, objective: context!.options.objective, order: select('sort').value === 'oldest' ? 'oldest' : 'newest' };
    for (const name of ['search', 'suit4', 'suit2', 'main2', 'main4', 'main6', 'after', 'before']) if (input(name).value) values[name] = name.startsWith('suit') ? Number(input(name).value) : input(name).value.trim();
    values.author = input('filter-author').value.trim(); return normalizeCommunityQuery(values);
  };
  const bounds = (prefix: string, nonnegative = true): { min?: number; max?: number } => {
    const result: { min?: number; max?: number } = {};
    for (const side of ['min', 'max'] as const) {
      const raw = input(`${prefix}-${side}`).value.trim();
      if (raw) { const value = Number(raw); if (!Number.isFinite(value) || nonnegative && value < 0) throw Error('筛选范围需要填写有效数值。'); result[side] = value; }
    }
    if (result.min != null && result.max != null && result.min > result.max) throw Error('筛选下限不能高于上限。');
    return result;
  };
  const inBounds = (value: number, range: { min?: number; max?: number }): boolean => (range.min == null || value + 1e-9 >= range.min) && (range.max == null || value - 1e-9 <= range.max);
  const scaleRange = (range: { min?: number; max?: number }, divisor: number): { min?: number; max?: number } => ({ min: range.min == null ? undefined : range.min / divisor, max: range.max == null ? undefined : range.max / divisor });
  const readRanges = (): { score: { min?: number; max?: number }; delta: { min?: number; max?: number }; panel: [PanelKey, { min?: number; max?: number }][] } => {
    const divisor = context && OPTIMIZATION_OBJECTIVES[context.options.objective].percent ? 100 : 1;
    return { score: scaleRange(bounds('score'), divisor), delta: scaleRange(bounds('delta', false), divisor), panel: (Object.keys(PANEL_LABELS) as PanelKey[]).map(key => [key, scaleRange(bounds(`panel-${key}`), percent.has(key) ? 100 : 1)]) };
  };
  resetFields();
  interface Owned { id: string; title: string }
  const ownedKey = (): string => `${PREF_KEY}.${account.user ? `account-uploads.${account.user.githubId}` : 'uploads'}.${preferences.endpoint}`;
  const owned = (): Owned[] => { try { const data = JSON.parse(api.readLayout(ownedKey()) ?? '[]'); return Array.isArray(data) ? data.filter((v): v is Owned => typeof v?.id === 'string' && /^[a-f0-9]{64}$/.test(v.id) && typeof v.title === 'string') : []; } catch { return []; } };
  const message = (value: string, error = false, upload = false): void => { const status = el(upload ? 'upload-status' : 'status'); status.textContent = value; status.classList.toggle('soul-target-error', error); };
  const persist = (): void => api.writeLayout(PREF_KEY, JSON.stringify(preferences));
  if (!preferences.deleteToken) preferences.deleteToken = [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, '0')).join('');
  preferences.author ||= `御魂玩家-${preferences.deleteToken.slice(0, 12)}`;
  input('author').value = preferences.author; persist();
  const buildTitle = (): string => context ? communityBuildTitle(context.hero, context.plan.ids.flatMap(id => context!.inventory.find(s => s.id === id) ?? []), catalog) : '';
  const uploadProblem = (): string => {
    if (!context) return '请先计算并选择原方案。';
    try {
      createCommunityBuild(context.plan, context.inventory, context.options, context.hero.id, '', '');
      return '';
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  };
  const controls = (): void => {
    onAccountChange?.(account, loggingIn);
    accountHost.dataset.state = loggingIn ? 'loading' : account.user ? (account.offline ? 'offline' : 'signed-in') : 'guest';
    el('account-avatar').textContent = account.user ? [...account.user.author][0] || 'GH' : 'GH';
    el('account-name').textContent = account.user?.author || (loggingIn ? '正在登录' : '登录社区账号');
    el('account-login').textContent = account.user ? `GitHub · @${account.user.login}` : '使用 GitHub 安全登录';
    el('account-badge').textContent = loggingIn ? '等待授权' : account.user ? (account.offline ? '离线' : '已登录') : '未登录';
    el('login-actions').hidden = !!account.user || loggingIn;
    const problem = uploadProblem();
    button('refresh').disabled = !context || !preferences.endpoint || loading;
    button('apply').disabled = !context;
    button('more').disabled = loading; button('more').hidden = !cursor;
    button('upload').disabled = uploading || loggingIn || renaming || !preferences.endpoint || !api.uploadCommunityBuild || !!problem || !!api.getCommunityAccount && !account.user;
    input('author').disabled = uploading || loggingIn || renaming; input('endpoint').disabled = uploading || loggingIn || renaming; button('connect').disabled = uploading || loggingIn || renaming;
    button('login').disabled = uploading || loggingIn || renaming || !api.startCommunityLogin;
    button('login').hidden = !!account.user; button('logout').hidden = !account.user; button('logout').disabled = uploading || loggingIn || renaming;
    el('rename-fields').hidden = !account.user || !api.renameCommunityAccount;
    input('rename-author').disabled = renaming || uploading || loggingIn;
    button('rename-save').disabled = !account.user || !api.renameCommunityAccount || renaming || uploading || loggingIn;
    button('rename-save').textContent = renaming ? '正在保存…' : '保存署名';
    button('owned-refresh').hidden = !account.user; button('owned-refresh').disabled = ownedLoading;
    button('owned-more').hidden = !account.user || !ownedCursor; button('owned-more').disabled = ownedLoading;
    input('title').value = buildTitle();
    const percentage = context && OPTIMIZATION_OBJECTIVES[context.options.objective].percent;
    el('score-label').textContent = `社区评分范围${percentage ? '（%）' : ''}`;
    el('delta-label').textContent = `比我的评分高出${percentage ? '（百分点）' : '（负数表示更低）'}`;
    el('upload-hint').textContent = !!api.getCommunityAccount && !account.user ? '请先使用 GitHub 登录后上传；浏览和比对无需登录。' : problem || (!api.uploadCommunityBuild ? '上传服务未就绪，请重启程序。' : '当前方案可以上传，评分不限，无需设置目标范围。');
  };
  const renderOwned = (): void => {
    el('owned').replaceChildren();
    for (const item of owned()) {
      const row = text(el('owned'), 'div', '', 'soul-community-owned'); text(row, 'span', item.title);
      const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '撤回上传'; remove.disabled = !api.deleteCommunityBuild;
      remove.addEventListener('click', async () => {
        const endpoint = preferences.endpoint, localKey = ownedKey(), token = preferences.deleteToken, opGeneration = sourceGeneration;
        remove.disabled = true;
        try {
          await api.deleteCommunityBuild!(endpoint, item.id, token);
          const old = JSON.parse(api.readLayout(localKey) ?? '[]') as Owned[];
          api.writeLayout(localKey, JSON.stringify(old.filter(v => v.id !== item.id)));
          if (disposed || opGeneration !== sourceGeneration) return;
          entries = entries.filter(entry => entry.id !== item.id); cachedComparisons = undefined; renderOwned(); render(); message('已撤回上传。', false, true); reload();
        } catch (error) { if (!disposed && opGeneration === sourceGeneration) { message(error instanceof Error ? error.message : String(error), true, true); remove.disabled = false; if (api.getCommunityAccount) void restoreAccount(); } }
      }); row.append(remove);
    }
  };
  const accountMessage = (value: string, error = false): void => { el('account-status').textContent = value; el('account-status').classList.toggle('soul-target-error', error); };
  const showAccount = (): void => {
    input('rename-author').value = account.user?.author ?? '';
    accountMessage(account.user ? account.offline ? '当前离线，显示本机保存的账号信息。' : account.persistent ? '登录状态已安全保存，下次打开将自动登录。' : '本次登录仅在程序运行期间有效。' : '登录后即可分享配置，管理自己的上传记录。');
    controls(); renderOwned(); render();
  };
  async function syncOwned(more = false): Promise<void> {
    if (!account.user || !api.listCommunityOwnedBuilds || ownedLoading || disposed) return;
    const operation = accountGeneration, endpoint = preferences.endpoint, localKey = ownedKey(); ownedLoading = true; controls();
    try {
      const page = await api.listCommunityOwnedBuilds(endpoint, more ? ownedCursor ?? undefined : undefined);
      if (disposed || operation !== accountGeneration) return;
      const rows = [...new Map([...(more ? owned() : []), ...page.uploads].map(row => [row.id, row])).values()];
      api.writeLayout(localKey, JSON.stringify(rows)); ownedCursor = page.cursor; renderOwned(); render();
      el('owned-status').textContent = `已同步 ${rows.length} 个上传${ownedCursor ? '，可继续加载。' : '。'}`;
    } catch (error) { if (!disposed && operation === accountGeneration) el('owned-status').textContent = `${error instanceof Error ? error.message : String(error)} 已保留本机上传记录。`; }
    finally { if (!disposed && operation === accountGeneration) { ownedLoading = false; controls(); } }
  }
  async function restoreAccount(): Promise<void> {
    if (!api.getCommunityAccount) { showAccount(); return; }
    const operation = ++accountGeneration, endpoint = preferences.endpoint; account = { user: null, persistent: true }; ownedCursor = null; ownedLoading = false; controls();
    try {
      const state = await api.getCommunityAccount(endpoint);
      if (disposed || operation !== accountGeneration) return;
      account = state;
      if (account.user) { preferences.author = account.user.author; input('author').value = preferences.author; persist(); }
      showAccount(); if (!account.offline) await syncOwned();
    } catch (error) { if (!disposed && operation === accountGeneration) { accountMessage(error instanceof Error ? error.message : String(error), true); controls(); } }
  }
  const stopLoginTimer = (): void => { if (loginTimer != null) clearTimeout(loginTimer); loginTimer = undefined; };
  async function pollLogin(endpoint: string, operation: number): Promise<void> {
    if (disposed || operation !== accountGeneration || !loggingIn) return;
    try {
      const result = await api.pollCommunityLogin!(endpoint);
      if (disposed || operation !== accountGeneration || !loggingIn) return;
      if (result.status === 'pending') { loginTimer = setTimeout(() => { void pollLogin(endpoint, operation); }, result.interval * 1000); return; }
      loggingIn = false; el('login-prompt').hidden = true; input('login-code').value = ''; account = result.account;
      if (account.user) { preferences.author = account.user.author; input('author').value = preferences.author; persist(); }
      showAccount(); reload(); await syncOwned();
    } catch (error) {
      if (disposed || operation !== accountGeneration) return;
      loggingIn = false; el('login-prompt').hidden = true; input('login-code').value = '';
      accountMessage(error instanceof Error ? error.message : String(error), true); controls();
      void api.cancelCommunityLogin?.(endpoint);
    }
  }
  button('login').addEventListener('click', async () => {
    if (loggingIn || !api.startCommunityLogin || !api.pollCommunityLogin || disposed) return;
    const endpoint = preferences.endpoint, operation = ++accountGeneration; loggingIn = true; stopLoginTimer(); controls(); accountMessage('正在申请 GitHub 授权码…');
    try {
      const prompt = await api.startCommunityLogin(endpoint, preferences.deleteToken);
      if (disposed || operation !== accountGeneration) return;
      input('login-code').value = prompt.userCode; el('login-prompt').hidden = false; accountMessage('请在 GitHub 确认授权，完成后会自动登录。');
      loginTimer = setTimeout(() => { void pollLogin(endpoint, operation); }, prompt.interval * 1000);
      try { await api.openCommunityLogin?.(endpoint); } catch { accountMessage('请点击“打开 GitHub 授权页面”，输入授权码完成登录。'); }
    } catch (error) { if (!disposed && operation === accountGeneration) { loggingIn = false; accountMessage(error instanceof Error ? error.message : String(error), true); controls(); } }
  });
  button('login-open').addEventListener('click', async () => { try { await api.openCommunityLogin?.(preferences.endpoint); } catch (error) { accountMessage(error instanceof Error ? error.message : String(error), true); } });
  button('login-cancel').addEventListener('click', async () => {
    accountGeneration++; stopLoginTimer(); loggingIn = false; el('login-prompt').hidden = true; input('login-code').value = ''; controls();
    await api.cancelCommunityLogin?.(preferences.endpoint); if (!disposed) showAccount();
  });
  button('logout').addEventListener('click', async () => {
    const operation = ++accountGeneration, endpoint = preferences.endpoint; stopLoginTimer();
    try { await api.logoutCommunityAccount?.(endpoint); } finally {
      if (!disposed && operation === accountGeneration) { account = { user: null, persistent: true }; ownedCursor = null; ownedLoading = false; showAccount(); el('owned-status').textContent = ''; }
    }
  });
  button('owned-refresh').addEventListener('click', () => { void syncOwned(); }); button('owned-more').addEventListener('click', () => { void syncOwned(true); });
  button('rename-save').addEventListener('click', async () => {
    if (!account.user || !api.renameCommunityAccount || renaming || uploading || loggingIn || disposed) return;
    const operation = accountGeneration, endpoint = preferences.endpoint;
    renaming = true; controls(); accountMessage('正在保存社区署名…');
    try {
      const updated = await api.renameCommunityAccount(endpoint, input('rename-author').value);
      if (disposed || operation !== accountGeneration) return;
      account = updated;
      if (account.user) {
        preferences.author = account.user.author; input('author').value = preferences.author; persist();
        const ids = new Set(owned().map(item => item.id));
        entries = entries.map(entry => ids.has(entry.id) ? { ...entry, author: preferences.author } : entry);
      }
      showAccount(); accountMessage('社区署名已保存，已有上传方案会显示新署名。'); reload();
    } catch (error) { if (!disposed && operation === accountGeneration) accountMessage(error instanceof Error ? error.message : String(error), true); }
    finally { renaming = false; if (!disposed) controls(); }
  });
  const renderComparison = (comparison: CommunityComparison): void => {
    const c = context!; const detail = el('comparison'); detail.replaceChildren();
    const heading = text(detail, 'div', '', 'soul-community-comparison-heading'), identity = text(heading, 'div', '');
    text(identity, 'h4', comparison.entry.title);
    const uploadedTarget = comparison.entry.target;
    const targetNote = uploadedTarget.min == null && uploadedTarget.max == null ? '' : ` · 上传时参考目标 ${uploadedTarget.min == null ? '' : `≥ ${formatPlanScore(uploadedTarget.min, comparison.entry.objective)}`} ${uploadedTarget.max == null ? '' : `≤ ${formatPlanScore(uploadedTarget.max, comparison.entry.objective)}`}`;
    text(identity, 'p', `${comparison.entry.author} · ${new Date(comparison.entry.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}${targetNote}`);
    text(heading, 'span', comparison.violations.length ? '未满足当前条件' : comparison.meetsTarget ? '已达到目标' : '符合当前条件', 'soul-community-badge');
    const favorite = doc.createElement('button'); favorite.type = 'button';
    const isFavorite = favorites().includes(comparison.entry.id); favorite.textContent = isFavorite ? '取消收藏' : '收藏方案'; favorite.setAttribute('aria-pressed', String(isFavorite));
    favorite.addEventListener('click', () => { const ids = favorites(); api.writeLayout(favoritesKey(), JSON.stringify(isFavorite ? ids.filter(id => id !== comparison.entry.id) : [...ids, comparison.entry.id])); render(); }); heading.append(favorite);
    const scores = text(detail, 'div', '', 'soul-community-scores');
    for (const [label, amount, kind] of [['我的方案评分', comparison.originalScore, 'mine'], ['社区配置评分', comparison.plan.score, 'remote'], ['评分差值', comparison.delta, 'difference']] as const) {
      const item = text(scores, 'div', ''); item.dataset.kind = kind; text(item, 'small', label);
      const formatted = formatPlanScore(Math.abs(amount), c.options.objective);
      if (kind === 'difference') deltaCell(item, 'strong', amount, `${amount >= 0 ? '+' : '−'}${formatted}`);
      else text(item, 'strong', formatted);
    }
    const panel = text(detail, 'section', '', 'soul-community-panel-card'); text(panel, 'h5', '属性面板对比');
    const tables = text(panel, 'div', '', 'soul-community-panel-tables');
    const basic = comparisonTable(tables, '基础属性'), combat = comparisonTable(tables, '战斗属性');
    const currentPanel = evaluatePlan(c.plan.ids.map(id => c.inventory.find(s => s.id === id)!), c.options.base, catalog);
    for (const [name, label] of Object.entries(PANEL_LABELS)) {
      const key = name as PanelKey, current = currentPanel[key];
      const remote = comparison.plan.panel[key], tr = doc.createElement('tr'); (['attack', 'hp', 'defense', 'speed'].includes(key) ? basic : combat).append(tr);
      const format = (value: number): string => percent.has(key) ? `${(value * 100).toFixed(2)}%` : value.toFixed(2);
      text(tr, 'th', label).setAttribute('scope', 'row'); text(tr, 'td', format(current)); text(tr, 'td', format(remote)); deltaCell(tr, 'td', remote - current, `${remote >= current ? '+' : '−'}${format(Math.abs(remote - current))}`);
    }
    text(detail, 'h5', '六件御魂对比', 'soul-community-slots-title');
    const slots = text(detail, 'div', '', 'soul-community-slots');
    for (const remote of comparison.entry.souls) {
      const current = c.plan.ids.map(id => c.inventory.find(s => s.id === id)!).find(s => s.position === remote.position)!;
      const slot = text(slots, 'article', '', 'soul-community-slot'); text(slot, 'h5', `${remote.position} 号位`);
      const gears = text(slot, 'div', '', 'soul-community-gears');
      for (const [label, gear, kind] of [['我的', current, 'mine'], ['社区', remote, 'remote']] as const) {
        const name = catalog.find(suit => suit.id === gear.suitId)?.name ?? '未知套装';
        const row = text(gears, 'div', '', 'soul-community-gear'); row.dataset.kind = kind;
        row.append(createSoulPositionPortrait(doc, { ...gear, name, iconUrl: c.inventory.find(soul => soul.suitId === gear.suitId && soul.iconUrl)?.iconUrl }));
        const info = text(row, 'div', ''); text(info, 'small', label); text(info, 'strong', name);
        text(info, 'span', `${gear.mainAttribute!.label} ${stat(gear.mainAttribute!.name, gear.mainAttribute!.value)}`);
      }
      const b = comparisonTable(slot, '副属性');
      for (const name of new Set([...(current.subAttributes ?? []).map(a => a.name), ...(remote.subAttributes ?? []).map(a => a.name)])) {
        const a = current.subAttributes?.find(a => a.name === name), z = remote.subAttributes?.find(a => a.name === name), tr = doc.createElement('tr'); b.append(tr);
        text(tr, 'th', SOUL_MAIN_ATTRIBUTE_LABELS[name] ?? name).setAttribute('scope', 'row'); text(tr, 'td', a ? stat(name, a.value) : '—'); text(tr, 'td', z ? stat(name, z.value) : '—');
        const delta = (z?.value ?? 0) - (a?.value ?? 0); deltaCell(tr, 'td', delta, `${delta >= 0 ? '+' : '−'}${stat(name, Math.abs(delta))}`);
      }
      for (const [label, gear] of [['我的', current], ['社区', remote]] as const) if (gear.intrinsicAttributes?.length) text(slot, 'p', `${label}固有：${gear.intrinsicAttributes.map(a => `${a.label} ${stat(a.name, a.value)}`).join('、')}`, 'soul-community-intrinsic');
    }
    text(detail, 'p', '以上使用相同评分条件对比。社区配置属于其他用户，御魂不计入当前背包。', 'soul-community-footnote');
  };
  function render(): void {
    controls();
    if (!context) { el('results').replaceChildren(); el('comparison').replaceChildren(); el('summary').textContent = ''; el('active-filters').textContent = ''; el('page').textContent = '第 0 / 0 页'; button('prev').disabled = true; button('next').disabled = true; return; }
    let ranges: ReturnType<typeof readRanges>;
    try { ranges = readRanges(); el('filter-hint').textContent = ''; } catch (error) { el('filter-hint').textContent = error instanceof Error ? error.message : String(error); return; }
    el('results').replaceChildren(); el('comparison').replaceChildren();
    el('active-filters').textContent = Object.keys(filters).length ? '已应用：' + Object.entries(filters).map(([name, value]) => {
      if (name.startsWith('suit')) return `${name === 'suit4' ? '四件套' : '两件套'} ${catalog.find(s => s.id === value)?.name ?? value}`;
      if (name.startsWith('main')) return `${name.slice(-1)} 号位 ${SOUL_MAIN_ATTRIBUTE_LABELS[String(value)]}`;
      return `${({ search: '搜索', author: '署名', after: '开始日期', before: '结束日期' } as Record<string, string>)[name]} ${value}`;
    }).join(' · ') : '';
    if (!cachedComparisons) {
      cachedComparisons = []; skipped = 0;
      for (const entry of entries) {
        try { cachedComparisons.push(compareCommunityBuild(entry, context.plan, context.inventory, catalog, context.options, context.target)); } catch { skipped++; }
      }
    }
    const ownIds = new Set(owned().map(item => item.id)), favoriteIds = new Set(favorites()), match = select('match').value, scope = select('scope').value;
    const comparisons = cachedComparisons.filter(c => matchesCommunityFilters(c.entry, filters)
      && (scope !== 'mine' || ownIds.has(c.entry.id)) && (scope !== 'favorites' || favoriteIds.has(c.entry.id))
      && (match !== 'compatible' || !c.violations.length) && (match !== 'target' || !c.violations.length && c.meetsTarget)
      && (match !== 'better' || !c.violations.length && c.delta > 0) && (match !== 'incompatible' || !!c.violations.length)
      && inBounds(c.plan.score, ranges.score) && inBounds(c.delta, ranges.delta) && ranges.panel.every(([key, range]) => inBounds(c.plan.panel[key], range)));
    const sorting = select('sort').value;
    comparisons.sort((a, b) => {
      const byDate = Date.parse(b.entry.createdAt) - Date.parse(a.entry.createdAt) || b.entry.id.localeCompare(a.entry.id);
      if (sorting === 'newest') return byDate;
      if (sorting === 'oldest') return -byDate;
      if (sorting === 'score-desc') return b.plan.score - a.plan.score || byDate;
      if (sorting === 'score-asc') return a.plan.score - b.plan.score || byDate;
      if (sorting === 'closest') return Math.abs(a.delta) - Math.abs(b.delta) || byDate;
      return Number(!!a.violations.length) - Number(!!b.violations.length) || Number(b.meetsTarget) - Number(a.meetsTarget) || Math.abs(a.delta) - Math.abs(b.delta) || byDate;
    });
    const pageSize = [12, 24, 48].includes(Number(select('page-size').value)) ? Number(select('page-size').value) : 12;
    const pages = Math.ceil(comparisons.length / pageSize); pageNumber = Math.min(Math.max(1, pageNumber), Math.max(1, pages));
    const visible = comparisons.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    if (!visible.some(c => c.entry.id === selected)) selected = visible[0]?.entry.id ?? '';
    el('page').textContent = `第 ${pages ? pageNumber : 0} / ${pages} 页`;
    button('prev').disabled = pageNumber <= 1; button('next').disabled = pageNumber >= pages;
    el('summary').textContent = `已加载 ${entries.length} 个 · 筛选匹配 ${comparisons.length} 个 · 本页 ${visible.length} 个${skipped ? ` · ${skipped} 个数据不支持，已跳过` : ''}${cursor ? '。还有未加载的方案，当前评分排序和筛选基于已加载结果，可继续加载。' : '。已加载本次查询的全部结果。'}${!serverFilters && Object.keys(filters).length ? ' 当前服务仅支持本地筛选；更新社区服务后可检索全部分享。' : ''}`;
    if (!comparisons.length && !loading) el('summary').textContent += entries.length || Object.keys(filters).length ? ' 没有匹配方案，可放宽筛选或重置全部。' : ' 暂无分享。';
    for (const c of visible) {
      const choice = doc.createElement('button'); choice.type = 'button'; choice.className = 'soul-community-choice'; choice.setAttribute('aria-pressed', String(c.entry.id === selected));
      text(choice, 'strong', c.entry.title); text(choice, 'small', `${c.entry.author} · ${new Date(c.entry.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}${favoriteIds.has(c.entry.id) ? ' · 已收藏' : ''}`);
      const rating = text(choice, 'span', '', 'soul-community-choice-rating'); text(rating, 'strong', formatPlanScore(c.plan.score, context.options.objective));
      deltaCell(rating, 'span', c.delta, `${c.delta >= 0 ? '+' : '−'}${formatPlanScore(Math.abs(c.delta), context.options.objective)}`);
      text(choice, 'span', c.violations.length ? c.violations.join('；') : c.meetsTarget ? '已达到目标' : '符合当前条件', 'soul-community-choice-status');
      choice.addEventListener('click', () => { selected = c.entry.id; for (const button of el('results').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button === choice)); renderComparison(c); }); el('results').append(choice);
    }
    const chosen = visible.find(c => c.entry.id === selected); if (chosen) renderComparison(chosen);
  }
  function reload(): void {
    generation++; loading = false; comparisonDirty = true;
    void load(false, true);
  }
  async function load(more = false, refresh = false): Promise<void> {
    if (!comparisonActive || !context || !preferences.endpoint || !api.listCommunityBuilds || loading || disposed) return;
    const token = generation, requestKey = key; loading = true; controls(); message('正在读取社区御魂配置…');
    try {
      const page = await api.listCommunityBuilds(preferences.endpoint, { heroId: context.hero.id, objective: context.options.objective, ...filters, order: remoteOrder, cursor: more ? cursor ?? undefined : undefined }, refresh ? { refresh: true } : undefined);
      if (disposed || token !== generation || requestKey !== key) return;
      const rows = page.entries.map(normalizeCommunityEntry).filter(entry => entry.heroId === context!.hero.id && entry.objective === context!.options.objective);
      entries = [...new Map([...(more ? entries : []), ...rows].map(entry => [entry.id, entry])).values()]; cursor = page.cursor; serverFilters = page.filterVersion === 1; cachedComparisons = undefined;
      if (!more) pageNumber = 1;
      loadedAt = more ? Math.min(loadedAt, page.cache?.savedAt ?? Date.now()) : page.cache?.savedAt ?? Date.now();
      comparisonDirty = false;
      const result = entries.length ? `已载入 ${entries.length} 个${context!.hero.name} · ${OPTIMIZATION_OBJECTIVES[context!.options.objective].label}配置${cursor ? '，可继续加载。' : '。'}` : '还没有相同式神与评分指标的御魂配置。';
      message(`${result}${page.cache ? ` ${page.cache.stale ? '刷新失败，暂用本地缓存；' : '使用本地缓存，'}更新于 ${new Date(page.cache.savedAt).toLocaleString('zh-CN')}。点击“刷新”获取最新数据。` : ' 已缓存到本机，15 分钟内复用；点击“刷新”获取最新数据。'}`, page.cache?.stale);
    } catch (error) { if (!disposed && token === generation) message(error instanceof Error ? error.message : String(error), true); }
    finally { if (!disposed && token === generation) { loading = false; render(); } }
  }
  button('connect').addEventListener('click', () => {
    try {
      const endpoint = normalizeCommunityEndpoint(input('endpoint').value);
      preferences.endpoint = endpoint; preferences.author = input('author').value.trim(); persist(); key = ''; update(context, comparisonActive);
      void restoreAccount();
      message('连接地址已保存。', false, true);
    } catch (error) { message(error instanceof Error ? error.message : String(error), true, true); }
  });
  input('author').addEventListener('input', () => { preferences.author = input('author').value.trim(); persist(); });
  button('refresh').addEventListener('click', reload); button('more').addEventListener('click', () => { void load(true); });
  const applyFilters = (): void => {
    if (!context || disposed) return;
    try {
      readRanges();
      const { heroId: _hero, objective: _objective, order, ...nextFilters } = readRemoteFilters();
      const changed = JSON.stringify(filters) !== JSON.stringify(nextFilters) || remoteOrder !== order;
      filters = nextFilters; remoteOrder = order; pageNumber = 1; saveFilters();
      if (changed) {
        generation++; loading = false; entries = []; cursor = null; selected = ''; cachedComparisons = undefined; comparisonDirty = true;
        if (comparisonActive) void load();
      }
      render();
    } catch (error) { el('filter-hint').textContent = error instanceof Error ? error.message : String(error); }
  };
  el('filters').addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
  button('apply').addEventListener('click', event => { event.preventDefault(); applyFilters(); });
  button('reset').addEventListener('click', () => { resetFields(); applyFilters(); });
  select('sort').addEventListener('change', applyFilters);
  for (const name of ['match', 'scope', 'page-size']) select(name).addEventListener('change', () => { pageNumber = 1; saveFilters(); render(); });
  for (const name of filterNames.filter(name => name.startsWith('panel-') || name.startsWith('score-') || name.startsWith('delta-'))) input(name).addEventListener('input', () => { pageNumber = 1; saveFilters(); render(); });
  button('prev').addEventListener('click', () => { pageNumber--; render(); });
  button('next').addEventListener('click', () => { pageNumber++; render(); });
  button('upload').addEventListener('click', async () => {
    if (!context || uploadProblem() || uploading || !api.uploadCommunityBuild || !!api.getCommunityAccount && !account.user) return;
    const token = sourceGeneration, endpoint = preferences.endpoint, localKey = ownedKey();
    try {
      preferences.author = input('author').value.trim() || `御魂玩家-${preferences.deleteToken.slice(0, 12)}`;
      input('author').value = preferences.author; persist();
      const build = createCommunityBuild(context.plan, context.inventory, context.options, context.hero.id, buildTitle(), preferences.author);
      const previous = owned(); uploading = true; controls(); message('正在上传御魂配置…', false, true);
      const result = await api.uploadCommunityBuild(endpoint, build, preferences.deleteToken);
      preferences.author = result.author || build.author; input('author').value = preferences.author; persist();
      if (account.user) { account.user.author = preferences.author; showAccount(); }
      const uploads = previous.filter(item => item.id !== result.id); uploads.push({ id: result.id, title: build.title }); api.writeLayout(localKey, JSON.stringify(uploads));
      if (disposed || token !== sourceGeneration) return;
      renderOwned(); message('御魂配置已公开上传，可在此撤回。', false, true); reload();
    } catch (error) { if (!disposed && token === sourceGeneration) { message(error instanceof Error ? error.message : String(error), true, true); if (api.getCommunityAccount) void restoreAccount(); } }
    finally { uploading = false; if (!disposed) controls(); }
  });
  function update(next?: CommunityContext, compare = true): void {
    const becameVisible = compare && !comparisonActive;
    comparisonActive = compare;
    context = next;
    cachedComparisons = undefined;
    const nextKey = next ? `${preferences.endpoint}|${next.hero.id}|${next.options.objective}` : '';
    if (nextKey !== key || !next && !el('status').textContent) {
      key = nextKey; generation++; sourceGeneration++; entries = []; cursor = null; selected = ''; loading = false; comparisonDirty = true; pageNumber = 1; filters = {}; remoteOrder = 'newest'; resetFields();
      if (next) {
        try {
          const stored = JSON.parse(api.readLayout(filterKey()) ?? '{}');
          for (const name of filterNames) if (typeof stored[name] === 'string') input(name).value = stored[name];
          readRanges();
          const { heroId: _hero, objective: _objective, order, ...restored } = readRemoteFilters(); filters = restored; remoteOrder = order;
        } catch { resetFields(); }
      }
      renderOwned();
      message(next ? '' : '请先计算并选择要上传的方案。', false, true);
      if (!next) message('计算并选择原方案后，可对比社区御魂配置。');
      else if (!preferences.endpoint) message('社区服务尚未连接，请在上传窗口的“社区连接设置”中填写服务地址。');
      else if (compare) void load();
      else message('打开社区方案比对后读取配置。');
    }
    else if (next && compare && (comparisonDirty || becameVisible && Date.now() - loadedAt >= COMMUNITY_CACHE_TTL_MS)) void load();
    render();
  }
  update(undefined, false); renderOwned(); controls(); void restoreAccount();
  return { update, dispose(): void { disposed = true; generation++; sourceGeneration++; accountGeneration++; stopLoginTimer(); if (loggingIn) void api.cancelCommunityLogin?.(preferences.endpoint); host.replaceChildren(); uploadHost.replaceChildren(); } };
}
