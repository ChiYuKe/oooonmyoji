import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import type { ContentRegistry } from './registry';

export const onikiriIds = {
  hero: 312,
  basic: '3121',
  passive: '3122',
  ultimate: '3123',
  assistBlade: 'status.hero.312.assist-blade',
  guardBlade: 'status.hero.312.guard-blade',
  executionBlade: 'status.hero.312.execution-blade',
  resistance: 'status.hero.312.resistance',
  followup: 'status.hero.312.pending-followup',
} as const;

const basicRatios = [.8, .84, .88, .92, 1] as const;
const ultimateRatios = [.8, .84, .88, .92, 1] as const;
const bladeIds = [onikiriIds.assistBlade, onikiriIds.guardBlade, onikiriIds.executionBlade] as const;

export function registerOnikiri(registry: ContentRegistry): void {
  const buffs: StatusDefinition[] = [
    { id: onikiriIds.assistBlade, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'source-turn', refreshPolicy: 'replace' },
    { id: onikiriIds.guardBlade, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: onikiriIds.executionBlade, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: onikiriIds.resistance, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'source-turn', refreshPolicy: 'refresh-duration' },
    { id: onikiriIds.followup, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
      durationOwner: 'event', refreshPolicy: 'replace' },
  ];
  buffs.forEach(status => registry.registerStatus(status));
  registry.registerHero(createOnikiriDefinition());
}

export function createOnikiriDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: onikiriIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== onikiriIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const commands = [damageCommand(context, actor, target, onikiriIds.basic, Number(parameters.ratio ?? basicRatios[skillRank(actor, onikiriIds.basic) - 1]), 1)];
      commands.push(addBlade(context, actor, randomBlade(context), onikiriIds.basic));
      return commands;
    },
  };

  const ultimate: SkillDefinition = {
    id: onikiriIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio, hitCount: 3 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== onikiriIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const ratio = Number(parameters.ratio ?? ultimateRatios[skillRank(actor, onikiriIds.ultimate) - 1]);
      const commands: EffectCommand[] = [];
      for (let hit = 0; hit < 3; hit++) commands.push(damageCommand(context, actor, target, onikiriIds.ultimate, ratio, 1));
      for (const statusId of bladeIds) commands.push(addBlade(context, actor, statusId, onikiriIds.ultimate));
      return commands;
    },
  };

  return {
    id: onikiriIds.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['鬼斩按等级造成80%至100%攻击伤害并随机激活一把佩刀；鬼影闪消耗3火，对单体造成3段80%至100%伤害并激活三把佩刀。被动含开局随机佩刀、低血线追加斩、击杀协战、减伤次数和觉醒抵抗；状态驱散/封印边界、追击目标和录像实战仍需逐项校准。'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== onikiriIds.hero || !passivesEnabled(actor)) return [];
      const row = passiveRow(actor);
      const count = Math.max(0, Math.min(3, Math.floor(skillNumber(row, 'param4') ?? fallbackOpeningBlades(skillRank(actor, onikiriIds.passive)))));
      const pool = [...bladeIds];
      const commands: EffectCommand[] = [];
      for (let i = 0; i < count; i++) {
        const index = Math.min(pool.length - 1, Math.floor(context.random() * pool.length));
        const statusId = pool.splice(index, 1)[0];
        if (statusId) commands.push(addBlade(context, actor, statusId, onikiriIds.passive));
      }
      return commands;
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      return { actorId: unitId, skillId: fire >= 3 ? onikiriIds.ultimate : onikiriIds.basic,
        targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    interceptIncomingDamage(state, _attacker, target, amount) {
      const blade = target.statuses.find(status => status.statusId === onikiriIds.guardBlade && Number(status.values?.charges ?? 0) > 0);
      if (!blade || amount <= 0) return undefined;
      const charges = Number(blade.values?.charges ?? 0) - 1;
      return { amount: amount * .5, effects: charges > 0
        ? [{ type: 'add-status', source: blade.source, targetId: target.unitId, instance: { ...blade,
          instanceId: `${onikiriIds.guardBlade}:${target.unitId}`, values: { ...blade.values, charges } } }]
        : [{ type: 'remove-status-instances', source: blade.source, targetId: target.unitId, instanceIds: [blade.instanceId], reason: 'consumed' }] };
    },
    handlers: {
      'attack-end': { priority: 42, handle(context, event) { return onAttackEnd(context, event); } },
      hit: { priority: 42, handle(context, event) { return onSlashHit(context, event); } },
      'unit-defeated': { priority: 42, handle(context, event) { return onEnemyDefeated(context, event); } },
      'action-end': { priority: 42, handle(context, event) { return assistAfterAllyAction(context, event); } },
    },
  };
}

function onAttackEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== onikiriIds.hero) return;
  if (!passivesEnabled(owner) || (event.suppressSourcePassiveTriggers ?? false) || !event.targetHealthChanges?.length) return;
  const passive = skillRank(owner, onikiriIds.passive);
  if (passive < 1) return;
  const primary = event.targetHealthChanges.map(change => ({ change, target: context.getUnit(change.targetId) }))
    .find(item => item.target && item.target.hp > 0 && item.target.side !== owner.side
      && item.change.hpAfter / Math.max(1, item.target.stats.hp) < .85);
  if (!primary?.target) return;
  const source = onikiriSource(onikiriIds.passive, owner.unitId);
  const marker: StatusInstance = { instanceId: `${onikiriIds.followup}:${owner.unitId}:${event.eventId}`,
    statusId: onikiriIds.followup, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'event' },
    values: { targetId: primary.target.unitId } };
  return [{ type: 'add-status', source, targetId: owner.unitId, instance: marker },
    damageCommand(context, owner, primary.target, onikiriIds.passive, 1.25, 1, true),
    ...resistanceCommand(owner)];
}

function onSlashHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== onikiriIds.passive || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  const marker = owner?.statuses.find(status => status.statusId === onikiriIds.followup
    && status.values?.targetId === event.targetId);
  if (!owner || !marker) return;
  const target = context.getUnit(event.targetId);
  const commands: EffectCommand[] = [{ type: 'remove-status-instances', source: onikiriSource(onikiriIds.passive, owner.unitId),
    targetId: owner.unitId, instanceIds: [marker.instanceId], reason: 'consumed' }];
  if (target && target.hp / Math.max(1, target.stats.hp) < .65) {
    for (const enemy of context.getLivingUnits(target.side)) {
      if (enemy.side !== owner.side) commands.push(damageCommand(context, owner, enemy, onikiriIds.passive, 1.25, 1, true));
    }
  }
  return commands;
}

function onEnemyDefeated(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated' || !event.defeatedBy?.unitId) return;
  const defeated = context.getUnit(event.unitId);
  if (!defeated || defeated.unitKind === 'summon') return;
  const owner = context.state.sides.blue.concat(context.state.sides.red).map(id => context.getUnit(id))
    .find(unit => unit?.heroId === onikiriIds.hero && unit.hp > 0 && unit.side !== defeated.side
      && unit.statuses.some(status => status.statusId === onikiriIds.executionBlade));
  if (!owner || (event.defeatedBy?.unitId && context.getUnit(event.defeatedBy.unitId)?.side !== owner.side)) return;
  const target = context.getLivingUnits(defeated.side).slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
  if (!target) return;
  const blade = owner.statuses.find(status => status.statusId === onikiriIds.executionBlade)!;
  return [{ type: 'remove-status-instances', source: onikiriSource(onikiriIds.passive, owner.unitId), targetId: owner.unitId,
    instanceIds: [blade.instanceId], reason: 'consumed' },
    { type: 'schedule-action', source: onikiriSource(onikiriIds.passive, owner.unitId), scheduling: 'assist', parentEventId: event.eventId,
      freeCast: true, intent: { actorId: owner.unitId, skillId: onikiriIds.basic, targetIds: [target.unitId],
        shape: 'single', targetRelation: 'enemy', kind: 'passive' } }];
}

