import type { SkillDefinition } from '../core/definitions';
import { skillResourceCost } from '../core/definitions';
import type { ActionIntent, BattleContext, UnitState } from '../core/types';

/** Verified SkillAi_config values. Sequence/skill rules must come from captured AI data. */
export const SKILL_AI_WEIGHTS = { CampMatch: 50, MonsterId: 100, HasBuff: 20, HasNotBuff: 20,
  HasSufferBuff: 20, HPHigher: 1, HPLower: 1 } as const;
export type AiFactor =
  | { kind: 'CampMatch'; side: 'ally' | 'enemy' }
  | { kind: 'MonsterId'; heroId: number }
  | { kind: 'HasBuff' | 'HasNotBuff' | 'HasSufferBuff'; statusId: string }
  | { kind: 'HPHigher' | 'HPLower' | 'AbsHPHigher' | 'AbsHPLower'; threshold?: number };
export interface SkillAiRule {
  baseWeight: number;
  /** Target scoring is separate from skill scoring; the native target base is 50. */
  targetBaseWeight?: number;
  factors: readonly AiFactor[];
  randomRange?: readonly [number, number];
  fireWeight?: { policy: 'higher' | 'lower'; threshold: number; score: number };
}

export function scoreAiTarget(actor: UnitState, target: UnitState, rule: SkillAiRule): number {
  let score = rule.targetBaseWeight ?? 50;
  const hpPercent = target.hp / Math.max(1, target.stats.hp) * 100;
  for (const factor of rule.factors) {
    switch (factor.kind) {
      case 'CampMatch': score += ((factor.side === 'ally') === (actor.side === target.side) ? 1 : -1) * SKILL_AI_WEIGHTS.CampMatch; break;
      case 'MonsterId': score += Number(target.heroId === factor.heroId) * SKILL_AI_WEIGHTS.MonsterId; break;
      case 'HasBuff': case 'HasSufferBuff': score += Number(target.statuses.some(status => status.statusId === factor.statusId)) * SKILL_AI_WEIGHTS[factor.kind]; break;
      case 'HasNotBuff': score += Number(!target.statuses.some(status => status.statusId === factor.statusId)) * SKILL_AI_WEIGHTS.HasNotBuff; break;
      case 'HPHigher': score += Math.max(0, hpPercent - (factor.threshold ?? 0)) * SKILL_AI_WEIGHTS.HPHigher; break;
      case 'HPLower': score += Math.max(0, (factor.threshold ?? 100) - hpPercent) * SKILL_AI_WEIGHTS.HPLower; break;
      case 'AbsHPHigher': score += hpPercent > (factor.threshold ?? 0) ? target.hp : 0; break;
      case 'AbsHPLower': score += hpPercent < (factor.threshold ?? 100) ? -target.hp : 0; break;
    }
  }
  return score;
}

export function scoreAiSkill(context: BattleContext, actor: UnitState, rule: SkillAiRule): number {
  let score = rule.baseWeight;
  const weight = rule.fireWeight;
  const fire = context.state.resources[actor.side]?.fire ?? 0;
  if (weight && (weight.policy === 'higher' ? fire > weight.threshold : fire < weight.threshold)) score += weight.score;
  if (rule.randomRange) score *= rule.randomRange[0] + context.random() * (rule.randomRange[1] - rule.randomRange[0]);
  return score;
}

/** Opt-in: absent captured rules leaves the existing, diagnosed heuristic policy in use. */
export function selectWeightedAction(context: BattleContext, actor: UnitState, skills: readonly SkillDefinition[]): ActionIntent | undefined {
  let best: { score: number; intent: ActionIntent } | undefined;
  for (const skill of skills) {
    if (!skill.aiRule || !Number.isFinite(skill.aiRule.baseWeight)) continue;
    if (skill.canUse && !skill.canUse(context.state, actor)) continue;
    const level = actor.skillLevels?.[skill.id] ?? actor.skillLevel;
    const cost = skill.resolveResourceCost?.(context.state, actor) ?? skillResourceCost(skill, level);
    if (cost && (context.state.resources[actor.side]?.[cost.resourceId] ?? 0) < cost.amount) continue;
    const side = skill.targetRelation === 'ally' ? actor.side : actor.side === 'blue' ? 'red' : 'blue';
    const units = skill.target === 'self' ? [actor] : context.getLivingUnits(side);
    const candidates = skill.target === 'all-allies' || skill.target === 'all-enemies' ? [units] : units.map(unit => [unit]);
    let selected: { score: number; targets: readonly UnitState[] } | undefined;
    for (const targets of candidates) {
      if (!targets.length) continue;
      const score = targets.reduce((sum, target) => sum + scoreAiTarget(actor, target, skill.aiRule!), 0) / targets.length;
      if (!selected || score > selected.score) selected = { score, targets };
    }
    if (!selected) continue;
    const score = scoreAiSkill(context, actor, skill.aiRule);
    if (!best || score > best.score) best = { score, intent: { actorId: actor.unitId, skillId: skill.id,
      targetIds: selected.targets.map(target => target.unitId), shape: skill.target, targetRelation: skill.targetRelation } };
  }
  return best?.intent;
}
