import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const yamausagiIds = {
  hero: 237,
  basic: '2371',
  dance: '2372',
  ring: '2373',
  danceBuff: 'status.hero.237.rabbit-dance',
  transform: 'status.hero.237.ring-transform',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ringRatios = [2.37, 2.49, 2.61, 2.73, 2.85] as const;
const attackBuffRatios = [.1, .15, .2, .2, .2] as const;
const danceDurations = [2, 2, 2, 2, 2] as const;

export function registerYamausagi(registry: ContentRegistry): void {
  registry.registerStatus({ id: yamausagiIds.danceBuff, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: yamausagiIds.transform, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsSkill: true });

  const dance = createRabbitDance();
  const ring = createLuckyRing();
  registry.registerHero({
    id: yamausagiIds.hero,
    skills: [createBasicAttackSkill(yamausagiIds.basic, basicRatios), dance, ring],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    policy(context: BattleContext, unitId: string): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const skillId = fire >= 3 ? yamausagiIds.ring : yamausagiIds.basic;
      return { actorId: actor.unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'control-application': { priority: 150, handle(context, event) { return freeDanceAfterTransform(context, event); } },
    },
  });
}

function createRabbitDance(): SkillDefinition {
  return {
    id: yamausagiIds.dance,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-allies',
    targetRelation: 'ally',
    levels: attackBuffRatios.map((attackRatio, index) => ({ attackRatio, duration: danceDurations[index]!, lowestGaugeBonus: index >= 3 ? .2 : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      const source = yamausagiSource(yamausagiIds.dance, actor.unitId);
      const allies = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit
        && unit.hp > 0 && unit.side === actor.side));
      if (allies.length === 0) return [];
      const lowestGaugeId = allies.slice().sort((left, right) => left.actionGauge - right.actionGauge
        || actorSideOrder(context, left, right))[0]!.unitId;
      const duration = Math.max(1, Number(parameters.duration ?? 2));
      const normalRatio = Math.max(0, Number(parameters.attackRatio ?? .1));
      const lowestGaugeBonus = Math.max(0, Number(parameters.lowestGaugeBonus ?? 0));
      const commands: EffectCommand[] = [];
      for (const ally of allies) {
        commands.push({ type: 'change-action-gauge', source, targetId: ally.unitId, amount: 30 });
        const amount = normalRatio + (ally.unitId === lowestGaugeId ? lowestGaugeBonus : 0);
        commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
          instanceId: `${yamausagiIds.danceBuff}:${actor.unitId}:${ally.unitId}`, statusId: yamausagiIds.danceBuff,
          source, stacks: 1, duration: { kind: 'count', remaining: duration, owner: 'target-turn' },
          modifiers: [{ stat: 'attack', operation: 'percent', amount }],
        } });
      }
      return commands;
    },
  };
}

function createLuckyRing(): SkillDefinition {
  return {
    id: yamausagiIds.ring,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single',
    targetRelation: 'enemy',
    levels: ringRatios.map(ratio => ({ ratio, transformChance: .1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const attackerStats = context.getEffectiveStats(intent.actorId);
      const targetId = intent.targetIds[0];
      const target = targetId ? context.getUnit(targetId) : undefined;
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || actor.hp <= 0 || !attackerStats || !target || target.hp <= 0 || !targetStats) return [];
      const source = yamausagiSource(yamausagiIds.ring, actor.unitId);
      const damage = context.calculateDamage({ attack: attackerStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 2.37),
        critChance: attackerStats.crit, critDamage: attackerStats.critDamage }, actor, target);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId,
        amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
      const control = attemptControl(context, { attemptId: `${yamausagiIds.transform}:${actor.unitId}:${target.unitId}:${context.state.counters.hit + 1}`,
        source, targetId: target.unitId, statusId: yamausagiIds.transform, controlType: 'transform',
        baseChance: Number(parameters.transformChance ?? .1), duration: { kind: 'count', remaining: 2, owner: 'target-turn' } });
      if (control) commands.push(control);
      return commands;
    },
  };
}

function freeDanceAfterTransform(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-applied' || event.statusId !== yamausagiIds.transform || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== yamausagiIds.hero || actor.hp <= 0 || actor.skillLevel < 5) return;
  const allies = context.getLivingUnits(actor.side);
  if (allies.length === 0) return;
  return [{ type: 'schedule-action', source: yamausagiSource(yamausagiIds.ring, actor.unitId),
    intent: { actorId: actor.unitId, skillId: yamausagiIds.dance, targetIds: allies.map(unit => unit.unitId),
      shape: 'all-allies', targetRelation: 'ally' }, scheduling: 'extra-action', freeCast: true, parentEventId: event.eventId }];
}

function actorSideOrder(context: BattleContext, left: UnitState, right: UnitState): number {
  return context.state.sides[left.side].indexOf(left.unitId) - context.state.sides[right.side].indexOf(right.unitId);
}

function yamausagiSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
