import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, BattleState, EffectCommand, SourceRef, UnitState } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import { lineupIntent, lowestHealthEnemy } from './lineup-damage-skill';
import type { ContentRegistry } from './registry';

export const foodSpiritIds = {
  hero: 369, basic: '3691', passive: '3692', meal: '3693', feast: '3694',
  dining: 'status.hero.369.dining', satiated: 'status.hero.369.satiated',
  attackGrowth: 'status.hero.369.culinary-growth', protection: 'status.hero.369.meal-protection',
  feastWound: 'status.hero.369.feast-wound',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const mealCosts = [3, 2, 2, 2, 2] as const;
const feastDamageRatio = 1.58;

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
    mechanicsCoverageNotes: ['已按客户端技能/战斗状态行校对普攻倍率、备餐3/2火和15%当前生命代价、用餐减伤30%/承伤减伤40%、三回合饱食及控制保护、78%攻击恢复、入饱食时立即叠30%攻击、热浪回合外增伤/协战/五级易伤。现将用餐目标回合内造成的伤害记入饱食，三回合后按158%均分敌方，单目标上限为我方出场式神初始攻击总和3000%，并抑制飨食自身/敌方御魂和被动触发；恢复使用直接恢复事件，不触发治疗效果。糖灵转化由客户端行核实，实战仍需校准用餐期间护盾吸收伤害是否入账、召唤/反击伤害归属、饱食者或食灵无法动作时触发延后窗口、单体伤害上限与食灵增伤的先后顺序。协战目标及权重仍需战斗帧核验。'],
    modifyOutgoingDamage(attacker, _target, amount, _kind, state) {
      if (!state.activeActionScheduling || state.activeActionScheduling === 'extra-turn') return amount;
      const owner = uniquePassiveOwner(state, attacker.side);
      const bonus = owner ? [.3, .4, .4, .5, .5][skillRank(owner, foodSpiritIds.passive) - 1]! : 0;
      return amount * (1 + bonus);
    },
    handlers: {
      hit: { priority: 24, handle(context, event) { return recordDiningDamage(context, event); } },
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
    const recordedDamage = Math.max(0, Number(meal.values?.damageRecord ?? 0));
    commands.push({ type: 'remove-statuses', source, targetId: target.unitId, statusIds: [foodSpiritIds.dining],
      reason: 'consumed', parentEventId: event.eventId },
    { type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId, instance: {
      instanceId: `${foodSpiritIds.satiated}:${owner?.unitId ?? 'unknown'}:${target.unitId}`,
      statusId: foodSpiritIds.satiated, source, stacks: 1, duration: { kind: 'permanent' },
      values: { foodSpiritId: owner?.unitId ?? '', remainingTurns: 3, mealRank: rank, damageRecord: recordedDamage },
    } });
    if (owner && rank >= 3) commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${foodSpiritIds.protection}:${owner.unitId}:${target.unitId}`, statusId: foodSpiritIds.protection,
        source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } });
    if (owner && owner.hp > 0 && passivesEnabled(owner) && uniquePassiveOwner(context, owner.side)?.unitId === owner.unitId)
      commands.push({ type: 'add-status', source: foodSource(foodSpiritIds.passive, owner.unitId),
      targetId: owner.unitId, parentEventId: event.eventId, instance: { instanceId: `${foodSpiritIds.attackGrowth}:${owner.unitId}`,
        statusId: foodSpiritIds.attackGrowth, source: foodSource(foodSpiritIds.passive, owner.unitId), stacks: 1,
        duration: { kind: 'permanent' }, modifiers: [{ stat: 'attack', operation: 'percent', amount: .3, perStack: true }] } });
    if (owner && rank >= 4) for (const ally of context.getLivingUnits(owner.side))
      commands.push({ type: 'restore-health', source, targetId: ally.unitId, amount: owner.stats.attack * .78, parentEventId: event.eventId });
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
    if (remaining > 1) commands.push({ type: 'add-status', source, targetId: diner.unitId, parentEventId: event.eventId,
      instance: { ...satiated, values: { ...satiated.values, remainingTurns: remaining - 1 } } });
    else {
      if (owner && (owner.hp <= 0 || context.isUnitUnableToAct(owner.unitId))) continue;
      commands.push({ type: 'remove-statuses', source, targetId: diner.unitId, statusIds: [foodSpiritIds.satiated],
        reason: 'consumed', parentEventId: event.eventId });
      if (owner && owner.hp > 0 && passivesEnabled(owner) && uniquePassiveOwner(context, owner.side)?.unitId === owner.unitId) {
        const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
        const foodAttack = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
        const baseRecord = Math.max(0, Number(satiated.values?.damageRecord ?? 0));
        const cap = initialAllyAttackTotal(context, owner.side) * 30;
        const bonus = [.3, .4, .4, .5, .5][skillRank(owner, foodSpiritIds.passive) - 1]!;
        const perEnemy = enemies.length > 0 ? Math.min(baseRecord * feastDamageRatio / enemies.length, cap) * (1 + bonus) : 0;
        const noProc = { suppressSoulTriggers: true, suppressTargetSoulTriggers: true,
          suppressSourcePassiveTriggers: true, suppressTargetPassiveTriggers: true };
        if (perEnemy > 0) for (const enemy of enemies) commands.push({ type: 'deal-damage', source, targetId: enemy.unitId,
          amount: perEnemy, precalculated: true, ...noProc, parentEventId: event.eventId });
        if (rank >= 5 && enemies.length > 0) for (const enemy of enemies) commands.push({ type: 'deal-damage',
          source, targetId: enemy.unitId, amount: foodAttack * .66 * enemies.length, damageKind: 'true', precalculated: true,
          ...noProc, parentEventId: event.eventId });
      }
    }
  }
  return commands.length ? commands : undefined;
}

function assistHighestCritAlly(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.scheduling === 'assist' || !event.intent
    || event.intent.shape !== 'single' || event.intent.targetRelation !== 'enemy') return;
  const actor = context.getUnit(event.intent.actorId); if (!actor || actor.hp <= 0) return;
  const owner = uniquePassiveOwner(context, actor.side);
  if (!owner || skillRank(owner, foodSpiritIds.passive) < 3 || context.isUnitUnableToAct(owner.unitId)) return;
  const highest = context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon')
    .sort((left, right) => right.stats.critDamage - left.stats.critDamage)[0];
  if (!highest || highest.unitId !== actor.unitId) return;
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
  return Math.max(1, Math.min(6, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}

function recordDiningDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.amount <= 0 || event.source.id === foodSpiritIds.feast || !event.source.unitId) return;
  const diner = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  const scheduling = context.state.activeActionScheduling;
  if (!diner || diner.hp <= 0 || !target || target.side === diner.side
    || scheduling === 'assist' || scheduling === 'counter' || scheduling === 'extra-action') return;
  const dining = diner.statuses.find(status => status.statusId === foodSpiritIds.dining);
  if (!dining) return;
  const damageRecord = Math.max(0, Number(dining.values?.damageRecord ?? 0)) + event.amount;
  return [{ type: 'add-status', source: dining.source, targetId: diner.unitId,
    instance: { ...dining, values: { ...dining.values, damageRecord } }, parentEventId: event.eventId }];
}

function uniquePassiveOwner(stateOrContext: BattleState | BattleContext, side: UnitState['side']): Readonly<UnitState> | undefined {
  const units = 'getLivingUnits' in stateOrContext
    ? stateOrContext.getLivingUnits(side)
    : stateOrContext.sides[side].map(unitId => stateOrContext.units[unitId]).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
  return units.find(unit => unit.unitKind !== 'summon' && unit.heroId === foodSpiritIds.hero && passivesEnabled(unit));
}

function initialAllyAttackTotal(context: BattleContext, side: UnitState['side']): number {
  return context.state.sides[side].map(unitId => context.state.units[unitId])
    .filter((unit): unit is UnitState => Boolean(unit && (unit.unitKind === undefined || unit.unitKind === 'shikigami')))
    .reduce((total, unit) => total + Math.max(0, unit.stats.attack), 0);
}

function foodSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
