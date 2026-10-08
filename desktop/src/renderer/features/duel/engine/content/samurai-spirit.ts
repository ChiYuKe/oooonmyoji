import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const samuraiSpiritIds = {
  hero: 222,
  basic: '2221',
  passive: '2222',
  ultimate: '2223',
  haunt: 'status.hero.222.ghost-possession',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1.08, 1.14, 1.19, 1.25, 1.3] as const;
const hauntRatios = [.55, .57, .6, .63, .65] as const;
const hitReduction = [.1, .2, .3, .4, .4] as const;

export function registerSamuraiSpirit(registry: ContentRegistry): void {
  registry.registerStatus({
    id: samuraiSpiritIds.haunt,
    mechanicsCoverage: 'partial',
    category: 'debuff',
    dispellable: true,
    sealable: true,
    durationOwner: 'target-turn',
    refreshPolicy: 'replace',
    handlers: { 'turn-start': { priority: 80, handle(context, event) { return hauntTick(context, event); } } },
  });
  registry.registerHero({
    id: samuraiSpiritIds.hero,
    skills: [createBasicAttackSkill(samuraiSpiritIds.basic, basicRatios), createUltimate()],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    handlers: {
      'attack-end': { priority: 151, handle(context, event) { return applyHauntAfterUltimate(context, event); } },
      'effect-resolution': { priority: 140, handle(context, event) { return firePenaltyOnHauntDispel(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = lowestRatio(enemies);
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (enemies.length >= 2 && fire >= 3) return { actorId: unitId, skillId: samuraiSpiritIds.ultimate,
        targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: samuraiSpiritIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  });
}

function createUltimate(): SkillDefinition {
  return {
    id: samuraiSpiritIds.ultimate,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies',
    targetRelation: 'enemy',
    levels: ultimateRatios.map((ratio, index) => ({ ratio, hauntRatio: hauntRatios[index]!, hitReduction: hitReduction[index]! })),
    execute(context, intent, parameters) {
      return damage(context, intent.actorId, intent.targetIds, samuraiSpiritIds.ultimate, Number(parameters.ratio ?? 1.08));
    },
  };
}

function damage(context: BattleContext, actorId: string, targetIds: readonly string[], skillId: string, ratio: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const attack = context.getEffectiveStats(actorId);
  if (!actor || !attack) return [];
  return targetIds.flatMap(targetId => {
    const target = context.getUnit(targetId);
    const defense = target && context.getEffectiveStats(targetId);
    if (!target || !defense || target.hp <= 0) return [];
    const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
    return [{ type: 'deal-damage' as const, source: source(skillId, actor.unitId), targetId,
      amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
  });
}

function applyHauntAfterUltimate(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.id !== samuraiSpiritIds.ultimate || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== samuraiSpiritIds.hero) return;
  const parameters = ultimateRatios.map((ratio, index) => ({ ratio, hauntRatio: hauntRatios[index]!, hitReduction: hitReduction[index]! }))
    [Math.max(0, Math.min(actor.skillLevel - 1, ultimateRatios.length - 1))]!;
  const commands: EffectCommand[] = [];
  for (const targetChange of event.targetHealthChanges ?? []) {
    const target = context.getUnit(targetChange.targetId);
    if (!target || target.hp <= 0 || target.side === actor.side) continue;
    const sourceRef = source(samuraiSpiritIds.ultimate, actor.unitId);
    const ratio = Number(parameters.hauntRatio);
    const reduction = Number(parameters.hitReduction);
    const applied = attemptDebuff(context, { source: sourceRef, targetId: target.unitId, statusId: samuraiSpiritIds.haunt,
      baseChance: 1, duration: { kind: 'count', remaining: 3, owner: 'target-turn' }, parentEventId: event.eventId,
      values: { indirectDamageRatio: ratio, skillLevel: actor.skillLevel },
      stacks: 1 });
    commands.push(...applied.map(command => command.type === 'add-status' ? { ...command, instance: {
      ...command.instance,
      modifiers: [{ stat: 'hit' as const, operation: 'flat' as const, amount: -reduction }],
    } } : command));
  }
  return commands;
}

function hauntTick(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  return target.statuses.filter(status => status.statusId === samuraiSpiritIds.haunt).flatMap(status => {
    const attack = status.source.unitId ? context.getEffectiveStats(status.source.unitId)?.attack : undefined;
    if (attack === undefined) return [];
    return [{
      type: 'lose-life' as const,
      source: status.source,
      targetId: target.unitId,
      amount: attack * (typeof status.values?.indirectDamageRatio === 'number' ? status.values.indirectDamageRatio : .55),
      lifeLossKind: 'indirect' as const,
      parentEventId: event.eventId,
    }];
  });
}

function firePenaltyOnHauntDispel(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== samuraiSpiritIds.haunt || event.reason !== 'dispelled'
    || !event.removedSource?.unitId) return;
  const owner = context.getUnit(event.removedSource.unitId);
  const target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== samuraiSpiritIds.hero || owner.skillLevel < 5 || !target) return;
  return [{ type: 'change-resource', source: source(samuraiSpiritIds.passive, owner.unitId), side: target.side,
    resourceId: 'fire', amount: -1, parentEventId: event.eventId }];
}

function lowestRatio(units: readonly UnitState[]): UnitState {
  return units.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
}

function source(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
