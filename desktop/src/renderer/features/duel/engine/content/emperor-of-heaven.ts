import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const emperorOfHeavenIds = {
  hero: 363, basic: '3631', lotusSkill: '3632', ultimate: '3633', mirageSkill: '3634',
  lotus: 'status.hero.363.golden-lotus', lotusGuard: 'status.hero.363.lotus-guard',
  monsterLotus: 'status.hero.363.monster-lotus', mirage: 'status.hero.363.mirage',
  mirageSpeed: 'status.hero.363.mirage-speed', freeUltimate: 'status.hero.363.free-ultimate',
  controlledBasic: 'status.hero.363.controlled-basic',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1.38, 1.45, 1.52, 1.59, 1.59] as const;

export function registerEmperorOfHeaven(registry: ContentRegistry): void {
  const controlledBasic = createLotusControlledBasic();
  const statuses: StatusDefinition[] = [
    { id: emperorOfHeavenIds.lotus, mechanicsCoverage: 'partial', category: 'control', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace', grantedSkills: [controlledBasic],
      selectAction(context, actor, instance) {
        if (actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
        const caster = instance.source.unitId ? context.getUnit(instance.source.unitId) : undefined;
        if (!caster || caster.hp <= 0 || caster.side === actor.side) return undefined;
        const ally = context.getLivingUnits(actor.side).filter(unit => unit.unitId !== actor.unitId)
          .sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp)
            || right.actionGauge - left.actionGauge)[0];
        return ally ? { actorId: actor.unitId, skillId: controlledBasic.id, targetIds: [ally.unitId],
          shape: 'single', targetRelation: 'ally', kind: 'basic' } : undefined;
      } },
    { id: emperorOfHeavenIds.lotusGuard, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace', controlProtection: 'single-skill', preventsLethalDamage: true },
    { id: emperorOfHeavenIds.monsterLotus, mechanicsCoverage: 'partial', category: 'mark', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: emperorOfHeavenIds.mirage, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'keep' },
    { id: emperorOfHeavenIds.mirageSpeed, mechanicsCoverage: 'partial', category: 'debuff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: emperorOfHeavenIds.freeUltimate, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'event', refreshPolicy: 'replace' },
  ];
  for (const status of statuses) registry.registerStatus(status);
  registry.registerHero(createEmperorOfHeavenDefinition());
}

export function createEmperorOfHeavenDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(emperorOfHeavenIds.basic, basicRatios);
  const lotus: SkillDefinition = {
    id: emperorOfHeavenIds.lotusSkill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: lotusLevels,
    canUse: (state, actor) => !state.sides[actor.side === 'blue' ? 'red' : 'blue'].some(unitId =>
      state.units[unitId]?.statuses.some(status => status.statusId === emperorOfHeavenIds.lotus
        && status.source.unitId === actor.unitId)),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || owner.side === target.side || target.hp <= 0) return [];
      const source = emperorSource(emperorOfHeavenIds.lotusSkill, owner.unitId);
      const rank = skillRank(owner, emperorOfHeavenIds.lotusSkill);
      const statusDuration = { kind: 'count' as const, remaining: Number(parameters.duration ?? (rank >= 5 ? 2 : 1)), owner: 'target-turn' as const };
      const modifiers = rank >= 2 ? [{ stat: 'attack' as const, operation: 'percent' as const, amount: -.8 }] : [];
      if (target.unitKind === 'monster') {
        return attemptDebuff(context, { source, targetId: target.unitId, statusId: emperorOfHeavenIds.monsterLotus,
          baseChance: 1, duration: { kind: 'permanent' }, values: { ownerUnitId: owner.unitId,
            extraRatio: .4, extraAttack: rank >= 5 ? owner.stats.attack * .7 : 0 } });
      }
      const attempt = attemptControl(context, { attemptId: `${emperorOfHeavenIds.lotus}:${owner.unitId}:${target.unitId}:${context.state.counters.action + 1}`,
        source, targetId: target.unitId, statusId: emperorOfHeavenIds.lotus, controlType: '金莲操控', baseChance: 1,
        duration: statusDuration, modifiers });
      return attempt ? [attempt] : [];
    },
  };

  const ultimate: SkillDefinition = {
    id: emperorOfHeavenIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio, healRatio: 1 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner || owner.hp <= 0) return [];
      const source = emperorSource(emperorOfHeavenIds.ultimate, owner.unitId);
      const freeCast = context.state.activeActionScheduling === 'counter'
        && owner.statuses.some(status => status.statusId === emperorOfHeavenIds.freeUltimate);
      const scale = freeCast ? .6 : 1;
      const ratio = Number(parameters.ratio ?? ultimateRatios[skillRank(owner, emperorOfHeavenIds.ultimate) - 1]!) * scale;
      const healRatio = Number(parameters.healRatio ?? 1) * scale;
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0 || target.side === owner.side) continue;
        commands.push(damage(context, owner, target, source, ratio, freeCast));
        if (hasStatusFrom(target, emperorOfHeavenIds.lotus, owner.unitId)) {
          commands.push(damage(context, owner, target, source, ratio, freeCast));
          commands.push(damage(context, owner, target, source, ratio, freeCast));
        }
      }
      const ally = context.getLivingUnits(owner.side).filter(unit => unit.unitId !== owner.unitId)
        .sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp)
          || left.unitId.localeCompare(right.unitId))[0];
      commands.push({ type: 'heal', source, targetId: owner.unitId,
        amount: owner.stats.attack * healRatio });
      if (ally) commands.push({ type: 'heal', source, targetId: ally.unitId, amount: owner.stats.attack * healRatio });
      if (freeCast) commands.push({ type: 'remove-statuses', source, targetId: owner.unitId,
        statusIds: [emperorOfHeavenIds.freeUltimate], reason: 'consumed' });
      return commands;
    },
  };

  return {
    id: emperorOfHeavenIds.hero, skills: [basic, lotus, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['按本地3631/3632/3633/3634及3632/3633/3635战斗状态行接入天诛、金莲操控/怪物追加真实伤害、金莲提供的一次技能控制抵挡和一次致命保护、五级金莲消失后的净化/免火低伤大招、王之盛宴幻境减速/敌方回合起始拉条、三级幻境未开启时自身回合末拉条及四级被控目标普攻供火。操控目标的AI替代手动指定、跨目标抵挡的连续技能窗口、金莲致命保护恢复时序、怪物额外伤害触发边界、多帝释天唯一归属、幻境动态速度人数和御魂触发均需连续帧核验。'],
    handlers: {
      'turn-start': { priority: 70, handle(context, event) { return onTurnStart(context, event); } },
      'turn-end': { priority: 70, handle(context, event) { return onTurnEnd(context, event); } },
      'action-end': { priority: 70, handle(context, event) { return onActionEnd(context, event); } },
      'control-application': { priority: 70, handle(context, event) { return onEffectResolution(context, event); } },
      hit: { priority: 70, handle(context, event) { return onEffectResolution(context, event); } },
      'unit-defeated': { priority: 70, handle(context, event) { return onUnitDefeated(context, event); } },
      'status-expiration': { priority: 70, handle(context, event) { return onEffectResolution(context, event); } },
      'effect-resolution': { priority: 70, handle(context, event) { return onEffectResolution(context, event); } },
    },
    policy(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0 || owner.unitKind === 'summon') return undefined;
      const enemies = livingEnemies(context, owner);
      if (!enemies.length) return undefined;
      const fire = context.state.resources[owner.side]?.fire ?? 0;
      const lotusTarget = enemies.find(enemy => hasStatusFrom(enemy, emperorOfHeavenIds.lotus, owner.unitId));
      if (!lotusTarget && fire >= 2) return emperorIntent(owner.unitId, emperorOfHeavenIds.lotusSkill,
        [enemies.slice().sort((left, right) => right.actionGauge - left.actionGauge)[0]!.unitId], 'single', 'enemy');
      if (fire >= 3) return emperorIntent(owner.unitId, emperorOfHeavenIds.ultimate,
        enemies.map(enemy => enemy.unitId), 'all-enemies', 'enemy');
      return emperorIntent(owner.unitId, emperorOfHeavenIds.basic,
        [lotusTarget?.unitId ?? enemies.slice().sort((left, right) => right.actionGauge - left.actionGauge)[0]!.unitId], 'single', 'enemy');
    },
  };
}

function onTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const commands: EffectCommand[] = [];
  if (actor.heroId === emperorOfHeavenIds.hero && !hasStatus(actor, emperorOfHeavenIds.mirage)
    && !context.isUnitUnableToAct(actor.unitId) && passivesEnabled(actor)) {
    commands.push(addStatus(actor, emperorOfHeavenIds.mirage, emperorSource(emperorOfHeavenIds.mirageSkill, actor.unitId),
      { kind: 'permanent' }, undefined, { ownerUnitId: actor.unitId }));
    commands.push(...makeMirageAuras(context, actor, event.eventId));
  }
  if (actor.heroId !== emperorOfHeavenIds.hero) {
    for (const emperor of [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')].filter(unit =>
      unit.heroId === emperorOfHeavenIds.hero && unit.side !== actor.side && hasStatus(unit, emperorOfHeavenIds.mirage)
        && passivesEnabled(unit))) {
      const fastest = context.getLivingUnits(emperor.side).slice().sort((left, right) =>
        right.actionGauge - left.actionGauge || right.stats.speed - left.stats.speed)[0];
      if (fastest) commands.push({ type: 'change-action-gauge', source: emperorSource(emperorOfHeavenIds.mirageSkill, emperor.unitId),
        targetId: fastest.unitId, amount: 30, parentEventId: event.eventId });
    }
  }
  return commands.length ? commands : undefined;
}

function onTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== emperorOfHeavenIds.hero || actor.hp <= 0 || actor.unitKind === 'summon'
    || skillRank(actor, emperorOfHeavenIds.lotusSkill) < 3 || hasStatus(actor, emperorOfHeavenIds.mirage)
    || !passivesEnabled(actor)) return;
  return [{ type: 'change-action-gauge', source: emperorSource(emperorOfHeavenIds.lotusSkill, actor.unitId),
    targetId: actor.unitId, amount: 50, parentEventId: event.eventId }];
}

function onActionEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'basic' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.hp <= 0) return;
  const lotus = actor.statuses.find(status => status.statusId === emperorOfHeavenIds.lotus);
  if (!lotus || skillRankFromOwner(context, lotus, emperorOfHeavenIds.lotusSkill) < 4) return;
  const owner = lotus.source.unitId ? context.getUnit(lotus.source.unitId) : undefined;
  if (!owner || owner.hp <= 0 || !passivesEnabled(owner)) return;
  return [{ type: 'change-resource', source: emperorSource(emperorOfHeavenIds.lotusSkill, owner.unitId),
    side: owner.side, resourceId: 'fire', amount: 1, parentEventId: event.eventId }];
}

function onUnitDefeated(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  if (!defeated) return;
  if (defeated.heroId === emperorOfHeavenIds.hero) return [
    ...closeMirage(context, defeated, event.eventId),
    ...(refreshAllMirageAuras(context, event.eventId) ?? []),
  ];
  return refreshAllMirageAuras(context, event.eventId);
}

function refreshAllMirageAuras(context: BattleContext, parentEventId: string): EffectCommand[] | undefined {
  const emperors = [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]
    .filter(unit => unit.heroId === emperorOfHeavenIds.hero && hasStatus(unit, emperorOfHeavenIds.mirage));
  const commands = emperors.flatMap(owner => makeMirageAuras(context, owner, parentEventId));
  return commands.length ? commands : undefined;
}

