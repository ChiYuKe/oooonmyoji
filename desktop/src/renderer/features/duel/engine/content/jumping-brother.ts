import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

/** 跳跳哥哥's modular rules; repeated-coffin HP redistribution remains a known partial-coverage edge. */
export const jumpingBrotherIds = {
  hero: 233,
  basic: '2331',
  unyielding: '2332',
  revenge: '2332-revenge',
  ultimate: '2333',
  coffinAction: '2333-coffin-action',
  stun: 'status.hero.233.stun',
  resistance: 'status.hero.233.unyielding-resistance',
  coffin: 'status.hero.233.coffin',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const unyieldingRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const resistanceByLevel = [.2, .25, .3, .35, .4] as const;
const coffinHpRatios = [.1, .15, .2, .25, .3] as const;

export function registerJumpingBrother(registry: ContentRegistry): void {
  registry.registerStatus({ id: jumpingBrotherIds.stun, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: jumpingBrotherIds.resistance, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: jumpingBrotherIds.coffin, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const definition: HeroDefinition = {
    id: jumpingBrotherIds.hero,
    skills: [createBasicAttackSkill(jumpingBrotherIds.basic, basicRatios), createUnyielding(jumpingBrotherIds.unyielding, true),
      createUnyielding(jumpingBrotherIds.revenge, false), createRaiseCoffins(), createCoffinAction()],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    handlers: {
      'battle-start': { priority: 50, handle(context, event) { return grantResistance(context, event); } },
      hit: { priority: 100, handle(context, event) { return stunOnHit(context, event); } },
      'unit-defeated': { priority: 100, handle(context, event) {
        return event.type === 'unit-defeated' && context.getUnit(event.unitId)?.statuses.some(status => status.statusId === jumpingBrotherIds.coffin)
          ? boostRemainingCoffins(context, event) : avengeAlly(context, event);
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      if (actor.unitKind === 'summon') {
        const coffin = actor.statuses.find(status => status.statusId === jumpingBrotherIds.coffin);
        const reviveTarget = coffin?.values?.reviveTargetUnitId;
        if (typeof reviveTarget === 'string') return { actorId: unitId, skillId: jumpingBrotherIds.coffinAction,
          targetIds: [reviveTarget], shape: 'single', targetRelation: 'ally' };
        return undefined;
      }
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = lowestRatio(enemies);
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const fallen = context.state.sides[actor.side].map(id => context.getUnit(id)).find(unit => unit
        && unit.unitKind !== 'summon' && unit.unitKind !== 'monster' && unit.hp <= 0);
      if (fallen && fire >= 3) return { actorId: unitId, skillId: jumpingBrotherIds.ultimate,
        targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      const useUnyielding = fire >= 2;
      const selectedTarget = useUnyielding ? enemies[Math.floor(context.random() * enemies.length)]! : target;
      return { actorId: unitId, skillId: useUnyielding ? jumpingBrotherIds.unyielding : jumpingBrotherIds.basic,
        targetIds: [selectedTarget.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createRaiseCoffins(): SkillDefinition {
  return {
    id: jumpingBrotherIds.ultimate,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'self',
    targetRelation: 'ally',
    levels: coffinHpRatios.map(inheritRatio => ({ inheritRatio, ownerHpBonus: .3, speedRatio: 1 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0 || owner.unitKind === 'summon') return [];
      const fallen = context.state.sides[owner.side].map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit
        && unit.hp <= 0 && unit.unitKind !== 'summon' && unit.unitKind !== 'monster'));
      if (fallen.length === 0) return [];
      const ownerStats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const assignedTargets = new Set(Object.values(context.state.units).flatMap(unit => unit.statuses
        .filter(status => status.statusId === jumpingBrotherIds.coffin)
        .map(status => status.values?.reviveTargetUnitId).filter((id): id is string => typeof id === 'string')));
      const targets = fallen.filter(unit => !assignedTargets.has(unit.unitId));
      if (targets.length === 0) return [];
      const inheritRatio = Number(parameters.inheritRatio ?? .1);
      const sharedBonus = ownerStats.hp * Number(parameters.ownerHpBonus ?? .3) / targets.length;
      const commands: EffectCommand[] = [];
      const sourceRef = source(jumpingBrotherIds.ultimate, owner.unitId);
      for (const target of targets) {
        const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
        const maxHp = Math.max(1, targetStats.hp * inheritRatio + sharedBonus);
        const unitId = `coffin:${owner.unitId}:${target.unitId}:${context.state.counters.action + 1}`;
        const assignment: StatusInstance = { instanceId: `${jumpingBrotherIds.coffin}:${unitId}`,
          statusId: jumpingBrotherIds.coffin, source: sourceRef, stacks: 1, duration: { kind: 'permanent' },
          values: { reviveTargetUnitId: target.unitId } };
        const coffin: UnitState = { unitId, heroId: jumpingBrotherIds.hero, unitKind: 'summon', summonedByUnitId: owner.unitId,
          side: owner.side, skillLevel: owner.skillLevel,
          stats: { ...targetStats, hp: maxHp, speed: targetStats.speed * Number(parameters.speedRatio ?? 1) },
          hp: maxHp, shield: 0, actionGauge: 0, statuses: [assignment], resources: {} };
        commands.push({ type: 'summon-unit', source: sourceRef, unit: coffin });
      }
      return commands;
    },
  };
}

function createCoffinAction(): SkillDefinition {
  return {
    id: jumpingBrotherIds.coffinAction,
    actionKind: 'passive',
    target: 'single',
    targetRelation: 'ally',
    allowDefeatedTargets: true,
    levels: [{ reviveRatio: 1 }],
    execute(context, intent, parameters) {
      const coffin = context.getUnit(intent.actorId);
      const assignment = coffin?.statuses.find(status => status.statusId === jumpingBrotherIds.coffin);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!coffin || coffin.unitKind !== 'summon' || !assignment || !target
        || assignment.values?.reviveTargetUnitId !== target.unitId) return [];
      const commands: EffectCommand[] = [];
      if (target.hp <= 0) commands.push({ type: 'revive', source: source(jumpingBrotherIds.ultimate, coffin.summonedByUnitId ?? coffin.unitId),
        targetId: target.unitId, hp: target.stats.hp * Number(parameters.reviveRatio ?? 1) });
      commands.push({ type: 'lose-life', source: source(jumpingBrotherIds.coffinAction, coffin.unitId), targetId: coffin.unitId,
        amount: coffin.hp });
      return commands;
    },
  };
}

function createUnyielding(id: string, costsFire: boolean): SkillDefinition {
  return {
    id,
    actionKind: 'skill',
    ...(costsFire ? { resourceCost: { resourceId: 'fire', amount: 2 } } : {}),
    target: 'single',
    targetRelation: 'enemy',
    levels: unyieldingRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || actor.hp <= 0 || target.hp <= 0) return [];
      const attackerStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const defenderStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const hit = context.calculateDamage({ attack: attackerStats.attack, defense: defenderStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1),
        critChance: attackerStats.crit, critDamage: attackerStats.critDamage }, actor, target);
      return [{ type: 'deal-damage', source: source(id, actor.unitId), targetId: target.unitId,
        amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
    },
  };
}

function grantResistance(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'battle-started') return;
  const commands: EffectCommand[] = [];
  for (const side of ['blue', 'red'] as const) for (const unitId of context.state.sides[side]) {
    const actor = context.getUnit(unitId);
    if (!actor || actor.heroId !== jumpingBrotherIds.hero || actor.unitKind === 'summon' || !passivesEnabled(actor)
      || actor.statuses.some(status => status.statusId === jumpingBrotherIds.resistance)) continue;
    const amount = resistanceByLevel[Math.max(0, Math.min(4, actor.skillLevel - 1))]!;
    const passive = source(jumpingBrotherIds.unyielding, actor.unitId);
    const instance: StatusInstance = { instanceId: `${jumpingBrotherIds.resistance}:${actor.unitId}`,
      statusId: jumpingBrotherIds.resistance, source: passive, stacks: 1, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'resist', operation: 'flat', amount }] };
    commands.push({ type: 'add-status', source: passive, targetId: actor.unitId, instance, parentEventId: event.eventId });
  }
  return commands;
}

function stunOnHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== jumpingBrotherIds.unyielding
    && event.source.id !== jumpingBrotherIds.revenge || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!attacker || attacker.heroId !== jumpingBrotherIds.hero || attacker.hp <= 0 || !passivesEnabled(attacker)
    || !target || target.hp <= 0) return;
  const revenge = event.source.id === jumpingBrotherIds.revenge;
  const chance = revenge ? 1 : .3;
  const attempt = attemptControl(context, { attemptId: `${jumpingBrotherIds.stun}:${event.eventId}`,
    source: source(event.source.id, attacker.unitId), targetId: target.unitId,
    statusId: jumpingBrotherIds.stun, controlType: 'stun', baseChance: chance,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
  return attempt ? [attempt] : undefined;
}

function avengeAlly(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  const killerId = event.defeatedBy?.unitId;
  const killer = killerId ? context.getUnit(killerId) : undefined;
  if (!defeated || !killer || killer.hp <= 0 || defeated.side === killer.side
    || !context.state.sides[defeated.side].some(id => {
      const ally = context.getUnit(id);
      return ally?.unitId !== defeated.unitId && ally?.heroId === jumpingBrotherIds.hero
        && ally.unitKind !== 'summon' && ally.hp > 0 && passivesEnabled(ally);
    })) return;
  const avenger = context.state.sides[defeated.side].map(id => context.getUnit(id)).find(unit =>
    unit?.heroId === jumpingBrotherIds.hero && unit.unitKind !== 'summon' && unit.hp > 0 && passivesEnabled(unit));
  if (!avenger) return;
  const sourceRef = source(jumpingBrotherIds.revenge, avenger.unitId);
  return [{ type: 'schedule-action', source: sourceRef,
    intent: { actorId: avenger.unitId, skillId: jumpingBrotherIds.revenge,
      targetIds: [killer.unitId], shape: 'single', targetRelation: 'enemy' },
    scheduling: 'counter', freeCast: true, parentEventId: event.eventId }];
}

function boostRemainingCoffins(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  if (!defeated?.statuses.some(status => status.statusId === jumpingBrotherIds.coffin)) return;
  const ownerId = defeated.summonedByUnitId;
  const sourceRef = source(jumpingBrotherIds.ultimate, ownerId ?? defeated.unitId);
  return context.getLivingUnits(defeated.side).filter(unit => unit.unitKind === 'summon'
    && unit.statuses.some(status => status.statusId === jumpingBrotherIds.coffin))
    .map(coffin => ({ type: 'change-action-gauge' as const, source: sourceRef, targetId: coffin.unitId,
      amount: 15, parentEventId: event.eventId }));
}

function lowestRatio(units: readonly UnitState[]): UnitState {
  return units.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
}

function source(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
