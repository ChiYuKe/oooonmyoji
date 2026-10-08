import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { ContentRegistry } from './registry';

export const cangfengIds = { hero: 327, basic: '3271', guard: '3272', ultimate: '3273', windShield: 'status.hero.327.wind-shield',
  passiveCooldown: 'status.hero.327.guard-cooldown', shieldReduction: 'status.hero.327.shield-reduction' } as const;

const basicRatios = [.8, .85, .9, .95, 1] as const;
const guardShieldRatios = [1.88, 2.17, 2.17, 2.17, 2.17] as const;
const ultimateRatios = [1.58, 1.66, 1.74, 1.74, 1.74] as const;
const guardThresholds = [.3, .3, .4, .4, .4] as const;
const guardCooldowns = [3, 3, 2, 3, 2] as const;

export function registerCangfengOneEyed(registry: ContentRegistry): void {
  const windShieldStatus: StatusDefinition = { id: cangfengIds.windShield, mechanicsCoverage: 'partial', category: 'shield',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' };
  const cooldownStatus: StatusDefinition = { id: cangfengIds.passiveCooldown, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' };
  const shieldReductionStatus: StatusDefinition = { id: cangfengIds.shieldReduction, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' };
  registry.registerStatus(windShieldStatus); registry.registerStatus(cooldownStatus); registry.registerStatus(shieldReductionStatus);

  const basic: SkillDefinition = { id: cangfengIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || !target || !validEnemy(actor, target)) return [];
      const shielded = hasWindShield(actor);
      const allyTarget = shielded ? lowestUnshieldedAlly(context, actor) : actor;
      return [...attack(context, actor, target, basic.id, Number(parameters.ratio ?? basicRatios[rank(actor, basic.id) - 1]!)),
        ...(allyTarget ? [windShieldCommand(actor, allyTarget, (context.getEffectiveStats(actor.unitId) ?? actor.stats).attack * .6, basic.id)] : [])];
    } };

  const guard: SkillDefinition = { id: cangfengIds.guard, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'ally', levels: guardShieldRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== cangfengIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side !== actor.side) return [];
      const ratio = Number(parameters.ratio ?? guardShieldRatios[rank(actor, guard.id) - 1]!);
      const attackPower = (context.getEffectiveStats(actor.unitId) ?? actor.stats).attack;
      const secondary = lowestUnshieldedAlly(context, actor, target.unitId);
      return [windShieldCommand(actor, target, attackPower * ratio, guard.id),
        ...(secondary ? [windShieldCommand(actor, secondary, attackPower * ratio, guard.id)] : [])];
    } };

  const ultimate: SkillDefinition = { id: cangfengIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId); if (!actor || actor.heroId !== cangfengIds.hero || actor.hp <= 0) return [];
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return [];
      const rankLevel = rank(actor, ultimate.id), ratio = Number(parameters.ratio ?? ultimateRatios[rankLevel - 1]!);
      const allies = context.getLivingUnits(actor.side);
      const shields = allies.flatMap(ally => ally.statuses.filter(status => status.statusId === cangfengIds.windShield)
        .map(status => ({ ally, status })));
      const commands: EffectCommand[] = enemies.flatMap(enemy => attack(context, actor, enemy, ultimate.id, ratio));
      const repeatCounts = new Map<string, number>();
      for (const _shield of shields) {
        const target = randomUnit(context, enemies);
        const repeats = repeatCounts.get(target.unitId) ?? 0;
        repeatCounts.set(target.unitId, repeats + 1);
        commands.push(...attack(context, actor, target, ultimate.id, ratio * Math.pow(.8, repeats)));
      }
      return commands;
    } };

  const definition: HeroDefinition = { id: cangfengIds.hero, skills: [basic, guard, ultimate], mechanicsCoverage: 'partial', aiCoverage: 'partial',
    mechanicsCoverageNotes: ['风符·灭80%至100%伤害，首盾给自身、已有盾时给生命比例最低且无风盾友方，盾量为自身攻击60%、3回合。风符·守耗2火，对指定友方及另一无盾友方提供自身攻击188%/217%风盾；行动结束被动在自身可行动且友方低于30%/40%时补盾，冷却3/2次行动；每个友方风盾提供5%减伤、最多30%。四级起友方获得盾时自身获得其盾量50%的风盾。风止·苍龙坠耗3火、158%/166%/174%群伤，每个友方风盾追加一次随机攻击且同目标递减20%；四级按剩余盾量治疗35%，五级重置3回合并将低于初始72%的风盾补到72%。五级暴击溢出转化为风盾减伤与暴伤增益。唯一效果、御魂交互、暴击溢出以战斗面板初始暴击解释及冷却窗口仍需帧核；10点场阵容不含该式神。'],
    handlers: {
      'action-end': { priority: 74, handle(context, event) {
        return [...(resolveGuardPassive(context, event) ?? []), ...(finishCangfengUltimate(context, event) ?? [])];
      } },
      'effect-resolution': { priority: 74, handle(context, event) { return resolveShieldEffects(context, event); } },
    },
    modifyCriticalDamage(attacker, _target, amount, criticalBaseAmount) {
      if (!attacker || attacker.heroId !== cangfengIds.hero || rank(attacker, cangfengIds.guard) < 5 || !passivesEnabled(attacker)) return amount;
      return amount + criticalBaseAmount * Math.max(0, attacker.stats.crit - 1) * 2;
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.heroId !== cangfengIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return;
      const allies = context.getLivingUnits(actor.side), enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const unshielded = lowestUnshieldedAlly(context, actor);
      if (fire >= 3 && allies.some(hasAvailableWindShield)) return { actorId: unitId, skillId: ultimate.id,
        targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' };
      if (fire >= 2 && unshielded) return { actorId: unitId, skillId: guard.id, targetIds: [unshielded.unitId],
        shape: 'single', targetRelation: 'ally' };
      const target = [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function resolveGuardPassive(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.actionId) return;
  const commands: EffectCommand[] = [];
  for (const owner of [...context.getLivingUnits('blue'), ...context.getLivingUnits('red')]) {
    if (owner.heroId !== cangfengIds.hero) continue;
    const cooldown = owner.statuses.find(status => status.statusId === cangfengIds.passiveCooldown);
    if (cooldown) {
      const remaining = Number(cooldown.values?.remaining ?? 1) - 1;
      if (remaining <= 0) commands.push({ type: 'remove-status-instances', source: cooldown.source, targetId: owner.unitId,
        instanceIds: [cooldown.instanceId], reason: 'consumed', parentEventId: event.eventId });
      else commands.push({ type: 'add-status', source: cooldown.source, targetId: owner.unitId,
        instance: { ...cooldown, values: { ...cooldown.values, remaining } }, parentEventId: event.eventId });
      continue;
    }
    if (context.isUnitUnableToAct(owner.unitId) || !passivesEnabled(owner)) continue;
    const threshold = guardThresholds[rank(owner, cangfengIds.guard) - 1]!;
    const target = context.getLivingUnits(owner.side).filter(ally => !hasWindShield(ally)
      && ally.hp / Math.max(1, (context.getEffectiveStats(ally.unitId) ?? ally.stats).hp) < threshold)
      .sort((left, right) => left.hp / Math.max(1, (context.getEffectiveStats(left.unitId) ?? left.stats).hp)
        - right.hp / Math.max(1, (context.getEffectiveStats(right.unitId) ?? right.stats).hp))[0];
    if (!target) continue;
    const attackPower = (context.getEffectiveStats(owner.unitId) ?? owner.stats).attack;
    commands.push(windShieldCommand(owner, target, attackPower * guardShieldRatios[rank(owner, cangfengIds.guard) - 1]!,
      cangfengIds.guard, event.eventId));
    const cooldownTurns = guardCooldowns[rank(owner, cangfengIds.guard) - 1]!;
    commands.push({ type: 'add-status', source: cangfengSource(cangfengIds.guard, owner.unitId), targetId: owner.unitId,
      instance: { instanceId: `${cangfengIds.passiveCooldown}:${owner.unitId}`, statusId: cangfengIds.passiveCooldown,
        source: cangfengSource(cangfengIds.guard, owner.unitId), stacks: 1, duration: { kind: 'permanent' },
        values: { remaining: cooldownTurns } }, parentEventId: event.eventId });
  }
  return commands.length ? commands : undefined;
}

function finishCangfengUltimate(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.skillId !== cangfengIds.ultimate || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor || actor.heroId !== cangfengIds.hero || actor.hp <= 0) return;
  const level = rank(actor, cangfengIds.ultimate);
  if (level < 4) return;
  const commands: EffectCommand[] = [];
  const shields = context.getLivingUnits(actor.side).flatMap(ally => ally.statuses.filter(status => status.statusId === cangfengIds.windShield)
    .map(status => ({ ally, status })));
  const source = cangfengSource(cangfengIds.ultimate, actor.unitId);
  for (const { ally, status } of shields) {
    const remaining = Math.max(0, Number(status.values?.shieldRemaining ?? 0));
    if (remaining > 0) commands.push({ type: 'heal', source, targetId: ally.unitId, amount: remaining * .35, parentEventId: event.eventId });
    if (level >= 5) {
      const initialAmount = Math.max(0, Number(status.values?.initialAmount ?? remaining));
      const ownTurnExpiresNow = ally.unitId === actor.unitId;
      commands.push({ type: 'add-status', source, targetId: ally.unitId, parentEventId: event.eventId,
        instance: { ...status, duration: { kind: 'count', remaining: ownTurnExpiresNow ? 4 : 3, owner: 'target-turn' },
          values: { ...status.values, initialAmount, shieldRemaining: Math.max(remaining, initialAmount * .72) } } });
    }
  }
  return commands.length ? commands : undefined;
}

function resolveShieldEffects(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const commands = event.type === 'status-added' ? shareWindShield(context, event) : [];
  const affectedSide = event.type === 'status-added' || event.type === 'status-removed' || event.type === 'damage'
    ? context.getUnit(event.targetId)?.side : undefined;
  if (affectedSide) commands.push(...refreshShieldReduction(context, affectedSide, event.eventId));
  return commands.length ? commands : undefined;
}

function shareWindShield(context: BattleContext, event: Extract<BattleEvent, { type: 'status-added' }>): EffectCommand[] {
  if (event.source.id === cangfengIds.ultimate) return [];
  const recipient = context.getUnit(event.targetId);
  if (!recipient || recipient.hp <= 0) return [];
  const recipientShield = Number(event.instance.values?.shieldRemaining ?? 0);
  if (recipientShield <= 0) return [];
  const commands: EffectCommand[] = [];
  for (const owner of context.getLivingUnits(recipient.side)) {
    if (owner.heroId !== cangfengIds.hero || owner.unitId === recipient.unitId || rank(owner, cangfengIds.guard) < 4
      || !passivesEnabled(owner)) continue;
    commands.push(windShieldCommand(owner, owner, recipientShield * .5, cangfengIds.guard, event.eventId));
  }
  return commands;
}

function refreshShieldReduction(context: BattleContext, side: 'blue' | 'red', parentEventId: string): EffectCommand[] {
  const allies = context.getLivingUnits(side);
  const count = allies.filter(hasAvailableShield).length;
  const source = { kind: 'skill' as const, id: cangfengIds.guard };
  const commands: EffectCommand[] = [];
  for (const owner of allies.filter(unit => unit.heroId === cangfengIds.hero)) {
    const current = owner.statuses.find(status => status.statusId === cangfengIds.shieldReduction);
    const baseReduction = passivesEnabled(owner) ? Math.min(.3, count * .05) : 0;
    const overflowReduction = passivesEnabled(owner) && rank(owner, cangfengIds.guard) >= 5 && hasAvailableWindShield(owner)
      ? Math.min(.4, Math.max(0, owner.stats.crit - 1) * 2) : 0;
    const reduction = Math.min(.7, baseReduction + overflowReduction);
    const existing = Number(current?.values?.reduction ?? 0);
    if (Math.abs(existing - reduction) < .000001) continue;
    if (reduction <= 0) {
      if (current) commands.push({ type: 'remove-status-instances', source: current.source, targetId: owner.unitId,
        instanceIds: [current.instanceId], reason: 'consumed', parentEventId });
      continue;
    }
    commands.push({ type: 'add-status', source: { ...source, unitId: owner.unitId }, targetId: owner.unitId,
      parentEventId, instance: { instanceId: `${cangfengIds.shieldReduction}:${owner.unitId}`, statusId: cangfengIds.shieldReduction,
        source: { ...source, unitId: owner.unitId }, stacks: 1, duration: { kind: 'permanent' }, values: { reduction },
        modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: -reduction }] } });
  }
  return commands;
}

