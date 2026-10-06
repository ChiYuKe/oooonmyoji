import { OPTIMIZATION_OBJECTIVES } from '../../../../shared/soul-optimizer';
import type { OptimizationObjective, PanelKey } from '../../../../shared/soul-optimizer';

type Bound = 'min' | 'max';
const scales: Record<OptimizationObjective, number> = { damage: 50000, attack: 20000, hp: 100000, defense: 5000, speed: 400, crit: 250, critDamage: 500, hit: 300, resist: 300 };
const bounds = ['min', 'max'] as const;

export function communityRangeMarkup(prefix: string, label: string, signed = false): string {
  return `<fieldset class="soul-community-range" data-community="${prefix}-range">
    <legend><span data-community="${prefix}-label">${label}</span></legend>
    <span class="soul-community-filter-range">${bounds.map(bound => `<input type="number" ${signed ? '' : 'min="0"'} step="any" data-community="${prefix}-${bound}" placeholder="${bound === 'min' ? '最低' : '最高'}" aria-label="${label}${bound === 'min' ? '下限' : '上限'}">`).join('<span>至</span>')}</span>
    <div class="soul-range-slider" data-community="${prefix}-slider"><span class="soul-range-track" aria-hidden="true"></span>${bounds.map(bound => `<input type="range" data-community="${prefix}-${bound}-slider" aria-label="${label}${bound === 'min' ? '下限' : '上限'}滑块">`).join('')}</div>
    <div class="soul-community-range-scale"><span data-community="${prefix}-scale-min"></span><button type="button" data-community="${prefix}-clear" title="清除${label}范围" aria-label="清除${label}范围">不限</button><span data-community="${prefix}-scale-max"></span></div>
  </fieldset>`;
}

export function installCommunityRanges(root: HTMLElement, objective: () => OptimizationObjective, changed: () => void): { refresh(): void } {
  const el = <T extends HTMLElement>(name: string): T => root.querySelector<T>(`[data-community="${name}"]`)!;
  const ranges = ['score', 'delta', ...Object.keys(scales).filter(key => key !== 'damage').map(key => `panel-${key}`)].map(prefix => {
    let active: Bound = 'min';
    const input = (bound: Bound): HTMLInputElement => el(`${prefix}-${bound}`);
    const slider = (bound: Bound): HTMLInputElement => el(`${prefix}-${bound}-slider`);
    const value = (bound: Bound): number | undefined => {
      const raw = input(bound).value.trim(), number = Number(raw);
      return raw && Number.isFinite(number) ? number : undefined;
    };
    const signed = prefix === 'delta';
    const key = (): OptimizationObjective | PanelKey => prefix.startsWith('panel-') ? prefix.slice(6) as PanelKey : objective();
    const domain = (): { low: number; high: number } => {
      const base = scales[key()] / (signed ? 10 : 1), amounts = bounds.map(value).filter((amount): amount is number => amount != null);
      const high = Math.ceil(Math.max(base, ...amounts) / (base / 10)) * (base / 10);
      const low = signed ? -Math.ceil(Math.max(base, ...amounts.map(amount => -amount)) / (base / 10)) * (base / 10) : 0;
      return { low, high };
    };
    const refresh = (): void => {
      const { low, high } = domain(), clamp = (amount: number): number => Math.max(low, Math.min(high, amount));
      const lower = clamp(value('min') ?? low), upper = clamp(value('max') ?? high);
      const percentage = OPTIMIZATION_OBJECTIVES[key()].percent;
      const unit = percentage ? signed ? '百分点' : '%' : '';
      const label = el(`${prefix}-label`).textContent || '';
      for (const bound of bounds) {
        const range = slider(bound);
        range.min = String(low); range.max = String(high); range.step = percentage || key() === 'speed' ? '.1' : '1';
        range.value = String(bound === 'min' ? lower : upper); range.disabled = input(bound).disabled;
        range.style.zIndex = bound === active ? '3' : '2';
        const accessibleLabel = `${label}${bound === 'min' ? '下限' : '上限'}`;
        input(bound).setAttribute('aria-label', accessibleLabel);
        range.setAttribute('aria-label', `${accessibleLabel}滑块`);
        range.setAttribute('aria-valuetext', value(bound) == null ? '不限' : `${input(bound).value}${unit}`);
      }
      const track = el(`${prefix}-slider`);
      track.style.setProperty('--range-low', `${(Math.min(lower, upper) - low) / (high - low) * 100}%`);
      track.style.setProperty('--range-high', `${(Math.max(lower, upper) - low) / (high - low) * 100}%`);
      el(`${prefix}-scale-min`).textContent = low.toLocaleString() + unit;
      el(`${prefix}-scale-max`).textContent = high.toLocaleString() + unit;
      el(`${prefix}-range`).dataset.disabled = String(input('min').disabled);
      const clear = el<HTMLButtonElement>(`${prefix}-clear`);
      clear.disabled = input('min').disabled || !input('min').value && !input('max').value;
    };
    for (const bound of bounds) {
      input(bound).addEventListener('focus', () => { active = bound; refresh(); });
      input(bound).addEventListener('input', () => { active = bound; refresh(); changed(); });
      for (const event of ['focus', 'pointerdown']) slider(bound).addEventListener(event, () => { active = bound; refresh(); });
      slider(bound).addEventListener('input', () => {
        if (input(bound).disabled) return;
        active = bound;
        const other = value(bound === 'min' ? 'max' : 'min');
        let next = Number(slider(bound).value);
        if (other != null && (signed || other >= 0)) next = bound === 'min' ? Math.min(next, other) : Math.max(next, other);
        input(bound).value = String(Number(next.toFixed(6))); refresh(); changed();
      });
    }
    el(`${prefix}-clear`).addEventListener('click', () => {
      if (input('min').disabled) return;
      for (const bound of bounds) input(bound).value = '';
      active = 'min'; refresh(); changed();
    });
    return { refresh };
  });
  return { refresh: () => { for (const range of ranges) range.refresh(); } };
}
