import type { OnmyojiDesktopApi, RuntimeInstance, SoulInstance } from '../shared/contracts';
import type { SoulRecord, SoulSnapshot } from '../shared/souls';
import { instanceLabel } from './instance-picker';
import { SoulGrid } from './soul-grid';
import { installSoulFilterView, selectedSoulFilterValues } from './soul-filter-view';
import { installSoulDetailWindow } from './soul-detail-window';
import type { SoulOptimizerPanel } from './soul-optimizer-view';
import { soulMainAttributesForPositions, SOUL_MAIN_ATTRIBUTE_LABELS } from '../shared/soul-slots';
import { createSoulPositionPortrait } from './soul-position-portrait';
import { renderSoulDetail } from './soul-detail-render';

export { formatSoulAttribute } from './soul-detail-render';

const SELECTION_KEY = 'onmyoji-studio.souls.instance';
type SoulApi = Pick<OnmyojiDesktopApi, 'listSoulInstances' | 'fetchSouls' | 'loadSouls' | 'cancelSoulFetch' | 'onSoulFetchProgress' | 'readLayout' | 'writeLayout'>;

/** Snapshot ownership stays with the instance, independent of workflow selection. */
export class SoulCalculatorState {
  instances: Array<RuntimeInstance & Partial<SoulInstance>> = [];
  selectedId = '';
  fetchingId = '';
  snapshots = new Map<string, SoulSnapshot>();
  /** 从本地快照载入的实例：用于在界面上区分「本次读取」与「上次保存」。 */
  restored = new Set<string>();
  loadingId = '';
  private pendingLoads = new Map<string, Promise<SoulSnapshot | null>>();

  setInstances(instances: Array<RuntimeInstance & Partial<SoulInstance>>, preferred = this.selectedId): void {
    this.instances = instances;
    this.selectedId = instances.some((item) => item.id === preferred) ? preferred : '';
  }
  select(id: string): void {
    if (this.fetchingId) return;
    this.selectedId = this.instances.some((item) => item.id === id) ? id : '';
  }
  get snapshot(): SoulSnapshot | undefined { return this.snapshots.get(this.selectedId); }
  get restoredFromDisk(): boolean { return this.restored.has(this.selectedId); }
  get offline(): boolean { return this.instances.find(item => item.id === this.selectedId)?.online === false; }
  async load(api: Pick<SoulApi, 'loadSouls'>, instanceId = this.selectedId): Promise<SoulSnapshot | null> {
    if (!instanceId || this.snapshots.has(instanceId)) return this.snapshots.get(instanceId) ?? null;
    if (this.pendingLoads.has(instanceId)) return this.pendingLoads.get(instanceId)!;
    this.loadingId = instanceId;
    const pending = api.loadSouls(instanceId).then(cached => {
      if (cached && cached.instanceId === instanceId && !this.snapshots.has(instanceId)) {
        this.snapshots.set(instanceId, cached); this.restored.add(instanceId);
      }
      return this.snapshots.get(instanceId) ?? null;
    }).finally(() => { this.pendingLoads.delete(instanceId); if (this.loadingId === instanceId) this.loadingId = ''; });
    this.pendingLoads.set(instanceId, pending); return pending;
  }
  async fetch(api: Pick<SoulApi, 'fetchSouls'>): Promise<SoulSnapshot | null> {
    if (!this.selectedId || this.fetchingId) throw new Error('请选择实例，并等待当前获取完成');
    if (this.offline) throw new Error('此实例已离线，可查看缓存；启动模拟器并刷新实例后可重新获取');
    const id = this.selectedId;
    this.fetchingId = id;
    try {
      const result = await api.fetchSouls(id);
      if (result) {
        if (result.instanceId !== id) throw new Error('返回数据与所选实例不一致，请重新获取');
        this.snapshots.set(id, result);
        this.restored.delete(id);
      }
      return result;
    } finally { this.fetchingId = ''; }
  }
}

type SoulFilterChoices = string | readonly string[];
export interface SoulFilters {
  suitId?: SoulFilterChoices;
  position?: SoulFilterChoices;
  level?: SoulFilterChoices;
  mainAttribute?: SoulFilterChoices;
  subAttributes?: string[];
  excludedSubAttributes?: string[];
  subAttributeCount?: SoulFilterChoices;
  intrinsicAttribute?: SoulFilterChoices;
}

