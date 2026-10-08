import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { EffectCommand } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ContentRegistry } from './registry';

export const zashikiIds = {
  hero: 205,
  basic: '2051',
  passive: '2052',
  offering: '2054',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const openingFire = [1, 2, 3, 3, 3] as const;
const offeringFire = [2, 3, 3, 3, 3] as const;
const offeringLifeCost = [.3, .3, .2, .2, .2] as const;

/** 座敷童子 migration: opening fire, basic-hit fire, and life-to-fire conversion. */
export function registerZashiki(registry: ContentRegistry): void {
  const offering: SkillDefinition = {
    id: zashikiIds.offering,
    actionKind: 'skill',
    target: 'self',
    targetRelation: 'ally',
    levels: offeringFire.map((fire, index) => ({ fire, lifeCost: offeringLifeCost[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source = { kind: 'skill' as const, id: zashikiIds.offering, unitId: actor.unitId };
      const fireNow = context.state.resources[actor.side]?.fire ?? 0;
      const fireGain = Math.min(Number(parameters.fire ?? 2), Math.max(0, 8 - fireNow));
      const lifeCost = actor.hp * Number(parameters.lifeCost ?? .3);
      const commands: EffectCommand[] = [{ type: 'lose-life', source, targetId: actor.unitId, amount: lifeCost }];
      if (fireGain > 0) commands.push({ type: 'change-resource', source, side: actor.side, resourceId: 'fire', amount: fireGain });
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: zashikiIds.hero,
    skills: [createBasicAttackSkill(zashikiIds.basic, basicRatios), offering],
    aiCoverage: 'verified',
    mechanicsCoverage: 'verified',
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return [];
      const current = context.state.resources[actor.side]?.fire ?? 0;
      const gain = Math.min(openingFire[Math.max(0, Math.min(4, actor.skillLevel - 1))]!, Math.max(0, 8 - current));
      return gain > 0 ? [{ type: 'change-resource', source: passiveSource(actor.unitId), side: actor.side,
        resourceId: 'fire', amount: gain }] : [];
    },
    handlers: {
      'attack-end': { priority: 20, handle(context, event) {
        if (event.type !== 'attack-ended' || event.actionKind !== 'basic' || event.source.id !== zashikiIds.basic
          || !event.source.unitId) return;
        const actor = context.getUnit(event.source.unitId);
        if (!actor || !passivesEnabled(actor) || (context.state.resources[actor.side]?.fire ?? 0) >= 8 || context.random() >= .5) return;
        return [{ type: 'change-resource', source: passiveSource(actor.unitId), side: actor.side, resourceId: 'fire', amount: 1,
          parentEventId: event.eventId }];
      } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (fire < 6 && actor.hp > 0) return { actorId: unitId, skillId: zashikiIds.offering,
        targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp)
        || left.unitId.localeCompare(right.unitId))[0]!;
      return { actorId: unitId, skillId: zashikiIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function passiveSource(unitId: string) {
  return { kind: 'skill' as const, id: zashikiIds.passive, unitId };
}