function windShieldCommand(owner: Readonly<UnitState>, target: Readonly<UnitState>, amount: number, skillId: string,
  parentEventId?: string): EffectCommand {
  const source = cangfengSource(skillId, owner.unitId);
  const instanceId = `${cangfengIds.windShield}:${owner.unitId}:${target.unitId}`;
  return { type: 'add-status', source, targetId: target.unitId, instance: { instanceId, statusId: cangfengIds.windShield,
    source, stacks: 1, duration: { kind: 'count', remaining: 3, owner: 'target-turn' },
    values: { shieldRemaining: Math.max(0, amount), initialAmount: Math.max(0, amount) } },
    ...(parentEventId ? { parentEventId } : {}) };
}

function lowestUnshieldedAlly(context: BattleContext, owner: Readonly<UnitState>, excludeId?: string): Readonly<UnitState> | undefined {
  return context.getLivingUnits(owner.side).filter(ally => ally.unitId !== excludeId && !hasAvailableWindShield(ally))
    .sort((left, right) => left.hp / Math.max(1, (context.getEffectiveStats(left.unitId) ?? left.stats).hp)
      - right.hp / Math.max(1, (context.getEffectiveStats(right.unitId) ?? right.stats).hp))[0];
}
function hasWindShield(unit: Readonly<UnitState>): boolean { return unit.statuses.some(status => status.statusId === cangfengIds.windShield); }
function hasAvailableWindShield(unit: Readonly<UnitState>): boolean { return unit.statuses.some(status => status.statusId === cangfengIds.windShield
  && Number(status.values?.shieldRemaining ?? 0) > 0); }
function hasAvailableShield(unit: Readonly<UnitState>): boolean { return unit.shield > 0 || unit.statuses.some(status =>
  typeof status.values?.shieldRemaining === 'number' && status.values.shieldRemaining > 0); }
function validEnemy(actor: Readonly<UnitState> | undefined, target: Readonly<UnitState> | undefined): actor is Readonly<UnitState> {
  return Boolean(actor && actor.heroId === cangfengIds.hero && actor.hp > 0 && target && target.hp > 0 && target.side !== actor.side);
}
function attack(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, skillId: string, ratio: number): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, dmgFluctuation: .01,
    critChance: offense.crit, critDamage: offense.critDamage }, actor as UnitState, target as UnitState);
  return [{ type: 'deal-damage', source: cangfengSource(skillId, actor.unitId), targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}
function randomUnit(context: BattleContext, units: readonly Readonly<UnitState>[]): Readonly<UnitState> {
  return units[Math.min(units.length - 1, Math.floor(context.random() * units.length))]!;
}
function rank(unit: Readonly<UnitState>, skillId: string): number { return Math.max(1, Math.min(5, unit.skillLevels?.[skillId] ?? unit.skillLevel)); }
function cangfengSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
