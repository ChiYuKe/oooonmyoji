import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { StatusInstance } from '../core/types';
import { passivesEnabled, passiveSuppressionStatusId } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const lanternGhostIds = {
  hero: 203,
  basic: '2031',
  passive: '2032',
  skill: '2033',
  cage: 'status.hero.203.big-lantern-cage',
} as const;

const basicRatios = [1.05, 1.1, 1.15, 1.2, 1.3] as const;
const critBonuses = [.05, .1, .15, .2, .2] as const;
const fireChances = [.2, .25, .3, .3, .3] as const;

/** 灯笼鬼 migration. Passive trigger frequency across multi-hit attacks remains partial. */
export function registerLanternGhost(registry: ContentRegistry): void {
  registry.registerStatus({ id: lanternGhostIds.cage, mechanicsCoverage: 'verified', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  const cageSkill: SkillDefinition = {
    id: lanternGhostIds.skill,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 4 },
    target: 'all-allies',
    targetRelation: 'ally',
    levels: critBonuses.map(critBonus => ({ critBonus })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const bonus = Number(parameters.critBonus ?? .05);
      const source = { kind: 'skill' as const, id: lanternGhostIds.skill, unitId: actor.unitId };
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target) return [];
        const instance: StatusInstance = { instanceId: `${lanternGhostIds.cage}:${actor.unitId}:${targetId}`,
          statusId: lanternGhostIds.cage, source, stacks: 1,
          duration: { kind: 'count', remaining: 3, owner: 'target-turn' },
          modifiers: [{ stat: 'crit', operation: 'flat', amount: bonus }], values: { critBonus: bonus } };
        return [{ type: 'add-status' as const, source, targetId, instance }];
      });
    },
  };

  const definition: HeroDefinition = {
    id: lanternGhostIds.hero,
    skills: [createBasicAttackSkill(lanternGhostIds.basic, basicRatios), cageSkill],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 25, handle(context, event) {
        if (event.type !== 'damage') return;
        const target = context.getUnit(event.targetId);
        if (!target || target.heroId !== lanternGhostIds.hero || target.hp <= 0 || !passivesEnabled(target) || event.amount <= 0) return;
        const fire = context.state.resources[target.side]?.fire ?? 0;
        if (fire >= 8 || context.random() >= fireChances[Math.max(0, Math.min(4, target.skillLevel - 1))]!) return;
        return [{ type: 'change-resource', source: { kind: 'skill', id: lanternGhostIds.passive, unitId: target.unitId },
          side: target.side, resourceId: 'fire', amount: 1, parentEventId: event.eventId }];
      } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const allies = context.getLivingUnits(actor.side);
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const hasCage = allies.some(unit => unit.statuses.some(status => status.statusId === lanternGhostIds.cage));
      if (!hasCage && (context.state.resources[actor.side]?.fire ?? 0) >= 4) {
        return { actorId: unitId, skillId: lanternGhostIds.skill, targetIds: allies.map(unit => unit.unitId),
          shape: 'all-allies', targetRelation: 'ally' };
      }
      const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp)
        || left.unitId.localeCompare(right.unitId))[0]!;
      return { actorId: unitId, skillId: lanternGhostIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}