export const SOUL_ATTRIBUTE_LABELS: Record<string, string> = {
  attackAdditionVal: '攻击', attackAdditionRate: '攻击加成', defenseAdditionVal: '防御', defenseAdditionRate: '防御加成',
  maxHpAdditionVal: '生命', maxHpAdditionRate: '生命加成', speedAdditionVal: '速度',
  debuffEnhance: '效果命中', debuffResist: '效果抵抗', critRateAdditionVal: '暴击', critPowerAdditionVal: '暴击伤害',
};

export function filterSouls(souls: SoulRecord[], query: string, stars: SoulFilterChoices, status: SoulFilterChoices, filters: SoulFilters = {}): SoulRecord[] {
  const term = query.trim().toLowerCase();
  const values = (choices?: SoulFilterChoices): readonly string[] => typeof choices === 'string' ? (choices ? [choices] : []) : choices ?? [];
  const starValues = values(stars), states = values(status), suits = values(filters.suitId), positions = values(filters.position);
  const mains = values(filters.mainAttribute), intrinsic = values(filters.intrinsicAttribute), counts = values(filters.subAttributeCount);
  const ranges = values(filters.level).map(level => level.split('-').map(Number));
  const matches = (choices: readonly string[], value: string | number | null | undefined): boolean => !choices.length || (value != null && choices.includes(String(value)));
  return souls.filter((soul) => (!term || soul.id.toLowerCase().includes(term) || String(soul.suitId ?? '').includes(term) || (soul.name ?? '').toLowerCase().includes(term))
    && matches(starValues, soul.stars)
    && (!states.length || states.some(state => (state === 'locked' && soul.locked) || (state === 'unlocked' && !soul.locked)
      || (state === 'equipped' && soul.equipped) || (state === 'unequipped' && !soul.equipped)
      || (state === 'discarded' && soul.discarded) || (state === 'kept' && !soul.discarded)))
    && matches(suits, soul.suitId)
    && matches(positions, soul.position)
    && (!ranges.length || (soul.level != null && ranges.some(range => soul.level! >= range[0] && soul.level! <= range[range.length - 1])))
    && matches(mains, soul.mainAttribute?.name)
    && (!intrinsic.length || soul.intrinsicAttributes?.some(attr => intrinsic.includes(attr.name)))
    && (!counts.length || counts.includes(String(new Set([
      ...(soul.subAttributes ?? []).map(attr => attr.name),
      ...(soul.attributeRolls ?? []).map(attr => attr.name),
    ]).size)))
    && (!filters.subAttributes?.length || filters.subAttributes.every(name =>
      soul.subAttributes?.some(attr => attr.name === name) || soul.attributeRolls?.some(attr => attr.name === name)))
    && (!filters.excludedSubAttributes?.length || filters.excludedSubAttributes.every(name =>
      !soul.subAttributes?.some(attr => attr.name === name) && !soul.attributeRolls?.some(attr => attr.name === name))));
}

export type SoulSortDirection = 'asc' | 'desc';

/** Compare decoded values only; unavailable values stay last in either direction. */
export function sortSouls(souls: SoulRecord[], key: string, direction: SoulSortDirection = 'desc'): SoulRecord[] {
  const attribute = key.startsWith('sub:') ? key.slice(4) : '';
  if (key !== 'level' && key !== 'stars' && !Object.hasOwn(SOUL_ATTRIBUTE_LABELS, attribute)) return [...souls];
  const entries = souls.map((soul, index) => {
    const value = key === 'level' ? soul.level : key === 'stars' ? soul.stars
      : soul.subAttributes?.find(attr => attr.name === attribute)?.value;
    return { soul, index, value: value != null && Number.isFinite(value) ? value : null };
  });
  entries.sort((a, b) => {
    if (a.value == null || b.value == null) return a.value == null && b.value == null ? a.index - b.index : a.value == null ? 1 : -1;
    return (direction === 'desc' ? b.value - a.value : a.value - b.value) || a.index - b.index;
  });
  return entries.map(entry => entry.soul);
}

