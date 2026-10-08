import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import { createLineupDamageSkill, lineupIntent, lowestHealthEnemy } from './lineup-damage-skill';
import type { ContentRegistry } from './registry';

export const foodSpiritIds = {
  hero: 369, basic: '3691', passive: '3692', meal: '3693', feast: '3694',
  dining: 'status.hero.369.dining', satiated: 'status.hero.369.satiated',
  attackGrowth: 'status.hero.369.culinary-growth', protection: 'status.hero.369.meal-protection',
  feastWound: 'status.hero.369.feast-wound',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const mealCosts = [3, 2, 2, 2, 2] as const;
const feastDamageRatios = [1.58, 1.58, 1.58, 1.58, 1.58] as const;
const feastSkill = createLineupDamageSkill(foodSpiritIds.feast, feastDamageRatios, { target: 'all-enemies', canCrit: false });

export function registerFoodSpirit(registry: ContentRegistry): void {
  const dining: StatusDefinition = { id: foodSpiritIds.dining, mechanicsCoverage: 'partial', category: 'other',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' };
  const satiated: StatusDefinition = { id: foodSpiritIds.satiated, mechanicsCoverage: 'partial', category: 'mark',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' };
  const protection: StatusDefinition = { id: foodSpiritIds.protection, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', controlProtection: 'single-application' };
  const attackGrowth: StatusDefinition = { id: foodSpiritIds.attackGrowth, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5 };
  const feastWound: StatusDefinition = { id: foodSpiritIds.feastWound, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' };
  for (const status of [dining, satiated, protection, attackGrowth, feastWound]) registry.registerStatus(status);
  registry.registerHero(createFoodSpiritDefinition());
}

function createFoodSpiritDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(foodSpiritIds.basic, basicRatios);
  const meal: SkillDefinition = { id: foodSpiritIds.meal, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    resolveResourceCost(_state, actor) { return { resourceId: 'fire', amount: mealCosts[skillRank(actor, foodSpiritIds.meal) - 1]! }; },
    target: 'single', targetRelation: 'ally', allowDefeatedTargets: false, levels: mealCosts.map(cost => ({ cost })),
    canUse(state, actor) {
      return state.sides[actor.side].some(targetId => {
        const target = state.units[targetId];
        return Boolean(target && target.hp > 0 && target.unitId !== actor.unitId && target.unitKind !== 'summon'
          && !target.statuses.some(status => status.statusId === foodSpiritIds.dining));
      });
    },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId); const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.side !== actor.side || target.unitId === actor.unitId || target.unitKind === 'summon' || target.hp <= 0
        || target.statuses.some(status => status.statusId === foodSpiritIds.dining)) return [];
      const source = foodSource(foodSpiritIds.meal, actor.unitId);
      return [{ type: 'lose-life', source, targetId: actor.unitId, amount: actor.hp * .15 },
        { type: 'add-status', source, targetId: target.unitId, instance: {
          instanceId: `${foodSpiritIds.dining}:${actor.unitId}:${target.unitId}`, statusId: foodSpiritIds.dining,
          source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          values: { foodSpiritId: actor.unitId, skillRank: skillRank(actor, foodSpiritIds.meal) },
          modifiers: [{ stat: 'damage', operation: 'percent', amount: -.3 },
            { stat: 'damageTaken', operation: 'percent', amount: -.4 }],
        } }];
    } };
  return { id: foodSpiritIds.hero, skills: [basic, meal], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['仅接入低火普攻/有火备餐的基础策略；初始暴伤最高友方的单体协战目标与原生选招权重仍需战斗记录校准。'],
    mechanicsCoverageNotes: ['已接入普攻等级倍率、备餐消耗3/2火与15%当前生命、用餐期间降伤30%/减伤40%、友方回合结束吃下食物、三级单次控制保护、四级全队治疗、五级按敌人数追加真实伤害、饱食后三个单位回合触发全体飨食、饱食触发攻击成长、被动全队回合外增伤与五级协战易伤。协战概率/目标选择以及无法动作时飨食延后的精确窗口仍需客户端连续战斗帧校准。'],
    modifyOutgoingDamage(attacker, _target, amount, _kind, state) {
      if (!state.activeActionScheduling || state.activeActionScheduling === 'extra-turn') return amount;
      const bonus = Object.values(state.units).filter(unit => unit.side === attacker.side && unit.hp > 0
        && unit.heroId === foodSpiritIds.hero && passivesEnabled(unit))
        .reduce((highest, unit) => Math.max(highest, [.3, .4, .4, .5, .5][skillRank(unit, foodSpiritIds.passive) - 1]!), 0);
      return amount * (1 + bonus);
    },
    handlers: {
      'turn-end': { priority: 24, handle(context, event) { return settleFoodTurn(context, event); } },
      'action-end': { priority: 24, handle(context, event) { return assistHighestCritAlly(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return undefined;
      const satiated = actor.statuses.some(status => status.statusId === foodSpiritIds.satiated);
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const ally = context.getLivingUnits(actor.side).filter(unit => unit.unitId !== actor.unitId
        && unit.unitKind !== 'summon' && !unit.statuses.some(status => status.statusId === foodSpiritIds.dining
          || status.statusId === foodSpiritIds.satiated))
        .sort((left, right) => (right.stats.critDamage - left.stats.critDamage)
          || (left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp)))[0];
      if (!satiated && ally && fire >= mealCosts[skillRank(actor, foodSpiritIds.meal) - 1]!)
        return lineupIntent(unitId, foodSpiritIds.meal, [ally.unitId], 'single');
      const target = lowestHealthEnemy(context, actor)!;
      return lineupIntent(unitId, foodSpiritIds.basic, [target.unitId], 'single');
    },
  };
}

function settleFoodTurn(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId); if (!target) return;
  const commands: EffectCommand[] = [];
  const meal = target.statuses.find(status => status.statusId === foodSpiritIds.dining);
  if (meal && target.hp > 0) {
    const ownerId = meal.values?.foodSpiritId;
    const owner = typeof ownerId === 'string' ? context.getUnit(ownerId) : undefined;
    const rank = Number(meal.values?.skillRank ?? 1);
    const source = foodSource(foodSpiritIds.meal, owner?.unitId ?? meal.source.unitId ?? 'food-spirit');
    commands.push({ type: 'remove-statuses', source, targetId: target.unitId, statusIds: [foodSpiritIds.dining],
      reason: 'consumed', parentEventId: event.eventId },
    { type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId, instance: {
      instanceId: `${foodSpiritIds.satiated}:${owner?.unitId ?? 'unknown'}:${target.unitId}`,
      statusId: foodSpiritIds.satiated, source, stacks: 1, duration: { kind: 'permanent' },
      values: { foodSpiritId: owner?.unitId ?? '', remainingTurns: 3, mealRank: rank },
    } });
    if (owner && rank >= 3) commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${foodSpiritIds.protection}:${owner.unitId}:${target.unitId}`, statusId: foodSpiritIds.protection,
        source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } });
    if (owner && rank >= 4) for (const ally of context.getLivingUnits(owner.side))
      commands.push({ type: 'heal', source, targetId: ally.unitId, amount: owner.stats.attack * .78, parentEventId: event.eventId });
  }
  // The client countdown advances on each unit turn, not only the diner's turns.
  // Food created above starts counting on the next turn-ended event.
  for (const diner of Object.values(context.state.units)) {
    const satiated = diner.statuses.find(status => status.statusId === foodSpiritIds.satiated);
    if (!satiated) continue;
    const remaining = Number(satiated.values?.remainingTurns ?? 3);
    const ownerId = satiated.values?.foodSpiritId;
    const owner = typeof ownerId === 'string' ? context.getUnit(ownerId) : undefined;
    const rank = Number(satiated.values?.mealRank ?? 1);
    const source = foodSource(foodSpiritIds.feast, owner?.unitId ?? satiated.source.unitId ?? 'food-spirit');
    if (owner && passivesEnabled(owner) && remaining === 3) commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${foodSpiritIds.attackGrowth}:${owner.unitId}`, statusId: foodSpiritIds.attackGrowth,
        source, stacks: 1, duration: { kind: 'permanent' },
        modifiers: [{ stat: 'attack', operation: 'percent', amount: .3, perStack: true }] } });
    if (remaining > 1) commands.push({ type: 'add-status', source, targetId: diner.unitId, parentEventId: event.eventId,
      instance: { ...satiated, values: { ...satiated.values, remainingTurns: remaining - 1 } } });
    else {
      if (owner && (owner.hp <= 0 || context.isUnitUnableToAct(owner.unitId))) continue;
      commands.push({ type: 'remove-statuses', source, targetId: diner.unitId, statusIds: [foodSpiritIds.satiated],
        reason: 'consumed', parentEventId: event.eventId });
      if (owner && owner.hp > 0 && passivesEnabled(owner)) {
        const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
        const foodAttack = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
        commands.push(...feastSkill.execute(context, { actorId: owner.unitId, skillId: foodSpiritIds.feast,
          targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' },
          { ratio: feastDamageRatios[rank - 1] ?? 1.58, stat: 'attack', hits: 1 }));
        if (rank >= 5 && enemies.length > 0) for (const enemy of enemies) commands.push({ type: 'deal-damage',
          source, targetId: enemy.unitId, amount: foodAttack * .66 * enemies.length, damageKind: 'true', parentEventId: event.eventId });
      }
    }
  }
  return commands.length ? commands : undefined;
}

