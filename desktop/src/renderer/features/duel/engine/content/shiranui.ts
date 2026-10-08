import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const shiranuiIds = {
  hero: 330,
  basic: '3301',
  passive: '3302',
  starfire: '3303',
  alternateBasic: '3304',
  elegy: '3305',
  eternalNight: '3306',
  field: 'status.hero.330.starfire-field',
  danceMark: 'status.hero.330.dance-mark',
  resist: 'status.hero.330.dance-resist',
  mourning: 'status.hero.330.mourning',
  elegyBuff: 'status.hero.330.elegy-buff',
  fatalTransition: 'status.hero.330.fatal-transition',
  liHuo: 'status.hero.330.li-huo',
} as const;

const basicRatios = [.5, .52, .54, .56, .6] as const;
const alternateBasicRatios = [.62, .64, .66, .68, .72] as const;
const ultimateRatios = [1.25, 1.32, 1.38, 1.44, 1.44] as const;

export function registerShiranui(registry: ContentRegistry): void {
  registry.registerStatus({ id: shiranuiIds.field, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: shiranuiIds.danceMark, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: shiranuiIds.resist, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: shiranuiIds.mourning, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: shiranuiIds.elegyBuff, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: shiranuiIds.fatalTransition, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', preventsLethalDamage: true, requiresPassiveEnabled: true });
  registry.registerStatus({ id: shiranuiIds.liHuo, mechanicsCoverage: 'partial', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createShiranuiDefinition());
}

export function createShiranuiDefinition(): HeroDefinition {
  const basic = makeDamageSkill(shiranuiIds.basic, 'basic', basicRatios, 2);
  const alternateBasic = makeDamageSkill(shiranuiIds.alternateBasic, 'basic', alternateBasicRatios, 2, {
    canUse(_state, actor) { return hasStatus(actor, shiranuiIds.mourning); },
  });
  const transform: SkillDefinition = {
    id: shiranuiIds.passive, actionKind: 'skill', target: 'self', targetRelation: 'ally',
    levels: [1, 1, 1, 1, 1].map(value => ({ value })),
    canUse(_state, actor) { return actor.hp > 0 && actor.hp / Math.max(1, actor.stats.hp) < .5 && !hasStatus(actor, shiranuiIds.mourning); },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      const enemies = actor ? context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue') : [];
      if (!actor) return [];
      return [...enterMourning(actor, `manual:${context.state.counters.action + 1}`),
      { type: 'remove-statuses', source: source(shiranuiIds.passive, intent.actorId), targetId: intent.actorId,
        statusIds: [shiranuiIds.fatalTransition], reason: 'consumed' },
      { type: 'schedule-action', source: source(shiranuiIds.passive, intent.actorId), freeCast: true, scheduling: 'extra-action',
        intent: { actorId: intent.actorId, skillId: shiranuiIds.eternalNight, targetIds: enemies.map(unit => unit.unitId), shape: 'all-enemies', targetRelation: 'enemy' } }];
    },
  };
  const elegy: SkillDefinition = {
    id: shiranuiIds.elegy, actionKind: 'skill', target: 'self', targetRelation: 'ally',
    canUse(_state, actor) { return hasStatus(actor, shiranuiIds.mourning); },
    levels: [1, 1, 1, 1, 1].map(value => ({ value })),
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      return [{ type: 'add-status', source: source(shiranuiIds.elegy, actor.unitId), targetId: actor.unitId,
        instance: { instanceId: `${shiranuiIds.elegyBuff}:${actor.unitId}`, statusId: shiranuiIds.elegyBuff,
          source: source(shiranuiIds.elegy, actor.unitId), stacks: 1, duration: { kind: 'permanent' },
          modifiers: [{ stat: 'speed', operation: 'flat', amount: 20,
            ...(skillLevel(actor, shiranuiIds.elegy) >= 2 ? { perResource: { resourceId: 'fire', amount: 5 } } : {}) },
            ...(skillLevel(actor, shiranuiIds.elegy) >= 3 ? [{ stat: 'resist' as const, operation: 'percent' as const, amount: .2,
              ...(skillLevel(actor, shiranuiIds.elegy) >= 4 ? { perResource: { resourceId: 'fire', amount: .05 } } : {}) }] : [])],
        } }];
    },
  };
  const ultimate = makeDamageSkill(shiranuiIds.eternalNight, 'skill', ultimateRatios, 1, {
    resolveResourceCost(state, actor) {
      const rank = skillLevel(actor, shiranuiIds.eternalNight);
      if (rank < 5) return { resourceId: 'fire', amount: 4 };
      const living = state.sides[actor.side].filter(id => (state.units[id]?.hp ?? 0) > 0
        && state.units[id]?.unitKind !== 'summon').length;
      return { resourceId: 'fire', amount: Math.max(0, 4 - Math.max(0, 5 - living)) };
    },
    canUse(_state, actor) { return hasStatus(actor, shiranuiIds.mourning); },
  });
  const starfire: SkillDefinition = {
    id: shiranuiIds.starfire, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self', targetRelation: 'ally', levels: [1, 1, 1, 1, 1].map(value => ({ value })),
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      return actor ? applyStarfire(context, actor, `action-${context.state.counters.action + 1}`) : [];
    },
  };
  return {
    id: shiranuiIds.hero,
    skills: [basic, transform, starfire, alternateBasic, elegy, ultimate],
    aiCoverage: 'verified', mechanicsCoverage: 'verified',
    mechanicsCoverageNotes: ['按客户端技能与状态行实现初舞/终舞、星火结界、友方普攻追击、起舞抵抗、离殇两种进入路径及回满/清除负面；离殇增加30%暴击、每个单位回合末恢复已损生命40%、自身回合末失去生命上限15%，攻击施加离火并在再次攻击同目标时双倍伤害并消耗标记。离歌增速抵抗、烬染不夜耗火和五级剩余鬼火追击均已实现；专项回归覆盖起舞/受控跳过、结界协战、离殇治疗自损、离火叠消和剩余鬼火追击'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.heroId !== shiranuiIds.hero) return [];
      const commands: EffectCommand[] = [{ type: 'add-status', source: source(shiranuiIds.passive, owner.unitId), targetId: owner.unitId,
        instance: { instanceId: `${shiranuiIds.fatalTransition}:${owner.unitId}`, statusId: shiranuiIds.fatalTransition,
          source: source(shiranuiIds.passive, owner.unitId), stacks: 1, duration: { kind: 'permanent' } } }];
      if (skillLevel(owner, shiranuiIds.starfire) >= 5 && passivesEnabled(owner)) commands.push(...applyStarfire(context, owner, 'preemptive'));
      return commands;
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      if (hasStatus(actor, shiranuiIds.mourning)) {
        if (!hasStatus(actor, shiranuiIds.elegyBuff)) return { actorId: unitId, skillId: shiranuiIds.elegy,
          targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
        return { actorId: unitId, skillId: shiranuiIds.eternalNight,
          targetIds: enemies.map(unit => unit.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      }
      if (!hasStatus(actor, shiranuiIds.field) && (context.state.resources[actor.side]?.fire ?? 0) >= 2)
        return { actorId: unitId, skillId: shiranuiIds.starfire, targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      return { actorId: unitId, skillId: shiranuiIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    modifyOutgoingDamage(attacker, target, amount) {
      const marked = target.statuses.some(status => status.statusId === shiranuiIds.liHuo
        && status.source.unitId === attacker.unitId);
      return attacker.heroId === shiranuiIds.hero && hasStatus(attacker, shiranuiIds.mourning) && marked ? amount * 2 : amount;
    },
    handlers: {
      hit: { priority: 42, handle(context, event) { return transformOnFatalDamage(context, event); } },
      'action-end': { priority: 42, handle(context, event) { return onActionEnd(context, event); } },
      'action-validation': { priority: 42, handle(context, event) { return markInterruptedDance(context, event); } },
      'turn-end': { priority: 42, handle(context, event) { return onTurnEnd(context, event); } },
      'attack-end': { priority: 42, handle(context, event) { return onAttackEnd(context, event); } },
    },
  };
}

function enterMourning(owner: Readonly<UnitState>, marker: string): EffectCommand[] {
  const sourceRef = source(shiranuiIds.passive, owner.unitId);
  return [{ type: 'add-status', source: sourceRef, targetId: owner.unitId, instance: {
    instanceId: `${shiranuiIds.mourning}:${owner.unitId}`, statusId: shiranuiIds.mourning,
    source: sourceRef, stacks: 1, duration: { kind: 'permanent' }, values: { enteredBy: marker },
    modifiers: [{ stat: 'crit', operation: 'flat', amount: .3 }],
  } },
  { type: 'restore-health', source: sourceRef, targetId: owner.unitId, amount: owner.stats.hp },
  { type: 'dispel-statuses', source: sourceRef, targetId: owner.unitId, filter: 'debuff-or-control',
    maxCount: Number.POSITIVE_INFINITY }];
}

function onTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const commands = [...(mourningTurnEnd(context, event) ?? []), ...(danceAtTurnEnd(context, event) ?? [])];
  return commands.length ? commands : undefined;
}

function mourningTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const commands: EffectCommand[] = [];
  for (const side of ['blue', 'red'] as const) {
    for (const owner of context.getLivingUnits(side)) {
      if (owner.heroId !== shiranuiIds.hero || !hasStatus(owner, shiranuiIds.mourning)) continue;
      const maxHealth = context.getEffectiveStats(owner.unitId)?.hp ?? owner.stats.hp;
      const missing = Math.max(0, maxHealth - owner.hp);
      if (missing > 0) commands.push({ type: 'heal', source: source(shiranuiIds.passive, owner.unitId), targetId: owner.unitId,
        amount: missing * .4, parentEventId: event.eventId });
      if (event.unitId === owner.unitId) {
        commands.push({ type: 'lose-life', source: source(shiranuiIds.passive, owner.unitId), targetId: owner.unitId,
          amount: maxHealth * .15, parentEventId: event.eventId });
      }
    }
  }
  return commands.length ? commands : undefined;
}

function onAttackEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const commands = [...(applyLiHuo(context, event) ?? []), ...(followBasic(context, event) ?? [])];
  return commands.length ? commands : undefined;
}

function applyLiHuo(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId || event.suppressSourcePassiveTriggers) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== shiranuiIds.hero || !hasStatus(owner, shiranuiIds.mourning)) return;
  const commands: EffectCommand[] = [];
  for (const change of event.targetHealthChanges ?? []) {
    const target = context.getUnit(change.targetId);
    if (!target || target.hp <= 0) continue;
    const instanceIds = target.statuses.filter(status => status.statusId === shiranuiIds.liHuo
      && status.source.unitId === owner.unitId).map(status => status.instanceId);
    const sourceRef = source(shiranuiIds.passive, owner.unitId);
    if (instanceIds.length) {
      commands.push({ type: 'remove-status-instances', source: sourceRef, targetId: target.unitId,
        instanceIds, reason: 'consumed', parentEventId: event.eventId });
    } else {
      commands.push({ type: 'add-status', source: sourceRef, targetId: target.unitId, parentEventId: event.eventId,
        instance: { instanceId: `${shiranuiIds.liHuo}:${owner.unitId}:${target.unitId}`, statusId: shiranuiIds.liHuo,
          source: sourceRef, stacks: 1, duration: { kind: 'permanent' } } });
    }
  }
  return commands.length ? commands : undefined;
}

function transformOnFatalDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.fatalProtectionStatusId !== shiranuiIds.fatalTransition || !event.targetId) return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== shiranuiIds.hero || owner.hp <= 0 || hasStatus(owner, shiranuiIds.mourning)
    || !passivesEnabled(owner)) return;
  return enterMourning(owner, `fatal:${event.eventId}`);
}

function makeDamageSkill(id: string, actionKind: 'basic' | 'skill', ratios: readonly number[], hits: number,
  extra: Pick<SkillDefinition, 'resolveResourceCost' | 'canUse'> = {}): SkillDefinition {
  return { id, actionKind, target: actionKind === 'skill' ? 'all-enemies' : 'single', targetRelation: 'enemy',
    useClientDamageData: false, levels: ratios.map(ratio => ({ ratio })), ...extra,
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const stats = actor && (context.getEffectiveStats(actor.unitId) ?? actor.stats);
      if (!actor || !stats) return [];
      const ratio = Number(parameters.ratio ?? ratios[0]);
      const sourceRef = source(id, actor.unitId);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        const targetStats = target && (context.getEffectiveStats(target.unitId) ?? target.stats);
        if (!target || target.hp <= 0 || !targetStats) return [];
        return Array.from({ length: hits }, () => {
          const hit = context.calculateDamage({ attack: stats.attack, defense: targetStats.defense,
            defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
          return { type: 'deal-damage' as const, source: sourceRef, targetId, amount: hit.amount,
            ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
            ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, stats.critDamage) } : {}), isCritical: hit.isCritical };
        });
      });
    },
  };
}

