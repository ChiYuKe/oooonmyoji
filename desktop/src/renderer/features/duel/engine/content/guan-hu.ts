import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const guanHuIds = {
  hero: 236,
  basic: '2361',
  guard: '2362',
  ultimate: '2363',
  foxRage: 'status.hero.236.fox-rage',
  bambooGuard: 'status.hero.236.bamboo-guard',
  stun: 'status.hero.236.broken-guard-stun',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [2.21, 2.33, 2.44, 2.55, 2.66] as const;
const shieldRatios = [.2, .25, .3, .3, .3, .3] as const;

export function registerGuanHu(registry: ContentRegistry): void {
  registry.registerStatus({ id: guanHuIds.foxRage, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 4 });
  registry.registerStatus({ id: guanHuIds.bambooGuard, mechanicsCoverage: 'partial', category: 'shield', dispellable: false,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: guanHuIds.stun, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });

  const guard = createBambooGuard();
  const ultimate = createBombardment();
  const definition: HeroDefinition = {
    id: guanHuIds.hero,
    skills: [createBasicAttackSkill(guanHuIds.basic, basicRatios), guard, ultimate],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    policy(context: BattleContext, unitId: string): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const healthRatio = actor.hp / Math.max(1, actor.stats.hp);
      const skillId = healthRatio < .4 ? guanHuIds.guard : fire >= 2 ? guanHuIds.ultimate : guanHuIds.basic;
      if (skillId === guanHuIds.guard) return { actorId: actor.unitId, skillId, targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' };
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: actor.unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      hit: { priority: 145, handle(context, event) {
        return [...(triggerFireReduction(context, event) ?? []), ...(handleGuardBreak(context, event) ?? [])];
      } },
    },
  };
  registry.registerHero(definition);
}

function createBambooGuard(): SkillDefinition {
  return {
    id: guanHuIds.guard,
    actionKind: 'skill',
    target: 'self',
    targetRelation: 'ally',
    levels: shieldRatios.map((shieldRatio, index) => ({ shieldRatio, resistBonus: index >= 3 ? 1 : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      const shieldRatio = Math.max(0, Number(parameters.shieldRatio ?? .2));
      const resistBonus = Math.max(0, Number(parameters.resistBonus ?? 0));
      const source = guanHuSource(guanHuIds.guard, actor.unitId);
      return [
        { type: 'change-action-gauge', source, targetId: actor.unitId, amount: 30 },
        { type: 'add-status', source, targetId: actor.unitId, instance: {
          instanceId: `${guanHuIds.foxRage}:${actor.unitId}`, statusId: guanHuIds.foxRage,
          source, stacks: 1, duration: { kind: 'permanent' },
        } },
        { type: 'add-status', source, targetId: actor.unitId, instance: {
          instanceId: `${guanHuIds.bambooGuard}:${actor.unitId}`, statusId: guanHuIds.bambooGuard,
          source, stacks: 1, duration: { kind: 'permanent' },
          values: { shieldRemaining: actor.stats.hp * shieldRatio },
          modifiers: [
            { stat: 'defense', operation: 'percent', amount: 1 },
            ...(resistBonus > 0 ? [{ stat: 'resist' as const, operation: 'flat' as const, amount: resistBonus }] : []),
          ],
        } },
      ];
    },
  };
}

function createBombardment(): SkillDefinition {
  return {
    id: guanHuIds.ultimate,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single',
    targetRelation: 'enemy',
    levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = context.getEffectiveStats(intent.actorId);
      const targetId = intent.targetIds[0];
      const target = targetId ? context.getUnit(targetId) : undefined;
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || actor.hp <= 0 || !actorStats || !target || target.hp <= 0 || !targetStats) return [];
      const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 2.21),
        critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      return [{ type: 'deal-damage', source: guanHuSource(guanHuIds.ultimate, actor.unitId), targetId: target.unitId,
        amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
    },
  };
}

function triggerFireReduction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== guanHuIds.ultimate || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  if (!attacker || attacker.heroId !== guanHuIds.hero || attacker.hp <= 0
    || (context.state.resources[attacker.side]?.fire ?? 0) <= 0) return;
  const chance = event.isCritical ? 1 : .5;
  if (context.random() >= chance) return;
  return [{ type: 'change-resource', source: guanHuSource(guanHuIds.ultimate, attacker.unitId), side: attacker.side,
    resourceId: 'fire', amount: -1, parentEventId: event.eventId }];
}

function handleGuardBreak(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage') return;
  const target = context.getUnit(event.targetId);
  const guard = target?.statuses.find(status => status.statusId === guanHuIds.bambooGuard);
  if (!target || target.heroId !== guanHuIds.hero || target.hp <= 0 || !guard || Number(guard.values?.shieldRemaining) > 0) return;
  const source = guanHuSource(guanHuIds.guard, target.unitId);
  const stun: EffectCommand = { type: 'apply-control', source, targetId: target.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${guanHuIds.stun}:${target.unitId}:${event.eventId}`, statusId: guanHuIds.stun,
      source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } };
  return [
    { type: 'remove-statuses', source, targetId: target.unitId, statusIds: [guanHuIds.bambooGuard, guanHuIds.foxRage],
      reason: 'consumed', parentEventId: event.eventId },
    stun,
  ];
}

function guanHuSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
