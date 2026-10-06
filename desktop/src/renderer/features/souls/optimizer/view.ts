import { soulCatalog } from '../../../../shared/soul-catalog-data';
import { PANEL_LABELS, OPTIMIZATION_OBJECTIVES, formatPlanScore, objectiveMainAttributes, optimizeSouls, sortSoulPlans } from '../../../../shared/soul-optimizer';
import type { HeroProfile, SuitProfile, Panel, PanelKey, OptimizationObjective, OptimizationOptions, SoulPlan, SoulPlanSortKey, SearchResult, SearchProgress } from '../../../../shared/soul-optimizer';
import type { SoulSnapshot, SoulRecord } from '../../../../shared/souls';
import type { RuntimeInstance, SoulInstance } from '../../../../shared/contracts';
import { SOUL_SLOT_MAIN_ATTRIBUTES, SOUL_SLOT_DEFAULT_MAIN_ATTRIBUTES } from '../../../../shared/soul-slots';
import { createInstancePicker, instanceLabel } from '../../workflow/instance-picker';
import { createSoulPositionPortrait } from '../components/position-portrait';
import { installOptimizerPicker, appendPickerPortrait, appendHeroRarity, SUIT_ATTRIBUTES } from './picker';
import { installSoulPlanDetail } from '../components/plan-detail';
import { installSoulRangeEditor } from '../components/range-editor';
import { installSoulDetailWindow } from '../components/detail-window';
import { renderSoulDetail } from '../components/detail-render';
import type { ImageShareApi } from '../../../ui/image-share';
import { renderSoulTarget } from '../inventory/target-view';
import { installSoulTargetRange } from '../inventory/target-range';
import type { CommunityContext, SoulCommunityPanels } from '../community/view';
import type { CommunityApi } from '../../../../shared/soul-community';

const heroes: HeroProfile[] = soulCatalog.heroes;
const suits: SuitProfile[] = soulCatalog.suits;
const ATTR_LABELS: Record<string, string> = { attackAdditionRate: '攻击加成', defenseAdditionRate: '防御加成', maxHpAdditionRate: '生命加成', speedAdditionVal: '速度', critRateAdditionVal: '暴击', critPowerAdditionVal: '暴击伤害', debuffEnhance: '效果命中', debuffResist: '效果抵抗' };
const PERCENT = new Set<PanelKey>(['crit', 'critDamage', 'hit', 'resist']);
const format = (key: PanelKey, value: number): string => PERCENT.has(key) ? `${(value * 100).toFixed(2)}%` : value.toFixed(2);
interface SavedPlan { key: string; heroId: number; heroName: string; created: string; plan: SoulPlan; objective?: OptimizationOptions['objective']; base?: Panel }
interface CachedOptimizerResult {
  schema: 1;
  instanceId: string;
  fetchedAt: string;
  heroId: number;
  options: OptimizationOptions;
  result: SearchResult;
  sort: SoulPlanSortKey;
  targetPlanIndex: number;
  manualMainPositions: number[];
  excludedFavoriteKeys: string[];
  cachedAt: string;
}
export type OptimizerWorkerFactory = () => Worker;
interface OptimizerViewApi extends ImageShareApi, Partial<CommunityApi> { readLayout(key: string): string | null; writeLayout(key: string, value: string | null): void }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPanel(value: unknown): value is Panel {
  return isRecord(value) && Object.keys(PANEL_LABELS).every(key => Number.isFinite(value[key]));
}

function isCachedOptimizerResult(value: unknown, snapshot: SoulSnapshot): value is CachedOptimizerResult {
  if (!isRecord(value) || value.schema !== 1 || value.instanceId !== snapshot.instanceId || value.fetchedAt !== snapshot.fetchedAt ||
      typeof value.heroId !== 'number' || !Number.isInteger(value.heroId) || !Object.hasOwn(OPTIMIZATION_OBJECTIVES, value.options && isRecord(value.options) ? value.options.objective as string : '') ||
      !Array.isArray(value.manualMainPositions) || !value.manualMainPositions.every(position => [2, 4, 6].includes(position as number)) ||
      !Array.isArray(value.excludedFavoriteKeys) || !value.excludedFavoriteKeys.every(key => typeof key === 'string') ||
      typeof value.cachedAt !== 'string' || !['score', 'attack', 'hp', 'defense', 'speed', 'crit', 'critDamage', 'hit', 'resist'].includes(value.sort as string) ||
      typeof value.targetPlanIndex !== 'number' || !Number.isInteger(value.targetPlanIndex)) return false;
  const options = value.options as unknown as OptimizationOptions;
  const result = value.result as unknown as SearchResult;
  const inventoryIds = new Set(snapshot.souls.map(soul => soul.id));
  if (!isPanel(options.base) || !Array.isArray(options.requirements) || !options.requirements.every(requirement => Number.isInteger(requirement.suitId) && [2, 4].includes(requirement.count)) ||
      !Array.isArray(options.excludedIds) || !options.excludedIds.every(id => typeof id === 'string') ||
      !isRecord(options.mainAttributes) || !Object.values(options.mainAttributes).every(attributes => Array.isArray(attributes) && attributes.every(attribute => typeof attribute === 'string')) ||
      !isRecord(options.ranges) || !Object.values(options.ranges).every(range => range === undefined || isRecord(range) &&
        (range.min === undefined || typeof range.min === 'number' && Number.isFinite(range.min)) &&
        (range.max === undefined || typeof range.max === 'number' && Number.isFinite(range.max))) ||
      !['onlySix', 'onlyMaxLevel', 'unequipped', 'excludeDiscarded'].every(key => typeof (options as unknown as Record<string, unknown>)[key] === 'boolean') ||
      !Number.isFinite(options.seconds) || !Number.isFinite(options.limit) || !Array.isArray(result?.plans) ||
      !['complete', 'timeout', 'cancelled'].includes(result.status) || !Number.isFinite(result.elapsed) || !Number.isFinite(result.visited) ||
      !Number.isFinite(result.found) || !Number.isFinite(result.skipped) || !Array.isArray(result.candidates) ||
      !result.candidates.every(candidate => Number.isFinite(candidate)) || !result.plans.every(plan => isRecord(plan) && Array.isArray(plan.ids) &&
        plan.ids.length === 6 && plan.ids.every(id => typeof id === 'string' && inventoryIds.has(id)) &&
        isPanel(plan.panel) && Number.isFinite(plan.score) && Array.isArray(plan.suits) && plan.suits.every(suit => isRecord(suit) && Number.isFinite(suit.id) && Number.isFinite(suit.count)))) return false;
  return heroes.some(hero => hero.id === value.heroId) && value.targetPlanIndex >= 0 && value.targetPlanIndex < Math.max(1, result.plans.length);
}

export interface SoulOptimizerPanelHooks {
  /** 由停靠布局提供：把配装面板显示到前面。 */
  open?(): void;
  openCalculator?(): void;
  community?: SoulCommunityPanels;
}

export interface SoulOptimizerPanel {
  update(snapshot?: SoulSnapshot, instances?: Array<RuntimeInstance & Partial<SoulInstance>>, selectedInstanceId?: string, instancePickerDisabled?: boolean): void;
  setInstanceSelectionHandler(handler?: (instanceId: string) => void): void;
  /** 显示并聚焦面板，供「配装计算」入口调用。 */
  open(): void;
  dispose(): void;
}

