import type { SoulRecord } from '../../../../shared/souls';

export const selectedSoulFilterValues = (select: HTMLSelectElement): string[] =>
  Array.from(select.selectedOptions, option => option.value).filter(Boolean);

/** Visible choices share the existing filter values and update immediately. */
export function installSoulFilterView(root: HTMLElement, selects: HTMLSelectElement[], search: HTMLInputElement): { refresh(souls: SoulRecord[]): void; dispose(): void } {
  const doc = root.ownerDocument;
  const chips = root.querySelector<HTMLElement>('#soul-active-filters')!;
  const suit = root.querySelector<HTMLSelectElement>('#soul-suit')!;
  const picker = root.querySelector<HTMLDetailsElement>('#soul-type-picker')!;
  const suitLabel = root.querySelector<HTMLElement>('#soul-suit-label')!;
  const suitSearch = root.querySelector<HTMLInputElement>('#soul-type-search')!;
  const suitOptions = root.querySelector<HTMLElement>('#soul-type-options')!;
  const subs = root.querySelector<HTMLElement>('#soul-sub-attributes')!;
  const cleanup: Array<() => void> = [];
  const groups = Array.from(root.querySelectorAll<HTMLElement>('[data-soul-choice]'));
  for (const select of selects) select.multiple = true;
  let source: SoulRecord[] = [];
  let suitSignature = '';
  const button = (label: string): HTMLButtonElement => {
    const item = doc.createElement('button'); item.type = 'button'; item.textContent = label; return item;
  };
  const change = (select: HTMLSelectElement, value: string): void => {
    const selected = new Set(selectedSoulFilterValues(select));
    if (!value) selected.clear(); else if (selected.has(value)) selected.delete(value); else selected.add(value);
    for (const option of select.options) option.selected = selected.has(option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const drawTypes = (): void => {
    const term = suitSearch.value.trim(); suitOptions.replaceChildren();
    const icons = new Map(source.map(soul => [String(soul.suitId), soul.iconUrl]));
    const values = selectedSoulFilterValues(suit);
    for (const option of Array.from(suit.options)) {
      if (term && option.value && !option.textContent?.includes(term)) continue;
      const item = button(''); item.className = 'soul-type-option'; item.dataset.value = option.value;
      item.setAttribute('aria-pressed', String(option.value ? values.includes(option.value) : !values.length));
      const url = icons.get(option.value);
      if (url) {
        const image = doc.createElement('img'); image.src = url; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; item.append(image);
      } else { const placeholder = doc.createElement('span'); placeholder.className = 'soul-type-placeholder'; placeholder.textContent = option.value ? (option.textContent ?? '').slice(0, 1) : '全'; item.append(placeholder); }
      const label = doc.createElement('span'); label.textContent = option.value ? option.textContent : '全部'; item.append(label);
      item.addEventListener('click', () => change(suit, option.value)); suitOptions.append(item);
    }
  };
  const refresh = (souls: SoulRecord[]): void => {
    const sourceChanged = source !== souls; source = souls;
    for (const group of groups) {
      const select = selects.find(item => item.id === group.dataset.soulChoice)!;
      const signature = Array.from(select.options).map(option => option.value + ':' + option.textContent).join('|');
      if (group.dataset.signature !== signature) {
        group.dataset.signature = signature; group.replaceChildren();
        const options = Array.from(select.options);
        if (select.id === 'soul-main-attribute' && options.filter(option => option.value).length === 1) {
          const fixed = doc.createElement('span'); fixed.className = 'soul-fixed-main';
          fixed.textContent = `${options.find(option => option.value)!.textContent}（固定）`;
          group.append(fixed);
          continue;
        }
        if (select.id === 'soul-stars') options.sort((a, b) => Number(a.value) - Number(b.value));
        for (const option of options) {
          let label = option.value ? option.textContent ?? '' : '全部';
          if (select.id === 'soul-position' && option.value) label = label.replace('号位', '');
          if (select.id === 'soul-sub-count' && option.value) label = `${option.value} 条`;
          if (select.id === 'soul-level' && option.value) label = option.value.replace('-', '–');
          if (select.id === 'soul-stars' && option.value) label = `${option.value} 星`;
          const item = button(label); item.dataset.value = option.value; item.className = 'soul-choice';
          item.addEventListener('click', () => change(select, option.value)); group.append(item);
        }
      }
      const values = selectedSoulFilterValues(select);
      for (const item of group.querySelectorAll<HTMLButtonElement>('button')) item.setAttribute('aria-pressed', String(item.dataset.value ? values.includes(item.dataset.value) : !values.length));
    }
    const selectedTypes = Array.from(suit.selectedOptions).filter(option => option.value);
    suitLabel.textContent = selectedTypes.length > 2 ? `已选 ${selectedTypes.length} 种御魂` : selectedTypes.map(option => option.textContent).join('、') || '全部类型';
    const signature = Array.from(suit.options).map(option => option.value + option.textContent).join('|');
    if (signature !== suitSignature || sourceChanged) { suitSignature = signature; drawTypes(); }
    const typeValues = selectedSoulFilterValues(suit);
    for (const item of suitOptions.querySelectorAll<HTMLButtonElement>('button')) item.setAttribute('aria-pressed', String(item.dataset.value ? typeValues.includes(item.dataset.value) : !typeValues.length));
    chips.replaceChildren();
    const addChip = (label: string, clear: () => void): void => {
      const chip = button(label + ' ×'); chip.className = 'soul-active-chip'; chip.setAttribute('aria-label', `移除${label}筛选`);
      chip.addEventListener('click', clear); chips.append(chip);
    };
    if (search.value.trim()) addChip(`搜索：${search.value.trim()}`, () => { search.value = ''; search.dispatchEvent(new Event('input')); });
    for (const select of selects) for (const option of Array.from(select.selectedOptions)) {
      if (option.value) addChip(option.textContent ?? option.value, () => change(select, option.value));
    }
    for (const input of subs.querySelectorAll<HTMLInputElement>('input:checked')) {
      const label = input.closest<HTMLElement>('.soul-sub-rule')!.dataset.label;
      addChip(`${input.dataset.mode === 'exclude' ? '排除' : ''}副属性：${label}`, () => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
    }
    for (const row of subs.querySelectorAll<HTMLElement>('.soul-sub-rule')) for (const choice of row.querySelectorAll<HTMLButtonElement>('button')) {
      choice.setAttribute('aria-pressed', String(row.querySelector<HTMLInputElement>(`input[data-mode="${choice.dataset.mode}"]`)!.checked));
    }
    chips.hidden = !chips.childElementCount;
  };
  suitSearch.addEventListener('input', drawTypes); cleanup.push(() => suitSearch.removeEventListener('input', drawTypes));
  const opened = (): void => { if (picker.open) drawTypes(); };
  picker.addEventListener('toggle', opened); cleanup.push(() => picker.removeEventListener('toggle', opened));
  return { refresh, dispose: () => cleanup.forEach(fn => fn()) };
}
