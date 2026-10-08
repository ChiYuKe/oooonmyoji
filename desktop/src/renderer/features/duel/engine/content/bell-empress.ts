import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const bellEmpressIds = {
  hero: 376,
  basic: '3761',
  flameHeal: '3762',
  fiveMountain: '3763',
  eternalFlame: '3764',
  divine: 'status.hero.376.divine-fire',
  eternal: 'status.hero.376.eternal-flame',
  allyEternal: 'status.hero.376.eternal-aura',
  fiveMountainStacks: 'status.hero.376.five-mountain-stacks',
  eternalShield: 'status.hero.376.eternal-shield',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const extraLifeCosts = [.25, .21, .17, .13, .13] as const;

/** Partial modular migration for 铃彦姬; resource replacement and eternal-flame team exit need later work. */
export function registerBellEmpress(registry: ContentRegistry): void {
  registry.registerStatus({ id: bellEmpressIds.divine, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: bellEmpressIds.eternal, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep', controlProtection: 'immune', statusImmunity: 'debuffs' });
  registry.registerStatus({ id: bellEmpressIds.allyEternal, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: bellEmpressIds.fiveMountainStacks, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 5 });
  registry.registerStatus({ id: bellEmpressIds.eternalShield, mechanicsCoverage: 'verified', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createBellEmpressDefinition());
}

export function createBellEmpressDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(bellEmpressIds.basic, basicRatios);
  const heal: SkillDefinition = {
    id: bellEmpressIds.flameHeal,
    target: 'all-allies',
    targetRelation: 'ally',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source = { kind: 'skill' as const, id: bellEmpressIds.flameHeal, unitId: actor.unitId };
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) return [];
        return [{ type: 'heal' as const, source, targetId,
          amount: target.unitId === actor.unitId ? actor.stats.hp * .4 : actor.stats.hp * .12 }];
      });
    },
  };
  const fiveMountain: SkillDefinition = {
    id: bellEmpressIds.fiveMountain,
    suppressSoulTriggers: true,
    target: 'all-enemies',
    targetRelation: 'enemy',
    levels: [{ ratio: .72 }, { ratio: .72 }, { ratio: .72 }, { ratio: .72 }, { ratio: .72 }],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source = { kind: 'skill' as const, id: bellEmpressIds.fiveMountain, unitId: actor.unitId };
      const ignoreStacks = actor.statuses.find(status => status.statusId === bellEmpressIds.fiveMountainStacks)?.stacks ?? 0;
      const commands: EffectCommand[] = [];
      const addHits = (ratio: number): void => {
        for (const targetId of intent.targetIds) {
          const target = context.getUnit(targetId);
          if (!target || target.hp <= 0) continue;
          const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
          const targetStats = context.getEffectiveStats(targetId) ?? target.stats;
          const result = context.calculateDamage({ attack: actorStats.attack, defense: Math.max(0, targetStats.defense - ignoreStacks * 30),
            defenseIgnore: effectiveDefenseIgnore(actor),
            ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
          commands.push({ type: 'deal-damage', source, targetId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
            ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, actorStats.critDamage) } : {}), isCritical: result.isCritical });
        }
      };
      addHits(Number(parameters.ratio ?? .72));
      let projectedHp = actor.hp;
      let fire = Math.max(0, context.state.resources[actor.side]?.fire ?? 0);
      const lifeCost = extraLifeCosts[Math.max(0, Math.min(4, actor.skillLevel - 1))]!;
      while (fire > 0 && projectedHp / Math.max(1, actor.stats.hp) >= .5 && projectedHp > 0) {
        commands.push({ type: 'change-resource', source, side: actor.side, resourceId: 'fire', amount: -1 });
        commands.push({ type: 'lose-life', source, targetId: actor.unitId, amount: actor.stats.hp * lifeCost });
        projectedHp = Math.max(0, projectedHp - actor.stats.hp * lifeCost);
        fire--;
        addHits(.43);
      }
      return commands;
    },
  };

  return {
    id: bellEmpressIds.hero,
    skills: [basic, heal, fiveMountain],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      'hit': { priority: 10, handle(context, event) {
        if (event.type !== 'damage') return;
        const target = context.getUnit(event.targetId);
        const commands: EffectCommand[] = [];
        if (target?.heroId === bellEmpressIds.hero && target.hp > 0
          && !target.statuses.some(status => status.statusId === bellEmpressIds.divine || status.statusId === bellEmpressIds.eternal)) {
          const threshold = target.skillLevel >= 2 ? .75 : .5;
          if (target.hp / Math.max(1, target.stats.hp) < threshold) commands.push(divineFireCommand(target, event.eventId));
        }
        if (event.source.id === bellEmpressIds.fiveMountain && event.source.unitId) {
          const attacker = context.getUnit(event.source.unitId);
          if (attacker && attacker.skillLevel >= 5) {
            const previous = attacker.statuses.find(status => status.statusId === bellEmpressIds.fiveMountainStacks);
            const attacks = Number(previous?.values?.attackCount ?? 0) + 1;
            const stacks = Math.min(5, Math.floor(attacks / 5));
            const source = { kind: 'skill' as const, id: bellEmpressIds.fiveMountain, unitId: attacker.unitId };
            commands.push({ type: 'add-status', source, targetId: attacker.unitId, instance: {
              instanceId: `${bellEmpressIds.fiveMountainStacks}:${attacker.unitId}:${event.attackId ?? context.state.counters.action}`,
              statusId: bellEmpressIds.fiveMountainStacks, source, stacks, duration: { kind: 'permanent' }, values: { attackCount: attacks },
            }, parentEventId: event.eventId });
          }
        }
        return commands;
      } },
      'unit-defeated': { priority: 10, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const target = context.getUnit(event.unitId);
        if (!target) return;
        if (target.heroId === bellEmpressIds.hero && target.skillLevel >= 4) {
          if (target.statuses.some(status => status.statusId === bellEmpressIds.eternal)) {
            const allySurvives = context.getLivingUnits(target.side).some(unit => unit.unitId !== target.unitId);
            return allySurvives ? [{ type: 'revive', source: { kind: 'status', id: bellEmpressIds.eternal, unitId: target.unitId },
              targetId: target.unitId, hp: 1, parentEventId: event.eventId }] : [];
          }
          const oldStatusIds = [...new Set(target.statuses.map(status => status.statusId))];
          const source = { kind: 'skill' as const, id: bellEmpressIds.eternalFlame, unitId: target.unitId };
          const commands: EffectCommand[] = [];
          if (oldStatusIds.length > 0) commands.push({ type: 'remove-statuses', source, targetId: target.unitId,
            statusIds: oldStatusIds, reason: 'consumed', parentEventId: event.eventId });
          commands.push({ type: 'add-status', source, targetId: target.unitId, instance: eternalStatus(target, source) });
          if (target.skillLevel >= 5) commands.push(addEternalShield(target));
          commands.push({ type: 'revive', source, targetId: target.unitId, hp: target.stats.hp * .5, parentEventId: event.eventId });
          for (const ally of context.getLivingUnits(target.side).filter(unit => unit.unitId !== target.unitId)) {
            commands.push(allyAura(ally, target));
          }
          return commands;
        }
        const bell = Object.values(context.state.units).find(unit => unit.heroId === bellEmpressIds.hero && unit.hp > 0
          && unit.statuses.some(status => status.statusId === bellEmpressIds.eternal) && unit.side === target.side);
        if (!bell) return;
        const otherLiving = context.getLivingUnits(target.side).filter(unit => unit.unitId !== bell.unitId);
        if (otherLiving.length === 0) return [{ type: 'lose-life', source: { kind: 'status', id: bellEmpressIds.eternal, unitId: bell.unitId },
          targetId: bell.unitId, amount: bell.hp, parentEventId: event.eventId }];
        return [{ type: 'heal', source: { kind: 'status', id: bellEmpressIds.eternal, unitId: bell.unitId },
          targetId: bell.unitId, amount: bell.stats.hp * .5, parentEventId: event.eventId }];
      } },
      'effect-resolution': { priority: 10, handle(context, event) {
        if (event.type === 'life-lost') {
          const target = context.getUnit(event.targetId);
          if (!target || target.heroId !== bellEmpressIds.hero || target.hp <= 0
            || target.statuses.some(status => status.statusId === bellEmpressIds.divine || status.statusId === bellEmpressIds.eternal)) return;
          const threshold = target.skillLevel >= 2 ? .75 : .5;
          if (target.hp / Math.max(1, target.stats.hp) < threshold) return [divineFireCommand(target, event.eventId)];
        }
        if (event.type === 'healing') {
          const target = context.getUnit(event.targetId);
          if (!target || target.heroId !== bellEmpressIds.hero || target.hp < target.stats.hp
            || !target.statuses.some(status => status.statusId === bellEmpressIds.eternal)) return;
          const statusIds = [bellEmpressIds.eternal, bellEmpressIds.divine, bellEmpressIds.eternalShield, bellEmpressIds.allyEternal];
          const commands: EffectCommand[] = [{ type: 'remove-statuses', source: { kind: 'skill', id: bellEmpressIds.flameHeal,
            unitId: target.unitId }, targetId: target.unitId, statusIds, reason: 'consumed', parentEventId: event.eventId }];
          for (const ally of context.getLivingUnits(target.side)) if (ally.unitId !== target.unitId) {
            commands.push({ type: 'remove-statuses', source: { kind: 'skill', id: bellEmpressIds.flameHeal, unitId: target.unitId },
              targetId: ally.unitId, statusIds: [bellEmpressIds.allyEternal], reason: 'consumed', parentEventId: event.eventId });
          }
          return commands;
        }
      } },
      'turn-end': { priority: 10, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const actor = context.getUnit(event.unitId);
        if (!actor) return;
        const bells = Object.values(context.state.units).filter(unit => unit.heroId === bellEmpressIds.hero && unit.hp > 0
          && unit.side === actor.side && unit.skillLevel >= 3 && unit.statuses.some(status => status.statusId === bellEmpressIds.divine)
          && unit.unitId !== actor.unitId);
        return bells.map(bell => ({ type: 'heal' as const, source: { kind: 'skill' as const, id: bellEmpressIds.flameHeal,
          unitId: bell.unitId }, targetId: bell.unitId, amount: bell.stats.hp * .08, parentEventId: event.eventId }));
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.statuses.some(status => status.statusId === bellEmpressIds.eternal)) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      if (actor.hp / Math.max(1, actor.stats.hp) <= .5) return { actorId: unitId, skillId: bellEmpressIds.flameHeal,
        targetIds: context.getLivingUnits(actor.side).map(ally => ally.unitId), shape: 'all-allies', targetRelation: 'ally' };
      return { actorId: unitId, skillId: bellEmpressIds.fiveMountain,
        targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
    },
  };
}

