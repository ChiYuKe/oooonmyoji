import type { HeroProfile, SuitProfile } from '../../../../shared/soul-optimizer';
import type { SoulSnapshot } from '../../../../shared/souls';

export const HERO_RARITIES: Record<number, string> = { 1: 'N', 2: 'R', 3: 'SR', 4: 'SSR', 5: 'SP', 6: 'UR' };
export function appendHeroRarity(parent: HTMLElement, rarity: number): void {
  const label = parent.ownerDocument.createElement('span');
  label.className = 'hero-rarity'; label.dataset.rarity = String(rarity);
  label.textContent = HERO_RARITIES[rarity] ?? ''; parent.append(label);
}
export const SUIT_ATTRIBUTES: Record<string, string> = { attackAdditionRate: '攻击加成', critRateAdditionVal: '暴击', critPowerAdditionVal: '暴击伤害', defenseAdditionRate: '防御加成', maxHpAdditionRate: '生命加成', debuffEnhance: '效果命中', debuffResist: '效果抵抗' };

export function appendPickerPortrait(parent: HTMLElement, kind: 'hero' | 'soul', id: number, name: string): void {
  const doc = parent.ownerDocument;
  const portrait = doc.createElement('span'); portrait.className = `soul-picker-portrait soul-picker-portrait-${kind}`;
  const fallback = doc.createElement('span'); fallback.textContent = name.slice(0, 1); portrait.append(fallback);
  const image = doc.createElement('img'); image.src = `onmyoji-resource://project/assets/${kind === 'hero' ? 'hero' : 'soul'}-icons/${id}.png`;
  image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
  image.addEventListener('error', () => image.remove(), { once: true }); portrait.append(image); parent.append(portrait);
}

interface PickerOptions {
  heroes: HeroProfile[]; suits: SuitProfile[];
  hero(): HeroProfile; suit(kind: 'four' | 'two'): string; snapshot(): SoulSnapshot | undefined;
  chooseHero(id: number): void; chooseSuit(kind: 'four' | 'two', value: string): void;
  closePreview(): void;
}

