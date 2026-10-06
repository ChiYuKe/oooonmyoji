import { SIX_STAR_SUBSTAT_ROLLS } from './soul-attribute-limits';
import { assessSoulSubstat } from './soul-substat-standard';
import type { SubstatContext } from './soul-substat-standard';
import type { SoulRecord } from './souls';

export interface SoulEnhancementScore { score: number | null; note: string; conditions: string[] }

/** Aggregate rolls include initial allocations; they do not identify historical upgrade yields. */
export function estimateSoulEnhancementScore(soul: SoulRecord, context: SubstatContext): SoulEnhancementScore {
  const attributes = soul.subAttributes ?? [];
  const conditions = attributes.filter(attr => assessSoulSubstat(soul, attr, context).status === 'conditional'
    && assessSoulSubstat(soul, attr, { ...context, includeConditions: false }).status !== 'core').map(attr => attr.label);
  const unavailable = { score: null, note: '缺少完整的六星 +15 副属性分配数据，无法估算强化评分。', conditions };
  if (soul.stars !== 6 || soul.level !== 15 || attributes.length !== 4 || new Set(attributes.map(a => a.name)).size !== 4) return unavailable;
  for (const attr of attributes) {
    const cap = SIX_STAR_SUBSTAT_ROLLS[attr.name];
    if (!cap || !Number.isInteger(attr.rolls) || attr.rolls < 1 || attr.rolls > 6 || !Number.isFinite(attr.value)
      || attr.value < cap * attr.rolls * .8 - 1e-8 || attr.value > cap * attr.rolls + 1e-8) return unavailable;
  }
  const allocations = attributes.reduce((sum, attr) => sum + attr.rolls, 0);
  if (allocations !== 8 && allocations !== 9) return unavailable;
  // Nine allocations: one initial roll per stat, then five upgrades. Eight allocations:
  // three initial stats, with the fourth added during an upgrade. Its identity is unknown,
  // so average the four possible newly introduced stats (0.75 initial rolls per stat).
  const initialPerStat = (allocations - 5) / 4;
  const score = attributes.reduce((sum, attr) => {
    const assessment = assessSoulSubstat(soul, attr, { ...context, includeConditions: false });
    if (!['core', 'low'].includes(assessment.status)) return sum;
    const effectiveFraction = Math.min(1, Math.max(0, assessment.effectiveValue / attr.value));
    const averageYield = attr.value / (attr.rolls * SIX_STAR_SUBSTAT_ROLLS[attr.name]);
    return sum + (attr.rolls - initialPerStat) * averageYield * effectiveFraction * 2;
  }, 0);
  return {
    score: Math.min(10, Math.max(0, score)),
    conditions,
    note: `强化评分最高 10 分；仅计提升当前评分指标的五次强化，每次满收益计 2 分，按实际收益与暴击溢出折算。配装条件单独提示，不计分。主属性、初始属性及固有属性不计分。无独立强化收益记录，使用各条属性的平均收益估算。${allocations === 8 ? '三条初始属性无法定位新增词条，按四种可能取平均。' : ''}`,
  };
}
