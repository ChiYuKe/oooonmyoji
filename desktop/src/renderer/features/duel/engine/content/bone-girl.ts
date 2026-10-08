import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const boneGirlIds = {
  hero: 223,
  basic: '2231',
  passive: '2232',
  ultimate: '2233',
  resentment: 'status.hero.223.resentment',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [.78, .82, .86, .9, .94] as const;

export function registerBoneGirl(registry: ContentRegistry): void {
  registry.registerStatus({ id: boneGirlIds.resentment, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 6 });
  const definition: HeroDefinition = {
    id: boneGirlIds.hero,
    skills: [createBasicAttackSkill(boneGirlIds.basic, basicRatios), createUltimate()],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 122, handle(context, event) { return gainResentment(context, event); } },
      'unit-defeated': { priority: 118, handle(context, event) { return reviveFromResentment(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = lowestRatio(enemies);
      const skillId = (context.state.resources[actor.side]?.fire ?? 0) >= 3
        ? boneGirlIds.ultimate : boneGirlIds.basic;
      return { actorId: unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createUltimate(): SkillDefinition {
  return {
    id: boneGirlIds.ultimate,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single',
    targetRelation: 'enemy',
    levels: ultimateRatios.map(ratio => ({ ratio, defenseIgnore: .4, hits: 3 })),
    execute(context, intent, parameters) {
      const targetId = intent.targetIds[0];
      const actor = context.getUnit(intent.actorId);
      const actorStats = actor && context.getEffectiveStats(actor.unitId);
      const target = targetId && context.getUnit(targetId);
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !actorStats || !target || !targetStats || target.hp <= 0) return [];
      const ratio = Number(parameters.ratio ?? .78);
      const defenseIgnore = effectiveDefenseIgnore(actor) + targetStats.defense * Number(parameters.defenseIgnore ?? .4);
      return Array.from({ length: Number(parameters.hits ?? 3) }, () => {
        const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense, defenseIgnore,
          ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
        return { type: 'deal-damage' as const, source: source(boneGirlIds.ultimate, actor.unitId), targetId: target.unitId,
          amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical };
      });
    },
  };
}

function gainResentment(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.targetId || event.attackId === undefined) return;
  const target = context.getUnit(event.targetId);
  if (!target || target.heroId !== boneGirlIds.hero || target.unitKind === 'summon' || !passivesEnabled(target)) return;
  const current = target.statuses.find(status => status.statusId === boneGirlIds.resentment);
  if (current?.values?.lastAttackId === event.attackId) return;
  const stacks = current?.stacks ?? 0;
  if (stacks >= 6) return;
  const next = stacks + 1;
  const sourceRef = source(boneGirlIds.passive, target.unitId);
  const instance: StatusInstance = { instanceId: `${boneGirlIds.resentment}:${target.unitId}`, statusId: boneGirlIds.resentment,
    source: sourceRef, stacks: next, duration: { kind: 'permanent' }, values: { lastAttackId: event.attackId },
    modifiers: [{ stat: 'attack', operation: 'percent', amount: next * .05 }] };
  return [
    ...(current ? [{ type: 'remove-statuses' as const, source: sourceRef, targetId: target.unitId,
      statusIds: [boneGirlIds.resentment], reason: 'replaced' as const, parentEventId: event.eventId }] : []),
    { type: 'add-status', source: sourceRef, targetId: target.unitId, instance, parentEventId: event.eventId },
  ];
}

function reviveFromResentment(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const actor = context.getUnit(event.unitId);
  const status = actor?.statuses.find(item => item.statusId === boneGirlIds.resentment);
  if (!actor || actor.heroId !== boneGirlIds.hero || !passivesEnabled(actor) || (status?.stacks ?? 0) < 4) return;
  const sourceRef = source(boneGirlIds.passive, actor.unitId);
  return [
    { type: 'remove-statuses', source: sourceRef, targetId: actor.unitId, statusIds: [boneGirlIds.resentment],
      reason: 'consumed', parentEventId: event.eventId },
    { type: 'revive', source: sourceRef, targetId: actor.unitId, hp: actor.stats.hp * .2, parentEventId: event.eventId },
  ];
}

function lowestRatio(units: readonly UnitState[]): UnitState {
  return units.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
}

function source(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
