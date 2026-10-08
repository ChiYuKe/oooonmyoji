import type { DamageInterceptionContext, HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const crabSisterIds = {
  hero: 335,
  basic: '3351',
  passive: '3352',
  hammer: '3353',
  shell: 'status.hero.335.shell',
  momentum: 'status.hero.335.momentum',
  selfStun: 'status.hero.335.self-stun',
  postStun: 'status.hero.335.post-stun',
} as const;

const basicRatios = [.5, .525, .55, .575, .625] as const;
const hammerRatios = [1.4, 1.47, 1.54, 1.61, 1.61] as const;

export function registerCrabSister(registry: ContentRegistry): void {
  registry.registerStatus({ id: crabSisterIds.shell, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: crabSisterIds.momentum, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: crabSisterIds.selfStun, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: crabSisterIds.postStun, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createDefinition());
}

function createDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: crabSisterIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    canUse(_state, actor) { return isCrabSister(actor) && actor.hp > 0; },
    execute(context, intent, parameters) { return makeHits(context, intent, Number(parameters.ratio ?? .5), crabSisterIds.basic, 2); } };
  const hammer: SkillDefinition = { id: crabSisterIds.hammer, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 }, levels: hammerRatios.map(ratio => ({ ratio })),
    canUse(_state, actor) { return isCrabSister(actor) && actor.hp > 0; },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      const momentum = findStatus(actor, crabSisterIds.momentum);
      const commands: EffectCommand[] = [];
      if (momentum) commands.push({ type: 'remove-status-instances', source: crabSource(crabSisterIds.hammer, actor.unitId),
        targetId: actor.unitId, instanceIds: [momentum.instanceId], reason: 'consumed' });
      commands.push(...makeHits(context, intent, Number(parameters.ratio ?? 1.4), crabSisterIds.hammer, 2));
      if (!momentum) {
        const source = crabSource(crabSisterIds.hammer, actor.unitId);
        commands.push({ type: 'apply-control', source, targetId: actor.unitId, instance: {
          instanceId: `${crabSisterIds.selfStun}:${actor.unitId}:${context.state.counters.action + 1}`,
          statusId: crabSisterIds.selfStun, source, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '眩晕' },
        } });
        if (skillRank(actor, crabSisterIds.passive) >= 5) commands.push(...grantShell(context, actor));
      }
      return commands;
    } };

  return {
    id: crabSisterIds.hero,
    skills: [basic, hammer],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['依据客户端逐级行接入：普攻两段倍率50/52.5/55/57.5/62.5%，自身回合结束获得30速及下一锤免自晕；先机和自身无控制时回合末获得蟹壳。蟹壳只减非暴击伤害，基础减伤20%、二级30%、四级40%，累计减伤上限一级100%攻击、三级起150%，五级另有30%暴击抵抗。螺螺锤消耗3火、全体两段140/147/154/161/161%，无免疫标记时自晕1回合；五级自晕期间获蟹壳，眩晕解除后获40%暴伤1回合。此式神不在10点场阵容中；御魂联动、护盾下累计减伤口径和蟹壳/加速状态的驱散属性仍需实战帧校准。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      return owner && isCrabSister(owner) && owner.hp > 0 && passivesEnabled(owner) ? grantShell(context, owner) : [];
    },
    handlers: {
      'action-end': { priority: 35, handle(context, event) { return afterBasic(context, event); } },
      'turn-end': { priority: 35, handle(context, event) { return passiveShell(context, event); } },
      'status-expiration': { priority: 35, handle(context, event) { return afterStun(context, event); } },
      'effect-resolution': { priority: 35, handle(context, event) { return afterStun(context, event); } },
    },
    interceptIncomingDamage(_state, _attacker, target, amount, _kind, interception) {
      return reduceShellDamage(target, amount, interception);
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) return { actorId: unitId,
        skillId: crabSisterIds.hammer, targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: crabSisterIds.basic, targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function makeHits(context: BattleContext, intent: ActionIntent, ratio: number, skillId: string, hitCount: number): EffectCommand[] {
  const attacker = context.getUnit(intent.actorId);
  if (!attacker) return [];
  const offense = context.getEffectiveStats(attacker.unitId) ?? attacker.stats;
  const commands: EffectCommand[] = [];
  for (let hitIndex = 0; hitIndex < hitCount; hitIndex++) {
    for (const targetId of intent.targetIds) {
      const target = context.getUnit(targetId);
      if (!target || target.hp <= 0) continue;
      const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
      const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
        defenseIgnore: effectiveDefenseIgnore(attacker), ratio, critChance: offense.crit, critDamage: offense.critDamage }, attacker, target);
      commands.push({ type: 'deal-damage', source: crabSource(skillId, attacker.unitId), targetId: target.unitId,
        amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
        ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, offense.critDamage) } : {}) });
    }
  }
  return commands;
}

function afterBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.skillId !== crabSisterIds.basic
    || event.scheduling === 'assist' || event.scheduling === 'counter' || event.scheduling === 'extra-action' || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || !isCrabSister(owner) || owner.hp <= 0) return;
  const source = crabSource(crabSisterIds.basic, owner.unitId);
  return [{ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${crabSisterIds.momentum}:${owner.unitId}`, statusId: crabSisterIds.momentum,
      source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: [{ stat: 'speed', operation: 'flat', amount: 30 }], values: { preventsNextSelfStun: true } } }];
}

function passiveShell(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || !isCrabSister(owner) || owner.hp <= 0 || !passivesEnabled(owner)
    || owner.statuses.some(status => context.getStatusCategory(status.statusId) === 'control'
      || status.values?.controlType !== undefined)) return;
  return grantShell(context, owner, event.eventId);
}

function grantShell(context: BattleContext, owner: Readonly<UnitState>, parentEventId?: string): EffectCommand[] {
  const rank = skillRank(owner, crabSisterIds.passive);
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const reduction = rank >= 4 ? .4 : rank >= 2 ? .3 : .2;
  const capRatio = rank >= 3 ? 1.5 : 1;
  const source = crabSource(crabSisterIds.passive, owner.unitId);
  const instance: StatusInstance = { instanceId: `${crabSisterIds.shell}:${owner.unitId}`, statusId: crabSisterIds.shell,
    source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { reduction, cap: offense.attack * capRatio, reduced: 0 },
    ...(rank >= 5 ? { modifiers: [{ stat: 'critResist' as const, operation: 'flat' as const, amount: .3 }] } : {}) };
  return [{ type: 'add-status', source, targetId: owner.unitId, instance,
    ...(parentEventId ? { parentEventId } : {}) }];
}

function reduceShellDamage(target: Readonly<UnitState>, amount: number, interception?: DamageInterceptionContext) {
  if (amount <= 0 || interception?.isCritical) return undefined;
  const shell = findStatus(target, crabSisterIds.shell);
  if (!shell) return undefined;
  const cap = Math.max(0, Number(shell.values?.cap ?? 0));
  const reducedSoFar = Math.max(0, Number(shell.values?.reduced ?? 0));
  const reduction = Math.min(amount * Math.max(0, Number(shell.values?.reduction ?? 0)), Math.max(0, cap - reducedSoFar));
  if (reduction <= 0) return undefined;
  const source = crabSource(crabSisterIds.passive, target.unitId);
  const updated: StatusInstance = { ...shell, values: { ...shell.values, reduced: reducedSoFar + reduction } };
  return { amount: amount - reduction, effects: [{ type: 'add-status' as const, source, targetId: target.unitId,
    instance: updated }] };
}

function afterStun(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== crabSisterIds.selfStun || event.reason === 'replaced') return;
  const owner = context.getUnit(event.targetId);
  if (!owner || !isCrabSister(owner) || owner.hp <= 0 || skillRank(owner, crabSisterIds.passive) < 5) return;
  const source = crabSource(crabSisterIds.hammer, owner.unitId);
  return [{ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${crabSisterIds.postStun}:${owner.unitId}`, statusId: crabSisterIds.postStun,
      source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: [{ stat: 'critDamage', operation: 'flat', amount: .4 }] } }];
}

function findStatus(unit: Readonly<UnitState>, statusId: string): StatusInstance | undefined {
  return unit.statuses.find(status => status.statusId === statusId);
}
function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function isCrabSister(unit: Readonly<UnitState>): boolean { return unit.heroId === crabSisterIds.hero && unit.unitKind !== 'summon'; }
function crabSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
