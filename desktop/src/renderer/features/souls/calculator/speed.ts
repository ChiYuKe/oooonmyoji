import { soulCatalog } from '../../../../shared/soul-catalog-data';
import type { OptimizationOptions, SearchProgress, SearchResult, SoulPlan } from '../../../../shared/soul-optimizer';
import type { SoulSnapshot, SoulRecord } from '../../../../shared/souls';
import { createSoulPositionPortrait } from '../components/position-portrait';
import { installCommunityPicker } from '../community/picker';
import { appendPickerPortrait } from '../optimizer/picker';

interface SpeedSettings { mode: 'scatter' | 'set'; suitId: number; count: 2 | 4; resultCount: number; seconds: number; unequipped: boolean }
interface StoredSpeedSettings extends SpeedSettings { schema: 1 }
interface LayoutStore { readLayout(key: string): string | null; writeLayout(key: string, value: string | null): void }
export interface SoulSpeedCalculator { update(snapshot?: SoulSnapshot): void; dispose(): void }
type WorkerFactory = () => Worker;

const STORAGE_KEY = 'onmyoji-studio.souls.speed-calculator';
const MAX_SPEED_PLANS = 100;
const suits = soulCatalog.suits;
const speedAttribute = 'speedAdditionVal';
const speedOf = (soul: SoulRecord): number => [soul.mainAttribute, ...(soul.subAttributes ?? []), ...(soul.intrinsicAttributes ?? [])]
  .reduce((sum, attribute) => sum + (attribute?.name === speedAttribute ? attribute.value : 0), 0);
const validSettings = (value: unknown): value is StoredSpeedSettings => Boolean(value) && typeof value === 'object' &&
  (value as StoredSpeedSettings).schema === 1 && ['scatter', 'set'].includes((value as StoredSpeedSettings).mode) &&
  Number.isInteger((value as StoredSpeedSettings).suitId) && [2, 4].includes((value as StoredSpeedSettings).count) &&
  Number.isInteger((value as StoredSpeedSettings).resultCount) && (value as StoredSpeedSettings).resultCount >= 1 && (value as StoredSpeedSettings).resultCount <= MAX_SPEED_PLANS &&
  Number.isFinite((value as StoredSpeedSettings).seconds) && (value as StoredSpeedSettings).seconds >= 1 && (value as StoredSpeedSettings).seconds <= 30 &&
  typeof (value as StoredSpeedSettings).unequipped === 'boolean';

