import type { OnmyojiDesktopApi, RuntimeInstance } from '../shared/contracts';
import type { SoulRecord, SoulSnapshot, SoulAttribute } from '../shared/souls';
import { instanceLabel } from './instance-picker';

const SELECTION_KEY = 'onmyoji-studio.souls.instance';
const PAGE_SIZE = 100;
type SoulApi = Pick<OnmyojiDesktopApi, 'listInstances' | 'fetchSouls' | 'cancelSoulFetch' | 'onSoulFetchProgress' | 'readLayout' | 'writeLayout'>;

/** Snapshot ownership stays with the instance, independent of workflow selection. */
export class SoulCalculatorState {
  instances: RuntimeInstance[] = [];
  selectedId = '';
  fetchingId = '';
  snapshots = new Map<string, SoulSnapshot>();

  setInstances(instances: RuntimeInstance[], preferred = this.selectedId): void {
    this.instances = instances;
    this.selectedId = instances.some((item) => item.id === preferred) ? preferred : '';
  }
  select(id: string): void {
    if (this.fetchingId) return;
    this.selectedId = this.instances.some((item) => item.id === id) ? id : '';
  }
  get snapshot(): SoulSnapshot | undefined { return this.snapshots.get(this.selectedId); }
  async fetch(api: Pick<SoulApi, 'fetchSouls'>): Promise<SoulSnapshot | null> {
    if (!this.selectedId || this.fetchingId) throw new Error('请选择实例，并等待当前获取完成');
    const id = this.selectedId;
    this.fetchingId = id;
    try {
      const result = await api.fetchSouls(id);
      if (result) {
        if (result.instanceId !== id) throw new Error('返回数据与所选实例不一致，请重新获取');
        this.snapshots.set(id, result);
      }
      return result;
    } finally { this.fetchingId = ''; }
  }
}

export function filterSouls(souls: SoulRecord[], query: string, stars: string, status: string): SoulRecord[] {
  const term = query.trim().toLowerCase();
  return souls.filter((soul) => (!term || soul.id.toLowerCase().includes(term) || String(soul.suitId ?? '').includes(term) || (soul.name ?? '').toLowerCase().includes(term))
    && (!stars || soul.stars === Number(stars))
    && (!status || (status === 'locked' && soul.locked) || (status === 'equipped' && soul.equipped) || (status === 'discarded' && soul.discarded)));
}

export function formatSoulAttribute(attr: SoulAttribute): string {
  return `${attr.label} +${(attr.value * (attr.percent ? 100 : 1)).toFixed(2)}${attr.percent ? '%' : ''}`;
}