export function installSoulCalculator(root: HTMLElement, api: SoulApi, optimizer?: SoulOptimizerPanel): () => void {
  const doc = root.ownerDocument;
  const element = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!;
  const instance = element<HTMLSelectElement>('soul-instance');
  const refresh = element<HTMLButtonElement>('soul-refresh');
  const fetch = element<HTMLButtonElement>('soul-fetch');
  const cancel = element<HTMLButtonElement>('soul-cancel');
  const status = element<HTMLParagraphElement>('soul-status');
  const summary = element<HTMLParagraphElement>('soul-summary');
  const progress = element<HTMLProgressElement>('soul-progress');
  const search = element<HTMLInputElement>('soul-search');
  const sort = element<HTMLSelectElement>('soul-sort');
  const sortDirectionButton = element<HTMLButtonElement>('soul-sort-direction');
  let sortDirection: SoulSortDirection = 'desc';
  const sortAttributes = doc.createElement('optgroup'); sortAttributes.label = '副属性';
  for (const name of ['speedAdditionVal', ...Object.keys(SOUL_ATTRIBUTE_LABELS).filter(name => name !== 'speedAdditionVal')]) {
    const option = doc.createElement('option'); option.value = `sub:${name}`; option.textContent = `副属性 · ${SOUL_ATTRIBUTE_LABELS[name]}`; sortAttributes.append(option);
  }
  sort.append(sortAttributes);
  const stars = element<HTMLSelectElement>('soul-stars');
  const stateFilter = element<HTMLSelectElement>('soul-state');
  const filterToggle = element<HTMLButtonElement>('soul-filter-toggle');
  const filterReset = element<HTMLButtonElement>('soul-filter-reset');
  const filterSummary = element<HTMLParagraphElement>('soul-filter-summary');
  const filterDrawer = element<HTMLElement>('soul-filter-drawer');
  const filterClose = element<HTMLButtonElement>('soul-filter-close');
  const suitFilter = element<HTMLSelectElement>('soul-suit');
  const positionFilter = element<HTMLSelectElement>('soul-position');
  const levelFilter = element<HTMLSelectElement>('soul-level');
  const mainFilter = element<HTMLSelectElement>('soul-main-attribute');
  const intrinsicFilter = element<HTMLSelectElement>('soul-intrinsic-attribute');
  const subCountFilter = element<HTMLSelectElement>('soul-sub-count');
  const subFilter = element<HTMLDivElement>('soul-sub-attributes');
  const extraSelects = [suitFilter, positionFilter, levelFilter, mainFilter, intrinsicFilter, subCountFilter];
  for (const [name, label] of Object.entries(SOUL_ATTRIBUTE_LABELS)) {
    const row = doc.createElement('div'); row.className = 'soul-sub-rule'; row.dataset.label = label;
    const title = doc.createElement('label'); title.className = 'soul-sub-name';
    const include = doc.createElement('input'); include.type = 'checkbox'; include.value = name; include.dataset.mode = 'include'; include.tabIndex = -1;
    include.setAttribute('aria-label', `包含${label}`);
    const exclude = doc.createElement('input'); exclude.type = 'checkbox'; exclude.value = name; exclude.dataset.mode = 'exclude'; exclude.tabIndex = -1;
    exclude.setAttribute('aria-label', `排除${label}`);
    title.append(include, doc.createTextNode(label)); row.append(title, exclude);
    include.addEventListener('change', () => { if (include.checked) exclude.checked = false; });
    for (const [mode, input, other, symbol, hint] of [
      ['include', include, exclude, '○', '包含'], ['exclude', exclude, include, '×', '排除'],
    ] as const) {
      const choice = doc.createElement('button'); choice.type = 'button'; choice.className = 'soul-sub-choice';
      choice.dataset.mode = mode; choice.dataset.name = name; choice.textContent = symbol;
      choice.setAttribute('aria-label', `${hint}${label}`); choice.title = `${hint}${label}（再次点击取消）`;
      choice.addEventListener('click', () => { input.checked = !input.checked; other.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
      row.append(choice);
    }
    subFilter.append(row);
  }
  let optionSnapshot: SoulSnapshot | undefined;
  const grid = element<HTMLUListElement>('soul-grid');
  const empty = element<HTMLDivElement>('soul-empty');
  const count = element<HTMLSpanElement>('soul-count');
  const detail = element<HTMLElement>('soul-detail');
  const state = new SoulCalculatorState();
  const cleanup: Array<() => void> = [];
  let disposed = false;
  let refreshing = false;
  let selectedSoul = '';
  optimizer?.setInstanceSelectionHandler((instanceId) => {
    if (refreshing || state.fetchingId || !state.instances.some(item => item.id === instanceId)) return;
    if (state.selectedId === instanceId) return;
    instance.value = instanceId;
    instance.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const bind = (el: HTMLElement, event: string, handler: EventListener): void => {
    el.addEventListener(event, handler); cleanup.push(() => el.removeEventListener(event, handler));
  };
  const filterView = installSoulFilterView(root, [stars, stateFilter, ...extraSelects], search);
  cleanup.push(filterView.dispose);
  const detailWindow = installSoulDetailWindow(root);
  cleanup.push(detailWindow.dispose);
  const showFilters = (show: boolean): void => {
    filterDrawer.hidden = !show;
    if (show) detailWindow.close();
    root.classList.toggle('soul-filters-open', show);
    filterToggle.setAttribute('aria-expanded', String(show));
  };
  const message = (text: string, error = false): void => {
    status.textContent = text; status.classList.toggle('error', error);
  };
  const controls = (): void => {
    const busy = Boolean(state.fetchingId);
    instance.disabled = refreshing || busy;
    refresh.disabled = refreshing || busy;
    fetch.disabled = refreshing || busy || !state.selectedId || state.offline;
    fetch.title = state.offline ? '历史实例可查看缓存；启动模拟器并刷新实例后可重新获取' : '';
    fetch.textContent = busy ? '正在获取…' : '获取御魂';
    cancel.hidden = !busy;
    progress.hidden = !busy;
    root.setAttribute('aria-busy', String(busy));
    optimizer?.update(state.snapshot, state.instances, state.selectedId, refreshing || busy);
  };
  const add = (parent: HTMLElement, tag: string, text: string, className = ''): HTMLElement => {
    const item = doc.createElement(tag); item.textContent = text; item.className = className; parent.append(item); return item;
  };
  // 「配装计算」入口：打开可停靠的配装面板；未装配面板（例如仅浏览历史的场景）时保持禁用。
  const launcher = doc.createElement('button'); launcher.type = 'button'; launcher.id = 'soul-optimize'; launcher.textContent = '配装计算'; launcher.disabled = true;
  launcher.title = '打开「御魂配装」面板，为当前实例的背包搜索六件套方案';
  launcher.addEventListener('click', () => optimizer?.open());
  root.querySelector('.soul-toolbar')?.insertBefore(launcher, root.querySelector('.soul-sort-controls'));
  cleanup.push(() => launcher.remove());
  const virtualGrid = new SoulGrid(grid, soul => {
    const item = doc.createElement('li');
    const select = doc.createElement('button'); select.type = 'button'; select.className = 'soul-card';
    select.dataset.soulId = soul.id;
    select.dataset.stars = String(soul.stars ?? 0);
    select.classList.toggle('selected', soul.id === selectedSoul);
    select.setAttribute('aria-pressed', String(soul.id === selectedSoul));
    const labels = [soul.locked ? '已锁定' : '', soul.equipped ? '已装备' : '', soul.discarded ? '已弃置' : ''].filter(Boolean);
    select.setAttribute('aria-label', `${soul.name ?? soul.suitId}，${soul.position ?? '未知'}号位，${soul.stars ?? '未知'}星，等级${soul.level ?? '未知'}，${labels.join('，') || '未装备'}，查看详细属性`);
    const top = add(select, 'span', '', 'soul-card-top');
    add(top, 'span', soul.level == null ? '—' : `+${soul.level}`, 'soul-card-level');
    add(top, 'span', soul.position ? ['壹', '贰', '叁', '肆', '伍', '陆'][soul.position - 1] : '—', 'soul-card-position');
    const portrait = add(select, 'span', '', 'soul-card-portrait'); portrait.append(createSoulPositionPortrait(doc, soul));
    const starCount = Math.min(6, Math.max(0, soul.stars ?? 0));
    const starsLabel = add(select, 'span', starCount ? '★'.repeat(starCount) : '—', 'soul-card-stars');
    starsLabel.setAttribute('aria-hidden', 'true');
    add(select, 'span', soul.name ?? String(soul.suitId ?? '—'), 'soul-card-name');
    const badges = add(select, 'span', '', 'soul-card-badges');
    if (soul.locked) add(badges, 'span', '锁', 'soul-card-lock');
    if (soul.equipped) add(badges, 'span', '已装备', 'soul-card-equipped');
    if (soul.discarded) add(badges, 'span', '弃', 'soul-card-discarded');
    const preview = (): void => {
      detailWindow.open(select, () => renderSoulDetail(doc, detail, soul));
    };
    select.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') preview(); });
    select.addEventListener('pointerleave', detailWindow.close);
    select.addEventListener('focus', () => preview());
    select.addEventListener('blur', detailWindow.close);
    select.addEventListener('click', () => {
      const previous = grid.querySelector<HTMLButtonElement>('.soul-card.selected');
      previous?.classList.remove('selected'); previous?.setAttribute('aria-pressed', 'false');
      selectedSoul = soul.id; select.classList.add('selected'); select.setAttribute('aria-pressed', 'true');
      preview();
    });
    item.append(select); return item;
  });
  cleanup.push(() => virtualGrid.dispose());
  const render = (): void => {
    detailWindow.close();
    const snapshot = state.snapshot;
    optimizer?.update(snapshot, state.instances, state.selectedId, refreshing || Boolean(state.fetchingId));
    launcher.disabled = !optimizer || !snapshot?.souls.length;
    const mainNames = soulMainAttributesForPositions(selectedSoulFilterValues(positionFilter));
    const mainSignature = mainNames.join('|');
    if (mainFilter.dataset.slotSignature !== mainSignature) {
      const previous = new Set(selectedSoulFilterValues(mainFilter));
      mainFilter.dataset.slotSignature = mainSignature;
      mainFilter.replaceChildren();
      const all = doc.createElement('option'); all.value = ''; all.textContent = '全部主属性'; mainFilter.append(all);
      for (const name of mainNames) {
        const option = doc.createElement('option'); option.value = name; option.textContent = SOUL_MAIN_ATTRIBUTE_LABELS[name];
        option.selected = previous.has(name); mainFilter.append(option);
      }
    }
    const name = state.instances.find((item) => item.id === state.selectedId);
    const stamp = snapshot ? new Date(snapshot.fetchedAt).toLocaleString() : '';
    summary.textContent = snapshot
      ? `${name ? instanceLabel(name) : snapshot.instanceId}${state.offline ? '（历史实例 · 离线）' : ''} · 已获取 ${snapshot.souls.length.toLocaleString()} 条 / 背包 ${snapshot.total.toLocaleString()} 条 · ${stamp}${state.restoredFromDisk ? '（本地保存）' : ''}${snapshot.failed ? ` · ${snapshot.failed} 条读取失败，可重新获取` : ''}`
      : '';
    if (snapshot !== optionSnapshot) {
      optionSnapshot = snapshot;
      const populate = (select: HTMLSelectElement, options: Map<string, string>, all: string): void => {
        const previous = new Set(selectedSoulFilterValues(select));
        select.replaceChildren();
        const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.textContent = all; select.append(placeholder);
        for (const [value, label] of Array.from(options).sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))) {
          const option = doc.createElement('option'); option.value = value; option.textContent = label; option.selected = previous.has(value); select.append(option);
        }
      };
      const suits = new Map<string, string>();
      const intrinsic = new Map<string, string>();
      for (const soul of snapshot?.souls ?? []) {
        if (soul.suitId != null) suits.set(String(soul.suitId), soul.name ?? `套装 ${soul.suitId}`);
        for (const attr of soul.intrinsicAttributes ?? []) intrinsic.set(attr.name, attr.label);
      }
      populate(suitFilter, suits, '全部类型');
      populate(intrinsicFilter, intrinsic, '全部固有属性');
    }
    const subAttributes = Array.from(subFilter.querySelectorAll<HTMLInputElement>('input[data-mode="include"]:checked')).map(input => input.value);
    const excludedSubAttributes = Array.from(subFilter.querySelectorAll<HTMLInputElement>('input[data-mode="exclude"]:checked')).map(input => input.value);
    const filters: SoulFilters = { suitId: selectedSoulFilterValues(suitFilter), position: selectedSoulFilterValues(positionFilter), level: selectedSoulFilterValues(levelFilter),
      mainAttribute: selectedSoulFilterValues(mainFilter), intrinsicAttribute: selectedSoulFilterValues(intrinsicFilter), subAttributes, excludedSubAttributes, subAttributeCount: selectedSoulFilterValues(subCountFilter) };
    const filtered = sortSouls(filterSouls(snapshot?.souls ?? [], search.value, selectedSoulFilterValues(stars), selectedSoulFilterValues(stateFilter), filters), sort.value, sortDirection);
    sortDirectionButton.disabled = sort.value === 'default';
    sortDirectionButton.textContent = sortDirection === 'desc' ? '↓' : '↑';
    sortDirectionButton.title = sortDirection === 'desc' ? '从高到低，点击切换为从低到高' : '从低到高，点击切换为从高到低';
    sortDirectionButton.setAttribute('aria-label', `排序方向：${sortDirection === 'desc' ? '从高到低' : '从低到高'}`);
    const active = [search.value.trim() ? `搜索：${search.value.trim()}` : '',
      ...[stars, stateFilter, ...extraSelects].flatMap(select => Array.from(select.selectedOptions).filter(option => option.value).map(option => option.textContent ?? '')),
      ...subAttributes.map(name => `副属性：${SOUL_ATTRIBUTE_LABELS[name]}`),
      ...excludedSubAttributes.map(name => `排除副属性：${SOUL_ATTRIBUTE_LABELS[name]}`)].filter(Boolean);
    filterToggle.textContent = active.length ? `筛选（${active.length}）` : '筛选';
    filterSummary.textContent = `符合 ${filtered.length.toLocaleString()} / ${(snapshot?.souls.length ?? 0).toLocaleString()} 条`;
    filterView.refresh(snapshot?.souls ?? []);
    filterReset.disabled = !active.length;
    if (!filtered.some(soul => soul.id === selectedSoul)) { detailWindow.close(); selectedSoul = filtered[0]?.id ?? ''; }
    empty.hidden = filtered.length > 0;
    empty.textContent = snapshot
      ? (snapshot.souls.length ? '没有符合筛选条件的御魂' : '此角色的背包中没有可展示的御魂')
      : (!state.selectedId ? '请选择在线或历史实例查看御魂' : state.loadingId === state.selectedId ? '正在载入上次保存的数据…' : '尚未获取此实例的御魂数据');
    grid.hidden = !filtered.length;
    virtualGrid.setItems(filtered);
    count.textContent = `${filtered.length.toLocaleString()} 条御魂`;
    renderSoulDetail(doc, detail, filtered.find(soul => soul.id === selectedSoul));
    controls();
  };
  /** 打开页面或切换实例时载入该实例上次保存的快照；已获取过的不重复读盘。 */
  const loadCached = async (instanceId: string): Promise<void> => {
    if (!instanceId || disposed) return;
    try {
      const cached = await state.load(api, instanceId);
      if (disposed || state.selectedId !== instanceId) return;
      message(cached
        ? `已载入上次保存的数据（${new Date(cached.fetchedAt).toLocaleString()}）；${state.offline ? '可离线查看和计算配装，启动模拟器并刷新实例后可重新获取。' : '点击“获取御魂”可重新读取。'}`
        : state.offline ? '此历史实例的缓存不可用，请启动模拟器后重新获取。' : '点击“获取御魂”读取此实例当前角色的背包。');
      render();
    } catch (error) { if (!disposed && state.selectedId === instanceId) { message(`缓存载入失败：${error instanceof Error ? error.message : String(error)}`, true); render(); } }
  };
  const updateInstances = async (): Promise<void> => {
    if (refreshing || state.fetchingId) return;
    refreshing = true; controls(); message('正在查找模拟器实例…');
    try {
      const instances = await api.listSoulInstances();
      if (disposed) return;
      state.setInstances(instances, state.selectedId || api.readLayout(SELECTION_KEY) || '');
      instance.replaceChildren();
      const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.textContent = '请选择实例'; instance.append(placeholder);
      for (const item of instances) {
        const option = doc.createElement('option'); option.value = item.id;
        const label = instanceLabel(item), device = item.backend === 'mumu' ? `MuMu ${item.mumuIndex ?? item.id}` : item.adbSerial ?? item.id;
        option.textContent = `${label === device ? label : `${label} · ${device}`}（${item.online ? '在线' : '历史 · 离线'}）`;
        instance.append(option);
      }
      instance.value = state.selectedId;
      message(instances.length ? '选择在线或历史实例查看已保存的御魂；在线实例可重新获取。' : '没有在线实例或已保存的御魂，请启动模拟器后刷新实例。');
    } catch (error) { if (!disposed) message(`刷新实例失败：${String(error instanceof Error ? error.message : error)}`, true); }
    finally { refreshing = false; if (!disposed) render(); }
    if (!disposed && state.selectedId) void loadCached(state.selectedId);
  };
  bind(instance, 'change', () => {
    detailWindow.close();
    state.select(instance.value); grid.parentElement!.scrollTop = 0; selectedSoul = '';
    api.writeLayout(SELECTION_KEY, state.selectedId || null);
    message(state.snapshot ? '正在显示上次读取的数据。' : '正在载入此实例保存的数据…');
    render();
    void loadCached(state.selectedId);
  });
  bind(refresh, 'click', () => { void updateInstances(); });
  bind(fetch, 'click', () => {
    if (!state.selectedId || state.fetchingId || state.offline) return;
    message('正在连接所选实例…'); progress.removeAttribute('value'); cancel.disabled = false;
    const pending = state.fetch(api); controls();
    void pending.then((result) => {
      if (disposed) return;
      message(result ? (result.failed ? `获取完成，${result.failed} 条未能读取，可重新获取。` : '获取完成，已显示所选实例的御魂背包。') : '已取消获取。');
    }).catch((error: unknown) => {
      if (!disposed) message(`获取失败：${error instanceof Error ? error.message : String(error)}`, true);
    }).finally(() => { if (!disposed) render(); });
  });
  bind(cancel, 'click', () => {
    cancel.disabled = true; message('正在取消并恢复实例连接…');
    void api.cancelSoulFetch(state.fetchingId).catch((error: unknown) => {
      if (!disposed) { message(`取消失败：${String(error)}`, true); cancel.disabled = false; }
    });
  });
  for (const input of [search, stars, stateFilter, ...extraSelects, subFilter]) bind(input, input === search ? 'input' : 'change', () => {
    grid.parentElement!.scrollTop = 0; render();
  });
  bind(sort, 'change', () => { grid.parentElement!.scrollTop = 0; render(); });
  bind(sortDirectionButton, 'click', () => {
    sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
    grid.parentElement!.scrollTop = 0; render();
  });
  bind(filterToggle, 'click', () => {
    showFilters(Boolean(filterDrawer.hidden));
  });
  bind(filterClose, 'click', () => { showFilters(false); filterToggle.focus(); });
  bind(filterReset, 'click', () => {
    search.value = '';
    const typeSearch = element<HTMLInputElement>('soul-type-search'); typeSearch.value = ''; typeSearch.dispatchEvent(new Event('input'));
    for (const select of [stars, stateFilter, ...extraSelects]) select.value = '';
    for (const input of subFilter.querySelectorAll<HTMLInputElement>('input')) input.checked = false;
    grid.parentElement!.scrollTop = 0; render();
  });
  cleanup.push(api.onSoulFetchProgress((event) => {
    if (disposed || event.instanceId !== state.fetchingId) return;
    message(event.total ? `${event.message}（${event.completed ?? 0} / ${event.total}）` : event.message);
    if (event.total) { progress.max = event.total; progress.value = event.completed ?? 0; }
    else progress.removeAttribute('value');
  }));
  void updateInstances();
  return () => {
    disposed = true;
    optimizer?.setInstanceSelectionHandler();
    for (const dispose of cleanup) dispose();
    if (state.fetchingId) void api.cancelSoulFetch(state.fetchingId).catch(() => undefined);
  };
}
