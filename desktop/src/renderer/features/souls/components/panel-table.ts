import { PANEL_LABELS, type Panel, type PanelKey } from '../../../../shared/soul-optimizer';

export type PanelAddition = Record<PanelKey, number | null>;
const PERCENT = new Set<PanelKey>(['crit', 'critDamage', 'hit', 'resist']);

export function formatPanelValue(key: PanelKey, value: number | null, addition = false): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1e-9) value = 0;
  return `${addition && value >= 0 ? '+' : ''}${(value * (PERCENT.has(key) ? 100 : 1)).toFixed(2)}${PERCENT.has(key) ? '%' : ''}`;
}

/** Fixed-panel increments are total minus the exact base used for this saved/search result. */
export function planPanelAddition(total: Panel, base?: Panel): PanelAddition {
  return Object.fromEntries((Object.keys(PANEL_LABELS) as PanelKey[]).map(key => [key, base ? total[key] - base[key] : null])) as PanelAddition;
}

export function renderSoulPanelTable(doc: Document, container: HTMLElement, addition: PanelAddition, total: Panel | null,
  options: { split?: boolean; additionClass?: string; totalClass?: string } = {}): void {
  container.replaceChildren();
  const add = (parent: HTMLElement, tag: string, text: string, className = ''): HTMLElement => {
    const node = doc.createElement(tag); node.textContent = text; node.className = className; parent.append(node); return node;
  };
  const groups: PanelKey[][] = options.split ? [['attack', 'hp', 'defense', 'speed'], ['crit', 'critDamage', 'hit', 'resist']]
    : [['attack', 'hp', 'defense', 'speed', 'crit', 'critDamage', 'hit', 'resist']];
  for (const keys of groups) {
    const table = add(container, 'table', '');
    const head = add(table, 'thead', ''), heading = add(head, 'tr', '');
    for (const label of ['属性', '御魂加成', '总属性']) { const cell = add(heading, 'th', label) as HTMLTableCellElement; cell.scope = 'col'; }
    const body = add(table, 'tbody', '');
    for (const key of keys) {
      const row = add(body, 'tr', ''); row.dataset.panelKey = key;
      const label = add(row, 'th', PANEL_LABELS[key]) as HTMLTableCellElement; label.scope = 'row';
      add(add(row, 'td', '', options.additionClass ?? 'soul-panel-addition'), 'strong', formatPanelValue(key, addition[key], true));
      add(add(row, 'td', '', options.totalClass ?? 'soul-panel-total'), 'strong', formatPanelValue(key, total?.[key] ?? null));
    }
  }
}