export function installSoulCalculator(root: HTMLElement, api: SoulApi): () => void {
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
  const stars = element<HTMLSelectElement>('soul-stars');
  const stateFilter = element<HTMLSelectElement>('soul-state');
  const rows = element<HTMLTableSectionElement>('soul-rows');
  const table = element<HTMLTableElement>('soul-table');
  const empty = element<HTMLDivElement>('soul-empty');
  const pageInfo = element<HTMLSpanElement>('soul-page-info');
  const prev = element<HTMLButtonElement>('soul-prev');
  const next = element<HTMLButtonElement>('soul-next');
  const detail = element<HTMLElement>('soul-detail');
  const state = new SoulCalculatorState();
  const cleanup: Array<() => void> = [];
  let disposed = false;
  let refreshing = false;
  let page = 0;
  let selectedSoul = '';
  const bind = (el: HTMLElement, event: string, handler: EventListener): void => {
    el.addEventListener(event, handler); cleanup.push(() => el.removeEventListener(event, handler));
  };
  const message = (text: string, error = false): void => {
    status.textContent = text; status.classList.toggle('error', error);
  };
  const controls = (): void => {
    const busy = Boolean(state.fetchingId);
    instance.disabled = refreshing || busy;
    refresh.disabled = refreshing || busy;
    fetch.disabled = refreshing || busy || !state.selectedId;
    fetch.textContent = busy ? '正在获取…' : '获取御魂';
    cancel.hidden = !busy;
    progress.hidden = !busy;
    root.setAttribute('aria-busy', String(busy));
  };
  const render = (): void => {
    const snapshot = state.snapshot;
    const name = state.instances.find((item) => item.id === state.selectedId);
    summary.textContent = snapshot
      ? `${name ? instanceLabel(name) : snapshot.instanceId} · 已获取 ${snapshot.souls.length.toLocaleString()} 条 / 背包 ${snapshot.total.toLocaleString()} 条 · ${new Date(snapshot.fetchedAt).toLocaleString()}${snapshot.failed ? ` · ${snapshot.failed} 条读取失败，可重新获取` : ''}`
      : '';
    const filtered = filterSouls(snapshot?.souls ?? [], search.value, stars.value, stateFilter.value);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.max(0, Math.min(page, pages - 1));
    rows.replaceChildren();
    if (!filtered.some((soul) => soul.id === selectedSoul)) selectedSoul = filtered[0]?.id ?? '';
    const add = (parent: HTMLElement, tag: string, text: string, className = ''): HTMLElement => {
      const item = doc.createElement(tag); item.textContent = text; item.className = className; parent.append(item); return item;
    };
    const icon = (parent: HTMLElement, soul: SoulRecord): void => {
      if (soul.iconUrl) {
        const image = doc.createElement('img'); image.src = soul.iconUrl; image.alt = soul.name ?? '御魂'; image.className = 'soul-icon'; parent.append(image);
      } else add(parent, 'span', (soul.name ?? '御魂').slice(0, 1), 'soul-icon-placeholder');
    };
    for (const soul of filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const tr = doc.createElement('tr');
      tr.classList.toggle('selected', soul.id === selectedSoul);
      const identity = doc.createElement('td');
      const select = doc.createElement('button'); select.type = 'button'; select.className = 'soul-row-select';
      select.setAttribute('aria-label', `查看${soul.name ?? soul.suitId}的详细属性`);
      icon(select, soul); add(select, 'span', soul.name ?? String(soul.suitId ?? '—'));
      select.addEventListener('click', () => { selectedSoul = soul.id; render(); }); identity.append(select); tr.append(identity);
      const labels = [soul.locked ? '已锁定' : '', soul.equipped ? '已装备' : '', soul.discarded ? '已弃置' : ''].filter(Boolean);
      const subs = soul.subAttributes?.map(formatSoulAttribute).join('\n') ?? '待解析';
      for (const value of [soul.position ? `${soul.position} 号位` : '—', soul.stars ? `${soul.stars} 星` : '—', soul.level === null ? '—' : `+${soul.level}`, soul.mainAttribute ? formatSoulAttribute(soul.mainAttribute) : '待解析', subs || '—', labels.join(' · ') || '—', soul.id]) {
        const td = doc.createElement('td'); td.textContent = String(value); td.title = String(value); tr.append(td);
      }
      rows.append(tr);
    }
    empty.hidden = filtered.length > 0;
    empty.textContent = snapshot ? (snapshot.souls.length ? '没有符合筛选条件的御魂' : '此角色的背包中没有可展示的御魂') : '尚未获取此实例的御魂数据';
    table.hidden = !filtered.length;
    pageInfo.textContent = filtered.length ? `${filtered.length.toLocaleString()} 条 · 第 ${page + 1} / ${pages} 页` : '0 条御魂';
    prev.disabled = page === 0; next.disabled = page >= pages - 1;
    detail.replaceChildren();
    const selected = filtered.find((soul) => soul.id === selectedSoul);
    if (selected) {
      const head = add(detail, 'div', '', 'soul-detail-head'); icon(head, selected);
      add(head, 'h3', selected.name ?? `套装 ${selected.suitId}`);
      add(detail, 'p', `${selected.position ?? '—'} 号位 · ${selected.stars ?? '—'} 星 · +${selected.level ?? '—'}`);
      add(detail, 'p', [selected.equipped ? '已装备' : '未装备', selected.locked ? '已锁定' : '未锁定', selected.discarded ? '已弃置' : ''].filter(Boolean).join(' · '));
      add(detail, 'div', selected.mainAttribute ? formatSoulAttribute(selected.mainAttribute) : '主属性待解析', 'soul-main-attribute');
      for (const attr of selected.subAttributes ?? []) {
        add(detail, 'div', formatSoulAttribute(attr) + (attr.rolls > 1 ? ` · 强化 ${attr.rolls - 1} 次` : ''), 'soul-sub-attribute');
      }
      if (!selected.attributesComplete) add(detail, 'p', '部分副属性配置尚未加载，数值待解析。', 'soul-note');
      for (const attr of selected.intrinsicAttributes ?? []) add(detail, 'div', `固有属性：${formatSoulAttribute(attr)}`, 'soul-sub-attribute');
      for (const effect of selected.setEffects ?? []) add(detail, 'p', effect, 'soul-set-effect');
      add(detail, 'p', `套装编号 ${selected.suitId} · ${selected.id}`, 'soul-detail-id');
      if (!selected.iconUrl) add(detail, 'p', `图标资源：${selected.iconKey ?? '未解析'}（图片待解包）`, 'soul-detail-id');
    } else add(detail, 'p', '选择一条御魂查看详情');
    controls();
  };
  const updateInstances = async (): Promise<void> => {
    if (refreshing || state.fetchingId) return;
    refreshing = true; controls(); message('正在查找模拟器实例…');
    try {
      const instances = await api.listInstances();
      if (disposed) return;
      state.setInstances(instances, state.selectedId || api.readLayout(SELECTION_KEY) || '');
      instance.replaceChildren();
      const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.textContent = '请选择实例'; instance.append(placeholder);
      for (const item of instances) {
        const option = doc.createElement('option'); option.value = item.id;
        option.textContent = `${instanceLabel(item)}${item.backend === 'mumu' ? ` · MuMu ${item.mumuIndex ?? item.id}` : ` · ${item.adbSerial ?? item.id}`}`;
        instance.append(option);
      }
      instance.value = state.selectedId;
      message(instances.length ? '选择实例后，点击“获取御魂”读取当前角色的背包。' : '没有检测到实例，请先启动模拟器，再刷新实例。');
    } catch (error) { if (!disposed) message(`刷新实例失败：${String(error instanceof Error ? error.message : error)}`, true); }
    finally { refreshing = false; if (!disposed) render(); }
  };
  bind(instance, 'change', () => {
    state.select(instance.value); page = 0; selectedSoul = '';
    api.writeLayout(SELECTION_KEY, state.selectedId || null);
    message(state.snapshot ? '正在显示上次获取的数据；点击“获取御魂”可重新读取。' : '点击“获取御魂”读取此实例当前角色的背包。');
    render();
  });
  bind(refresh, 'click', () => { void updateInstances(); });
  bind(fetch, 'click', () => {
    if (!state.selectedId || state.fetchingId) return;
    message('正在连接所选实例…'); progress.removeAttribute('value'); cancel.disabled = false;
    const pending = state.fetch(api); controls();
    void pending.then((result) => {
      if (disposed) return;
      page = 0;
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
  for (const input of [search, stars, stateFilter]) bind(input, input === search ? 'input' : 'change', () => { page = 0; render(); });
  bind(prev, 'click', () => { page--; render(); });
  bind(next, 'click', () => { page++; render(); });
  cleanup.push(api.onSoulFetchProgress((event) => {
    if (disposed || event.instanceId !== state.fetchingId) return;
    message(event.total ? `${event.message}（${event.completed ?? 0} / ${event.total}）` : event.message);
    if (event.total) { progress.max = event.total; progress.value = event.completed ?? 0; }
    else progress.removeAttribute('value');
  }));
  void updateInstances();
  return () => {
    disposed = true;
    for (const dispose of cleanup) dispose();
    if (state.fetchingId) void api.cancelSoulFetch(state.fetchingId).catch(() => undefined);
  };
}
