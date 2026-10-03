import { soulCatalog } from '../shared/soul-catalog-data';
import { heroSkillsCatalog } from '../shared/hero-skills-data';
import { skillDescriptionText } from '../shared/hero-skills';
import type { HeroSkill } from '../shared/hero-skills';
import { PANEL_LABELS } from '../shared/soul-optimizer';
import type { HeroProfile, PanelKey } from '../shared/soul-optimizer';
import { appendPickerPortrait, appendHeroRarity, HERO_RARITIES } from './soul-optimizer-picker';
import { heroSkillTerms } from '../shared/hero-skill-terms';
import { installShikigamiSkillTerms } from './shikigami-skill-terms';
import { installLineupBrowser } from './lineup-browser';
import type { OnmyojiDesktopApi, SoulInstance } from '../shared/contracts';
import { readHeroOwnership, type HeroOwnershipSnapshot } from '../shared/hero-ownership';
import { installShikigamiOwnedDetail } from './shikigami-owned-detail';
import { installShikigamiShare } from './shikigami-share';

const PERCENT = new Set<PanelKey>(['crit', 'critDamage', 'hit', 'resist']);
type OwnershipApi = Pick<OnmyojiDesktopApi, 'listHeroInstances' | 'loadHeroOwnership' | 'detectHeroOwnership' | 'cancelHeroDetection' | 'onHeroDetectionProgress' | 'readLayout' | 'writeLayout'> & Partial<Pick<OnmyojiDesktopApi, 'loadHeroBasePanel' | 'saveCanvas' | 'readAssetData' | 'copyImageToClipboard'>>;

