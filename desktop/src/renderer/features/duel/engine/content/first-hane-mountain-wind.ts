import type { DamageInterception, HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, BattleState, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passiveSuppressionStatusId, passivesEnabled } from '../core/passive-eligibility';
import { soulSuppressionStatusId } from '../core/soul-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { attemptDebuff } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const firstHaneMountainWindIds = {
  hero: 357,
  basic: '3571',
  passive: '3572',
  ultimate: '3573',
  shield: '35721',
  mark: '35722',
  lift: '35723',
  swiftWind: 'status.hero.357.swift-wind',
  allyShield: 'status.hero.357.swift-shield',
  hunterMark: 'status.hero.357.hunter-mark',
  lastCriticalAttack: 'status.hero.357.last-critical-attack',
  turnWind: 'status.hero.357.turn-wind',
} as const;

const basicRatios = [.4, .42, .44, .46, .5] as const;
const ultimateRatios = [.63, .66, .69, .72, .75] as const;

export function registerFirstHaneMountainWind(registry: ContentRegistry): void {
  registry.registerStatus({ id: firstHaneMountainWindIds.swiftWind, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack',
    stackScope: 'source-unit', maxStacks: 999 });
  registry.registerStatus({ id: firstHaneMountainWindIds.allyShield, mechanicsCoverage: 'partial', category: 'shield',
    dispellable: false, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: firstHaneMountainWindIds.hunterMark, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: firstHaneMountainWindIds.lastCriticalAttack, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: firstHaneMountainWindIds.turnWind, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createFirstHaneMountainWindDefinition());
}

export function createFirstHaneMountainWindDefinition(): HeroDefinition {
  const basic = damageSkill(firstHaneMountainWindIds.basic, 'basic', basicRatios, 2);
  const ultimate = damageSkill(firstHaneMountainWindIds.ultimate, 'skill', ultimateRatios, 4, {
    resourceCost: { resourceId: 'fire', amount: 3 },
  });
  const shield: SkillDefinition = {
    id: firstHaneMountainWindIds.shield, actionKind: 'skill', target: 'single', targetRelation: 'ally',
    levels: [{ ratio: .75 }],
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0) return [];
      return [{ type: 'add-status', source: windSource(firstHaneMountainWindIds.shield, actor.unitId), targetId: target.unitId,
        instance: { instanceId: `${firstHaneMountainWindIds.allyShield}:${actor.unitId}:${target.unitId}`,
          statusId: firstHaneMountainWindIds.allyShield, source: windSource(firstHaneMountainWindIds.shield, actor.unitId),
          stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          modifiers: [{ stat: 'critResist', operation: 'flat', amount: 1 }],
          values: { shieldRemaining: (context.getEffectiveStats(actor.unitId)?.attack ?? actor.stats.attack) * .75 } } }];
    },
    canUse(_state, actor) { return actor.heroId === firstHaneMountainWindIds.hero && passivesEnabled(actor); },
  };
  const hunter: SkillDefinition = {
    id: firstHaneMountainWindIds.mark, actionKind: 'skill', target: 'single', targetRelation: 'enemy', levels: [{ ratio: .35 }],
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0) return [];
      const commands: EffectCommand[] = [];
      for (const enemy of context.getLivingUnits(target.side)) {
        const previous = enemy.statuses.filter(status => status.statusId === firstHaneMountainWindIds.hunterMark
          && status.source.unitId === actor.unitId).map(status => status.instanceId);
        if (previous.length) commands.push({ type: 'remove-status-instances', source: windSource(firstHaneMountainWindIds.mark, actor.unitId),
          targetId: enemy.unitId, instanceIds: previous, reason: 'replaced' });
      }
      commands.push(...attemptDebuff(context, { source: windSource(firstHaneMountainWindIds.mark, actor.unitId), targetId: target.unitId,
        statusId: firstHaneMountainWindIds.hunterMark, baseChance: 1,
        duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
        modifiers: [{ stat: 'attack', operation: 'percent', amount: -.35 }, { stat: 'speed', operation: 'percent', amount: -.35 },
          { stat: 'defense', operation: 'percent', amount: -.35 }] }));
      return commands;
    },
    canUse(_state, actor) { return actor.heroId === firstHaneMountainWindIds.hero && passivesEnabled(actor); },
  };
  const lift = damageSkill(firstHaneMountainWindIds.lift, 'skill', [2.4], 1, {
    target: 'single', targetRelation: 'enemy', canUse(_state, actor) {
      return actor.heroId === firstHaneMountainWindIds.hero && passivesEnabled(actor);
    },
  }, (context, actor, target) => {
    const commands: EffectCommand[] = [];
    if (target.unitKind !== 'monster') {
      commands.push({ type: 'add-status', source: windSource(firstHaneMountainWindIds.lift, actor.unitId), targetId: target.unitId,
        instance: { instanceId: `${passiveSuppressionStatusId}:357:${actor.unitId}:${target.unitId}`,
          statusId: passiveSuppressionStatusId, source: windSource(firstHaneMountainWindIds.lift, actor.unitId), stacks: 1,
          duration: { kind: 'permanent' } } });
      commands.push({ type: 'add-status', source: windSource(firstHaneMountainWindIds.lift, actor.unitId), targetId: target.unitId,
        instance: { instanceId: `${soulSuppressionStatusId}:357:${actor.unitId}:${target.unitId}`,
          statusId: soulSuppressionStatusId, source: windSource(firstHaneMountainWindIds.lift, actor.unitId), stacks: 1,
          duration: { kind: 'permanent' } } });
    }
    return commands;
  }, (context, actor) => gainSwiftWind(actor, 40));
  const definition: HeroDefinition = {
    id: firstHaneMountainWindIds.hero,
    skills: [basic, shield, hunter, lift, ultimate],
    aiCoverage: 'verified', mechanicsCoverage: 'verified',
    mechanicsCoverageNotes: ['已按客户端技能行实现疾/岚多段倍率、迅风的初始行动值与推条、控制解除后的行动条增益、迅·庇羽护盾和暴击抵抗、迅·猎目三维减益、迅·击空对非怪物的被动/御魂封印与击退增值，以及生命已损比例增伤；回归覆盖二级群攻减伤、三级迅风暴伤快照、四级受暴击推条、盾破后移除暴抗、猎目命中/抵抗和逐击伤害。AI技能优先级、迅风80点阈值、友方20%庇羽线及低于20%敌方优先目标均有边界测试'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== firstHaneMountainWindIds.hero || !passivesEnabled(owner)
        || skillLevel(owner, firstHaneMountainWindIds.passive) < 5) return [];
      return [{ type: 'add-status', source: windSource(firstHaneMountainWindIds.passive, unitId), targetId: unitId,
        instance: windStatus(owner, 20) },
      { type: 'change-action-gauge', source: windSource(firstHaneMountainWindIds.passive, unitId), targetId: unitId, amount: 20 }];
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const allies = context.getLivingUnits(actor.side).filter(unit => unit.unitKind !== 'summon');
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const criticallyInjured = allies.filter(unit => !hasOwnedStatus(unit, firstHaneMountainWindIds.allyShield, actor.unitId))
        .sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
      const executeTarget = enemies.filter(unit => unit.hp / Math.max(1, unit.stats.hp) < .2)
        .sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0];
      const target = executeTarget ?? enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      if (!passivesEnabled(actor)) {
        if ((context.state.resources[actor.side]?.fire ?? 0) >= 3 && enemies.length >= 2)
          return intent(actor, firstHaneMountainWindIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies', 'enemy');
        return intent(actor, firstHaneMountainWindIds.basic, [target.unitId], 'single', 'enemy');
      }
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3 && enemies.length >= 2)
        return intent(actor, firstHaneMountainWindIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies', 'enemy');
      if (swiftPoints(actor) >= 80 && !hasOwnedStatus(target, passiveSuppressionStatusId, actor.unitId))
        return intent(actor, firstHaneMountainWindIds.lift, [target.unitId], 'single', 'enemy');
      if (criticallyInjured && criticallyInjured.hp / Math.max(1, criticallyInjured.stats.hp) < .2)
        return intent(actor, firstHaneMountainWindIds.shield, [criticallyInjured.unitId], 'single', 'ally');
      const fastEnemy = executeTarget ?? enemies.slice().sort((a, b) => b.stats.speed - a.stats.speed)[0]!;
      if (!hasOwnedStatus(fastEnemy, firstHaneMountainWindIds.hunterMark, actor.unitId))
        return intent(actor, firstHaneMountainWindIds.mark, [fastEnemy.unitId], 'single', 'enemy');
      return intent(actor, firstHaneMountainWindIds.basic, [target.unitId], 'single', 'enemy');
    },
    modifyOutgoingDamage(attacker, target, amount, _kind, state) {
      if (attacker.heroId !== firstHaneMountainWindIds.hero || !passivesEnabled(attacker)) return amount;
      const lostFraction = Math.max(0, Math.min(1, 1 - target.hp / Math.max(1, target.stats.hp)));
      return amount * (1 + lostFraction * .5);
    },
    interceptIncomingDamage(_state, _attacker, target, amount, _kind, context): DamageInterception | undefined {
      if (target.heroId !== firstHaneMountainWindIds.hero || skillLevel(target, firstHaneMountainWindIds.passive) < 2
        || !passivesEnabled(target) || context?.attackShape !== 'all-enemies') return undefined;
      return { amount: amount * .5, effects: [] };
    },
    handlers: {
      'turn-start': { priority: 38, handle(context, event) { return snapshotSwiftWind(context, event); } },
      'turn-end': { priority: 38, handle(context, event) { return clearTurnWind(context, event); } },
      'status-expiration': { priority: 38, handle(context, event) { return controlEnded(context, event); } },
      'effect-resolution': { priority: 38, handle(context, event) { return controlEnded(context, event); } },
      hit: { priority: 38, handle(context, event) { return onHit(context, event); } },
      'attack-end': { priority: 38, handle(context, event) { return endLiftSuppression(context, event); } },
    },
  };
  return definition;
}

