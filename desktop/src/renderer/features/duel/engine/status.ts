import type { Fighter, ModStat } from './types';

export function battleStatusLabel(unit: Fighter, effectiveStat: (unit: Fighter, stat: ModStat) => number): string {
  const statuses = unit.effects.map(effect => {
    const names: Record<ModStat, string> = { attack: '攻击', defense: '防御', speed: '速度', crit: '暴击', critDamage: '暴伤', hit: '命中', resist: '抵抗', critResist: '暴击抵抗', damage: '伤害' };
    const amount = Math.round(Math.abs(effect.amount) * 100);
    const sign = effect.amount >= 0 ? '+' : '-';
    return effect.flat
      ? `${names[effect.stat]}${sign}${Math.round(Math.abs(effect.amount))}点（${effect.turns}回合）`
      : `${names[effect.stat]}${sign}${amount}%（${effect.turns}回合）`;
  });
  if (unit.control) statuses.push(`${unit.control}（${unit.controlTurns}回合）`);
  if (unit.bellDivineFire) statuses.push('神火');
  for (const tag of unit.tags) statuses.push(`${tag.name}（${tag.turns}回合）`);
  const harmony = unit.skills.some(skill => skill.name === '和音回响') ? `和音×${unit.harmony}/5` : '';
  if (harmony) statuses.push(harmony);
  if (unit.shield > 0) statuses.push(`护盾 ${Math.round(unit.shield)}`);
  if (unit.talismans > 0) statuses.push(`道符×${unit.talismans}`);
  if (unit.remnantFlame > 0) statuses.push(`念火×${unit.remnantFlame}/3`);
  if (unit.foodStacks > 0) statuses.push(`储备粮×${unit.foodStacks}/10`);
  if (unit.heartFlames > 0) statuses.push(`心焰×${unit.heartFlames}`);
  const damageBonus = Math.max(0, effectiveStat(unit, 'damage') - 1) + Math.max(0, unit.birdDamageBonus + unit.permanentDamageBonus);
  if (damageBonus > 0) statuses.push(`伤害提高${Math.round(damageBonus * 100)}%`);
  if (unit.divinePower > 0) statuses.push(`神力×${unit.divinePower}/5`);
  if (unit.bondedAlly && unit.skills.some(skill => skill.name === '守缘刃')) statuses.push(`结缘：${unit.bondedAlly.name}·${unit.bondColor ?? '赤'}`);
  const wallAbsorb = unit.tags.filter(tag => tag.name === '共鸣之墙').reduce((sum, tag) => sum + (tag.absorbRemaining ?? 0), 0);
  if (wallAbsorb > 0) statuses.push(`共鸣之墙可吸收暴击伤害 ${Math.round(wallAbsorb)}`);
  return statuses.join('、') || '无异常状态';
}
