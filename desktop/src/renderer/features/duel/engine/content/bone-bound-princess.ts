import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { calculateIndirectDamage } from '../mechanics/indirect-damage';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const boneBoundPrincessIds = {
  hero: 352, basic: '3521', passive: '3522', venomSkill: '3523', serpentBasic: '3524', returnedSkill: '3526',
  mark: 'status.hero.352.bone-mark', poison: 'status.hero.352.poison', defenseDown: 'status.hero.352.bone-fracture',
  woundHeal: 'status.hero.352.wound-heal-block', woundTurn: 'status.hero.352.wound-action-block',
  woundLife: 'status.hero.352.wound-life-limit', serpentDamage: 'status.hero.352.serpent-venom',
  serpentGuard: 'status.hero.352.serpent-guard', summonedThisRound: 'status.hero.352.summoned-this-round',
} as const;

const basicRatios = [.7, .8, .9, 1, 1] as const;
const venomRatios = [.7, .85, .85, 1, 1] as const;

export function registerBoneBoundPrincess(registry: ContentRegistry): void {
  const status = (id: string, fields: Omit<Parameters<ContentRegistry['registerStatus']>[0], 'id'>) =>
    registry.registerStatus({ id, mechanicsCoverage: 'partial', ...fields });
  status(boneBoundPrincessIds.mark, { category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'permanent', refreshPolicy: 'replace' });
  status(boneBoundPrincessIds.poison, { category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  status(boneBoundPrincessIds.defenseDown, { category: 'debuff', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 10 });
  status(boneBoundPrincessIds.woundHeal, { category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 3, blocksNextHealing: true });
  status(boneBoundPrincessIds.woundTurn, { category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 3,
    blocksNextHealing: true, blocksNextActionAdvance: true });
  status(boneBoundPrincessIds.woundLife, { category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 3,
    blocksNextHealing: true, blocksNextActionAdvance: true });
  status(boneBoundPrincessIds.serpentDamage, { category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  status(boneBoundPrincessIds.serpentGuard, { category: 'buff', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'replace' });
  status(boneBoundPrincessIds.summonedThisRound, { category: 'other', dispellable: false, sealable: false,
    durationOwner: 'round', refreshPolicy: 'replace' });
  registry.registerHero(createBoneBoundPrincessDefinition());
}

export function createBoneBoundPrincessDefinition(): HeroDefinition {
  const basic: SkillDefinition = { id: boneBoundPrincessIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })), execute(context, intent, params) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !target || target.hp <= 0) return [];
      const sourceRef = source(boneBoundPrincessIds.basic, owner.unitId);
      const commands: EffectCommand[] = [makeHit(context, owner, target, sourceRef, Number(params.ratio ?? .7))];
      commands.push(...attemptDebuff(context, { source: sourceRef, targetId: target.unitId, statusId: boneBoundPrincessIds.poison,
        baseChance: 1, duration: { kind: 'count', remaining: 5, owner: 'target-turn' },
        modifiers: [{ stat: 'speed', operation: 'percent', amount: -.1 },
          { stat: 'defense', operation: 'flat', amount: skillRank(owner, boneBoundPrincessIds.basic) >= 5 ? -50 : -30 }] }));
      const fracture = target.statuses.find(status => status.statusId === boneBoundPrincessIds.defenseDown
        && status.source.unitId === owner.unitId);
      commands.push({ type: 'add-status', source: sourceRef, targetId: target.unitId, instance: {
        instanceId: `${boneBoundPrincessIds.defenseDown}:${owner.unitId}:${target.unitId}`,
        statusId: boneBoundPrincessIds.defenseDown, source: sourceRef,
        stacks: Math.min(10, (fracture?.stacks ?? 0) + 1), duration: { kind: 'permanent' },
        modifiers: [{ stat: 'defense', operation: 'flat', amount: skillRank(owner, boneBoundPrincessIds.basic) >= 5 ? -50 : -20,
          perStack: true }],
      } });
      return commands;
    } };

  const summon: SkillDefinition = { id: boneBoundPrincessIds.passive, target: 'single', targetRelation: 'enemy',
    levels: [{}, {}, { immediateStrike: true }, { guard: .4 }, { guard: .4, markedTurnStrike: true }], execute(context, intent, params) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !target || target.hp <= 0 || target.unitKind === 'summon') return [];
      if (owner.statuses.some(status => status.statusId === boneBoundPrincessIds.summonedThisRound)
        || findSerpent(context, owner.unitId)) return [];
      const sourceRef = source(boneBoundPrincessIds.passive, owner.unitId);
      const summonId = `summon:bone-bound:${owner.unitId}:${context.state.counters.action + 1}`;
      const stats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const serpent: UnitState = { unitId: summonId, heroId: boneBoundPrincessIds.hero, displayName: '蛇灵', unitKind: 'summon',
        summonedByUnitId: owner.unitId, skillLevel: owner.skillLevel, ...(owner.skillLevels ? { skillLevels: owner.skillLevels } : {}),
        side: owner.side, stats: { ...stats, hp: Math.max(1, stats.hp * .5) }, hp: Math.max(1, stats.hp * .5), shield: 0,
        actionGauge: 0, statuses: [], resources: {} };
      const commands: EffectCommand[] = [...applyBoneMark(context, target, sourceRef),
      { type: 'summon-unit', source: sourceRef, unit: serpent },
      { type: 'add-status', source: sourceRef, targetId: owner.unitId, instance: {
        instanceId: `${boneBoundPrincessIds.summonedThisRound}:${owner.unitId}`, statusId: boneBoundPrincessIds.summonedThisRound,
        source: sourceRef, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'round' },
      } }];
      if (Number(params.guard ?? 0) > 0) commands.push({ type: 'add-status', source: sourceRef, targetId: owner.unitId,
        instance: { instanceId: `${boneBoundPrincessIds.serpentGuard}:${owner.unitId}`, statusId: boneBoundPrincessIds.serpentGuard,
          source: sourceRef, stacks: 1, duration: { kind: 'permanent' },
          modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: -Number(params.guard) }], values: { summonId } } });
      if (params.immediateStrike === true) commands.push({ type: 'schedule-action', source: sourceRef, scheduling: 'extra-action', freeCast: true,
        intent: serpentIntent(summonId, target.unitId), parentEventId: `${sourceRef.id}:${context.state.counters.action}` });
      return commands;
    } };

  const serpentAttack: SkillDefinition = { id: boneBoundPrincessIds.serpentBasic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [{}, { ratio: 1, push: 30, venomDuration: 5 }, { ratio: 1, push: 30, venomDuration: 5 },
      { ratio: 1, push: 30, venomDuration: 5 }, { ratio: 1, push: 30, venomDuration: 5 }], execute(context, intent, params) {
      const snake = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      const owner = snake?.summonedByUnitId ? context.getUnit(snake.summonedByUnitId) : undefined;
      if (!snake || snake.hp <= 0 || !owner || owner.hp <= 0 || !target || target.hp <= 0) return [];
      const sourceRef = source(boneBoundPrincessIds.serpentBasic, owner.unitId);
      const commands: EffectCommand[] = [makeHit(context, owner, target, sourceRef, Number(params.ratio ?? 1))];
      if (target.statuses.some(status => status.statusId === boneBoundPrincessIds.mark && status.source.unitId === owner.unitId)) {
        commands.push(...attemptDebuff(context, { source: sourceRef, targetId: target.unitId,
          statusId: boneBoundPrincessIds.serpentDamage, baseChance: .99,
          duration: { kind: 'count', remaining: Number(params.venomDuration ?? 5), owner: 'target-turn' } }));
        commands.push({ type: 'change-action-gauge', source: sourceRef, targetId: owner.unitId,
          amount: Number(params.push ?? 30), checkImmunity: true });
      }
      return commands;
    } };

  const venom: SkillDefinition = { id: boneBoundPrincessIds.venomSkill, actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 }, target: 'single', targetRelation: 'enemy',
    levels: venomRatios.map((ratio, index) => ({ ratio, woundStatus: index >= 4 ? boneBoundPrincessIds.woundLife
      : index >= 2 ? boneBoundPrincessIds.woundTurn : boneBoundPrincessIds.woundHeal,
      maxHpRatio: index >= 4 ? .07 : 0 })), execute(context, intent, params) {
      const owner = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || owner.hp <= 0 || !target || target.hp <= 0) return [];
      const sourceRef = source(boneBoundPrincessIds.venomSkill, owner.unitId);
      return Array.from({ length: 3 }, () => makeHit(context, owner, target, sourceRef, Number(params.ratio ?? .7)));
    } };

  return { id: boneBoundPrincessIds.hero, skills: [basic, summon, venom, serpentAttack], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能/状态数据接入缠心直伤、中毒减速与减防、永久破防、蚀骨标记/蛇灵召唤、蛇灵对标记目标的直接攻击/间接伤害和推条、降蛊之瞳三段伤害、治疗/推条封锁及五级生命上限削减。蛇灵属性继承、致命扑咬/等量生命上限转移与共同阵亡、重新合体的属性继承、蛇灵返回后的技能替换、治疗/推条拦截消耗时序和御魂交互仍未完整接入，需帧核。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return undefined;
      if (actor.unitKind === 'summon') {
        const ownerId = actor.summonedByUnitId;
        const marked = enemies.find(enemy => enemy.statuses.some(status => status.statusId === boneBoundPrincessIds.mark
          && status.source.unitId === ownerId));
        const target = marked ?? enemies[0]!;
        return serpentIntent(unitId, target.unitId);
      }
      const snake = findSerpent(context, actor.unitId);
      if (!snake && !actor.statuses.some(status => status.statusId === boneBoundPrincessIds.summonedThisRound))
        return { actorId: unitId, skillId: boneBoundPrincessIds.passive,
          targetIds: [enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
      const marked = enemies.find(enemy => enemy.statuses.some(status => status.statusId === boneBoundPrincessIds.mark
        && status.source.unitId === actor.unitId));
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3 && marked)
        return { actorId: unitId, skillId: boneBoundPrincessIds.venomSkill,
          targetIds: [marked.unitId], shape: 'single', targetRelation: 'enemy' };
      return { actorId: unitId, skillId: boneBoundPrincessIds.basic,
        targetIds: [marked?.unitId ?? enemies[0]!.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      'hit': { priority: 35, handle(context, event) {
        return [...(applyWoundOnHit(context, event) ?? []), ...(updateBoneMark(context, event) ?? [])];
      } },
      'effect-resolution': { priority: 35, handle(context, event) { return updateBoneMark(context, event); } },
      'turn-start': { priority: 35, handle(context, event) { return serpentVenomTick(context, event); } },
      'turn-end': { priority: 35, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const target = context.getUnit(event.unitId); if (!target) return;
        const mark = target.statuses.find(status => status.statusId === boneBoundPrincessIds.mark);
        const owner = mark?.source.unitId ? context.getUnit(mark.source.unitId) : undefined;
        const snake = owner ? findSerpent(context, owner.unitId) : undefined;
        if (!mark || !owner || !snake || !passivesEnabled(owner) || skillRank(owner, boneBoundPrincessIds.passive) < 5) return;
        return [{ type: 'schedule-action', source: source(boneBoundPrincessIds.passive, owner.unitId), scheduling: 'extra-action',
          freeCast: true, intent: serpentIntent(snake.unitId, target.unitId), parentEventId: event.eventId }];
      } },
      'unit-defeated': { priority: 35, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const defeated = context.getUnit(event.unitId);
        if (!defeated || defeated.unitKind !== 'summon' || defeated.heroId !== boneBoundPrincessIds.hero || !defeated.summonedByUnitId) return;
        const owner = context.getUnit(defeated.summonedByUnitId);
        const guard = owner?.statuses.find(status => status.statusId === boneBoundPrincessIds.serpentGuard);
        if (!owner || !guard) return;
        return [{ type: 'remove-status-instances', source: guard.source, targetId: owner.unitId,
          instanceIds: [guard.instanceId], reason: 'consumed', parentEventId: event.eventId }];
      } },
    },
  };
}