function damageSkill(id: string, kind: 'basic' | 'skill', ratios: readonly number[], hits: number,
  options: Partial<Pick<SkillDefinition, 'resourceCost' | 'target' | 'targetRelation' | 'canUse'>> = {},
  beforeDamage?: (context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>) => EffectCommand[],
  afterDamage?: (context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>) => EffectCommand[]): SkillDefinition {
  return { id, actionKind: kind, target: options.target ?? (kind === 'skill' ? 'all-enemies' : 'single'),
    targetRelation: options.targetRelation ?? 'enemy', useClientDamageData: true, resourceCost: options.resourceCost,
    ...(options.canUse ? { canUse: options.canUse } : {}),
    levels: ratios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const stats = actor && (context.getEffectiveStats(actor.unitId) ?? actor.stats);
      if (!actor || !stats) return [];
      const ratio = Number(parameters.ratio ?? ratios[0]);
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        const defense = target && (context.getEffectiveStats(target.unitId) ?? target.stats);
        if (!target || target.hp <= 0 || !defense) continue;
        if (beforeDamage) commands.push(...beforeDamage(context, actor, target));
        const effectiveRatio = id === firstHaneMountainWindIds.lift && target.unitKind === 'monster' ? 4.8 : ratio;
        for (let index = 0; index < hits; index++) {
          const result = context.calculateDamage({ attack: stats.attack, defense: defense.defense,
            defenseIgnore: effectiveDefenseIgnore(actor), ratio: effectiveRatio, critChance: stats.crit,
            critDamage: stats.critDamage }, actor, target);
          commands.push({ type: 'deal-damage', source: windSource(id, actor.unitId), targetId: target.unitId,
            amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
            ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, stats.critDamage) } : {}),
            isCritical: result.isCritical });
        }
        if (afterDamage) commands.push(...afterDamage(context, actor, target));
      }
      return commands;
    },
  };
}

