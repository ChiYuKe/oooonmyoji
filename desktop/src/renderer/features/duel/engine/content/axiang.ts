import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptControl, attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const axiangIds = {
  hero: 309,
  basic: '3091',
  passive: '3092',
  ultimate: '3093',
  poison: 'status.hero.309.poison',
  counterWindow: 'status.hero.309.counter-window',
  stun: 'status.hero.309.stun',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1.8, 1.89, 1.98, 2.07, 2.16] as const;
const poisonDamageBonus = .4;
const maxPoisonStacks = 3;
const defenseDownPerStack = .08;
const counterChance = .25;

export function registerAxiang(registry: ContentRegistry): void {
  registry.registerStatus({ id: axiangIds.poison, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'add-stack', maxStacks: maxPoisonStacks,
    stackScope: 'source-unit' });
  registry.registerStatus({ id: axiangIds.counterWindow, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: axiangIds.stun, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerHero(createAxiangDefinition());
}

export function createAxiangDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: axiangIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      return [axiangDamage(context, actor, target, axiangSource(axiangIds.basic, actor.unitId), Number(parameters.ratio ?? 1))];
    },
  };
  const ultimate: SkillDefinition = {
    id: axiangIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, bonusPerPoison: poisonDamageBonus, stunAtStacks: 3, stunChance: 1 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      const source = axiangSource(axiangIds.ultimate, actor.unitId);
      const stacks = poisonStacks(target, actor.unitId);
      const ratio = Number(parameters.ratio ?? ultimateRatios[0])
        + stacks * Number(parameters.bonusPerPoison ?? poisonDamageBonus);
      const commands: EffectCommand[] = [axiangDamage(context, actor, target, source, ratio)];
      if (stacks >= Number(parameters.stunAtStacks ?? 3)) {
        const stun = attemptControl(context, { attemptId: `${axiangIds.stun}:${actor.unitId}:${target.unitId}:${context.state.counters.action}`,
          source, targetId: target.unitId, statusId: axiangIds.stun, controlType: '眩晕',
          baseChance: Number(parameters.stunChance ?? 1), duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
        if (stun) commands.push(stun);
      }
      return commands;
    },
  };
  return {
    id: axiangIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    aiCoverageNotes: ['鬼火不少于3时使用蛇卒·狂暴，并优先选择蛇毒层数较多的敌方；否则使用普攻。官方选招与反击目标偏好未完整提取。'],
    mechanicsCoverageNotes: ['已接入毒牙普攻倍率、蛇之影每次敌方命中100%基础概率施加1层防御降低8%的蛇毒（最多3层/3回合）、蛇卒·狂暴3火并按每层蛇毒增伤40%/三层时尝试眩晕，以及自身/友方受到非间接伤害后25%概率反击且每次攻击仅触发一次。反击层数是否跨召唤物/联动伤害共用、毒蛇层数的驱散与旧层持续时间刷新方式仍需帧核。'],
    handlers: {
      hit: { priority: 55, handle(context, event) {
        return [...(applyPoisonOnOwnHit(context, event) ?? []), ...(counterAfterAllyDamage(context, event) ?? [])];
      } },
    },
    policy(context, actorId) {
      const actor = context.getUnit(actorId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = [...enemies].sort((left, right) => poisonStacks(right, actorId) - poisonStacks(left, actorId)
        || left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
      const fire = context.state.resources[actor.side]?.fire ?? actor.resources.fire ?? 0;
      return { actorId, skillId: fire >= 3 ? axiangIds.ultimate : axiangIds.basic,
        targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function applyPoisonOnOwnHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.suppressSourcePassiveTriggers || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!actor || actor.heroId !== axiangIds.hero || actor.unitKind === 'summon' || !passivesEnabled(actor)
    || !target || target.hp <= 0 || actor.side === target.side) return;
  const source = axiangSource(axiangIds.passive, actor.unitId);
  return attemptDebuff(context, { source, targetId: target.unitId, statusId: axiangIds.poison, baseChance: 1,
    duration: { kind: 'count', remaining: 3, owner: 'target-turn' }, parentEventId: event.eventId, stacks: 1,
    modifiers: [{ stat: 'defense', operation: 'percent', amount: -defenseDownPerStack, perStack: true }] });
}

function counterAfterAllyDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  // Indirect damage is emitted as life-lost in the engine, so only damage events reach this counter.
  if (event.type !== 'damage' || event.source.unitId === undefined) return;
  const victim = context.getUnit(event.targetId);
  const enemy = context.getUnit(event.source.unitId);
  if (!victim || !enemy || enemy.side === victim.side || event.hpLost <= 0) return;
  const owners = context.getLivingUnits(victim.side).filter(unit => unit.heroId === axiangIds.hero
    && unit.unitKind !== 'summon' && passivesEnabled(unit));
  const commands: EffectCommand[] = [];
  for (const owner of owners) {
    if (event.suppressTargetPassiveTriggers && owner.unitId === victim.unitId) continue;
    const lock = owner.statuses.find(status => status.statusId === axiangIds.counterWindow);
    const attackKey = event.attackId ?? event.eventId;
    if (String(lock?.values?.attackKey ?? '') === String(attackKey)) continue;
    const source = axiangSource(axiangIds.passive, owner.unitId);
    const marker: StatusInstance = { instanceId: `${axiangIds.counterWindow}:${owner.unitId}`,
      statusId: axiangIds.counterWindow, source, stacks: 1, duration: { kind: 'permanent' },
      values: { attackKey: String(attackKey) } };
    commands.push({ type: 'add-status', source, targetId: owner.unitId, instance: marker, parentEventId: event.eventId });
    if (context.random() >= counterChance) continue;
    const ownerStats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
    const targetStats = context.getEffectiveStats(enemy.unitId) ?? enemy.stats;
    const rank = Math.max(1, Math.min(5, owner.skillLevels?.[axiangIds.basic] ?? owner.skillLevel));
    const ratio = [.1, .105, .11, .115, .125][rank - 1]!;
    const hit = context.calculateDamage({ attack: ownerStats.attack, defense: targetStats.defense,
      defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: ownerStats.crit,
      critDamage: ownerStats.critDamage }, owner, enemy);
    commands.push({ type: 'schedule-attack', source, parentEventId: event.eventId, scheduling: 'counter',
      intent: { actorId: owner.unitId, skillId: axiangIds.passive, targetIds: [enemy.unitId],
        shape: 'single', targetRelation: 'enemy', kind: 'passive' },
      hits: [{ targetId: enemy.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
        ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, ownerStats.critDamage) } : {}), isCritical: hit.isCritical }] });
  }
  return commands.length ? commands : undefined;
}

function axiangDamage(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number): EffectCommand {
  const attack = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
  const result = context.calculateDamage({ attack: attack.attack, defense, defenseIgnore: effectiveDefenseIgnore(actor), ratio,
    critChance: attack.crit, critDamage: attack.critDamage }, actor as UnitState, target as UnitState);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
    ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
    ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, attack.critDamage) } : {}), isCritical: result.isCritical };
}

function poisonStacks(target: Readonly<UnitState>, ownerId: string): number {
  return target.statuses.filter(status => status.statusId === axiangIds.poison && status.source.unitId === ownerId)
    .reduce((sum, status) => sum + status.stacks, 0);
}

function axiangSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