function applyBoneMark(context: BattleContext, target: Readonly<UnitState>, sourceRef: SourceRef): EffectCommand[] {
  const initialHp = target.stats.hp;
  const lostRatio = Math.max(0, (initialHp - target.hp) / Math.max(1, initialHp));
  return attemptDebuff(context, { source: sourceRef, targetId: target.unitId, statusId: boneBoundPrincessIds.mark,
    baseChance: 1, duration: { kind: 'permanent' }, values: { initialHp }, modifiers: boneMarkModifiers(lostRatio) });
}

function updateBoneMark(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (!['damage', 'life-lost', 'healing', 'health-restored', 'max-health-changed'].includes(event.type)
    || !('targetId' in event)) return;
  const target = context.getUnit(event.targetId);
  if (!target) return;
  const commands: EffectCommand[] = [];
  for (const mark of target.statuses.filter(status => status.statusId === boneBoundPrincessIds.mark)) {
    const initialHp = typeof mark.values?.initialHp === 'number' ? mark.values.initialHp : target.stats.hp;
    const lostRatio = Math.max(0, (initialHp - target.hp) / Math.max(1, initialHp));
    commands.push({ type: 'add-status', source: mark.source, targetId: target.unitId, parentEventId: event.eventId,
      instance: { ...mark, modifiers: boneMarkModifiers(lostRatio) } });
  }
  return commands.length ? commands : undefined;
}

