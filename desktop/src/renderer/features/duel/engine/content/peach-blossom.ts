import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, EffectCommand, StatusInstance } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const peachBlossomIds = {
  hero: 200,
  basic: '2001',
  healingSkill: '2002',
  reviveSkill: '2003',
  blossom: 'status.hero.200.blossom',
  passive: '2002-passive',
} as const;

export function registerPeachBlossom(registry: ContentRegistry): void {
  registry.registerStatus({ id: peachBlossomIds.blossom, mechanicsCoverage: 'partial', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', category: 'buff' });
  registry.registerHero(createPeachBlossomDefinition());
}

export function createPeachBlossomDefinition(): HeroDefinition {
  const healing: SkillDefinition = {
    id: peachBlossomIds.healingSkill,
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single',
    targetRelation: 'ally',
    levels: [.2, .21, .22, .23, .25].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!target) return [];
      return [{ type: 'heal', source: { kind: 'skill', id: peachBlossomIds.healingSkill, unitId: intent.actorId },
        targetId: target.unitId, amount: target.stats.hp * Number(parameters.ratio ?? .2) }];
    },
  };
  const revive: SkillDefinition = {
    id: peachBlossomIds.reviveSkill,
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single',
    targetRelation: 'ally',
    allowDefeatedTargets: true,
    levels: [.2, .21, .22, .23, .25].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!target || target.hp > 0) return [];
      return [{ type: 'revive', source: { kind: 'skill', id: peachBlossomIds.reviveSkill, unitId: intent.actorId },
        targetId: target.unitId, hp: target.stats.hp * Number(parameters.ratio ?? .2) }];
    },
  };

  const definition: HeroDefinition = {
    id: peachBlossomIds.hero,
    skills: [createBasicAttackSkill(peachBlossomIds.basic, [1, 1.05, 1.1, 1.15, 1.25]), healing, revive],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      'effect-resolution': { priority: 0, handle(context, event) {
        if (event.type !== 'healing' || event.source.id !== peachBlossomIds.healingSkill || !event.source.unitId) return;
        const healer = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        if (!healer || healer.heroId !== peachBlossomIds.hero || !passivesEnabled(healer)
          || !target || target.hp <= 0 || event.amount <= 0) return;
        const source = { kind: 'skill' as const, id: peachBlossomIds.passive, unitId: healer.unitId };
        const blossom: StatusInstance = {
          instanceId: `${peachBlossomIds.blossom}:${healer.unitId}:${target.unitId}:${event.eventId}`,
          statusId: peachBlossomIds.blossom,
          source,
          appliedByEventId: event.eventId,
          stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        };
        const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: target.unitId, instance: blossom,
          parentEventId: event.eventId }];
        for (const ally of context.getLivingUnits(healer.side)) {
          if (ally.unitId === target.unitId) continue;
          commands.push({ type: 'heal', source, targetId: ally.unitId, amount: event.amount * .3, parentEventId: event.eventId });
        }
        return commands;
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const allyIds = context.state.sides[actor.side];
      const allies = allyIds.map(id => context.getUnit(id)).filter((unit): unit is NonNullable<typeof unit> => Boolean(unit));
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fallen = allies.find(ally => ally.hp <= 0);
      if (fallen) return { actorId: unitId, skillId: peachBlossomIds.reviveSkill, targetIds: [fallen.unitId], shape: 'single', targetRelation: 'ally' };
      const living = allies.filter(ally => ally.hp > 0);
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const healTarget = living.find(ally => ally.hp / Math.max(1, ally.stats.hp) < .65)
        ?? (living.find(ally => ally.hp / Math.max(1, ally.stats.hp) < .8) && context.random() < .75
          ? living.find(ally => ally.hp / Math.max(1, ally.stats.hp) < .8) : undefined);
      if (fire >= 2 && healTarget) return { actorId: unitId, skillId: peachBlossomIds.healingSkill,
        targetIds: [healTarget.unitId], shape: 'single', targetRelation: 'ally' };
      return { actorId: unitId, skillId: peachBlossomIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  return definition;
}