/** Browse the same fixed hero profiles used for soul calculations, without a device. */
export function installShikigamiAtlas(root: HTMLElement, api?: OwnershipApi): () => void {
  const doc = root.ownerDocument;
  const heroes = [...soulCatalog.heroes].sort((a, b) => b.rarity - a.rarity || a.id - b.id);
  root.innerHTML = `<div class="shikigami-atlas-toolbar"><label class="shikigami-atlas-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="搜索式神名称或拼音" aria-label="搜索图鉴式神" data-atlas="search"></label><span data-atlas="count" role="status" aria-live="polite"></span><button type="button" data-atlas="share">分享</button></div>
    <div class="shikigami-atlas-warehouse"><label>模拟器实例 <select data-atlas="instance" aria-label="仓库检测实例"></select></label><button type="button" data-atlas="refresh">刷新实例</button><button type="button" data-atlas="detect">仓库检测</button><button type="button" data-atlas="cancel" hidden>取消检测</button><span>请先在游戏中切到「式神录」，等待式神列表加载完成。</span></div>
    <p class="shikigami-atlas-ownership-status" data-atlas="ownership-status" role="status" aria-live="polite"></p>
    <nav class="shikigami-atlas-rarities" aria-label="按式神稀有度筛选" data-atlas="rarities"></nav>
    <div class="shikigami-atlas-layout"><div class="shikigami-atlas-list" data-atlas="list"><div class="shikigami-atlas-cards" data-atlas="cards"></div></div><aside class="shikigami-atlas-detail" data-atlas="detail" aria-label="式神属性与技能"></aside></div>`;
  const termView = installShikigamiSkillTerms(root);
  const ownedDetail = installShikigamiOwnedDetail(root, api?.loadHeroBasePanel ? request => api.loadHeroBasePanel!(request) : undefined, api);
  const shareView = installShikigamiShare(root, heroes, api?.saveCanvas ? request => api.saveCanvas!(request) : undefined,
    api?.readAssetData ? paths => api.readAssetData!(paths) : undefined,
    api?.copyImageToClipboard ? dataUrl => api.copyImageToClipboard!(dataUrl) : undefined);
  const el = <T extends HTMLElement>(name: string): T => root.querySelector<T>(`[data-atlas="${name}"]`)!;
  const search = el<HTMLInputElement>('search');
  const instance = el<HTMLSelectElement>('instance'), detect = el<HTMLButtonElement>('detect'), refresh = el<HTMLButtonElement>('refresh');
  let instances: SoulInstance[] = [], snapshot: HeroOwnershipSnapshot | null = null, busy = false, refreshing = false, disposed = false, loadVersion = 0;
  let ownershipFilter = 'all';
  const ownershipLabel = (id: number): string => !snapshot ? '未检测' : snapshot.counts[id] ? `已拥有 × ${snapshot.counts[id]}` : '未拥有';
  const updateControls = (): void => {
    const online = instances.find(item => item.id === instance.value)?.online;
    instance.disabled = busy || refreshing; refresh.disabled = busy || refreshing;
    detect.disabled = busy || refreshing || !online;
    detect.title = online ? '同步当前账号的式神持有情况' : '请启动所选模拟器并刷新实例后检测';
    detect.textContent = busy ? '检测中…' : '仓库检测'; el('cancel').hidden = !busy;
  };
  const showCacheStatus = (): void => {
    const offline = instances.find(item => item.id === instance.value)?.online === false;
    el('ownership-status').textContent = snapshot
      ? `已同步 ${Object.keys(snapshot.counts).length} 种、${snapshot.total.toLocaleString()} 只式神 · ${new Date(snapshot.fetchedAt).toLocaleString()}${offline ? ' · 历史数据（离线）' : ' · 本地保存'}`
      : instance.value ? '此实例尚未检测仓库，拥有情况未知。' : '请选择实例检测仓库。';
    el('ownership-status').classList.remove('is-error');
  };
  el('share').addEventListener('click', () => {
    closeContextMenu(); termView.close();
    shareView.show(snapshot, instance.value ? instance.selectedOptions[0]?.textContent?.replace(/（(?:在线|历史 · 离线)）$/, '') ?? '' : '', el('share'));
  });
  let rarity = 0, selected: HeroProfile = heroes.find(hero => hero.name === '大天狗') ?? heroes[0];
  let detailView: 'skills' | 'stats' = 'skills';
  let contextMenu: HTMLElement | null = null, contextCard: HTMLButtonElement | null = null;
  const closeContextMenu = (restoreFocus = false): void => {
    const card = contextCard;
    contextMenu?.remove(); contextMenu = null; contextCard = null;
    if (restoreFocus && card?.isConnected && !root.closest('[hidden]')) card.focus({ preventScroll: true });
  };
  const text = (parent: HTMLElement, tag: string, content: string, className = ''): HTMLElement => {
    const node = doc.createElement(tag); node.textContent = content; node.className = className; parent.append(node); return node;
  };
  const skillIcon = (parent: HTMLElement, skill: HeroSkill): void => {
    const frame = text(parent, 'span', skill.name.slice(0, 1), 'shikigami-skill-icon');
    const image = doc.createElement('img'); image.alt = ''; image.src = `onmyoji-resource://project/assets/skill-icons/${skill.icon}.png`;
    image.addEventListener('error', () => image.remove(), { once: true }); frame.append(image);
  };
  const skillBody = (parent: HTMLElement, skill: HeroSkill): void => {
    const terms = heroSkillTerms(selected.id, heroSkillsCatalog.heroes[selected.id]?.skills ?? []);
    const heading = text(parent, 'div', '', 'shikigami-skill-heading');
    text(heading, 'h3', skill.name);
    termView.append(text(heading, 'span', '', 'shikigami-skill-cost'), skill.type === 4 ? '被动' : `消耗 ${skill.cost} 鬼火`, []);
    termView.append(text(parent, 'p', '', 'shikigami-skill-description'), skillDescriptionText(skill.description) || '暂无技能描述。', terms);
    if (skill.upgrades.length) {
      text(parent, 'h4', '升级效果'); const list = text(parent, 'ul', '', 'shikigami-skill-upgrades');
      for (const line of skill.upgrades) {
        const level = line.match(/^(Lv\.?\s*\d+)\s*([\s\S]*)$/i);
        if (!level) { termView.append(text(list, 'li', ''), line, terms); continue; }
        const row = text(list, 'li', '', 'shikigami-skill-upgrade-row');
        text(row, 'strong', `${level[1]} `, 'shikigami-skill-upgrade-level');
        termView.append(text(row, 'span', ''), level[2], terms);
      }
    } else text(parent, 'p', '该技能无需升级。', 'shikigami-atlas-caption');
    for (const extra of skill.extraSkills) {
      const box = doc.createElement('details'); box.className = 'shikigami-skill-extra';
      const summary = text(box, 'summary', ''); skillIcon(summary, extra); text(summary, 'span', `附加技能 · ${extra.name}`);
      const content = text(box, 'div', ''); skillBody(content, extra); parent.append(box);
    }
  };
  const renderDetail = (): void => {
    termView.close();
    const detail = el('detail'); detail.replaceChildren();
    const heading = text(detail, 'div', '', 'shikigami-atlas-detail-heading'); appendPickerPortrait(heading, 'hero', selected.id, selected.name);
    const name = text(heading, 'div', ''), meta = text(name, 'small', '');
    appendHeroRarity(meta, selected.rarity); meta.append(` · ${selected.awake ? '觉醒后' : '无需觉醒'}`); text(name, 'h2', selected.name);
    text(name, 'small', ownershipLabel(selected.id), 'shikigami-atlas-owned');
    const views = text(detail, 'nav', '', 'shikigami-atlas-detail-views'); views.setAttribute('aria-label', '式神详情内容');
    const skillsPanel = text(detail, 'section', '', 'shikigami-atlas-skills'); skillsPanel.dataset.atlas = 'skills';
    const statsPanel = text(detail, 'section', ''); statsPanel.dataset.atlas = 'stats';
    for (const [view, label] of [['skills', '技能'], ['stats', '基础属性']] as const) {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.detailView = view;
      const activate = (): void => {
        termView.close();
        detailView = view; skillsPanel.hidden = view !== 'skills'; statsPanel.hidden = view !== 'stats';
        for (const item of views.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item.dataset.detailView === view));
      };
      button.setAttribute('aria-pressed', String(detailView === view)); button.addEventListener('click', activate); views.append(button);
    }
    skillsPanel.hidden = detailView !== 'skills'; statsPanel.hidden = detailView !== 'stats';
    const profile = heroSkillsCatalog.heroes[selected.id];
    if (profile?.skills.length) {
      text(skillsPanel, 'p', `${selected.awake ? '觉醒后' : '当前形态'}技能 · 描述为 Lv.1，升级效果见下方`, 'shikigami-atlas-caption');
      const skillButtons = text(skillsPanel, 'div', '', 'shikigami-skill-buttons'); skillButtons.setAttribute('aria-label', '选择技能');
      const content = text(skillsPanel, 'div', '', 'shikigami-skill-content'); content.setAttribute('aria-live', 'polite');
      for (const [index, skill] of profile.skills.entries()) {
        const button = doc.createElement('button'); button.type = 'button'; button.dataset.skillId = String(skill.id);
        button.setAttribute('aria-pressed', String(index === 0)); skillIcon(button, skill); text(button, 'span', skill.name);
        button.addEventListener('click', () => {
          termView.close();
          for (const item of skillButtons.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button));
          content.replaceChildren(); skillBody(content, skill);
        });
        skillButtons.append(button);
      }
      skillBody(content, profile.skills[0]);
      if (profile.awakening) termView.append(text(skillsPanel, 'p', '', 'shikigami-atlas-caption'), `觉醒效果 · ${profile.awakening}`, heroSkillTerms(selected.id, profile.skills));
    } else text(skillsPanel, 'p', '官方式神录暂未提供技能资料。', 'shikigami-atlas-caption');
    text(skillsPanel, 'p', `网易式神录 · ${heroSkillsCatalog.updated}`, 'shikigami-atlas-caption');
    text(statsPanel, 'p', '六星 · 40 级基础面板', 'shikigami-atlas-caption');
    const stats = text(statsPanel, 'dl', '', 'shikigami-atlas-stats');
    for (const key of Object.keys(PANEL_LABELS) as PanelKey[]) {
      const row = text(stats, 'div', ''); text(row, 'dt', PANEL_LABELS[key]);
      const value = selected.base?.[key]; text(row, 'dd', value === undefined ? '—' : `${(value * (PERCENT.has(key) ? 100 : 1)).toFixed(2)}${PERCENT.has(key) ? '%' : ''}`);
    }
    text(statsPanel, 'p', '基础属性不含御魂加成。', 'shikigami-atlas-caption');
    text(statsPanel, 'p', `网易式神录 · ${soulCatalog.updated}`, 'shikigami-atlas-caption');
  };
  const choose = (hero: HeroProfile): void => {
    closeContextMenu();
    selected = hero;
    for (const card of el('cards').querySelectorAll<HTMLButtonElement>('[data-hero-id]')) card.setAttribute('aria-pressed', String(Number(card.dataset.heroId) === selected.id));
    renderDetail();
  };
  const showContextMenu = (card: HTMLButtonElement, x: number, y: number): void => {
    closeContextMenu(); termView.close();
    const hero = heroes.find(item => item.id === Number(card.dataset.heroId));
    if (!hero || disposed || root.closest('[hidden]')) return;
    const menu = doc.createElement('div'); menu.className = 'content-context-menu shikigami-atlas-context-menu';
    menu.popover = 'manual'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', `${hero.name}卡片操作`);
    const entry = doc.createElement('button'); entry.type = 'button'; entry.setAttribute('role', 'menuitem'); entry.textContent = '查看详情';
    entry.addEventListener('click', () => {
      choose(hero);
      ownedDetail.show(hero, snapshot, instance.selectedOptions[0]?.textContent ?? '', card);
    });
    menu.append(entry); doc.body.append(menu); contextMenu = menu; contextCard = card; menu.showPopover();
    const rect = menu.getBoundingClientRect(), viewport = doc.documentElement;
    menu.style.left = `${Math.max(6, Math.min(x, viewport.clientWidth - rect.width - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(y, viewport.clientHeight - rect.height - 6))}px`;
    entry.focus({ preventScroll: true });
  };
  const cardAt = (target: EventTarget | null): HTMLButtonElement | null => {
    const card = (target as Element | null)?.closest<HTMLButtonElement>('.shikigami-atlas-card');
    return card && el('cards').contains(card) ? card : null;
  };
  const onContextMenu = (event: MouseEvent): void => {
    const card = cardAt(event.target); if (!card) return;
    event.preventDefault(); event.stopPropagation();
    const rect = card.getBoundingClientRect();
    showContextMenu(card, event.clientX || rect.left + rect.width / 2, event.clientY || rect.top + rect.height / 2);
  };
  const onCardKey = (event: KeyboardEvent): void => {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
    const card = cardAt(event.target); if (!card) return;
    event.preventDefault(); event.stopPropagation(); const rect = card.getBoundingClientRect();
    showContextMenu(card, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  const onMenuKey = (event: KeyboardEvent): void => {
    if (!contextMenu) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeContextMenu(true); }
    else if (event.key === 'Tab') closeContextMenu(true);
    else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); contextMenu.querySelector<HTMLButtonElement>('button')?.focus();
    }
  };
  const onOutsidePointer = (event: Event): void => { if (!contextMenu?.contains(event.target as Node)) closeContextMenu(); };
  const onOutsideFocus = (event: FocusEvent): void => { if (contextMenu && !contextMenu.contains(event.target as Node)) closeContextMenu(); };
  const onViewportChange = (): void => closeContextMenu();
  const visibilityObserver = new MutationObserver(() => { if (root.closest('[hidden]')) { closeContextMenu(); ownedDetail.close(); shareView.close(); } });
  for (let parent: HTMLElement | null = root; parent; parent = parent.parentElement) visibilityObserver.observe(parent, { attributes: true, attributeFilter: ['hidden'] });
  root.addEventListener('contextmenu', onContextMenu); root.addEventListener('keydown', onCardKey);
  doc.addEventListener('pointerdown', onOutsidePointer, true); doc.addEventListener('focusin', onOutsideFocus, true);
  doc.addEventListener('keydown', onMenuKey, true); doc.addEventListener('scroll', onViewportChange, true);
  doc.defaultView?.addEventListener('resize', onViewportChange); doc.defaultView?.addEventListener('blur', onViewportChange);
  const renderCards = (): void => {
    closeContextMenu();
    const term = search.value.trim().toLowerCase();
    const matches = heroes.filter(hero => (!rarity || hero.rarity === rarity) && (!term || hero.name.includes(term) || hero.pinyin.toLowerCase().includes(term))
      && (ownershipFilter === 'all' || Boolean(snapshot && (ownershipFilter === 'owned' ? snapshot.counts[hero.id] : !snapshot.counts[hero.id]))));
    el('cards').replaceChildren(); el('list').scrollTop = 0;
    for (const hero of matches) {
      const card = doc.createElement('button'); card.type = 'button'; card.className = 'shikigami-atlas-card'; card.dataset.heroId = String(hero.id);
      card.setAttribute('aria-pressed', String(hero.id === selected.id)); card.setAttribute('aria-label', `查看${HERO_RARITIES[hero.rarity]} ${hero.name}的属性与技能`);
      card.title = hero.name;
      const top = text(card, 'span', '', 'shikigami-atlas-card-top'); appendHeroRarity(text(top, 'small', '', 'shikigami-atlas-card-rarity'), hero.rarity);
      const ownership = text(top, 'small', ownershipLabel(hero.id), 'shikigami-atlas-card-ownership');
      ownership.classList.toggle('is-owned', Boolean(snapshot?.counts[hero.id]));
      appendPickerPortrait(card, 'hero', hero.id, hero.name);
      text(card, 'strong', hero.name, 'shikigami-atlas-card-name');
      const stats = text(card, 'span', '', 'shikigami-atlas-card-meta');
      if (hero.base) { text(stats, 'small', `速度${hero.base.speed}`); text(stats, 'small', `暴击${(hero.base.crit * 100).toFixed(0)}%`); }
      else text(stats, 'small', '基础面板暂缺');
      card.addEventListener('click', () => choose(hero)); el('cards').append(card);
    }
    el('count').textContent = `${matches.length} / ${heroes.length} 位式神`;
    if (!matches.length) text(el('cards'), 'p', '没有找到式神，试试其他名称或分类。', 'shikigami-atlas-empty');
  };
  for (const value of [0, 6, 5, 4, 3, 2, 1]) {
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = value ? HERO_RARITIES[value] : '全部'; button.dataset.rarity = String(value); button.setAttribute('aria-pressed', String(value === rarity));
    if (value) { button.replaceChildren(); appendHeroRarity(button, value); }
    button.addEventListener('click', () => { rarity = value; for (const item of el('rarities').querySelectorAll<HTMLButtonElement>('button')) item.setAttribute('aria-pressed', String(Number(item.dataset.rarity) === rarity)); renderCards(); });
    el('rarities').append(button);
  }
  const ownedFilter = doc.createElement('select'); ownedFilter.dataset.atlas = 'ownership-filter'; ownedFilter.setAttribute('aria-label', '按式神拥有情况筛选');
  for (const [value, label] of [['all', '全部拥有情况'], ['owned', '已拥有'], ['missing', '未拥有']]) {
    const option = doc.createElement('option'); option.value = value; option.textContent = label; ownedFilter.append(option);
  }
  ownedFilter.disabled = true; el('rarities').append(ownedFilter);
  ownedFilter.addEventListener('change', () => { ownershipFilter = ownedFilter.value; renderCards(); });
  const error = (value: unknown): void => {
    el('ownership-status').textContent = `${value instanceof Error ? value.message : String(value)}${snapshot ? '；保留上次检测结果。' : '；拥有情况仍为未知。'}`;
    el('ownership-status').classList.add('is-error');
  };
  const applySnapshot = (value: HeroOwnershipSnapshot | null): void => {
    ownedDetail.close();
    shareView.close();
    snapshot = value; ownedFilter.disabled = !snapshot;
    if (!snapshot) { ownershipFilter = 'all'; ownedFilter.value = 'all'; }
    renderCards(); renderDetail(); showCacheStatus();
  };
  const load = async (): Promise<void> => {
    const id = instance.value, version = ++loadVersion; applySnapshot(null);
    if (!id || !api?.loadHeroOwnership) return;
    try {
      const cached = await api.loadHeroOwnership(id);
      if (disposed || version !== loadVersion) return;
      if (cached && !readHeroOwnership(cached, id)) throw new Error('保存的仓库数据不完整，请重新检测');
      applySnapshot(cached);
    } catch (value) { if (!disposed && version === loadVersion) error(value); }
  };
  const refreshInstances = async (): Promise<void> => {
    if (busy || refreshing || !api?.listHeroInstances) return;
    refreshing = true; updateControls();
    try {
      const next = await api.listHeroInstances(); if (disposed) return;
      const previous = instance.value || api.readLayout('hero-ownership.selected-instance') || (doc.getElementById('soul-instance') as HTMLSelectElement | null)?.value || '';
      instances = next; instance.replaceChildren();
      const blank = doc.createElement('option'); blank.value = ''; blank.textContent = '请选择实例'; instance.append(blank);
      for (const item of instances) {
        const option = doc.createElement('option'); option.value = item.id;
        option.textContent = `${item.displayName || item.id.replace(/^mumu-(\d+)$/, 'MuMu $1')}（${item.online ? '在线' : '历史 · 离线'}）`; instance.append(option);
      }
      instance.value = instances.some(item => item.id === previous) ? previous : instances[0]?.id ?? '';
      api.writeLayout('hero-ownership.selected-instance', instance.value || null);
      void load();
    } catch (value) { if (!disposed) error(value); }
    finally { refreshing = false; if (!disposed) updateControls(); }
  };
  instance.addEventListener('change', () => { api?.writeLayout('hero-ownership.selected-instance', instance.value || null); updateControls(); void load(); });
  refresh.addEventListener('click', () => { void refreshInstances(); });
  detect.addEventListener('click', async () => {
    const id = instance.value; if (busy || detect.disabled || !api?.detectHeroOwnership) return;
    busy = true; ++loadVersion; updateControls(); el('ownership-status').textContent = '正在检测，请保持游戏式神录打开…';
    try {
      const result = await api.detectHeroOwnership(id); if (disposed) return;
      if (result && !readHeroOwnership(result, id)) throw new Error('返回的仓库数据不完整或与所选实例不一致');
      if (result) applySnapshot(result);
      else { showCacheStatus(); el('ownership-status').textContent += ' · 已取消检测'; }
    } catch (value) { if (!disposed) error(value); }
    finally { busy = false; if (!disposed) { updateControls(); el<HTMLButtonElement>('cancel').disabled = false; } }
  });
  el('cancel').addEventListener('click', () => {
    el<HTMLButtonElement>('cancel').disabled = true;
    void api?.cancelHeroDetection(instance.value).catch(value => { if (!disposed) { error(value); el<HTMLButtonElement>('cancel').disabled = false; } });
  });
  const stopProgress = api?.onHeroDetectionProgress?.(event => {
    if (!disposed && busy && event.instanceId === instance.value) el('ownership-status').textContent = `${event.message}${event.total !== undefined ? ` ${event.completed ?? 0} / ${event.total}` : ''}`;
  });
  updateControls(); showCacheStatus(); void refreshInstances();
  search.addEventListener('input', renderCards); renderCards(); renderDetail();
  return () => {
    disposed = true; ++loadVersion; closeContextMenu(); visibilityObserver.disconnect();
    root.removeEventListener('contextmenu', onContextMenu); root.removeEventListener('keydown', onCardKey);
    doc.removeEventListener('pointerdown', onOutsidePointer, true); doc.removeEventListener('focusin', onOutsideFocus, true);
    doc.removeEventListener('keydown', onMenuKey, true); doc.removeEventListener('scroll', onViewportChange, true);
    doc.defaultView?.removeEventListener('resize', onViewportChange); doc.defaultView?.removeEventListener('blur', onViewportChange);
    stopProgress?.(); if (busy) void api?.cancelHeroDetection(instance.value).catch(() => undefined);
    shareView.dispose(); ownedDetail.dispose(); termView.dispose(); search.removeEventListener('input', renderCards); root.replaceChildren();
  };
}