function boneMarkModifiers(lostRatio: number): NonNullable<StatusInstance['modifiers']> {
  return [
    { stat: 'attack', operation: 'percent', amount: -Math.min(1, .3 + lostRatio * .5) },
    { stat: 'damageTaken', operation: 'percent', amount: lostRatio },
  ];
}

function applyWoundOnHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== boneBoundPrincessIds.venomSkill || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== boneBoundPrincessIds.hero || !target) return;
  const rank = skillRank(owner, boneBoundPrincessIds.venomSkill);
  const statusId = rank >= 5 ? boneBoundPrincessIds.woundLife : rank >= 3
    ? boneBoundPrincessIds.woundTurn : boneBoundPrincessIds.woundHeal;
  const sourceRef = source(boneBoundPrincessIds.venomSkill, owner.unitId);
  const commands: EffectCommand[] = [{ type: 'add-status', source: sourceRef, targetId: target.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${statusId}:${owner.unitId}:${target.unitId}`, statusId, source: sourceRef, stacks: 1,
      duration: { kind: 'count', remaining: 2, owner: 'target-turn' } } }];
  if (rank >= 5) {
    const maximumHp = target.stats.hp;
    const amount = target.unitKind === 'monster' ? Math.min(maximumHp * .07, owner.stats.attack * 12) : maximumHp * .07;
    commands.push({ type: 'reduce-max-health', source: sourceRef, targetId: target.unitId,
      amount, minimumRatio: .2, statusId: boneBoundPrincessIds.woundLife, parentEventId: event.eventId });
  }
  return commands;
}

function serpentVenomTick(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const target = context.getUnit(event.unitId); if (!target || target.hp <= 0) return;
  const commands: EffectCommand[] = [];
  for (const status of target.statuses.filter(item => item.statusId === boneBoundPrincessIds.serpentDamage)) {
    const owner = status.source.unitId ? context.getUnit(status.source.unitId) : undefined;
    if (!owner || owner.hp <= 0) continue;
    const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const damage = calculateIndirectDamage({ attack: attack.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio: .99, critDamage: attack.critDamage }, context.random);
    commands.push({ type: 'lose-life', source: source(boneBoundPrincessIds.serpentBasic, owner.unitId),
      targetId: target.unitId, amount: damage.amount, lifeLossKind: 'indirect', parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function makeHit(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, sourceRef: SourceRef,
  ratio: number): EffectCommand {
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
  return { type: 'deal-damage', source: sourceRef, targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical };
}

function findSerpent(context: BattleContext, ownerId: string): UnitState | undefined {
  return Object.values(context.state.units).find(unit => unit.unitKind === 'summon' && unit.summonedByUnitId === ownerId
    && unit.heroId === boneBoundPrincessIds.hero && unit.hp > 0);
}
function serpentIntent(actorId: string, targetId: string): ActionIntent {
  return { actorId, skillId: boneBoundPrincessIds.serpentBasic, targetIds: [targetId], shape: 'single', targetRelation: 'enemy', kind: 'basic' };
}
function source(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function skillRank(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