function applyStarfire(context: BattleContext, owner: Readonly<UnitState>, marker: string): EffectCommand[] {
  const result: EffectCommand[] = [];
  for (const ally of context.getLivingUnits(owner.side)) {
    if (ally.unitKind === 'summon') continue;
    const sourceRef = source(shiranuiIds.starfire, owner.unitId);
    result.push({ type: 'add-status', source: sourceRef, targetId: ally.unitId, instance: {
      instanceId: `${shiranuiIds.field}:${owner.unitId}:${ally.unitId}`, statusId: shiranuiIds.field, source: sourceRef,
      stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      modifiers: [{ stat: 'damage', operation: 'percent', amount: .1,
        perResource: { resourceId: 'fire', amount: .02 } },
        { stat: 'damageTaken', operation: 'percent', amount: -.1,
          perResource: { resourceId: 'fire', amount: -.02 } },
        { stat: 'speed', operation: 'flat', amount: 25 }], values: { fieldOwnerId: owner.unitId, castMarker: marker },
    } });
  }
  return result;
}

function markBasicDance(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'basic' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const owners = context.getLivingUnits(actor.side).filter(unit => unit.heroId === shiranuiIds.hero && passivesEnabled(unit));
  return owners.map(owner => markDance(owner, actor, event.eventId));
}

function onActionEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const commands = [...(markBasicDance(context, event) ?? []), ...(remainingFireAttacks(context, event) ?? [])];
  return commands.length ? commands : undefined;
}

function remainingFireAttacks(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.skillId !== shiranuiIds.eternalNight || event.scheduling === 'extra-action'
    || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId);
  if (!owner || owner.hp <= 0 || !passivesEnabled(owner) || skillLevel(owner, shiranuiIds.elegy) < 5
    || !hasStatus(owner, shiranuiIds.elegyBuff)) return;
  const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
  const fire = Math.max(0, context.state.resources[owner.side]?.fire ?? 0);
  if (!enemies.length || !fire) return;
  const stats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const attacks: EffectCommand[] = [];
  for (let index = 0; index < fire; index++) {
    const target = enemies[Math.min(enemies.length - 1, Math.floor(context.random() * enemies.length))]!;
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const hit = context.calculateDamage({ attack: stats.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(owner) + 200, ratio: .46, critChance: stats.crit, critDamage: stats.critDamage }, owner, target);
    attacks.push({ type: 'schedule-attack', source: source(shiranuiIds.elegy, owner.unitId),
      intent: { actorId: owner.unitId, skillId: shiranuiIds.elegy, targetIds: [target.unitId], shape: 'single',
        targetRelation: 'enemy', kind: 'passive' }, scheduling: 'assist', suppressSourcePassiveTriggers: true,
      suppressTargetPassiveTriggers: true,
      hits: [{ targetId: target.unitId, amount: hit.amount, damageOptions: { ...hit.damageOptions, leechRate: .3 },
        isCritical: hit.isCritical, suppressSourcePassiveTriggers: true, suppressTargetPassiveTriggers: true }],
      parentEventId: event.eventId });
  }
  return attacks;
}

function danceAtTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const ally = context.getUnit(event.unitId);
  if (!ally || ally.hp <= 0) return;
  const owners = context.getLivingUnits(ally.side).filter(owner => owner.heroId === shiranuiIds.hero && passivesEnabled(owner)
    && ally.statuses.some(status => status.statusId === shiranuiIds.danceMark && status.source.unitId === owner.unitId));
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    const mark = ally.statuses.filter(status => status.statusId === shiranuiIds.danceMark && status.source.unitId === owner.unitId);
    if (mark.length) commands.push({ type: 'remove-status-instances', source: source(shiranuiIds.passive, owner.unitId),
      targetId: ally.unitId, instanceIds: mark.map(status => status.instanceId), reason: 'consumed', parentEventId: event.eventId });
    const rank = skillLevel(owner, shiranuiIds.passive);
    const chance = rank >= 5 && hasFieldFrom(ally, owner.unitId) ? 1 : .5;
    if (context.random() < chance) {
      commands.push({ type: 'lose-life', source: source(shiranuiIds.passive, owner.unitId), targetId: owner.unitId,
        amount: Math.max(1, owner.hp * .05), parentEventId: event.eventId });
      commands.push({ type: 'add-status', source: source(shiranuiIds.passive, owner.unitId), targetId: ally.unitId, instance: {
        instanceId: `${shiranuiIds.resist}:${owner.unitId}:${ally.unitId}`, statusId: shiranuiIds.resist,
        source: source(shiranuiIds.passive, owner.unitId), stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        modifiers: [{ stat: 'resist', operation: 'percent', amount: [.5, .6, .7, .8, .8][rank - 1] ?? .5 }],
      }, parentEventId: event.eventId });
    }
  }
  return commands;
}

function markInterruptedDance(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-skipped' || event.reason !== 'interrupted') return;
  const ally = context.getUnit(event.actorId);
  if (!ally || ally.hp <= 0 || ally.unitKind === 'summon') return;
  return context.getLivingUnits(ally.side).filter(owner => owner.heroId === shiranuiIds.hero && passivesEnabled(owner))
    .map(owner => markDance(owner, ally, event.eventId));
}

function followBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.actionKind !== 'basic' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const targets = (event.targetHealthChanges ?? []).filter(change => context.getUnit(change.targetId)?.hp! > 0).map(change => change.targetId);
  if (!targets.length) return;
  const commands: EffectCommand[] = [];
  for (const owner of context.getLivingUnits(actor.side).filter(unit => unit.heroId === shiranuiIds.hero
    && passivesEnabled(unit) && hasFieldFrom(unit, unit.unitId))) {
    const rank = skillLevel(owner, shiranuiIds.starfire);
    if (context.random() >= (rank >= 4 ? 1 : .5)) continue;
    const ratio = basicRatios[Math.max(0, skillLevel(owner, shiranuiIds.basic) - 1)] ?? .5;
    const targetIds = targets.slice(0, 1);
    const hits = targetIds.flatMap(targetId => {
      const target = context.getUnit(targetId);
      const stats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const defense = target && (context.getEffectiveStats(targetId) ?? target.stats);
      if (!target || !defense) return [];
      return Array.from({ length: 2 }, () => {
        const hit = context.calculateDamage({ attack: stats.attack, defense: defense.defense,
          defenseIgnore: effectiveDefenseIgnore(owner) + 200, ratio, critChance: stats.crit, critDamage: stats.critDamage }, owner, target);
        return { targetId, amount: hit.amount, damageOptions: { ...hit.damageOptions, leechRate: .3 }, isCritical: hit.isCritical };
      });
    });
    if (hits.length) commands.push({ type: 'schedule-attack', source: source(shiranuiIds.basic, owner.unitId),
      intent: { actorId: owner.unitId, skillId: shiranuiIds.basic, targetIds, shape: 'single', targetRelation: 'enemy', kind: 'passive' },
      scheduling: 'assist', suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true, suppressSourcePassiveTriggers: true,
      hits: hits.map(hit => ({ ...hit, suppressTargetPassiveTriggers: true, suppressSourcePassiveTriggers: true })), parentEventId: event.eventId });
  }
  return commands;
}

function markDance(owner: Readonly<UnitState>, ally: Readonly<UnitState>, parentEventId: string): EffectCommand {
  const ref = source(shiranuiIds.passive, owner.unitId);
  return { type: 'add-status', source: ref, targetId: ally.unitId, parentEventId, instance: {
    instanceId: `${shiranuiIds.danceMark}:${owner.unitId}:${ally.unitId}`, statusId: shiranuiIds.danceMark,
    source: ref, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
  } };
}

function hasFieldFrom(unit: Readonly<UnitState>, ownerId: string): boolean {
  return unit.statuses.some(status => status.statusId === shiranuiIds.field && status.source.unitId === ownerId);
}
function hasStatus(unit: Readonly<UnitState>, statusId: string): boolean { return unit.statuses.some(status => status.statusId === statusId); }
function skillLevel(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function source(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
