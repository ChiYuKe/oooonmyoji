import { OPTIMIZATION_OBJECTIVES, formatPlanScore } from '../shared/soul-optimizer';
import type { HeroProfile, OptimizationOptions, Panel, SoulPlan, SuitProfile } from '../shared/soul-optimizer';
import type { SoulRecord, SoulSnapshot } from '../shared/souls';
import { createSoulPositionPortrait } from './soul-position-portrait';
import { appendPickerPortrait, SUIT_ATTRIBUTES } from './soul-optimizer-picker';
import { appendEffectNumbers } from './effect-text';
import { planPanelAddition, renderSoulPanelTable } from './soul-panel-table';
import { installSoulPlanShare } from './soul-plan-share';
import type { ImageShareApi } from './image-share';
import { suitMechanicRanges } from '../shared/soul-substat-standard';
import type { SubstatContext } from '../shared/soul-substat-standard';

export function installSoulPlanDetail(root: HTMLElement, suits: SuitProfile[], preview: (anchor: HTMLElement, soul: SoulRecord, context?: SubstatContext) => void, closePreview: () => void, shareApi?: ImageShareApi): {
  show(plan: SoulPlan, hero: HeroProfile | undefined, snapshot: SoulSnapshot | undefined, base?: Panel, objective?: OptimizationOptions['objective'], ranges?:OptimizationOptions['ranges']): void;
  close(): void; dispose(): void;
} {
  const doc = root.ownerDocument;
  const dialog = doc.createElement('dialog'); dialog.className = 'soul-optimizer soul-plan-detail'; dialog.id = 'soul-plan-detail';
  dialog.setAttribute('aria-labelledby', 'soul-plan-detail-title');
  dialog.innerHTML = `<header class="soul-optimizer-header"><div><h2 id="soul-plan-detail-title">配装详情</h2><p data-plan="note"></p></div><button type="button" aria-label="关闭配装详情">×</button></header><div class="soul-plan-detail-body"><section class="soul-plan-equipment" aria-label="御魂装配"><h3>御魂装配</h3><div data-plan="ring" class="soul-plan-ring"></div></section><section class="soul-plan-overview" aria-label="属性与套装效果"><div data-plan="panel" class="soul-plan-panel"></div><div data-plan="sets" class="soul-plan-effects"></div></section></div>`;
  root.append(dialog);
  const share = installSoulPlanShare(root, shareApi);
  const shareButton = doc.createElement('button'); shareButton.type = 'button'; shareButton.dataset.planShare = ''; shareButton.textContent = '分享';
  shareButton.addEventListener('click', () => { closePreview(); share.show(dialog, shareButton); });
  const actions = doc.createElement('div'); actions.className = 'soul-plan-detail-actions';
  const closeButton = dialog.querySelector<HTMLButtonElement>('button')!;
  actions.append(shareButton, closeButton); dialog.querySelector('header')!.append(actions);
  const el = (name: string): HTMLElement => dialog.querySelector(`[data-plan="${name}"]`)!;
  const add = (parent: HTMLElement, tag: string, value: string, className = ''): HTMLElement => { const item = doc.createElement(tag); item.textContent = value; item.className = className; parent.append(item); return item; };
  const close = (): void => { share.close(); closePreview(); if (dialog.open) dialog.close(); };
  closeButton.addEventListener('click', close);
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
  dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); close(); });
  dialog.addEventListener('close', closePreview);
  dialog.querySelector('.soul-plan-detail-body')!.addEventListener('scroll', closePreview, { passive: true });
  return {
    show(plan, hero, snapshot, base, objective, ranges): void {
      share.close();
      closePreview(); el('ring').replaceChildren(); el('panel').replaceChildren(); el('sets').replaceChildren();
      el('note').textContent = `${hero?.name ?? '收藏方案'} · ${objective ? OPTIMIZATION_OBJECTIVES[objective].label : '原方案'}评分 `;
      add(el('note'), 'strong', formatPlanScore(plan.score, objective), 'soul-plan-detail-score');
      const center = add(el('ring'), 'div', '', 'soul-plan-hero');
      if (hero) { appendPickerPortrait(center, 'hero', hero.id, hero.name); add(center, 'strong', hero.name); }
      else add(center, 'strong', '六件配装');
      add(center, 'small', `${plan.ids.length} 件御魂`);
      const gear=plan.ids.flatMap(id=>snapshot?.souls.find(soul=>soul.id===id)??[]);
      const context:SubstatContext={objective,ranges:suitMechanicRanges(gear,ranges??{}),panel:plan.panel,gear,heroName:hero?.name};
      for (const [index, id] of plan.ids.entries()) {
        const soul = snapshot?.souls.find(item => item.id === id);
        const button = doc.createElement('button'); button.type = 'button'; button.dataset.soulId = id; button.dataset.position = String(index + 1); button.className = 'soul-plan-ring-soul';
        button.setAttribute('aria-label', `${index + 1}号位 ${soul?.name ?? '当前背包中未找到'}，查看御魂详情`);
        add(button, 'small', `${index + 1} 号位 · +${soul?.level ?? '—'}`);
        if (soul) button.append(createSoulPositionPortrait(doc, soul, false));
        add(button, 'span', soul?.name ?? '当前背包中未找到');
        if (soul) {
          button.addEventListener('pointerenter', () => preview(button, soul,context)); button.addEventListener('pointerleave', closePreview);
          button.addEventListener('focus', () => preview(button, soul,context)); button.addEventListener('blur', closePreview);
        }
        el('ring').append(button);
      }
      add(el('panel'), 'h3', '属性面板', 'soul-plan-panel-heading');
      renderSoulPanelTable(doc, add(el('panel'), 'div', '', 'soul-plan-panel-table'), planPanelAddition(plan.panel, base), plan.panel);
      add(el('panel'), 'p', base ? '已计入两件套与固有属性；不含战斗触发效果。' : '此历史方案未保存基础属性，御魂加成暂不可计算。', 'soul-plan-panel-note');
      add(el('sets'), 'h3', '套装效果');
      for (const {id, count} of plan.suits) {
        const suit = suits.find(item => item.id === id); if (!suit) continue;
        const row = add(el('sets'), 'div', ''); appendPickerPortrait(row, 'soul', id, suit.name);
        const info = add(row, 'div', ''); add(info, 'strong', `${suit.name} × ${count}`);
        const bonus = suit.bonus ? `${SUIT_ATTRIBUTES[suit.bonus.name] ?? suit.bonus.name} +${Math.round(suit.bonus.value * 100)}%` : '';
        appendEffectNumbers(add(info, 'p', ''), count >= 4 || suit.boss ? `${bonus ? bonus + '。' : ''}${suit.four}（条件效果未计入评分）` : bonus || '无固定面板加成');
      }
      if (!dialog.open) dialog.showModal();
    }, close, dispose: () => { close(); share.dispose(); dialog.remove(); },
  };
}