/** Rank fast six-soul builds, removing every used soul before finding the next rank. */
export function installSoulSpeedCalculator(host: HTMLElement, storage: LayoutStore, createWorker: WorkerFactory): SoulSpeedCalculator {
  const doc = host.ownerDocument;
  host.replaceChildren(); host.className = 'soul-speed-calculator soul-workspace-page';
  const element = <T extends HTMLElement>(name: string): T => host.querySelector<T>(`[data-speed="${name}"]`)!;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const label = (title: string, control: HTMLElement): HTMLLabelElement => {
    const wrapper = make('label', 'soul-speed-control'); wrapper.append(make('span', '', title), control); return wrapper;
  };
  const header = make('header', 'soul-speed-heading');
  const intro = make('div'); intro.append(make('h2', '', '速度计算'), make('p', '', '从当前御魂仓库计算最快的独立配装，依次列出一速、二速、三速等方案。'));
  const headerActions = make('div', 'soul-speed-header-actions');
  const cancel = make('button', '', '停止计算'); cancel.type = 'button'; cancel.hidden = true;
  const clear = make('button', '', '清空结果'); clear.type = 'button';
  headerActions.append(cancel, clear); header.append(intro, headerActions);

  const controls = make('section', 'soul-speed-settings');
  const settingsHeading = make('div', 'soul-speed-section-heading');
  settingsHeading.append(make('h3', '', '计算条件'), make('small', '', '每套御魂独立使用'));
  const fields = make('div', 'soul-speed-fields');
  const mode = make('select'); mode.dataset.speed = 'mode'; mode.setAttribute('aria-label', '御魂类型');
  for (const [value, title] of [['scatter', '散件（不触发套装）'], ['set', '套装效果']] as const) {
    const option = make('option', '', title); option.value = value; mode.append(option);
  }
  const suit = make('select'); suit.dataset.speed = 'suit'; suit.setAttribute('aria-label', '套装'); suit.hidden = true;
  const chooseSuit = make('button', 'soul-speed-suit-trigger'); chooseSuit.type = 'button'; chooseSuit.dataset.speed = 'choose-suit'; chooseSuit.setAttribute('aria-haspopup', 'dialog');
  const suitChoice = make('span', 'soul-speed-suit-choice');
  chooseSuit.append(suitChoice, make('span', 'soul-speed-search-icon', '⌕'));
  const count = make('select'); count.dataset.speed = 'count'; count.setAttribute('aria-label', '套装件数');
  for (const [value, title] of [[4, '四件套'], [2, '两件套']] as const) { const option = make('option', '', title); option.value = String(value); count.append(option); }
  const numeric = (name: string, title: string, initial: number, max: number, unit: string): { input: HTMLInputElement; wrapper: HTMLElement; valid(): boolean; refresh(): void } => {
    const wrapper = make('div', 'soul-speed-control soul-speed-numeric');
    const heading = make('div', 'soul-speed-number-heading');
    const row = make('div', 'soul-speed-number-row');
    const input = make('input'); input.type = 'number'; input.min = '1'; input.max = String(max); input.step = '1'; input.value = String(initial); input.dataset.speed = name; input.setAttribute('aria-label', title);
    row.append(input, make('span', '', unit));
    heading.append(make('span', '', title), row);
    const track = make('div', 'soul-range-slider soul-speed-slider');
    const slider = make('input'); slider.type = 'range'; slider.min = '1'; slider.max = String(max); slider.step = '1'; slider.dataset.speed = `${name}-slider`; slider.setAttribute('aria-label', `${title}滑块`);
    track.append(make('span', 'soul-range-track'), slider);
    const scale = make('div', 'soul-speed-number-scale'); scale.append(make('span', '', `1 ${unit}`), make('span', '', `${max} ${unit}`));
    const error = make('small', 'soul-speed-number-error', `请填写 1 至 ${max} 的整数`); error.dataset.speed = `${name}-hint`; error.setAttribute('aria-live', 'polite');
    const valid = (): boolean => input.value.trim() !== '' && Number.isInteger(Number(input.value)) && Number(input.value) >= 1 && Number(input.value) <= max;
    const refresh = (): void => {
      const correct = valid(); error.hidden = correct;
      if (correct) {
        input.removeAttribute('aria-invalid'); slider.value = input.value;
        slider.setAttribute('aria-valuetext', `${input.value} ${unit}`);
        track.style.setProperty('--range-high', `${(Number(input.value) - 1) / (max - 1) * 100}%`);
      } else input.setAttribute('aria-invalid', 'true');
    };
    input.addEventListener('input', () => { refresh(); if (correctSettings()) saveSettings(); updateInventoryState(); });
    input.addEventListener('change', () => { refresh(); if (correctSettings()) saveSettings(); updateInventoryState(); });
    slider.addEventListener('input', () => { input.value = slider.value; refresh(); if (correctSettings()) saveSettings(); updateInventoryState(); });
    wrapper.append(heading, track, scale, error); refresh(); return { input, wrapper, valid, refresh };
  };
  const quantity = numeric('result-count', '计算数量', 1, MAX_SPEED_PLANS, '套'), duration = numeric('seconds', '每套搜索时长', 10, 30, '秒');
  const resultCount = quantity.input, seconds = duration.input;
  const correctSettings = (): boolean => quantity.valid() && duration.valid();
  const suitLabel = label('套装', chooseSuit), countLabel = label('件数', count); suitLabel.append(suit);
  fields.append(label('御魂类型', mode), suitLabel, countLabel);
  const tuning = make('div', 'soul-speed-tuning'); tuning.append(quantity.wrapper, duration.wrapper);
  const filterLine = make('div', 'soul-speed-options');
  const unequippedLabel = make('label'); const unequipped = make('input'); unequipped.type = 'checkbox'; unequipped.dataset.speed = 'unequipped';
  unequippedLabel.append(unequipped, doc.createTextNode('仅使用未装备御魂'));
  const hint = make('p', 'soul-speed-note', '每一套结果都会排除之前方案用过的六件御魂；套装只按御魂仓库中可量化的面板速度和两件套数值加成计算。');
  const run = make('button', 'soul-speed-run', '计算速度方案'); run.type = 'button';
  filterLine.append(unequippedLabel, run);
  controls.append(settingsHeading, fields, tuning, filterLine, hint);

  const inventory = make('p', 'soul-speed-inventory', '请先在「御魂计算」中获取御魂数据。'); inventory.dataset.speed = 'inventory';
  const status = make('p', 'soul-speed-status'); status.dataset.speed = 'status'; status.setAttribute('aria-live', 'polite');
  const progress = make('progress', 'soul-speed-progress'); progress.max = 1; progress.value = 0; progress.hidden = true;
  const results = make('div', 'soul-speed-results'); results.dataset.speed = 'results';
  const resultSection = make('section', 'soul-speed-ranking');
  const resultsHeading = make('div', 'soul-speed-section-heading');
  const resultsTitle = make('h3', '', '速度方案'); const resultTotal = make('span', 'soul-speed-total');
  resultsTitle.append(resultTotal); resultsHeading.append(resultsTitle, make('small', '', '御魂互不重复'));
  resultSection.append(resultsHeading, status, progress, results);
  host.append(header, inventory, controls, resultSection);

  let snapshot: SoulSnapshot | undefined;
  let worker: Worker | undefined;
  let running = false;
  let generation = 0;
  let plans: SoulPlan[] = [];
  let currentRank = 0;
  let anyTimeout = false;
  const readSettings = (): SpeedSettings => ({ mode: mode.value as SpeedSettings['mode'], suitId: Number(suit.value), count: Number(count.value) as 2 | 4,
    resultCount: Number(resultCount.value), seconds: Number(seconds.value), unequipped: unequipped.checked });
  const saveSettings = (): void => {
    if (!correctSettings()) return;
    try { storage.writeLayout(STORAGE_KEY, JSON.stringify({ schema: 1, ...readSettings() } satisfies StoredSpeedSettings)); } catch { /* Keep the live calculator usable if storage is unavailable. */ }
  };
  const renderSuit = (): void => {
    suitChoice.replaceChildren();
    const selected = suits.find(item => item.id === Number(suit.value));
    if (selected) appendPickerPortrait(suitChoice, 'soul', selected.id, selected.name);
    suitChoice.append(make('span', '', selected?.name ?? '选择套装'));
    chooseSuit.setAttribute('aria-label', `选择套装，当前${selected?.name ?? '未选择'}`);
  };
  const populateSuits = (): void => {
    const previous = Number(suit.value);
    const eligible = suits.filter(item => Number(count.value) === 4 || item.bonus);
    suit.replaceChildren();
    for (const item of [...eligible].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
      const option = make('option', '', item.name); option.value = String(item.id); suit.append(option);
    }
    suit.value = eligible.some(item => item.id === previous) ? String(previous) : eligible.length ? String(eligible[0].id) : '';
    renderSuit();
  };
  let preferredSuitId = 0;
  try {
    const saved: unknown = JSON.parse(storage.readLayout(STORAGE_KEY) ?? 'null');
    if (validSettings(saved)) {
      mode.value = saved.mode; count.value = String(saved.count); resultCount.value = String(saved.resultCount); seconds.value = String(Math.round(saved.seconds)); unequipped.checked = saved.unequipped;
      preferredSuitId = saved.suitId;
    }
  } catch { /* Ignore invalid local settings. */ }
  populateSuits();
  if ([...suit.options].some(option => Number(option.value) === preferredSuitId)) suit.value = String(preferredSuitId);
  renderSuit(); quantity.refresh(); duration.refresh();
  const picker = installCommunityPicker(host, {
    heroes: [], suits, hero: () => 0, suit: () => suit.value, chooseHero: () => {}, allowClear: false, ariaLabel: '选择速度计算套装',
    suitEligible: (item, kind) => kind === 'four' || !!item.bonus,
    chooseSuit: (_kind, value) => { suit.value = value; renderSuit(); saveSettings(); },
  });
  chooseSuit.addEventListener('click', () => picker.openSuit(Number(count.value) === 4 ? 'four' : 'two', chooseSuit));
  const setTypeVisibility = (): void => {
    const enabled = mode.value === 'set'; suitLabel.hidden = !enabled; countLabel.hidden = !enabled;
    controls.dataset.mode = mode.value;
  };
  setTypeVisibility();

  const updateInventoryState = (): void => {
    const available = Boolean(snapshot?.souls.length);
    inventory.textContent = snapshot
      ? `${snapshot.souls.length.toLocaleString()} 件御魂 · ${new Date(snapshot.fetchedAt).toLocaleString()}${snapshot.failed ? ` · ${snapshot.failed} 件读取失败` : ''}`
      : '请先在「御魂计算」中获取御魂数据。';
    run.disabled = running || !available || !correctSettings();
  };
  const setRunning = (value: boolean): void => {
    running = value; run.disabled = value || !snapshot?.souls.length || !correctSettings(); run.textContent = value ? `正在搜索第 ${currentRank + 1} 套…` : '计算速度方案';
    cancel.hidden = !value; cancel.disabled = false; progress.hidden = !value;
  };
  const renderPlans = (): void => {
    results.replaceChildren();
    resultTotal.textContent = plans.length ? ` · ${plans.length} 套` : '';
    for (const [index, plan] of plans.entries()) {
      const card = make('article', 'soul-speed-plan'); card.dataset.rank = String(index + 1); card.dataset.soulIds = plan.ids.join('|');
      const heading = make('header', 'soul-speed-plan-heading');
      const setName = plan.suits.map(item => `${suits.find(entry => entry.id === item.id)?.name ?? item.id} × ${item.count}`).join(' · ') || '散件';
      const identity = make('div', 'soul-speed-plan-identity');
      identity.append(make('strong', '', `${index + 1} 速`), make('small', '', setName));
      const rating = make('div', 'soul-speed-plan-rating');
      rating.append(make('small', '', '御魂速度'), make('strong', '', plan.panel.speed.toFixed(2)));
      heading.append(identity, rating);
      const gear = make('div', 'soul-speed-plan-gear');
      for (const [position, id] of plan.ids.entries()) {
        const soul = snapshot?.souls.find(item => item.id === id);
        const item = make('div', 'soul-speed-plan-soul');
        const suitName = suits.find(entry => entry.id === soul?.suitId)?.name ?? '未知套装';
        if (soul) item.append(createSoulPositionPortrait(doc, soul, true));
        const info = make('div', 'soul-speed-soul-info');
        info.append(make('small', '', `${position + 1} 号位`), make('span', '', suitName));
        item.append(info);
        if (position === 1) {
          const speeds = make('div', 'soul-speed-soul-breakdown');
          const mainSpeed = soul?.mainAttribute?.name === speedAttribute ? soul.mainAttribute.value : 0;
          const subSpeed = (soul?.subAttributes ?? []).reduce((sum, attr) => sum + (attr.name === speedAttribute ? attr.value : 0), 0);
          for (const [kind, label, value] of [['main', '主速', mainSpeed], ['sub', '副速', subSpeed]] as const) {
            const row = make('span'); row.dataset.speedPart = kind;
            const fullLabel = kind === 'main' ? '主属性速度' : '副属性速度';
            row.title = `${fullLabel} ${soul ? `+${value.toFixed(2)}` : '—'}`;
            row.setAttribute('aria-label', row.title);
            row.append(make('small', '', label), make('strong', '', soul ? `+${value.toFixed(2)}` : '—'));
            speeds.append(row);
          }
          item.append(speeds);
          item.title = `2 号位 · ${suitName} · ${[...speeds.children].map(row => (row as HTMLElement).title).join(' · ')}`;
        } else {
          item.append(make('strong', '', soul ? `+${speedOf(soul).toFixed(2)}` : '—'));
          item.title = `${position + 1} 号位 · ${suitName} · 速度 ${soul ? `+${speedOf(soul).toFixed(2)}` : '—'}`;
        }
        gear.append(item);
      }
      card.append(heading, gear); results.append(card);
    }
    if (plans.length) results.dataset.count = String(plans.length); else delete results.dataset.count;
    if (!plans.length) results.append(make('p', 'soul-speed-empty', '设置计算条件后，点击「计算速度方案」查看配装结果。'));
  };
  const finish = (message: string): void => {
    setRunning(false); worker?.terminate(); worker = undefined; progress.value = 0;
    status.textContent = message;
    if (plans.length) status.textContent += ` · 已计算 ${plans.length} 套，御魂互不重复。`;
    if (anyTimeout) status.textContent += ' 有方案达到搜索时限，相关结果可能不是全局最优。';
  };
  const startSearch = (): void => {
    if (!snapshot?.souls.length || running || !correctSettings()) return;
    const settings = readSettings();
    if (settings.mode === 'set' && !suits.some(item => item.id === settings.suitId)) { status.textContent = '请选择有效套装。'; return; }
    generation++; const token = generation; plans = []; currentRank = 0; anyTimeout = false; results.replaceChildren(); resultTotal.textContent = ''; status.textContent = '正在准备御魂数据…'; progress.value = 0;
    setRunning(true);
    const exclusions: string[] = [];
    const baseOptions: OptimizationOptions = { base: { attack: 0, hp: 0, defense: 0, speed: 0, crit: 0, critDamage: 0, hit: 0, resist: 0 },
      objective: 'speed', requirements: settings.mode === 'set' ? [{ suitId: settings.suitId, count: settings.count }] : [], distinctSuits: settings.mode === 'scatter', applySuitMechanicRanges: false,
      mainAttributes: {}, ranges: {}, onlySix: false, onlyMaxLevel: false, unequipped: settings.unequipped, excludeDiscarded: true,
      excludedIds: [], seconds: settings.seconds, limit: 1 };
    const fail = (message: string): void => { if (token !== generation) return; finish(`计算失败：${message}`); };
    const askForNext = (): void => {
      if (token !== generation || !worker || !snapshot) return;
      currentRank = plans.length;
      if (currentRank >= settings.resultCount) { finish('搜索完成。'); return; }
      worker.postMessage({ type: 'start', souls: snapshot.souls, suits, options: { ...baseOptions, excludedIds: [...exclusions] } });
    };
    try {
      worker = createWorker();
      worker.onmessage = (event: MessageEvent<{ type: string; result: SearchResult; progress: SearchProgress; message: string }>) => {
        if (token !== generation) return;
        if (event.data.type === 'error') { fail(event.data.message); return; }
        if (event.data.type === 'progress') {
          const value = event.data.progress; progress.value = Math.min(1, value.elapsed / settings.seconds);
          status.textContent = `正在计算第 ${plans.length + 1} 套 · 已检查 ${value.visited.toLocaleString()} 种组合 · ${value.elapsed.toFixed(1)} 秒`;
          return;
        }
        const result = event.data.result;
        anyTimeout ||= result.status === 'timeout';
        const plan = result.plans[0];
        if (plan) {
          plans.push(plan); exclusions.push(...plan.ids); renderPlans();
        }
        if (result.status === 'cancelled') { finish('计算已停止。'); return; }
        if (!plan) { finish(plans.length ? '没有更多不重复的配装。' : result.status === 'timeout' ? '搜索时长内没有找到配装；请增加每套搜索时长。' : '没有找到符合条件的配装；请检查套装或装备筛选。'); return; }
        if (plans.length >= settings.resultCount) { finish('搜索完成。'); return; }
        askForNext();
      };
      worker.onerror = event => fail(event.message || '速度方案搜索遇到错误。');
      askForNext();
    } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  };
  mode.addEventListener('change', () => { picker.close(); setTypeVisibility(); saveSettings(); });
  count.addEventListener('change', () => { picker.close(); populateSuits(); saveSettings(); });
  suit.addEventListener('change', () => { renderSuit(); saveSettings(); });
  unequipped.addEventListener('change', saveSettings);
  run.addEventListener('click', startSearch);
  cancel.addEventListener('click', () => { if (running) worker?.postMessage({ type: 'cancel' }); cancel.disabled = true; status.textContent = '正在停止搜索…'; });
  clear.addEventListener('click', () => { if (running) return; plans = []; renderPlans(); status.textContent = ''; });
  renderPlans(); updateInventoryState();
  return {
    update(next): void {
      if (next !== snapshot) {
        generation++; worker?.terminate(); worker = undefined; plans = []; renderPlans(); setRunning(false); snapshot = next;
        status.textContent = '';
      }
      updateInventoryState();
    },
    dispose(): void { generation++; worker?.terminate(); worker = undefined; picker.dispose(); },
  };
}
