import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const kujiraIds = {
  hero: 332,
  basic: '3321',
  attackBasic: '3324',
  passive: '3322',
  defensiveStance: '3323',
  offensiveStance: '3326',
  assist: '3325',
  boneShield: 'status.hero.332.bone-shield',
  stance: 'status.hero.332.stance',
  defensiveAura: 'status.hero.332.defensive-aura',
  offensiveAura: 'status.hero.332.offensive-aura',
  stanceShield: 'status.hero.332.stance-shield',
  counterWindow: 'status.hero.332.counter-window',
} as const;

const basicRatios = [.8, .85, .9, .95, 1] as const;
const offensiveRatios = [.8, .85, .9, .95, 1] as const;

export function registerKujira(registry: ContentRegistry): void {
  registry.registerStatus({ id: kujiraIds.boneShield, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: kujiraIds.stance, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: kujiraIds.defensiveAura, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: kujiraIds.offensiveAura, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: kujiraIds.stanceShield, mechanicsCoverage: 'partial', category: 'shield', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: kujiraIds.counterWindow, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerHero(createKujiraDefinition());
}

export function createKujiraDefinition(): HeroDefinition {
  const basic = createBasic(kujiraIds.basic, basicRatios, false);
  const attackBasic = createBasic(kujiraIds.attackBasic, offensiveRatios, true);
  const passive: SkillDefinition = { id: kujiraIds.passive, actionKind: 'skill', target: 'self', targetRelation: 'ally',
    levels: [{ level: 1 }], execute: () => [] };
  const defensiveStance: SkillDefinition = {
    id: kujiraIds.defensiveStance, actionKind: 'skill', target: 'self', targetRelation: 'ally',
    resourceCostsByLevel: [3, 3, 0, 0, 0].map(amount => ({ resourceId: 'fire', amount })),
    levels: [1, 2, 3, 4, 5].map(level => ({ level })),
    canUse(_state, actor) { return isKujira(actor) && !hasStatus(actor, kujiraIds.stance, 'offense'); },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      return actor ? enterOffense(context, actor, skillLevel(actor, kujiraIds.defensiveStance)) : [];
    },
  };
  const offensiveStance: SkillDefinition = {
    id: kujiraIds.offensiveStance, actionKind: 'skill', target: 'self', targetRelation: 'ally',
    resourceCost: { resourceId: 'fire', amount: 3 }, levels: [1, 2, 3, 4, 5].map(level => ({ level })),
    canUse(_state, actor) { return isKujira(actor) && hasStatus(actor, kujiraIds.stance, 'offense'); },
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      return actor ? enterDefense(context, actor, skillLevel(actor, kujiraIds.offensiveStance)) : [];
    },
  };
  return {
    id: kujiraIds.hero,
    skills: [basic, passive, defensiveStance, attackBasic, offensiveStance],
    aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入鲸骨·驻全体骨盾及满盾时追加生命上限真实伤害、骨盾暴击伤害减免/受暴击移除、守备姿态光环与回合末骨盾/治疗、姿态切换推条/速度增益/不可驱散护盾、每回合一次守备反击和进攻协战。骨盾持续时间的回合结算顺序、传导伤害排除、反击/协战插队触发以及五级双重暴击仍需连续帧核对；久次良不在10点场阵容内。'],
    initialize(context, unitId) {
      const owner = context.getUnit(unitId);
      if (!owner || !isKujira(owner) || !isUniqueKujira(context, owner)) return [];
      return enterDefense(context, owner, skillLevel(owner, kujiraIds.defensiveStance), false);
    },
    beforeCalculateDamage(input, _attacker, target) {
      if (!hasStatus(target, kujiraIds.boneShield) || !Number.isFinite(input.critDamage)) return input;
      return { ...input, critDamage: 1 + Math.max(0, input.critDamage - 1) * .6 };
    },
    handlers: {
      hit: { priority: 38, handle(context, event) { return onDamage(context, event); } },
      'turn-start': { priority: 37, handle(context, event) { return resetCounterWindow(context, event); } },
      'turn-end': { priority: 38, handle(context, event) { return defensiveTurnEnd(context, event); } },
      'attack-end': { priority: 38, handle(context, event) { return assistOnAllyBasic(context, event); } },
      'unit-defeated': { priority: 38, handle(context, event) { return clearKujiraAuras(context, event); } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const target = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue').slice()
        .sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0];
      if (!target) return undefined;
      const rank = skillLevel(actor, kujiraIds.defensiveStance);
      if (!hasStatus(actor, kujiraIds.stance, 'offense')
        && (context.state.resources[actor.side]?.fire ?? 0) >= (rank >= 3 ? 0 : 3))
        return { actorId: unitId, skillId: kujiraIds.defensiveStance, targetIds: [unitId], shape: 'self', targetRelation: 'ally' };
      return { actorId: unitId, skillId: hasStatus(actor, kujiraIds.stance, 'offense') ? kujiraIds.attackBasic : kujiraIds.basic,
        targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function createBasic(id: string, ratios: readonly number[], offense: boolean): SkillDefinition {
  return { id, actionKind: 'basic', target: 'single', targetRelation: 'enemy', useClientDamageData: false,
    levels: ratios.map(ratio => ({ ratio })),
    canUse(_state, actor) { return isKujira(actor) && hasStatus(actor, kujiraIds.stance, offense ? 'offense' : 'defense'); },
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      const attack = actor && (context.getEffectiveStats(actor.unitId) ?? actor.stats);
      const defense = target && (context.getEffectiveStats(target.unitId) ?? target.stats);
      if (!actor || !target || !attack || !defense || target.hp <= 0) return [];
      const rank = skillLevel(actor, offense ? kujiraIds.basic : kujiraIds.basic);
      const ratio = Number(parameters.ratio ?? ratios[0]);
      const source = kujiraSource(id, actor.unitId);
      const commands: EffectCommand[] = [];
      let fullBoneShield = false;
      if (!offense && hasStatus(actor, kujiraIds.stance, 'defense') && intent.kind !== 'passive') {
        const allies = context.getLivingUnits(actor.side);
        fullBoneShield = allies.length > 0 && allies.every(ally => hasStatus(ally, kujiraIds.boneShield));
        for (const ally of allies) commands.push(boneShieldCommand(actor, ally, 'basic'));
      }
      const result = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio,
        critChance: attack.crit,
        critDamage: offense && rank >= 5 ? attack.critDamage * attack.critDamage : attack.critDamage }, actor, target);
      commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
        ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical,
        ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, offense && rank >= 5
          ? attack.critDamage * attack.critDamage : attack.critDamage) } : {}) });
      if (fullBoneShield) commands.push({ type: 'deal-damage', source, targetId: target.unitId,
        amount: Math.min(target.stats.hp * .1, attack.attack * 1.2), damageKind: 'true', isCritical: false });
      return commands;
    } };
}

function enterOffense(context: BattleContext, owner: Readonly<UnitState>, rank: number): EffectCommand[] {
  const source = kujiraSource(kujiraIds.defensiveStance, owner.unitId);
  const allies = context.getLivingUnits(owner.side);
  const commands: EffectCommand[] = [{ type: 'remove-statuses', source, targetId: owner.unitId,
    statusIds: [kujiraIds.stance, kujiraIds.defensiveAura], reason: 'replaced' },
  { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${kujiraIds.stance}:${owner.unitId}`,
    statusId: kujiraIds.stance, source, stacks: 1, duration: { kind: 'permanent' }, values: { mode: 'offense' } } }];
  for (const ally of allies) {
    commands.push({ type: 'remove-statuses', source, targetId: ally.unitId, statusIds: [kujiraIds.defensiveAura], reason: 'replaced' });
    commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: { instanceId: `${kujiraIds.offensiveAura}:${owner.unitId}:${ally.unitId}`,
      statusId: kujiraIds.offensiveAura, source, stacks: 1, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'speed', operation: 'flat', amount: rank >= 3 ? 30 : 20 },
        ...(rank >= 2 ? [{ stat: 'critDamage' as const, operation: 'percent' as const, amount: rank >= 5 ? .3 : .15 }] : [])] } });
    commands.push({ type: 'change-action-gauge', source, targetId: ally.unitId, amount: rank >= 4 ? 30 : 15 });
  }
  if (rank >= 5) commands.push({ type: 'change-action-gauge', source, targetId: owner.unitId, amount: 30 });
  return commands;
}

function enterDefense(context: BattleContext, owner: Readonly<UnitState>, rank: number, grantShield = true): EffectCommand[] {
  const source = kujiraSource(kujiraIds.offensiveStance, owner.unitId);
  const allies = context.getLivingUnits(owner.side);
  const attack = (context.getEffectiveStats(owner.unitId) ?? owner.stats).attack;
  const commands: EffectCommand[] = [{ type: 'remove-statuses', source, targetId: owner.unitId,
    statusIds: [kujiraIds.stance, kujiraIds.offensiveAura], reason: 'replaced' },
  { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${kujiraIds.stance}:${owner.unitId}`,
    statusId: kujiraIds.stance, source, stacks: 1, duration: { kind: 'permanent' }, values: { mode: 'defense' } } }];
  for (const ally of allies) {
    commands.push({ type: 'remove-statuses', source, targetId: ally.unitId, statusIds: [kujiraIds.offensiveAura], reason: 'replaced' });
    commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: { instanceId: `${kujiraIds.defensiveAura}:${owner.unitId}:${ally.unitId}`,
      statusId: kujiraIds.defensiveAura, source, stacks: 1, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'defense', operation: 'percent', amount: rank >= 2 ? .2 : .1 },
        { stat: 'resist', operation: 'percent', amount: rank >= 3 ? .2 : .1 }] } });
    if (grantShield) commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: { instanceId: `${kujiraIds.stanceShield}:${owner.unitId}:${ally.unitId}`,
      statusId: kujiraIds.stanceShield, source, stacks: 1,
      duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      values: { shieldRemaining: Math.min(ally.stats.hp, attack * (skillLevel(owner, kujiraIds.offensiveStance) >= 4 ? 1.08 : .94)) } } });
  }
  return commands;
}

function defensiveTurnEnd(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const ally = context.getUnit(event.unitId);
  if (!ally || ally.hp <= 0) return;
  const owners = context.getLivingUnits(ally.side).filter(owner => isKujira(owner) && passivesEnabled(owner)
    && hasStatus(owner, kujiraIds.stance, 'defense') && isUniqueKujira(context, owner));
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    const existing = hasStatus(ally, kujiraIds.boneShield);
    if (!existing && context.random() < .8) commands.push(boneShieldCommand(owner, ally, 'defense-turn-end'));
    else if (existing) {
      const missing = Math.max(0, ally.stats.hp - ally.hp);
      const attack = (context.getEffectiveStats(owner.unitId) ?? owner.stats).attack;
      const amount = Math.min(missing * .15, attack * 1.2);
      if (amount > 0) commands.push({ type: 'heal', source: kujiraSource(kujiraIds.defensiveStance, owner.unitId),
        targetId: ally.unitId, amount, parentEventId: event.eventId });
    }
  }
  return commands.length ? commands : undefined;
}

function consumeBoneShield(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.isCritical) return;
  const target = context.getUnit(event.targetId);
  const mark = target?.statuses.find(status => status.statusId === kujiraIds.boneShield);
  if (!target || !mark) return;
  return [{ type: 'remove-status-instances', source: mark.source, targetId: target.unitId,
    instanceIds: [mark.instanceId], reason: 'consumed', parentEventId: event.eventId }];
}

function onDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const commands = [...(consumeBoneShield(context, event) ?? []), ...(counterWhenAllyHit(context, event) ?? [])];
  return commands.length ? commands : undefined;
}

function counterWhenAllyHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.hpLost <= 0 || !event.source.unitId) return;
  const victim = context.getUnit(event.targetId);
  const enemy = context.getUnit(event.source.unitId);
  if (!victim || !enemy || victim.side === enemy.side || hasStatus(victim, kujiraIds.boneShield)) return;
  const owners = context.getLivingUnits(victim.side).filter(owner => isKujira(owner) && passivesEnabled(owner)
    && hasStatus(owner, kujiraIds.stance, 'defense') && isUniqueKujira(context, owner));
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    const previous = owner.statuses.find(status => status.statusId === kujiraIds.counterWindow);
    if (previous) continue;
    const source = kujiraSource(kujiraIds.passive, owner.unitId);
    commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId,
      instance: { instanceId: `${kujiraIds.counterWindow}:${owner.unitId}`, statusId: kujiraIds.counterWindow,
        source, stacks: 1, duration: { kind: 'permanent' } } });
    commands.push(boneShieldCommand(owner, victim, 'passive-hit'));
    if (context.random() >= .5) continue;
    const rank = skillLevel(owner, kujiraIds.basic);
    const ownerStats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
    const enemyStats = context.getEffectiveStats(enemy.unitId) ?? enemy.stats;
    const damage = context.calculateDamage({ attack: ownerStats.attack, defense: enemyStats.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio: basicRatios[rank - 1] ?? .8,
      critChance: ownerStats.crit, critDamage: ownerStats.critDamage }, owner, enemy);
    commands.push({ type: 'schedule-attack', source, parentEventId: event.eventId, scheduling: 'counter',
      intent: { actorId: owner.unitId, skillId: kujiraIds.basic, targetIds: [enemy.unitId], shape: 'single',
        targetRelation: 'enemy', kind: 'passive' }, suppressSourcePassiveTriggers: true,
      hits: [{ targetId: enemy.unitId, amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}),
        isCritical: damage.isCritical, suppressSourcePassiveTriggers: true }] });
  }
  return commands.length ? commands : undefined;
}

