import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { attemptDebuff } from '../mechanics/control';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ContentRegistry } from './registry';

export const sakuraFairyIds = {
  hero: 267, basic: '2671', revive: '2672', ultimate: '2673', dance: 'status.hero.267.revival-dance',
  actionHealTracker: 'status.hero.267.action-heal-tracker', healingReduction: 'status.hero.267.healing-reduction',
  cherryBlossom: 'status.hero.267.cherry-blossom',
} as const;

export function registerSakuraFairy(registry: ContentRegistry): void {
  const dance: StatusDefinition = { id: sakuraFairyIds.dance, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'source-turn', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 4 };
  registry.registerStatus(dance);
  registry.registerStatus({ id: sakuraFairyIds.actionHealTracker, mechanicsCoverage: 'partial', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });
  registry.registerStatus({ id: sakuraFairyIds.healingReduction, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: sakuraFairyIds.cherryBlossom, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace',
    handlers: { 'turn-end': { priority: 70, handle(context, event) { return tickCherryBlossom(context, event); } } } });
  registry.registerHero(createSakuraFairyDefinition());
}

export function createSakuraFairyDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: sakuraFairyIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [1, 1.05, 1.1, 1.15, 1.25].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      return attack(context, intent.actorId, intent.targetIds[0], Number(parameters.ratio ?? 1), sakuraFairyIds.basic);
    } };
  const revive: SkillDefinition = { id: sakuraFairyIds.revive, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'self', targetRelation: 'ally', levels: [1, 2, 3, 4, 5].map(rank => ({ rank })),
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0 || actor.heroId !== sakuraFairyIds.hero) return [];
      const rank = skillRank(actor, sakuraFairyIds.revive);
      const row = battleSkillRow(sakuraFairyIds.revive, rank, actor.awakeFilter,
        actor.unitKind === 'monster' || actor.unitKind === 'summon');
      const buffLevel = skillNumber(row, 'buffLevel') ?? 1;
      const duration = Math.max(1, skillNumber(row, 'buffDuration') ?? 1);
      return [{ type: 'add-status', source: sakuraSource(sakuraFairyIds.revive, actor.unitId), targetId: actor.unitId,
        instance: danceStatus(actor, buffLevel, duration, rank) }];
    } };
  const ultimate: SkillDefinition = { id: sakuraFairyIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [1, 2, 3, 4, 5].map(rank => ({ rank })),
    execute(context, intent) { return castCherryBlossom(context, intent.targetIds, intent.actorId); } };

  return {
    id: sakuraFairyIds.hero, skills: [basic, revive, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['樱落普攻和复苏的鬼火等级、复苏之舞叠层、友方行动后治疗及回合结束治疗已接入。',
      '樱吹雪逐目标驱散、未驱散返火、减疗命中和落樱间接伤害已接入；合并技能行与直接客户端表在概率/等级字段存在冲突，按直接客户端表实现，需录像核对。'],
    modifyOutgoingHealing(healer, _target, amount) {
      if (healer.heroId !== sakuraFairyIds.hero) return amount;
      const dance = healer.statuses.find(status => status.statusId === sakuraFairyIds.dance);
      if (!dance) return amount;
      return amount * (1 + Number(dance.values?.healingBonusPerStack ?? 0) * dance.stacks);
    },
    handlers: {
      'action-end': { priority: 70, handle(context, event) { return healAfterAllyAction(context, event); } },
      'turn-end': { priority: 70, handle(context, event) { return topUpAtAllyTurnEnd(context, event); } },
    },
  };
}

function healAfterAllyAction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended') return;
  const allyId = event.intent?.actorId ?? event.source.unitId;
  if (!allyId) return;
  const ally = context.getUnit(allyId);
  if (!ally || ally.hp <= 0 || ally.unitKind === 'summon') return;
  const healers = context.getLivingUnits(ally.side).filter(unit => unit.heroId === sakuraFairyIds.hero && unit.unitId !== allyId
    && passivesEnabled(unit) && !context.isUnitUnableToAct(unit.unitId));
  if (healers.length === 0) return;
  const commands: EffectCommand[] = [];
  for (const healer of healers) {
    const row = skillRow(healer, sakuraFairyIds.revive);
    const amount = Math.max(0, skillNumber(row, 'param1') ?? .06) * ally.stats.hp;
    const source = sakuraSource(sakuraFairyIds.revive, healer.unitId);
    commands.push({ type: 'heal', source, targetId: ally.unitId, amount, parentEventId: event.eventId });
    commands.push({ type: 'add-status', source, targetId: ally.unitId,
      instance: { instanceId: `${sakuraFairyIds.actionHealTracker}:${healer.unitId}:${ally.unitId}`,
        statusId: sakuraFairyIds.actionHealTracker, source, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'event', event: 'turn-end' } }, parentEventId: event.eventId });
  }
  return commands;
}

function topUpAtAllyTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const ally = context.getUnit(event.unitId);
  if (!ally) return;
  const trackers = ally.statuses.filter(status => status.statusId === sakuraFairyIds.actionHealTracker);
  if (trackers.length === 0) return;
  const commands: EffectCommand[] = [];
  for (const tracker of trackers) {
    const healer = tracker.source.unitId ? context.getUnit(tracker.source.unitId) : undefined;
    commands.push({ type: 'remove-status-instances', source: tracker.source, targetId: ally.unitId,
      instanceIds: [tracker.instanceId], reason: 'consumed', parentEventId: event.eventId });
    if (!healer || healer.hp <= 0 || !passivesEnabled(healer) || context.isUnitUnableToAct(healer.unitId)) continue;
    const row = skillRow(healer, sakuraFairyIds.revive);
    const p1 = Math.max(0, skillNumber(row, 'param1') ?? .06);
    const p2 = Math.max(p1, skillNumber(row, 'param2') ?? .09);
    const p3 = Math.max(0, skillNumber(row, 'param3') ?? .04);
    const source = sakuraSource(sakuraFairyIds.revive, healer.unitId);
    commands.push({ type: 'heal', source, targetId: ally.unitId, amount: (p2 - p1) * ally.stats.hp, parentEventId: event.eventId });
    commands.push({ type: 'heal', source, targetId: healer.unitId, amount: p3 * healer.stats.hp, parentEventId: event.eventId });
  }
  return commands;
}

function castCherryBlossom(context: BattleContext, targetIds: readonly string[], actorId: string): EffectCommand[] {
  const actor = context.getUnit(actorId);
  if (!actor || actor.hp <= 0 || actor.heroId !== sakuraFairyIds.hero) return [];
  const rank = skillRank(actor, sakuraFairyIds.ultimate);
  const source = sakuraSource(sakuraFairyIds.ultimate, actor.unitId);
  const commands: EffectCommand[] = [];
  let dispelledAny = false;
  const reduction = rank >= 4 ? .6 : .5;
  // The direct client table records 50% before awakening and 100% after; the merged capture has conflicting values.
  const baseChance = actor.awakeFilter === 1 ? 1 : .5;
  const livingTargets = [...new Set(targetIds)].map(id => context.getUnit(id)).filter((unit): unit is UnitState =>
    Boolean(unit && unit.hp > 0 && unit.side !== actor.side));
  for (const target of livingTargets) {
    const dispellableBuffs = target.statuses.filter(status => context.isStatusDispellable(status.statusId)
      && context.getStatusCategory(status.statusId) === 'buff');
    if (dispellableBuffs.length > 0) dispelledAny = true;
    commands.push({ type: 'dispel-statuses', source, targetId: target.unitId, maxCount: 3, filter: 'buff' });
    commands.push(...attemptDebuff(context, { source, targetId: target.unitId, statusId: sakuraFairyIds.healingReduction,
      baseChance, duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, parentEventId: undefined,
      modifiers: [{ stat: 'healingTaken', operation: 'percent', amount: -reduction }] }));
    const dotRatio = [0, .09, .14, .19, .19, .19][rank] ?? .09;
    commands.push({ type: 'add-status', source, targetId: target.unitId,
      instance: { instanceId: `${sakuraFairyIds.cherryBlossom}:${actor.unitId}:${target.unitId}:${context.state.counters.action}`,
        statusId: sakuraFairyIds.cherryBlossom, source, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        values: { indirectDamageRatio: dotRatio, attackCapRatio: 3.7 } } });
  }
  const refund = rank >= 5 ? 1 : 0;
  if (!dispelledAny && refund > 0) commands.push({ type: 'change-resource', source, side: actor.side,
    resourceId: 'fire', amount: refund });
  return commands;
}

function tickCherryBlossom(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  return target.statuses.filter(status => status.statusId === sakuraFairyIds.cherryBlossom).flatMap(status => {
    const owner = status.source.unitId ? context.getEffectiveStats(status.source.unitId) : undefined;
    if (!owner) return [];
    const ratio = Math.max(0, Number(status.values?.indirectDamageRatio ?? .09));
    const capRatio = Math.max(0, Number(status.values?.attackCapRatio ?? 3.7));
    return [{ type: 'lose-life' as const, source: status.source, targetId: target.unitId,
      amount: Math.min(target.stats.hp * ratio, owner.attack * capRatio), lifeLossKind: 'indirect' as const,
      parentEventId: event.eventId }];
  });
}

function danceStatus(actor: UnitState, buffLevel: number, duration: number, rank: number): StatusInstance {
  const healingBonusPerStack = buffLevel >= 3 ? 1 : .4;
  return { instanceId: `${sakuraFairyIds.dance}:${actor.unitId}`, statusId: sakuraFairyIds.dance,
    source: sakuraSource(sakuraFairyIds.revive, actor.unitId), stacks: 1,
    duration: { kind: 'count', remaining: duration, owner: 'source-turn' },
    ...(rank >= 2 ? { modifiers: [{ stat: 'resist' as const, operation: 'flat' as const, amount: .5 }] } : {}),
    values: { healingBonusPerStack } };
}

function attack(context: BattleContext, actorId: string, targetId: string | undefined, ratio: number, skillId: string): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const target = targetId ? context.getUnit(targetId) : undefined;
  if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
  const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
  return [{ type: 'deal-damage', source: sakuraSource(skillId, actor.unitId), targetId: target.unitId,
    amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}

function skillRank(actor: UnitState, skillId: string): number {
  return Math.max(1, Math.min(5, actor.skillLevels?.[skillId] ?? actor.skillLevel));
}

function skillRow(actor: UnitState, skillId: string) {
  return battleSkillRow(skillId, skillRank(actor, skillId), actor.awakeFilter,
    actor.unitKind === 'monster' || actor.unitKind === 'summon');
}

function sakuraSource(skillId: string, unitId: string): SourceRef {
  return { kind: 'skill', id: skillId, unitId };
}
