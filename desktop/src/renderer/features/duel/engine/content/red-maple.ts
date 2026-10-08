import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const redMapleIds = {
  hero: 231,
  basic: '2311',
  passive: '2312',
  dance: '2313',
  doll: 'status.hero.231.red-maple-doll',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const danceRatios = [1.32, 1.39, 1.46, 1.52, 1.59] as const;

/** 鬼女红叶 content migration. The level-5 fire surcharge remains partial. */
export function registerRedMaple(registry: ContentRegistry): void {
  registry.registerStatus({ id: redMapleIds.doll, mechanicsCoverage: 'partial', category: 'mark', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createRedMapleDefinition());
}

export function createRedMapleDefinition(): HeroDefinition {
  const dance: SkillDefinition = {
    id: redMapleIds.dance,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies',
    targetRelation: 'enemy',
    levels: danceRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const attack = actor && context.getEffectiveStats(actor.unitId);
      if (!actor || !attack) return [];
      const ratio = Number(parameters.ratio ?? 1.32);
      const source = { kind: 'skill' as const, id: redMapleIds.dance, unitId: actor.unitId };
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        const defense = target && context.getEffectiveStats(targetId);
        if (!target || !defense) return [];
        const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor), ratio,
          critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
        return [{ type: 'deal-damage' as const, source, targetId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
          ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, attack.critDamage) } : {}), isCritical: result.isCritical }];
      });
    },
  };

  return {
    id: redMapleIds.hero,
    skills: [createBasicAttackSkill(redMapleIds.basic, basicRatios), dance],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 30, handle(context, event) {
        if (event.type !== 'damage' || !event.source.unitId || event.damageKind !== 'normal') return;
        const attacker = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        if (!attacker || attacker.heroId !== redMapleIds.hero || attacker.hp <= 0 || !target || target.hp <= 0) return;
        const chance = attacker.skillLevel >= 4 ? .8 : attacker.skillLevel >= 3 ? .7 : attacker.skillLevel >= 2 ? .6 : .5;
        const curseRatio = attacker.skillLevel >= 4 ? .3 : attacker.skillLevel >= 3 ? .26 : attacker.skillLevel >= 2 ? .22 : .18;
        return [{ type: 'add-status', source: mapleSource(attacker.unitId), targetId: target.unitId,
          instance: dollStatus(attacker, context.getEffectiveStats(attacker.unitId)?.attack ?? attacker.stats.attack, chance, curseRatio),
          parentEventId: event.eventId }];
      } },
      'attack-end': { priority: 30, handle(context, event) {
        if (event.type !== 'attack-ended' || event.actionKind === 'passive' || !event.source.unitId) return;
        const attacker = context.getUnit(event.source.unitId);
        if (!attacker || attacker.hp <= 0) return;
        const commands: EffectCommand[] = [];
        for (const mark of attacker.statuses.filter(status => status.statusId === redMapleIds.doll)) {
          const chance = Number(mark.values?.curseChance ?? .5);
          if (context.random() >= chance || attacker.hp <= 0) continue;
          const ratio = Number(mark.values?.curseRatio ?? .18);
          const attack = Number(mark.values?.attack ?? 0);
          commands.push({ type: 'deal-damage', source: mark.source, targetId: attacker.unitId,
            amount: Math.min(attacker.hp * ratio, attack * 2.5), damageKind: 'true', parentEventId: event.eventId });
        }
        return commands;
      } },
      'unit-defeated': { priority: 30, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const victim = context.getUnit(event.unitId);
        if (!victim || !victim.statuses.some(status => status.statusId === redMapleIds.doll)) return;
        const mapleSide = victim.side === 'blue' ? 'red' : 'blue';
        if (!context.state.sides[mapleSide].some(unitId => context.getUnit(unitId)?.heroId === redMapleIds.hero)) return;
        const dolls = context.state.sides[victim.side].flatMap(unitId => {
          const unit = context.getUnit(unitId);
          return unit?.statuses.filter(status => status.statusId === redMapleIds.doll).map(status => ({ unit, status })) ?? [];
        });
        if (dolls.length === 0) return;
        const commands: EffectCommand[] = dolls.map(({ unit, status }) => ({ type: 'remove-statuses', source: mapleSource(status.source.unitId ?? unit.unitId),
          targetId: unit.unitId, statusIds: [redMapleIds.doll], reason: 'consumed', parentEventId: event.eventId }));
        for (const { unit, status } of dolls) {
          const amount = Number(status.values?.attack ?? 0) * Number(status.values?.explosionRatio ?? .42);
          for (const target of context.getLivingUnits(victim.side)) commands.push({ type: 'deal-damage', source: mapleSource(unit.unitId),
            targetId: target.unitId, amount, damageKind: 'true', parentEventId: event.eventId });
        }
        return commands;
      } },
      'resource-payment': { priority: 30, handle(context, event) {
        if (event.type !== 'resource-changed' || event.resourceId !== 'fire' || event.after >= event.before
          || event.source.id === redMapleIds.passive || !event.source.unitId) return;
        const caster = context.getUnit(event.source.unitId);
        if (!caster) return;
        const markedEnemy = context.getLivingUnits(caster.side === 'blue' ? 'red' : 'blue')
          .some(target => target.statuses.some(status => status.statusId === redMapleIds.doll));
        const mapleThreat = context.getLivingUnits(caster.side === 'blue' ? 'red' : 'blue')
          .some(unit => unit.heroId === redMapleIds.hero && unit.skillLevel >= 5);
        if (!markedEnemy || !mapleThreat || context.random() >= .5) return;
        const remainingFire = context.state.resources[caster.side]?.fire ?? 0;
        if (remainingFire <= 0) return;
        return [{ type: 'change-resource', source: mapleSource(
          context.getLivingUnits(caster.side === 'blue' ? 'red' : 'blue').find(unit => unit.heroId === redMapleIds.hero && unit.skillLevel >= 5)!.unitId),
          side: caster.side, resourceId: 'fire', amount: -1, parentEventId: event.eventId }];
      } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const wantsDance = enemies.length >= 2 || (context.state.resources[actor.side]?.fire ?? 0) > 5;
      const useDance = wantsDance && (context.state.resources[actor.side]?.fire ?? 0) >= 3;
      const targets = useDance ? enemies.map(unit => unit.unitId) : [lowestHealthRatio(enemies).unitId];
      return { actorId: unitId, skillId: useDance ? redMapleIds.dance : redMapleIds.basic, targetIds: targets,
        shape: useDance ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    },
  };
}

function dollStatus(sourceUnit: Readonly<UnitState>, attack: number, curseChance: number, curseRatio: number): StatusInstance {
  const source = mapleSource(sourceUnit.unitId);
  return { instanceId: `${redMapleIds.doll}:${sourceUnit.unitId}`, statusId: redMapleIds.doll, source, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    values: { attack, curseChance, curseRatio, explosionRatio: .42 } };
}

function mapleSource(unitId: string) { return { kind: 'skill' as const, id: redMapleIds.passive, unitId }; }

function lowestHealthRatio(units: readonly UnitState[]): UnitState {
  return [...units].sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp)
    || left.unitId.localeCompare(right.unitId))[0]!;
}
