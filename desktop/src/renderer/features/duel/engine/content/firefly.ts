import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveStats } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const fireflyIds = {
  hero: 238,
  basic: '2381',
  passive: '2382',
  heal: '2383',
  seed: 'status.hero.238.blessing-seed',
  photosynthesis: 'status.hero.238.photosynthesis',
  passiveWindow: 'status.hero.238.passive-window',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const passiveHealRatios = [.15, .16, .17, .18, .19] as const;
const healRatios = [.87, .91, .95, .99, 1.04] as const;
const photosynthesisRatios = [.22, .23, .24, .25, .26] as const;

export function registerFirefly(registry: ContentRegistry): void {
  registry.registerStatus({ id: fireflyIds.seed, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 5 });
  registry.registerStatus({ id: fireflyIds.photosynthesis, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: fireflyIds.passiveWindow, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });

  const heal: SkillDefinition = {
    id: fireflyIds.heal,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-allies',
    targetRelation: 'ally',
    levels: healRatios.map((ratio, index) => ({ ratio, hotRatio: photosynthesisRatios[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const stats = context.getEffectiveStats(intent.actorId);
      if (!actor || actor.hp <= 0 || !stats) return [];
      const source = fireflySource(fireflyIds.heal, actor.unitId);
      const commands: EffectCommand[] = [];
      const seed = actor.statuses.find(status => status.statusId === fireflyIds.seed
        && status.source.unitId === actor.unitId && status.source.id === fireflyIds.passive);
      const eligibleSeedTargets = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit
        && unit.unitId !== actor.unitId && unit.hp > 0 && unit.side === actor.side));
      const selectedSeedTarget = intent.selectedTargetId
        ? eligibleSeedTargets.find(unit => unit.unitId === intent.selectedTargetId) : undefined;
      const targetId = (selectedSeedTarget ?? eligibleSeedTargets
        .sort((left, right) => (context.getEffectiveStats(right.unitId)?.attack ?? right.stats.attack)
          - (context.getEffectiveStats(left.unitId)?.attack ?? left.stats.attack))[0])?.unitId;
      if (seed && targetId) commands.push(...transferOneSeed(actor, context.getUnit(targetId)!, seed));
      const healRatio = Number(parameters.ratio ?? .87);
      const hotRatio = Number(parameters.hotRatio ?? .22);
      for (const allyId of intent.targetIds) {
        const ally = context.getUnit(allyId);
        if (!ally || ally.hp <= 0 || ally.side !== actor.side) continue;
        commands.push({ type: 'heal', source, targetId: ally.unitId, amount: stats.attack * healRatio });
        commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
          instanceId: `${fireflyIds.photosynthesis}:${actor.unitId}:${ally.unitId}`,
          statusId: fireflyIds.photosynthesis, source, stacks: 1,
          duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { healAmount: stats.attack * hotRatio },
        } });
      }
      return commands;
    },
  };

  const basic = createBasicAttackSkill(fireflyIds.basic, basicRatios);
  const executeBasic = basic.execute;
  basic.execute = (context, intent, parameters) => {
    const actor = context.getUnit(intent.actorId);
    if (!actor || intent.kind !== 'passive' || skillLevel(actor, fireflyIds.basic) < 5) {
      return executeBasic(context, intent, parameters);
    }
    return executeBasic(context, intent, { ...parameters, ratio: Number(parameters.ratio ?? 1) * 2 });
  };

  registry.registerHero({
    id: fireflyIds.hero,
    skills: [basic, heal],
    aiCoverage: 'verified',
    mechanicsCoverage: 'verified',
    mechanicsCoverageNotes: ['按客户端2381/2382/2383及buff 2383/2384实现并回归普攻等级倍率、吸血和五级回合外增伤；生花按每次攻击至多治疗一次、低攻击来源减伤30%并按敌方行动至多反击一次、萤草行动前最多反击5次；治愈之光群疗、两回合光合作用及其治疗/每回目首次伤害转换；种子初始数量、手动目标优先转移、五级非召唤友方阵亡授种、每名友方最多5层及种子回响。10点场帧确认治愈之光与群疗，反击和种子边界有技能表与专项回归覆盖。'],
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== fireflyIds.hero) return [];
      return [{ type: 'add-status', source: fireflySource(fireflyIds.passive, actor.unitId), targetId: actor.unitId,
        instance: makeSeedStatus(actor, actor, 2) }];
    },
    modifyIncomingDamage(attacker, target, amount) {
      if (target.heroId !== fireflyIds.hero || !passivesEnabled(target)) return amount;
      const targetAttack = effectiveStats(target).attack;
      const attackerAttack = effectiveStats(attacker).attack;
      return attackerAttack < targetAttack ? amount * .7 : amount;
    },
    interceptIncomingDamage(state, _attacker, target, amount) {
      if (amount <= 0) return;
      const photosynthesis = target.statuses.find(status => status.statusId === fireflyIds.photosynthesis
        && Number(status.values?.damageConvertedRound ?? -1) !== state.counters.round);
      if (!photosynthesis) return;
      const source = photosynthesis.source;
      const updated: StatusInstance = { ...photosynthesis,
        values: { ...photosynthesis.values, damageConvertedRound: state.counters.round } };
      return { amount: 0, effects: [
        { type: 'add-status', source, targetId: target.unitId, instance: updated },
        { type: 'heal', source, targetId: target.unitId, amount },
      ] };
    },
    policy(context: BattleContext, unitId: string): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const allies = context.getLivingUnits(actor.side);
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (allies.length === 0 || enemies.length === 0) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 2) {
        const selectedTarget = allies.filter(unit => unit.unitId !== actor.unitId && unit.unitKind !== 'summon')
          .sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0];
        return { actorId: actor.unitId, skillId: fireflyIds.heal, targetIds: allies.map(unit => unit.unitId),
          ...(selectedTarget ? { selectedTargetId: selectedTarget.unitId } : {}),
          shape: 'all-allies', targetRelation: 'ally' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: actor.unitId, skillId: fireflyIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      hit: { priority: 145, handle(context, event) { return handleFireflyHit(context, event); } },
      'effect-resolution': { priority: 40, handle(context, event) { return echoSeedHealing(context, event); } },
      'turn-start': { priority: 35, handle(context, event) {
        return [...(healPhotosynthesis(context, event) ?? []), ...(resetFireflyCounterWindow(context, event) ?? [])];
      } },
      'unit-defeated': { priority: 135, handle(context, event) { return gainSeedOnAllyDeath(context, event); } },
    },
  });
}