export function installSoulOptimizer(host: HTMLElement, api: OptimizerViewApi, createWorker?: OptimizerWorkerFactory,
  hooks: SoulOptimizerPanelHooks = {}): SoulOptimizerPanel {
  const doc = host.ownerDocument;
  // 和「设置」「概览」一样做成可停靠面板，不再用模态弹窗盖住整个工作区。
  const panel = doc.createElement('div'); panel.className = 'soul-optimizer soul-optimizer-panel'; panel.id = 'soul-optimizer'; panel.setAttribute('aria-labelledby', 'soul-optimizer-title');
  host.append(panel);
  panel.innerHTML = `
    <header class="soul-optimizer-header"><div class="soul-optimizer-heading"><h2 id="soul-optimizer-title">御魂配装</h2><div class="soul-optimizer-instance-row"><div data-ui="instance-picker" class="instance-picker soul-instance-picker"><button type="button" class="instance-select soul-instance-select" data-action="select-instance" aria-haspopup="listbox" aria-expanded="false" aria-label="运行实例"><span data-ui="instance-label" class="instance-select-label">请选择实例</span><span class="instance-picker-chevron" aria-hidden="true"></span></button><div data-ui="instance-menu" class="instance-menu soul-instance-menu" role="listbox" hidden></div></div><p data-ui="source"></p></div></div></header>
    <div class="soul-optimizer-body">
      <section class="soul-optimizer-inventory-empty" data-ui="inventory-empty" aria-labelledby="soul-inventory-empty-title">
        <span class="soul-optimizer-inventory-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 7 9-4 9 4-9 4-9-4Z M3 7v10l9 4 9-4V7 M12 11v10"></path></svg></span>
        <h3 id="soul-inventory-empty-title">先获取御魂，再开始配装</h3>
        <p>当前实例还没有御魂数据。前往「御魂计算」，选择模拟器实例，再点击「获取御魂」。</p>
        <div class="soul-optimizer-inventory-tip">获取前，请先将游戏界面切换到「御魂仓库」。</div>
        <button type="button" data-action="open-calculator">前往御魂计算 <span aria-hidden="true">↗</span></button>
        <small>获取完成后，回到这里即可设置配装条件。</small>
      </section>
      <form data-ui="form"><details class="soul-optimizer-configuration" data-ui="configuration" open><summary><strong>配装条件</strong><span data-ui="configuration-summary"></span></summary><fieldset data-ui="settings">
        <section class="soul-optimizer-hero"><div class="soul-optimizer-hero-overview"><button type="button" data-action="choose-hero" class="soul-optimizer-selection soul-optimizer-hero-selection" aria-label="选择式神"></button><div data-ui="hero-panel" class="soul-optimizer-hero-panel"></div><select data-ui="hero" aria-label="选择式神" hidden></select></div>
        </section>
        <div class="soul-optimizer-settings-grid">
          <section class="soul-optimizer-setting-card"><div class="soul-optimizer-section-heading"><h3>御魂指定</h3><span>套装与主属性</span></div>
            <div class="soul-optimizer-suit-selections"><button type="button" data-action="choose-four" class="soul-optimizer-selection"></button><button type="button" data-action="choose-two" class="soul-optimizer-selection"></button></div>
            <select data-ui="four" aria-label="四件套" hidden></select><select data-ui="two" aria-label="两件套" hidden></select>
            <p class="soul-optimizer-hint" data-ui="suit-note"></p>
            <label class="soul-optimizer-field">效果指标<select data-ui="objective" aria-label="选择计算效果指标"></select></label><p data-ui="objective-note" class="soul-optimizer-hint"></p>
            <div data-ui="main" class="soul-optimizer-main"></div>
          </section>
          <section class="soul-optimizer-setting-card"><div class="soul-optimizer-section-heading"><h3>高级定制</h3><button type="button" data-action="add-range">添加属性限制</button></div>
            <div data-ui="ranges" class="soul-optimizer-ranges"></div>
            <button type="button" data-action="full-crit" class="soul-optimizer-text-button">暴击至少 100%</button>
            <div class="soul-optimizer-advanced-group"><span>御魂范围</span><div class="soul-optimizer-checks"><label><input type="checkbox" data-ui="unequipped">仅未装备</label><label><input type="checkbox" data-ui="kept" checked>排除已弃置</label></div></div>
            <div class="soul-optimizer-advanced-group"><span>星级与等级</span><div class="soul-optimizer-checks"><label><input type="checkbox" data-ui="six" checked>仅六星</label><label><input type="checkbox" data-ui="max" checked>仅满级</label></div></div>
            <details class="soul-optimizer-exclusions"><summary>排除已收藏方案的御魂 <span data-ui="saved-count"></span></summary><div data-ui="exclusions"></div></details>
            <div class="soul-optimizer-search-settings"><label>搜索时长<select data-ui="seconds"><option value="10">10 秒</option><option value="30" selected>30 秒</option><option value="60">60 秒</option><option value="180">3 分钟</option></select></label><label>方案数量<select data-ui="limit"><option>10</option><option selected>20</option><option>50</option></select></label></div>
          </section>
        </div>
        <p class="soul-optimizer-hint">按所选指标搜索和评分，属性限制同时生效。包含主、副、固有属性及两件套面板加成；不计技能、敌方防御和条件触发特效。计算使用完整背包，与浏览筛选独立。</p>
      </fieldset></details><div class="soul-optimizer-actions"><button type="button" data-action="reset">重置条件</button><button type="submit" data-action="start">开始计算</button><button type="button" data-action="cancel" hidden>停止计算</button><p data-ui="status" role="status" aria-live="polite">设置条件后开始计算。</p></div></form>
      <details class="soul-target-section" data-ui="target-section" aria-labelledby="soul-target-title" open><summary class="soul-target-toggle"><h3 id="soul-target-title">目标评分分析</h3></summary><div class="soul-target-content"><div class="soul-target-heading"><div class="soul-target-context"><p data-ui="target-note">选择原方案，分析达到目标所需的有效副属性。</p><label class="soul-target-source-picker">分析原方案<select data-ui="target-source" aria-label="分析原方案" disabled></select></label></div><fieldset class="soul-target-range" data-ui="target-range" aria-labelledby="soul-target-range-label"><div id="soul-target-range-label" class="soul-target-range-title">目标评分范围 <small>选填 · <span data-ui="target-unit"></span></small></div><div class="soul-range-values"><label>下限<input data-ui="target" type="number" min="0" step="any" placeholder="不限下限" aria-label="目标评分下限" aria-describedby="soul-target-range-hint"></label><span aria-hidden="true">—</span><label>上限<input data-ui="target-max" type="number" min="0" step="any" placeholder="不限上限" aria-label="目标评分上限" aria-describedby="soul-target-range-hint"></label></div><div class="soul-range-slider-row"><button type="button" data-target-adjust="minus" aria-label="减少当前端点">−</button><div class="soul-range-slider" data-ui="target-slider"><div class="soul-range-track"></div><input type="range" data-ui="target-min-slider"><input type="range" data-ui="target-max-slider"></div><button type="button" data-target-adjust="plus" aria-label="增加当前端点">+</button></div><div class="soul-range-scale"><span>0</span><span data-ui="target-scale"></span></div><p id="soul-target-range-hint" class="soul-target-range-hint">留空表示不限，输入数值可扩展滑条刻度。</p></fieldset><div data-ui="target-analysis" aria-live="polite"></div></div></div></details>
      <section class="soul-optimizer-results"><div class="soul-optimizer-result-toolbar"><div><h3>计算方案 <span data-ui="result-total"></span></h3><p data-ui="result-note"></p></div><label>当前方案排序<select data-ui="result-sort" aria-label="当前计算方案排序" disabled><option value="score">评分最高</option><option value="attack">攻击最高</option><option value="speed">速度最高</option><option value="crit">暴击最高</option><option value="critDamage">暴击伤害最高</option><option value="hp">生命最高</option><option value="defense">防御最高</option><option value="hit">效果命中最高</option><option value="resist">效果抵抗最高</option></select></label></div><div data-ui="results" class="soul-optimizer-plan-grid"><p class="soul-optimizer-empty">这里会展示符合条件的六件御魂方案。</p></div></section>
      <details class="soul-optimizer-saved"><summary>收藏方案 <span data-ui="saved-total"></span></summary><div data-ui="saved" class="soul-optimizer-plan-grid"></div></details>
    </div>`;
  const body = panel.querySelector<HTMLElement>('.soul-optimizer-body')!;
  // 面板自带的悬停详情浮窗，和「御魂计算」页各用一份，互不干扰。
  const detailWindowEl = doc.createElement('div'); detailWindowEl.id = 'soul-optimizer-detail-window'; detailWindowEl.className = 'soul-detail-window'; detailWindowEl.setAttribute('popover', 'manual'); detailWindowEl.setAttribute('role', 'tooltip');
  const detailHeader = doc.createElement('header'); detailHeader.className = 'soul-window-header'; const detailTitle = doc.createElement('strong'); detailTitle.textContent = '御魂详情'; detailHeader.append(detailTitle);
  const detail = doc.createElement('div'); detail.id = 'soul-optimizer-detail'; detail.className = 'soul-detail';
  detailWindowEl.append(detailHeader, detail); host.append(detailWindowEl);
  const detailWindow = installSoulDetailWindow(host, { id: 'soul-optimizer-detail-window', viewport: body });
  const preview = (anchor: HTMLElement, soul: SoulRecord): void => detailWindow.open(anchor, () => renderSoulDetail(doc, detail, soul));
  const closePreview = (): void => detailWindow.close();
  const el = <T extends HTMLElement>(name: string): T => panel.querySelector<T>(`[data-ui="${name}"]`)!;
  const action = (name: string): HTMLButtonElement => panel.querySelector(`[data-action="${name}"]`)!;
  const select = (name: string): HTMLSelectElement => el(name);
  const field = (name: string): HTMLInputElement => el(name);
  const optimizerInstanceLabel = (instance: RuntimeInstance): string => {
    const soulInstance = instance as RuntimeInstance & Partial<SoulInstance>;
    const name = instanceLabel(instance);
    const device = instance.backend === 'mumu' ? `MuMu ${instance.mumuIndex ?? instance.id}` : instance.adbSerial ?? instance.id;
    const namedDevice = name === device ? name : `${name} · ${device}`;
    return `${namedDevice}（${soulInstance.online === false ? '历史 · 离线' : '在线'}）`;
  };
  let instanceSelectionHandler: ((instanceId: string) => void) | undefined;
  let currentInstanceId = '';
  let closeInstanceMenu = (): void => {};
  let pickerInstances: Array<RuntimeInstance & Partial<SoulInstance>> = [];
  const instancePicker = createInstancePicker({
    picker: el<HTMLDivElement>('instance-picker'), trigger: action('select-instance'), triggerLabel: el<HTMLElement>('instance-label'), menu: el<HTMLDivElement>('instance-menu'),
  }, instanceId => { closeInstanceMenu(); instanceSelectionHandler?.(instanceId); }, {
    label: optimizerInstanceLabel, optionLabel: optimizerInstanceLabel, emptyLabel: '请选择实例', menuHeading: '请选择实例',
  });
  closeInstanceMenu = instancePicker.close;
  instancePicker.install(() => currentInstanceId);
  const appendText = (parent: HTMLElement, tag: string, text: string, className = ''): HTMLElement => { const node = doc.createElement(tag); node.textContent = text; node.className = className; parent.append(node); return node; };
  const addOption = (parent: HTMLSelectElement | HTMLOptGroupElement, value: string, text: string): void => { const option = doc.createElement('option'); option.value = value; option.textContent = text; parent.append(option); };
  for (const [value, info] of Object.entries(OPTIMIZATION_OBJECTIVES)) addOption(select('objective'), value, info.label);
  const heroSelect = select('hero');
  let snapshot: SoulSnapshot | undefined, worker: Worker | undefined, running = false, disposed = false, generation = 0;
  const renderInventoryState = (): void => {
    const hasInventory = Boolean(snapshot?.souls.length);
    panel.dataset.inventory = hasInventory ? 'ready' : 'empty';
    el('inventory-empty').hidden = hasInventory;
    action('start').disabled = running || !hasInventory;
    el<HTMLFieldSetElement>('settings').disabled = running || !hasInventory;
    action('open-calculator').disabled = !hooks.openCalculator;
  };
  action('open-calculator').addEventListener('click', () => hooks.openCalculator?.());
  let cancelled = false, selectedHero = heroes.find(hero => hero.name === '大天狗') ?? heroes[0];
  let saved: SavedPlan[] = [], results: SoulPlan[] = [];
  let lastSearchResult: SearchResult | undefined, resultExcludedFavoriteKeys: string[] = [];
  const manualMainPositions = new Set<number>();
  let ranges: OptimizationOptions['ranges'] = {};
  let resultObjective: OptimizationOptions['objective'] = 'damage', resultHero = selectedHero;
  let resultBase: Panel | undefined;
  let resultOptions: OptimizationOptions | undefined, resultStatus: SearchResult['status'] = 'complete';
  let targetTimer: ReturnType<typeof setTimeout> | undefined;
  let targetPlanIndex = 0;
  let targetSavedKey: string | undefined;
  const community = hooks.community;
  let lastCommunityContextKey: string | undefined;
  const updateCommunityContext = (context?: CommunityContext): void => {
    const key = context ? `${context.snapshotKey ?? ''}|${context.hero.id}|${context.plan.ids.join('|')}|${JSON.stringify(context.options)}` : '';
    if (key === lastCommunityContextKey) return;
    lastCommunityContextKey = key;
    community?.update(context);
  };
  const targetObjective = (): OptimizationObjective => saved.find(item => item.key === targetSavedKey)?.objective ?? resultObjective;
  const targetRange = installSoulTargetRange(el('target-range'), targetObjective,
    () => { clearTimeout(targetTimer); targetTimer = setTimeout(renderTarget, 250); },
    () => { clearTimeout(targetTimer); renderTarget(); });
  const planDetail = installSoulPlanDetail(host, suits, preview, closePreview, api);
  const picker = installOptimizerPicker(host, { heroes, suits, hero: () => selectedHero, suit: kind => select(kind).value, snapshot: () => snapshot,
    chooseHero: id => { heroSelect.value = String(id); heroSelect.dispatchEvent(new Event('change', { bubbles: true })); },
    chooseSuit: (kind, value) => { select(kind).value = value; select(kind).dispatchEvent(new Event('change', { bubbles: true })); }, closePreview });
  const rangeEditor = installSoulRangeEditor(host, () => ranges, next => { ranges = next; changed(); }, closePreview);
  const savedKey = (): string => `onmyoji-studio.souls.plans.${snapshot?.instanceId ?? ''}`;
  const selectedHeroKey = (): string => `onmyoji-studio.souls.optimizer-hero.${snapshot?.instanceId ?? ''}`;
  const resultCacheKey = (): string => `onmyoji-studio.souls.optimizer-results.${snapshot?.instanceId ?? ''}`;
  const readSelectedHero = (): HeroProfile | undefined => {
    if (!snapshot) return undefined;
    try {
      const heroId = Number(api.readLayout(selectedHeroKey()));
      return Number.isInteger(heroId) ? heroes.find(hero => hero.id === heroId) : undefined;
    } catch { return undefined; }
  };
  const persistSelectedHero = (): void => {
    if (!snapshot) return;
    try { api.writeLayout(selectedHeroKey(), String(selectedHero.id)); } catch { /* Keep current selection if local storage is unavailable. */ }
  };
  const readResultCache = (): CachedOptimizerResult | undefined => {
    if (!snapshot) return undefined;
    const key = resultCacheKey();
    try {
      const raw = api.readLayout(key);
      if (!raw) return undefined;
      const value: unknown = JSON.parse(raw);
      if (isCachedOptimizerResult(value, snapshot)) return value;
    } catch { /* Ignore damaged or outdated calculation caches. */ }
    api.writeLayout(key, null);
    return undefined;
  };
  const persistResultCache = (): void => {
    if (!snapshot || !lastSearchResult || !resultOptions) return;
    const cache: CachedOptimizerResult = {
      schema: 1, instanceId: snapshot.instanceId, fetchedAt: snapshot.fetchedAt, heroId: resultHero.id,
      options: resultOptions, result: lastSearchResult, sort: select('result-sort').value as SoulPlanSortKey,
      targetPlanIndex, manualMainPositions: [...manualMainPositions], excludedFavoriteKeys: resultExcludedFavoriteKeys,
      cachedAt: new Date().toISOString(),
    };
    try { api.writeLayout(resultCacheKey(), JSON.stringify(cache)); } catch { /* Calculation stays usable if persistence is unavailable. */ }
  };
  const clearResultCache = (): void => { if (snapshot) api.writeLayout(resultCacheKey(), null); };
  const setStatus = (text: string, error = false): void => { el('status').textContent = text; el('status').classList.toggle('error', error); };
  const populateHeroes = (): void => {
    heroSelect.replaceChildren();
    for (const hero of [...heroes].sort((a, b) => b.rarity - a.rarity || a.id - b.id)) {
      addOption(heroSelect, String(hero.id), `${({ 1: 'N', 2: 'R', 3: 'SR', 4: 'SSR', 5: 'SP', 6: 'UR' } as Record<number, string>)[hero.rarity] ?? ''} · ${hero.name}`);
    }
    heroSelect.value = String(selectedHero.id);
  };
  const applyHero = (): void => {
    const button = action('choose-hero'); button.replaceChildren(); appendPickerPortrait(button, 'hero', selectedHero.id, selectedHero.name);
    const info = appendText(button, 'span', '', 'soul-optimizer-selection-info'), meta = appendText(info, 'small', '');
    appendHeroRarity(meta, selectedHero.rarity); meta.append(` · ${selectedHero.awake ? '觉醒后' : '无需觉醒'}`); appendText(info, 'strong', selectedHero.name); appendText(info, 'small', '更换式神 ›');
    updateHeroPanel();
  };
  const updateHeroPanel = (): void => {
    el('hero-panel').replaceChildren();
    for (const key of ['attack', 'hp', 'speed', 'crit'] as const) { const item = appendText(el('hero-panel'), 'span', ''); item.dataset.panel = key; appendText(item, 'small', PANEL_LABELS[key]); appendText(item, 'strong', selectedHero.base ? format(key, selectedHero.base[key]) : '—'); }
  };
  const updateSuitSelections = (): void => {
    for (const kind of ['four', 'two'] as const) {
      const value = select(kind).value, suit = suits.find(s => String(s.id) === value);
      const name = suit?.name ?? (value.startsWith('attr:') ? SUIT_ATTRIBUTES[value.slice(5)] : '不限套装');
      const button = action(`choose-${kind}`); button.replaceChildren(); button.setAttribute('aria-label', `选择${kind === 'four' ? '四' : '两'}件套，当前${name}`);
      if (suit) appendPickerPortrait(button, 'soul', suit.id, suit.name); else appendText(button, 'span', value ? name.slice(0, 2) : '+', 'soul-picker-attribute-icon');
      const info = appendText(button, 'span', '', 'soul-optimizer-selection-info'); appendText(info, 'small', kind === 'four' ? '四件套' : '两件套'); appendText(info, 'strong', name); appendText(info, 'small', value.startsWith('attr:') ? '按加成属性选择 ›' : '选择套装 ›');
    }
    el('suit-note').textContent = suits.find(s => String(s.id) === select('four').value)?.four ?? '选择四件套与两件套，或保持不限套装。';
  };
  const updateConfigurationSummary = (): void => {
    const four = select('four'), two = select('two');
    const sets = [four.value ? `${four.selectedOptions[0].textContent}四件套` : '', two.value ? `${two.selectedOptions[0].textContent}两件套` : ''].filter(Boolean).join(' / ') || '不限套装';
    const objective = OPTIMIZATION_OBJECTIVES[select('objective').value as OptimizationOptions['objective']];
    el('configuration-summary').textContent = `${selectedHero.name} · ${sets} · ${objective.label}`;
    el('objective-note').textContent = objective.description;
    targetRange.refresh();
  };
  addOption(select('four'), '', '不限四件套'); addOption(select('two'), '', '不限两件套');
  const bonusGroup = doc.createElement('optgroup'); bonusGroup.label = '两件套属性'; select('two').append(bonusGroup);
  for (const name of new Set(suits.map(s => s.bonus?.name).filter((name): name is string => Boolean(name)))) addOption(bonusGroup, `attr:${name}`, ATTR_LABELS[name] ?? name);
  const specificGroup = doc.createElement('optgroup'); specificGroup.label = '指定套装'; select('two').append(specificGroup);
  for (const suit of [...suits].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
    if (!suit.boss) addOption(select('four'), String(suit.id), suit.name);
    addOption(specificGroup, String(suit.id), suit.name);
  }
  appendText(el('main'), 'p', '1 号位固定小攻击 · 3 号位固定小防御 · 5 号位固定小生命', 'soul-optimizer-hint');
  for (const position of [2, 4, 6]) {
    const names = SOUL_SLOT_MAIN_ATTRIBUTES[position];
    const row = doc.createElement('div'); row.className = 'soul-optimizer-main-row'; appendText(row, 'span', `${position} 号位`); const choices = doc.createElement('div');
    for (const name of names) { const label = doc.createElement('label'); const input = doc.createElement('input'); input.type = 'checkbox'; input.dataset.position = String(position); input.value = name; input.checked = SOUL_SLOT_DEFAULT_MAIN_ATTRIBUTES[position].includes(name); label.append(input, doc.createTextNode(ATTR_LABELS[name])); choices.append(label); }
    row.append(choices); el('main').append(row);
  }
  const mainInputs = (position: number): HTMLInputElement[] => [...el('main').querySelectorAll<HTMLInputElement>(`input[data-position="${position}"]`)];
  /** Objectives carry their own main attribute so 生命 builds do not keep searching 攻击加成 slots. */
  const applyObjectiveMains = (objective: OptimizationObjective): void => {
    for (const position of [2, 4, 6]) {
      if (manualMainPositions.has(position)) continue;
      const wanted = objectiveMainAttributes(objective, position);
      for (const input of mainInputs(position)) input.checked = wanted.includes(input.value);
    }
  };
  select('objective').addEventListener('change', () => { targetRange.reset(); applyObjectiveMains(select('objective').value as OptimizationObjective); changed(); });
  const renderRanges = (): void => {
    el('ranges').replaceChildren(); const keys = Object.keys(ranges) as PanelKey[];
    action('add-range').textContent = keys.length ? `已限制 ${keys.length} 项属性` : '添加属性限制';
    if (!keys.length) appendText(el('ranges'), 'p', '尚未设置属性限制', 'soul-optimizer-hint');
    for (const key of keys) {
      const range = ranges[key]!, multiplier = PERCENT.has(key) ? 100 : 1, unit = PERCENT.has(key) ? '%' : '';
      const bound = (value: number): string => `${Number((value * multiplier).toFixed(6))}${unit}`;
      const description = range.min === undefined ? `≤ ${bound(range.max!)}` : range.max === undefined ? `≥ ${bound(range.min)}` : `${bound(range.min)} – ${bound(range.max)}`;
      const row = appendText(el('ranges'), 'div', '', 'soul-optimizer-range-chip'); row.dataset.rangeKey = key;
      const edit = doc.createElement('button'); edit.type = 'button'; edit.textContent = `${PANEL_LABELS[key]} ${description}`; edit.setAttribute('aria-label', `编辑${PANEL_LABELS[key]}限制`); edit.addEventListener('click', () => rangeEditor.open(key, edit));
      const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `移除${PANEL_LABELS[key]}限制`); remove.addEventListener('click', () => { delete ranges[key]; changed(); });
      row.append(edit, remove); el('ranges').append(row);
    }
  };
  const excludedFavoriteKeys = (): string[] => [...el('exclusions').querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value);
  const options = (): OptimizationOptions => {
    if (!selectedHero.base) throw new Error('该式神缺少基础属性，请更新式神目录。');
    const base = { ...selectedHero.base };
    const requirements: OptimizationOptions['requirements'] = [];
    if (select('four').value) requirements.push({ suitId: Number(select('four').value), count: 4 });
    const two = select('two').value;
    if (two && !two.startsWith('attr:')) requirements.push({ suitId: Number(two), count: 2 });
    const mainAttributes: OptimizationOptions['mainAttributes'] = {};
    for (const position of [1, 3, 5]) mainAttributes[position] = [...SOUL_SLOT_MAIN_ATTRIBUTES[position]];
    for (const position of [2, 4, 6]) mainAttributes[position] = [...el('main').querySelectorAll<HTMLInputElement>(`input[data-position="${position}"]:checked`)].map(input => input.value);
    return { base, ranges: Object.fromEntries(Object.entries(ranges).map(([key, range]) => [key, { ...range }])), requirements, mainAttributes, objective: select('objective').value as OptimizationOptions['objective'], twoPieceAttribute: two.startsWith('attr:') ? two.slice(5) : undefined,
      onlySix: field('six').checked, onlyMaxLevel: field('max').checked, unequipped: field('unequipped').checked, excludeDiscarded: field('kept').checked,
      excludedIds: [...new Set([...el('exclusions').querySelectorAll<HTMLInputElement>('input:checked')].flatMap(input => saved.find(plan => plan.key === input.value)?.plan.ids ?? []))], seconds: Number(select('seconds').value), limit: Number(select('limit').value) };
  };
  const savedAnalysisOptions = (item: SavedPlan): OptimizationOptions | undefined => {
    const hero = heroes.find(candidate => candidate.id === item.heroId);
    const base = item.base ?? hero?.base;
    if (!base) return undefined;
    const objective = item.objective ?? resultObjective;
    const mainAttributes: OptimizationOptions['mainAttributes'] = {};
    for (const position of [1, 3, 5]) mainAttributes[position] = [...SOUL_SLOT_MAIN_ATTRIBUTES[position]];
    for (const position of [2, 4, 6]) {
      const main = snapshot?.souls.find(soul => soul.id === item.plan.ids[position - 1])?.mainAttribute?.name;
      mainAttributes[position] = main ? [main] : [...SOUL_SLOT_MAIN_ATTRIBUTES[position]];
    }
    return { base: { ...base }, objective, requirements: item.plan.suits
      .filter(set => set.count >= 2 && suits.some(suit => suit.id === set.id))
      .map(set => ({ suitId: set.id, count: set.count >= 4 ? 4 as const : 2 as const })), mainAttributes, ranges: {},
      onlySix: false, onlyMaxLevel: false, unequipped: false, excludeDiscarded: false, excludedIds: [], seconds: 30, limit: 20 };
  };
  const renderTarget = (): void => {
    const host = el('target-analysis'); host.replaceChildren(); delete host.dataset.achieved;
    el('target-note').textContent = '查看选定方案的实际副词条收益和评分差距。+15 御魂属性已固定，提升评分需要换装。';
    const selectedSaved = saved.find(item => item.key === targetSavedKey);
    if (!selectedSaved) targetSavedKey = undefined;
    const source = select('target-source'); source.replaceChildren(); source.disabled = !results.length && !selectedSaved;
    results.forEach((plan, index) => addOption(source, String(index), `方案 ${index + 1} · ${formatPlanScore(plan.score, resultObjective)}`));
    if (selectedSaved) addOption(source, `saved:${selectedSaved.key}`, `收藏 · ${selectedSaved.heroName} · ${formatPlanScore(selectedSaved.plan.score, selectedSaved.objective)}`);
    source.value = selectedSaved ? `saved:${selectedSaved.key}` : String(targetPlanIndex);
    const analysisPlan = selectedSaved?.plan ?? results[targetPlanIndex] ?? results[0];
    const analysisHero = selectedSaved ? heroes.find(hero => hero.id === selectedSaved.heroId) : resultHero;
    const analysisOptions = selectedSaved ? savedAnalysisOptions(selectedSaved) : resultOptions;
    const analysisStatus = selectedSaved ? 'complete' : resultStatus;
    const communityContext = analysisPlan && analysisHero && analysisOptions && snapshot ? { hero: analysisHero, plan: analysisPlan, inventory: snapshot.souls, options: analysisOptions, snapshotKey: `${snapshot.instanceId}|${snapshot.fetchedAt}` } : undefined;
    updateCommunityContext(communityContext);
    let target: ReturnType<typeof targetRange.read>;
    try { target = targetRange.read(); } catch (error) {
      appendText(host, 'p', error instanceof Error ? error.message : String(error), 'soul-target-error'); return;
    }
    if (!target) return;
    if (!analysisPlan || !analysisOptions || !analysisHero || !snapshot) {
      appendText(host, 'p', running ? '计算完成后会自动分析目标差距。' : '请先计算或收藏一个方案，再选择要分析的原方案。', 'soul-target-note'); return;
    }
    try {
      renderSoulTarget(host, target, analysisPlan, snapshot.souls, suits, analysisOptions, analysisStatus,
        plan => planDetail.show(plan, analysisHero, snapshot, analysisOptions.base, analysisOptions.objective, analysisOptions.ranges), analysisHero.name);
    } catch (error) { appendText(host, 'p', error instanceof Error ? error.message : String(error), 'soul-target-error'); }
  };
  const communityButton = doc.createElement('button'); communityButton.type = 'button'; communityButton.className = 'soul-target-community-button';
  communityButton.dataset.action = 'open-community'; communityButton.textContent = '社区御魂配置…';
  communityButton.disabled = !community; communityButton.setAttribute('aria-controls', 'soul-workspace-community');
  // 社区和配装在同一工作区左右对照，控制器负责显示现有面板。
  communityButton.addEventListener('click', () => { closePreview(); picker.close(); planDetail.close(); rangeEditor.close(); community?.show(communityButton); });
  el('target-note').parentElement!.append(communityButton);
  select('target-source').addEventListener('change', () => {
    const previousObjective = targetObjective();
    const value = select('target-source').value;
    if (value.startsWith('saved:')) targetSavedKey = value.slice('saved:'.length);
    else { targetSavedKey = undefined; targetPlanIndex = Number(value); }
    if (targetObjective() !== previousObjective) targetRange.reset();
    renderTarget(); persistResultCache();
  });
  const clearResults = (forgetCache = true): void => {
    results = []; lastSearchResult = undefined; resultExcludedFavoriteKeys = []; targetPlanIndex = 0;
    if (forgetCache) clearResultCache();
    el('results').replaceChildren(); el('result-note').textContent = ''; el('result-total').textContent = '';
    select('result-sort').disabled = true; action('start').textContent = '开始计算'; renderTarget();
  };
  function changed(): void { updateConfigurationSummary(); updateSuitSelections(); updateHeroPanel(); renderRanges(); if (results.length && !running) { clearResults(); setStatus('条件已更改，请重新计算。'); } else renderTarget(); }
  const setRunning = (value: boolean): void => { running = value; renderInventoryState(); action('reset').disabled = value; action('cancel').hidden = !value; action('cancel').disabled = false; for (const button of el('saved').querySelectorAll('button')) button.disabled = value; };
  const stop = (): void => { cancelled = true; worker?.postMessage({ type: 'cancel' }); };
  const persist = (): void => api.writeLayout(savedKey(), JSON.stringify(saved));
  const focusTargetAnalysis = (): void => {
    const targetSection = el<HTMLDetailsElement>('target-section');
    targetSection.open = true;
    const bodyRect = body.getBoundingClientRect();
    const sectionRect = targetSection.getBoundingClientRect();
    body.scrollTo({ top: body.scrollTop + sectionRect.top - bodyRect.top, behavior: 'smooth' });
    field('target').focus({ preventScroll: true });
  };
  const renderPlan = (parent: HTMLElement, plan: SoulPlan, label: string, onSave?: () => void, onRemove?: () => void, objective?: OptimizationOptions['objective'], alreadySaved = false, hero?: HeroProfile, base?: Panel, onAnalyze?: () => void): void => {
    const card = doc.createElement('article'); card.className = 'soul-optimizer-plan';
    card.dataset.score = String(plan.score); card.dataset.planIds = plan.ids.join('|');
    const heading = appendText(card, 'div', '', 'soul-optimizer-section-heading'); appendText(heading, 'strong', label);
    const headingActions = appendText(heading, 'div', '', 'soul-optimizer-plan-heading-actions');
    if (results.includes(plan)) {
      const upload = doc.createElement('button'); upload.type = 'button'; upload.dataset.action = 'upload-plan'; upload.textContent = '上传方案';
      upload.disabled = !community; upload.setAttribute('aria-label', `上传${label}`); upload.setAttribute('aria-controls', 'module-soul-community-upload');
      upload.addEventListener('click', () => {
        targetPlanIndex = results.indexOf(plan); renderTarget(); closePreview(); picker.close(); planDetail.close(); rangeEditor.close(); community?.show(upload, true);
      }); headingActions.append(upload);
    }
    if (onSave || onRemove) { const button = doc.createElement('button'); button.type = 'button'; button.dataset.action = onSave ? 'save-plan' : 'delete-plan'; button.textContent = onSave ? (alreadySaved ? '已收藏' : '收藏方案') : '删除'; button.disabled = alreadySaved; button.addEventListener('click', () => { (onSave ?? onRemove)!(); if (onSave) { button.disabled = true; button.textContent = '已收藏'; } }); headingActions.append(button); }
    const rating = appendText(card, 'div', '', 'soul-optimizer-plan-rating');
    appendText(rating, 'span', '评分');
    const score = formatPlanScore(plan.score, objective);
    appendText(rating, 'strong', score, 'soul-optimizer-plan-score');
    appendText(card, 'small', objective ? OPTIMIZATION_OBJECTIVES[objective].label : '原方案评分', 'soul-optimizer-plan-objective');
    const sets = appendText(card, 'div', '', 'soul-optimizer-plan-sets');
    for (const { id, count } of plan.suits) {
      const set = appendText(sets, 'span', '', 'soul-optimizer-plan-set');
      const name = suits.find(s => s.id === id)?.name ?? String(id);
      const icon = snapshot?.souls.find(soul => soul.suitId === id && soul.iconUrl)?.iconUrl;
      if (icon) { const image = doc.createElement('img'); image.src = icon; image.alt = ''; image.loading = 'lazy'; set.append(image); }
      appendText(set, 'span', `${name} × ${count}`);
    }
    if (!plan.suits.length) appendText(sets, 'span', '散件');
    const stats = appendText(card, 'div', '', 'soul-optimizer-plan-stats');
    for (const key of ['attack', 'speed', 'crit', 'critDamage', 'hp', 'defense', 'hit', 'resist'] as const) { const stat = appendText(stats, 'span', ''); stat.dataset.panel = key; appendText(stat, 'small', PANEL_LABELS[key]); appendText(stat, 'strong', format(key, plan.panel[key])); }
    const planRanges=results.includes(plan)?resultOptions?.ranges:undefined;
    const actions = appendText(card, 'div', '', 'soul-optimizer-plan-actions');
    const view = doc.createElement('button'); view.type = 'button'; view.dataset.action = 'view-plan'; view.className = 'soul-plan-view-button'; view.textContent = '查看配装详情 ↗'; view.addEventListener('click', () => planDetail.show(plan, hero, snapshot, base, objective,planRanges)); actions.append(view);
    if (results.includes(plan) || onAnalyze) {
      const analyze = doc.createElement('button'); analyze.type = 'button'; analyze.dataset.action = 'analyze-plan'; analyze.textContent = '分析当前方案';
      analyze.addEventListener('click', () => {
        if (onAnalyze) onAnalyze();
        else { targetSavedKey = undefined; targetPlanIndex = results.indexOf(plan); }
        renderTarget();
        focusTargetAnalysis();
        persistResultCache();
      }); actions.append(analyze);
    }
    const details = doc.createElement('details'); details.className = 'soul-optimizer-plan-details'; appendText(details, 'summary', '查看六件御魂'); card.append(details);
    const list = appendText(details, 'div', '', 'soul-optimizer-plan-souls');
    for (const [index, id] of plan.ids.entries()) {
      const soul = snapshot?.souls.find(s => s.id === id); const button = doc.createElement('button'); button.type = 'button'; button.dataset.soulId = id;
      appendText(button, 'small', `${index + 1} 号位${soul ? ` · +${soul.level}` : ''}`);
      if (soul) button.append(createSoulPositionPortrait(doc, soul, true));
      appendText(button, 'span', soul?.name ?? '御魂已不在当前背包');
      appendText(button, 'small', soul?.mainAttribute ? `${soul.mainAttribute.label} +${soul.mainAttribute.percent ? (soul.mainAttribute.value * 100).toFixed(2) + '%' : soul.mainAttribute.value.toFixed(2)}` : id);
      if (soul) {
        button.addEventListener('pointerenter', () => preview(button, soul)); button.addEventListener('pointerleave', closePreview);
        button.addEventListener('focus', () => preview(button, soul)); button.addEventListener('blur', closePreview);
      }
      list.append(button);
    }
    parent.append(card);
  };
  const syncResultFavorites = (): void => {
    const savedIds = new Set(saved.filter(item => item.heroId === resultHero.id).map(item => item.plan.ids.join('|')));
    for (const card of el('results').querySelectorAll<HTMLElement>('.soul-optimizer-plan')) {
      const button = card.querySelector<HTMLButtonElement>('[data-action="save-plan"]');
      if (!button) continue;
      const alreadySaved = savedIds.has(card.dataset.planIds ?? '');
      button.disabled = running || alreadySaved;
      button.textContent = alreadySaved ? '已收藏' : '收藏方案';
    }
  };
  const renderSaved = (): void => {
    const excluded = new Set([...el('exclusions').querySelectorAll<HTMLInputElement>('input:checked')].map(i => i.value));
    el('exclusions').replaceChildren(); el('saved').replaceChildren(); el('saved-count').textContent = `${saved.length}`; el('saved-total').textContent = `${saved.length}`;
    if (!saved.length) { appendText(el('exclusions'), 'p', '收藏方案后，可在这里选择要排除的御魂。', 'soul-optimizer-hint'); return; }
    for (const item of saved) {
      const label = doc.createElement('label'); const input = doc.createElement('input'); input.type = 'checkbox'; input.value = item.key; input.checked = excluded.has(item.key); label.append(input, doc.createTextNode(`${item.heroName} · ${new Date(item.created).toLocaleString()}`)); el('exclusions').append(label);
      renderPlan(el('saved'), item.plan, item.heroName, undefined, () => {
        if (running) return;
        const wasExcluded = [...el('exclusions').querySelectorAll<HTMLInputElement>('input:checked')].some(input => input.value === item.key);
        if (targetSavedKey === item.key) { targetSavedKey = undefined; targetRange.reset(); }
        saved = saved.filter(p => p.key !== item.key); persist(); renderSaved(); syncResultFavorites();
        renderTarget();
        // Keep the completed search and analysis as a snapshot. Removed exclusions affect the next search.
        if (wasExcluded) setStatus('收藏已删除，已取消该方案的御魂排除；当前结果已保留，下次计算生效。');
      }, item.objective, false, heroes.find(hero => hero.id === item.heroId), item.base, () => {
        const previousObjective = targetObjective();
        targetSavedKey = item.key;
        if (targetObjective() !== previousObjective) targetRange.reset();
      });
    }
  };
  const renderResults = (): void => {
    closePreview(); el('results').replaceChildren();
    for (const [index, plan] of sortSoulPlans(results, select('result-sort').value as SoulPlanSortKey).entries()) {
      const alreadySaved = saved.some(item => item.heroId === resultHero.id && item.plan.ids.join('|') === plan.ids.join('|'));
      renderPlan(el('results'), plan, `方案 ${index + 1}`, () => {
        if (saved.some(item => item.heroId === resultHero.id && item.plan.ids.join('|') === plan.ids.join('|'))) return;
        saved.push({ key: crypto.randomUUID(), heroId: resultHero.id, heroName: resultHero.name, created: new Date().toISOString(), plan, objective: resultObjective, base: resultBase }); persist(); renderSaved();
      }, undefined, resultObjective, alreadySaved, resultHero, resultBase);
    }
  };
  const presentResult = (result: SearchResult, restoredAt?: string): void => {
    results = result.plans; resultStatus = result.status; renderTarget();
    const phase = { complete: '搜索完成', timeout: '已到搜索时限，尚未完成全部搜索', cancelled: '已停止，尚未完成全部搜索' }[result.status];
    setStatus(restoredAt
      ? `已恢复上次结果 · ${result.plans.length} 个方案 · ${new Date(restoredAt).toLocaleString()}`
      : `${phase} · ${result.elapsed.toFixed(1)} 秒 · ${result.plans.length} 个方案${result.skipped ? ` · ${result.skipped} 条属性不完整或套装未知的御魂未参与` : ''}`);
    el('result-note').textContent = result.status === 'complete' ? (restoredAt ? '上次搜索的最优方案' : '符合条件的最优方案') : '当前找到的方案 · 可增加时长重新计算';
    el('result-total').textContent = result.plans.length ? `· ${result.plans.length} 个` : '';
    select('result-sort').disabled = !result.plans.length;
    el('results').replaceChildren();
    if (!result.plans.length) appendText(el('results'), 'p', result.candidates.some(n => n === 0) ? `部分位置没有可用御魂：${result.candidates.map((n, i) => `${i + 1} 号位 ${n} 件`).join(' · ')}。请调整主属性、使用范围或等级限制。` : result.status === 'complete' ? '没有符合条件的组合，请调整套装或属性限制。' : '在此次搜索内还没有找到符合条件的组合。可放宽条件或增加时长。', 'soul-optimizer-empty');
    if (results.length) {
      renderResults(); el<HTMLDetailsElement>('configuration').open = false; action('start').textContent = '重新计算';
      body.scrollTop = 0;
    }
  };
  const restoreResultCache = (cache: CachedOptimizerResult): void => {
    const hero = heroes.find(item => item.id === cache.heroId);
    if (!hero) return;
    const config = cache.options;
    selectedHero = hero; heroSelect.value = String(hero.id);
    select('objective').value = config.objective;
    select('four').value = String(config.requirements.find(item => item.count === 4)?.suitId ?? '');
    select('two').value = config.twoPieceAttribute ? `attr:${config.twoPieceAttribute}` : String(config.requirements.find(item => item.count === 2)?.suitId ?? '');
    for (const position of [2, 4, 6]) {
      const selected = new Set(config.mainAttributes[position] ?? []);
      for (const input of mainInputs(position)) input.checked = selected.has(input.value);
    }
    ranges = Object.fromEntries(Object.entries(config.ranges).map(([key, range]) => [key, range ? { ...range } : range]));
    manualMainPositions.clear(); cache.manualMainPositions.forEach(position => manualMainPositions.add(position));
    field('six').checked = config.onlySix; field('max').checked = config.onlyMaxLevel;
    field('unequipped').checked = config.unequipped; field('kept').checked = config.excludeDiscarded;
    select('seconds').value = String(config.seconds); select('limit').value = String(config.limit);
    updateConfigurationSummary(); updateSuitSelections(); updateHeroPanel(); renderRanges();
    const excluded = new Set(cache.excludedFavoriteKeys);
    for (const input of el('exclusions').querySelectorAll<HTMLInputElement>('input')) input.checked = excluded.has(input.value);
    resultHero = hero; resultBase = { ...config.base }; resultObjective = config.objective;
    resultOptions = config; resultStatus = cache.result.status; results = cache.result.plans;
    lastSearchResult = cache.result; resultExcludedFavoriteKeys = cache.excludedFavoriteKeys;
    targetPlanIndex = Math.min(cache.targetPlanIndex, Math.max(0, results.length - 1));
    select('result-sort').value = cache.sort;
    presentResult(cache.result, cache.cachedAt);
  };
  const progress = (value: SearchProgress): void => setStatus(`正在搜索 · ${value.elapsed.toFixed(1)} 秒 · 已检查 ${value.visited.toLocaleString()} 个节点 · 找到 ${value.found.toLocaleString()} 个可行组合`);
  const finish = (result: SearchResult): void => {
    setRunning(false); worker?.terminate(); worker = undefined;
    lastSearchResult = result;
    presentResult(result);
    persistResultCache();
  };
  const start = (): void => {
    if (!snapshot?.souls.length || running) return;
    let config: OptimizationOptions;
    try { config = options(); } catch (error) { setStatus(String(error instanceof Error ? error.message : error), true); return; }
    const excludedKeys = excludedFavoriteKeys();
    resultHero = selectedHero; resultBase = { ...config.base }; resultObjective = config.objective; resultOptions = config; updateConfigurationSummary();
    const token = ++generation; cancelled = false; closePreview(); setRunning(true); setStatus('正在准备御魂组合…');
    clearResults();
    resultExcludedFavoriteKeys = excludedKeys;
    const failed = (message: string): void => { if (token !== generation || disposed) return; setRunning(false); worker?.terminate(); worker = undefined; renderTarget(); setStatus(`计算失败：${message}`, true); };
    if (createWorker) {
      try {
        worker = createWorker();
        worker.onmessage = (event: MessageEvent<{ type: string; result: SearchResult; progress: SearchProgress; message: string }>) => {
          if (token !== generation || disposed) return;
          if (event.data.type === 'result') finish(event.data.result); else if (event.data.type === 'progress') progress(event.data.progress); else failed(event.data.message);
        };
        worker.onerror = event => failed(event.message);
        worker.postMessage({ type: 'start', souls: snapshot.souls, suits, options: config });
      } catch (error) { failed(String(error)); }
    } else {
      void optimizeSouls(snapshot.souls, suits, config, value => { if (token === generation) progress(value); }, () => cancelled || token !== generation || disposed)
        .then(result => { if (token === generation && !disposed) finish(result); }).catch(error => failed(String(error)));
    }
  };
  const reset = (): void => {
    if (running) return;
    select('four').value = ''; select('two').value = ''; select('objective').value = 'damage'; select('seconds').value = '30'; select('limit').value = '20';
    manualMainPositions.clear();
    targetRange.reset(); renderTarget();
    field('six').checked = true; field('max').checked = true; field('unequipped').checked = false; field('kept').checked = true; ranges = {};
    for (const input of el('main').querySelectorAll<HTMLInputElement>('input')) input.checked = SOUL_SLOT_DEFAULT_MAIN_ATTRIBUTES[Number(input.dataset.position)]?.includes(input.value) ?? false;
    for (const input of el('exclusions').querySelectorAll<HTMLInputElement>('input')) input.checked = false;
    applyHero(); changed(); setStatus('条件已重置。');
    el<HTMLDetailsElement>('configuration').open = true;
  };
  panel.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); start(); });
  action('cancel').addEventListener('click', () => { stop(); action('cancel').disabled = true; setStatus('正在停止搜索，保留已找到的方案…'); });
  action('reset').addEventListener('click', reset);
  action('add-range').addEventListener('click', () => rangeEditor.open('crit', action('add-range')));
  action('full-crit').addEventListener('click', () => { const max = ranges.crit?.max; ranges.crit = { min: 1, max: max !== undefined && max >= 1 ? max : undefined }; changed(); });
  action('choose-hero').addEventListener('click', picker.openHero);
  action('choose-four').addEventListener('click', () => picker.openSuit('four'));
  action('choose-two').addEventListener('click', () => picker.openSuit('two'));
  heroSelect.addEventListener('change', () => {
    selectedHero = heroes.find(hero => hero.id === Number(heroSelect.value))!;
    applyHero(); persistSelectedHero(); changed();
    if (!results.length) clearResultCache();
  });
  el('form').addEventListener('change', event => {
    if (event.target === select('objective')) return;
    if (event.target instanceof doc.defaultView!.HTMLInputElement && event.target.dataset.position) manualMainPositions.add(Number(event.target.dataset.position));
    changed(); const chosen = suits.find(s => s.id === Number(select('four').value));
    el('suit-note').textContent = chosen?.four ?? '主属性可多选，同一位置满足任意选项；未选表示不限。';
  });
  el('form').addEventListener('input', changed);
  el('saved').addEventListener('change', changed);
  select('result-sort').addEventListener('change', () => { renderResults(); persistResultCache(); });
  body.addEventListener('scroll', closePreview, { passive: true });
  populateHeroes(); applyHero(); renderSaved(); updateConfigurationSummary(); updateSuitSelections(); renderRanges(); renderTarget();
  renderInventoryState();
  // 面板可能被用户收起或直接关掉：停靠视图会把模块元素挪回隐藏的模块仓库，
  // 模态选择器若仍开着就会悬在页面顶层，所以面板不可见时先把它们收掉。
  const visibility = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) { instancePicker.close(); picker.close(); planDetail.close(); rangeEditor.close(); }
  });
  visibility.observe(host);
  const open = (): void => {
    hooks.open?.();
    action(snapshot?.souls.length ? 'start' : 'open-calculator').focus();
  };
  return {
    update(next, instances = [], selectedInstanceId = '', instancePickerDisabled = false): void {
      currentInstanceId = selectedInstanceId;
      if (instances !== pickerInstances) {
        pickerInstances = instances;
        instancePicker.render(pickerInstances, selectedInstanceId, instancePickerDisabled);
      } else instancePicker.update(pickerInstances, selectedInstanceId, instancePickerDisabled);
      if (next !== snapshot) {
        generation++; stop(); picker.close(); planDetail.close(); rangeEditor.close(); worker?.terminate(); worker = undefined; setRunning(false); snapshot = next; results = []; saved = [];
        selectedHero = heroes.find(hero => hero.name === '大天狗') ?? heroes[0];
        const preferredHero = readSelectedHero();
        if (preferredHero) selectedHero = preferredHero;
        heroSelect.value = String(selectedHero.id); applyHero();
        clearResults(false); el<HTMLDetailsElement>('configuration').open = true;
        if (snapshot) {
          try {
            const data: unknown = JSON.parse(api.readLayout(savedKey()) ?? '[]');
            if (Array.isArray(data)) saved = data.filter((item): item is SavedPlan => item && typeof item.key === 'string' && typeof item.heroName === 'string' && Number.isInteger(item.heroId) && typeof item.created === 'string' && item.plan?.ids?.length === 6 && item.plan.ids.every((id: unknown) => typeof id === 'string') && Object.keys(PANEL_LABELS).every(key => Number.isFinite(item.plan.panel?.[key])) && Array.isArray(item.plan.suits)).slice(0, 100).map(item => ({ ...item,
              base: item.base && Object.keys(PANEL_LABELS).every(key => Number.isFinite(item.base?.[key as PanelKey])) ? item.base : undefined,
              objective: item.objective && Object.hasOwn(OPTIMIZATION_OBJECTIVES, item.objective) ? item.objective : undefined }));
          } catch { /* Ignore damaged local favorites instead of preventing calculation. */ }
        }
        renderSaved(); updateConfigurationSummary(); updateSuitSelections(); updateHeroPanel();
        const cachedResult = readResultCache();
        if (cachedResult && (!preferredHero || cachedResult.heroId === preferredHero.id)) {
          restoreResultCache(cachedResult);
          persistSelectedHero();
        } else {
          if (cachedResult) clearResultCache();
          setStatus(snapshot?.souls.length ? '设置条件后开始计算。' : '请先获取御魂数据。');
        }
      }
      renderInventoryState();
      el('source').textContent = snapshot
        ? `${snapshot.souls.length.toLocaleString()} 件御魂 · ${new Date(snapshot.fetchedAt).toLocaleString()}`
        : selectedInstanceId ? '尚未载入此实例的御魂数据。' : '选择实例后载入御魂数据。';
    },
    setInstanceSelectionHandler(handler): void { instanceSelectionHandler = handler; },
    open,
    dispose(): void { disposed = true; generation++; clearTimeout(targetTimer); stop(); worker?.terminate(); instancePicker.dispose(); picker.dispose(); planDetail.dispose(); rangeEditor.dispose(); visibility.disconnect(); detailWindow.dispose(); panel.remove(); },
  };
}
