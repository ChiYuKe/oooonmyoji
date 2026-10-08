import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import { calculateIndirectDamage } from '../mechanics/indirect-damage';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

/** 跳跳弟弟's damage-to-attack conversion and Poison Fountain rules. */
export const jumpingYoungerBrotherIds = {
  hero: 225,
  basic: '2251',
  passive: '2252',
  ultimate: '2253',
  attackGrowth: 'status.hero.225.exile-attack-growth',
  corpsePoison: 'status.hero.225.jumping-corpse-poison',
  corrosion: 'status.hero.225.corrosive-toxin',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [.76, .8, .84, .88, .92] as const;
const poisonRatios = [.22, .23, .24, .25, .26] as const;
const attackGrowthRatios = [.05, .06, .07, .08, .09] as const;

export function registerJumpingYoungerBrother(registry: ContentRegistry): void {
  registry.registerStatus({ id: jumpingYoungerBrotherIds.attackGrowth, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: jumpingYoungerBrotherIds.corpsePoison, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace',
    handlers: { 'turn-start': { priority: 72, handle(context, event) { return poisonTick(context, event); } } } });
  registry.registerStatus({ id: jumpingYoungerBrotherIds.corrosion, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });

  const definition: HeroDefinition = {
    id: jumpingYoungerBrotherIds.hero,
    skills: [createBasicAttackSkill(jumpingYoungerBrotherIds.basic, basicRatios), createPoisonFountain()],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 109, handle(context, event) { return gainAttackFromDamage(context, event); } },
      'attack-end': { priority: 113, handle(context, event) { return applyCorpsePoison(context, event); } },
      'effect-resolution': { priority: 112, handle(context, event) { return corrosionAfterPoisonDispel(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (fire >= 2) return { actorId: unitId, skillId: jumpingYoungerBrotherIds.ultimate,
        targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      const target = lowestRatio(enemies);
      return { actorId: unitId, skillId: jumpingYoungerBrotherIds.basic,
        targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createPoisonFountain(): SkillDefinition {
  return {
    id: jumpingYoungerBrotherIds.ultimate,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-enemies',
    targetRelation: 'enemy',
    levels: ultimateRatios.map((ratio, index) => ({ ratio, poisonRatio: poisonRatios[index]!, duration: 2 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const attackerStats = actor && context.getEffectiveStats(actor.unitId);
      if (!actor || !attackerStats) return [];
      const ratio = Number(parameters.ratio ?? .76);
      const source = youngerBrotherSource(jumpingYoungerBrotherIds.ultimate, actor.unitId);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        const targetStats = target && context.getEffectiveStats(target.unitId);
        if (!target || !targetStats || target.hp <= 0) return [];
        const hit = context.calculateDamage({ attack: attackerStats.attack, defense: targetStats.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: attackerStats.crit,
          critDamage: attackerStats.critDamage }, actor, target);
        return [{ type: 'deal-damage' as const, source, targetId: target.unitId,
          amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
      });
    },
  };
}

function gainAttackFromDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.targetId === undefined || event.amount <= 0) return;
  const actor = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== jumpingYoungerBrotherIds.hero || actor.unitKind === 'summon'
    || actor.hp <= 0 || !passivesEnabled(actor)) return;
  const existing = actor.statuses.find(status => status.statusId === jumpingYoungerBrotherIds.attackGrowth);
  const bonus = Math.max(0, Number(existing?.values?.attackBonus ?? 0))
    + event.amount * attackGrowthRatios[Math.max(0, Math.min(4, actor.skillLevel - 1))]!;
  const source = youngerBrotherSource(jumpingYoungerBrotherIds.passive, actor.unitId);
  const instance: StatusInstance = { instanceId: `${jumpingYoungerBrotherIds.attackGrowth}:${actor.unitId}`,
    statusId: jumpingYoungerBrotherIds.attackGrowth, source, stacks: 1, duration: { kind: 'permanent' },
    values: { attackBonus: bonus }, modifiers: [{ stat: 'attack', operation: 'flat', amount: bonus }] };
  return [
    ...(existing ? [{ type: 'remove-statuses' as const, source, targetId: actor.unitId,
      statusIds: [jumpingYoungerBrotherIds.attackGrowth], reason: 'replaced' as const, parentEventId: event.eventId }] : []),
    { type: 'add-status', source, targetId: actor.unitId, instance, parentEventId: event.eventId },
  ];
}

function applyCorpsePoison(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.id !== jumpingYoungerBrotherIds.ultimate || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== jumpingYoungerBrotherIds.hero || actor.unitKind === 'summon') return;
  const poisonRatio = poisonRatios[Math.max(0, Math.min(4, actor.skillLevel - 1))]!;
  const source = youngerBrotherSource(jumpingYoungerBrotherIds.ultimate, actor.unitId);
  return (event.targetHealthChanges ?? []).flatMap(change => {
    const target = context.getUnit(change.targetId);
    if (!target || target.hp <= 0 || target.side === actor.side || change.hpBefore <= 0) return [];
    return attemptDebuff(context, { source, targetId: target.unitId, statusId: jumpingYoungerBrotherIds.corpsePoison,
      baseChance: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      parentEventId: event.eventId, values: { indirectDamageRatio: poisonRatio } });
  });
}

function poisonTick(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  const targetStats = target && context.getEffectiveStats(target.unitId);
  if (!target || !targetStats || target.hp <= 0) return;
  return target.statuses.filter(status => status.statusId === jumpingYoungerBrotherIds.corpsePoison).flatMap(status => {
    const sourceStats = status.source.unitId ? context.getEffectiveStats(status.source.unitId) : undefined;
    const ratio = Number(status.values?.indirectDamageRatio ?? .22);
    if (!sourceStats || !Number.isFinite(ratio) || ratio <= 0) return [];
    const damage = calculateIndirectDamage({ attack: sourceStats.attack, defense: targetStats.defense,
      ratio, critDamage: sourceStats.critDamage }, context.random);
    return [{ type: 'lose-life' as const, source: status.source, targetId: target.unitId,
      amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), lifeLossKind: 'indirect' as const, parentEventId: event.eventId }];
  });
}

function corrosionAfterPoisonDispel(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== jumpingYoungerBrotherIds.corpsePoison
    || event.reason !== 'dispelled' || !event.removedSource?.unitId) return;
  const owner = context.getUnit(event.removedSource.unitId);
  const target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== jumpingYoungerBrotherIds.hero || !target || target.hp <= 0) return;
  const source = youngerBrotherSource(jumpingYoungerBrotherIds.ultimate, owner.unitId);
  const instance: StatusInstance = { instanceId: `${jumpingYoungerBrotherIds.corrosion}:${owner.unitId}:${target.unitId}`,
    statusId: jumpingYoungerBrotherIds.corrosion, source, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    modifiers: [{ stat: 'defense', operation: 'percent', amount: -.4 }] };
  return [{ type: 'add-status', source, targetId: target.unitId, instance, parentEventId: event.eventId }];
}

function lowestRatio(units: readonly UnitState[]): UnitState {
  return units.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
}

function youngerBrotherSource(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
