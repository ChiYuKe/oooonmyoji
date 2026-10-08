import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl } from '../mechanics/control';
import { effectiveTargetResistance } from './flying-edge';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const snowGirlIds = {
  hero: 201,
  basic: '2011',
  armorSkill: '2012',
  blizzard: '2013',
  slow: 'status.hero.201.slow',
  freeze: 'status.hero.201.freeze',
  armor: 'status.hero.201.ice-armor',
} as const;

export function registerSnowGirl(registry: ContentRegistry): void {
  registry.registerStatus({ id: snowGirlIds.slow, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: snowGirlIds.freeze, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: snowGirlIds.armor, mechanicsCoverage: 'partial', category: 'shield', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createSnowGirlDefinition());
}

export function createSnowGirlDefinition(): HeroDefinition {
  const basic: SkillDefinition = createBasicAttackSkill(snowGirlIds.basic, [1, 1.1, 1.1, 1.2, 1.2]);
  const blizzard: SkillDefinition = {
    id: snowGirlIds.blizzard,
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies',
    targetRelation: 'enemy',
    levels: [
      { ratio: .3, freezeChance: .08, slowChance: 0 },
      { ratio: .33, freezeChance: .08, slowChance: 0 },
      { ratio: .33, freezeChance: .08, slowChance: .08 },
      { ratio: .36, freezeChance: .08, slowChance: .08 },
      { ratio: .36, freezeChance: .08, slowChance: .16 },
    ],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const attackerStats = context.getEffectiveStats(intent.actorId);
      if (!actor || !attackerStats) return [];
      const source: SourceRef = { kind: 'skill', id: snowGirlIds.blizzard, unitId: actor.unitId };
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        const targetStats = target && context.getEffectiveStats(target.unitId);
        if (!target || !targetStats) return [];
        return [0, 1, 2].map(() => {
          const damage = context.calculateDamage({ attack: attackerStats.attack, defense: targetStats.defense,
            defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? .3),
            critChance: attackerStats.crit, critDamage: attackerStats.critDamage }, actor, target);
          return { type: 'deal-damage' as const, source, targetId: target.unitId, amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}),
            isCritical: damage.isCritical };
        });
      });
    },
  };

  return {
    id: snowGirlIds.hero,
    skills: [basic, blizzard],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 140, handle(context, event) {
        if (event.type !== 'damage' || !event.source.unitId) return;
        const actor = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        if (!actor || !target) return;
        const commands: EffectCommand[] = [];
        const armor = target.statuses.find(status => status.statusId === snowGirlIds.armor
          && Number(status.values?.shieldRemaining ?? 0) > 0);
        if (armor && actor.hp > 0 && armor.source.unitId) {
          const owner = context.getUnit(armor.source.unitId);
          if (owner && passivesEnabled(owner)) {
            const chance = owner.skillLevel >= 5 ? .5 : .25;
            const response = trySlow(context, { kind: 'skill', id: snowGirlIds.armorSkill, unitId: armor.source.unitId },
              actor.unitId, chance, event.eventId);
            if (response) commands.push(response);
          }
        }
        if (actor.heroId !== snowGirlIds.hero || target.hp <= 0) return commands;
        const source: SourceRef = { kind: 'skill', id: event.source.id === snowGirlIds.blizzard
          ? snowGirlIds.blizzard : snowGirlIds.basic, unitId: actor.unitId };
        if (event.source.id === snowGirlIds.basic && actor.skillLevel >= 3) {
          const chance = actor.skillLevel >= 5 ? .5 : .25;
          const slow = trySlow(context, source, target.unitId, chance, event.eventId);
          if (slow) commands.push(slow);
          return commands;
        }
        if (event.source.id !== snowGirlIds.blizzard) return commands;
        const alreadyFrozen = target.statuses.some(status => status.statusId === snowGirlIds.freeze);
        const params = blizzard.levels[Math.max(0, Math.min(actor.skillLevel - 1, blizzard.levels.length - 1))]!;
        const monster = target.unitKind === 'monster';
        if (alreadyFrozen) {
          if (context.random() >= .3) return commands;
          const deepFreeze = attemptControl(context, { attemptId: `${snowGirlIds.freeze}:deep:${event.eventId}`, source,
            targetId: target.unitId, statusId: snowGirlIds.freeze, controlType: '深度冰冻', baseChance: 1,
            duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, parentEventId: event.eventId });
          if (deepFreeze) commands.push(deepFreeze);
          return commands;
        }
        const slowed = target.statuses.some(status => status.statusId === snowGirlIds.slow
          || status.modifiers?.some(modifier => modifier.stat === 'speed' && modifier.amount < 0));
        const baseChance = (monster ? .25 : Number(params.freezeChance)) + (slowed ? .1 : 0);
        const freeze = attemptControl(context, { attemptId: `${snowGirlIds.freeze}:${event.eventId}`, source,
          targetId: target.unitId, statusId: snowGirlIds.freeze, controlType: '冰冻', baseChance,
          duration: { kind: 'count', remaining: monster ? 2 : 1, owner: 'target-turn' }, parentEventId: event.eventId });
        if (freeze) commands.push(freeze);
        if (Number(params.slowChance) > 0) {
          const slow = trySlow(context, source, target.unitId, Number(params.slowChance), event.eventId);
          if (slow) commands.push(slow);
        }
        return commands;
      } },
      'turn-end': { priority: 20, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const wearer = context.getUnit(event.unitId);
        if (!wearer || wearer.heroId !== snowGirlIds.hero || wearer.hp <= 0 || !passivesEnabled(wearer)) return;
        const ratio = wearer.skillLevel >= 4 ? .12 : wearer.skillLevel >= 2 ? .09 : .06;
        const recipients = [wearer, ...context.getLivingUnits(wearer.side).filter(unit => unit.unitId !== wearer.unitId)
          .sort((left, right) => (context.getEffectiveStats(right.unitId)?.critDamage ?? right.stats.critDamage)
            - (context.getEffectiveStats(left.unitId)?.critDamage ?? left.stats.critDamage)).slice(0, 2)];
        const source: SourceRef = { kind: 'skill', id: snowGirlIds.armorSkill, unitId: wearer.unitId };
        return recipients.filter(unit => unit.hp > 0).map(unit => ({ type: 'add-status' as const, source, targetId: unit.unitId,
          instance: { instanceId: `${snowGirlIds.armor}:${wearer.unitId}:${unit.unitId}:${event.eventId}`,
            statusId: snowGirlIds.armor, source, stacks: 1, duration: { kind: 'count' as const, remaining: 1, owner: 'target-turn' as const },
            values: { shieldRemaining: unit.stats.hp * ratio } }, parentEventId: event.eventId }));
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const useBlizzard = enemies.length >= 2 ? fire >= 3
        : fire > 5 ? context.random() < .5 : fire >= 3 && context.random() < .2727;
      if (useBlizzard) return { actorId: unitId, skillId: snowGirlIds.blizzard,
        targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: snowGirlIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function trySlow(context: BattleContext, source: SourceRef,
  targetId: string, baseChance: number, parentEventId: string): EffectCommand | undefined {
  const attackerStats = source.unitId && context.getEffectiveStats(source.unitId);
  const targetStats = context.getEffectiveStats(targetId);
  if (!attackerStats || !targetStats) return undefined;
  const resist = effectiveTargetResistance(targetStats.resist, source, context.getUnit);
  const chance = Math.max(0, Math.min(1, baseChance * (1 + Math.max(0, attackerStats.hit))))
    * (1 - resist);
  if (context.random() >= chance) return undefined;
  const instance: StatusInstance = { instanceId: `${snowGirlIds.slow}:${source.unitId}:${targetId}:${parentEventId}`,
    statusId: snowGirlIds.slow, source, appliedByEventId: parentEventId, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    modifiers: [{ stat: 'speed', operation: 'flat', amount: -10 }] };
  return { type: 'add-status', source, targetId, instance, parentEventId };
}