function onEffectResolution(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type === 'unit-revived') return refreshAllMirageAuras(context, event.eventId);
  if (event.type === 'status-added' && event.instance.statusId === emperorOfHeavenIds.monsterLotus) return;
  if (event.type === 'status-added' && event.instance.statusId === emperorOfHeavenIds.lotus) {
    const ownerId = String(event.instance.values?.ownerUnitId ?? event.instance.source.unitId ?? '');
    const owner = context.getUnit(ownerId), target = context.getUnit(event.targetId);
    if (!owner || !target || owner.hp <= 0) return;
    const alreadyProtected = owner.statuses.some(status => status.statusId === emperorOfHeavenIds.lotusGuard
      && String(status.values?.targetUnitId) === target.unitId);
    if (alreadyProtected) return;
    return [addStatus(owner, emperorOfHeavenIds.lotusGuard, emperorSource(emperorOfHeavenIds.lotusSkill, owner.unitId),
      { kind: 'permanent' }, undefined, { targetUnitId: target.unitId }, event.eventId)];
  }
  if (event.type === 'status-removed' && event.statusId === emperorOfHeavenIds.lotus) return onLotusRemoved(context, event);
  if (event.type === 'control-blocked' && event.targetId) {
    const emperor = context.getUnit(event.targetId);
    if (!emperor || emperor.heroId !== emperorOfHeavenIds.hero || event.protectionStatusId !== emperorOfHeavenIds.lotusGuard) return;
    const guard = emperor.statuses.find(status => status.statusId === emperorOfHeavenIds.lotusGuard);
    const targetId = String(guard?.values?.targetUnitId ?? '');
    const target = targetId ? context.getUnit(targetId) : undefined;
    const lotus = target?.statuses.find(status => status.statusId === emperorOfHeavenIds.lotus
      && status.source.unitId === emperor.unitId);
    if (!target || !lotus || lotus.duration.kind !== 'count') return;
    if (lotus.duration.remaining <= 1) return [{ type: 'remove-status-instances',
      source: emperorSource(emperorOfHeavenIds.lotusSkill, emperor.unitId), targetId: target.unitId,
      instanceIds: [lotus.instanceId], reason: 'expired', parentEventId: event.eventId }];
    return [{ type: 'add-status', source: emperorSource(emperorOfHeavenIds.lotusSkill, emperor.unitId),
      targetId: target.unitId, parentEventId: event.eventId,
      instance: { ...lotus, duration: { ...lotus.duration, remaining: lotus.duration.remaining - 1 } } }];
  }
  if (event.type === 'damage' && event.fatalProtectionStatusId === emperorOfHeavenIds.lotusGuard) {
    const emperor = event.targetId ? context.getUnit(event.targetId) : undefined;
    if (!emperor || emperor.heroId !== emperorOfHeavenIds.hero || emperor.hp <= 0) return;
    const target = Object.values(context.state.units).find(unit => unit.side !== emperor.side
      && unit.statuses.some(status => status.statusId === emperorOfHeavenIds.lotus && status.source.unitId === emperor.unitId));
    const lotus = target?.statuses.find(status => status.statusId === emperorOfHeavenIds.lotus
      && status.source.unitId === emperor.unitId);
    if (!target || !lotus) return;
    return [{ type: 'restore-health', source: emperorSource(emperorOfHeavenIds.lotusSkill, emperor.unitId),
      targetId: emperor.unitId, amount: Math.max(0, emperor.stats.hp * .05 - emperor.hp), parentEventId: event.eventId },
    { type: 'remove-status-instances', source: emperorSource(emperorOfHeavenIds.lotusSkill, emperor.unitId),
      targetId: target.unitId, instanceIds: [lotus.instanceId], reason: 'consumed', parentEventId: event.eventId }];
  }
  if (event.type === 'damage' && !event.suppressSoulTriggers && !event.suppressSourcePassiveTriggers) {
    const target = context.getUnit(event.targetId);
    const status = target?.statuses.find(instance => instance.statusId === emperorOfHeavenIds.monsterLotus);
    if (!target || target.unitKind !== 'monster' || !status || event.damageKind === 'true') return;
    const ownerId = String(status.values?.ownerUnitId ?? status.source.unitId ?? '');
    const owner = context.getUnit(ownerId);
    if (!owner || owner.hp <= 0) return;
    const extraRatio = Number(status.values?.extraRatio ?? .4);
    const extraAttack = Number(status.values?.extraAttack ?? 0);
    const amount = event.amount * extraRatio + extraAttack;
    return amount > 0 ? [{ type: 'deal-damage', source: emperorSource(emperorOfHeavenIds.monsterLotus, owner.unitId),
      targetId: target.unitId, amount, damageKind: 'true', precalculated: true, parentEventId: event.eventId,
      suppressSoulTriggers: true, suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true,
      suppressSourcePassiveTriggers: true }] : undefined;
  }
  return;
}