function gainSwiftWind(owner: Readonly<UnitState>, amount: number): EffectCommand[] {
  const add = Math.max(0, amount);
  return [{ type: 'add-status', source: windSource(firstHaneMountainWindIds.lift, owner.unitId), targetId: owner.unitId,
    instance: windStatus(owner, add) },
  { type: 'change-action-gauge', source: windSource(firstHaneMountainWindIds.passive, owner.unitId), targetId: owner.unitId,
    amount: add }];
}

function controlEnded(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusCategory !== 'control'
    && context.getStatusCategory(event.statusId ?? '') !== 'control') return;
  if (event.statusId === passiveSuppressionStatusId || event.statusId === soulSuppressionStatusId) return;
  const target = context.getUnit(event.targetId);
  if (!target || target.hp <= 0 || target.heroId !== firstHaneMountainWindIds.hero || !passivesEnabled(target)
    || context.isUnitUnableToAct(target.unitId)) return;
  const wind = target.statuses.find(status => status.statusId === firstHaneMountainWindIds.swiftWind
    && status.source.unitId === target.unitId);
  const points = wind?.stacks ?? 0;
  const spent = Math.min(60, points);
  const remaining = points - spent;
  const source = windSource(firstHaneMountainWindIds.passive, target.unitId);
  const commands: EffectCommand[] = [];
  if (wind) commands.push({ type: 'remove-status-instances', source, targetId: target.unitId,
    instanceIds: [wind.instanceId], reason: 'consumed', parentEventId: event.eventId });
  if (remaining > 0) commands.push({ type: 'add-status', source, targetId: target.unitId,
    instance: { ...windStatus(target, remaining), instanceId: wind?.instanceId ?? `${firstHaneMountainWindIds.swiftWind}:${target.unitId}` },
    parentEventId: event.eventId });
  commands.push({ type: 'change-action-gauge', source, targetId: target.unitId, amount: 30 + spent,
    parentEventId: event.eventId });
  return commands;
}

