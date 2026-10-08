import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const ittanMomenIds = { hero: 320, basic: '3201', bind: '3202', ultimate: '3203', obstruction: 'status.hero.320.obstruction',
  wrap: 'status.hero.320.wrap', stolenStats: 'status.hero.320.stolen-stats' } as const;

const basicRatios = [1, 1.05, 1.1, 1.2, 1.2] as const;
const bindDetonationRatios = [1.85, 1.85, 1.85, 1.85, 1.85] as const;
const bindPerStackRatios = [.21, .26, .31, .36, .36] as const;
const ultimateFinalRatios = [1.25, 1.53, 1.81, 2.09, 2.09] as const;

export function registerIttanMomen(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: ittanMomenIds.obstruction, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: ittanMomenIds.wrap, mechanicsCoverage: 'partial', category: 'mark', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 99 },
    { id: ittanMomenIds.stolenStats, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: ittanMomenIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map((ratio, index) => ({ ratio, obstructionDuration: index === 4 ? 2 : 1, obstructionChance: 1 })),
    execute(context, intent, parameters) {
      const actor = getActor(context, intent), target = getTarget(context, intent);
      if (!actor || actor.heroId !== ittanMomenIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      return damage(context, actor, target, basic.id, Number(parameters.ratio ?? basicRatios[skillRank(actor, basic.id) - 1]!));
    } };

  const bind: SkillDefinition = { id: ittanMomenIds.bind, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 1 },
    levels: bindDetonationRatios.map((ratio, index) => ({ initialRatio: .8, ratio,
      perStackRatio: bindPerStackRatios[index]!, stacks: 3, stealExtraStats: index === 4 })),
    execute(context, intent, parameters) {
      const actor = getActor(context, intent), target = getTarget(context, intent);
      if (!actor || actor.heroId !== ittanMomenIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const level = skillRank(actor, bind.id);
      const existing = findOwnedWrap(context, actor.unitId);
      const source = ittanMomenSource(bind.id, actor.unitId);
      if (existing?.unitId === target.unitId) {
        const ratio = Number(parameters.ratio ?? bindDetonationRatios[level - 1]!)
          + existing.status.stacks * Number(parameters.perStackRatio ?? bindPerStackRatios[level - 1]!);
        return [...damage(context, actor, target, bind.id, ratio), { type: 'remove-status-instances', source,
          targetId: target.unitId, instanceIds: [existing.status.instanceId], reason: 'consumed' }];
      }
      const commands: EffectCommand[] = [];
      if (existing) commands.push({ type: 'remove-status-instances', source, targetId: existing.unitId,
        instanceIds: [existing.status.instanceId], reason: 'replaced' });
      commands.push(...damage(context, actor, target, bind.id, Number(parameters.initialRatio ?? .8)));
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const stealStats = { hit: targetStats.hit * .4,
        resist: Boolean(parameters.stealExtraStats) ? targetStats.resist * .4 : 0,
        crit: Boolean(parameters.stealExtraStats) ? targetStats.crit * .4 : 0 };
      commands.push(...attemptDebuff(context, { source, targetId: target.unitId, statusId: ittanMomenIds.wrap,
        baseChance: 1, duration: { kind: 'permanent' }, stacks: Number(parameters.stacks ?? 3),
        values: { ownerUnitId: actor.unitId, ...stealStats }, modifiers: [
          { stat: 'speed', operation: 'flat', amount: -25 },
          { stat: 'hit', operation: 'flat', amount: -stealStats.hit },
          ...(stealStats.resist ? [{ stat: 'resist' as const, operation: 'flat' as const, amount: -stealStats.resist }] : []),
          ...(stealStats.crit ? [{ stat: 'crit' as const, operation: 'flat' as const, amount: -stealStats.crit }] : []),
        ] }));
      return commands;
    } };

  const ultimate: SkillDefinition = { id: ittanMomenIds.ultimate, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCost: { resourceId: 'fire', amount: 3 },
    levels: ultimateFinalRatios.map((finalRatio, index) => ({ firstThreeRatio: .45, finalRatio,
      extraWrap: 1, singleTargetFireRefund: index >= 4 ? 2 : 0 })),
    execute(context, intent, parameters) {
      const actor = getActor(context, intent), target = getTarget(context, intent);
      if (!actor || actor.heroId !== ittanMomenIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const level = skillRank(actor, ultimate.id), marked = findOwnedWrap(context, actor.unitId);
      const attackTargets = [...new Set([target.unitId, marked?.unitId].filter((id): id is string => Boolean(id)))];
      const firstThree = Number(parameters.firstThreeRatio ?? .45), finalRatio = Number(parameters.finalRatio ?? ultimateFinalRatios[level - 1]!);
      const commands: EffectCommand[] = [];
      for (const attackTargetId of attackTargets) {
        const recipient = context.getUnit(attackTargetId);
        if (!recipient || recipient.hp <= 0) continue;
        for (let hitIndex = 0; hitIndex < 4; hitIndex++) commands.push(...damage(context, actor, recipient, ultimate.id,
          hitIndex === 3 ? finalRatio : firstThree));
      }
      if (marked && (context.getUnit(marked.unitId)?.hp ?? 0) > 0) commands.push({ type: 'add-status', source: ittanMomenSource(ultimate.id, actor.unitId),
        targetId: marked.unitId, instance: { instanceId: marked.status.instanceId, statusId: ittanMomenIds.wrap,
          source: marked.status.source, stacks: Number(parameters.extraWrap ?? 1), duration: { kind: 'permanent' },
          values: marked.status.values } });
      if (attackTargets.length <= 1 && Number(parameters.singleTargetFireRefund ?? (level >= 5 ? 2 : 0)) > 0)
        commands.push({ type: 'change-resource', source: ittanMomenSource(ultimate.id, actor.unitId), side: actor.side,
          resourceId: 'fire', amount: Number(parameters.singleTargetFireRefund ?? 2) });
      return commands;
    } };

  const definition: HeroDefinition = { id: ittanMomenIds.hero, skills: [basic, bind, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入缠击按等级100%至120%伤害及100%基础概率降低目标15%伤害（五级2回合）；雪织耗1火，初次对目标造成80%伤害并附3层缠绕，降低25速度，目标回合结束叠1层；复施同一目标消耗全部缠绕并造成185%+每层21%至36%伤害，改绑时清除旧目标层数。缠绕期间按客户端行偷取40%效果命中，五级另偷取40%效果抵抗与暴击；一反木绵受普攻伤害时缠绕目标减1层。绯夜散华耗3火，对选中目标和缠绕目标分别四段攻击（前三段45%，末段125%至209%），缠绕目标再叠1层；仅攻击一个目标时五级返还2火。觉醒击杀缠绕目标的永久属性偷取、状态驱散/死亡/免疫边界、实际帧序及御魂连锁仍待核验。'],
    handlers: {
      hit: { priority: 77, handle(context, event) { return handleHit(context, event); } },
      'turn-end': { priority: 77, handle(context, event) { return addTurnEndWrap(context, event); } },
      'effect-resolution': { priority: 77, handle(context, event) { return onStatusChange(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const marked = findOwnedWrap(context, actor.unitId);
      const weak = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (fire >= 3) return { actorId: unitId, skillId: ultimate.id,
        targetIds: [marked ? enemies.find(enemy => enemy.unitId !== marked.unitId)?.unitId ?? marked.unitId : weak.unitId],
        shape: 'single', targetRelation: 'enemy' };
      if (fire >= 1 && marked) return { actorId: unitId, skillId: bind.id,
        targetIds: [enemies.find(enemy => enemy.unitId === marked.unitId)?.unitId ?? weak.unitId], shape: 'single', targetRelation: 'enemy' };
      if (fire >= 1) return { actorId: unitId, skillId: bind.id, targetIds: [weak.unitId], shape: 'single', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: basic.id, targetIds: [weak.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function handleHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const commands = [...onBasicHit(context, event), ...onBasicDefenseHit(context, event)];
  return commands.length ? commands : undefined;
}

function onBasicHit(context: BattleContext, event: BattleEvent): EffectCommand[] {
  if (event.type !== 'damage' || event.source.id !== ittanMomenIds.basic || !event.source.unitId) return [];
  const actor = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== ittanMomenIds.hero || !target || target.hp <= 0) return [];
  return attemptDebuff(context, { source: ittanMomenSource(ittanMomenIds.basic, actor.unitId), targetId: target.unitId,
    statusId: ittanMomenIds.obstruction, baseChance: 1,
    duration: { kind: 'count', remaining: skillRank(actor, ittanMomenIds.basic) >= 5 ? 2 : 1, owner: 'target-turn' },
    modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: -.15 }] });
}

function onBasicDefenseHit(context: BattleContext, event: BattleEvent): EffectCommand[] {
  if (event.type !== 'damage' || event.actionKind !== 'basic') return [];
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== ittanMomenIds.hero || owner.hp <= 0) return [];
  const marked = findOwnedWrap(context, owner.unitId);
  if (!marked) return [];
  return [{ type: 'change-status-stacks', source: ittanMomenSource(ittanMomenIds.bind, owner.unitId),
    targetId: marked.unitId, instanceId: marked.status.instanceId, amount: -1 }];
}

function addTurnEndWrap(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId); if (!target || target.hp <= 0) return;
  const wrap = target.statuses.find(status => status.statusId === ittanMomenIds.wrap);
  if (!wrap) return;
  const owner = typeof wrap.values?.ownerUnitId === 'string' ? context.getUnit(wrap.values.ownerUnitId) : undefined;
  if (!owner || owner.hp <= 0) return;
  return [{ type: 'add-status', source: wrap.source, targetId: target.unitId,
    instance: { instanceId: wrap.instanceId, statusId: wrap.statusId, source: wrap.source, stacks: 1,
      duration: { kind: 'permanent' }, values: wrap.values } }];
}

function onStatusChange(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type === 'status-added' && event.instance.statusId === ittanMomenIds.wrap) {
    const ownerId = event.instance.values?.ownerUnitId;
    const owner = typeof ownerId === 'string' ? context.getUnit(ownerId) : undefined;
    const target = context.getUnit(event.targetId);
    if (!owner || owner.heroId !== ittanMomenIds.hero || owner.hp <= 0 || !target || target.hp <= 0) return;
    const source = ittanMomenSource(ittanMomenIds.bind, owner.unitId);
    const modifiers = [
      { stat: 'hit' as const, operation: 'flat' as const, amount: Number(event.instance.values?.hit ?? 0) },
      { stat: 'resist' as const, operation: 'flat' as const, amount: Number(event.instance.values?.resist ?? 0) },
      { stat: 'crit' as const, operation: 'flat' as const, amount: Number(event.instance.values?.crit ?? 0) },
    ].filter(modifier => modifier.amount !== 0);
    return [{ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${ittanMomenIds.stolenStats}:${owner.unitId}`,
      statusId: ittanMomenIds.stolenStats, source, stacks: 1, duration: { kind: 'permanent' }, modifiers } }];
  }
  if (event.type === 'status-removed' && event.statusId === ittanMomenIds.wrap && event.removedSource?.unitId) {
    const owner = context.getUnit(event.removedSource.unitId);
    if (!owner || owner.heroId !== ittanMomenIds.hero) return;
    const stillBound = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')
      .some(unit => unit.statuses.some(status => status.statusId === ittanMomenIds.wrap && status.source.unitId === owner.unitId));
    return stillBound ? undefined : [{ type: 'remove-statuses', source: ittanMomenSource(ittanMomenIds.bind, owner.unitId),
      targetId: owner.unitId, statusIds: [ittanMomenIds.stolenStats], reason: 'consumed' }];
  }
  return;
}

function getActor(context: BattleContext, intent: ActionIntent): Readonly<UnitState> | undefined { return context.getUnit(intent.actorId); }
function getTarget(context: BattleContext, intent: ActionIntent): Readonly<UnitState> | undefined { return context.getUnit(intent.targetIds[0] ?? ''); }
function findOwnedWrap(context: BattleContext, ownerUnitId: string): { unitId: string; status: import('../core/types').StatusInstance } | undefined {
  const owner = context.getUnit(ownerUnitId); if (!owner) return;
  return context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue').flatMap(unit => unit.statuses
    .filter(status => status.statusId === ittanMomenIds.wrap && status.source.unitId === ownerUnitId)
    .map(status => ({ unitId: unit.unitId, status })))[0];
}
function damage(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor), ratio,
    dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: ittanMomenSource(skillId, actor.unitId), targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical }];
}
function skillRank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function ittanMomenSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
