import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const huaniaoJuanIds = {
  hero: 279,
  basic: '2791',
  passive: '2792',
  ultimate: '2793',
  birds: 'status.hero.279.birds',
  healing: 'status.hero.279.healing-bloom',
  counterMarker: 'status.hero.279.counter-marker',
} as const;

const basicRatios = [.4, .4, .4, .4, .4] as const;
const birdHealChances = [.5, .6, .7, .8, .8] as const;
const actionBarChances = [.2, .25, .25, .3, .3] as const;
const actionBarAmounts = [.2, .2, .25, .25, .3] as const;
const immediateHealRatios = [.08, .1, .1, .12, .12] as const;
const healingRatios = [[.07, .06], [.07, .06], [.09, .08], [.09, .08], [.11, .1]] as const;

/** 花鸟卷的飞鸟资源、归鸟攻击、画境抵控/推条和花鸟相闻持续治疗。 */
export function registerHuaniaoJuan(registry: ContentRegistry): void {
  registry.registerStatus({ id: huaniaoJuanIds.birds, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 3 });
  registry.registerStatus({ id: huaniaoJuanIds.healing, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace',
    handlers: { 'turn-start': { priority: 42, handle(context, event) { return healAtTurnStart(context, event); } } } });
  registry.registerStatus({ id: huaniaoJuanIds.counterMarker, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });

  const basic: SkillDefinition = {
    id: huaniaoJuanIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent) { return attackWithBirds(context, intent); },
  };
  const ultimate: SkillDefinition = {
    id: huaniaoJuanIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-allies', targetRelation: 'ally',
    levels: immediateHealRatios.map((ratio, index) => ({ ratio, firstTick: healingRatios[index]![0], secondTick: healingRatios[index]![1] })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0 || actor.heroId !== huaniaoJuanIds.hero) return [];
      const rank = skillIndex(actor, huaniaoJuanIds.ultimate);
      const maxHp = context.getEffectiveStats(actor.unitId)?.hp ?? actor.stats.hp;
      const source = flowerSource(huaniaoJuanIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [];
      for (const allyId of intent.targetIds) {
        const ally = context.getUnit(allyId);
        if (!ally || ally.hp <= 0 || ally.side !== actor.side) continue;
        commands.push({ type: 'heal', source, targetId: ally.unitId,
          amount: (context.getEffectiveStats(ally.unitId)?.hp ?? ally.stats.hp) * Number(parameters.ratio ?? immediateHealRatios[rank]!) });
        commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
          instanceId: `${huaniaoJuanIds.healing}:${actor.unitId}:${ally.unitId}:${context.state.counters.action}`,
          statusId: huaniaoJuanIds.healing, source, stacks: 1,
          duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          values: { firstHeal: maxHp * Number(parameters.firstTick ?? healingRatios[rank]![0]),
            secondHeal: maxHp * Number(parameters.secondTick ?? healingRatios[rank]![1]) },
        } });
      }
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: huaniaoJuanIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入归鸟每只飞鸟40%攻击、飞鸟上限/回合开始补充、各段独立治疗概率、控制成功后画境概率抵挡并消耗飞鸟、行动结束推条、花鸟相闻3火群体即时及两次回合前治疗。客户端表未给飞鸟被动治疗触发具体计数顺序；反击场景飞鸟数量消耗和控制抵挡/免疫、御魂联动仍需实战帧核。'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      return !actor || actor.heroId !== huaniaoJuanIds.hero ? [] : [birdCountCommand(actor, 1, 'battle-start')];
    },
    handlers: {
      'turn-start': { priority: 42, handle(context, event) { return replenishBirdAtTurnStart(context, event); } },
      'effect-resolution': { priority: 42, handle(context, event) { return markCounterAction(context, event); } },
      'action-end': { priority: 42, handle(context, event) { return handleActionEnd(context, event); } },
      'control-application': { priority: 42, handle(context, event) { return resistControlWithBird(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon');
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!allies.length || !enemies.length) return undefined;
      const hurtAllies = allies.filter(unit => unit.hp < unit.stats.hp * .75);
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3 && hurtAllies.length >= 2)
        return flowerIntent(actor.unitId, huaniaoJuanIds.ultimate, allies.map(unit => unit.unitId), 'all-allies', 'ally');
      return flowerIntent(actor.unitId, huaniaoJuanIds.basic, [enemies[0]!.unitId], 'single', 'enemy');
    },
  };
  registry.registerHero(definition);
}

function attackWithBirds(context: BattleContext, intent: ActionIntent): EffectCommand[] {
  const actor = context.getUnit(intent.actorId);
  const target = context.getUnit(intent.targetIds[0] ?? '');
  if (!actor || actor.hp <= 0 || actor.heroId !== huaniaoJuanIds.hero || !target || target.hp <= 0 || target.side === actor.side) return [];
  const bird = actor.statuses.find(status => status.statusId === huaniaoJuanIds.birds);
  const counter = actor.statuses.some(status => status.statusId === huaniaoJuanIds.counterMarker);
  const birdCount = Math.max(1, bird?.stacks ?? 0);
  const strikes = counter ? 1 : birdCount;
  const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense, ratio: .4,
    critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
  const source = flowerSource(huaniaoJuanIds.basic, actor.unitId);
  const commands: EffectCommand[] = Array.from({ length: strikes }, () => ({ type: 'deal-damage', source,
    targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }));
  const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon');
  const healChance = birdHealChances[skillIndex(actor, huaniaoJuanIds.basic)]!;
  for (let index = 0; index < strikes; index++) {
    if (context.random() >= healChance || allies.length === 0) continue;
    const lowest = allies.reduce((current, unit) => unit.hp / unit.stats.hp < current.hp / current.stats.hp ? unit : current);
    commands.push({ type: 'heal', source, targetId: lowest.unitId,
      amount: actorStats.hp * .1 });
  }
  if (bird) commands.push({ type: 'remove-statuses', source, targetId: actor.unitId, statusIds: [huaniaoJuanIds.birds], reason: 'consumed' });
  const left = Math.max(0, birdCount - strikes);
  if (left > 0) commands.push(birdCountCommand(actor, left, `${context.state.counters.action}:remaining`));
  else if (!counter) commands.push(birdCountCommand(actor, 1, `${context.state.counters.action}:return`));
  return commands;
}

function replenishBirdAtTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== huaniaoJuanIds.hero || actor.hp <= 0 || !passivesEnabled(actor)) return;
  const current = actor.statuses.find(status => status.statusId === huaniaoJuanIds.birds)?.stacks ?? 0;
  if (current >= maxBirdCount(actor)) return;
  return [birdCountCommand(actor, current + 1, event.eventId)];
}

function resistControlWithBird(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-applied') return;
  const target = context.getUnit(event.targetId);
  if (!target || target.hp <= 0) return;
  const owner = context.getLivingUnits(target.side).find(unit => unit.heroId === huaniaoJuanIds.hero && passivesEnabled(unit));
  if (!owner) return;
  const birds = owner.statuses.find(status => status.statusId === huaniaoJuanIds.birds);
  if (!birds || birds.stacks <= 0 || context.random() >= .3) return;
  const controlled = target.statuses.find(status => status.statusId === event.statusId);
  if (!controlled) return;
  const source = flowerSource(huaniaoJuanIds.passive, owner.unitId);
  return [
    { type: 'remove-statuses', source, targetId: target.unitId, statusIds: [event.statusId], reason: 'consumed', parentEventId: event.eventId },
    ...consumeBird(owner, birds.stacks, event.eventId),
  ];
}

function handleActionEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.intent) return;
  const actor = context.getUnit(event.intent.actorId);
  if (!actor || actor.heroId !== huaniaoJuanIds.hero) return;
  const commands: EffectCommand[] = [];
  const marker = actor.statuses.find(status => status.statusId === huaniaoJuanIds.counterMarker);
  if (marker) commands.push({ type: 'remove-statuses', source: marker.source, targetId: actor.unitId,
    statusIds: [huaniaoJuanIds.counterMarker], reason: 'consumed', parentEventId: event.eventId });
  if (passivesEnabled(actor) && context.random() < actionBarChances[skillIndex(actor, huaniaoJuanIds.passive)]!)
    commands.push({ type: 'change-action-gauge', source: flowerSource(huaniaoJuanIds.passive, actor.unitId), targetId: actor.unitId,
      amount: actionBarAmounts[skillIndex(actor, huaniaoJuanIds.passive)]!, parentEventId: event.eventId });
  return commands.length ? commands : undefined;
}

function markCounterAction(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-scheduled' || event.scheduling !== 'counter' || event.intent.skillId !== huaniaoJuanIds.basic) return;
  const actor = context.getUnit(event.intent.actorId);
  if (!actor || actor.heroId !== huaniaoJuanIds.hero) return;
  const source = flowerSource(huaniaoJuanIds.passive, actor.unitId);
  return [{ type: 'add-status', source, targetId: actor.unitId, instance: { instanceId: `${huaniaoJuanIds.counterMarker}:${event.eventId}`,
    statusId: huaniaoJuanIds.counterMarker, source, stacks: 1, duration: { kind: 'permanent' } }, parentEventId: event.eventId }];
}

function healAtTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  const instance = target.statuses.find(status => status.statusId === huaniaoJuanIds.healing);
  if (!instance) return;
  const amount = instance.duration.kind === 'count' && instance.duration.remaining <= 1
    ? Number(instance.values?.secondHeal ?? 0) : Number(instance.values?.firstHeal ?? 0);
  return amount > 0 ? [{ type: 'heal', source: instance.source, targetId: target.unitId, amount, parentEventId: event.eventId }] : undefined;
}

function consumeBird(owner: Readonly<UnitState>, current: number, parentEventId: string): EffectCommand[] {
  const next = Math.max(0, current - 1);
  const source = flowerSource(huaniaoJuanIds.passive, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'remove-statuses', source, targetId: owner.unitId,
    statusIds: [huaniaoJuanIds.birds], reason: 'consumed', parentEventId }];
  if (next > 0) commands.push(birdCountCommand(owner, next, parentEventId));
  return commands;
}

function birdCountCommand(owner: Readonly<UnitState>, count: number, key: string): EffectCommand {
  const source = flowerSource(huaniaoJuanIds.passive, owner.unitId);
  return { type: 'add-status', source, targetId: owner.unitId, parentEventId: key, instance: {
    instanceId: `${huaniaoJuanIds.birds}:${owner.unitId}`, statusId: huaniaoJuanIds.birds, source,
    stacks: Math.max(1, Math.min(maxBirdCount(owner), count)), duration: { kind: 'permanent' },
  } };
}

function maxBirdCount(owner: Readonly<UnitState>): number {
  return skillIndex(owner, huaniaoJuanIds.basic) >= 4 ? 3 : 2;
}
function skillIndex(owner: Readonly<UnitState>, skillId: string): number {
  return Math.max(0, Math.min(4, (owner.skillLevels?.[skillId] ?? owner.skillLevel) - 1));
}
function flowerIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape'],
  targetRelation: ActionIntent['targetRelation']): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation };
}
function flowerSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
