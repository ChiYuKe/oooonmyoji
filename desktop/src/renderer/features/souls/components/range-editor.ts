import { PANEL_LABELS } from '../../../../shared/soul-optimizer';
import type { PanelKey, OptimizationOptions } from '../../../../shared/soul-optimizer';

type Ranges = OptimizationOptions['ranges'];
type Bound = 'min' | 'max';
const ORDER: PanelKey[] = ['attack', 'crit', 'critDamage', 'speed', 'defense', 'hp', 'hit', 'resist'];
const PERCENT = new Set<PanelKey>(['crit', 'critDamage', 'hit', 'resist']);
// Initial slider scales only: typed values are not capped by these display ranges.
const SCALES: Record<PanelKey, number> = { attack: 20000, hp: 100000, defense: 5000, speed: 400, crit: 250, critDamage: 500, hit: 300, resist: 300 };

export function installSoulRangeEditor(root: HTMLElement, read: () => Ranges, apply: (ranges: Ranges) => void, closePreview: () => void): {
  open(key?: PanelKey, anchor?: HTMLElement): void; close(): void; dispose(): void;
} {
  const doc = root.ownerDocument;
  const dialog = doc.createElement('dialog'); dialog.id = 'soul-range-editor'; dialog.className = 'soul-optimizer soul-range-editor';
  dialog.setAttribute('aria-labelledby', 'soul-range-title');
  dialog.innerHTML = `<header class="soul-optimizer-header"><div><h2 id="soul-range-title">属性限制</h2><p>设置配装后的总面板范围，各项限制同时生效</p></div><button type="button" data-range-action="close" aria-label="关闭属性限制">×</button></header>
    <div class="soul-range-body"><nav class="soul-range-attributes" data-range="attributes" aria-label="选择限制属性"></nav>
      <section class="soul-range-controls"><h3 data-range="title"></h3>
        <div class="soul-range-values"><label>下限<input type="number" min="0" step="any" data-range="min" placeholder="不限下限"></label><span>—</span><label>上限<input type="number" min="0" step="any" data-range="max" placeholder="不限上限"></label></div>
        <div class="soul-range-slider-row"><button type="button" data-range-action="minus" aria-label="减少当前端点">−</button><div class="soul-range-slider" data-range="slider"><div class="soul-range-track"></div><input type="range" data-range="min-slider"><input type="range" data-range="max-slider"></div><button type="button" data-range-action="plus" aria-label="增加当前端点">+</button></div>
        <div class="soul-range-scale"><span>0</span><span data-range="scale"></span></div><p class="soul-optimizer-hint" data-range="adjusting"></p>
        <div class="soul-range-shortcuts"><button type="button" data-range-action="reset">重置本项</button><button type="button" data-range-action="full-crit">满暴</button></div>
        <p class="soul-optimizer-hint">数值留空表示不限；可直接输入超出滑条刻度的数值。</p><p data-range="error" class="soul-range-error" role="alert"></p>
      </section></div>
    <footer class="soul-range-footer"><button type="button" data-range-action="clear-all">清空全部限制</button><span data-range="count"></span><button type="button" data-range-action="close">取消</button><button type="button" data-range-action="apply">应用限制</button></footer>`;
  root.append(dialog);
  const el = <T extends HTMLElement>(name: string): T => dialog.querySelector<T>(`[data-range="${name}"]`)!;
  const action = (name: string): HTMLButtonElement => dialog.querySelector(`[data-range-action="${name}"]`)!;
  const input = (name: string): HTMLInputElement => el(name);
  let key: PanelKey = 'crit', active: Bound = 'min', anchor: HTMLElement | undefined;
  let draft = {} as Record<PanelKey, { min: string; max: string; badMin: boolean; badMax: boolean }>;
  const hasRange = (item: typeof draft[PanelKey]): boolean => item.min !== '' || item.max !== '' || item.badMin || item.badMax;
  const step = (): number => PERCENT.has(key) || key === 'speed' ? .1 : 1;
  const value = (bound: Bound): number | undefined => draft[key][bound] === '' ? undefined : Number(draft[key][bound]);
  const scale = (): number => {
    const values = [value('min'), value('max')].filter((n): n is number => n !== undefined && Number.isFinite(n) && n >= 0);
    const max = Math.max(SCALES[key], ...values);
    return Math.ceil(max / (SCALES[key] / 10)) * (SCALES[key] / 10);
  };
  const updateLabels = (): void => {
    for (const button of el('attributes').querySelectorAll<HTMLButtonElement>('button')) {
      const attribute = button.dataset.attribute as PanelKey;
      button.classList.toggle('has-range', hasRange(draft[attribute])); button.setAttribute('aria-pressed', String(attribute === key));
      button.title = `${PANEL_LABELS[attribute]}${hasRange(draft[attribute]) ? ' · 已设置限制' : ''}`;
    }
    el('count').textContent = `已设置 ${ORDER.filter(attr => hasRange(draft[attr])).length} 项`;
  };
  const draw = (): void => {
    const max = scale(), low = Math.max(0, Math.min(max, value('min') ?? 0)), high = Math.max(0, Math.min(max, value('max') ?? max));
    for (const bound of ['min', 'max'] as const) {
      const slider = input(`${bound}-slider`); slider.min = '0'; slider.max = String(max); slider.step = String(step());
      slider.value = String(bound === 'min' ? low : high);
      slider.setAttribute('aria-valuetext', draft[key][bound] === '' ? `不限${bound === 'min' ? '下限' : '上限'}` : `${draft[key][bound]}${PERCENT.has(key) ? '%' : ''}`);
      slider.style.zIndex = bound === active ? '3' : '2';
    }
    el('slider').style.setProperty('--range-low', `${Math.min(low, high) / max * 100}%`);
    el('slider').style.setProperty('--range-high', `${Math.max(low, high) / max * 100}%`);
    el('scale').textContent = `${max}${PERCENT.has(key) ? '%' : ''}`;
    el('adjusting').textContent = `当前调整${active === 'min' ? '下限' : '上限'} · 步长 ${step()}${PERCENT.has(key) ? '%' : ''}`;
  };
  const render = (): void => {
    el('title').textContent = `${PANEL_LABELS[key]}属性范围${PERCENT.has(key) ? '（%）' : ''}`;
    for (const bound of ['min', 'max'] as const) {
      input(bound).value = draft[key][bound]; input(bound).setAttribute('aria-label', `${PANEL_LABELS[key]}${bound === 'min' ? '下限' : '上限'}${PERCENT.has(key) ? '（%）' : ''}`);
      input(bound).removeAttribute('aria-invalid'); input(`${bound}-slider`).setAttribute('aria-label', `${PANEL_LABELS[key]}${bound === 'min' ? '下限' : '上限'}滑块`);
    }
    action('full-crit').hidden = key !== 'crit'; el('error').textContent = ''; updateLabels(); draw();
  };
  const selectAttribute = (next: PanelKey): void => { key = next; active = 'min'; render(); };
  for (const attribute of ORDER) {
    const button = doc.createElement('button'); button.type = 'button'; button.dataset.attribute = attribute; button.textContent = PANEL_LABELS[attribute];
    button.addEventListener('click', () => selectAttribute(attribute)); el('attributes').append(button);
  }
  const adjust = (bound: Bound, next: number): void => {
    const other = value(bound === 'min' ? 'max' : 'min');
    if (other !== undefined && Number.isFinite(other) && other >= 0) next = bound === 'min' ? Math.min(next, other) : Math.max(next, other);
    draft[key][bound] = String(Number(Math.max(0, next).toFixed(6))); draft[key][bound === 'min' ? 'badMin' : 'badMax'] = false;
    input(bound).value = draft[key][bound]; el('error').textContent = ''; input(bound).removeAttribute('aria-invalid'); updateLabels(); draw();
  };
  for (const bound of ['min', 'max'] as const) {
    input(bound).addEventListener('focus', () => { active = bound; draw(); });
    input(bound).addEventListener('input', () => {
      draft[key][bound] = input(bound).value; draft[key][bound === 'min' ? 'badMin' : 'badMax'] = input(bound).validity.badInput;
      el('error').textContent = ''; input(bound).removeAttribute('aria-invalid'); updateLabels(); draw();
    });
    const slider = input(`${bound}-slider`);
    for (const event of ['focus', 'pointerdown']) slider.addEventListener(event, () => { active = bound; draw(); });
    slider.addEventListener('input', () => { active = bound; adjust(bound, Number(slider.value)); });
  }
  action('minus').addEventListener('click', () => adjust(active, (value(active) ?? (active === 'min' ? 0 : scale())) - step()));
  action('plus').addEventListener('click', () => adjust(active, (value(active) ?? (active === 'min' ? 0 : scale())) + step()));
  action('reset').addEventListener('click', () => { draft[key] = { min: '', max: '', badMin: false, badMax: false }; render(); });
  action('clear-all').addEventListener('click', () => { for (const attr of ORDER) draft[attr] = { min: '', max: '', badMin: false, badMax: false }; render(); });
  action('full-crit').addEventListener('click', () => { draft.crit.min = '100'; draft.crit.badMin = false; if (draft.crit.badMax || (draft.crit.max !== '' && Number(draft.crit.max) < 100)) { draft.crit.max = ''; draft.crit.badMax = false; } active = 'min'; render(); });
  const close = (): void => { if (dialog.open) dialog.close(); };
  for (const button of dialog.querySelectorAll('[data-range-action="close"]')) button.addEventListener('click', close);
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
  dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); close(); });
  dialog.addEventListener('close', () => { closePreview(); if (anchor?.isConnected) anchor.focus(); else root.querySelector<HTMLButtonElement>('[data-action="add-range"]')?.focus(); });
  action('apply').addEventListener('click', () => {
    const ranges: Ranges = {};
    for (const attr of ORDER) {
      const item = draft[attr], min = item.min === '' ? undefined : Number(item.min), max = item.max === '' ? undefined : Number(item.max);
      const invalidMin = item.badMin || (min !== undefined && (!Number.isFinite(min) || min < 0));
      const invalidMax = item.badMax || (max !== undefined && (!Number.isFinite(max) || max < 0));
      if (invalidMin || invalidMax || (min !== undefined && max !== undefined && min > max)) {
        selectAttribute(attr); el('error').textContent = invalidMin || invalidMax ? `${PANEL_LABELS[attr]}范围需填写非负数。` : `${PANEL_LABELS[attr]}下限不能大于上限。`;
        const field = input(invalidMax ? 'max' : 'min'); field.setAttribute('aria-invalid', 'true'); field.focus(); return;
      }
      if (min !== undefined || max !== undefined) { const divisor = PERCENT.has(attr) ? 100 : 1; ranges[attr] = { min: min === undefined ? undefined : min / divisor, max: max === undefined ? undefined : max / divisor }; }
    }
    apply(ranges); close();
  });
  return {
    open(initial = 'crit', nextAnchor): void {
      anchor = nextAnchor; closePreview(); const current = read();
      for (const attr of ORDER) { const multiplier = PERCENT.has(attr) ? 100 : 1; draft[attr] = { min: current[attr]?.min === undefined ? '' : String(Number((current[attr]!.min! * multiplier).toFixed(6))), max: current[attr]?.max === undefined ? '' : String(Number((current[attr]!.max! * multiplier).toFixed(6))), badMin: false, badMax: false }; }
      selectAttribute(initial); dialog.showModal(); el<HTMLButtonElement>('attributes').querySelector<HTMLButtonElement>(`[data-attribute="${initial}"]`)!.focus();
    }, close, dispose: () => { close(); dialog.remove(); },
  };
}