function divineFireCommand(unit: Readonly<UnitState>, parentEventId: string): EffectCommand {
  const source = { kind: 'skill' as const, id: bellEmpressIds.flameHeal, unitId: unit.unitId };
  return { type: 'add-status', source, targetId: unit.unitId, instance: { instanceId: `${bellEmpressIds.divine}:${unit.unitId}`,
    statusId: bellEmpressIds.divine, source, stacks: 1, duration: { kind: 'permanent' } }, parentEventId };
}

function eternalStatus(unit: Readonly<UnitState>, source: StatusInstance['source']): StatusInstance {
  return { instanceId: `${bellEmpressIds.eternal}:${unit.unitId}`, statusId: bellEmpressIds.eternal, source, stacks: 1,
    duration: { kind: 'permanent' }, modifiers: [{ stat: 'defense', operation: 'percent', amount: 1 }] };
}

function addEternalShield(unit: Readonly<UnitState>): EffectCommand {
  const source = { kind: 'skill' as const, id: bellEmpressIds.eternalFlame, unitId: unit.unitId };
  return { type: 'add-status', source, targetId: unit.unitId, instance: { instanceId: `${bellEmpressIds.eternalShield}:${unit.unitId}`,
    statusId: bellEmpressIds.eternalShield, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    values: { shieldRemaining: unit.stats.attack * 1.2 } } };
}

function allyAura(ally: Readonly<UnitState>, sourceUnit: Readonly<UnitState>): EffectCommand {
  const source = { kind: 'skill' as const, id: bellEmpressIds.eternalFlame, unitId: sourceUnit.unitId };
  return { type: 'add-status', source, targetId: ally.unitId, instance: { instanceId: `${bellEmpressIds.allyEternal}:${sourceUnit.unitId}:${ally.unitId}`,
    statusId: bellEmpressIds.allyEternal, source, stacks: 1, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'defense', operation: 'percent', amount: .4 }] } };
}
