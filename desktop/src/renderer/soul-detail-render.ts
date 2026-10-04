import type { SoulRecord, SoulAttribute } from '../shared/souls';
import { createSoulPositionPortrait } from './soul-position-portrait';
import { appendEffectNumbers } from './effect-text';

/** 御魂单件详情：背包列表面板和配装面板各自的浮窗共用同一份渲染。 */
export function renderSoulDetail(doc: Document, detail: HTMLElement, selected?: SoulRecord,
  options: { hideIdentity?: boolean; hideSetEffects?: boolean; hideRecordId?: boolean } = {}): void {
  const add = (parent: HTMLElement, tag: string, text: string, className = ''): HTMLElement => {
    const item = doc.createElement(tag); item.textContent = text; item.className = className; parent.append(item); return item;
  };
  const attributeRow = (parent: HTMLElement, attr: SoulAttribute, className: string, prefix = ''): HTMLElement => {
    const row = add(parent, 'div', '', className);
    add(row, 'span', `${prefix}${attr.label} `, 'soul-detail-attribute-label');
    add(row, 'span', formatSoulAttribute(attr).slice(attr.label.length + 1), 'soul-detail-attribute-value');
    return row;
  };
  detail.replaceChildren();
  if (!selected) { add(detail, 'p', '选择一条御魂查看详情'); return; }
  if (!options.hideIdentity) {
    const head = add(detail, 'div', '', 'soul-detail-head'); head.append(createSoulPositionPortrait(doc, selected));
    const identity = add(head, 'div', '', 'soul-detail-identity');
    add(identity, 'h3', selected.name ?? `套装 ${selected.suitId}`);
    add(identity, 'p', `${selected.position ?? '—'} 号位 · ${selected.stars ?? '—'} 星 · +${selected.level ?? '—'}`, 'soul-detail-meta');
  }
  const badges = add(detail, 'div', '', 'soul-card-badges soul-detail-badges');
  const lock = add(badges, 'span', selected.locked ? '锁' : '未锁定', selected.locked ? 'soul-card-lock' : '');
  lock.title = selected.locked ? '已锁定' : '未锁定'; lock.setAttribute('aria-label', lock.title);
  add(badges, 'span', selected.equipped ? '已装备' : '未装备', selected.equipped ? 'soul-card-equipped' : '');
  if (selected.discarded) { const discarded = add(badges, 'span', '弃', 'soul-card-discarded'); discarded.title = '已弃置'; discarded.setAttribute('aria-label', discarded.title); }
  const main = add(detail, 'div', '', 'soul-detail-main');
  if (selected.mainAttribute) attributeRow(main, selected.mainAttribute, 'soul-main-attribute');
  else add(main, 'div', '主属性待解析', 'soul-main-attribute');
  const subs = add(detail, 'div', '', 'soul-detail-subs');
  for (const attr of selected.subAttributes ?? []) {
    const row = attributeRow(subs, attr, 'soul-sub-attribute');
    row.dataset.attribute = attr.name;
    if (attr.rolls > 1) {
      const badge = add(row, 'span', String(attr.rolls - 1), 'soul-upgrade-count');
      badge.setAttribute('aria-label', `强化 ${attr.rolls - 1} 次`);
    }
  }
  if (!selected.attributesComplete) add(subs, 'p', '部分副属性配置尚未加载，数值待解析。', 'soul-detail-pending');
  else if (!selected.subAttributes?.length) add(subs, 'p', '暂无副属性', 'soul-detail-pending');
  if (selected.intrinsicAttributes?.length) {
    const intrinsic = add(detail, 'div', '', 'soul-intrinsic-attributes');
    for (const attr of selected.intrinsicAttributes) attributeRow(intrinsic, attr, 'soul-intrinsic-attribute', '固有属性：');
  }
  if (!options.hideSetEffects && selected.setEffects?.length) {
    const effects = add(detail, 'div', '', 'soul-detail-effects');
    add(effects, 'div', '套装效果', 'soul-detail-caption');
    for (const effect of selected.setEffects) {
      const paragraph = add(effects, 'p', '', 'soul-set-effect');
      appendEffectNumbers(paragraph, effect, 'soul-effect-number');
    }
  }
  if (!options.hideRecordId) {
    const id = add(detail, 'div', '', 'soul-detail-id');
    add(id, 'span', `套装编号 ${selected.suitId}`);
    add(id, 'span', selected.id, 'soul-detail-record-id');
  }
}

export function formatSoulAttribute(attr: SoulAttribute): string {
  return `${attr.label} +${(attr.value * (attr.percent ? 100 : 1)).toFixed(2)}${attr.percent ? '%' : ''}`;
}
