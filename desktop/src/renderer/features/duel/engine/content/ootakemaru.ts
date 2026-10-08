import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const ootakemaruIds = {
  hero: 333,
  basic: '3331',
  shelter: '3332',
  ultimate: '3333',
  evolvedBasic: '3334',
  shelterStatus: 'status.hero.333.force-of-earth',
  banishStatus: 'status.hero.333.banish',
  prisonStatus: 'status.hero.333.prison',
  bonusStatus: 'status.hero.333.prison-bonus',
  assistStatus: 'status.hero.333.guaranteed-assists',
  rockBonusStatus: 'status.hero.333.rock-bonus',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const waveRatios = [2.85, 2.99, 3.12, 3.12, 3.12] as const;
const shelterReductions = [.2, .25, .3, .35, .4] as const;

export function registerOotakemaru(registry: ContentRegistry): void {
  registry.registerStatus({ id: ootakemaruIds.shelterStatus, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: ootakemaruIds.banishStatus, mechanicsCoverage: 'partial', category: 'control',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: ootakemaruIds.prisonStatus, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: ootakemaruIds.bonusStatus, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: ootakemaruIds.assistStatus, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: ootakemaruIds.rockBonusStatus, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createOotakemaruDefinition());
}

function createOotakemaruDefinition(): HeroDefinition {
  const basic = createBasic(ootakemaruIds.basic, false);
  const evolvedBasic = createBasic(ootakemaruIds.evolvedBasic, true);
  const shelterSkill: SkillDefinition = { id: ootakemaruIds.shelter, actionKind: 'passive', target: 'self',
    targetRelation: 'ally', levels: [{ level: 1 }], execute: () => [] };
  const ultimate: SkillDefinition = { id: ootakemaruIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: false,
    levels: waveRatios.map(ratio => ({ waveRatio: ratio, rockRatio: 3.58, gauge: 40, rockBonusRatio: .12 })),
    canUse(state, actor) {
      if (!isOotakemaru(actor)) return false;
      return !state.sides[actor.side].some(id => state.units[id]?.statuses.some(status => status.statusId === ootakemaruIds.prisonStatus));
    },
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0 || target.side === owner.side || isBanished(target)) return [];
      return openPrison(context, owner, target, Number(parameters.waveRatio ?? 2.85), skillLevel(owner, ootakemaruIds.ultimate));
    },
  };
  return {
    id: ootakemaruIds.hero,
    skills: [basic, shelterSkill, ultimate, evolvedBasic],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入麓鸣·轰/麓鸣·斩倍率、覆土之力20%至40%减伤与受击次数、无尽剑狱耗火/放逐/属性掠取上限/全体石浪/落石/行动条和麓鸣·斩伤害储存上限、队友普攻协战与三次必定协战。放逐免疫状态作用范围、特殊单敌/控制免疫时大招分支、覆土之力每次伤害封顶及盾刷新时点、插队和御魂交互需要真实战斗帧校准；大岳丸不在10点场阵容中。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || !isOotakemaru(owner) || !passivesEnabled(owner)) return [];
      const instance = shelterCommand(owner, skillLevel(owner, ootakemaruIds.shelter), 'opening');
      return [{ type: 'add-status', source: instance.source, targetId: owner.unitId, instance }];
    },
    modifyIncomingDamage(_attacker, target, amount) {
      const shield = target.statuses.find(status => status.statusId === ootakemaruIds.shelterStatus);
      const reduction = shield && Number(shield.values?.reduction);
      return reduction ? amount * (1 - reduction) : amount;
    },
    handlers: {
      hit: { priority: 42, handle(context, event) { return onHit(context, event); } },
      'turn-start': { priority: 42, handle(context, event) { return onOwnerTurnStart(context, event); } },
      'turn-end': { priority: 42, handle(context, event) { return settlePrison(context, event); } },
      'attack-end': { priority: 42, handle(context, event) { return handleBasicAftermath(context, event); } },
      'unit-defeated': { priority: 42, handle(context, event) { return releaseOnDefeat(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemyUnits = context.state.sides[opposingSide(actor.side)].map(id => context.getUnit(id)).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
      const enemies = context.getLivingUnits(opposingSide(actor.side));
      if (!enemyUnits.length) return undefined;
      const selected = enemies[0] ?? enemyUnits.find(isBanished);
      if (!selected) return undefined;
      if (actor.statuses.some(status => status.statusId === ootakemaruIds.prisonStatus))
        return intent(actor.unitId, ootakemaruIds.evolvedBasic, selected.unitId);
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) return intent(actor.unitId, ootakemaruIds.ultimate, selected.unitId);
      return intent(actor.unitId, ootakemaruIds.basic, selected.unitId);
    },
  };
}