function echoSeedHealing(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'healing' || event.hpGained <= 0) return;
  const healed = context.getUnit(event.targetId);
  if (!healed || healed.heroId !== fireflyIds.hero || healed.hp <= 0) return;
  const owner = healed;
  const commands: EffectCommand[] = [];
  for (const ally of context.getLivingUnits(owner.side)) {
    if (ally.unitId === owner.unitId) continue;
    const seed = ally.statuses.find(status => status.statusId === fireflyIds.seed
      && status.source.unitId === owner.unitId && status.source.id === fireflyIds.passive);
    if (!seed) continue;
    commands.push({ type: 'heal', source: seed.source, targetId: ally.unitId, amount: event.hpGained,
      parentEventId: event.eventId });
  }
  return commands;
}

function handleFireflyHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage') return;
  const attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  const target = context.getUnit(event.targetId);
  const commands: EffectCommand[] = [];
  if (event.source.id === fireflyIds.basic && attacker?.heroId === fireflyIds.hero && attacker.hp > 0 && event.hpLost > 0) {
    commands.push({ type: 'heal', source: fireflySource(fireflyIds.basic, attacker.unitId), targetId: attacker.unitId,
      amount: event.hpLost * .3, parentEventId: event.eventId });
  }
  if (!target || target.heroId !== fireflyIds.hero || target.hp <= 0 || !attacker || attacker.side === target.side
    || !passivesEnabled(target) || event.attackId === undefined) return commands;
  const current = target.statuses.find(status => status.statusId === fireflyIds.passiveWindow);
  const lastHealAttack = current?.values?.lastHealAttackId;
  const needsPassiveHeal = lastHealAttack !== event.attackId;
  const attackerStats = context.getEffectiveStats(attacker.unitId);
  const targetStats = context.getEffectiveStats(target.unitId);
  const lowerAttack = Boolean(attackerStats && targetStats && attackerStats.attack < targetStats.attack);
  const turnActionId = event.actionId ?? event.attackId;
  const counterUsesSinceTurn = Number(current?.values?.counterUsesSinceTurn ?? 0);
  const lastCounterActionId = Number(current?.values?.lastCounterActionId ?? -1);
  const canCounter = lowerAttack && counterUsesSinceTurn < 5 && lastCounterActionId !== turnActionId;
  if (!needsPassiveHeal && !canCounter) return commands;
  const values = { ...(current?.values ?? {}),
    ...(needsPassiveHeal ? { lastHealAttackId: event.attackId } : {}),
    ...(canCounter ? { counterUsesSinceTurn: counterUsesSinceTurn + 1, lastCounterActionId: turnActionId } : {}),
  };
  commands.push({ type: 'add-status', source: fireflySource(fireflyIds.passive, target.unitId), targetId: target.unitId,
    parentEventId: event.eventId, instance: passiveWindow(target, values) });
  if (needsPassiveHeal && attackerStats) {
    const ratio = passiveHealRatios[skillLevel(target, fireflyIds.passive) - 1]!;
    commands.push({ type: 'heal', source: fireflySource(fireflyIds.passive, target.unitId), targetId: target.unitId,
      amount: attackerStats.attack * ratio, parentEventId: event.eventId });
  }
  if (canCounter && attacker.hp > 0) commands.push({ type: 'schedule-action', source: fireflySource(fireflyIds.passive, target.unitId),
    intent: { actorId: target.unitId, skillId: fireflyIds.basic, targetIds: [attacker.unitId], shape: 'single',
      targetRelation: 'enemy', kind: 'passive' }, scheduling: 'counter', freeCast: true, parentEventId: event.eventId });
  return commands;
}

function healPhotosynthesis(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId);
  if (!target || target.hp <= 0) return;
  return target.statuses.filter(status => status.statusId === fireflyIds.photosynthesis
    && typeof status.values?.healAmount === 'number').map(status => ({ type: 'heal' as const, source: status.source,
    targetId: target.unitId, amount: Number(status.values!.healAmount), parentEventId: event.eventId }));
}

function resetFireflyCounterWindow(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  const window = actor?.statuses.find(status => status.statusId === fireflyIds.passiveWindow);
  if (!actor || actor.heroId !== fireflyIds.hero || !window || Number(window.values?.counterUsesSinceTurn ?? 0) === 0) return;
  return [{ type: 'add-status', source: fireflySource(fireflyIds.passive, actor.unitId), targetId: actor.unitId,
    parentEventId: event.eventId, instance: passiveWindow(actor, { ...window.values, counterUsesSinceTurn: 0 }) }];
}

function gainSeedOnAllyDeath(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const fallen = context.getUnit(event.unitId);
  if (!fallen || fallen.unitKind === 'summon' || fallen.unitKind === 'monster') return;
  return context.getLivingUnits(fallen.side).filter(unit => unit.heroId === fireflyIds.hero
    && unit.unitKind !== 'summon' && skillLevel(unit, fireflyIds.heal) >= 5 && passivesEnabled(unit)
    && (unit.statuses.find(status => status.statusId === fireflyIds.seed
      && status.source.unitId === unit.unitId && status.source.id === fireflyIds.passive)?.stacks ?? 0) < 5).map(firefly => {
    const previous = firefly.statuses.find(status => status.statusId === fireflyIds.seed
      && status.source.unitId === firefly.unitId && status.source.id === fireflyIds.passive);
    return { type: 'add-status' as const, source: fireflySource(fireflyIds.passive, firefly.unitId), targetId: firefly.unitId,
      parentEventId: event.eventId, instance: makeSeedStatus(firefly, firefly, (previous?.stacks ?? 0) + 1) };
  });
}

function transferOneSeed(owner: Readonly<UnitState>, target: Readonly<UnitState>, seed: StatusInstance): EffectCommand[] {
  const source = seed.source;
  const remaining = Math.max(0, seed.stacks - 1);
  const targetSeed = target.statuses.find(status => status.statusId === fireflyIds.seed
    && status.source.unitId === owner.unitId && status.source.id === fireflyIds.passive);
  const commands: EffectCommand[] = [];
  if (remaining === 0) commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
    instanceIds: [seed.instanceId], reason: 'consumed' });
  else commands.push({ type: 'add-status', source, targetId: owner.unitId,
    instance: makeSeedStatus(owner, owner, remaining) });
  commands.push({ type: 'add-status', source, targetId: target.unitId,
    instance: makeSeedStatus(target, owner, (targetSeed?.stacks ?? 0) + 1) });
  return commands;
}

function makeSeedStatus(target: Readonly<UnitState>, owner: Readonly<UnitState>, stacks: number): StatusInstance {
  const source = fireflySource(fireflyIds.passive, owner.unitId);
  const normalizedStacks = Math.max(1, Math.min(5, Math.floor(stacks)));
  return { instanceId: `${fireflyIds.seed}:${owner.unitId}:${target.unitId}`, statusId: fireflyIds.seed,
    source, stacks: normalizedStacks, duration: { kind: 'permanent' },
    values: { seedCount: normalizedStacks },
    modifiers: [{ stat: 'attack', operation: 'percent', amount: .6 * normalizedStacks }],
  };
}

function passiveWindow(target: Readonly<UnitState>, values: StatusInstance['values']): StatusInstance {
  const source = fireflySource(fireflyIds.passive, target.unitId);
  return { instanceId: `${fireflyIds.passiveWindow}:${target.unitId}`, statusId: fireflyIds.passiveWindow,
    source, stacks: 1, duration: { kind: 'permanent' }, values };
}

function fireflySource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }

function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
