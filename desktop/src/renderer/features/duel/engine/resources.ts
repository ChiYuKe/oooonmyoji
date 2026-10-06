import type { Fighter, OrbMeter, SideId } from './types';

export function initialOrbProgress(team: Fighter[]): number {
  const moonChaser = team.find(unit => unit.skills.some(skill => skill.name === '明月潮生'));
  if (!moonChaser) return 0;
  const passive = moonChaser.skills.find(skill => skill.name === '明月潮生')!;
  let progress = 1;
  for (const upgrade of passive.upgrades.slice(0, Math.max(0, moonChaser.skillLevel - 1))) {
    const amount = /额外推进增至(\d+)格/.exec(upgrade);
    if (amount) progress = Number(amount[1]);
  }
  return Math.min(5, progress);
}

export function advanceOrbMeter(side: SideId, fire: { blue: number; red: number }, meter: OrbMeter, steps: number, battleLog?: string[]): void {
  for (let step = 0; step < steps; step++) {
    meter.progress++;
    if (meter.progress < 5) continue;
    meter.progress = 0;
    const supply = meter.nextSupply;
    const before = fire[side];
    fire[side] = Math.min(8, before + supply);
    battleLog?.push(`  ${side === 'blue' ? '蓝方' : '红方'}鬼火行动条满5格，补火 +${supply}（${before}→${fire[side]}，存量上限8）。`);
    meter.nextSupply = Math.min(5, meter.nextSupply + 1);
  }
  battleLog?.push(`  ${side === 'blue' ? '蓝方' : '红方'}鬼火行动条：${meter.progress}/5；下一次满格补火 +${meter.nextSupply}。`);
}