function createBasic(id: string, evolved: boolean): SkillDefinition {
  return { id, actionKind: 'basic', target: 'single', targetRelation: 'enemy', useClientDamageData: false,
    levels: basicRatios.map(ratio => ({ ratio })),
    canUse(state, actor) { return isOotakemaru(actor) && (evolved
      ? state.sides[opposingSide(actor.side)].some(unitId => state.units[unitId]?.statuses.some(status => status.statusId === ootakemaruIds.banishStatus
        && status.source.unitId === actor.unitId))
      : !state.sides[opposingSide(actor.side)].some(unitId => state.units[unitId]?.statuses.some(status => status.statusId === ootakemaruIds.banishStatus
        && status.source.unitId === actor.unitId))); },
    execute(context, action, parameters) {
      const actor = context.getUnit(action.actorId);
      const target = context.getUnit(action.targetIds[0] ?? '');
      if (!actor || !target || target.hp <= 0 || isBanished(target)) return [];
      const rank = skillLevel(actor, ootakemaruIds.basic);
      const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
      const ratio = Number(parameters.ratio ?? basicRatios[rank - 1]);
      const source = ootakemaruSource(id, actor.unitId);
      const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
        ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical,
        ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, attack.critDamage) } : {}),
        ...(evolved ? { suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true } : {}) }];
      return commands;
    },
  };
}

function openPrison(context: BattleContext, owner: Readonly<UnitState>, target: Readonly<UnitState>, waveRatio: number, rank: number): EffectCommand[] {
  const source = ootakemaruSource(ootakemaruIds.ultimate, owner.unitId);
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const targetAttack = target.stats.attack * .3;
  const targetDefense = target.stats.defense * .3;
  const bonusAttack = Math.min(targetAttack, owner.stats.attack * .5);
  const bonusDefense = Math.min(targetDefense, owner.stats.defense * .5);
  const banish: StatusInstance = { instanceId: `${ootakemaruIds.banishStatus}:${owner.unitId}:${target.unitId}`,
    statusId: ootakemaruIds.banishStatus, source, stacks: 1, duration: { kind: 'permanent' }, values: { banished: true } };
  const prison: StatusInstance = { instanceId: `${ootakemaruIds.prisonStatus}:${owner.unitId}`,
    statusId: ootakemaruIds.prisonStatus, source, stacks: 1, duration: { kind: 'permanent' }, values: { targetId: target.unitId, armed: false } };
  const bonus: StatusInstance = { instanceId: `${ootakemaruIds.bonusStatus}:${owner.unitId}`,
    statusId: ootakemaruIds.bonusStatus, source, stacks: 1, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'attack', operation: 'flat', amount: bonusAttack }, { stat: 'defense', operation: 'flat', amount: bonusDefense }] };
  const guaranteed: StatusInstance = { instanceId: `${ootakemaruIds.assistStatus}:${owner.unitId}`,
    statusId: ootakemaruIds.assistStatus, source, stacks: 3, duration: { kind: 'permanent' }, values: { remaining: 3 } };
  const commands: EffectCommand[] = [
    { type: 'add-status', source, targetId: target.unitId, instance: banish },
    { type: 'add-status', source, targetId: owner.unitId, instance: prison },
    { type: 'add-status', source, targetId: owner.unitId, instance: bonus },
    { type: 'add-status', source, targetId: owner.unitId, instance: guaranteed },
  ];
  const enemies = context.getLivingUnits(opposingSide(owner.side)).filter(enemy => enemy.unitId !== target.unitId);
  let waveDamageTotal = 0;
  const waveHits = enemies.map(enemy => {
    const stats = context.getEffectiveStats(enemy.unitId) ?? enemy.stats;
    const hit = context.calculateDamage({ attack: attack.attack + bonusAttack, defense: stats.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio: waveRatio, critChance: attack.crit, critDamage: attack.critDamage }, owner, enemy);
    waveDamageTotal += hit.amount;
    return { enemy, hit };
  });
  if (rank >= 5 && waveDamageTotal > 0) commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: {
    instanceId: `${ootakemaruIds.rockBonusStatus}:${owner.unitId}`, statusId: ootakemaruIds.rockBonusStatus,
    source, stacks: 1, duration: { kind: 'permanent' }, values: { amount: Math.min(waveDamageTotal * .12, owner.stats.attack * 6) },
  } });
  for (const { enemy, hit } of waveHits) {
    commands.push({ type: 'deal-damage', source, targetId: enemy.unitId, amount: hit.amount,
      ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
      ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attack.critDamage) } : {}) });
  }
  return commands;
}

function onOwnerTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const owner = context.getUnit(event.unitId);
  if (!owner || !isOotakemaru(owner)) return;
  const commands: EffectCommand[] = [];
  const shelter = owner.statuses.find(status => status.statusId === ootakemaruIds.shelterStatus
    && (status.values?.marker === 'opening' || status.values?.marker === 'turn-end'));
  if (shelter) commands.push({ type: 'remove-status-instances', source: shelter.source, targetId: owner.unitId,
    instanceIds: [shelter.instanceId], reason: 'expired', parentEventId: event.eventId });
  const prison = owner?.statuses.find(status => status.statusId === ootakemaruIds.prisonStatus);
  if (prison && prison.values?.armed !== true) commands.push({ type: 'add-status', source: prison.source,
    targetId: owner.unitId, instance: { ...prison, values: { ...prison.values, armed: true } }, parentEventId: event.eventId });
  return commands.length ? commands : undefined;
}

function settlePrison(context: BattleContext, event: BattleEvent, forced = false): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  const prison = owner?.statuses.find(status => status.statusId === ootakemaruIds.prisonStatus);
  if (!owner || !isOotakemaru(owner)) return;
  if (!prison) return passivesEnabled(owner) ? [{ type: 'add-status', source: ootakemaruSource(ootakemaruIds.shelter, owner.unitId),
    targetId: owner.unitId, instance: shelterCommand(owner, skillLevel(owner, ootakemaruIds.shelter), 'turn-end'), parentEventId: event.eventId }] : undefined;
  if (!forced && prison.values?.armed !== true) {
    return [{ type: 'add-status', source: prison.source, targetId: owner.unitId, instance: shelterCommand(owner,
      skillLevel(owner, ootakemaruIds.shelter), 'turn-end') }];
  }
  const targetId = typeof prison.values?.targetId === 'string' ? prison.values.targetId : '';
  const target = context.getUnit(targetId);
  const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
  const targetStats = target && (context.getEffectiveStats(targetId) ?? target.stats);
  const rank = skillLevel(owner, ootakemaruIds.ultimate);
  const rockRatio = 3.58;
  const stored = Number(owner.statuses.find(status => status.statusId === ootakemaruIds.rockBonusStatus)?.values?.amount ?? 0);
  const commands: EffectCommand[] = [{ type: 'remove-status-instances', source: prison.source, targetId: owner.unitId,
    instanceIds: [prison.instanceId], reason: 'expired', parentEventId: event.eventId },
  { type: 'remove-statuses', source: prison.source, targetId: owner.unitId, statusIds: [ootakemaruIds.bonusStatus], reason: 'expired', parentEventId: event.eventId },
  { type: 'remove-statuses', source: prison.source, targetId: owner.unitId, statusIds: [ootakemaruIds.assistStatus], reason: 'expired', parentEventId: event.eventId },
  { type: 'remove-statuses', source: prison.source, targetId: owner.unitId, statusIds: [ootakemaruIds.rockBonusStatus], reason: 'expired', parentEventId: event.eventId }];
  if (target && target.hp > 0 && isBanished(target)) {
    const exile = target.statuses.find(status => status.statusId === ootakemaruIds.banishStatus && status.source.unitId === owner.unitId);
    if (exile) commands.unshift({ type: 'remove-status-instances', source: exile.source, targetId, instanceIds: [exile.instanceId],
      reason: 'expired', parentEventId: event.eventId });
    if (targetStats) {
      const hit = context.calculateDamage({ attack: attack.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(owner), ratio: rockRatio, critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
      commands.push({ type: 'deal-damage', source: prison.source, targetId, amount: hit.amount + stored,
        ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
        ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, attack.critDamage) + stored / Math.max(1, attack.critDamage) } : {}),
        cannotBeShared: true, suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true, parentEventId: event.eventId });
    }
  }
  commands.push({ type: 'change-action-gauge', source: prison.source, targetId: owner.unitId,
    amount: rank >= 4 ? 70 : 40, parentEventId: event.eventId });
  if (passivesEnabled(owner)) commands.push({ type: 'add-status', source: prison.source, targetId: owner.unitId,
    instance: shelterCommand(owner, skillLevel(owner, ootakemaruIds.shelter), 'turn-end'), parentEventId: event.eventId });
  return commands;
}

