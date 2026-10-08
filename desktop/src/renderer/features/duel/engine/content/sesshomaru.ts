import type { HeroDefinition, SkillDefinition, StatusDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import type { ContentRegistry } from './registry';

export const sesshomaruIds = {
  hero: 314,
  basic: '3141',
  passive: '3142',
  ultimate: '3143',
  defenseDown: 'status.hero.314.toxic-claw-defense-down',
  wound: 'status.hero.314.underworld-moon-wound',
  fatalGuard: 'status.hero.314.tenseiga-fatal-guard',
  fatalRound: 'status.hero.314.fatal-guard-round',
  invulnerability: 'status.hero.314.tenseiga-invulnerability',
  aftershock: 'status.hero.314.tenseiga-aftershock',
  lifeSteal: 'status.hero.314.tenseiga-life-steal',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1.5, 1.58, 1.66, 1.74, 1.82] as const;

export function registerSesshomaru(registry: ContentRegistry): void {
  const statuses: StatusDefinition[] = [
    { id: sesshomaruIds.defenseDown, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'replace' },
    { id: sesshomaruIds.wound, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'target-turn', refreshPolicy: 'refresh-duration', preventsRevive: true },
    { id: sesshomaruIds.fatalGuard, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace', preventsLethalDamage: true, requiresPassiveEnabled: true },
    { id: sesshomaruIds.fatalRound, mechanicsCoverage: 'partial', category: 'other', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: sesshomaruIds.invulnerability, mechanicsCoverage: 'partial', category: 'buff', dispellable: false, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace', preventsAssist: true },
    { id: sesshomaruIds.aftershock, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
    { id: sesshomaruIds.lifeSteal, mechanicsCoverage: 'partial', category: 'buff', dispellable: true, sealable: false,
      durationOwner: 'permanent', refreshPolicy: 'replace' },
  ];
  statuses.forEach(status => registry.registerStatus(status));
  registry.registerHero(createSesshomaruDefinition());
}

export function createSesshomaruDefinition(): HeroDefinition {
  const basic: SkillDefinition = {
    id: sesshomaruIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.heroId !== sesshomaruIds.hero || actor.hp <= 0 || !target || target.hp <= 0 || target.side === actor.side) return [];
      const rank = skillRank(actor, sesshomaruIds.basic);
      const row = skillRow(actor, sesshomaruIds.basic);
      const ratio = skillNumber(row, 'addDmg') ?? Number(parameters.ratio ?? basicRatios[rank - 1]);
      const source = sesshomaruSource(sesshomaruIds.basic, actor.unitId);
      const commands: EffectCommand[] = [damageCommand(context, actor, target, source, ratio)];
      if (rank >= 2 && skillNumber(row, 'buffId') === 3141) commands.push(...attemptDebuff(context, {
        source, targetId: target.unitId, statusId: sesshomaruIds.defenseDown,
        baseChance: skillNumber(row, 'addBuffRate') ?? 1,
        duration: { kind: 'count', remaining: Math.max(1, skillNumber(row, 'buffDuration') ?? 1), owner: 'target-turn' },
        parentEventId: undefined, modifiers: [{ stat: 'defense', operation: 'percent', amount: -.2 }],
      }));
      return commands;
    },
  };

  const ultimate: SkillDefinition = {
    id: sesshomaruIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: ultimateRatios.map(ratio => ({ ratio, cost: 3, woundTurns: 2 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== sesshomaruIds.hero || actor.hp <= 0) return [];
      const rank = skillRank(actor, sesshomaruIds.ultimate);
      const row = skillRow(actor, sesshomaruIds.ultimate);
      const ratio = skillNumber(row, 'addDmg') ?? Number(parameters.ratio ?? ultimateRatios[rank - 1]);
      const source = sesshomaruSource(sesshomaruIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [];
      for (const target of context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')) {
        commands.push(damageCommand(context, actor, target, source, ratio));
        if (target.hp > 0 && skillNumber(row, 'buffId') === 3143) commands.push(...attemptDebuff(context, {
          source, targetId: target.unitId, statusId: sesshomaruIds.wound,
          baseChance: skillNumber(row, 'addBuffRate') ?? 1,
          duration: { kind: 'count', remaining: Math.max(1, skillNumber(row, 'buffDuration') ?? 2), owner: 'target-turn' },
          values: { healingBelow: .3 }, modifiers: [{ stat: 'healingTaken', operation: 'percent', amount: -1,
            condition: { healthRatioBelow: .3 } }],
        }));
      }
      return commands;
    },
  };

  return {
    id: sesshomaruIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['毒华爪倍率与防御降低、冥道残月破3火群攻和创伤（低于30%禁疗、阻止复活）、天生牙30%减伤（按已损生命40%封顶）、觉醒致命保护/短暂无敌/后续减伤与30%吸血已接入。致命保护只触发一次/回目，跨回目重置；受邀攻击限制、保护状态与御魂交互及帧录像边界仍需核对。'],
    modifyIncomingDamage(_attacker, target, amount) {
      if (target.heroId !== sesshomaruIds.hero || !passivesEnabled(target) || amount <= 0) return amount;
      if (hasStatus(target, sesshomaruIds.invulnerability)) return 0;
      const missingHp = Math.max(0, target.stats.hp - target.hp);
      return Math.max(0, amount - Math.min(amount * .3, missingHp * .4));
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const targetIds = enemies.map(enemy => enemy.unitId);
      return { actorId: unitId, skillId: (context.state.resources[actor.side]?.fire ?? 0) >= 3
        ? sesshomaruIds.ultimate : sesshomaruIds.basic,
        targetIds: (context.state.resources[actor.side]?.fire ?? 0) >= 3 ? targetIds : [targetIds[0]!],
        shape: (context.state.resources[actor.side]?.fire ?? 0) >= 3 ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    },
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== sesshomaruIds.hero || !passivesEnabled(actor) || actor.awakeFilter !== 1) return [];
      const source = sesshomaruSource(sesshomaruIds.passive, actor.unitId);
      return [fatalGuardCommand(actor, source), fatalRoundCommand(actor, source, context.state.counters.round)];
    },
    handlers: {
      hit: { priority: 52, handle(context, event) { return leechOnDamage(context, event); } },
      'effect-resolution': { priority: 52, handle(context, event) { return afterFatalSave(context, event); } },
      'turn-start': { priority: 52, handle(context, event) { return maintainProtection(context, event); } },
      'turn-end': { priority: 52, handle(context, event) { return expireAftershock(context, event); } },
    },
  };
}

function afterFatalSave(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'status-removed' || event.statusId !== sesshomaruIds.fatalGuard || event.reason !== 'consumed') return;
  const owner = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== sesshomaruIds.hero || owner.hp <= 0 || owner.awakeFilter !== 1 || !passivesEnabled(owner)) return;
  const source = sesshomaruSource(sesshomaruIds.passive, owner.unitId);
  const commands: EffectCommand[] = [];
  const removable = owner.statuses.filter(status => {
    const category = context.getStatusCategory(status.statusId);
    return category === 'debuff' || category === 'control';
  }).map(status => status.instanceId);
  if (removable.length) commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
    instanceIds: removable, reason: 'consumed', parentEventId: event.eventId });
  commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId, instance: {
    instanceId: `${sesshomaruIds.invulnerability}:${owner.unitId}`, statusId: sesshomaruIds.invulnerability, source,
    stacks: 1, duration: { kind: 'permanent' }, values: { enteredRound: context.state.counters.round },
  } },
  { type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId, instance: {
    instanceId: `${sesshomaruIds.lifeSteal}:${owner.unitId}`, statusId: sesshomaruIds.lifeSteal, source,
    stacks: 1, duration: { kind: 'permanent' }, values: { activeRound: context.state.counters.round },
  } },
  fatalRoundCommand(owner, source, context.state.counters.round));
  return commands;
}

function maintainProtection(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const commands: EffectCommand[] = [];
  for (const unitId of [...context.state.sides.blue, ...context.state.sides.red]) {
    const owner = context.getUnit(unitId);
    if (!owner || owner.hp <= 0 || owner.heroId !== sesshomaruIds.hero || !passivesEnabled(owner)) continue;
    const source = sesshomaruSource(sesshomaruIds.passive, owner.unitId);
    const roundMark = owner.statuses.find(status => status.statusId === sesshomaruIds.fatalRound);
    const lastRound = Number(roundMark?.values?.round ?? context.state.counters.round);
    if (context.state.counters.round > lastRound) {
      const staleLeech = owner.statuses.find(status => status.statusId === sesshomaruIds.lifeSteal);
      if (staleLeech) commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
        instanceIds: [staleLeech.instanceId], reason: 'expired', parentEventId: event.eventId });
      if (owner.awakeFilter === 1 && !hasStatus(owner, sesshomaruIds.fatalGuard)) commands.push(fatalGuardCommand(owner, source));
      commands.push(fatalRoundCommand(owner, source, context.state.counters.round));
    }
    if (event.unitId === owner.unitId && hasStatus(owner, sesshomaruIds.invulnerability)) {
      const invulnerability = owner.statuses.find(status => status.statusId === sesshomaruIds.invulnerability)!;
      commands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
        instanceIds: [invulnerability.instanceId], reason: 'consumed', parentEventId: event.eventId });
      commands.push({ type: 'add-status', source, targetId: owner.unitId, parentEventId: event.eventId, instance: {
        instanceId: `${sesshomaruIds.aftershock}:${owner.unitId}`, statusId: sesshomaruIds.aftershock, source,
        stacks: 1, duration: { kind: 'permanent' }, modifiers: [{ stat: 'damage', operation: 'percent', amount: -.4 }],
      } });
    }
  }
  return commands;
}

function leechOnDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId || event.hpLost <= 0) return;
  const owner = context.getUnit(event.source.unitId);
  const leech = owner?.statuses.find(status => status.statusId === sesshomaruIds.lifeSteal);
  if (!owner || owner.heroId !== sesshomaruIds.hero || !leech || Number(leech.values?.activeRound) !== context.state.counters.round) return;
  return [{ type: 'heal', source: sesshomaruSource(sesshomaruIds.passive, owner.unitId), targetId: owner.unitId,
    amount: event.hpLost * .3, parentEventId: event.eventId }];
}

function expireAftershock(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const owner = context.getUnit(event.unitId);
  const aftershock = owner?.statuses.find(status => status.statusId === sesshomaruIds.aftershock);
  if (!owner || owner.heroId !== sesshomaruIds.hero || !aftershock) return;
  return [{ type: 'remove-status-instances', source: sesshomaruSource(sesshomaruIds.passive, owner.unitId),
    targetId: owner.unitId, instanceIds: [aftershock.instanceId], reason: 'expired', parentEventId: event.eventId }];
}

function fatalGuardCommand(owner: Readonly<UnitState>, source: SourceRef): EffectCommand {
  return { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${sesshomaruIds.fatalGuard}:${owner.unitId}`,
    statusId: sesshomaruIds.fatalGuard, source, stacks: 1, duration: { kind: 'permanent' } } };
}

function fatalRoundCommand(owner: Readonly<UnitState>, source: SourceRef, round: number): EffectCommand {
  return { type: 'add-status', source, targetId: owner.unitId, instance: { instanceId: `${sesshomaruIds.fatalRound}:${owner.unitId}`,
    statusId: sesshomaruIds.fatalRound, source, stacks: 1, duration: { kind: 'permanent' }, values: { round } } };
}

function damageCommand(context: BattleContext, actor: Readonly<UnitState>, target: Readonly<UnitState>, source: SourceRef,
  ratio: number): EffectCommand {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
  const hit = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
    defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
  return { type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount,
    ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical,
    ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, offense.critDamage) } : {}) };
}

function hasStatus(unit: Readonly<UnitState>, statusId: string): boolean {
  return unit.statuses.some(status => status.statusId === statusId);
}

function skillRow(actor: Readonly<UnitState>, skillId: string) {
  return battleSkillRow(skillId, skillRank(actor, skillId), actor.awakeFilter,
    actor.unitKind === 'monster' || actor.unitKind === 'summon');
}

function skillRank(actor: Readonly<UnitState>, skillId: string): number {
  return Math.max(1, Math.min(5, actor.skillLevels?.[skillId] ?? actor.skillLevel));
}

function sesshomaruSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