function snapshotSwiftWind(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.hp <= 0 || actor.heroId !== firstHaneMountainWindIds.hero || !passivesEnabled(actor)
    || skillLevel(actor, firstHaneMountainWindIds.passive) < 3) return;
  const points = swiftPoints(actor);
  if (points <= 0) return;
  return [{ type: 'add-status', source: windSource(firstHaneMountainWindIds.passive, actor.unitId), targetId: actor.unitId,
    instance: { instanceId: `${firstHaneMountainWindIds.turnWind}:${actor.unitId}`, statusId: firstHaneMountainWindIds.turnWind,
      source: windSource(firstHaneMountainWindIds.passive, actor.unitId), stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: [{ stat: 'critDamage', operation: 'percent', amount: points * .01 }], values: { swiftPoints: points } } }];
}

function clearTurnWind(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== firstHaneMountainWindIds.hero) return;
  const status = actor.statuses.find(instance => instance.statusId === firstHaneMountainWindIds.turnWind);
  return status ? [{ type: 'remove-status-instances', source: windSource(firstHaneMountainWindIds.passive, actor.unitId),
    targetId: actor.unitId, instanceIds: [status.instanceId], reason: 'expired', parentEventId: event.eventId }] : [];
}

function onHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  return [...(allyWasCriticallyHit(context, event) ?? []), ...(removeExhaustedShield(context, event) ?? [])];
}

function removeExhaustedShield(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage') return;
  const target = context.getUnit(event.targetId);
  const shield = target?.statuses.find(status => status.statusId === firstHaneMountainWindIds.allyShield
    && Number(status.values?.shieldRemaining ?? 0) <= 0);
  if (!target || !shield) return;
  return [{ type: 'remove-status-instances', source: shield.source, targetId: target.unitId,
    instanceIds: [shield.instanceId], reason: 'consumed', parentEventId: event.eventId }];
}

function allyWasCriticallyHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.isCritical || event.attackId === undefined) return;
  const attackId = event.attackId;
  const target = context.getUnit(event.targetId);
  const attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  if (!target || !attacker || attacker.side === target.side) return;
  const owners = context.getLivingUnits(target.side).filter(unit => unit.heroId === firstHaneMountainWindIds.hero
    && passivesEnabled(unit) && skillLevel(unit, firstHaneMountainWindIds.passive) >= 4);
  return owners.flatMap(owner => {
    const marker = owner.statuses.find(status => status.statusId === firstHaneMountainWindIds.lastCriticalAttack);
    if (Number(marker?.values?.attackId) === attackId) return [];
    const source = windSource(firstHaneMountainWindIds.passive, owner.unitId);
    return [{ type: 'add-status' as const, source, targetId: owner.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${firstHaneMountainWindIds.lastCriticalAttack}:${owner.unitId}`,
        statusId: firstHaneMountainWindIds.lastCriticalAttack, source, stacks: 1, duration: { kind: 'permanent' as const },
        values: { attackId } } },
    { type: 'change-action-gauge' as const, source, targetId: owner.unitId, amount: 10, parentEventId: event.eventId }];
  });
}

function endLiftSuppression(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.source.id !== firstHaneMountainWindIds.lift || !event.source.unitId) return;
  const commands: EffectCommand[] = [];
  for (const change of event.targetHealthChanges ?? []) {
    const target = context.getUnit(change.targetId);
    if (!target) continue;
    const instanceIds = target.statuses.filter(status => [passiveSuppressionStatusId, soulSuppressionStatusId].includes(status.statusId)
      && status.source.unitId === event.source.unitId && status.source.id === firstHaneMountainWindIds.lift).map(status => status.instanceId);
    if (instanceIds.length) commands.push({ type: 'remove-status-instances', source: windSource(firstHaneMountainWindIds.lift, event.source.unitId),
      targetId: target.unitId, instanceIds, reason: 'consumed', parentEventId: event.eventId });
  }
  return commands;
}

function windStatus(owner: Readonly<UnitState>, stacks: number): StatusInstance {
  const source = windSource(firstHaneMountainWindIds.passive, owner.unitId);
  return { instanceId: `${firstHaneMountainWindIds.swiftWind}:${owner.unitId}`, statusId: firstHaneMountainWindIds.swiftWind,
    source, stacks, duration: { kind: 'permanent' } };
}
function swiftPoints(unit: Readonly<UnitState>): number {
  return unit.statuses.find(status => status.statusId === firstHaneMountainWindIds.swiftWind && status.source.unitId === unit.unitId)?.stacks ?? 0;
}
function hasOwnedStatus(unit: Readonly<UnitState>, statusId: string, ownerId: string): boolean {
  return unit.statuses.some(status => status.statusId === statusId && status.source.unitId === ownerId);
}
function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function intent(actor: Readonly<UnitState>, skillId: string, targets: readonly string[], shape: ActionIntent['shape'], relation: ActionIntent['targetRelation']): ActionIntent {
  return { actorId: actor.unitId, skillId, targetIds: targets, shape, targetRelation: relation };
}
function windSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
