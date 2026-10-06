import type { HeroProfile, SuitProfile } from '../../../../shared/soul-optimizer';
import { appendPickerPortrait, appendHeroRarity, HERO_RARITIES, SUIT_ATTRIBUTES } from '../optimizer/picker';

interface PickerOptions {
  heroes: HeroProfile[]; suits: SuitProfile[];
  hero(): number; suit(kind: 'four' | 'two'): string;
  chooseHero(id: number): void; chooseSuit(kind: 'four' | 'two', value: string): void;
  allowClear?: boolean; ariaLabel?: string;
  clearHero?(): void; clearLabel?: string; contextLabel?(): string; suitTitle?: string;
  showSuitEffect?: boolean;
  suitEligible?(suit: SuitProfile, kind: 'four' | 'two'): boolean;
}

/** A bounded, searchable browser for the community's concrete heroes and suits. */
export function installCommunityPicker(root: HTMLElement, options: PickerOptions): {
  openHero(trigger: HTMLElement): void; openSuit(kind: 'four' | 'two', trigger: HTMLElement): void; close(): void; dispose(): void;
} {
  const doc = root.ownerDocument, dialog = doc.createElement('dialog');
  dialog.className = 'soul-community soul-community-picker'; dialog.setAttribute('aria-label', options.ariaLabel ?? '选择社区筛选项');
  dialog.innerHTML = `<div class="soul-community-heading"><h3 data-community="picker-title"></h3><button type="button" data-community="picker-close" aria-label="关闭选择器">×</button></div>
    <input type="search" data-community="picker-search" placeholder="搜索名称" aria-label="搜索选择项" autocomplete="off">
    <div class="soul-community-picker-browser"><nav data-community="picker-categories" aria-label="选择分类"></nav><div class="soul-community-picker-scroll"><div data-community="picker-cards" class="soul-community-picker-cards"></div></div></div>
    <div class="soul-community-picker-footer"><span data-community="picker-count" role="status"></span><button type="button" data-community="picker-clear">不限套装</button></div>`;
  root.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(name: string): T => dialog.querySelector<T>(`[data-community="picker-${name}"]`)!;
  const search = el<HTMLInputElement>('search');
  let mode: 'hero' | 'four' | 'two' = 'hero', category = '', trigger: HTMLElement | undefined;
  const text = (parent: HTMLElement, tag: string, value: string, className = ''): HTMLElement => {
    const node = doc.createElement(tag); node.textContent = value; node.className = className; parent.append(node); return node;
  };
  const button = (parent: HTMLElement, label: string, selected: boolean, action: () => void): HTMLButtonElement => {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = label; node.setAttribute('aria-pressed', String(selected));
    node.addEventListener('click', action); parent.append(node); return node;
  };
  const close = (): void => { if (dialog.open) { dialog.close(); if (trigger?.isConnected) trigger.focus(); } };
  const chooseSuit = (value: string): void => { if (mode !== 'hero') { options.chooseSuit(mode, value); close(); } };
  const render = (): void => {
    el('cards').replaceChildren(); el('categories').replaceChildren();
    const term = search.value.normalize('NFKC').trim().toLowerCase();
    const suitKind = mode === 'four' ? 'four' : 'two';
    const eligibleSuits = mode === 'hero' ? [] : options.suits.filter(suit => options.suitEligible?.(suit, suitKind) ?? (suitKind !== 'four' || !suit.boss));
    const contextLabel = options.contextLabel?.();
    el('title').textContent = (mode === 'hero' ? '选择式神' : options.suitTitle ?? `选择${mode === 'four' ? '四' : '两'}件套`) + (contextLabel ? ` · ${contextLabel}` : '');
    search.placeholder = mode === 'hero' ? '输入式神名称或拼音' : options.showSuitEffect ? '输入御魂名称或效果' : '输入套装名称或加成属性';
    search.setAttribute('aria-label', search.placeholder); el('clear').hidden = mode === 'hero' ? !options.clearHero : options.allowClear === false;
    el('clear').textContent = options.clearLabel ?? (mode === 'hero' ? '清除式神' : '不限套装');
    const categories: [string, string][] = mode === 'hero'
      ? [['', '全部式神'], ...[6, 5, 4, 3, 2, 1].map(r => [String(r), HERO_RARITIES[r]] as [string, string])]
      : [['', '全部套装'], ...Object.entries(SUIT_ATTRIBUTES), ...(eligibleSuits.some(suit => suit.boss) ? [['boss', '首领御魂'] as [string, string]] : [])];
    for (const [value, label] of categories) {
      const node = button(el('categories'), label, category === value, () => {
        category = value; render(); el('cards').parentElement!.scrollTop = 0;
        el('categories').querySelector<HTMLButtonElement>(`[data-category="${value}"]`)?.focus();
      }); node.dataset.category = value;
      if (mode === 'hero' && value) { node.replaceChildren(); appendHeroRarity(node, Number(value)); }
    }
    let count = 0;
    if (mode === 'hero') {
      for (const hero of [...options.heroes].sort((a, b) => Number(b.id === options.hero()) - Number(a.id === options.hero()) || b.rarity - a.rarity || a.id - b.id)) {
        if (category && String(hero.rarity) !== category || term && !hero.name.toLowerCase().includes(term) && !hero.pinyin.toLowerCase().includes(term)) continue;
        count++;
        const card = button(el('cards'), '', hero.id === options.hero(), () => { options.chooseHero(hero.id); close(); });
        card.className = 'soul-community-picker-card'; card.dataset.heroId = String(hero.id); card.dataset.name = hero.name;
        appendPickerPortrait(card, 'hero', hero.id, hero.name);
        const info = text(card, 'span', '', 'soul-picker-card-info'); text(info, 'strong', hero.name); appendHeroRarity(info, hero.rarity);
      }
    } else {
      const kind = mode;
      for (const suit of [...eligibleSuits].sort((a, b) => Number(String(b.id) === options.suit(kind)) - Number(String(a.id) === options.suit(kind)) || a.name.localeCompare(b.name, 'zh-CN'))) {
        if (category && (category === 'boss' ? !suit.boss : suit.bonus?.name !== category)) continue;
        const bonus = suit.bonus ? `${SUIT_ATTRIBUTES[suit.bonus.name] ?? suit.bonus.name} +${Math.round(suit.bonus.value * 100)}%` : '首领御魂';
        const description = options.showSuitEffect ? suit.four : bonus;
        if (term && !`${suit.name} ${bonus} ${description}`.toLowerCase().includes(term)) continue;
        count++;
        const card = button(el('cards'), '', String(suit.id) === options.suit(kind), () => chooseSuit(String(suit.id)));
        card.className = 'soul-community-picker-card'; card.dataset.suitId = String(suit.id); card.dataset.name = suit.name;
        appendPickerPortrait(card, 'soul', suit.id, suit.name);
        const info = text(card, 'span', '', 'soul-picker-card-info'); text(info, 'strong', suit.name);
        const note = text(info, 'small', description, options.showSuitEffect ? 'soul-picker-card-effect' : '');
        if (options.showSuitEffect) note.title = description;
      }
    }
    el('count').textContent = `${count} 项`;
    if (!count) text(el('cards'), 'p', '没有匹配项，换个名称或分类试试。', 'soul-picker-empty');
  };
  const open = (next: typeof mode, source: HTMLElement): void => {
    trigger = source; mode = next; category = ''; search.value = ''; render();
    if (!dialog.open) dialog.showModal();
    el('cards').parentElement!.scrollTop = 0; search.focus();
  };
  search.addEventListener('input', render);
  el('close').addEventListener('click', close); el('clear').addEventListener('click', () => {
    if (mode === 'hero') { options.clearHero?.(); close(); }
    else if (options.allowClear !== false) chooseSuit('');
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open && trigger?.isConnected) trigger.focus(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    const cards = [...el('cards').querySelectorAll<HTMLButtonElement>('button')], index = cards.indexOf(doc.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = index < 0 ? event.key === 'ArrowDown' ? 0 : cards.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + cards.length) % cards.length;
      cards[next]?.focus();
    } else if (event.key === 'Enter' && doc.activeElement === search) {
      event.preventDefault();
      const term = search.value.normalize('NFKC').trim().toLowerCase(), exact = cards.find(card => card.dataset.name?.toLowerCase() === term);
      if (exact || cards.length === 1) (exact ?? cards[0]).click(); else cards[0]?.focus();
    }
  });
  return { openHero: source => open('hero', source), openSuit: (kind, source) => open(kind, source), close, dispose: () => { close(); dialog.remove(); } };
}
