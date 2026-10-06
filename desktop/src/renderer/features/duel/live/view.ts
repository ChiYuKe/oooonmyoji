import { soulCatalog } from '../../../../shared/soul-catalog-data';
import { heroSkillsCatalog } from '../../../../shared/hero-skills-data';
import { inferDuelSkill } from '../../../../shared/duel-skill-inference';
import type { HeroProfile, Panel, PanelKey, SuitProfile } from '../../../../shared/soul-optimizer';
import { PANEL_LABELS } from '../../../../shared/soul-optimizer';
import { createDuelFighter, createDuelId, createDuelMatch, exportDuelDataset, loadDuelDataset, snapshotDuelFighter, type DuelActionRecord, type DuelDatasetStore, type DuelFighterRecord, type DuelSide, type DuelMatchRecord, type DuelSummonRecord } from '../../../../shared/duel-live-data';
import { installCommunityPicker } from '../../souls/community/picker';
import { appendPickerPortrait } from '../../souls/optimizer/picker';

type Side = DuelSide;
type LiveAction = DuelActionRecord;
type LiveFighter = DuelFighterRecord;
const KEY = 'onmyoji-studio.duel-live.v1';
const heroes = soulCatalog.heroes as HeroProfile[];
const suits = (soulCatalog.suits as SuitProfile[]).filter(suit => !suit.boss);
const fields: PanelKey[] = ['attack', 'hp', 'defense', 'speed', 'crit', 'critDamage', 'hit', 'resist'];
const percentages = new Set<PanelKey>(['crit', 'critDamage', 'hit', 'resist']);
const blankPanel = (): Panel => ({ hp: 0, attack: 0, defense: 0, speed: 0, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
const blankFighter = (side: Side, slot: number): LiveFighter => createDuelFighter(side, slot);
const stateFromHero = (hero: HeroProfile | undefined, side: Side, slot: number): LiveFighter => createDuelFighter(side, slot, hero);
const panelValue = (field: PanelKey, value: number): string => String(Number((percentages.has(field) ? value * 100 : value).toFixed(2)));
const sideName: Record<Side, string> = { blue: '蓝方', red: '红方' };
const effects: Array<{ id: string; name: string }> = [
  { id: 'damage', name: '伤害' }, { id: 'healing', name: '治疗' }, { id: 'shield', name: '护盾' },
  { id: 'control', name: '控制' }, { id: 'dispel', name: '驱散' }, { id: 'gauge_push', name: '拉条' },
  { id: 'gauge_pull', name: '推条' }, { id: 'revive', name: '复活' }, { id: 'other', name: '其他' },
];

export function installDuelLive(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  let dataset: DuelDatasetStore = { schema: 'onmyoji-studio.manual-duel', schemaVersion: 4, exportedAt: new Date().toISOString(), activeMatchId: '', matches: [] };
  try {
    const stored = window.onmyoji?.readLayout(KEY) ?? localStorage.getItem(KEY);
    dataset = loadDuelDataset(stored ? JSON.parse(stored) : null, heroes, suits);
  } catch { /* Start with an empty manual battle log when stored data is invalid. */ }
  let state: DuelMatchRecord = dataset.matches.find(match => match.matchId === dataset.activeMatchId) ?? dataset.matches.at(-1) ?? createDuelMatch(heroes, suits);
  dataset.activeMatchId = state.matchId;
  if (!dataset.matches.some(match => match.matchId === state.matchId)) dataset.matches.push(state);
  const save = (): void => {
    state.updatedAt = new Date().toISOString();
    dataset.activeMatchId = state.matchId;
    dataset.exportedAt = state.updatedAt;
    const index = dataset.matches.findIndex(match => match.matchId === state.matchId);
    if (index < 0) dataset.matches.push(state); else dataset.matches[index] = state;
    const serialized = JSON.stringify(dataset);
    try { window.onmyoji?.writeLayout(KEY, serialized); } catch { /* Keep the browser copy as a fallback. */ }
    try { localStorage.setItem(KEY, serialized); } catch { /* Browser storage is optional. */ }
  };
  const teams = doc.createElement('div'); teams.className = 'duel-teams duel-live-teams';
  const rosterStatus = doc.createElement('p'); rosterStatus.className = 'duel-live-status'; rosterStatus.setAttribute('role', 'status');
  let pickerSlot = '';
  let refreshRoster = (): void => {};
  let renderDraft = (): void => {};
  const picker = installCommunityPicker(root, {
    heroes, suits,
    hero: () => { const [side, index] = pickerSlot.split('-') as [Side, string]; return state.rosters[side][Number(index)]?.heroId ?? 0; },
    suit: () => { const [side, index] = pickerSlot.split('-') as [Side, string]; return state.rosters[side][Number(index)]?.fourSuitId ?? ''; },
    chooseHero: id => { const [side, index] = pickerSlot.split('-') as [Side, string], slot = Number(index); const hero = heroes.find(item => item.id === id); state.rosters[side][slot] = stateFromHero(hero, side, slot); recalculateActionCounters(); refreshRoster(); renderDraft(); save(); },
    chooseSuit: (_kind, value) => { const [side, index] = pickerSlot.split('-') as [Side, string], slot = Number(index), suit = suits.find(item => String(item.id) === value); state.rosters[side][slot].fourSuitId = suit ? String(suit.id) : null; state.rosters[side][slot].fourSuitName = suit?.name ?? null; refreshRoster(); save(); },
    clearHero: () => { const [side, index] = pickerSlot.split('-') as [Side, string], slot = Number(index); state.rosters[side][slot] = blankFighter(side, slot); recalculateActionCounters(); refreshRoster(); renderDraft(); save(); },
    clearLabel: '清除式神', ariaLabel: '选择实机阵容式神或御魂', suitTitle: '选择御魂效果', showSuitEffect: true,
    contextLabel: () => { const [side, index] = pickerSlot.split('-') as [Side, string]; return `${side === 'red' ? '红方' : '蓝方'} ${Number(index) + 1} 号位`; },
  });
  const intro = doc.createElement('div'); intro.className = 'duel-simulation-intro';
  const introText = doc.createElement('p'); introText.textContent = '实机阵容与模拟预测相互独立。需要时可从模拟预测单次投送阵容；行动记录使用下方阵容积木。'; intro.append(introText);

  const makeRoster = (side: Side): HTMLElement => {
    const panel = doc.createElement('section'); panel.className = `duel-team duel-team-${side}`;
    const heading = doc.createElement('header'); heading.className = 'duel-team-heading';
    const title = doc.createElement('h2'); title.className = 'duel-team-title'; title.textContent = side === 'red' ? '红方' : '蓝方'; heading.append(title);
    const headingActions = doc.createElement('div'); headingActions.className = 'duel-team-heading-actions';
    const recognize = doc.createElement('button'); recognize.type = 'button'; recognize.className = 'duel-recognize-button duel-recognize-roster'; recognize.textContent = '识别整方阵容';
    recognize.addEventListener('click', () => { rosterStatus.textContent = '实机阵容识别暂未接入；可直接在表格中录入或从模拟预测投送红方阵容。'; });
    headingActions.append(recognize); heading.append(headingActions); panel.append(heading);
    const scroll = doc.createElement('div'); scroll.className = 'duel-roster-scroll'; scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', `${side === 'red' ? '红方' : '蓝方'}实机阵容属性表，可横向滚动`);
    const cards = doc.createElement('div'); cards.className = 'duel-fighter-grid';
    const labels = doc.createElement('div'); labels.className = 'duel-roster-labels'; labels.setAttribute('aria-hidden', 'true');
    for (const label of ['式神', ...fields.map(field => `${PANEL_LABELS[field]}${percentages.has(field) ? ' (%)' : ''}`), '御魂效果', '面板识别']) { const cell = doc.createElement('span'); cell.textContent = label; labels.append(cell); }
    cards.append(labels);
    for (let index = 0; index < 5; index++) {
      const key = `${side}-${index}`, fighter = state.rosters[side][index];
      const card = doc.createElement('article'); card.className = 'duel-fighter-card'; card.dataset.slot = key; card.style.gridColumn = String(index + 2);
      const heading = doc.createElement('h3'); heading.className = 'duel-fighter-name'; heading.textContent = `${side === 'red' ? '红方' : '蓝方'}式神 ${index + 1}`; card.append(heading);
      const heroLabel = doc.createElement('label'); heroLabel.className = 'duel-roster-hero';
      const heroSelect = doc.createElement('select'); heroSelect.hidden = true; heroSelect.dataset.field = 'heroId'; heroSelect.value = fighter.heroId == null ? '' : String(fighter.heroId);
      const heroButton = doc.createElement('button'); heroButton.type = 'button'; heroButton.className = 'duel-choice-trigger'; heroButton.dataset.duelChoice = 'heroId'; heroButton.setAttribute('aria-haspopup', 'dialog');
      heroButton.addEventListener('click', () => { pickerSlot = key; picker.openHero(heroButton); }); heroLabel.append(heroSelect, heroButton); card.append(heroLabel);
      for (const [row, stat] of fields.entries()) {
        const field = doc.createElement('label'); field.className = 'duel-stat-field'; field.dataset.stat = stat; field.style.gridRow = String(row + 2);
        const caption = doc.createElement('span'); caption.textContent = PANEL_LABELS[stat];
        const input = doc.createElement('input'); input.type = 'number'; input.min = '0'; input.step = percentages.has(stat) ? '.01' : 'any'; input.inputMode = 'decimal'; input.dataset.field = stat; input.setAttribute('aria-label', `${side === 'red' ? '红方' : '蓝方'} ${index + 1} ${PANEL_LABELS[stat]}`); input.placeholder = stat === 'critDamage' ? '150' : '—';
        input.value = fighter.panel ? panelValue(stat, fighter.panel[stat]) : '';
        input.addEventListener('change', () => { const value = Number(input.value); if (!input.value.trim() || !Number.isFinite(value) || value < 0) return; const target = state.rosters[side][index]; target.panel ??= blankPanel(); target.panel[stat] = percentages.has(stat) ? value / 100 : value; save(); });
        const unit = doc.createElement('small'); unit.textContent = percentages.has(stat) ? '%' : ''; field.append(caption, input, unit); card.append(field);
      }
      const suitRow = doc.createElement('div'); suitRow.className = 'duel-suit-fields';
      const suitLabel = doc.createElement('label'); suitLabel.className = 'duel-select-field';
      const suitSelect = doc.createElement('select'); suitSelect.hidden = true; suitSelect.dataset.field = 'fourSuit'; suitSelect.value = fighter.fourSuitId ?? '';
      const suitButton = doc.createElement('button'); suitButton.type = 'button'; suitButton.className = 'duel-choice-trigger'; suitButton.dataset.duelChoice = 'fourSuit'; suitButton.setAttribute('aria-haspopup', 'dialog');
      suitButton.addEventListener('click', () => { pickerSlot = key; picker.openSuit('four', suitButton); }); suitLabel.append(suitSelect, suitButton); suitRow.append(suitLabel); card.append(suitRow);
      const recognizePanel = doc.createElement('button'); recognizePanel.type = 'button'; recognizePanel.className = 'duel-recognize-button'; recognizePanel.textContent = '识别当前面板';
      recognizePanel.setAttribute('aria-label', `识别当前画面并填入${side === 'red' ? '红方' : '蓝方'}式神 ${index + 1}`);
      recognizePanel.addEventListener('click', () => { rosterStatus.textContent = '实机面板识别暂未接入；属性可以直接编辑。'; }); card.append(recognizePanel);
      cards.append(card);
    }
    scroll.append(cards); panel.append(scroll); return panel;
  };
  teams.append(makeRoster('red'), makeRoster('blue'));
  const refreshRosterImpl = (): void => {
    for (const side of ['red', 'blue'] as const) for (let index = 0; index < 5; index++) {
      const fighter = state.rosters[side][index], card = teams.querySelector<HTMLElement>(`[data-slot="${side}-${index}"]`)!;
      const hero = heroes.find(item => item.id === fighter.heroId), heroButton = card.querySelector<HTMLButtonElement>('[data-duel-choice="heroId"]')!;
      heroButton.replaceChildren();
      if (hero) { appendPickerPortrait(heroButton, 'hero', hero.id, hero.name); const info = doc.createElement('span'); info.className = 'duel-choice-info'; const name = doc.createElement('span'); name.className = 'duel-choice-name'; name.textContent = hero.name; const hint = doc.createElement('small'); hint.textContent = `${index + 1} 号位 · 更换式神`; info.append(name, hint); heroButton.append(info); card.querySelector('.duel-fighter-name')!.textContent = `${side === 'red' ? '红方' : '蓝方'}式神 ${index + 1} · ${hero.name}`; }
      else { const empty = doc.createElement('span'); empty.className = 'duel-empty-portrait'; empty.textContent = '+'; heroButton.append(empty, doc.createTextNode(`${index + 1} 号位 · 选择式神`)); card.querySelector('.duel-fighter-name')!.textContent = `${side === 'red' ? '红方' : '蓝方'}式神 ${index + 1}`; }
      const search = doc.createElement('span'); search.className = 'duel-choice-search'; search.textContent = '⌕'; heroButton.append(search);
      for (const field of fields) { const input = card.querySelector<HTMLInputElement>(`[data-field="${field}"]`)!; input.value = fighter.panel ? panelValue(field, fighter.panel[field]) : ''; }
      const suitButton = card.querySelector<HTMLButtonElement>('[data-duel-choice="fourSuit"]')!; suitButton.replaceChildren(); const suit = suits.find(item => String(item.id) === fighter.fourSuitId);
      if (suit) appendPickerPortrait(suitButton, 'soul', suit.id, suit.name); const suitName = doc.createElement('span'); suitName.className = 'duel-choice-name'; suitName.textContent = suit?.name ?? '选择御魂效果'; suitButton.append(suitName); const suitSearch = doc.createElement('span'); suitSearch.className = 'duel-choice-search'; suitSearch.textContent = '⌕'; suitButton.append(suitSearch);
    }
  };
  refreshRoster = refreshRosterImpl;
  refreshRosterImpl();
  const rosterTransfer = (event: Event): void => {
    const detail = (event as CustomEvent<{ side?: Side; fighters?: Array<Partial<LiveFighter> | null> }>).detail;
    if ((detail?.side !== 'red' && detail?.side !== 'blue') || !Array.isArray(detail.fighters)) return;
    const side = detail.side;
    state.rosters[side] = Array.from({ length: 5 }, (_, index) => {
      const incoming = detail.fighters![index];
      if (!incoming) return blankFighter(side, index);
      const hero = heroes.find(item => item.id === incoming.heroId);
      const panel = incoming.panel && fields.every(field => Number.isFinite(incoming.panel?.[field])) ? { ...incoming.panel } as Panel : hero?.base ? { ...hero.base } : null;
      const suit = suits.find(item => String(item.id) === (incoming as unknown as { fourSuit?: string }).fourSuit);
      return { ...createDuelFighter(side, index, hero, suit ? String(suit.id) : '', suit?.name), panel };
    });
    recalculateActionCounters(); refreshRoster(); renderDraft(); save(); rosterStatus.textContent = `已将模拟预测的${side === 'red' ? '红方' : '蓝方'}阵容复制到游戏实机对应阵营。后续修改互不影响。`;
  };
  root.addEventListener('duel-roster-transfer', rosterTransfer);

  const builder = doc.createElement('section'); builder.className = 'duel-live-composer';
  const builderHeading = doc.createElement('header'); builderHeading.className = 'duel-block-builder-heading';
  const builderTitle = doc.createElement('h2'); builderTitle.textContent = '拼装行动'; builderHeading.append(builderTitle);
  const builderTools = doc.createElement('div'); builderTools.className = 'duel-live-builder-tools';
  const progress = doc.createElement('span'); progress.className = 'duel-live-progress';
  const exportButton = doc.createElement('button'); exportButton.type = 'button'; exportButton.className = 'duel-reset-button'; exportButton.textContent = '导出对局 JSON';
  exportButton.addEventListener('click', () => {
    const payload = exportDuelDataset(dataset.matches);
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = doc.createElement('a'); link.href = url; link.download = `onmyoji-duel-dataset-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
  });
  const newMatchButton = doc.createElement('button'); newMatchButton.type = 'button'; newMatchButton.className = 'duel-reset-button'; newMatchButton.textContent = '结束本局并新建';
  const saveMatchButton = doc.createElement('button'); saveMatchButton.type = 'button'; saveMatchButton.className = 'duel-run-button'; saveMatchButton.textContent = '保存本局';
  builderTools.append(progress, saveMatchButton, newMatchButton, exportButton); builderHeading.append(builderTools); builder.append(builderHeading);

  const palette = doc.createElement('div'); palette.className = 'duel-block-palette';
  const actors = doc.createElement('section'); actors.className = 'duel-block-stage';
  const actorHeading = doc.createElement('h3'); actorHeading.textContent = '① 谁行动'; actors.append(actorHeading);
  const actorSides = doc.createElement('div'); actorSides.className = 'duel-block-sides'; actors.append(actorSides);
  const skills = doc.createElement('section'); skills.className = 'duel-block-stage';
  const skillHeading = doc.createElement('h3'); skillHeading.textContent = '② 做什么'; skills.append(skillHeading);
  const skillBlocks = doc.createElement('div'); skillBlocks.className = 'duel-block-row'; skills.append(skillBlocks);
  const targetStage = doc.createElement('section'); targetStage.className = 'duel-block-stage';
  const targetHeading = doc.createElement('h3'); targetHeading.textContent = '③ 选择目标'; targetStage.append(targetHeading);
  const targetBlocks = doc.createElement('div'); targetBlocks.className = 'duel-block-row'; targetStage.append(targetBlocks);
  const summonControls = doc.createElement('div'); summonControls.className = 'duel-block-row'; targetStage.append(summonControls);
  const effectStage = doc.createElement('section'); effectStage.className = 'duel-block-stage';
  const effectHeading = doc.createElement('h3'); effectHeading.textContent = '④ 技能效果识别'; effectStage.append(effectHeading);
  const effectBlocks = doc.createElement('div'); effectBlocks.className = 'duel-block-row'; effectStage.append(effectBlocks);
  const effectTargetHeading = doc.createElement('h4'); effectTargetHeading.className = 'duel-block-subheading'; effectTargetHeading.textContent = '效果实际生效对象（按技能描述推断）'; effectStage.append(effectTargetHeading);
  const effectTargetBlocks = doc.createElement('div'); effectTargetBlocks.className = 'duel-block-row'; effectStage.append(effectTargetBlocks);
  const detail = doc.createElement('input'); detail.type = 'text'; detail.className = 'duel-block-detail'; detail.placeholder = '补充效果数值或状态（可选）'; detail.setAttribute('aria-label', '补充效果数值或状态'); effectStage.append(detail);
  palette.append(actors, skills, targetStage, effectStage); builder.append(palette);

  const preview = doc.createElement('div'); preview.className = 'duel-block-preview'; preview.setAttribute('aria-live', 'polite'); builder.append(preview);
  const controls = doc.createElement('div'); controls.className = 'duel-live-controls';
  const add = doc.createElement('button'); add.type = 'button'; add.className = 'duel-run-button'; add.textContent = '拼好，加入行动顺序';
  const clear = doc.createElement('button'); clear.type = 'button'; clear.className = 'duel-reset-button'; clear.textContent = '清空记录';
  const status = doc.createElement('p'); status.className = 'duel-live-status'; status.setAttribute('role', 'status'); controls.append(add, clear, status); builder.append(controls);
  const historyHeading = doc.createElement('h2'); historyHeading.className = 'duel-live-history-heading'; historyHeading.textContent = '行动顺序';
  const list = doc.createElement('ol'); list.className = 'duel-live-action-list'; list.setAttribute('aria-label', '本局行动顺序');

  let actor: { side: Side; index: number } | null = null;
  let skill = '普攻';
  const selectedTargets = new Set<number>();
  const heroAt = (side: Side, index: number): HeroProfile | undefined => heroes.find(item => item.id === state.rosters[side][index]?.heroId);
  const recalculateActionCounters = (): void => {
    const rosterIds = new Set((['red', 'blue'] as const).flatMap(side => state.rosters[side].filter(fighter => fighter.heroId != null).map(fighter => fighter.fighterId)));
    for (const summon of state.summons) if (summon.active && !rosterIds.has(summon.ownerFighterId)) summon.active = false;
    let pending = new Set(rosterIds);
    const actorTurns = new Map<string, number>();
    let cycle = 1;
    state.actions.forEach((action, index) => {
      action.sequence = index + 1;
      action.cycle = cycle;
      const turn = (actorTurns.get(action.actorFighterId) ?? 0) + 1;
      actorTurns.set(action.actorFighterId, turn);
      action.round = turn;
      pending.delete(action.actorFighterId);
      if (rosterIds.size > 0 && pending.size === 0) { cycle++; pending = new Set(rosterIds); }
    });
    state.currentCycle = cycle;
    state.currentRound = state.actions.at(-1)?.round ?? 0;
    const nextTurn = actor ? (actorTurns.get(state.rosters[actor.side][actor.index]?.fighterId ?? '') ?? 0) + 1 : null;
    progress.textContent = nextTurn == null
      ? `轮数和式神回合数自动计算 · 下一轮第 ${cycle} 轮`
      : `自动记录：第 ${cycle} 轮 · ${heroAt(actor!.side, actor!.index)?.name} 第 ${nextTurn} 回合`;
  };
  const activeButton = (button: HTMLButtonElement, active: boolean): void => { button.classList.toggle('is-selected', active); button.setAttribute('aria-pressed', String(active)); };
  const blockButton = (parent: HTMLElement, text: string, selected: boolean, action: () => void, className = ''): HTMLButtonElement => {
    const button = doc.createElement('button'); button.type = 'button'; button.className = `duel-block${className ? ` ${className}` : ''}`; button.textContent = text; activeButton(button, selected); button.addEventListener('click', action); parent.append(button); return button;
  };
  const sideOptions = (side: Side): Array<{ index: number; hero: HeroProfile }> => Array.from({ length: 5 }, (_, index) => ({ index, hero: heroAt(side, index) })).filter((item): item is { index: number; hero: HeroProfile } => Boolean(item.hero));
  const targetCode = (side: Side, index: number, actorSide: Side): number => side === actorSide ? -(index + 1) : index;
  const codeTarget = (code: number, actorSide: Side): { side: Side; index: number } => code < 0 ? { side: actorSide, index: Math.abs(code) - 1 } : { side: actorSide === 'blue' ? 'red' : 'blue', index: code };
  const summonSnapshot = (summon: DuelSummonRecord): DuelFighterRecord => ({
    fighterId: summon.summonId, side: summon.side, slot: 5 + summon.ownerSlot, heroId: null, heroName: summon.name,
    fourSuitId: null, fourSuitName: null, skillLevel: 0, panel: null, unitType: 'summon',
    ownerFighterId: summon.ownerFighterId, ownerHeroId: summon.ownerHeroId,
  });

  renderDraft = (): void => {
    actorSides.replaceChildren();
    for (const side of ['red', 'blue'] as const) {
      const group = doc.createElement('div'); group.className = `duel-block-side duel-block-side-${side}`;
      const label = doc.createElement('strong'); label.textContent = sideName[side]; group.append(label);
      const blocks = doc.createElement('div'); blocks.className = 'duel-block-row';
      for (const { index, hero } of sideOptions(side)) {
        const button = doc.createElement('button'); button.type = 'button'; button.className = `duel-block duel-block-hero duel-block-${side}`; activeButton(button, actor?.side === side && actor.index === index);
        appendPickerPortrait(button, 'hero', hero.id, hero.name); const name = doc.createElement('span'); name.textContent = hero.name; button.append(name);
        button.addEventListener('click', () => { actor = { side, index }; skill = '普攻'; selectedTargets.clear(); recalculateActionCounters(); renderDraft(); }); blocks.append(button);
      }
      if (!blocks.childElementCount) { const empty = doc.createElement('span'); empty.className = 'duel-block-empty'; empty.textContent = '先在上方阵容表录入式神'; blocks.append(empty); }
      group.append(blocks); actorSides.append(group);
    }
    skillBlocks.replaceChildren(); targetBlocks.replaceChildren(); effectBlocks.replaceChildren(); effectTargetBlocks.replaceChildren(); preview.replaceChildren();
    const actorHero = actor ? heroAt(actor.side, actor.index) : undefined;
    if (!actor || !actorHero) {
      for (const stage of [skills, targetStage, effectStage]) stage.classList.add('is-waiting');
      const hint = doc.createElement('span'); hint.className = 'duel-block-hint'; hint.textContent = '从上面的阵容中点一个式神，开始拼装行动'; preview.append(hint); return;
    }
    const actorSide = actor.side;
    skills.classList.remove('is-waiting'); targetStage.classList.remove('is-waiting'); effectStage.classList.remove('is-waiting');
    const skillList = heroSkillsCatalog.heroes[actorHero.id]?.skills ?? [];
    const selectedSkill = skill === '普攻' ? skillList.find(item => item.cost === 0) : skillList.find(item => item.name === skill);
    const inferred = inferDuelSkill(selectedSkill?.description);
    const skillOptions = [{ name: '普攻', cost: 0 }, ...skillList.map(item => ({ name: item.name, cost: item.cost }))];
    for (const item of skillOptions) blockButton(skillBlocks, item.cost ? `${item.name} · ${item.cost} 火` : item.name, skill === item.name, () => { skill = item.name; selectedTargets.clear(); renderDraft(); }, 'duel-block-skill');
    const targetSide: Side = actorSide === 'blue' ? 'red' : 'blue';
    const allowedTargetSides = inferred.targetSides;
    const targets: Array<{ side: Side; index: number; hero?: HeroProfile; label: string; summon?: DuelSummonRecord }> = [
      ...(allowedTargetSides.includes('enemy') ? sideOptions(targetSide).map(item => ({ ...item, side: targetSide, label: item.hero.name })) : []),
      ...(allowedTargetSides.includes('ally') ? sideOptions(actorSide).map(item => ({ ...item, side: actorSide, label: item.hero.name })) : []),
      ...(allowedTargetSides.includes('self') ? [{ index: actor.index, hero: actorHero, side: actorSide, label: actorHero.name }] : []),
    ];
    for (const summon of state.summons.filter(item => item.active)) {
      const enemySummon = summon.side !== actorSide && allowedTargetSides.includes('enemy');
      const allySummon = summon.side === actorSide && allowedTargetSides.includes('ally');
      if (enemySummon || allySummon) targets.push({ side: summon.side, index: 5 + summon.ownerSlot, label: `${summon.name}（${heroes.find(item => item.id === summon.ownerHeroId)?.name ?? '式神'}召唤物）`, summon });
    }
    const allowedCodes = new Set(targets.map(item => targetCode(item.side, item.index, actorSide)));
    for (const code of [...selectedTargets]) if (!allowedCodes.has(code)) selectedTargets.delete(code);
    if (inferred.targetShape === 'all') for (const item of targets) selectedTargets.add(targetCode(item.side, item.index, actorSide));
    if (inferred.targetSides.includes('self')) selectedTargets.add(targetCode(actorSide, actor.index, actorSide));
    if (!targets.length) { const hint = doc.createElement('span'); hint.className = 'duel-block-hint'; hint.textContent = '技能描述未标注可选目标，按技能自身效果记录'; targetBlocks.append(hint); }
    for (const item of targets) {
      const code = targetCode(item.side, item.index, actorSide); const selected = selectedTargets.has(code);
      const button = doc.createElement('button'); button.type = 'button'; button.className = `duel-block duel-block-target duel-block-${item.side}`; activeButton(button, selected);
      if (item.hero) appendPickerPortrait(button, 'hero', item.hero.id, item.hero.name);
      else { const marker = doc.createElement('span'); marker.className = 'duel-summon-marker'; marker.textContent = '召'; button.append(marker); }
      const name = doc.createElement('span'); name.textContent = `${item.side === actorSide ? '友方' : '敌方'}·${item.label}`; button.append(name);
      button.addEventListener('click', () => { selected ? selectedTargets.delete(code) : selectedTargets.add(code); renderDraft(); }); targetBlocks.append(button);
    }
    summonControls.replaceChildren();
    for (const summon of state.summons.filter(item => item.active)) {
      const dismiss = doc.createElement('button'); dismiss.type = 'button'; dismiss.className = 'duel-reset-button'; dismiss.textContent = `记录${summon.name}阵亡`;
      dismiss.addEventListener('click', () => { summon.active = false; selectedTargets.delete(targetCode(summon.side, 5 + summon.ownerSlot, actorSide)); save(); renderDraft(); }); summonControls.append(dismiss);
    }
    effectBlocks.replaceChildren();
    const detectedEffects = inferred.effectIds.map(id => effects.find(item => item.id === id)?.name ?? '其他');
    const inferredEffectLabel = doc.createElement('span'); inferredEffectLabel.className = 'duel-block-hint';
    inferredEffectLabel.textContent = inferred.confident ? `自动识别：${detectedEffects.join('、')}` : '技能目录没有明确说明效果；暂记为“其他”';
    effectBlocks.append(inferredEffectLabel);
    effectTargetBlocks.replaceChildren();
    const inferredRecipients = targets.filter(item => selectedTargets.has(targetCode(item.side, item.index, actorSide)));
    for (const item of inferredRecipients) {
      const button = doc.createElement('span'); button.className = `duel-block duel-block-target duel-block-${item.side}`;
      if (item.hero) appendPickerPortrait(button, 'hero', item.hero.id, item.hero.name);
      else { const marker = doc.createElement('span'); marker.className = 'duel-summon-marker'; marker.textContent = '召'; button.append(marker); }
      button.append(doc.createTextNode(`${item.side === actorSide ? '友方' : '敌方'}·${item.label}`)); effectTargetBlocks.append(button);
    }
    const previewActor = doc.createElement('span'); previewActor.className = `duel-block duel-block-${actor.side}`; appendPickerPortrait(previewActor, 'hero', actorHero.id, actorHero.name); previewActor.append(doc.createTextNode(actorHero.name));
    const previewSkill = doc.createElement('span'); previewSkill.className = 'duel-block duel-block-skill'; previewSkill.textContent = skill;
    const previewTargets = doc.createElement('span'); previewTargets.className = 'duel-block-preview-text'; previewTargets.textContent = `目标：${inferredRecipients.map(item => item.label).join('、') || '未指定'}`;
    const previewEffect = doc.createElement('span'); previewEffect.className = 'duel-block duel-block-effect'; previewEffect.textContent = detectedEffects.join('、');
    const previewRecipients = doc.createElement('span'); previewRecipients.className = 'duel-block-preview-text'; previewRecipients.textContent = `生效对象：${inferredRecipients.map(item => item.label).join('、') || '按技能自动结算'}`;
    preview.append(previewActor, doc.createTextNode('→'), previewSkill, previewTargets, previewEffect, previewRecipients);
  };

  const renderHistory = (): void => {
    list.replaceChildren();
    if (!state.actions.length) {
      const empty = doc.createElement('li'); empty.className = 'duel-live-empty'; empty.textContent = '行动顺序还是空的。选一个式神，拼好第一块行动积木。'; list.append(empty);
    }
    state.actions.forEach((action, index) => {
      const item = doc.createElement('li'); item.className = `duel-live-action duel-log-group-${action.side}`;
      const heading = doc.createElement('strong'); heading.textContent = `第 ${action.cycle} 轮 · ${action.round} 回合 · 行动 ${action.sequence}`;
      const blocks = doc.createElement('div'); blocks.className = 'duel-block-history';
      const actorBlock = doc.createElement('span'); actorBlock.className = `duel-block duel-block-hero duel-block-${action.side}`;
      if (action.actorSnapshot.heroId != null) appendPickerPortrait(actorBlock, 'hero', action.actorSnapshot.heroId, action.actorSnapshot.heroName ?? '式神'); actorBlock.append(doc.createTextNode(action.actorSnapshot.heroName ?? `${action.actorSlot + 1} 号位`));
      const skillBlock = doc.createElement('span'); skillBlock.className = 'duel-block duel-block-skill'; skillBlock.textContent = action.skillName;
      const targetsBlock = doc.createElement('span'); targetsBlock.className = 'duel-block-preview-text';
      targetsBlock.textContent = `目标：${action.targetSnapshots.map(target => `${target.heroName ?? '目标'}${target.unitType === 'summon' ? '（召唤物）' : ''}`).join('、') || '未指定'}`;
      const effectBlock = doc.createElement('span'); effectBlock.className = 'duel-block duel-block-effect'; effectBlock.textContent = action.effectName;
      const recipientBlock = doc.createElement('span'); recipientBlock.className = 'duel-block-preview-text';
      recipientBlock.textContent = `生效：${action.effectTargetSnapshots.map(target => `${target.heroName ?? '目标'}${target.unitType === 'summon' ? '（召唤物）' : ''}`).join('、') || '未指定'}${action.effectValue == null ? '' : ` · ${action.effectValue}${action.effectUnit ?? ''}`}${action.detail ? ` · ${action.detail}` : ''}`;
      blocks.append(actorBlock, doc.createTextNode('→'), skillBlock, targetsBlock, effectBlock, recipientBlock);
      const tools = doc.createElement('div'); tools.className = 'duel-live-action-tools';
      const move = (delta: number): HTMLButtonElement => {
        const button = doc.createElement('button'); button.type = 'button'; button.textContent = delta < 0 ? '↑' : '↓'; button.title = delta < 0 ? '上移' : '下移'; button.disabled = index + delta < 0 || index + delta >= state.actions.length;
        button.setAttribute('aria-label', `${delta < 0 ? '上移' : '下移'}第 ${index + 1} 条行动`);
        button.addEventListener('click', () => { const [selected] = state.actions.splice(index, 1); state.actions.splice(index + delta, 0, selected); recalculateActionCounters(); save(); renderDraft(); renderHistory(); }); return button;
      };
      const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.addEventListener('click', () => { state.actions.splice(index, 1); recalculateActionCounters(); save(); renderDraft(); renderHistory(); });
      tools.append(move(-1), move(1), remove); item.append(heading, blocks, tools); list.append(item);
    });
    status.textContent = `${state.actions.length} 块行动积木`;
  };
  const uploadPage = root.querySelector<HTMLElement>('[data-duel-live-upload]');
  const uploadHeading = doc.createElement('h2'); uploadHeading.textContent = '实机上传';
  const uploadDescription = doc.createElement('p'); uploadDescription.textContent = '这里显示你在“游戏实机”中手动保存的对局。点击记录可查看完整行动过程。';
  const filters = doc.createElement('div'); filters.className = 'duel-live-saved-filters';
  const searchLabel = doc.createElement('label'); searchLabel.textContent = '关键词';
  const searchInput = doc.createElement('input'); searchInput.type = 'search'; searchInput.placeholder = '式神、技能、效果或备注'; searchInput.setAttribute('aria-label', '筛选对局关键词'); searchLabel.append(searchInput);
  const sideLabel = doc.createElement('label'); sideLabel.textContent = '行动阵营';
  const sideFilter = doc.createElement('select'); sideFilter.setAttribute('aria-label', '按行动阵营筛选');
  for (const [value, label] of [['all', '全部阵营'], ['red', '红方行动'], ['blue', '蓝方行动']]) { const option = doc.createElement('option'); option.value = value; option.textContent = label; sideFilter.append(option); }
  sideLabel.append(sideFilter);
  const effectLabel = doc.createElement('label'); effectLabel.textContent = '效果类型';
  const effectFilter = doc.createElement('select'); effectFilter.setAttribute('aria-label', '按效果类型筛选');
  const allEffects = doc.createElement('option'); allEffects.value = 'all'; allEffects.textContent = '全部效果'; effectFilter.append(allEffects);
  for (const item of effects) { const option = doc.createElement('option'); option.value = item.id; option.textContent = item.name; effectFilter.append(option); }
  effectLabel.append(effectFilter);
  const filterStatus = doc.createElement('p'); filterStatus.className = 'duel-live-status'; filterStatus.setAttribute('role', 'status');
  filters.append(searchLabel, sideLabel, effectLabel, filterStatus);
  const savedList = doc.createElement('div'); savedList.className = 'duel-live-saved-list';
  uploadPage?.replaceChildren(uploadHeading, uploadDescription, filters, savedList);
  const renderSavedMatches = (): void => {
    if (!uploadPage) return;
    savedList.replaceChildren();
    const allSaved = dataset.matches.filter(match => match.savedAt).sort((left, right) => (right.savedAt ?? '').localeCompare(left.savedAt ?? ''));
    const query = searchInput.value.trim().toLocaleLowerCase();
    const selectedSide = sideFilter.value;
    const selectedEffect = effectFilter.value;
    const saved = allSaved.filter(match => {
      if (selectedSide !== 'all' && !match.actions.some(action => action.side === selectedSide)) return false;
      if (selectedEffect !== 'all' && !match.actions.some(action => action.effectIds.includes(selectedEffect) || action.effectId === selectedEffect)) return false;
      if (!query) return true;
      const values = [
        ...match.rosters.red.map(fighter => fighter.heroName ?? ''), ...match.rosters.blue.map(fighter => fighter.heroName ?? ''),
        ...match.actions.flatMap(action => [action.actorSnapshot.heroName ?? '', action.skillName, action.effectName, action.detail,
          ...action.targetSnapshots.map(target => target.heroName ?? ''), ...action.effectTargetSnapshots.map(target => target.heroName ?? '')]),
      ];
      return values.some(value => value.toLocaleLowerCase().includes(query));
    });
    filterStatus.textContent = `显示 ${saved.length} / ${allSaved.length} 条已保存对局`;
    if (!saved.length) {
      const empty = doc.createElement('p'); empty.className = 'duel-live-empty'; empty.textContent = allSaved.length ? '没有符合筛选条件的对局。' : '还没有保存的实机对局。录入完成后，回到“游戏实机”点击“保存本局”。'; savedList.append(empty); return;
    }
    for (const match of saved) {
      const card = doc.createElement('article'); card.className = 'duel-live-saved-card';
      const details = doc.createElement('details'); details.className = 'duel-live-saved-details';
      const summaryHeading = doc.createElement('summary');
      const title = doc.createElement('strong'); title.textContent = `实机对局 · ${new Date(match.savedAt!).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
      const red = match.rosters.red.map(fighter => fighter.heroName).filter(Boolean).join('、') || '未录入';
      const blue = match.rosters.blue.map(fighter => fighter.heroName).filter(Boolean).join('、') || '未录入';
      const summary = doc.createElement('span'); summary.textContent = `红方：${red}　蓝方：${blue}`;
      const lastAction = match.actions.at(-1);
      const count = doc.createElement('p'); count.textContent = `${lastAction ? `最新：第 ${lastAction.cycle} 轮 · 式神第 ${lastAction.round} 回合` : '尚无行动记录'} · ${match.actions.length} 条行动`;
      summaryHeading.append(title, summary, count); details.append(summaryHeading);
      const rosterDetails = doc.createElement('div'); rosterDetails.className = 'duel-live-saved-rosters';
      for (const side of ['red', 'blue'] as const) {
        const team = doc.createElement('section'); team.className = `duel-live-saved-team duel-log-group-${side}`;
        const teamTitle = doc.createElement('h4'); teamTitle.textContent = sideName[side];
        const teamNames = doc.createElement('p'); teamNames.textContent = match.rosters[side].map((fighter, index) => `${index + 1}. ${fighter.heroName ?? '空位'}${fighter.fourSuitName ? `（${fighter.fourSuitName}）` : ''}`).join('　');
        team.append(teamTitle, teamNames); rosterDetails.append(team);
      }
      details.append(rosterDetails);
      const actionHeading = doc.createElement('h4'); actionHeading.textContent = '行动顺序'; details.append(actionHeading);
      if (match.actions.length) {
        const actionList = doc.createElement('ol'); actionList.className = 'duel-live-saved-actions';
        for (const action of match.actions) {
          const entry = doc.createElement('li'); entry.className = `duel-log-group-${action.side}`;
          const targetNames = action.targetSnapshots.map(target => `${target.heroName ?? '目标'}${target.unitType === 'summon' ? '（召唤物）' : ''}`).join('、') || '未指定';
          const recipientNames = action.effectTargetSnapshots.map(target => `${target.heroName ?? '目标'}${target.unitType === 'summon' ? '（召唤物）' : ''}`).join('、') || '自动结算';
          entry.textContent = `第 ${action.cycle} 轮 · ${action.actorSnapshot.heroName ?? '未知式神'}第 ${action.round} 回合：${action.skillName}；目标 ${targetNames}；${action.effectName}，生效对象 ${recipientNames}${action.detail ? `；${action.detail}` : ''}`;
          actionList.append(entry);
        }
        details.append(actionList);
      } else { const noActions = doc.createElement('p'); noActions.textContent = '这场对局没有行动记录。'; details.append(noActions); }
      const download = doc.createElement('button'); download.type = 'button'; download.className = 'duel-reset-button'; download.textContent = '导出此对局 JSON';
      download.addEventListener('click', () => {
        const payload = exportDuelDataset([match]);
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const link = doc.createElement('a'); link.href = url; link.download = `onmyoji-duel-${match.matchId}.json`; link.click(); URL.revokeObjectURL(url);
      });
      const remove = doc.createElement('button'); remove.type = 'button'; remove.className = 'duel-reset-button'; remove.textContent = '删除记录';
      remove.addEventListener('click', () => { const index = dataset.matches.findIndex(item => item.matchId === match.matchId); if (index >= 0) dataset.matches.splice(index, 1); save(); renderSavedMatches(); status.textContent = '已删除这条保存记录。'; });
      const tools = doc.createElement('div'); tools.className = 'duel-live-saved-tools'; tools.append(download, remove);
      card.append(details, tools); savedList.append(card);
    }
  };
  searchInput.addEventListener('input', renderSavedMatches);
  sideFilter.addEventListener('change', renderSavedMatches);
  effectFilter.addEventListener('change', renderSavedMatches);
  saveMatchButton.addEventListener('click', () => {
    const previous = dataset.matches.find(match => match.savedFromMatchId === state.matchId);
    const snapshot = JSON.parse(JSON.stringify(state)) as DuelMatchRecord;
    snapshot.matchId = previous?.matchId ?? createDuelId('saved_match');
    snapshot.savedFromMatchId = state.matchId;
    snapshot.savedAt = new Date().toISOString();
    snapshot.status = 'complete';
    snapshot.updatedAt = snapshot.savedAt;
    if (previous) dataset.matches[dataset.matches.indexOf(previous)] = snapshot; else dataset.matches.push(snapshot);
    save();
    renderSavedMatches();
    status.textContent = '本局已保存；可以在“实机上传”中查看和导出。';
  });
  newMatchButton.addEventListener('click', () => {
    state.status = 'complete';
    save();
    const nextMatch = createDuelMatch(heroes, suits);
    dataset.matches.push(nextMatch);
    state = nextMatch;
    dataset.activeMatchId = state.matchId;
    actor = null;
    skill = '普攻';
    selectedTargets.clear();
    detail.value = '';
    refreshRoster();
    renderDraft();
    renderHistory();
    save();
    status.textContent = '上一局已归档，已创建新对局';
  });
  add.addEventListener('click', () => {
    if (!actor || !heroAt(actor.side, actor.index)) { status.textContent = '先从阵容中选择行动式神'; return; }
    const actorFighter = state.rosters[actor.side][actor.index]; const actorHero = heroAt(actor.side, actor.index)!;
    const round = state.actions.filter(action => action.actorFighterId === actorFighter.fighterId).length + 1;
    const actorSkills = heroSkillsCatalog.heroes[actorHero.id]?.skills ?? [];
    const skillProfile = skill === '普攻' ? undefined : actorSkills.find(item => item.name === skill);
    const inference = inferDuelSkill((skillProfile ?? actorSkills.find(item => item.cost === 0))?.description);
    const snapshotsFor = (codes: number[]): DuelFighterRecord[] => [...codes].flatMap(code => {
      const target = codeTarget(code, actor!.side);
      if (target.index >= 5) {
        const summon = state.summons.find(item => item.active && item.side === target.side && item.ownerSlot === target.index - 5);
        return summon ? [summonSnapshot(summon)] : [];
      }
      return [snapshotDuelFighter(state.rosters[target.side][target.index])];
    });
    const targetSnapshots = snapshotsFor([...selectedTargets]); const effectTargetSnapshots = targetSnapshots.map(snapshotDuelFighter);
    const selectedEffectIds = inference.effectIds.length ? inference.effectIds : ['other'];
    const selectedEffect = effects.find(item => item.id === selectedEffectIds[0]) ?? effects[effects.length - 1];
    const record: DuelActionRecord = {
      actionId: createDuelId('action'), sequence: state.actions.length + 1, occurredAt: new Date().toISOString(), cycle: state.currentCycle, round, side: actor.side,
      actorSlot: actor.index, actorFighterId: actorFighter.fighterId, actorSnapshot: snapshotDuelFighter(actorFighter),
      targetSides: inference.targetSides, targetShape: inference.targetShape, inferenceConfident: inference.confident,
      skillId: skillProfile ? `onmyoji:${actorHero.id}:${skillProfile.id}` : 'onmyoji:basic_attack', skillName: skill,
      skillCost: skillProfile?.cost ?? 0, targetFighterIds: targetSnapshots.map(target => target.fighterId), targetSnapshots,
      effectId: selectedEffect.id, effectIds: selectedEffectIds, effectName: selectedEffectIds.map(id => effects.find(item => item.id === id)?.name ?? '其他').join('、'), effectTargetFighterIds: effectTargetSnapshots.map(target => target.fighterId),
      effectTargetSnapshots, effectValue: null, effectUnit: null, detail: detail.value.trim(),
    };
    state.actions.push(record);
    if (actorHero.id === 356 && skillProfile?.id === 3563) {
      const summon = state.summons.find(item => item.ownerFighterId === actorFighter.fighterId && item.name === '海原贝戟');
      if (summon) summon.active = true;
      else state.summons.push({ summonId: createDuelId('summon'), side: actor.side, ownerSlot: actor.index, ownerFighterId: actorFighter.fighterId, ownerHeroId: actorHero.id, name: '海原贝戟', active: true, summonedAt: new Date().toISOString() });
    }
    recalculateActionCounters(); save(); selectedTargets.clear(); detail.value = ''; renderDraft(); renderHistory();
  });
  clear.addEventListener('click', () => { state.actions = []; recalculateActionCounters(); save(); renderHistory(); });
  const livePage = root.querySelector('[data-duel-live]');
  if (livePage) livePage.replaceChildren(intro, teams, rosterStatus, builder, historyHeading, list);
  recalculateActionCounters();
  renderDraft(); renderHistory(); renderSavedMatches();
  return () => { root.removeEventListener('duel-roster-transfer', rosterTransfer); picker.dispose(); };
}