function handleBasicAftermath(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const commands: EffectCommand[] = [];
  if (event.actionKind !== 'basic') return commands.length ? commands : undefined;
  for (const owner of context.getLivingUnits(actor.side).filter(unit => isOotakemaru(unit) && unit.unitId !== actor.unitId
    && passivesEnabled(unit))) {
    const exileActive = owner.statuses.some(status => status.statusId === ootakemaruIds.prisonStatus);
    if (!exileActive) continue;
    const guaranteed = owner.statuses.find(status => status.statusId === ootakemaruIds.assistStatus);
    const forced = Number(guaranteed?.values?.remaining ?? 0) > 0;
    if (!forced && context.random() >= .5) continue;
    const targetId = event.selectedTargetIds?.find(id => context.getUnit(id)?.hp! > 0 && !isBanished(context.getUnit(id)));
    const target = targetId ? context.getUnit(targetId) : undefined;
    if (!target) continue;
    const rank = skillLevel(owner, ootakemaruIds.basic);
    const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio: basicRatios[rank - 1] ?? 1,
      critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
    commands.push({ type: 'schedule-attack', source: ootakemaruSource(ootakemaruIds.evolvedBasic, owner.unitId),
      intent: { actorId: owner.unitId, skillId: ootakemaruIds.evolvedBasic, targetIds: [target.unitId], shape: 'single',
        targetRelation: 'enemy', kind: 'passive' }, scheduling: 'assist', suppressTargetSoulTriggers: true,
      suppressTargetPassiveTriggers: true, suppressSourcePassiveTriggers: true,
      hits: [{ targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
        isCritical: hit.isCritical }], parentEventId: event.eventId });
    if (forced && guaranteed) {
      if (Number(guaranteed.values?.remaining ?? 1) <= 1) commands.push({ type: 'remove-status-instances', source: guaranteed.source,
        targetId: owner.unitId, instanceIds: [guaranteed.instanceId], reason: 'consumed', parentEventId: event.eventId });
      else commands.push({ type: 'add-status', source: guaranteed.source, targetId: owner.unitId,
        instance: { ...guaranteed, stacks: guaranteed.stacks - 1, values: { remaining: Number(guaranteed.values?.remaining ?? 1) - 1 } },
        parentEventId: event.eventId });
    }
  }
  return commands.length ? commands : undefined;
}

function onHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const commands = [...(trackShelterHits(context, event) ?? [])];
  if (event.type === 'damage' && event.source.id === ootakemaruIds.evolvedBasic && event.source.unitId) {
    const owner = context.getUnit(event.source.unitId);
    const rock = owner?.statuses.find(status => status.statusId === ootakemaruIds.rockBonusStatus);
    if (owner && rock && event.amount > 0) commands.push({ type: 'add-status', source: rock.source, targetId: owner.unitId,
      instance: { ...rock, values: { amount: Math.min(Number(rock.values?.amount ?? 0) + event.amount, owner.stats.attack * 6) } },
      parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function trackShelterHits(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage') return;
  const target = context.getUnit(event.targetId);
  const shelter = target?.statuses.find(status => status.statusId === ootakemaruIds.shelterStatus);
  if (!target || !shelter) return;
  const lastAttackId = Number(shelter.values?.lastAttackId ?? -1);
  if (event.attackId !== undefined && event.attackId === lastAttackId) return;
  const hitsRemaining = Number(shelter.values?.hitsRemaining ?? 2) - 1;
  if (hitsRemaining <= 0) return [{ type: 'remove-status-instances', source: shelter.source, targetId: target.unitId,
    instanceIds: [shelter.instanceId], reason: 'consumed', parentEventId: event.eventId }];
  return [{ type: 'add-status', source: shelter.source, targetId: target.unitId, instance: { ...shelter,
    values: { ...shelter.values, hitsRemaining, lastAttackId: event.attackId ?? -1 } }, parentEventId: event.eventId }];
}

function releaseOnDefeat(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  if (!defeated) return;
  if (isOotakemaru(defeated)) {
    const prison = defeated.statuses.find(status => status.statusId === ootakemaruIds.prisonStatus);
    const targetId = typeof prison?.values?.targetId === 'string' ? prison.values.targetId : undefined;
    const target = targetId ? context.getUnit(targetId) : undefined;
    const exile = target?.statuses.find(status => status.statusId === ootakemaruIds.banishStatus && status.source.unitId === defeated.unitId);
    const source = prison?.source ?? ootakemaruSource(ootakemaruIds.ultimate, defeated.unitId);
    return [
      ...(exile && target ? [{ type: 'remove-status-instances' as const, source, targetId: target.unitId,
        instanceIds: [exile.instanceId], reason: 'expired' as const, parentEventId: event.eventId }] : []),
      { type: 'remove-statuses', source, targetId: defeated.unitId,
        statusIds: [ootakemaruIds.prisonStatus, ootakemaruIds.bonusStatus, ootakemaruIds.assistStatus, ootakemaruIds.rockBonusStatus],
        reason: 'expired', parentEventId: event.eventId },
    ];
  }
  if (context.getLivingUnits(defeated.side).length > 0) return;
  const owners = context.getLivingUnits(opposingSide(defeated.side)).filter(unit => isOotakemaru(unit)
    && unit.statuses.some(status => status.statusId === ootakemaruIds.prisonStatus));
  return owners.flatMap(owner => settlePrison(context, { eventId: `${event.eventId}-prison`, phase: 'turn-end',
    source: ootakemaruSource(ootakemaruIds.ultimate, owner.unitId), parentEventId: event.eventId,
    actionId: event.actionId, type: 'turn-ended', unitId: owner.unitId }, true) ?? []);
}

function shelterCommand(owner: Readonly<UnitState>, rank: number, marker: string): StatusInstance {
  const source = ootakemaruSource(ootakemaruIds.shelter, owner.unitId);
  return { instanceId: `${ootakemaruIds.shelterStatus}:${owner.unitId}`, statusId: ootakemaruIds.shelterStatus,
    source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { reduction: shelterReductions[rank - 1] ?? .2, hitsRemaining: rank >= 3 ? 3 : 2, lastAttackId: -1, marker } };
}

function intent(actorId: string, skillId: string, targetId: string): ActionIntent {
  return { actorId, skillId, targetIds: [targetId], shape: 'single', targetRelation: 'enemy' };
}
function isOotakemaru(unit: Readonly<UnitState>): boolean { return unit.heroId === ootakemaruIds.hero && unit.unitKind !== 'summon'; }
function isBanished(unit: Readonly<UnitState> | undefined): boolean { return Boolean(unit?.statuses.some(status => status.values?.banished === true)); }
function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function opposingSide(side: UnitState['side']): UnitState['side'] { return side === 'blue' ? 'red' : 'blue'; }
function ootakemaruSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