function assistOnAllyBasic(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'attack-ended' || event.actionKind !== 'basic' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return;
  const targetId = event.selectedTargetIds?.find(id => context.getUnit(id)?.hp! > 0);
  const target = targetId ? context.getUnit(targetId) : undefined;
  if (!target) return;
  const owners = context.getLivingUnits(actor.side).filter(owner => isKujira(owner) && owner.unitId !== actor.unitId
    && passivesEnabled(owner) && hasStatus(owner, kujiraIds.stance, 'offense') && isUniqueKujira(context, owner));
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    if (context.random() >= .3) continue;
    const rank = skillLevel(owner, kujiraIds.attackBasic);
    const attack = context.getEffectiveStats(owner.unitId) ?? owner.stats;
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const ratio = offensiveRatios[rank - 1] ?? .8;
    const damage = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: attack.crit,
      critDamage: rank >= 5 ? attack.critDamage * attack.critDamage : attack.critDamage }, owner, target);
    commands.push({ type: 'schedule-attack', source: kujiraSource(kujiraIds.assist, owner.unitId),
      intent: { actorId: owner.unitId, skillId: kujiraIds.attackBasic, targetIds: [target.unitId], shape: 'single',
        targetRelation: 'enemy', kind: 'passive' }, scheduling: 'assist', suppressSourcePassiveTriggers: true,
      hits: [{ targetId: target.unitId, amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}),
        isCritical: damage.isCritical, suppressSourcePassiveTriggers: true }], parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function clearKujiraAuras(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  if (!defeated || !isKujira(defeated)) return;
  const source = kujiraSource(kujiraIds.defensiveStance, defeated.unitId);
  return context.state.sides[defeated.side].flatMap(unitId => {
    const unit = context.getUnit(unitId);
    if (!unit) return [];
    const statuses = unit.statuses.filter(status => status.source.unitId === defeated.unitId
      && [kujiraIds.defensiveAura, kujiraIds.offensiveAura].includes(status.statusId as typeof kujiraIds.defensiveAura));
    return statuses.length ? [{ type: 'remove-status-instances' as const, source, targetId: unitId,
      instanceIds: statuses.map(status => status.instanceId), parentEventId: event.eventId }] : [];
  });
}

function resetCounterWindow(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  return context.getLivingUnits('blue').concat(context.getLivingUnits('red')).flatMap(unit => {
    const marker = unit.statuses.find(status => status.statusId === kujiraIds.counterWindow);
    return marker ? [{ type: 'remove-status-instances' as const, source: marker.source, targetId: unit.unitId,
      instanceIds: [marker.instanceId], reason: 'expired', parentEventId: event.eventId }] : [];
  });
}

function boneShieldCommand(owner: Readonly<UnitState>, ally: Readonly<UnitState>, marker: string): EffectCommand {
  const source = kujiraSource(kujiraIds.passive, owner.unitId);
  return { type: 'add-status', source, targetId: ally.unitId, instance: {
    instanceId: `${kujiraIds.boneShield}:${owner.unitId}:${ally.unitId}`, statusId: kujiraIds.boneShield,
    source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { marker },
  } };
}

function hasStatus(unit: Readonly<UnitState>, statusId: string, mode?: 'defense' | 'offense'): boolean {
  const status = unit.statuses.find(item => item.statusId === statusId);
  return Boolean(status && (mode === undefined || status.values?.mode === mode));
}
function isKujira(unit: Readonly<UnitState>): boolean { return unit.heroId === kujiraIds.hero && unit.unitKind !== 'summon'; }
function skillLevel(unit: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel));
}
function isUniqueKujira(context: BattleContext, owner: Readonly<UnitState>): boolean {
  return context.getLivingUnits(owner.side).find(unit => isKujira(unit))?.unitId === owner.unitId;
}
function kujiraSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