/** Keep both pages mounted so switching columns preserves backpack and atlas state. */
export function installTeamBuilderPages(container: HTMLElement, api: Pick<OnmyojiDesktopApi, 'searchLineups' | 'openLineupPost' | 'openLineupUrl' | 'openLineupSource' | 'readLayout' | 'writeLayout'> & Partial<OwnershipApi>): () => void {
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('.team-builder-categories [role="tab"]')];
  const atlas = container.querySelector<HTMLElement>('#team-builder-shikigami-atlas')!;
  const lineupBrowser = container.querySelector<HTMLElement>('#team-builder-lineup-browser')!;
  const disposeAtlas = installShikigamiAtlas(atlas, api as OwnershipApi);
  const lineups = installLineupBrowser(lineupBrowser, api);
  const choose = (tab: HTMLButtonElement): void => {
    for (const item of tabs) {
      const active = item === tab; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
      container.querySelector<HTMLElement>(`#${item.getAttribute('aria-controls')}`)!.hidden = !active;
    }
    container.querySelector('.team-builder-content > .team-builder-pane-header')!.textContent = tab.textContent;
    const preview = container.querySelector<HTMLElement>('#soul-detail-window'); if (preview?.matches(':popover-open')) preview.hidePopover();
    if (tab.id === 'team-builder-tab-lineup-browser') lineups.load();
  };
  const click = (event: Event): void => choose(event.currentTarget as HTMLButtonElement);
  const key = (event: KeyboardEvent): void => {
    const index = tabs.indexOf(event.currentTarget as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowDown' ? (index + 1) % tabs.length : event.key === 'ArrowUp' ? (index + tabs.length - 1) % tabs.length : -1;
    if (next < 0) return; event.preventDefault(); event.stopPropagation(); choose(tabs[next]); tabs[next].focus();
  };
  for (const tab of tabs) { tab.addEventListener('click', click); tab.addEventListener('keydown', key); }
  choose(tabs.find(tab => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]);
  return () => { for (const tab of tabs) { tab.removeEventListener('click', click); tab.removeEventListener('keydown', key); } disposeAtlas(); lineups.dispose(); };
}
