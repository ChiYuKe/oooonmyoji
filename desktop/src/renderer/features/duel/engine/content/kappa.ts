import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const kappaIds = {
  hero: 209,
  basic: '2091',
  passive: '2092',
  ultimate: '2093',
  moisture: 'status.hero.209.moisture',
} as const;

export function registerKappa(registry: ContentRegistry): void {
  registry.registerStatus({ id: kappaIds.moisture, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 4 });
  registry.registerHero(createKappaDefinition());
}

export function createKappaDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: kappaIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [.75, .79, .83, .87, .91].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      return attack(context, intent.actorId, intent.targetIds[0] ?? '', kappaIds.basic, Number(parameters.ratio ?? .75));
    },
  };
  const ultimate: SkillDefinition = {
    id: kappaIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [.96, 1, 1.04, 1.08, 1.12].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const ratio = Number(parameters.ratio ?? .96);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) return [];
        const targetRatio = target.hp / Math.max(1, target.stats.hp);
        return attack(context, actor.unitId, target.unitId, kappaIds.ultimate, ratio + (targetRatio < .4 ? .2 : 0));
      });
    },
  };
  return {
    id: kappaIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      'action-end': { priority: 70, handle(context, event) {
        if (event.type !== 'action-ended') return;
        const actor = context.getUnit(event.source.unitId ?? '');
        if (!actor || actor.heroId !== kappaIds.hero || actor.hp <= 0 || !passivesEnabled(actor)) return;
        const current = actor.statuses.find(status => status.statusId === kappaIds.moisture
          && status.source.unitId === actor.unitId)?.stacks ?? 0;
        if (current >= 4) return;
        const source = kappaSource(kappaIds.passive, actor.unitId);
        const instance: StatusInstance = { instanceId: `${kappaIds.moisture}:${actor.unitId}`,
          statusId: kappaIds.moisture, source, stacks: 1, duration: { kind: 'permanent' },
          values: { attackBonus: attackBonus(actor.skillLevel) } };
        return [{ type: 'add-status', source, targetId: actor.unitId, instance, parentEventId: event.eventId }];
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        return { actorId: unitId, skillId: kappaIds.ultimate, targetIds: enemies.map(enemy => enemy.unitId),
          shape: 'all-enemies', targetRelation: 'enemy' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      return { actorId: unitId, skillId: kappaIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function attack(context: BattleContext, actorId: string, targetId: string, skillId: string, ratio: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const actorStats = context.getEffectiveStats(actorId);
  const target = context.getUnit(targetId);
  const targetStats = target && context.getEffectiveStats(targetId);
  if (!actor || !actorStats || !target || !targetStats) return [];
  const moisture = actor.statuses.find(status => status.statusId === kappaIds.moisture
    && status.source.unitId === actor.unitId);
  const bonus = Number(moisture?.values?.attackBonus ?? attackBonus(actor.skillLevel));
  const damage = context.calculateDamage({ attack: actorStats.attack * (1 + Math.max(0, bonus) * (moisture?.stacks ?? 0)),
    defense: targetStats.defense, defenseIgnore: effectiveDefenseIgnore(actor), ratio,
    critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
  return [{ type: 'deal-damage', source: kappaSource(skillId, actor.unitId), targetId,
    amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
}

function attackBonus(skillLevel: number): number {
  return [.15, .2, .25, .3, .3][Math.max(0, Math.min(4, skillLevel - 1))]!;
}

function kappaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