function onLotusRemoved(context: BattleContext, event: Extract<BattleEvent, { type: 'status-removed' }>): EffectCommand[] | undefined {
  const ownerId = String(event.removedValues?.ownerUnitId ?? event.removedSource?.unitId ?? event.source.unitId ?? '');
  const owner = context.getUnit(ownerId);
  if (!owner) return;
  const commands: EffectCommand[] = [];
  const guard = owner.statuses.find(status => status.statusId === emperorOfHeavenIds.lotusGuard
    && String(status.values?.targetUnitId) === event.targetId);
  if (guard) commands.push({ type: 'remove-status-instances', source: emperorSource(emperorOfHeavenIds.lotusSkill, owner.unitId),
    targetId: owner.unitId, instanceIds: [guard.instanceId], reason: 'consumed', parentEventId: event.eventId });
  if (owner.hp <= 0 || skillRank(owner, emperorOfHeavenIds.ultimate) < 5 || !passivesEnabled(owner))
    return commands.length ? commands : undefined;
  const controls = owner.statuses.filter(status => context.getStatusCategory(status.statusId) === 'control');
  for (const control of controls) commands.push({ type: 'remove-status-instances', source: emperorSource(emperorOfHeavenIds.ultimate, owner.unitId),
    targetId: owner.unitId, instanceIds: [control.instanceId], reason: 'consumed', parentEventId: event.eventId });
  const source = emperorSource(emperorOfHeavenIds.ultimate, owner.unitId);
  commands.push(addStatus(owner, emperorOfHeavenIds.freeUltimate, source, { kind: 'count', remaining: 1, owner: 'event', event: 'action-end' }, [],
    { targetUnitId: event.targetId }, event.eventId));
  const enemies = livingEnemies(context, owner);
  if (enemies.length) commands.push({ type: 'schedule-action', source, parentEventId: event.eventId, scheduling: 'counter', freeCast: true,
    intent: { actorId: owner.unitId, skillId: emperorOfHeavenIds.ultimate, targetIds: enemies.map(enemy => enemy.unitId),
      shape: 'all-enemies', targetRelation: 'enemy', kind: 'skill' } });
  return commands;
}

function closeMirage(context: BattleContext, owner: Readonly<UnitState>, parentEventId: string): EffectCommand[] {
  const commands: EffectCommand[] = [];
  const marker = owner.statuses.find(status => status.statusId === emperorOfHeavenIds.mirage);
  if (marker) commands.push({ type: 'remove-status-instances', source: emperorSource(emperorOfHeavenIds.mirageSkill, owner.unitId),
    targetId: owner.unitId, instanceIds: [marker.instanceId], reason: 'consumed', parentEventId });
  for (const ally of [...context.getLivingUnits(owner.side), ...context.state.sides[owner.side].map(id => context.state.units[id])
    .filter((unit): unit is UnitState => Boolean(unit && unit.hp <= 0))]) {
    const aura = ally.statuses.find(status => status.statusId === emperorOfHeavenIds.mirageSpeed
      && status.source.unitId === owner.unitId);
    if (aura) commands.push({ type: 'remove-status-instances', source: emperorSource(emperorOfHeavenIds.mirageSkill, owner.unitId),
      targetId: ally.unitId, instanceIds: [aura.instanceId], reason: 'consumed', parentEventId });
  }
  return commands;
}

