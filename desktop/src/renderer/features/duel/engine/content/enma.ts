import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passiveSuppressionStatusId, passivesEnabled } from '../core/passive-eligibility';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const enmaIds = {
  hero: 255,
  basic: '2551',
  passive: '2552',
  ultimate: '2553',
  impAttack: '25520',
  silence: 'status.hero.255.silence',
  blackImp: 'status.hero.255.black-imp',
  blockedRevive: 'status.hero.255.imp-occupancy',
  passiveBuff: 'status.hero.255.demon-contrast',
  impPresence: 'status.hero.255.enemy-imp-present',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [2.11, 2.22, 2.33, 2.44, 2.55] as const;

export function registerEnma(registry: ContentRegistry): void {
  registry.registerStatus({ id: enmaIds.silence, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsSkill: true });
  registry.registerStatus({ id: enmaIds.blackImp, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsAction: true });
  registry.registerStatus({ id: enmaIds.blockedRevive, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', preventsRevive: true });
  registry.registerStatus({ id: enmaIds.passiveBuff, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerStatus({ id: enmaIds.impPresence, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep' });
  registry.registerHero(createEnmaDefinition());
}

export function createEnmaDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(enmaIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: enmaIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, silenceChance: 1, silenceTurns: 2, blackImpChance: .5 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = intent.targetIds.map(id => context.getUnit(id)).find((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
      if (!owner || !target) return [];
      const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
      const damage = context.calculateDamage({ attack: attack.attack, defense,
        defenseIgnore: effectiveDefenseIgnore(owner), ratio: Number(parameters.ratio ?? 2.11),
        critChance: attack.crit, critDamage: attack.critDamage }, owner, target);
      return [{ type: 'deal-damage', source: enmaSource(enmaIds.ultimate, owner.unitId), targetId: target.unitId,
        amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
    },
  };
  const impAttack: SkillDefinition = {
    id: enmaIds.impAttack, actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy', levels: [{ ratio: 1 }],
    canUse(_state, actor) { return actor.heroId === enmaIds.hero && actor.unitKind === 'summon' && actor.displayName === '白色小鬼'; },
    execute(context, intent) {
      const imp = context.getUnit(intent.actorId);
      if (!imp || imp.unitKind !== 'summon') return [];
      const source = enmaSource(enmaIds.impAttack, imp.unitId);
      const commands: EffectCommand[] = context.getLivingUnits(imp.side === 'blue' ? 'red' : 'blue').map(target => {
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        const hit = context.calculateDamage({ attack: imp.stats.attack, defense, ratio: 1,
          critChance: 0, critDamage: 1.5 }, imp, target);
        return { type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
          ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: false,
          suppressTargetSoulTriggers: true, suppressTargetPassiveTriggers: true };
      });
      commands.push({ type: 'lose-life', source, targetId: imp.unitId, amount: imp.hp, lifeLossKind: 'direct' });
      return commands;
    },
  };
  return {
    id: enmaIds.hero, skills: [basic, ultimate, impAttack], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端表接入鬼面倍率、怨魂重压3火/等级倍率/两回合沉默、夺魂的阵亡位白色小鬼（10%生命/50%攻击、下次行动全体攻击后牺牲并阻止原单位复活）、50%黑色小鬼变形及小鬼存在时的50%减伤/否则50%增伤；召唤阵位、控制抵抗边界、条件增伤结算顺序与实际帧仍需核验'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || owner.unitKind !== 'shikigami' || !passivesEnabled(owner)) return [];
      const source = enmaSource(enmaIds.passive, owner.unitId);
      return [{ type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${enmaIds.passiveBuff}:${owner.unitId}`,
        statusId: enmaIds.passiveBuff, source, stacks: 1, duration: { kind: 'permanent' } } }];
    },
    modifyOutgoingDamage(attacker, _target, amount, _kind, state) {
      if (attacker.heroId !== enmaIds.hero || attacker.unitKind !== 'shikigami' || !passivesEnabled(attacker)) return amount;
      return enemyHasImp(state, attacker) ? amount : amount * 1.5;
    },
    modifyIncomingDamage(attacker, target, amount, _kind) {
      if (target.heroId !== enmaIds.hero || target.unitKind !== 'shikigami' || !passivesEnabled(target)) return amount;
      return target.statuses.some(status => status.statusId === enmaIds.impPresence) ? amount * .5 : amount;
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      if (actor.unitKind === 'summon' && actor.displayName === '白色小鬼') {
        const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
        return enemies.length ? enmaIntent(actor, enmaIds.impAttack, enemies.map(unit => unit.unitId), 'all-enemies') : undefined;
      }
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      const skillId = (context.state.resources[actor.side]?.fire ?? 0) >= 3 ? enmaIds.ultimate : enmaIds.basic;
      return enmaIntent(actor, skillId, [target.unitId], 'single');
    },
    handlers: {
      hit: { priority: 33, handle(context, event) { return onEnmaHit(context, event); } },
      'effect-resolution': { priority: 33, handle(_context, event) {
        if (event.type !== 'status-added' || event.instance.statusId !== enmaIds.blackImp || !event.source.unitId) return;
        const source = enmaSource(enmaIds.passive, event.source.unitId);
        return [{ type: 'add-status', source, targetId: event.targetId, parentEventId: event.eventId,
          instance: { instanceId: `${passiveSuppressionStatusId}:${event.targetId}:${event.eventId}`,
            statusId: passiveSuppressionStatusId, source, stacks: 1,
            duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }];
      } },
      'unit-defeated': { priority: 33, handle(context, event) { return onUnitDefeated(context, event); } },
    },
  };
}

function onEnmaHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== enmaIds.ultimate || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== enmaIds.hero || !passivesEnabled(owner) || !target || target.hp <= 0) return;
  const source = enmaSource(enmaIds.ultimate, owner.unitId);
  const silence = attemptControl(context, { attemptId: `${enmaIds.silence}:${event.eventId}`,
    source, targetId: target.unitId, statusId: enmaIds.silence, controlType: '沉默', baseChance: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, parentEventId: event.eventId });
  const commands: EffectCommand[] = silence ? [silence] : [];
  const transform = attemptControl(context, { attemptId: `${enmaIds.blackImp}:${event.eventId}`,
    source, targetId: target.unitId, statusId: enmaIds.blackImp, controlType: '变形', baseChance: .5,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
  if (transform) commands.push(transform);
  return commands;
}

function onUnitDefeated(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  if (!defeated) return;
  if (defeated.unitKind === 'summon' && defeated.displayName === '白色小鬼') {
    const occupancy = defeated.statuses.find(status => status.statusId === enmaIds.blockedRevive);
    const originalId = String(occupancy?.values?.occupiedUnitId ?? '');
    const original = originalId ? context.getUnit(originalId) : undefined;
    const commands: EffectCommand[] = [];
    const originalOccupancy = original?.statuses.find(status => status.statusId === enmaIds.blockedRevive
      && status.values?.summonId === defeated.unitId);
    if (original && originalOccupancy) commands.push({ type: 'remove-status-instances', source: enmaSource(enmaIds.passive,
      defeated.summonedByUnitId ?? 'system'), targetId: original.unitId, instanceIds: [originalOccupancy.instanceId],
      reason: 'consumed', parentEventId: event.eventId });
    if (!hasImpOnSide(defeated.side, context.state)) {
      for (const enma of context.getLivingUnits(defeated.side === 'blue' ? 'red' : 'blue')
        .filter(unit => unit.heroId === enmaIds.hero && unit.unitKind === 'shikigami')) {
        const presence = enma.statuses.find(status => status.statusId === enmaIds.impPresence);
        if (presence) commands.push({ type: 'remove-status-instances', source: presence.source, targetId: enma.unitId,
          instanceIds: [presence.instanceId], reason: 'consumed', parentEventId: event.eventId });
      }
    }
    return commands;
  }
  if (defeated.unitKind === 'summon') return;
  const owners = context.getLivingUnits(defeated.side === 'blue' ? 'red' : 'blue')
    .filter(unit => unit.heroId === enmaIds.hero && unit.unitKind === 'shikigami' && passivesEnabled(unit));
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    if (context.state.sides[defeated.side].some(id => context.getUnit(id)?.statuses.some(status =>
      status.statusId === enmaIds.blockedRevive && status.values?.occupiedUnitId === defeated.unitId))) continue;
    const unitId = `${enmaIds.hero}-imp-${context.state.counters.action}-${event.unitId}`;
    const hp = Math.max(1, owner.stats.hp * .1), attack = owner.stats.attack * .5;
    const source = enmaSource(enmaIds.passive, owner.unitId);
    const occupancy: StatusInstance = { instanceId: `${enmaIds.blockedRevive}:${defeated.unitId}:${unitId}`,
      statusId: enmaIds.blockedRevive, source, stacks: 1, duration: { kind: 'permanent' },
      values: { occupiedUnitId: defeated.unitId, summonId: unitId, ownerUnitId: owner.unitId } };
    const summon: UnitState = { unitId, heroId: enmaIds.hero, displayName: '白色小鬼', unitKind: 'summon',
      summonedByUnitId: owner.unitId, skillLevel: 1, side: owner.side,
      stats: { ...owner.stats, hp, attack, speed: owner.stats.speed }, hp, shield: 0, actionGauge: 0,
      statuses: [{ ...occupancy, instanceId: `${enmaIds.blockedRevive}:${unitId}` }], resources: {} };
    commands.push({ type: 'add-status', source, targetId: defeated.unitId, instance: occupancy, parentEventId: event.eventId });
    commands.push({ type: 'summon-unit', source, unit: summon, parentEventId: event.eventId });
    for (const enemyEnma of context.getLivingUnits(defeated.side)
      .filter(unit => unit.heroId === enmaIds.hero && unit.unitKind === 'shikigami')) {
      if (enemyEnma.statuses.some(status => status.statusId === enmaIds.impPresence)) continue;
      commands.push({ type: 'add-status', source: enmaSource(enmaIds.passive, enemyEnma.unitId), targetId: enemyEnma.unitId,
        parentEventId: event.eventId, instance: { instanceId: `${enmaIds.impPresence}:${enemyEnma.unitId}`,
          statusId: enmaIds.impPresence, source: enmaSource(enmaIds.passive, enemyEnma.unitId), stacks: 1,
          duration: { kind: 'permanent' } } });
    }
  }
  return commands;
}

function enemyHasImp(state: BattleContext['state'], enma: Readonly<UnitState>): boolean {
  return hasImpOnSide(enma.side === 'blue' ? 'red' : 'blue', state);
}

function hasImpOnSide(side: UnitState['side'], state: BattleContext['state']): boolean {
  const units = state.sides[side].map(id => state.units[id]);
  return units.some(unit => unit?.hp > 0 && unit.unitKind === 'summon' && unit.displayName?.includes('小鬼'));
}

function enmaIntent(actor: Readonly<UnitState>, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape']): ActionIntent {
  return { actorId: actor.unitId, skillId, targetIds, shape, targetRelation: shape === 'self' ? 'ally' : 'enemy' };
}

function enmaSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }

