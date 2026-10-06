import type { OptimizationObjective } from '../../../../shared/soul-optimizer';
import { OPTIMIZATION_OBJECTIVES } from '../../../../shared/soul-optimizer';
import type { TargetScoreRange } from '../../../../shared/soul-target-analysis';

type Bound = 'min' | 'max';
const scales: Record<OptimizationObjective, number> = { damage: 50000, attack: 20000, hp: 100000, defense: 5000, speed: 400, crit: 250, critDamage: 500, hit: 300, resist: 300 };

export function installSoulTargetRange(root: HTMLElement, objective: () => OptimizationObjective, inputChanged: () => void, committed: () => void): {
  refresh(): void; reset(): void; read(): TargetScoreRange | undefined;
} {
  const el = <T extends HTMLElement>(name: string): T => root.querySelector<T>(`[data-ui="${name}"]`)!;
  const input = (bound: Bound): HTMLInputElement => el(bound === 'min' ? 'target' : 'target-max');
  const slider = (bound: Bound): HTMLInputElement => el(`target-${bound}-slider`);
  let active: Bound = 'min';
  const step = (): number => OPTIMIZATION_OBJECTIVES[objective()].percent || objective() === 'speed' ? .1 : objective() === 'damage' || objective() === 'hp' ? 100 : 1;
  const value = (bound: Bound): number | undefined => input(bound).value === '' ? undefined : input(bound).valueAsNumber;
  const scale = (): number => {
    const base = scales[objective()], values = [value('min'), value('max')].filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);
    return Math.ceil(Math.max(base, ...values) / (base / 10)) * (base / 10);
  };
  const refresh = (): void => {
    const max = scale(), low = Math.max(0, Math.min(max, value('min') ?? 0)), high = Math.max(0, Math.min(max, value('max') ?? max));
    const unit = OPTIMIZATION_OBJECTIVES[objective()].percent ? '%' : '分';
    el('target-unit').textContent = unit;
    for (const bound of ['min', 'max'] as const) {
      const label = `目标评分${bound === 'min' ? '下限' : '上限'}（${unit}）`, range = slider(bound);
      input(bound).setAttribute('aria-label', label);
      range.min = '0'; range.max = String(max); range.step = String(step()); range.value = String(bound === 'min' ? low : high);
      range.setAttribute('aria-label', `${label}滑块`);
      range.setAttribute('aria-valuetext', input(bound).value === '' ? `不限${bound === 'min' ? '下限' : '上限'}` : `${input(bound).value}${unit}`);
      range.style.zIndex = bound === active ? '3' : '2';
    }
    el('target-slider').style.setProperty('--range-low', `${Math.min(low, high) / max * 100}%`);
    el('target-slider').style.setProperty('--range-high', `${Math.max(low, high) / max * 100}%`);
    el('target-scale').textContent = `${max.toLocaleString()}${unit}`;
    for (const direction of ['minus', 'plus']) root.querySelector<HTMLElement>(`[data-target-adjust="${direction}"]`)!.setAttribute('aria-label', `${direction === 'minus' ? '减少' : '增加'}目标评分${active === 'min' ? '下限' : '上限'} ${step()}${unit}`);
  };
  const adjust = (bound: Bound, next: number): void => {
    const other = value(bound === 'min' ? 'max' : 'min');
    if (other != null && Number.isFinite(other) && other >= 0) next = bound === 'min' ? Math.min(next, other) : Math.max(next, other);
    input(bound).value = String(Number(Math.max(0, next).toFixed(6))); refresh();
  };
  for (const bound of ['min', 'max'] as const) {
    input(bound).addEventListener('focus', () => { active = bound; refresh(); });
    input(bound).addEventListener('input', () => { active = bound; refresh(); inputChanged(); });
    input(bound).addEventListener('change', () => { refresh(); committed(); });
    for (const event of ['focus', 'pointerdown']) slider(bound).addEventListener(event, () => { active = bound; refresh(); });
    slider(bound).addEventListener('input', () => { active = bound; adjust(bound, Number(slider(bound).value)); inputChanged(); });
    slider(bound).addEventListener('change', committed);
  }
  for (const [direction, sign] of [['minus', -1], ['plus', 1]] as const) root.querySelector(`[data-target-adjust="${direction}"]`)!.addEventListener('click', () => {
    const current = value(active);
    adjust(active, (current != null && Number.isFinite(current) ? current : active === 'min' ? 0 : scale()) + sign * step()); committed();
  });
  refresh();
  return {
    refresh,
    reset: () => { for (const bound of ['min', 'max'] as const) { input(bound).value = ''; input(bound).removeAttribute('aria-invalid'); } active = 'min'; refresh(); },
    read: () => {
      const min = value('min'), max = value('max');
      for (const bound of ['min', 'max'] as const) input(bound).removeAttribute('aria-invalid');
      for (const bound of ['min', 'max'] as const) {
        const amount = value(bound);
        if (input(bound).validity.badInput || (amount != null && (!Number.isFinite(amount) || amount < 0))) {
          input(bound).setAttribute('aria-invalid', 'true'); throw Error('目标评分范围需填写非负数。');
        }
      }
      if (min != null && max != null && min > max) {
        input('min').setAttribute('aria-invalid', 'true'); input('max').setAttribute('aria-invalid', 'true'); throw Error('目标评分下限不能大于上限。');
      }
      if (min == null && max == null) return undefined;
      const divisor = OPTIMIZATION_OBJECTIVES[objective()].percent ? 100 : 1;
      return { min: min == null ? undefined : min / divisor, max: max == null ? undefined : max / divisor };
    },
  };
}