function makeMirageAuras(context: BattleContext, owner: Readonly<UnitState>, parentEventId: string): EffectCommand[] {
  const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')
    .filter(unit => unit.unitKind === 'shikigami' || unit.unitKind === 'onmyoji');
  const source = emperorSource(emperorOfHeavenIds.mirageSkill, owner.unitId);
  const commands: EffectCommand[] = [];
  for (const ally of [...context.getLivingUnits(owner.side), ...context.state.sides[owner.side].map(id => context.state.units[id])
    .filter((unit): unit is UnitState => Boolean(unit && unit.hp <= 0))]) {
    const aura = ally.statuses.find(status => status.statusId === emperorOfHeavenIds.mirageSpeed
      && status.source.unitId === owner.unitId);
    if (aura) commands.push({ type: 'remove-status-instances', source, targetId: ally.unitId,
      instanceIds: [aura.instanceId], reason: 'replaced', parentEventId });
    if (!enemies.length) continue;
    commands.push(addStatus(ally, emperorOfHeavenIds.mirageSpeed, source, { kind: 'permanent' },
      [{ stat: 'speed', operation: 'percent', amount: -.03, perStack: true }], { enemyCount: enemies.length }, parentEventId,
      enemies.length));
  }
  return commands;
}

function createLotusControlledBasic(): SkillDefinition {
  return { id: emperorOfHeavenIds.controlledBasic, actionKind: 'basic', target: 'single', targetRelation: 'ally', levels: [{ ratio: 1 }],
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || actor.side !== target.side || actor.unitId === target.unitId) return [];
      const source = emperorSource(emperorOfHeavenIds.basic, actor.unitId);
      const attackStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
      const result = context.calculateDamage({ attack: attackStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: 1, critChance: attackStats.crit, critDamage: attackStats.critDamage }, actor, target);
      return [{ type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
        ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
        ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, attackStats.critDamage) } : {}),
        isCritical: result.isCritical }];
    } };
}

function hasStatus(unit: Readonly<UnitState>, statusId: string): boolean {
  return unit.statuses.some(status => status.statusId === statusId);
}

function damage(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number, suppressTargets = false): EffectCommand {
  const offense = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: offense.crit, critDamage: offense.critDamage }, owner, target);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, offense.critDamage) } : {}),
    isCritical: result.isCritical, ...(suppressTargets ? { suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true } : {}) };
}

function addStatus(target: Readonly<UnitState>, statusId: string, source: SourceRef, duration: StatusInstance['duration'],
  modifiers?: StatusInstance['modifiers'], values?: StatusInstance['values'], parentEventId?: string, stacks = 1): EffectCommand {
  return { type: 'add-status', source, targetId: target.unitId, ...(parentEventId ? { parentEventId } : {}),
    instance: { instanceId: `${statusId}:${source.unitId}:${target.unitId}`, statusId, source, stacks, duration,
      ...(modifiers ? { modifiers } : {}), ...(values ? { values } : {}) } };
}

function hasStatusFrom(unit: Readonly<UnitState>, statusId: string, sourceUnitId: string): boolean {
  return unit.statuses.some(status => status.statusId === statusId && status.source.unitId === sourceUnitId);
}
function livingEnemies(context: BattleContext, owner: Readonly<UnitState>): UnitState[] {
  return [...context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue')] as UnitState[];
}
function emperorSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function emperorIntent(actorId: string, skillId: string, targetIds: string[], shape: ActionIntent['shape'], targetRelation: 'enemy' | 'ally') {
  return { actorId, skillId, targetIds, shape, targetRelation };
}
function skillRank(owner: Readonly<UnitState>, skillId: string): number {
  const rank = owner.skillLevels?.[skillId];
  return Number.isFinite(rank) ? Math.max(1, Math.min(5, Math.floor(rank!))) : Math.max(1, Math.min(5, owner.skillLevel));
}
function skillRankFromOwner(context: BattleContext, status: StatusInstance, skillId: string): number {
  const owner = status.source.unitId ? context.getUnit(status.source.unitId) : undefined;
  return owner ? skillRank(owner, skillId) : 1;
}
const lotusLevels = [1, 2, 3, 4, 5].map(rank => ({ duration: rank >= 5 ? 2 : 1, rank }));
