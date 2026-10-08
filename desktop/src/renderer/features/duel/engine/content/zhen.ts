import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { effectiveDefenseIgnore, effectiveStats } from '../mechanics/stats';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const zhenIds = {
  hero: 285,
  basic: '2851',
  poisonBloom: '2852',
  poisonErode: '2853',
  poisonFeather: 'status.hero.285.poison-feather',
} as const;

const basicRatios = [.8, .85, .9, .95, 1] as const;
const erodeRatios = [1.75, 1.93, 2.1, 2.1, 2.1] as const;
const poisonRatios = [.35, .39, .42, .42, .42] as const;
const bloomRatios = [.01, .03, .06, .1, .15] as const;

/** 鸩规则迁移。毒羽、基础技能与自动选技已接入；毒伤等级修正和五级递归施法仍需校准。 */
export function registerZhen(registry: ContentRegistry): void {
  registry.registerStatus({ id: zhenIds.poisonFeather, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5 });
  registry.registerHero(createZhenDefinition());
}

export function createZhenDefinition(): HeroDefinition {
  const poisonBloom: SkillDefinition = {
    id: zhenIds.poisonBloom,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-enemies',
    targetRelation: 'enemy',
    levels: bloomRatios.map((ratio, index) => ({ ratio, level: index + 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const attack = actor && effectiveStats(actor).attack;
      if (!actor || !attack) return [];
      const level = Number(parameters.level ?? 1);
      const baseRatio = Number(parameters.ratio ?? .01);
      const poisonMultiplier = level === 2 || level === 4 ? 6 : 1;
      const source = zhenSource(actor.unitId, zhenIds.poisonBloom);
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) continue;
        const previousStacks = poisonStacksFrom(target, actor.unitId);
        const addedStacks = Math.min(2, 5 - previousStacks);
        if (addedStacks > 0) commands.push(poisonCommand(actor, target, addedStacks, zhenIds.poisonBloom));
        const stacks = previousStacks + addedStacks;
        if (stacks <= 0) continue;
        const amount = Math.min(target.stats.hp * baseRatio * stacks * poisonMultiplier, attack * 2.8);
        commands.push({ type: 'deal-damage', source, targetId, amount: Math.max(1, amount), damageKind: 'true' });
      }
      return commands;
    },
  };
  const poisonErode: SkillDefinition = {
    id: zhenIds.poisonErode,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single',
    targetRelation: 'enemy',
    levels: erodeRatios.map((ratio, index) => ({ ratio, poisonRatio: poisonRatios[index]!, level: index + 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0) return [];
      const actorStats = effectiveStats(actor);
      const targetStats = effectiveStats(target);
      const level = Number(parameters.level ?? 1);
      const result = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1.75),
        critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source: zhenSource(actor.unitId, zhenIds.poisonErode),
        targetId: target.unitId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
        ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, actorStats.critDamage) } : {}), isCritical: result.isCritical }];
      const stacks = poisonStacks(target);
      if (stacks > 0) commands.push({ type: 'deal-damage', source: zhenSource(actor.unitId, zhenIds.poisonErode),
        targetId: target.unitId, amount: actorStats.attack * Number(parameters.poisonRatio ?? .35) * stacks, damageKind: 'true' });
      if (stacks > 0) commands.push({ type: 'remove-statuses', source: zhenSource(actor.unitId, zhenIds.poisonErode),
        targetId: target.unitId, statusIds: [zhenIds.poisonFeather], reason: 'consumed' });
      if (level >= 4) commands.push(poisonCommand(actor, target, 3, zhenIds.poisonErode));
      return commands;
    },
  };
  const definition: HeroDefinition = {
    id: zhenIds.hero,
    skills: [createBasicAttackSkill(zhenIds.basic, basicRatios), poisonBloom, poisonErode],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 72, handle(context, event) {
        if (event.type !== 'damage' || !event.source.unitId || event.damageKind !== 'normal') return;
        const attacker = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        const commands: EffectCommand[] = [];
        if (attacker && passivesEnabled(attacker) && attacker.heroId === zhenIds.hero && event.source.id === zhenIds.basic
          && target) commands.push(poisonCommand(attacker, target, 2, zhenIds.basic));
        if (event.amount <= 0 || !attacker) return commands;
        const wearer = target;
        if (wearer?.heroId === zhenIds.hero && passivesEnabled(wearer) && attacker.unitId !== wearer.unitId
          && poisonStacksFrom(attacker, wearer.unitId) < 5) commands.push(poisonCommand(wearer, attacker, 1, 'passive'));
        return commands;
      } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const useErode = enemies.length === 1 || enemies.some(target => poisonStacks(target) > 2)
        || enemies.some(target => target.hp / Math.max(1, target.stats.hp) < .3);
      if (useErode && fire >= 3) {
        const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
        return { actorId: unitId, skillId: zhenIds.poisonErode, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      if (fire >= 2) return { actorId: unitId, skillId: zhenIds.poisonBloom, targetIds: enemies.map(unit => unit.unitId),
        shape: 'all-enemies', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: zhenIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  return definition;
}

function poisonStacks(unit: Readonly<UnitState>): number {
  return unit.statuses.filter(status => status.statusId === zhenIds.poisonFeather).reduce((total, status) => total + status.stacks, 0);
}

function poisonStacksFrom(unit: Readonly<UnitState>, sourceUnitId: string): number {
  return unit.statuses.filter(status => status.statusId === zhenIds.poisonFeather && status.source.unitId === sourceUnitId)
    .reduce((total, status) => total + status.stacks, 0);
}

function poisonCommand(sourceUnit: Readonly<UnitState>, target: Readonly<UnitState>, stacks: number, skillId: string): EffectCommand {
  const source = zhenSource(sourceUnit.unitId, skillId);
  const instance: StatusInstance = { instanceId: `${zhenIds.poisonFeather}:${sourceUnit.unitId}:${target.unitId}`,
    statusId: zhenIds.poisonFeather, source, stacks,
    duration: { kind: 'permanent' } };
  return { type: 'add-status', source, targetId: target.unitId, instance };
}

function zhenSource(unitId: string, skillId: string): SourceRef {
  return { kind: 'skill', id: skillId, unitId };
}
