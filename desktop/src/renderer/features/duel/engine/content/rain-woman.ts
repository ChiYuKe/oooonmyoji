import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const rainWomanIds = {
  hero: 224,
  basic: '2241',
  passive: '2242',
  ultimate: '2243',
  tether: 'status.hero.224.tears-bond',
  resistance: 'status.hero.224.purifying-rain-resistance',
  speed: 'status.hero.224.purifying-rain-speed',
  triggerLock: 'status.hero.224.passive-trigger-lock',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const tetherSlow = [10, 10, 10, 20, 20] as const;

export function registerRainWoman(registry: ContentRegistry): void {
  registry.registerStatus({ id: rainWomanIds.tether, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: rainWomanIds.resistance, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: rainWomanIds.speed, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: rainWomanIds.triggerLock, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });

  const definition: HeroDefinition = {
    id: rainWomanIds.hero,
    skills: [createBasicAttackSkill(rainWomanIds.basic, basicRatios), createUltimate()],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    handlers: {
      'turn-start': { priority: 64, handle(context, event) { return cleanseAtTurnStart(context, event); } },
      'effect-resolution': { priority: 91, handle(context, event) { return gainSpeedAfterDebuff(context, event); } },
      'control-application': { priority: 91, handle(context, event) { return gainSpeedAfterDebuff(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const allies = context.getLivingUnits(actor.side);
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = lowestRatio(enemies);
      const needsCleanse = allies.some(ally => ally.statuses.some(status => {
        const category = context.getStatusCategory(status.statusId);
        return category === 'control' || category === 'debuff';
      }));
      const enemyHasDispellableBuff = enemies.some(enemy => enemy.statuses.some(status =>
        context.getStatusCategory(status.statusId) === 'buff' && context.isStatusDispellable(status.statusId)));
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 2 && (needsCleanse || enemyHasDispellableBuff)) {
        const allyTarget = lowestRatio(allies);
        const targetIds = [...new Set([allyTarget.unitId, ...allies.map(ally => ally.unitId), ...enemies.map(enemy => enemy.unitId)])];
        return { actorId: unitId, skillId: rainWomanIds.ultimate, targetIds, shape: 'multi', targetRelation: 'any' };
      }
      return { actorId: unitId, skillId: rainWomanIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createUltimate(): SkillDefinition {
  return {
    id: rainWomanIds.ultimate,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'multi',
    targetRelation: 'any',
    levels: tetherSlow.map((slow, index) => ({ slow, cleanseLimit: 4, enemyDispelCount: index >= 2 ? 2 : 1,
      resistance: index >= 1 ? .8 : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const allies = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit && unit.side === actor.side));
      const enemies = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit && unit.side !== actor.side));
      const selectedAlly = allies[0];
      if (!selectedAlly) return [];
      const source = rainSource(rainWomanIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [];
      const selectedControls = selectedAlly.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
      if (selectedControls.length) commands.push({ type: 'remove-statuses', source, targetId: selectedAlly.unitId,
        statusIds: [...new Set(selectedControls.map(status => status.statusId))], reason: 'consumed' });
      for (const ally of allies) commands.push({ type: 'dispel-statuses', source, targetId: ally.unitId,
        filter: 'debuff-or-control', maxCount: Number(parameters.cleanseLimit ?? 4) });
      if (Number(parameters.resistance) > 0) {
        commands.push({ type: 'add-status', source, targetId: selectedAlly.unitId, instance: {
          instanceId: `${rainWomanIds.resistance}:${actor.unitId}:${selectedAlly.unitId}`,
          statusId: rainWomanIds.resistance, source, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          modifiers: [{ stat: 'resist', operation: 'flat', amount: Number(parameters.resistance) }],
        } });
      }
      const slow = Number(parameters.slow ?? 10);
      const duration = { kind: 'count' as const, remaining: 2, owner: 'target-turn' as const };
      for (const enemy of enemies) {
        const dispellableBuffIds = [...new Set(enemy.statuses.filter(status => context.isStatusDispellable(status.statusId)
          && ['buff', 'shield'].includes(context.getStatusCategory(status.statusId) ?? '')).map(status => status.statusId))];
        if (dispellableBuffIds.length) commands.push({ type: 'dispel-statuses', source, targetId: enemy.unitId,
          statusIds: dispellableBuffIds, maxCount: Number(parameters.enemyDispelCount ?? 1) });
        const debuff = attemptDebuff(context, { source, targetId: enemy.unitId, statusId: rainWomanIds.tether,
          baseChance: 1, duration, parentEventId: undefined,
          values: { slow } });
        commands.push(...debuff.map(command => command.type === 'add-status' ? { ...command, instance: {
          ...command.instance, modifiers: [{ stat: 'speed' as const, operation: 'flat' as const, amount: -slow }],
        } } : command));
      }
      return commands;
    },
  };
}

function cleanseAtTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== rainWomanIds.hero || actor.hp <= 0 || !passivesEnabled(actor)) return;
  const controls = actor.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
  const commands: EffectCommand[] = [];
  if (actor.statuses.some(status => status.statusId === rainWomanIds.triggerLock)) {
    commands.push({ type: 'remove-statuses', source: rainSource(rainWomanIds.passive, actor.unitId), targetId: actor.unitId,
      statusIds: [rainWomanIds.triggerLock], reason: 'consumed', parentEventId: event.eventId });
  }
  if (controls.length) commands.push({ type: 'remove-statuses', source: rainSource(rainWomanIds.passive, actor.unitId),
    targetId: actor.unitId, statusIds: [...new Set(controls.map(status => status.statusId))], reason: 'consumed', parentEventId: event.eventId });
  commands.push({ type: 'dispel-statuses', source: rainSource(rainWomanIds.passive, actor.unitId), targetId: actor.unitId,
    filter: 'debuff-or-control', maxCount: Number.POSITIVE_INFINITY, parentEventId: event.eventId });
  return commands;
}

function gainSpeedAfterDebuff(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-added' && event.type !== 'control-applied') return;
  const targetId = event.targetId;
  const actor = context.getUnit(targetId);
  const statusId = event.type === 'status-added' ? event.instance.statusId : event.statusId;
  if (!actor || actor.heroId !== rainWomanIds.hero || actor.hp <= 0 || !passivesEnabled(actor)
    || !['control', 'debuff'].includes(context.getStatusCategory(statusId) ?? '')) return;
  if (actor.statuses.some(status => status.statusId === rainWomanIds.triggerLock)) return;
  const source = rainSource(rainWomanIds.passive, actor.unitId);
  const duration = { kind: 'count' as const, remaining: 1, owner: 'target-turn' as const };
  const lock: StatusInstance = { instanceId: `${rainWomanIds.triggerLock}:${actor.unitId}`,
    statusId: rainWomanIds.triggerLock, source, stacks: 1, duration };
  return [
    { type: 'add-status', source, targetId: actor.unitId, instance: {
      instanceId: `${rainWomanIds.speed}:${actor.unitId}`, statusId: rainWomanIds.speed, source, stacks: 1, duration,
      modifiers: [{ stat: 'speed', operation: 'flat', amount: 40 }],
    }, parentEventId: event.eventId },
    { type: 'add-status', source, targetId: actor.unitId, instance: lock, parentEventId: event.eventId },
  ];
}

function lowestRatio(units: readonly UnitState[]): UnitState {
  return units.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
}

function rainSource(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