/** A modal card browser, kept separate from the calculation form and its values. */
export function installOptimizerPicker(root: HTMLElement, options: PickerOptions): { openHero(): void; openSuit(kind: 'four' | 'two'): void; close(): void; dispose(): void } {
  const doc = root.ownerDocument;
  const picker = doc.createElement('dialog'); picker.className = 'soul-optimizer soul-optimizer-picker'; picker.id = 'soul-optimizer-picker';
  picker.setAttribute('aria-labelledby', 'soul-picker-title');
  picker.innerHTML = `<header class="soul-optimizer-header"><div><h2 id="soul-picker-title"></h2><p data-picker="note"></p></div><button type="button" data-picker="close" aria-label="关闭选择器">×</button></header>
    <div class="soul-picker-toolbar"><div data-picker="tabs" class="soul-picker-tabs"></div><input type="search" data-ui="hero-search" data-picker="search" placeholder="搜索名称或拼音" aria-label="搜索选择项"></div>
    <div class="soul-picker-browser"><nav data-picker="categories" aria-label="选择分类"></nav><div class="soul-picker-scroll"><div data-picker="cards" class="soul-picker-cards"></div></div></div>
    <footer class="soul-picker-footer"><span data-picker="selection"></span><button type="button" data-picker="clear">不限套装</button></footer>`;
  root.append(picker);
  const el = <T extends HTMLElement>(name: string): T => picker.querySelector<T>(`[data-picker="${name}"]`)!;
  const search = el<HTMLInputElement>('search');
  let mode: 'hero' | 'four' | 'two' = 'hero', category = '';
  const text = (parent: HTMLElement, tag: string, value: string, className = ''): HTMLElement => { const child = doc.createElement(tag); child.textContent = value; child.className = className; parent.append(child); return child; };
  const button = (parent: HTMLElement, label: string, pressed: boolean, choose: () => void): HTMLButtonElement => {
    const item = doc.createElement('button'); item.type = 'button'; item.textContent = label; item.setAttribute('aria-pressed', String(pressed));
    item.addEventListener('click', () => {
      choose();
      if (picker.open && !item.isConnected) [...parent.querySelectorAll('button')].find(next => next.textContent === label)?.focus();
    });
    parent.append(item); return item;
  };
  const chooseSuit = (value: string): void => { if (mode === 'hero') return; options.chooseSuit(mode, value); picker.close(); };
  const render = (): void => {
    el('cards').replaceChildren(); el('tabs').replaceChildren(); el('categories').replaceChildren();
    const term = search.value.trim().toLowerCase();
    const title = picker.querySelector('#soul-picker-title')!;
    picker.dataset.mode = mode;
    title.textContent = mode === 'hero' ? '选择式神' : '选择御魂套装';
    search.placeholder = mode === 'hero' ? '搜索式神名称或拼音' : '搜索御魂名称或加成属性';
    search.setAttribute('aria-label', mode === 'hero' ? '搜索式神名称或拼音' : '搜索御魂名称或加成属性');
    el('clear').hidden = mode === 'hero';
    const categories: Array<[string, string]> = mode === 'hero' ? [['', '全部式神'], ...[6, 5, 4, 3, 2, 1].map(rarity => [String(rarity), HERO_RARITIES[rarity]] as [string, string])] : [['', '全部'], ...Object.entries(SUIT_ATTRIBUTES), ['boss', '单件属性']];
    for (const [value, label] of categories) {
      const item = button(el('categories'), label, category === value, () => { category = value; render(); el('cards').parentElement!.scrollTop = 0; });
      if (mode === 'hero' && value) { item.replaceChildren(); appendHeroRarity(item, Number(value)); }
    }
    let count = 0;
    if (mode === 'hero') {
      text(el('tabs'), 'strong', '式神录');
      el('note').textContent = '六星 · 40 级基础面板，选择后自动填入';
      el('selection').textContent = '当前选择：'; appendHeroRarity(el('selection'), options.hero().rarity); el('selection').append(` · ${options.hero().name}`);
      for (const hero of [...options.heroes].sort((a, b) => b.rarity - a.rarity || a.id - b.id)) {
        if ((category && String(hero.rarity) !== category) || (term && !hero.name.includes(term) && !hero.pinyin.toLowerCase().includes(term))) continue;
        count++;
        const card = button(el('cards'), '', options.hero().id === hero.id, () => { options.chooseHero(hero.id); picker.close(); });
        card.className = 'soul-picker-card'; card.dataset.heroId = String(hero.id); card.disabled = !hero.base;
        appendPickerPortrait(card, 'hero', hero.id, hero.name);
        const info = text(card, 'span', '', 'soul-picker-card-info'); text(info, 'strong', hero.name);
        const meta = text(info, 'small', '', 'soul-picker-card-meta'); appendHeroRarity(meta, hero.rarity); meta.append(` · ${hero.awake ? '觉醒后' : '无需觉醒'}`);
        text(info, 'small', hero.base ? `速度 ${hero.base.speed} · 暴击 ${(hero.base.crit * 100).toFixed(0)}%` : '基础面板暂缺');
      }
    } else {
      for (const [kind, label] of [['four', '四件套'], ['two', '两件套']] as const) button(el('tabs'), label, mode === kind, () => { mode = kind; if (kind === 'four' && category === 'boss') category = ''; render(); el('cards').parentElement!.scrollTop = 0; });
      el('note').textContent = mode === 'four' ? '选择具体四件套，按两件套加成分类' : '选择两件套属性，或指定带固定属性的首领御魂';
      const value = options.suit(mode);
      el('selection').textContent = `当前${mode === 'four' ? '四' : '两'}件套：${value.startsWith('attr:') ? SUIT_ATTRIBUTES[value.slice(5)] : options.suits.find(s => String(s.id) === value)?.name ?? '不限'}`;
      const addCard = (value: string, name: string, subtitle: string, id?: number, description?: string): void => {
        count++; const card = button(el('cards'), '', options.suit(mode as 'four' | 'two') === value, () => chooseSuit(value));
        card.className = 'soul-picker-card'; card.dataset.suitValue = value;
        if (id) appendPickerPortrait(card, 'soul', id, name);
        else text(card, 'span', name.slice(0, 2), 'soul-picker-attribute-icon');
        const info = text(card, 'span', '', 'soul-picker-card-info'); text(info, 'strong', name); text(info, 'small', subtitle, 'soul-picker-card-meta');
        if (description) { const note = text(info, 'small', description, 'soul-picker-card-effect'); note.title = description; }
      };
      if (mode === 'two' && category !== 'boss') for (const [key, name] of Object.entries(SUIT_ATTRIBUTES)) {
        if ((category && category !== key) || (term && !name.includes(term))) continue;
        addCard(`attr:${key}`, name, '两件套属性', undefined, '对应属性的套装均可参与');
      }
      const counts = new Map<number, number>(); for (const soul of options.snapshot()?.souls ?? []) if (soul.suitId !== null) counts.set(soul.suitId, (counts.get(soul.suitId) ?? 0) + 1);
      for (const suit of [...options.suits].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
        if (mode === 'four' ? suit.boss : !suit.boss) continue;
        if (category && (category === 'boss' ? !suit.boss : suit.bonus?.name !== category)) continue;
        const bonus = suit.bonus ? `${SUIT_ATTRIBUTES[suit.bonus.name] ?? suit.bonus.name} +${Math.round(suit.bonus.value * 100)}%` : '首领御魂 · 固有属性';
        if (term && !suit.name.includes(term) && !bonus.includes(term)) continue;
        addCard(String(suit.id), suit.name, `${bonus} · 背包 ${counts.get(suit.id) ?? 0} 件`, suit.id, suit.four);
      }
    }
    if (!count) text(el('cards'), 'p', '没有匹配的结果，试试其他名称或分类。', 'soul-picker-empty');
    text(el('tabs'), 'small', `${count} 项`, 'soul-picker-count');
  };
  const open = (next: typeof mode): void => { mode = next; category = ''; search.value = ''; options.closePreview(); render(); picker.showModal(); search.focus(); };
  const close = (): void => { if (picker.open) picker.close(); };
  el('close').addEventListener('click', close); el('clear').addEventListener('click', () => chooseSuit(''));
  picker.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
  picker.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); close(); });
  search.addEventListener('input', render);
  picker.addEventListener('close', () => { options.closePreview(); root.querySelector<HTMLButtonElement>(`[data-action="choose-${mode}"]`)?.focus(); });
  return { openHero: () => open('hero'), openSuit: kind => open(kind), close, dispose: () => { close(); picker.remove(); } };
}
