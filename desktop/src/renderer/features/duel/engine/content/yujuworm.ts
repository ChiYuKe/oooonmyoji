import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled, passiveSuppressionStatusId } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const yujuwormIds = { hero: 318, basic: '3181', passive: '3182', ultimate: '3183', poison: 'status.hero.318.poison',
  speedAura: 'status.hero.318.poison-speed', attackState: 'status.hero.318.attack-state', gaze: 'status.hero.318.gaze' } as const;

const basicRatios = [.6, .66, .66, .72, .72] as const;
const basicPoisonLevels = [1, 1, 2, 2, 3] as const;
const passiveRatios = [.08, .12, .12, .16, .16] as const;
const ultimateRatios = [.3, .3, .36, .36, .36] as const;
const ultimateHits = [5, 5, 5, 5, 6] as const;

export function registerYujuworm(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: yujuwormIds.poison, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'keep' },
    { id: yujuwormIds.speedAura, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: yujuwormIds.attackState, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
      durationOwner: 'event', refreshPolicy: 'replace' },
    { id: yujuwormIds.gaze, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));

  const basic: SkillDefinition = { id: yujuwormIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map((ratio, index) => ({ ratio, poisonLevel: basicPoisonLevels[index]!, poisonDuration: 2 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== yujuwormIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      return damage(context, actor, target, basic.id, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!));
    } };
  const ultimate: SkillDefinition = { id: yujuwormIds.ultimate, actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCostsByLevel: [{ resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 3 },
      { resourceId: 'fire', amount: 3 }, { resourceId: 'fire', amount: 2 }],
    levels: ultimateRatios.map((ratio, index) => ({ ratio, hits: ultimateHits[index]!, poisonLevel: index >= 1 ? 3 : 2,
      poisonDuration: 2, gazeRatio: 1.05 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), focus = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== yujuwormIds.hero || actor.hp <= 0 || !focus || focus.hp <= 0 || focus.side === actor.side) return [];
      const level = rank(actor, ultimate.id), hitCount = Number(parameters.hits ?? ultimateHits[level - 1]!);
      const ratio = Number(parameters.ratio ?? ultimateRatios[level - 1]!);
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      const counts = new Map<string, number>(), source = yujuwormSource(ultimate.id, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: actor.unitId,
        instance: { instanceId: `${yujuwormIds.attackState}:${actor.unitId}:${context.state.counters.action}`,
          statusId: yujuwormIds.attackState, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'event' },
          values: { focusTargetId: focus.unitId, burstLevels: '', actionId: context.state.counters.action } } }];
      for (let index = 0; index < hitCount; index += 1) {
        const living = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
        if (!living.length) break;
        const fresh = living.filter(target => (counts.get(target.unitId) ?? 0) === 0);
        const pool = fresh.length ? fresh : living;
        const target = pool[Math.min(pool.length - 1, Math.floor(context.random() * pool.length))]!;
        counts.set(target.unitId, (counts.get(target.unitId) ?? 0) + 1);
        commands.push(...damage(context, actor, target, ultimate.id, ratio));
      }
      return commands;
    } };

  const definition: HeroDefinition = { id: yujuwormIds.hero, skills: [basic, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入毒液普攻按等级60%至72%伤害并附加1至3级毒、被动按技能等级引爆随机一层毒并造成攻击8%至16%×毒等级的间接伤害，3级起升级新毒并延长1回合、5级起按中毒敌方数增加速度；祸根技按等级随机优先攻击未被命中的敌人5至6次（30%至36%），并挂载目标回合末105%攻击伤害与毒素复制状态。基础毒减速/受击降防、引爆层数复制及技能动画随机顺序仍需录像校准。'],
    handlers: {
      hit: { priority: 55, handle(context, event) { return onHit(context, event); } },
      'attack-end': { priority: 55, handle(context, event) { return finishGaze(context, event); } },
      'turn-end': { priority: 55, handle(context, event) { return gazeTick(context, event); } },
      'turn-start': { priority: 55, handle(context, event) { return refreshSpeedOnPoisonChange(context, event); } },
      'effect-resolution': { priority: 55, handle(context, event) { return refreshSpeedOnPoisonChange(context, event); } },
      'status-expiration': { priority: 55, handle(context, event) { return refreshSpeedOnPoisonChange(context, event); } },
      'unit-defeated': { priority: 55, handle(context, event) { return refreshSpeedOnPoisonChange(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return;
      const cost = rank(actor, ultimate.id) >= 5 ? 2 : 3;
      const target = enemies.slice().sort((a, b) => b.statuses.filter(status => status.statusId === yujuwormIds.poison).length
        - a.statuses.filter(status => status.statusId === yujuwormIds.poison).length)[0]!;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= cost)
        return { actorId: unitId, skillId: ultimate.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function onHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId || ![yujuwormIds.basic, yujuwormIds.ultimate].includes(event.source.id as typeof yujuwormIds.basic)) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== yujuwormIds.hero || owner.hp <= 0 || !target || target.hp <= 0) return;
  const isUltimate = event.source.id === yujuwormIds.ultimate;
  const skillLevel = rank(owner, event.source.id);
  const appliedPoisonLevel = isUltimate ? (Number(owner.awakeFilter ?? 0) > 0 ? 2 : (skillLevel >= 2 ? 3 : 2))
    : basicPoisonLevels[Math.min(4, skillLevel - 1)]!;
  const poisonDuration = 2;
  const commands: EffectCommand[] = [];
  const poisons = target.statuses.filter(status => status.statusId === yujuwormIds.poison);
  if (poisons.length && passivesEnabled(owner)) {
    const index = Math.min(poisons.length - 1, Math.floor(context.random() * poisons.length));
    const removed = poisons[index]!;
    const poisonLevel = Number(removed.values?.poisonLevel ?? 1);
    const src = yujuwormSource(yujuwormIds.passive, owner.unitId);
    commands.push({ type: 'remove-status-instances', source: src, targetId: target.unitId, instanceIds: [removed.instanceId], reason: 'consumed' },
      { type: 'lose-life', source: src, targetId: target.unitId,
        amount: (context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack) * passiveRatios[rank(owner, yujuwormIds.passive) - 1]!
          * poisonLevel, lifeLossKind: 'indirect', parentEventId: event.eventId });
    if (rank(owner, yujuwormIds.passive) >= 3) {
      const remaining = removed.duration.kind === 'count' ? removed.duration.remaining : 1;
      const upgraded = makePoison(owner, target, Math.min(9, poisonLevel + 1), remaining + 1,
        `${event.eventId}:upgrade`, yujuwormIds.passive);
      commands.push(...attemptDebuff(context, { source: src, targetId: target.unitId, statusId: yujuwormIds.poison, baseChance: 1,
        duration: upgraded.duration, values: upgraded.values, modifiers: upgraded.modifiers, parentEventId: `${event.eventId}:upgrade` }));
      recordBurstLevel(owner, target, poisonLevel, commands);
    } else recordBurstLevel(owner, target, poisonLevel, commands);
  }
  const baseSource = yujuwormSource(event.source.id, owner.unitId);
  const poison = makePoison(owner, target, appliedPoisonLevel, poisonDuration, event.eventId, event.source.id);
  commands.push(...attemptDebuff(context, { source: baseSource, targetId: target.unitId, statusId: yujuwormIds.poison, baseChance: 1,
    duration: poison.duration, values: poison.values, modifiers: poison.modifiers, parentEventId: event.eventId }));
  return commands;
}

function recordBurstLevel(owner: Readonly<UnitState>, target: Readonly<UnitState>, level: number, commands: EffectCommand[]): void {
  const tracker = owner.statuses.find(status => status.statusId === yujuwormIds.attackState);
  if (!tracker || String(tracker.values?.focusTargetId ?? '') === target.unitId) return;
  const values = { ...tracker.values, burstLevels: [String(tracker.values?.burstLevels ?? ''), String(level)].filter(Boolean).join(',') };
  commands.push({ type: 'add-status', source: tracker.source, targetId: owner.unitId, instance: { ...tracker, values } });
}

function finishGaze(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.unitId === undefined) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== yujuwormIds.hero) return;
  const tracker = owner.statuses.find(status => status.statusId === yujuwormIds.attackState);
  if (!tracker || tracker.source.id !== yujuwormIds.ultimate || Number(tracker.values?.actionId) !== context.state.counters.action) return;
  const targetId = String(tracker.values?.focusTargetId ?? ''), target = context.getUnit(targetId);
  const commands: EffectCommand[] = [{ type: 'remove-status-instances', source: tracker.source, targetId: owner.unitId,
    instanceIds: [tracker.instanceId], reason: 'consumed' }];
  if (target && target.hp > 0 && Number(owner.awakeFilter ?? 0) > 0) {
    const src = yujuwormSource(yujuwormIds.ultimate, owner.unitId);
    commands.push({ type: 'add-status', source: src, targetId: targetId, instance: { instanceId: `${yujuwormIds.gaze}:${owner.unitId}:${context.state.counters.action}`,
      statusId: yujuwormIds.gaze, source: src, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      values: { tickRatio: 1.05 } } });
    for (const rawLevel of String(tracker.values?.burstLevels ?? '').split(',').filter(Boolean)) {
      const copy = makePoison(owner, target, Math.max(1, Math.min(9, Number(rawLevel))), 2,
        `${context.state.counters.action}:gaze:${rawLevel}:${commands.length}`, yujuwormIds.ultimate);
      commands.push(...attemptDebuff(context, { source: src, targetId, statusId: yujuwormIds.poison, baseChance: 1,
        duration: copy.duration, values: copy.values, modifiers: copy.modifiers, parentEventId: `${context.state.counters.action}:copy:${commands.length}` }));
    }
  }
  return commands;
}

function gazeTick(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const effects: EffectCommand[] = [];
  for (const gaze of target.statuses.filter(status => status.statusId === yujuwormIds.gaze)) {
    const owner = gaze.source.unitId ? context.getUnit(gaze.source.unitId) : undefined;
    if (owner && owner.hp > 0) effects.push({ type: 'lose-life', source: gaze.source, targetId: target.unitId,
      amount: (context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack) * Number(gaze.values?.tickRatio ?? 1.05),
      lifeLossKind: 'indirect', parentEventId: event.eventId });
  }
  return effects;
}

function refreshSpeedOnPoisonChange(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const isPoisonAdd = event.type === 'status-added' && event.instance.statusId === yujuwormIds.poison;
  const isPoisonRemove = event.type === 'status-removed' && event.statusId === yujuwormIds.poison;
  const passiveSealed = (event.type === 'status-added' && event.instance.statusId === passiveSuppressionStatusId)
    || (event.type === 'status-removed' && event.statusId === passiveSuppressionStatusId);
  const ownerDefeated = event.type === 'unit-defeated' && context.getUnit(event.unitId)?.heroId === yujuwormIds.hero;
  const turnStart = event.type === 'turn-started';
  if (!isPoisonAdd && !isPoisonRemove && !passiveSealed && !ownerDefeated && !turnStart) return;
  const owners = Object.values(context.state.units).filter(unit => unit.heroId === yujuwormIds.hero && rank(unit, yujuwormIds.passive) >= 5);
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    if (owner.hp <= 0 || !passivesEnabled(owner)) {
      if (owner.statuses.some(status => status.statusId === yujuwormIds.speedAura)) commands.push({ type: 'remove-statuses',
        source: yujuwormSource(yujuwormIds.passive, owner.unitId), targetId: owner.unitId,
        statusIds: [yujuwormIds.speedAura], reason: 'consumed' });
      continue;
    }
    const count = Math.min(10, context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')
      .filter(enemy => enemy.statuses.some(status => status.statusId === yujuwormIds.poison)).length);
    const source = yujuwormSource(yujuwormIds.passive, owner.unitId);
    commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${yujuwormIds.speedAura}:${owner.unitId}`,
      statusId: yujuwormIds.speedAura, source, stacks: 1, duration: { kind: 'permanent' as const }, values: { poisonedEnemies: count },
      modifiers: [{ stat: 'speed', operation: 'flat', amount: count * 10 }] } });
  }
  return commands;
}

function makePoison(owner: Readonly<UnitState>, target: Readonly<UnitState>, level: number, duration: number, seed: string, skillId: string): StatusInstance {
  const source = yujuwormSource(skillId, owner.unitId);
  return { instanceId: `${yujuwormIds.poison}:${owner.unitId}:${target.unitId}:${seed}:${level}`, statusId: yujuwormIds.poison, source,
    stacks: 1, duration: { kind: 'count', remaining: duration, owner: 'target-turn' }, values: { poisonLevel: level },
    modifiers: [{ stat: 'speed', operation: 'percent', amount: -.1 },
      { stat: 'defense', operation: 'flat', amount: -10 * level }] };
}

function damage(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats, defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense, defenseIgnore: effectiveDefenseIgnore(actor), ratio,
    dmgFluctuation: .01, critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: yujuwormSource(skillId, actor.unitId), targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical }];
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function yujuwormSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