function assistAfterAllyAction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'basic' || event.scheduling || !event.intent || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor) return;
  const target = event.intent.targetIds.map(id => context.getUnit(id)).find(unit => unit && unit.hp > 0 && unit.side !== actor.side);
  if (!target) return;
  const commands: EffectCommand[] = [];
  for (const owner of context.getLivingUnits(actor.side).filter(unit => unit.heroId === onikiriIds.hero && unit.unitId !== actor.unitId)) {
    const blade = owner.statuses.find(status => status.statusId === onikiriIds.assistBlade);
    if (!blade || context.random() >= .2) continue;
    commands.push({ type: 'schedule-action', source: onikiriSource(onikiriIds.assistBlade, owner.unitId), scheduling: 'assist',
      parentEventId: event.eventId, freeCast: true, intent: { actorId: owner.unitId, skillId: onikiriIds.basic,
        targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy', kind: 'passive' } });
  }
  return commands;
}

function damageCommand(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string,
  ratio: number, damageMultiplier: number, protectedSlash = false): EffectCommand {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack * damageMultiplier, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
  return { type: 'deal-damage', source: onikiriSource(skillId, actor.unitId), targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
    ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, offense.critDamage) } : {}),
    ...(protectedSlash ? { ignoreShield: true, cannotBeShared: true, suppressTargetPassiveTriggers: true,
      suppressTargetSoulTriggers: true } : {}) };
}

function addBlade(context: BattleContext, actor: Readonly<UnitState>, statusId: typeof bladeIds[number], sourceSkillId: string): EffectCommand {
  const source = onikiriSource(sourceSkillId, actor.unitId);
  const rank = skillRank(actor, onikiriIds.passive);
  const values: Record<string, number> = statusId === onikiriIds.guardBlade ? { charges: 3 } : {};
  const duration = statusId === onikiriIds.assistBlade ? { kind: 'count' as const, remaining: 1, owner: 'source-turn' as const }
    : { kind: 'permanent' as const };
  return { type: 'add-status', source, targetId: actor.unitId, instance: {
    instanceId: `${statusId}:${actor.unitId}`, statusId, source, stacks: 1, duration,
    ...(rank >= 5 ? { modifiers: [{ stat: 'attack' as const, operation: 'percent' as const, amount: .15 }] } : {}),
    ...(Object.keys(values).length ? { values } : {}),
  } };
}

function randomBlade(context: BattleContext): typeof bladeIds[number] {
  return bladeIds[Math.min(bladeIds.length - 1, Math.floor(context.random() * bladeIds.length))]!;
}

function resistanceCommand(owner: Readonly<UnitState>): EffectCommand[] {
  if (!isAwakened(owner)) return [];
  const source = onikiriSource(onikiriIds.passive, owner.unitId);
  return [{ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${onikiriIds.resistance}:${owner.unitId}`,
    statusId: onikiriIds.resistance, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'source-turn' },
    modifiers: [{ stat: 'resist', operation: 'percent', amount: .5 }] } }];
}

function passiveRow(actor: Readonly<UnitState>) {
  return battleSkillRow(onikiriIds.passive, skillRank(actor, onikiriIds.passive), actor.awakeFilter);
}
function skillRank(actor: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, actor.skillLevels?.[skillId] ?? actor.skillLevel));
}
function fallbackOpeningBlades(rank: number): number { return rank >= 4 ? 3 : rank === 3 ? 2 : rank === 2 ? 1 : 0; }
function isAwakened(actor: Readonly<UnitState>): boolean { return actor.awakeFilter === 1; }
function onikiriSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