function assistHighestCritAlly(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.scheduling === 'assist' || !event.intent
    || event.intent.shape !== 'single' || event.intent.targetRelation !== 'enemy') return;
  const actor = context.getUnit(event.intent.actorId); if (!actor || actor.hp <= 0) return;
  const owners = context.getLivingUnits(actor.side).filter(unit => unit.heroId === foodSpiritIds.hero && unit.hp > 0);
  const eligible = owners.filter(owner => skillRank(owner, foodSpiritIds.passive) >= 3);
  if (!eligible.length) return;
  const highest = context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon')
    .sort((left, right) => right.stats.critDamage - left.stats.critDamage)[0];
  if (!highest || highest.unitId !== actor.unitId) return;
  const owner = eligible.find(candidate => passivesEnabled(candidate) && !context.isUnitUnableToAct(candidate.unitId));
  if (!owner) return;
  const rank = skillRank(owner, foodSpiritIds.passive);
  const chance = rank >= 5 ? 1 : .3;
  if (context.random() >= chance) return;
  const target = context.getUnit(event.intent.targetIds[0] ?? ''); if (!target || target.hp <= 0) return;
  const source = foodSource(foodSpiritIds.basic, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'schedule-action', source,
    intent: { actorId: owner.unitId, skillId: foodSpiritIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' },
    scheduling: 'assist', parentEventId: event.eventId }];
  if (rank >= 5) commands.push(...attemptDebuff(context, { source, targetId: target.unitId, statusId: foodSpiritIds.feastWound,
    baseChance: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, parentEventId: event.eventId,
    modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: .2 }] }));
  return commands;
}

function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function foodSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
